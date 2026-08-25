"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchOrderBook = fetchOrderBook;
exports.fetchTicks = fetchTicks;
exports.panelChartSvg = panelChartSvg;
exports.buildPanelHtml = buildPanelHtml;
function num(v) {
    if (v === '-' || v === undefined || v === null || v === '') {
        return null;
    }
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
const OB_URL = 'https://push2.eastmoney.com/api/qt/stock/get';
/** 五档盘口（收盘后字段为空，做兜底） */
async function fetchOrderBook(secid) {
    try {
        const url = `${OB_URL}?secid=${secid}&invt=2&fltt=2&fields=f31,f32,f33,f34,f35,f36,f37,f38,f39,f40,f41,f42,f19,f20,f17,f18,f15,f16,f13,f14`;
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!res.ok) {
            return null;
        }
        const d = (await res.json())?.data;
        if (!d) {
            return null;
        }
        const asks = [
            { price: num(d.f39), volume: num(d.f40) }, // 卖1
            { price: num(d.f37), volume: num(d.f38) }, // 卖2
            { price: num(d.f35), volume: num(d.f36) }, // 卖3
            { price: num(d.f33), volume: num(d.f34) }, // 卖4
            { price: num(d.f31), volume: num(d.f32) }, // 卖5
        ];
        const bids = [
            { price: num(d.f41), volume: num(d.f42) }, // 买1
            { price: num(d.f19), volume: num(d.f20) }, // 买2
            { price: num(d.f17), volume: num(d.f18) }, // 买3
            { price: num(d.f15), volume: num(d.f16) }, // 买4
            { price: num(d.f13), volume: num(d.f14) }, // 买5
        ];
        const empty = [...asks, ...bids].every((l) => l.price === null);
        if (empty) {
            return null;
        }
        return { asks, bids };
    }
    catch {
        return null;
    }
}
/** 逐笔成交（最近 N 笔，pos=-N） */
async function fetchTicks(secid, count = 30) {
    try {
        const url = `https://push2.eastmoney.com/api/qt/stock/details/get?secid=${secid}&fields1=f1,f2,f3,f4&fields2=f51,f52,f53,f54,f55&pos=-${count}`;
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!res.ok) {
            return [];
        }
        const arr = (await res.json())?.data?.details;
        if (!Array.isArray(arr)) {
            return [];
        }
        return arr.map((s) => {
            const [time, p, v, , bs] = s.split(',');
            return { time, price: Number(p), volume: Number(v), bs: Number(bs) === 2 ? 2 : 1 };
        }).filter((t) => Number.isFinite(t.price)).reverse(); // 新的在最上
    }
    catch {
        return [];
    }
}
/** 分时 SVG（面板大图版：面积渐变 + 均价虚线 + 昨收参考线） */
function panelChartSvg(points, preClose) {
    const W = 640, H = 220, PAD = 34;
    const prices = points.map((p) => p.price).concat([preClose]);
    const min = Math.min(...prices), max = Math.max(...prices);
    const span = (max - min) || 1;
    const x = (i) => PAD + (i / (points.length - 1)) * (W - PAD * 2);
    const y = (v) => PAD + (1 - (v - min) / span) * (H - PAD * 2);
    const up = points[points.length - 1].price >= preClose;
    const lc = up ? '#e24b4a' : '#1d9e75';
    const poly = points.map((p, i) => `${x(i).toFixed(1)},${y(p.price).toFixed(1)}`).join(' ');
    const avgPoly = points.map((p, i) => `${x(i).toFixed(1)},${y(p.avg).toFixed(1)}`).join(' ');
    const preY = y(preClose);
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:220px">
  <defs>
    <linearGradient id="areaG" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${lc}" stop-opacity="0.22"/>
      <stop offset="1" stop-color="${lc}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect x="${PAD}" y="${PAD}" width="${W - PAD * 2}" height="${H - PAD * 2}" fill="url(#areaG)"/>
  <polyline points="${poly}" fill="none" stroke="${lc}" stroke-width="1.8"/>
  <polyline points="${avgPoly}" fill="none" stroke="#999" stroke-width="1" stroke-dasharray="4,3"/>
  <line x1="${PAD}" y1="${preY.toFixed(1)}" x2="${W - PAD}" y2="${preY.toFixed(1)}" stroke="#777" stroke-width="0.8" stroke-dasharray="6,4"/>
  <text x="${PAD}" y="${PAD - 8}" font-size="11" fill="${lc}">${max.toFixed(2)}</text>
  <text x="${PAD}" y="${(preY - 6).toFixed(1)}" font-size="11" fill="#777">昨收 ${preClose.toFixed(2)}</text>
  <text x="${PAD}" y="${H - 8}" font-size="11" fill="#777">${min.toFixed(2)}</text>
  <text x="${PAD}" y="${H - PAD + 16}" font-size="11" fill="#777">9:30</text>
  <text x="${(W / 2 - 14).toFixed(0)}" y="${H - PAD + 16}" font-size="11" fill="#777">11:30/13:00</text>
  <text x="${(W - PAD - 24).toFixed(0)}" y="${H - PAD + 16}" font-size="11" fill="#777">15:00</text>
</svg>`;
}
/** 组装 Webview HTML（自包含，跟随 VS Code 主题变量） */
function buildPanelHtml(q, trends, ob, ticks) {
    const sign = q.change >= 0 ? '+' : '';
    const cls = q.change >= 0 ? 'up' : 'down';
    const RED = '#e24b4a', GREEN = '#1d9e75';
    let chartSvg = '<div class="empty">分时数据加载中…</div>';
    if (trends && trends.points.length > 1) {
        chartSvg = panelChartSvg(trends.points, trends.preClose);
    }
    const lvlRow = (l, label) => {
        const c = l.price !== null && l.price >= q.preClose ? RED : GREEN;
        return `<tr><td class="tag">${label}</td><td class="p" style="color:${c}">${l.price !== null ? l.price.toFixed(2) : '--'}</td><td class="v">${l.volume !== null ? l.volume : '--'}</td></tr>`;
    };
    let obHtml = '<div class="empty">暂无盘口数据（收盘后五档清空）</div>';
    if (ob) {
        const askRows = ob.asks.map((l, i) => lvlRow(l, `卖${5 - i}`)).join('');
        const bidRows = ob.bids.map((l, i) => lvlRow(l, `买${i + 1}`)).join('');
        obHtml = `<table class="ob">${askRows}<tr class="mid"><td colspan="3"></td></tr>${bidRows}</table>`;
    }
    let ticksHtml = '<div class="empty">暂无逐笔数据</div>';
    if (ticks.length) {
        const rows = ticks.map((t) => {
            const c = t.price >= q.preClose ? RED : GREEN;
            const bs = t.bs === 2 ? `<span class="b">B</span>` : `<span class="s">S</span>`;
            return `<tr><td class="t">${t.time}</td><td class="p" style="color:${c}">${t.price.toFixed(2)}</td><td class="v">${t.volume}</td><td>${bs}</td></tr>`;
        }).join('');
        ticksHtml = `<table class="ticks">${rows}</table>`;
    }
    const updated = new Date(q.time * 1000).toLocaleTimeString('zh-CN');
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px 16px; background: var(--vscode-editor-background); margin: 0; }
  h1 { font-size: 16px; margin: 0; display: inline; }
  .up { color: ${RED}; }
  .down { color: ${GREEN}; }
  .head { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; margin-bottom: 10px; }
  .price { font-size: 30px; font-weight: 700; }
  .meta { font-size: 12px; opacity: 0.75; }
  .panel { border: 1px solid var(--vscode-panel-border, #333); border-radius: 8px; padding: 10px 14px; margin-bottom: 14px; }
  .panel h2 { font-size: 13px; margin: 0 0 8px; opacity: 0.85; font-weight: 600; }
  .empty { padding: 18px 0; text-align: center; opacity: 0.55; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  td { padding: 3px 6px; font-size: 12px; }
  .ob .tag { opacity: 0.7; width: 40px; }
  .ob .p { text-align: right; font-weight: 600; }
  .ob .v { text-align: right; opacity: 0.8; width: 64px; }
  .ob .mid td { height: 6px; }
  .ticks .t { opacity: 0.7; }
  .ticks .p { text-align: right; font-weight: 600; }
  .ticks .v { text-align: right; opacity: 0.8; }
  .b { color: ${RED}; font-weight: 700; }
  .s { color: ${GREEN}; font-weight: 700; }
  .live-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #4cc2ff; margin-right: 5px; animation: blink 1.2s infinite; }
  @keyframes blink { 50% { opacity: 0.25; } }
  .tick-wrap { max-height: 280px; overflow-y: auto; }
</style>
</head>
<body>
  <div class="head">
    <h1>${q.name}</h1>
    <span class="meta">${q.code}</span>
    <span class="price ${cls}">${q.price.toFixed(2)}</span>
    <span class="${cls}" style="font-size:15px;font-weight:600">${sign}${q.change.toFixed(2)} (${sign}${q.changePct.toFixed(2)}%)</span>
    <span class="meta">今开 ${q.open.toFixed(2)} · 最高 ${q.high.toFixed(2)} · 最低 ${q.low.toFixed(2)} · 昨收 ${q.preClose.toFixed(2)}</span>
  </div>

  <div class="panel">
    <h2>分时走势</h2>
    ${chartSvg}
  </div>

  <div style="display:flex;gap:14px;flex-wrap:wrap">
    <div class="panel" style="flex:1 1 220px">
      <h2>五档盘口</h2>
      ${obHtml}
    </div>
    <div class="panel" style="flex:1 1 320px">
      <h2><span class="live-dot"></span>实时逐笔</h2>
      <div class="tick-wrap">${ticksHtml}</div>
    </div>
  </div>

  <div class="meta" style="opacity:0.5;font-size:11px;margin-top:4px">数据来源：东方财富 · 更新于 ${updated}</div>
</body>
</html>`;
}
//# sourceMappingURL=detailpanel.js.map