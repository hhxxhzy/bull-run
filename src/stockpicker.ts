/**
 * 自选股 QuickPick 面板：按今日涨跌幅排序，行内按钮置顶状态栏/删除，回车开详情
 */
import * as vscode from 'vscode';
import { Quote } from './types';
import { fmtPrice, fmtAmount } from './fetcher';

export interface PickerDeps {
  getQuotes(): Quote[];
  getPinned(): string[];
  isBossMode(): boolean;
  togglePin(secid: string): Promise<void>;
  remove(secid: string): Promise<void>;
  openDetail(q: Quote): void;
}

interface StockPickItem extends vscode.QuickPickItem {
  quote: Quote;
}

export async function showStockPicker(deps: PickerDeps) {
  let desc = true; // 涨幅降序
  const qp = vscode.window.createQuickPick<StockPickItem>();
  qp.placeholder = '回车打开行情详情 · 行内按钮：📌 置顶/移出状态栏，✕ 删除自选';
  qp.buttons = [{ iconPath: new vscode.ThemeIcon('arrow-swap'), tooltip: '切换排序（涨幅降序/升序）' }];

  const render = () => {
    const boss = deps.isBossMode();
    if (boss) {
      qp.title = `自选股 · 老板模式已开启（Ctrl+Alt+L 恢复）`;
      const n = deps.getQuotes().length;
      qp.items = [{ label: '$(eye-closed) 行情已隐藏', description: `${n} 只自选`, quote: null as any }];
      return;
    }
    const pinned = new Set(deps.getPinned());
    const quotes = [...deps.getQuotes()].sort((a, b) => (desc ? b.changePct - a.changePct : a.changePct - b.changePct));
    qp.title = `自选股 · 按今日涨幅${desc ? '降' : '升'}序（${quotes.length} 只）`;
    qp.items = quotes.map((q) => {
      const on = pinned.has(q.secid);
      const sign = q.changePct > 0 ? '+' : '';
      return {
        label: `${q.changePct > 0 ? '▲' : q.changePct < 0 ? '▼' : '—'} ${q.name}`,
        description: `${fmtPrice(q.price)}  ${sign}${q.changePct.toFixed(2)}%${on ? '  📌' : ''}`,
        detail: `${q.code} · 今开 ${fmtPrice(q.open)} · 高 ${fmtPrice(q.high)} · 低 ${fmtPrice(q.low)} · 昨收 ${fmtPrice(q.preClose)} · 额 ${fmtAmount(q)}`,
        quote: q,
        buttons: [
          { iconPath: new vscode.ThemeIcon(on ? 'pin-off' : 'pin'), tooltip: on ? '从状态栏移除' : '置顶到状态栏' },
          { iconPath: new vscode.ThemeIcon('close'), tooltip: '从自选删除' },
        ],
      } as StockPickItem;
    });
    if (!quotes.length) {
      qp.items = [{ label: '$(info) 暂无自选股', description: '按 Alt+S 或侧边栏 ＋ 添加', quote: null as any }];
    }
  };

  render();
  qp.show();

  return new Promise<void>((resolve) => {
    qp.onDidTriggerButton((b) => {
      if (b === qp.buttons[0]) { desc = !desc; render(); }
    });
    qp.onDidTriggerItemButton(async (e) => {
      const q = e.item.quote;
      if (!q) { return; }
      const idx = (e.item.buttons || []).indexOf(e.button as any);
      try {
        if (idx === 0) {
          await deps.togglePin(q.secid);
        } else {
          await deps.remove(q.secid);
        }
        render();
      } catch { /* 忽略 */ }
    });
    qp.onDidAccept(() => {
      const sel = qp.selectedItems[0];
      if (sel?.quote) { deps.openDetail(sel.quote); }
      qp.hide();
    });
    qp.onDidHide(() => { qp.dispose(); resolve(); });
  });
}

/**
 * 换股选择器：点击状态栏格子弹出，选中即替换该格子显示的股票
 */
export async function pickSwitchStock(quotes: Quote[], currentSecid: string | undefined): Promise<Quote | undefined> {
  if (!quotes.length) { return undefined; }
  const sorted = [...quotes].sort((a, b) => b.changePct - a.changePct);
  const items: (vscode.QuickPickItem & { quote: Quote })[] = sorted.map((q) => {
    const sign = q.changePct > 0 ? '+' : '';
    const cur = q.secid === currentSecid ? '$(pinned) ' : '';
    return {
      label: `${cur}${q.name}`,
      description: `${fmtPrice(q.price)}  ${sign}${q.changePct.toFixed(2)}%`,
      detail: `${q.code}${q.secid === currentSecid ? ' · 当前显示' : ''}`,
      quote: q,
    };
  });
  const sel = await vscode.window.showQuickPick(items, {
    placeHolder: '选择要显示在状态栏的股票（替换当前格子）',
    matchOnDescription: true,
    matchOnDetail: true,
  });
  return sel?.quote;
}
