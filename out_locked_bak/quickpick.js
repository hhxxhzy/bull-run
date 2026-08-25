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
exports.pickStock = pickStock;
/**
 * QuickPick 添加自选：先按输入精确解析，失败则走搜索
 */
const vscode = __importStar(require("vscode"));
const codes_1 = require("./codes");
async function pickStock() {
    const kw = await vscode.window.showInputBox({
        placeHolder: '输入代码 / 名称 / 拼音，如 600519、茅台、gzmt、hk00700、AAPL',
        prompt: '代码或带市场前缀直接回车添加；输入名称/拼音会自动搜索',
        ignoreFocusOut: true,
    });
    if (!kw) {
        return undefined;
    }
    const direct = (0, codes_1.parseInput)(kw);
    if (direct) {
        return direct;
    }
    const candidates = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `搜索「${kw}」...` }, () => (0, codes_1.searchStocks)(kw));
    if (!candidates.length) {
        vscode.window.showWarningMessage(`没有找到「${kw}」相关标的`);
        return undefined;
    }
    const picks = await vscode.window.showQuickPick(candidates.map((c) => ({ label: `$(symbol-parameter) ${c.name}`, description: c.code, detail: c.type, item: c })), { placeHolder: '选择要添加的标的', ignoreFocusOut: true });
    if (!picks) {
        return undefined;
    }
    const c = picks.item;
    return { secid: c.secid, code: c.code, market: c.market };
}
//# sourceMappingURL=quickpick.js.map