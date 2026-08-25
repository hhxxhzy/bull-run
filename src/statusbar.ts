/**
 * 状态栏：多股置顶，每只一个格子，点击开详情
 */
import * as vscode from 'vscode';
import { Quote } from './types';
import { fmtPrice } from './fetcher';

let bossMode = false;
export function setStatusBarBossMode(on: boolean) { bossMode = on; }

export class StatusBarManager implements vscode.Disposable {
  /** 每只置顶股一个状态栏格子：secid -> item */
  private items = new Map<string, vscode.StatusBarItem>();
  /** 无置顶时的总入口兜底格 */
  private entryItem: vscode.StatusBarItem | undefined;
  private quotes: Quote[] = [];
  private pinned: string[] = [];
  private rotateIdx = 0;
  private rotateTimer: NodeJS.Timeout | undefined;
  private rotateItem: vscode.StatusBarItem | undefined;
  private rendered = false;

  /** 设置置顶列表（有序，先置顶的排前面） */
  setPinnedList(secids: string[]) {
    this.pinned = secids.filter((s, i, a) => a.indexOf(s) === i);
    this.render(true);
  }

  update(quotes: Quote[]) {
    this.quotes = quotes;
    this.render(false);
    this.setupRotate();
  }

  private quoteOf(secid: string): Quote | undefined {
    return this.quotes.find((q) => q.secid === secid);
  }

  /** 置顶列表为空时轮播所有自选 */
  private rotateCandidates(): Quote[] {
    return this.quotes.length ? this.quotes : [];
  }

  private render(recreate: boolean) {
    const enabled = vscode.workspace.getConfiguration('stockWatch').get<boolean>('showStatusBar', true);
    const align = this.align();

    // 老板模式：全部隐藏
    if (bossMode) {
      for (const it of this.items.values()) { it.hide(); }
      this.rotateItem?.hide();
      this.entryItem?.hide();
      this.disposeRotate();
      return;
    }

    if (recreate) {
      for (const item of this.items.values()) { item.dispose(); }
      this.items.clear();
    }

    if (!enabled) {
      for (const it of this.items.values()) { it.hide(); }
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
        } else {
          item.text = `$(loading~spin) ${secid}`;
          item.tooltip = '等待行情…';
          item.backgroundColor = undefined;
          item.show();
        }
      }
      // 移除不再置顶的
      for (const [secid, it] of this.items) {
        if (!this.pinned.includes(secid)) { it.dispose(); this.items.delete(secid); }
      }
      this.rendered = true;
      return;
    }

    // 无置顶 → 按模式：single 显示第一只 / rotate 轮播
    const mode = vscode.workspace.getConfiguration('stockWatch').get<string>('statusBarMode', 'single');
    if (!this.quotes.length) { return; }
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
  ensureEntry(quotes: Quote[]) {
    if (bossMode) { this.entryItem?.hide(); return; }
    const cfg = vscode.workspace.getConfiguration('stockWatch');
    const showTag = cfg.get<boolean>('showEntryTag', false);
    if (!showTag) { this.entryItem?.hide(); return; }
    const enabled = cfg.get<boolean>('showStatusBar', true);
    if (!enabled) { this.entryItem?.hide(); return; }
    // 有置顶股时隐藏兜底格（面板可从命令面板/键位进）
    if (this.pinned.length) { this.entryItem?.hide(); return; }
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

  private align(): vscode.StatusBarAlignment {
    return vscode.workspace.getConfiguration('stockWatch').get<string>('statusBarAlignment', 'right') === 'left'
      ? vscode.StatusBarAlignment.Left
      : vscode.StatusBarAlignment.Right;
  }

  private tooltipOf(q: Quote): string {
    const sign = q.change > 0 ? '+' : '';
    return `${q.name} ${fmtPrice(q.price)} ${sign}${q.change.toFixed(2)} (${sign}${q.changePct.toFixed(2)}%) — 点击换股票`;
  }

  private format(q: Quote): string {
    const pct = `${q.changePct > 0 ? '+' : ''}${q.changePct.toFixed(2)}%`;
    return `${q.name} ${fmtPrice(q.price)} ${pct}`;
  }

  private disposeRotate() {
    if (this.rotateTimer) { clearInterval(this.rotateTimer); this.rotateTimer = undefined; }
  }

  private setupRotate() {
    this.disposeRotate();
    if (!this.pinned.length) { return; }
    // 已用多格模式则无需轮播
  }

  dispose() {
    this.disposeRotate();
    for (const it of this.items.values()) { it.dispose(); }
    this.items.clear();
    this.rotateItem?.dispose();
    this.entryItem?.dispose();
  }
}
