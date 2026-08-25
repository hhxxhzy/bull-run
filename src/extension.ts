/**
 * 主入口：定时刷新 + 交易时段降频 + 命令注册 + 配置监听
 */
import * as vscode from 'vscode';
import { Quote, StockItem } from './types';
import { fetchQuotes, FetchError } from './fetcher';
import { StockTreeDataProvider, StockTreeItem, setBossMode, SortMode, SORT_LABELS } from './tree';
import { StatusBarManager, setStatusBarBossMode } from './statusbar';
import { pickStock } from './quickpick';
import { showStockPicker, pickSwitchStock } from './stockpicker';
import { fetchOrderBook, fetchTicks, buildPanelHtml } from './detailpanel';
import { fetchTrends } from './trends';

export function activate(context: vscode.ExtensionContext) {
  const manager = new WatchManager(context);
  context.subscriptions.push(manager);
}

export function deactivate() { /* noop */ }

class WatchManager implements vscode.Disposable {
  private tree!: StockTreeDataProvider;
  private statusbar!: StatusBarManager;
  private refreshTimer: NodeJS.Timeout | undefined;
  private lastError = '';
  private fetching = false;
  /** 详情面板（右键"查看详情"），同屏只保留一个 */
  private detailPanel: vscode.WebviewPanel | null = null;
  private detailPanelTimer: NodeJS.Timeout | undefined;
  private detailSecid: string | null = null;

  /** 自选股持久化 */
  private stocks: StockItem[] = [];
  /** 置顶到状态栏的 secid 列表（有序） */
  private pinned: string[] = [];
  /** 老板模式 */
  private bossMode = false;

  constructor(private context: vscode.ExtensionContext) {
    this.stocks = context.globalState.get<StockItem[]>('stocks', []);
    // 旧版单置顶数据迁移 → 数组
    const legacyPinned = context.globalState.get<string | null>('pinned', null);
    this.pinned = context.globalState.get<string[]>('pinnedList', []);
    if (legacyPinned && !this.pinned.includes(legacyPinned)) {
      this.pinned.push(legacyPinned);
      void context.globalState.update('pinned', undefined);
      void context.globalState.update('pinnedList', this.pinned);
    }
    this.bossMode = context.globalState.get<boolean>('bossMode', false);
    setBossMode(this.bossMode);
    setStatusBarBossMode(this.bossMode);
    void vscode.commands.executeCommand('setContext', 'stockWatch.bossMode', this.bossMode);

    // 首次安装给默认自选
    if (!this.stocks.length) {
      const defaults = vscode.workspace.getConfiguration('stockWatch').get<string[]>('defaultStocks', []);
      this.stocks = defaults.map((code) => {
        const market = /^(60|68|9|51|56|58)/.test(code) ? 1 : 0;
        return { secid: `${market}.${code}`, code, market };
      });
      void context.globalState.update('stocks', this.stocks);
    }

    this.tree = new StockTreeDataProvider();
    this.tree.setPinned(this.pinned);
    const savedSort = context.globalState.get<SortMode>('sortMode', 'change');
    this.tree.setSortMode(savedSort, new Map(this.stocks.map((s, i) => [s.secid, i])));
    // 恢复拖拽自定义顺序
    const manualOrder = context.globalState.get<string[]>('manualOrder', []);
    if (manualOrder.length) {
      this.tree.setManualOrder(new Map(manualOrder.map((s, i) => [s, i] as [string, number])));
    }
    this.tree.onDidChangePinnedOrder = async (secids) => {
      await context.globalState.update('manualOrder', secids);
    };
    // 声明了 dragAndDrop 必须用 createTreeView（registerTreeDataProvider 挂 dnd 会静默失败导致视图空白）
    const treeView = vscode.window.createTreeView('stockWatchTreeView', {
      treeDataProvider: this.tree,
      dragAndDropController: this.tree,
      showCollapseAll: true,
    });
    context.subscriptions.push(treeView);

    this.statusbar = new StatusBarManager();

    this.registerCommands();
    this.wireConfigChanges();

    void this.refresh();
    this.scheduleNext();
  }

  private registerCommands() {
    const reg = (id: string, fn: (...args: any[]) => any) =>
      this.context.subscriptions.push(vscode.commands.registerCommand(id, fn));

    reg('stockWatch.refresh', () => { void this.refresh(); });
    reg('stockWatch.addStock', async () => {
      const item = await pickStock();
      if (!item) { return; }
      if (this.stocks.some((s) => s.secid === item.secid)) {
        vscode.window.showInformationMessage(`${item.code} 已在自选中`);
        return;
      }
      this.stocks.push(item);
      await this.persist();
      void this.refresh();
    });
    reg('stockWatch.removeStock', async (node: StockTreeItem | StockItem) => {
      const secid = node instanceof StockTreeItem ? node.quote.secid : (node as StockItem).secid;
      this.stocks = this.stocks.filter((s) => s.secid !== secid);
      if (this.pinned.includes(secid)) {
        await this.setPinned(this.pinned.filter((s) => s !== secid));
      }
      await this.persist();
      void this.refresh();
    });
    reg('stockWatch.pinToStatusBar', async (node: StockTreeItem) => {
      const secid = node?.quote?.secid;
      if (!secid) { return; }
      if (this.pinned.includes(secid)) {
        await this.setPinned(this.pinned.filter((s) => s !== secid));
        vscode.window.showInformationMessage('已从状态栏移除');
      } else {
        await this.setPinned([...this.pinned, secid]);
        vscode.window.showInformationMessage('已添加到状态栏');
      }
    });
    /** 兼容旧命令名：从状态栏取消置顶 */
    reg('stockWatch.unpinFromStatusBar', async (node: StockTreeItem) => {
      const secid = node?.quote?.secid;
      if (!secid) { return; }
      await this.setPinned(this.pinned.filter((s) => s !== secid));
    });
    /** 点击状态栏格子：弹自选股列表，选中替换该格子 */
    reg('stockWatch.switchStatusBarStock', async (oldSecid: string) => {
      if (!oldSecid) { return; }
      const pick = await pickSwitchStock(this.treeCache, oldSecid);
      if (!pick || pick.secid === oldSecid) { return; }
      if (this.pinned.includes(oldSecid)) {
        // 置顶格：原位置替换，保持格子顺序
        await this.setPinned(this.pinned.map((s) => (s === oldSecid ? pick.secid : s)));
      } else {
        // 兜底单格（无置顶）：选中的直接成为置顶股
        await this.setPinned([...this.pinned.filter((s) => s !== pick.secid), pick.secid]);
      }
      void this.refresh();
    });
    reg('stockWatch.openDetail', (q: Quote) => {
      if (!q?.secid) { return; }
      const url = `https://quote.eastmoney.com/${detailPath(q)}`;
      void vscode.env.openExternal(vscode.Uri.parse(url));
    });
    /** 右键"查看详情"：Webview 大面板（股价+分时+五档+逐笔），盘中自动刷新 */
    reg('stockWatch.showDetailPanel', async (node: StockTreeItem | Quote) => {
      const q: Quote | undefined = node instanceof StockTreeItem ? node.quote : (node as Quote);
      if (!q?.secid) { return; }
      void this.openDetailPanel(q);
    });
    reg('stockWatch.showPanel', () => {
      void showStockPicker({
        getQuotes: () => this.treeCache,
        getPinned: () => this.pinned,
        isBossMode: () => this.bossMode,
        togglePin: async (secid) => {
          const on = this.pinned.includes(secid);
          await this.setPinned(on ? this.pinned.filter((s) => s !== secid) : [...this.pinned, secid]);
          void this.refresh();
        },
        remove: async (secid) => {
          this.stocks = this.stocks.filter((s) => s.secid !== secid);
          if (this.pinned.includes(secid)) {
            await this.setPinned(this.pinned.filter((s) => s !== secid));
          }
          await this.persist();
          void this.refresh();
        },
        openDetail: (q) => {
          const url = `https://quote.eastmoney.com/${detailPath(q)}`;
          void vscode.env.openExternal(vscode.Uri.parse(url));
        },
      });
    });
    reg('stockWatch.toggleSort', async () => {
      const current = this.tree.getSortMode();
      const modes: SortMode[] = ['change', 'code', 'name', 'added'];
      const picks = modes.map((m) => ({
        label: `${m === current ? '$(check) ' : '      '}${SORT_LABELS[m]}`,
        mode: m,
      }));
      const sel = await vscode.window.showQuickPick(picks, {
        placeHolder: `当前：${SORT_LABELS[current]} · 选择侧边栏排序方式（置顶股固定最前）`,
        ignoreFocusOut: true,
      });
      if (!sel) { return; }
      await this.context.globalState.update('sortMode', sel.mode);
      const orderMap = new Map(this.stocks.map((s, i) => [s.secid, i]));
      this.tree.setSortMode(sel.mode, orderMap);
      vscode.window.showInformationMessage(`侧边栏已${SORT_LABELS[sel.mode].replace('按', '按')}排序`);
    });
    reg('stockWatch.openSettings', () => {
      void vscode.commands.executeCommand('workbench.action.openSettings', 'stockWatch');
    });
    reg('stockWatch.toggleBossMode', async () => {
      this.bossMode = !this.bossMode;
      await this.context.globalState.update('bossMode', this.bossMode);
      setBossMode(this.bossMode);
      setStatusBarBossMode(this.bossMode);
      void vscode.commands.executeCommand('setContext', 'stockWatch.bossMode', this.bossMode);
      this.tree.setBossModeView();
      this.statusbar.update(this.treeCache);
      this.statusbar.ensureEntry(this.treeCache);
      vscode.window.showInformationMessage(
        this.bossMode ? '老板模式已开启：行情已隐藏（Ctrl+Alt+L 恢复）' : '老板模式已关闭，行情恢复',
        );
    });
  }

  private wireConfigChanges() {
    this.context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('stockWatch')) {
          this.statusbar.setPinnedList(this.pinned);
          this.statusbar.update(this.lastStockQuotes());
          this.scheduleNext();
        }
      }),
    );
  }

  /** 打开（或复用）详情面板；盘中 5s 自动刷新 */
  private async openDetailPanel(q: Quote) {
    if (this.detailPanelTimer) { clearTimeout(this.detailPanelTimer); this.detailPanelTimer = undefined; }
    this.detailSecid = q.secid;

    if (this.detailPanel) {
      this.detailPanel.title = `${q.name} · 行情详情`;
      this.detailPanel.reveal();
    } else {
      this.detailPanel = vscode.window.createWebviewPanel(
        'stockWatch.detail',
        `${q.name} · 行情详情`,
        vscode.ViewColumn.One,
        { enableScripts: false, retainContextWhenHidden: false },
      );
      this.detailPanel.onDidDispose(() => {
        this.detailPanel = null;
        this.detailSecid = null;
        if (this.detailPanelTimer) { clearTimeout(this.detailPanelTimer); this.detailPanelTimer = undefined; }
      }, null, this.context.subscriptions);
    }

    await this.renderDetailPanel();
    // 盘中每 5s 重拉；休市 60s
    const schedule = () => {
      if (!this.detailPanel) { return; }
      this.detailPanelTimer = setTimeout(async () => {
        if (!this.detailPanel || !this.detailSecid) { return; }
        await this.renderDetailPanel();
        schedule();
      }, this.currentInterval(5, 60) * 1000);
    };
    schedule();
  }

  private async renderDetailPanel() {
    if (!this.detailPanel || !this.detailSecid) { return; }
    const secid = this.detailSecid;
    // 用缓存行情打底，避免面板闪空
    const cached = this.treeCache.find((x) => x.secid === secid)
      ?? this.tree.getQuote(secid);
    const [quotes, trends, ob, ticks] = await Promise.all([
      fetchQuotes([secid]),
      fetchTrends(secid),
      fetchOrderBook(secid),
      fetchTicks(secid),
    ]);
    const q = quotes[0] || cached;
    if (!q) { return; }
    if (this.detailPanel) {
      this.detailPanel.webview.html = buildPanelHtml(q, trends, ob, ticks);
    }
  }

  private async setPinned(list: string[]) {
    this.pinned = list;
    await this.context.globalState.update('pinnedList', this.pinned);
    this.statusbar.setPinnedList(this.pinned);
    this.tree.setPinned(this.pinned);
  }

  private lastStockQuotes(): Quote[] {
    // tree 持有最近数据；直接复用其缓存渲染状态栏
    return this.treeCache;
  }
  private treeCache: Quote[] = [];

  private async persist() {
    await this.context.globalState.update('stocks', this.stocks);
    this.tree.setSortMode(this.tree.getSortMode(), new Map(this.stocks.map((s, i) => [s.secid, i])));
  }

  async refresh() {
    if (this.fetching) { return; }
    this.fetching = true;
    try {
      const cfg = vscode.workspace.getConfiguration('stockWatch');
      const indexSecids = cfg.get<string[]>('indexCodes', []);
      const stockSecids = this.stocks.map((s) => s.secid);
      const all = [...indexSecids, ...stockSecids];

      const quotes = await fetchQuotes(all);
      const idxSet = new Set(indexSecids);
      const indexQuotes = quotes.filter((q) => idxSet.has(q.secid));
      const stockQuotes = quotes.filter((q) => !idxSet.has(q.secid));

      // 回填名称
      for (const q of stockQuotes) {
        const s = this.stocks.find((x) => x.secid === q.secid);
        if (s && !s.name) { s.name = q.name; }
      }

      this.treeCache = stockQuotes;
      this.tree.update(indexQuotes, stockQuotes);
      this.statusbar.update(stockQuotes.length ? stockQuotes : indexQuotes);
      this.statusbar.ensureEntry(this.treeCache);
      this.lastError = '';
    } catch (e) {
      const msg = e instanceof FetchError ? e.message : String(e);
      if (msg !== this.lastError) {
        this.lastError = msg;
        vscode.window.showWarningMessage(`Stock Watch 刷新失败：${msg}`);
      }
    } finally {
      this.fetching = false;
    }
  }

  /** 交易时段感知的定时刷新：A股时段 9:00-15:30 每 N 秒，其余降频 */
  private scheduleNext() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    const cfg = vscode.workspace.getConfiguration('stockWatch');
    const base = cfg.get<number>('refreshInterval', 5);
    const off = cfg.get<number>('offHoursRefresh', 60);

    const tick = () => {
      void this.refresh();
      this.refreshTimer = setTimeout(tick, this.currentInterval(base, off) * 1000);
    };
    this.refreshTimer = setTimeout(tick, this.currentInterval(base, off) * 1000);
  }

  private currentInterval(base: number, off: number): number {
    const hasUS = this.stocks.some((s) => s.market === 105);
    const hasHK = this.stocks.some((s) => s.market === 116);
    const active = isMarketActive(hasUS, hasHK);
    if (active) { return Math.max(2, base); }
    return off > 0 ? off : Math.max(2, base);
  }

  dispose() {
    if (this.refreshTimer) { clearTimeout(this.refreshTimer); }
    if (this.detailPanelTimer) { clearTimeout(this.detailPanelTimer); }
    this.detailPanel?.dispose();
  }
}

/** A股 9:15-15:05 活跃；含港美股时按北京时间 9:15~次日 5:00 扩大窗口 */
function isMarketActive(hasUS: boolean, hasHK: boolean): boolean {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  // A股交易（含集合竞价与收盘）
  const aActive = (minutes >= 555 && minutes <= 905); // 9:15 ~ 15:05
  if (aActive) { return true; }
  // 港股 9:30-16:10
  const hkActive = hasHK && minutes >= 570 && minutes <= 970;
  if (hkActive) { return true; }
  // 美股（北京 21:30/22:30 ~ 4:00/5:00，简化为 21:00~5:00）
  if (hasUS) {
    if (minutes >= 1260 || minutes <= 300) { return true; }
  }
  // 周末无行情
  const day = now.getDay();
  if (day === 0 || day === 6) { return false; }
  return false;
}

function detailPath(q: Quote): string {
  if (q.market === 1) { return `sh${q.code}.html`; }
  if (q.market === 0) { return `sz${q.code}.html`; }
  if (q.market === 116) { return `hk${q.code}.html`; }
  return `us${q.code}.html`;
}
