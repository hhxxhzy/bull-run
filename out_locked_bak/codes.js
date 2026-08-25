"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseInput = parseInput;
exports.guessAMarket = guessAMarket;
exports.searchStocks = searchStocks;
function parseInput(raw) {
    const input = raw.trim().toLowerCase();
    if (!input) {
        return null;
    }
    // 已是 secid 格式
    const secidMatch = input.match(/^(\d{1,3})\.([a-z0-9]{1,6})$/);
    if (secidMatch) {
        return {
            secid: input,
            code: secidMatch[2].toUpperCase(),
            market: Number(secidMatch[1]),
        };
    }
    // 带市场前缀
    const prefixMatch = input.match(/^(sh|sz|bj|hk|us)([a-z0-9]+)$/);
    if (prefixMatch) {
        const prefix = prefixMatch[1];
        const code = prefixMatch[2].toUpperCase();
        const marketMap = { sh: 1, sz: 0, bj: 0, hk: 116, us: 105 };
        const market = marketMap[prefix];
        // A股补齐 6 位
        if (market === 1 || market === 0) {
            if (/^\d{1,6}$/.test(code)) {
                return { secid: `${market}.${code.padStart(6, '0')}`, code: code.padStart(6, '0'), market };
            }
            return null;
        }
        return { secid: `${market}.${code}`, code, market };
    }
    // 纯 6 位数字 → A股（沪/深自动判断）
    if (/^\d{6}$/.test(input)) {
        const market = guessAMarket(input);
        return { secid: `${market}.${input}`, code: input, market };
    }
    // 纯数字 1-5 位 → 港股
    if (/^\d{1,5}$/.test(input)) {
        const code = input.padStart(5, '0');
        return { secid: `116.${code}`, code, market: 116 };
    }
    // 1-6 位字母 → 美股
    if (/^[a-z.]{1,7}$/.test(input)) {
        const code = input.toUpperCase();
        return { secid: `105.${code}`, code, market: 105 };
    }
    return null;
}
/** 6 位代码猜测沪/深：60/68/9/51/56/58 开头沪市，其余深市 */
function guessAMarket(code) {
    if (/^(60|68|9|51|56|58)/.test(code)) {
        return 1;
    }
    return 0;
}
/** 东财搜索接口模糊搜索（支持拼音/代码/名称） */
async function searchStocks(keyword) {
    const url = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(keyword)}&type=14&count=12`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) {
        throw new Error(`搜索接口异常 HTTP ${res.status}`);
    }
    const json = await res.json();
    const list = json?.QuotationCodeTable?.Data;
    if (!Array.isArray(list)) {
        return [];
    }
    const out = [];
    for (const it of list) {
        const market = Number(it.MktNum);
        const code = String(it.Code || '').toUpperCase();
        if (!code || Number.isNaN(market)) {
            continue;
        }
        out.push({
            code,
            name: it.Name,
            secid: `${market}.${code}`,
            market,
            type: String(it.SecurityTypeName || ''),
        });
    }
    return out;
}
//# sourceMappingURL=codes.js.map