"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
/**
 * 主入口：定时刷新 + 交易时段降频 + 命令注册 + 配置监听
 */
const vscode = __importStar(require("vscode"));
const fetcher_1 = require("./fetcher");
const tree_1 = require("./tree");
const statusbar_1 = require("./statusbar");
const quickpick_1 = require("./quickpick");
const stockpicker_1 = require("./stockpicker");
const detailpanel_1 = require("./detailpanel");
const trends_1 = require("./trends");
function activate(context) {
    const manager = new WatchManager(context);
    context.subscriptions.push(manager);
}
function deactivate() { }
class WatchManager {
    context;
    tree;
    statusbar;
    refreshTimer;
    lastError = '';
    fetching = false;
    /** 详情面板（右键"查看详情"），同屏只保留一个 */
    detailPanel = null;
    detailPanelTimer;
    detailSecid = null;
    /** 自选股持久化 */
    stocks = [];
    /** 置顶到状态栏的 secid 列表（有序） */
    pinned = [];
    /** 老板模式 */
    bossMode = false;
    constructor(context) {
        this.context = context;
        this.stocks = context.globalState.get('stocks', []);
        // 旧版单置顶数据迁移 → 数组
        const legacyPinned = context.globalState.get('pinned', null);
        this.pinned = context.globalState.get('pinnedList', []);
        if (legacyPinned && !this.pinned.includes(legacyPinned)) {
            this.pinned.push(legacyPinned);
            void context.globalState.update('pinned', undefined);
            void context.globalState.update('pinnedList', this.pinned);
        }
        this.bossMode = context.globalState.get('bossMode', false);
        (0, tree_1.setBossMode)(this.bossMode);
        (0, statusbar_1.setStatusBarBossMode)(this.bossMode);
        void vscode.commands.executeCommand('setContext', 'stockWatch.bossMode', this.bossMode);
        // 首次安装给默认自选
        if (!this.stocks.length) {
            const defaults = vscode.workspace.getConfiguration('stockWatch').get('defaultStocks', []);
            this.stocks = defaults.map((code) => {
                const market = /^(60|68|9|51|56|58)/.test(code) ? 1 : 0;
                return { secid: `${market}.${code}`, code, market };
            });
            void context.globalState.update('stocks', this.stocks);
        }
        this.tree = new tree_1.StockTreeDataProvider();
        this.tree.setPinned(this.pinned);
        const savedSort = context.globalState.get('sortMode', 'change');
        this.tree.setSortMode(savedSort, new Map(this.stocks.map((s, i) => [s.secid, i])));
        // 恢复拖拽自定义顺序
        const manualOrder = context.globalState.get('manualOrder', []);
        if (manualOrder.length) {
            this.tree.setManualOrder(new Map(manualOrder.map((s, i) => [s, i])));
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
        this.statusbar = new statusbar_1.StatusBarManager();
        this.registerCommands();
        this.wireConfigChanges();
        void this.refresh();
        this.scheduleNext();
    }
    registerCommands() {
        const reg = (id, fn) => this.context.subscriptions.push(vscode.commands.registerCommand(id, fn));
        reg('stockWatch.refresh', () => { void this.refresh(); });
        reg('stockWatch.addStock', async () => {
            const item = await (0, quickpick_1.pickStock)();
            if (!item) {
                return;
            }
            if (this.stocks.some((s) => s.secid === item.secid)) {
                vscode.window.showInformationMessage(`${item.code} 已在自选中`);
                return;
            }
            this.stocks.push(item);
            await this.persist();
            void this.refresh();
        });
        reg('stockWatch.removeStock', async (node) => {
            const secid = node instanceof tree_1.StockTreeItem ? node.quote.secid : node.secid;
            this.stocks = this.stocks.filter((s) => s.secid !== secid);
            if (this.pinned.includes(secid)) {
                await this.setPinned(this.pinned.filter((s) => s !== secid));
            }
            await this.persist();
            void this.refresh();
        });
        reg('stockWatch.pinToStatusBar', async (node) => {
            const secid = node?.quote?.secid;
            if (!secid) {
                return;
            }
            if (this.pinned.includes(secid)) {
                await this.setPinned(this.pinned.filter((s) => s !== secid));
                vscode.window.showInformationMessage('已从状态栏移除');
            }
            else {
                await this.setPinned([...this.pinned, secid]);
                vscode.window.showInformationMessage('已添加到状态栏');
            }
        });
        /** 兼容旧命令名：从状态栏取消置顶 */
        reg('stockWatch.unpinFromStatusBar', async (node) => {
            const secid = node?.quote?.secid;
            if (!secid) {
                return;
            }
            await this.setPinned(this.pinned.filter((s) => s !== secid));
        });
        /** 点击状态栏格子：弹自选股列表，选中替换该格子 */
        reg('stockWatch.switchStatusBarStock', async (oldSecid) => {
            if (!oldSecid) {
                return;
            }
            const pick = await (0, stockpicker_1.pickSwitchStock)(this.treeCache, oldSecid);
            if (!pick || pick.secid === oldSecid) {
                return;
            }
            if (this.pinned.includes(oldSecid)) {
                // 置顶格：原位置替换，保持格子顺序
                await this.setPinned(this.pinned.map((s) => (s === oldSecid ? pick.secid : s)));
            }
            else {
                // 兜底单格（无置顶）：选中的直接成为置顶股
                await this.setPinned([...this.pinned.filter((s) => s !== pick.secid), pick.secid]);
            }
            void this.refresh();
        });
        reg('stockWatch.openDetail', (q) => {
            if (!q?.secid) {
                return;
            }
            const url = `https://quote.eastmoney.com/${detailPath(q)}`;
            void vscode.env.openExternal(vscode.Uri.parse(url));
        });
        /** 右键"查看详情"：Webview 大面板（股价+分时+五档+逐笔），盘中自动刷新 */
        reg('stockWatch.showDetailPanel', async (node) => {
            const q = node instanceof tree_1.StockTreeItem ? node.quote : node;
            if (!q?.secid) {
                return;
            }
            void this.openDetailPanel(q);
        });
        reg('stockWatch.showPanel', () => {
            void (0, stockpicker_1.showStockPicker)({
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
            const modes = ['change', 'code', 'name', 'added'];
            const picks = modes.map((m) => ({
                label: `${m === current ? '$(check) ' : '      '}${tree_1.SORT_LABELS[m]}`,
                mode: m,
            }));
            const sel = await vscode.window.showQuickPick(picks, {
                placeHolder: `当前：${tree_1.SORT_LABELS[current]} · 选择侧边栏排序方式（置顶股固定最前）`,
                ignoreFocusOut: true,
            });
            if (!sel) {
                return;
            }
            await this.context.globalState.update('sortMode', sel.mode);
            const orderMap = new Map(this.stocks.map((s, i) => [s.secid, i]));
            this.tree.setSortMode(sel.mode, orderMap);
            vscode.window.showInformationMessage(`侧边栏已${tree_1.SORT_LABELS[sel.mode].replace('按', '按')}排序`);
        });
        reg('stockWatch.openSettings', () => {
            void vscode.commands.executeCommand('workbench.action.openSettings', 'stockWatch');
        });
        reg('stockWatch.toggleBossMode', async () => {
            this.bossMode = !this.bossMode;
            await this.context.globalState.update('bossMode', this.bossMode);
            (0, tree_1.setBossMode)(this.bossMode);
            (0, statusbar_1.setStatusBarBossMode)(this.bossMode);
            void vscode.commands.executeCommand('setContext', 'stockWatch.bossMode', this.bossMode);
            this.tree.setBossModeView();
            this.statusbar.update(this.treeCache);
            this.statusbar.ensureEntry(this.treeCache);
            vscode.window.showInformationMessage(this.bossMode ? '老板模式已开启：行情已隐藏（Ctrl+Alt+L 恢复）' : '老板模式已关闭，行情恢复');
        });
    }
    wireConfigChanges() {
        this.context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('stockWatch')) {
                this.statusbar.setPinnedList(this.pinned);
                this.statusbar.update(this.lastStockQuotes());
                this.scheduleNext();
            }
        }));
    }
    /** 打开（或复用）详情面板；盘中 5s 自动刷新 */
    async openDetailPanel(q) {
        if (this.detailPanelTimer) {
            clearTimeout(this.detailPanelTimer);
            this.detailPanelTimer = undefined;
        }
        this.detailSecid = q.secid;
        if (this.detailPanel) {
            this.detailPanel.title = `${q.name} · 行情详情`;
            this.detailPanel.reveal();
        }
        else {
            this.detailPanel = vscode.window.createWebviewPanel('stockWatch.detail', `${q.name} · 行情详情`, vscode.ViewColumn.One, { enableScripts: false, retainContextWhenHidden: false });
            this.detailPanel.onDidDispose(() => {
                this.detailPanel = null;
                this.detailSecid = null;
                if (this.detailPanelTimer) {
                    clearTimeout(this.detailPanelTimer);
                    this.detailPanelTimer = undefined;
                }
            }, null, this.context.subscriptions);
        }
        await this.renderDetailPanel();
        // 盘中每 5s 重拉；休市 60s
        const schedule = () => {
            if (!this.detailPanel) {
                return;
            }
            this.detailPanelTimer = setTimeout(async () => {
                if (!this.detailPanel || !this.detailSecid) {
                    return;
                }
                await this.renderDetailPanel();
                schedule();
            }, this.currentInterval(5, 60) * 1000);
        };
        schedule();
    }
    async renderDetailPanel() {
        if (!this.detailPanel || !this.detailSecid) {
            return;
        }
        const secid = this.detailSecid;
        // 用缓存行情打底，避免面板闪空
        const cached = this.treeCache.find((x) => x.secid === secid)
            ?? this.tree.getQuote(secid);
        const [quotes, trends, ob, ticks] = await Promise.all([
            (0, fetcher_1.fetchQuotes)([secid]),
            (0, trends_1.fetchTrends)(secid),
            (0, detailpanel_1.fetchOrderBook)(secid),
            (0, detailpanel_1.fetchTicks)(secid),
        ]);
        const q = quotes[0] || cached;
        if (!q) {
            return;
        }
        if (this.detailPanel) {
            this.detailPanel.webview.html = (0, detailpanel_1.buildPanelHtml)(q, trends, ob, ticks);
        }
    }
    async setPinned(list) {
        this.pinned = list;
        await this.context.globalState.update('pinnedList', this.pinned);
        this.statusbar.setPinnedList(this.pinned);
        this.tree.setPinned(this.pinned);
    }
    lastStockQuotes() {
        // tree 持有最近数据；直接复用其缓存渲染状态栏
        return this.treeCache;
    }
    treeCache = [];
    async persist() {
        await this.context.globalState.update('stocks', this.stocks);
        this.tree.setSortMode(this.tree.getSortMode(), new Map(this.stocks.map((s, i) => [s.secid, i])));
    }
    async refresh() {
        if (this.fetching) {
            return;
        }
        this.fetching = true;
        try {
            const cfg = vscode.workspace.getConfiguration('stockWatch');
            const indexSecids = cfg.get('indexCodes', []);
            const stockSecids = this.stocks.map((s) => s.secid);
            const all = [...indexSecids, ...stockSecids];
            const quotes = await (0, fetcher_1.fetchQuotes)(all);
            const idxSet = new Set(indexSecids);
            const indexQuotes = quotes.filter((q) => idxSet.has(q.secid));
            const stockQuotes = quotes.filter((q) => !idxSet.has(q.secid));
            // 回填名称
            for (const q of stockQuotes) {
                const s = this.stocks.find((x) => x.secid === q.secid);
                if (s && !s.name) {
                    s.name = q.name;
                }
            }
            this.treeCache = stockQuotes;
            this.tree.update(indexQuotes, stockQuotes);
            this.statusbar.update(stockQuotes.length ? stockQuotes : indexQuotes);
            this.statusbar.ensureEntry(this.treeCache);
            this.lastError = '';
        }
        catch (e) {
            const msg = e instanceof fetcher_1.FetchError ? e.message : String(e);
            if (msg !== this.lastError) {
                this.lastError = msg;
                vscode.window.showWarningMessage(`Stock Watch 刷新失败：${msg}`);
            }
        }
        finally {
            this.fetching = false;
        }
    }
    /** 交易时段感知的定时刷新：A股时段 9:00-15:30 每 N 秒，其余降频 */
    scheduleNext() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = undefined;
        }
        const cfg = vscode.workspace.getConfiguration('stockWatch');
        const base = cfg.get('refreshInterval', 5);
        const off = cfg.get('offHoursRefresh', 60);
        const tick = () => {
            void this.refresh();
            this.refreshTimer = setTimeout(tick, this.currentInterval(base, off) * 1000);
        };
        this.refreshTimer = setTimeout(tick, this.currentInterval(base, off) * 1000);
    }
    currentInterval(base, off) {
        const hasUS = this.stocks.some((s) => s.market === 105);
        const hasHK = this.stocks.some((s) => s.market === 116);
        const active = isMarketActive(hasUS, hasHK);
        if (active) {
            return Math.max(2, base);
        }
        return off > 0 ? off : Math.max(2, base);
    }
    dispose() {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }
        if (this.detailPanelTimer) {
            clearTimeout(this.detailPanelTimer);
        }
        this.detailPanel?.dispose();
    }
}
/** A股 9:15-15:05 活跃；含港美股时按北京时间 9:15~次日 5:00 扩大窗口 */
function isMarketActive(hasUS, hasHK) {
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    // A股交易（含集合竞价与收盘）
    const aActive = (minutes >= 555 && minutes <= 905); // 9:15 ~ 15:05
    if (aActive) {
        return true;
    }
    // 港股 9:30-16:10
    const hkActive = hasHK && minutes >= 570 && minutes <= 970;
    if (hkActive) {
        return true;
    }
    // 美股（北京 21:30/22:30 ~ 4:00/5:00，简化为 21:00~5:00）
    if (hasUS) {
        if (minutes >= 1260 || minutes <= 300) {
            return true;
        }
    }
    // 周末无行情
    const day = now.getDay();
    if (day === 0 || day === 6) {
        return false;
    }
    return false;
}
function detailPath(q) {
    if (q.market === 1) {
        return `sh${q.code}.html`;
    }
    if (q.market === 0) {
        return `sz${q.code}.html`;
    }
    if (q.market === 116) {
        return `hk${q.code}.html`;
    }
    return `us${q.code}.html`;
}
//# sourceMappingURL=extension.js.map