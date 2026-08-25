"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FetchError = void 0;
exports.fetchDetail = fetchDetail;
exports.fetchQuotes = fetchQuotes;
exports.fmtVolume = fmtVolume;
exports.fmtAmount = fmtAmount;
exports.fmtPrice = fmtPrice;
exports.fmtTime = fmtTime;
const LIST_URL = 'https://push2.eastmoney.com/api/qt/ulist.np/get';
const FIELDS = 'f2,f3,f4,f5,f6,f12,f13,f14,f15,f16,f17,f18,f124';
/** 详情扩展：f9=PE动 f23=PB f20=总市值 f21=流通市值 f8=换手 f62=主力净流入 */
const DETAIL_FIELDS = 'f2,f12,f13,f14,f9,f23,f20,f21,f8,f62';
function num(v) {
    if (v === '-' || v === undefined || v === null || v === '') {
        return null;
    }
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
/** 单只股票详情（PE/PB/市值/换手/主力净流入），带 30s 缓存 */
const detailCache = new Map();
async function fetchDetail(secid) {
    const hit = detailCache.get(secid);
    if (hit && Date.now() - hit.ts < 30_000) {
        return hit.d;
    }
    try {
        const url = `${LIST_URL}?secids=${secid}&fields=${DETAIL_FIELDS}&fltt=2&invt=2`;
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!res.ok) {
            return null;
        }
        const json = await res.json();
        const d = json?.data?.diff?.[0];
        if (!d) {
            return null;
        }
        const detail = {
            pe: num(d.f9),
            pb: num(d.f23),
            totalMv: num(d.f20),
            floatMv: num(d.f21),
            turnover: num(d.f8),
            mainInflow: num(d.f62),
        };
        detailCache.set(secid, { d: detail, ts: Date.now() });
        return detail;
    }
    catch {
        return null;
    }
}
class FetchError extends Error {
}
exports.FetchError = FetchError;
async function fetchQuotes(secids) {
    if (!secids.length) {
        return [];
    }
    const url = `${LIST_URL}?secids=${secids.join(',')}&fields=${FIELDS}&fltt=2&invt=2`;
    let res;
    try {
        res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    }
    catch (e) {
        throw new FetchError(`网络请求失败：${e?.message || e}`);
    }
    if (!res.ok) {
        throw new FetchError(`行情接口异常 HTTP ${res.status}`);
    }
    const json = await res.json();
    const diff = json?.data?.diff;
    if (!Array.isArray(diff)) {
        return [];
    }
    return diff.map(parseQuote).filter((q) => q !== null);
}
function parseQuote(d) {
    try {
        const code = String(d.f12);
        const market = Number(d.f13);
        const name = String(d.f14 || code);
        // 东财用 "-" 表示停牌/无值
        const price = num(d.f2);
        if (price === null) {
            return null;
        }
        return {
            secid: `${market}.${code}`,
            code,
            market,
            name,
            price,
            change: num(d.f4) ?? 0,
            changePct: num(d.f3) ?? 0,
            high: num(d.f15) ?? price,
            low: num(d.f16) ?? price,
            open: num(d.f17) ?? price,
            preClose: num(d.f18) ?? price,
            volume: num(d.f5) ?? 0,
            amount: num(d.f6) ?? 0,
            time: num(d.f124) ?? Math.floor(Date.now() / 1000),
            valid: true,
        };
    }
    catch {
        return null;
    }
}
/** 格式化成交量：手 → 万/亿 */
function fmtVolume(quote) {
    const vol = quote.volume;
    if (vol >= 1e8) {
        return `${(vol / 1e8).toFixed(2)}亿`;
    }
    if (vol >= 1e4) {
        return `${(vol / 1e4).toFixed(2)}万`;
    }
    return String(vol);
}
/** 格式化成交额：元 → 万/亿 */
function fmtAmount(quote) {
    const amt = quote.amount;
    if (amt >= 1e8) {
        return `${(amt / 1e8).toFixed(2)}亿`;
    }
    if (amt >= 1e4) {
        return `${(amt / 1e4).toFixed(2)}万`;
    }
    return amt.toFixed(0);
}
function fmtPrice(p) {
    return p >= 1000 ? p.toFixed(1) : p.toFixed(2);
}
function fmtTime(ts) {
    const d = new Date(ts * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
//# sourceMappingURL=fetcher.js.map