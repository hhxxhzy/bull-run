/**
 * 分时数据：拉取 + tooltip 用的 SVG sparkline
 * trends2 接口每点格式："2026-08-21 09:30,1291.50,167,1291.500"（时间,价格,量,均价）
 */
import * as vscode from 'vscode';
import { Quote } from './types';

interface TrendsPoint { time: string; price: number; avg: number }

const cache = new Map<string, { data: TrendsPoint[]; preClose: number; ts: number }>();
const TTL = 60_000; // 60s 缓存，tooltip 悬停频繁

export async function fetchTrends(secid: string): Promise<{ points: { time: string; price: number; avg: number }[]; preClose: number } | null> {
  const hit = cache.get(secid);
  if (hit && Date.now() - hit.ts < TTL) {
    return { points: hit.data, preClose: hit.preClose };
  }
  try {
    const url = `https://push2his.eastmoney.com/api/qt/stock/trends2/get?secid=${secid}&fields1=f1,f2,f3,f7,f8&fields2=f51,f53,f56,f58&ndays=1&iscr=0`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) { return null; }
    const json: any = await res.json();
    const trends: string[] = json?.data?.trends;
    const preClose = Number(json?.data?.preClose);
    if (!Array.isArray(trends) || !trends.length || !Number.isFinite(preClose)) { return null; }
    const points: TrendsPoint[] = trends.map((s) => {
      const [time, p, , a] = s.split(',');
      return { time, price: Number(p), avg: Number(a) };
    }).filter((p) => Number.isFinite(p.price));
    cache.set(secid, { data: points, preClose, ts: Date.now() });
    return { points, preClose };
  } catch {
    return null;
  }
}

/** 生成 tooltip 嵌入用 SVG sparkline：价格线 + 均价线 + 昨收虚线，红涨绿跌 */
export function sparklineSvg(points: TrendsPoint[], preClose: number): string {
  const W = 280, H = 96, PAD = 8;
  if (points.length < 2) { return ''; }
  const prices = points.map((p) => p.price).concat([preClose]);
  const min = Math.min(...prices), max = Math.max(...prices);
  const span = max - min || 1;
  const x = (i: number) => PAD + (i / (points.length - 1)) * (W - PAD * 2);
  const y = (v: number) => PAD + (1 - (v - min) / span) * (H - PAD * 2);
  const up = points[points.length - 1].price >= preClose;
  const lineColor = up ? '#e24b4a' : '#1d9e75'; // 红涨绿跌
  const poly = points.map((p, i) => `${x(i).toFixed(1)},${y(p.price).toFixed(1)}`).join(' ');
  const avgPoly = points.map((p, i) => `${x(i).toFixed(1)},${y(p.avg).toFixed(1)}`).join(' ');
  const preY = y(preClose).toFixed(1);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="background:#00000010;border-radius:4px">
  <polyline points="${poly}" fill="none" stroke="${lineColor}" stroke-width="1.5"/>
  <polyline points="${avgPoly}" fill="none" stroke="#888" stroke-width="0.8" stroke-dasharray="3,2"/>
  <line x1="${PAD}" y1="${preY}" x2="${W - PAD}" y2="${preY}" stroke="#666" stroke-width="0.6" stroke-dasharray="4,3"/>
  <text x="${PAD + 2}" y="${PAD + 10}" font-size="9" fill="#888">高 ${max.toFixed(2)}</text>
  <text x="${W - PAD - 46}" y="${PAD + 10}" font-size="9" fill="#888" text-anchor="start">昨收 ${preClose.toFixed(2)}</text>
  <text x="${PAD + 2}" y="${H - PAD - 2}" font-size="9" fill="#888">低 ${min.toFixed(2)}</text>
</svg>`;
}

/** 组装带分时图的 tooltip markdown */
export async function buildDetailTooltip(q: Quote, detail?: StockDetail): Promise<vscode.MarkdownString> {
  const md = new vscode.MarkdownString();
  md.supportHtml = true;
  const sign = q.change > 0 ? '+' : '';
  md.appendMarkdown(`### ${q.name} (${q.code})\n\n`);
  const trends = await fetchTrends(q.secid);
  if (trends) {
    md.appendMarkdown(sparklineSvg(trends.points, trends.preClose));
    md.appendMarkdown('\n\n');
  }
  md.appendMarkdown('| 指标 | 数值 |\n|---|---|\n');
  md.appendMarkdown(`| 最新价 | ${q.price.toFixed(2)} |\n`);
  md.appendMarkdown(`| 涨跌 | ${sign}${q.change.toFixed(2)} (${sign}${q.changePct.toFixed(2)}%) |\n`);
  if (detail) {
    if (detail.pe != null) { md.appendMarkdown(`| 市盈率(动) | ${detail.pe.toFixed(2)} |\n`); }
    if (detail.pb != null) { md.appendMarkdown(`| 市净率 | ${detail.pb.toFixed(2)} |\n`); }
    if (detail.totalMv != null) { md.appendMarkdown(`| 总市值 | ${fmtYi(detail.totalMv)} |\n`); }
    if (detail.floatMv != null) { md.appendMarkdown(`| 流通市值 | ${fmtYi(detail.floatMv)} |\n`);
    }
    if (detail.turnover != null) { md.appendMarkdown(`| 换手率 | ${detail.turnover.toFixed(2)}% |\n`); }
    if (detail.mainInflow != null) { md.appendMarkdown(`| 主力净流入 | ${fmtYi(detail.mainInflow)} |\n`); }
  }
  md.appendMarkdown(`| 今开 | ${q.open.toFixed(2)} |\n| 最高 | ${q.high.toFixed(2)} |\n| 最低 | ${q.low.toFixed(2)} |\n| 昨收 | ${q.preClose.toFixed(2)} |\n`);
  md.appendMarkdown(`\n*▲涨 ▼跌 · 灰虚线=均价 · 黑虚线=昨收 · 来源：东方财富*\n`);
  return md;
}

export interface StockDetail {
  pe: number | null;
  pb: number | null;
  totalMv: number | null;
  floatMv: number | null;
  turnover: number | null;
  mainInflow: number | null;
}

function fmtYi(v: number): string {
  return v >= 1e8 ? `${(v / 1e8).toFixed(2)}亿` : v >= 1e4 ? `${(v / 1e4).toFixed(2)}万` : v.toFixed(0);
}
