/**
 * QuickPick 添加自选：先按输入精确解析，失败则走搜索
 */
import * as vscode from 'vscode';
import { StockItem } from './types';
import { parseInput, searchStocks } from './codes';

export async function pickStock(): Promise<StockItem | undefined> {
  const kw = await vscode.window.showInputBox({
    placeHolder: '输入代码 / 名称 / 拼音，如 600519、茅台、gzmt、hk00700、AAPL',
    prompt: '代码或带市场前缀直接回车添加；输入名称/拼音会自动搜索',
    ignoreFocusOut: true,
  });
  if (!kw) { return undefined; }

  const direct = parseInput(kw);
  if (direct) { return direct; }

  const candidates = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `搜索「${kw}」...` },
    () => searchStocks(kw),
  );
  if (!candidates.length) {
    vscode.window.showWarningMessage(`没有找到「${kw}」相关标的`);
    return undefined;
  }
  const picks = await vscode.window.showQuickPick(
    candidates.map((c) => ({ label: `$(symbol-parameter) ${c.name}`, description: c.code, detail: c.type, item: c })),
    { placeHolder: '选择要添加的标的', ignoreFocusOut: true },
  );
  if (!picks) { return undefined; }
  const c = picks.item;
  return { secid: c.secid, code: c.code, market: c.market };
}
