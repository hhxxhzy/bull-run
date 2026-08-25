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
exports.StatusBarManager = void 0;
exports.setStatusBarBossMode = setStatusBarBossMode;
/**
 * 状态栏：多股置顶，每只一个格子，点击开详情
 */
const vscode = __importStar(require("vscode"));
const fetcher_1 = require("./fetcher");
let bossMode = false;
function setStatusBarBossMode(on) { bossMode = on; }
class StatusBarManager {
    /** 每只置顶股一个状态栏格子：secid -> item */
    items = new Map();
    /** 无置顶时的总入口兜底格 */
    entryItem;
    quotes = [];
    pinned = [];
    rotateIdx = 0;
    rotateTimer;
    rotateItem;
    rendered = false;
    /** 设置置顶列表（有序，先置顶的排前面） */
    setPinnedList(secids) {
        this.pinned = secids.filter((s, i, a) => a.indexOf(s) === i);
        this.render(true);
    }
    update(quotes) {
        this.quotes = quotes;
        this.render(false);
        this.setupRotate();
    }
    quoteOf(secid) {
        return this.quotes.find((q) => q.secid === secid);
    }
    /** 置顶列表为空时轮播所有自选 */
    rotateCandidates() {
        return this.quotes.length ? this.quotes : [];
    }
    render(recreate) {
        const enabled = vscode.workspace.getConfiguration('stockWatch').get('showStatusBar', true);
        const align = this.align();
        // 老板模式：全部隐藏
        if (bossMode) {
            for (const it of this.items.values()) {
                it.hide();
            }
            this.rotateItem?.hide();
            this.entryItem?.hide();
            this.disposeRotate();
            return;
        }
        if (recreate) {
            for (const item of this.items.values()) {
                item.dispose();
            }
            this.items.clear();
        }
        if (!enabled) {
            for (const it of this.items.values()) {
                it.hide();
            }
            this.disposeRotate();
            this.rotateItem?.hide();
            return;
        }
        // 多格模式：每只置顶股一个格子
        if (this.pinned.length) {
            this.entryItem?.hide();
            this.disposeRotate();
            this.rotateItem?.dispose();
            this.rotateItem = undefined;
            let priority = 1000;
            for (const secid of this.pinned) {
                const q = this.quoteOf(secid);
                let item = this.items.get(secid);
                if (!item) {
                    item = vscode.window.createStatusBarItem(align, priority--);
                    item.name = `Stock Watch: ${q?.name || secid}`;
                    item.command = {
                        title: '换股票',
                        command: 'stockWatch.switchStatusBarStock',
                        arguments: [secid],
                    };
                    this.items.set(secid, item);
                }
                if (q) {
                    item.text = this.format(q);
                    item.tooltip = this.tooltipOf(q);
                    item.command = { title: '换股票', command: 'stockWatch.switchStatusBarStock', arguments: [secid] };
                    item.backgroundColor = undefined;
                    item.show();
                }
                else {
                    item.text = `$(loading~spin) ${secid}`;
                    item.tooltip = '等待行情…';
                    item.backgroundColor = undefined;
                    item.show();
                }
            }
            // 移除不再置顶的
            for (const [secid, it] of this.items) {
                if (!this.pinned.includes(secid)) {
                    it.dispose();
                    this.items.delete(secid);
                }
            }
            this.rendered = true;
            return;
        }
        // 无置顶 → 按模式：single 显示第一只 / rotate 轮播
        const mode = vscode.workspace.getConfiguration('stockWatch').get('statusBarMode', 'single');
        if (!this.quotes.length) {
            return;
        }
        if (!this.rotateItem) {
            this.rotateItem = vscode.window.createStatusBarItem(align, 1000);
            this.rotateItem.name = 'Stock Watch';
        }
        const q = mode === 'rotate' ? this.quotes[this.rotateIdx % this.quotes.length] : this.quotes[0];
        this.rotateItem.text = this.format(q);
        this.rotateItem.tooltip = this.tooltipOf(q);
        this.rotateItem.command = { title: '换股票', command: 'stockWatch.switchStatusBarStock', arguments: [q.secid] };
        this.rotateItem.show();
        this.rendered = true;
    }
    /** 状态栏总入口兜底格：无置顶股时显示"自选股"按钮，点开 QuickPick 面板 */
    ensureEntry(quotes) {
        if (bossMode) {
            this.entryItem?.hide();
            return;
        }
        const cfg = vscode.workspace.getConfiguration('stockWatch');
        const showTag = cfg.get('showEntryTag', false);
        if (!showTag) {
            this.entryItem?.hide();
            return;
        }
        const enabled = cfg.get('showStatusBar', true);
        if (!enabled) {
            this.entryItem?.hide();
            return;
        }
        // 有置顶股时隐藏兜底格（面板可从命令面板/键位进）
        if (this.pinned.length) {
            this.entryItem?.hide();
            return;
        }
        if (!this.entryItem) {
            this.entryItem = vscode.window.createStatusBarItem(this.align(), 1001);
            this.entryItem.name = 'Stock Watch';
            this.entryItem.command = 'stockWatch.showPanel';
        }
        const n = quotes.length;
        this.entryItem.text = n ? `$(list-unordered) 自选股(${n})` : '$(list-unordered) 自选股';
        this.entryItem.tooltip = '点击打开自选股面板（排序/置顶/删除）';
        this.entryItem.show();
    }
    align() {
        return vscode.workspace.getConfiguration('stockWatch').get('statusBarAlignment', 'right') === 'left'
            ? vscode.StatusBarAlignment.Left
            : vscode.StatusBarAlignment.Right;
    }
    tooltipOf(q) {
        const sign = q.change > 0 ? '+' : '';
        return `${q.name} ${(0, fetcher_1.fmtPrice)(q.price)} ${sign}${q.change.toFixed(2)} (${sign}${q.changePct.toFixed(2)}%) — 点击换股票`;
    }
    format(q) {
        const pct = `${q.changePct > 0 ? '+' : ''}${q.changePct.toFixed(2)}%`;
        return `${q.name} ${(0, fetcher_1.fmtPrice)(q.price)} ${pct}`;
    }
    disposeRotate() {
        if (this.rotateTimer) {
            clearInterval(this.rotateTimer);
            this.rotateTimer = undefined;
        }
    }
    setupRotate() {
        this.disposeRotate();
        if (!this.pinned.length) {
            return;
        }
        // 已用多格模式则无需轮播
    }
    dispose() {
        this.disposeRotate();
        for (const it of this.items.values()) {
            it.dispose();
        }
        this.items.clear();
        this.rotateItem?.dispose();
        this.entryItem?.dispose();
    }
}
exports.StatusBarManager = StatusBarManager;
//# sourceMappingURL=statusbar.js.map