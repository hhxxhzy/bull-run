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
exports.StockTreeDataProvider = exports.SORT_LABELS = exports.GroupTreeItem = exports.StockTreeItem = void 0;
exports.setBossMode = setBossMode;
/**
 * 树视图 Provider：按市场分组
 * v0.7：tooltip 嵌分时 sparkline + 估值；无行展开（详情走右键大面板）；拖拽排序
 */
const vscode = __importStar(require("vscode"));
const fetcher_1 = require("./fetcher");
const trends_1 = require("./trends");
let bossMode = false;
function setBossMode(on) {
    bossMode = on;
}
function mask(s) {
    return bossMode ? '••••' : s;
}
function maskNum(n) {
    return bossMode ? '–.––' : n;
}
class StockTreeItem extends vscode.TreeItem {
    constructor(quote, kind, pinned = false) {
        // 无展开子节点：详情走右键"查看详情"大面板
        super('', vscode.TreeItemCollapsibleState.None);
        this.quote = quote;
        this.kind = kind;
        const sign = quote.changePct > 0 ? '+' : '';
        this.label = mask(quote.name);
        this.description = `${maskNum((0, fetcher_1.fmtPrice)(quote.price))}  ${maskNum(sign + (0, fetcher_1.fmtPrice)(quote.change))}  ${maskNum(sign + quote.changePct.toFixed(2) + '%')}`;
        this.tooltip = undefined; // 异步填充
        this.contextValue = kind === 'stock' ? (pinned ? 'stock_pinned' : 'stock') : 'index';
        this.iconPath = undefined; // 无图标，去杂
    }
    /** 悬停时异步构建：分时 sparkline + 行情表 + 估值 */
    async resolveTooltip() {
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
        const trends = await (0, trends_1.fetchTrends)(q.secid);
        if (trends) {
            md.appendMarkdown((0, trends_1.sparklineSvg)(trends.points, trends.preClose));
            md.appendMarkdown('\n\n');
        }
        const detail = await (0, fetcher_1.fetchDetail)(q.secid);
        md.appendMarkdown('| 指标 | 数值 |\n|---|---|\n');
        md.appendMarkdown(`| 最新价 | ${(0, fetcher_1.fmtPrice)(q.price)} |\n`);
        md.appendMarkdown(`| 涨跌 | ${sign}${(0, fetcher_1.fmtPrice)(q.change)} (${sign}${q.changePct.toFixed(2)}%) |\n`);
        if (detail?.turnover != null) {
            md.appendMarkdown(`| 换手率 | ${detail.turnover.toFixed(2)}% |\n`);
        }
        if (detail?.pe != null) {
            md.appendMarkdown(`| 市盈率(动) | ${detail.pe.toFixed(2)} |\n`);
        }
        if (detail?.pb != null) {
            md.appendMarkdown(`| 市净率 | ${detail.pb.toFixed(2)} |\n`);
        }
        if (detail?.totalMv != null) {
            md.appendMarkdown(`| 总市值 | ${fmtYi(detail.totalMv)} |\n`);
        }
        if (detail?.floatMv != null) {
            md.appendMarkdown(`| 流通市值 | ${fmtYi(detail.floatMv)} |\n`);
        }
        if (detail?.mainInflow != null) {
            md.appendMarkdown(`| 主力净流入 | ${detail.mainInflow > 0 ? '+' : ''}${fmtYi(detail.mainInflow)} |\n`);
        }
        md.appendMarkdown(`| 今开 | ${(0, fetcher_1.fmtPrice)(q.open)} |\n| 最高 | ${(0, fetcher_1.fmtPrice)(q.high)} |\n| 最低 | ${(0, fetcher_1.fmtPrice)(q.low)} |\n| 昨收 | ${(0, fetcher_1.fmtPrice)(q.preClose)} |\n`);
        md.appendMarkdown(`| 成交量 | ${(0, fetcher_1.fmtVolume)(q)} |\n| 成交额 | ${(0, fetcher_1.fmtAmount)(q)} |\n`);
        md.appendMarkdown(`\n*灰虚线=均价 · 黑虚线=昨收 · 来源：东方财富*\n`);
        return md;
    }
}
exports.StockTreeItem = StockTreeItem;
/** 万亿格式化（tooltip 估值用） */
function fmtYi(v) {
    return v >= 1e8 ? `${(v / 1e8).toFixed(2)}亿` : v >= 1e4 ? `${(v / 1e4).toFixed(2)}万` : String(v);
}
class GroupTreeItem extends vscode.TreeItem {
    constructor(title, count, avgPct, upCount, downCount, children) {
        super('', vscode.TreeItemCollapsibleState.Expanded);
        this.title = title;
        this.count = count;
        this.avgPct = avgPct;
        this.upCount = upCount;
        this.downCount = downCount;
        this.children = children;
        this.label = title;
        this.description = bossMode
            ? `${count} 只`
            : `${count} 只  ${avgPct !== null ? `${avgPct > 0 ? '+' : ''}${avgPct.toFixed(2)}%` : ''}  ${upCount}红${downCount}绿`;
        this.contextValue = 'group';
        this.children = children;
    }
}
exports.GroupTreeItem = GroupTreeItem;
const GROUP_ORDER = [
    { title: '指数', match: (q) => isIndex(q) },
    { title: 'A股', match: (q) => (q.market === 0 || q.market === 1) && !isIndex(q) },
    { title: '港股', match: (q) => q.market === 116 },
    { title: '美股', match: (q) => q.market === 105 },
];
const INDEX_SECIDS = new Set(['1.000001', '0.399001', '0.399006', '1.000300', '1.000688', '0.399005', '1.000016', '0.399852', '1.000905', '0.399303']);
function isIndex(q) {
    return INDEX_SECIDS.has(q.secid);
}
exports.SORT_LABELS = {
    change: '按涨跌幅（降序）',
    code: '按代码',
    name: '按名称',
    added: '按添加顺序',
};
class StockTreeDataProvider {
    constructor() {
        this.dropMimeTypes = ['application/vnd.code.tree.stockWatchTreeView'];
        this.dragMimeTypes = ['application/vnd.code.tree.stockWatchTreeView'];
        this._onDidChange = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChange.event;
        this.indexQuotes = [];
        this.stockQuotes = [];
        this.pinnedSet = new Set();
        this.groups = [];
        this.sortMode = 'change';
        this.orderMap = new Map();
        /** 拖拽自定义顺序：secid -> 序号；有记录的股票组内按此序排最前段 */
        this.manualOrder = new Map();
    }
    setPinned(secids) {
        this.pinnedSet = new Set(secids);
        this.rebuild();
    }
    setBossModeView() {
        this.rebuild();
    }
    setSortMode(mode, orderMap) {
        this.sortMode = mode;
        this.orderMap = orderMap;
        this.rebuild();
    }
    getSortMode() {
        return this.sortMode;
    }
    setManualOrder(order) {
        this.manualOrder = order;
        this.rebuild();
    }
    update(indexQuotes, stockQuotes) {
        this.indexQuotes = indexQuotes;
        this.stockQuotes = stockQuotes;
        this.rebuild();
    }
    /** 取某只股票最近一次行情（详情面板打底用） */
    getQuote(secid) {
        return this.stockQuotes.find((q) => q.secid === secid)
            ?? this.indexQuotes.find((q) => q.secid === secid);
    }
    /** 拖拽：记录被拖股票的新顺序（组内相对顺序） */
    async handleDrop(target, dataTransfer, _token) {
        const mimeType = 'application/vnd.code.tree.stockWatchTreeView';
        const item = dataTransfer.get(mimeType);
        if (!item || bossMode) {
            return;
        }
        // value 是 JSON 字符串数组，元素为 tree item handle（如 stockWatchTreeView/1.600519）
        let handles = [];
        try {
            const parsed = JSON.parse(item.value);
            handles = Array.isArray(parsed) ? parsed : [String(parsed)];
        }
        catch {
            return;
        }
        const secids = handles.map((h) => String(h).split('/').pop() || '').filter(Boolean);
        if (!secids.length) {
            return;
        }
        if (target instanceof StockTreeItem) {
            const group = this.groups.find((g) => g.children.some((c) => c.quote.secid === target.quote.secid));
            if (!group) {
                return;
            }
            const current = group.children.map((c) => c.quote.secid).filter((s) => !secids.includes(s));
            const tIdx = current.indexOf(target.quote.secid);
            current.splice(tIdx < 0 ? current.length : tIdx, 0, ...secids);
            this.applyManualOrder(current);
        }
        else if (target instanceof GroupTreeItem) {
            const current = groupChildrenAll(target).filter((s) => !secids.includes(s));
            current.push(...secids);
            this.applyManualOrder(current);
        }
    }
    applyManualOrder(secids) {
        secids.forEach((s, i) => this.manualOrder.set(s, i));
        this.onDidChangePinnedOrder?.([...this.manualOrder.keys()].filter((s) => this.stockQuotes.some((q) => q.secid === s)));
        this.rebuild();
    }
    /** 组内排序：手动拖过 > 置顶 > 当前模式 */
    sortQuotes(list) {
        const arr = [...list];
        const manual = new Set([...this.manualOrder.keys()].filter((s) => arr.some((q) => q.secid === s)));
        arr.sort((a, b) => {
            const ma = manual.has(a.secid) ? 1 : 0;
            const mb = manual.has(b.secid) ? 1 : 0;
            if (ma !== mb) {
                return mb - ma;
            }
            if (ma === 1) {
                return (this.manualOrder.get(a.secid) ?? 0) - (this.manualOrder.get(b.secid) ?? 0);
            }
            const pa = this.pinnedSet.has(a.secid) ? 1 : 0;
            const pb = this.pinnedSet.has(b.secid) ? 1 : 0;
            if (pa !== pb) {
                return pb - pa;
            }
            switch (this.sortMode) {
                case 'change': return b.changePct - a.changePct;
                case 'code': return a.code.localeCompare(b.code);
                case 'name': return a.name.localeCompare(b.name, 'zh-Hans-CN');
                case 'added': return (this.orderMap.get(a.secid) ?? 9999) - (this.orderMap.get(b.secid) ?? 9999);
            }
        });
        return arr;
    }
    rebuild() {
        const all = [...this.indexQuotes, ...this.stockQuotes];
        const buckets = new Map();
        for (const q of all) {
            const g = GROUP_ORDER.find((x) => x.match(q));
            const key = g ? g.title : '其他';
            if (!buckets.has(key)) {
                buckets.set(key, []);
            }
            buckets.get(key).push(q);
        }
        this.groups = [];
        for (const g of GROUP_ORDER) {
            const list = buckets.get(g.title);
            if (!list || !list.length) {
                continue;
            }
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
    getTreeItem(element) {
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
    getChildren(element) {
        if (!element) {
            return this.groups;
        }
        if (element instanceof GroupTreeItem) {
            return element.children;
        }
        return [];
    }
}
exports.StockTreeDataProvider = StockTreeDataProvider;
function groupChildrenAll(g) {
    return g.children.map((c) => c.quote.secid);
}
