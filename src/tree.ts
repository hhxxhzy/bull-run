/**
 * 树视图 Provider：按市场分组
 * v0.7：tooltip 嵌分时 sparkline + 估值；无行展开（详情走右键大面板）；拖拽排序
 */
import * as vscode from 'vscode';
import { Quote } from './types';
import { fmtAmount, fmtVolume, fmtPrice, fetchDetail, StockDetail } from './fetcher';
import { fetchTrends, sparklineSvg } from './trends';

let bossMode = false;

export function setBossMode(on: boolean) {
  bossMode = on;
}

function mask(s: string): string {
  return bossMode ? '••••' : s;
}

function maskNum(n: string): string {
  return bossMode ? '–.––' : n;
}

export class StockTreeItem extends vscode.TreeItem {
  constructor(
    public readonly quote: Quote,
    public readonly kind: 'index' | 'stock',
    pinned = false,
  ) {
    // 无展开子节点：详情走右键"查看详情"大面板
    super('', vscode.TreeItemCollapsibleState.None);
    const sign = quote.changePct > 0 ? '+' : '';
    this.label = mask(quote.name);
    this.description = `${maskNum(fmtPrice(quote.price))}  ${maskNum(sign + fmtPrice(quote.change))}  ${maskNum(sign + quote.changePct.toFixed(2) + '%')}`;
    this.tooltip = undefined; // 异步填充
    this.contextValue = kind === 'stock' ? (pinned ? 'stock_pinned' : 'stock') : 'index';
    this.iconPath = undefined; // 无图标，去杂
  }

  /** 悬停时异步构建：分时 sparkline + 行情表 + 估值 */
  async resolveTooltip(): Promise<vscode.MarkdownString> {
    if (bossMode) {
      const md = new vscode.MarkdownString();
      md.appendMarkdown(`*老板模式已开启，行情已隐藏*\n\n按 \`Ctrl+Alt+L\` 恢复显示`);
      return md;
    }
    const q = this.quote;
    const md = new vscode.MarkdownString();
    md.supportHtml = true;
    const sign = q.change > 0 ? '+' : '';
    md.appendMarkdown(`### ${q.name} (${q.code})\n\n`);
    const trends = await fetchTrends(q.secid);
    if (trends) {
      md.appendMarkdown(sparklineSvg(trends.points, trends.preClose));
      md.appendMarkdown('\n\n');
    }
    const detail = await fetchDetail(q.secid);
    md.appendMarkdown('| 指标 | 数值 |\n|---|---|\n');
    md.appendMarkdown(`| 最新价 | ${fmtPrice(q.price)} |\n`);
    md.appendMarkdown(`| 涨跌 | ${sign}${fmtPrice(q.change)} (${sign}${q.changePct.toFixed(2)}%) |\n`);
    if (detail?.turnover != null) { md.appendMarkdown(`| 换手率 | ${detail.turnover.toFixed(2)}% |\n`); }
    if (detail?.pe != null) { md.appendMarkdown(`| 市盈率(动) | ${detail.pe.toFixed(2)} |\n`); }
    if (detail?.pb != null) { md.appendMarkdown(`| 市净率 | ${detail.pb.toFixed(2)} |\n`); }
    if (detail?.totalMv != null) { md.appendMarkdown(`| 总市值 | ${fmtYi(detail.totalMv)} |\n`); }
    if (detail?.floatMv != null) { md.appendMarkdown(`| 流通市值 | ${fmtYi(detail.floatMv)} |\n`); }
    if (detail?.mainInflow != null) {
      md.appendMarkdown(`| 主力净流入 | ${detail.mainInflow > 0 ? '+' : ''}${fmtYi(detail.mainInflow)} |\n`);
    }
    md.appendMarkdown(`| 今开 | ${fmtPrice(q.open)} |\n| 最高 | ${fmtPrice(q.high)} |\n| 最低 | ${fmtPrice(q.low)} |\n| 昨收 | ${fmtPrice(q.preClose)} |\n`);
    md.appendMarkdown(`| 成交量 | ${fmtVolume(q)} |\n| 成交额 | ${fmtAmount(q)} |\n`);
    md.appendMarkdown(`\n*灰虚线=均价 · 黑虚线=昨收 · 来源：东方财富*\n`);
    return md;
  }
}

/** 万亿格式化（tooltip 估值用） */
function fmtYi(v: number): string {
  return v >= 1e8 ? `${(v / 1e8).toFixed(2)}亿` : v >= 1e4 ? `${(v / 1e4).toFixed(2)}万` : String(v);
}

export class GroupTreeItem extends vscode.TreeItem {
  constructor(
    public readonly title: string,
    public readonly count: number,
    public readonly avgPct: number | null,
    public readonly upCount: number,
    public readonly downCount: number,
    public readonly children: StockTreeItem[],
  ) {
    super('', vscode.TreeItemCollapsibleState.Expanded);
    this.label = title;
    this.description = bossMode
      ? `${count} 只`
      : `${count} 只  ${avgPct !== null ? `${avgPct > 0 ? '+' : ''}${avgPct.toFixed(2)}%` : ''}  ${upCount}红${downCount}绿`;
    this.contextValue = 'group';
    this.children = children;
  }
}

const GROUP_ORDER: { title: string; match: (q: Quote) => boolean }[] = [
  { title: '指数', match: (q) => isIndex(q) },
  { title: 'A股', match: (q) => (q.market === 0 || q.market === 1) && !isIndex(q) },
  { title: '港股', match: (q) => q.market === 116 },
  { title: '美股', match: (q) => q.market === 105 },
];

const INDEX_SECIDS = new Set(['1.000001', '0.399001', '0.399006', '1.000300', '1.000688', '0.399005', '1.000016', '0.399852', '1.000905', '0.399303']);

function isIndex(q: Quote): boolean {
  return INDEX_SECIDS.has(q.secid);
}

export type SortMode = 'change' | 'code' | 'name' | 'added';

export const SORT_LABELS: Record<SortMode, string> = {
  change: '按涨跌幅（降序）',
  code: '按代码',
  name: '按名称',
  added: '按添加顺序',
};

export class StockTreeDataProvider implements vscode.TreeDataProvider<StockTreeItem | GroupTreeItem>, vscode.TreeDragAndDropController<StockTreeItem> {
  dropMimeTypes = ['application/vnd.code.tree.stockWatchTreeView'];
  dragMimeTypes = ['application/vnd.code.tree.stockWatchTreeView'];

  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private indexQuotes: Quote[] = [];
  private stockQuotes: Quote[] = [];
  private pinnedSet = new Set<string>();
  private groups: GroupTreeItem[] = [];
  private sortMode: SortMode = 'change';
  private orderMap = new Map<string, number>();
  /** 拖拽自定义顺序：secid -> 序号；有记录的股票组内按此序排最前段 */
  private manualOrder = new Map<string, number>();

  onDidChangePinnedOrder?: (secids: string[]) => void;

  setPinned(secids: string[]) {
    this.pinnedSet = new Set(secids);
    this.rebuild();
  }

  setBossModeView() {
    this.rebuild();
  }

  setSortMode(mode: SortMode, orderMap: Map<string, number>) {
    this.sortMode = mode;
    this.orderMap = orderMap;
    this.rebuild();
  }

  getSortMode(): SortMode {
    return this.sortMode;
  }

  setManualOrder(order: Map<string, number>) {
    this.manualOrder = order;
    this.rebuild();
  }

  update(indexQuotes: Quote[], stockQuotes: Quote[]) {
    this.indexQuotes = indexQuotes;
    this.stockQuotes = stockQuotes;
    this.rebuild();
  }

  /** 取某只股票最近一次行情（详情面板打底用） */
  getQuote(secid: string): Quote | undefined {
    return this.stockQuotes.find((q) => q.secid === secid)
      ?? this.indexQuotes.find((q) => q.secid === secid);
  }

  /** 拖拽：记录被拖股票的新顺序（组内相对顺序） */
  public async handleDrop(
    target: StockTreeItem | GroupTreeItem | undefined,
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const mimeType = 'application/vnd.code.tree.stockWatchTreeView';
    const item = dataTransfer.get(mimeType);
    if (!item || bossMode) { return; }
    // value 是 JSON 字符串数组，元素为 tree item handle（如 stockWatchTreeView/1.600519）
    let handles: string[] = [];
    try {
      const parsed = JSON.parse(item.value);
      handles = Array.isArray(parsed) ? parsed : [String(parsed)];
    } catch {
      return;
    }
    const secids = handles.map((h) => String(h).split('/').pop() || '').filter(Boolean);
    if (!secids.length) { return; }

    if (target instanceof StockTreeItem) {
      const group = this.groups.find((g) => g.children.some((c) => c.quote.secid === target.quote.secid));
      if (!group) { return; }
      const current = group.children.map((c) => c.quote.secid).filter((s) => !secids.includes(s));
      const tIdx = current.indexOf(target.quote.secid);
      current.splice(tIdx < 0 ? current.length : tIdx, 0, ...secids);
      this.applyManualOrder(current);
    } else if (target instanceof GroupTreeItem) {
      const current = groupChildrenAll(target).filter((s) => !secids.includes(s));
      current.push(...secids);
      this.applyManualOrder(current);
    }
  }

  private applyManualOrder(secids: string[]) {
    secids.forEach((s, i) => this.manualOrder.set(s, i));
    this.onDidChangePinnedOrder?.([...this.manualOrder.keys()].filter((s) => this.stockQuotes.some((q) => q.secid === s)));
    this.rebuild();
  }

  /** 组内排序：手动拖过 > 置顶 > 当前模式 */
  private sortQuotes(list: Quote[]): Quote[] {
    const arr = [...list];
    const manual = new Set([...this.manualOrder.keys()].filter((s) => arr.some((q) => q.secid === s)));
    arr.sort((a, b) => {
      const ma = manual.has(a.secid) ? 1 : 0;
      const mb = manual.has(b.secid) ? 1 : 0;
      if (ma !== mb) { return mb - ma; }
      if (ma === 1) { return (this.manualOrder.get(a.secid) ?? 0) - (this.manualOrder.get(b.secid) ?? 0); }
      const pa = this.pinnedSet.has(a.secid) ? 1 : 0;
      const pb = this.pinnedSet.has(b.secid) ? 1 : 0;
      if (pa !== pb) { return pb - pa; }
      switch (this.sortMode) {
        case 'change': return b.changePct - a.changePct;
        case 'code': return a.code.localeCompare(b.code);
        case 'name': return a.name.localeCompare(b.name, 'zh-Hans-CN');
        case 'added': return (this.orderMap.get(a.secid) ?? 9999) - (this.orderMap.get(b.secid) ?? 9999);
      }
    });
    return arr;
  }

  private rebuild() {
    const all = [...this.indexQuotes, ...this.stockQuotes];
    const buckets = new Map<string, Quote[]>();
    for (const q of all) {
      const g = GROUP_ORDER.find((x) => x.match(q));
      const key = g ? g.title : '其他';
      if (!buckets.has(key)) { buckets.set(key, []); }
      buckets.get(key)!.push(q);
    }
    this.groups = [];
    for (const g of GROUP_ORDER) {
      const list = buckets.get(g.title);
      if (!list || !list.length) { continue; }
      const sorted = this.sortQuotes(list);
      const idxSet = new Set(this.indexQuotes);
      const items = sorted.map((q) => new StockTreeItem(q, idxSet.has(q) ? 'index' : 'stock', this.pinnedSet.has(q.secid)));
      const avg = list.reduce((s, q) => s + q.changePct, 0) / list.length;
      const up = list.filter((q) => q.changePct > 0).length;
      const down = list.filter((q) => q.changePct < 0).length;
      this.groups.push(new GroupTreeItem(g.title, list.length, avg, up, down, items));
    }
    this._onDidChange.fire();
  }

  getTreeItem(element: StockTreeItem | GroupTreeItem): vscode.TreeItem {
    if (element instanceof StockTreeItem && !element.tooltip) {
      // 异步 tooltip：先放占位，resolve 后再 fire
      void element.resolveTooltip().then((md) => {
        element.tooltip = md;
        this._onDidChange.fire();
      });
      element.tooltip = new vscode.MarkdownString('加载中…');
    }
    return element;
  }

  getChildren(element?: StockTreeItem | GroupTreeItem): vscode.ProviderResult<(StockTreeItem | GroupTreeItem)[]> {
    if (!element) { return this.groups; }
    if (element instanceof GroupTreeItem) { return element.children; }
    return [];
  }
}

function groupChildrenAll(g: GroupTreeItem): string[] {
  return g.children.map((c) => c.quote.secid);
}
