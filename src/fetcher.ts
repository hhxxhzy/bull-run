/**
 * 行情拉取与解析（东方财富公开接口，UTF-8 JSON）
 * 批量接口实测字段：
 *  f2=最新价 f3=涨跌幅% f4=涨跌额 f5=成交量 f6=成交额
 *  f12=代码 f13=市场 f14=名称 f15=最高 f16=最低 f17=今开 f18=昨收 f124=时间戳(秒)
 */
import { Quote, StockItem } from './types';

const LIST_URL = 'https://push2.eastmoney.com/api/qt/ulist.np/get';
const FIELDS = 'f2,f3,f4,f5,f6,f12,f13,f14,f15,f16,f17,f18,f124';
/** 详情扩展：f9=PE动 f23=PB f20=总市值 f21=流通市值 f8=换手 f62=主力净流入 */
const DETAIL_FIELDS = 'f2,f12,f13,f14,f9,f23,f20,f21,f8,f62';

export interface StockDetail {
  pe: number | null;
  pb: number | null;
  totalMv: number | null;
  floatMv: number | null;
  turnover: number | null;
  mainInflow: number | null;
}

function num(v: any): number | null {
  if (v === '-' || v === undefined || v === null || v === '') { return null; }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 单只股票详情（PE/PB/市值/换手/主力净流入），带 30s 缓存 */
const detailCache = new Map<string, { d: StockDetail; ts: number }>();
export async function fetchDetail(secid: string): Promise<StockDetail | null> {
  const hit = detailCache.get(secid);
  if (hit && Date.now() - hit.ts < 30_000) { return hit.d; }
  try {
    const url = `${LIST_URL}?secids=${secid}&fields=${DETAIL_FIELDS}&fltt=2&invt=2`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) { return null; }
    const json: any = await res.json();
    const d = json?.data?.diff?.[0];
    if (!d) { return null; }
    const detail: StockDetail = {
      pe: num(d.f9),
      pb: num(d.f23),
      totalMv: num(d.f20),
      floatMv: num(d.f21),
      turnover: num(d.f8),
      mainInflow: num(d.f62),
    };
    detailCache.set(secid, { d: detail, ts: Date.now() });
    return detail;
  } catch {
    return null;
  }
}

export class FetchError extends Error {}

export async function fetchQuotes(secids: string[]): Promise<Quote[]> {
  if (!secids.length) { return []; }
  const url = `${LIST_URL}?secids=${secids.join(',')}&fields=${FIELDS}&fltt=2&invt=2`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  } catch (e: any) {
    throw new FetchError(`网络请求失败：${e?.message || e}`);
  }
  if (!res.ok) { throw new FetchError(`行情接口异常 HTTP ${res.status}`); }
  const json: any = await res.json();
  const diff = json?.data?.diff;
  if (!Array.isArray(diff)) { return []; }
  return diff.map(parseQuote).filter((q): q is Quote => q !== null);
}

function parseQuote(d: any): Quote | null {
  try {
    const code = String(d.f12);
    const market = Number(d.f13);
    const name = String(d.f14 || code);
    // 东财用 "-" 表示停牌/无值
    const price = num(d.f2);
    if (price === null) { return null; }
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
  } catch {
    return null;
  }
}

/** 格式化成交量：手 → 万/亿 */
export function fmtVolume(quote: Quote): string {
  const vol = quote.volume;
  if (vol >= 1e8) { return `${(vol / 1e8).toFixed(2)}亿`; }
  if (vol >= 1e4) { return `${(vol / 1e4).toFixed(2)}万`; }
  return String(vol);
}

/** 格式化成交额：元 → 万/亿 */
export function fmtAmount(quote: Quote): string {
  const amt = quote.amount;
  if (amt >= 1e8) { return `${(amt / 1e8).toFixed(2)}亿`; }
  if (amt >= 1e4) { return `${(amt / 1e4).toFixed(2)}万`; }
  return amt.toFixed(0);
}

export function fmtPrice(p: number): string {
  return p >= 1000 ? p.toFixed(1) : p.toFixed(2);
}

export function fmtTime(ts: number): string {
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
