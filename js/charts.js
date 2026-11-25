// Componentes gráficos: velas (Lightweight Charts), sparklines, medidor,
// anillos de puntaje y abanico Monte Carlo (SVG).
const C = {
  green: '#00e396',
  red: '#ff4d6a',
  gold: '#ffc857',
  violet: '#a78bfa',
  cyan: '#22d3ee',
  text: '#8b97ae',
  grid: 'rgba(255,255,255,0.05)',
};

let uid = 0;
const nextId = (p) => p + ++uid;

export function scoreColor(s) {
  return s >= 66 ? C.green : s <= 34 ? C.red : C.gold;
}

export function sparkline(values, { h = 36, color } = {}) {
  if (!values || values.length < 2) return '<div class="spark-empty"></div>';
  const w = 120;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const up = values[values.length - 1] >= values[0];
  const col = color || (up ? C.green : C.red);
  const id = nextId('sg');
  const d = values
    .map((v, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1)) * w).toFixed(1)} ${(h - 3 - ((v - min) / range) * (h - 6)).toFixed(1)}`)
    .join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" height="${h}" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${col}" stop-opacity=".35"/><stop offset="1" stop-color="${col}" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${d} L${w} ${h} L0 ${h} Z" fill="url(#${id})"/>
    <path d="${d}" fill="none" stroke="${col}" stroke-width="1.8" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
  </svg>`;
}

export function ring(score, { size = 48, stroke = 5 } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(100, score)) / 100);
  const col = scoreColor(score);
  const h = size / 2;
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Puntaje ${score} de 100">
    <circle cx="${h}" cy="${h}" r="${r}" stroke="rgba(255,255,255,.08)" stroke-width="${stroke}" fill="none"/>
    <circle cx="${h}" cy="${h}" r="${r}" stroke="${col}" stroke-width="${stroke}" fill="none" stroke-linecap="round"
      stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}" transform="rotate(-90 ${h} ${h})"
      style="filter:drop-shadow(0 0 5px ${col}99)"/>
    <text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" fill="#fff"
      font-size="${(size * 0.32).toFixed(0)}" font-weight="700" font-family="JetBrains Mono, monospace">${score}</text>
  </svg>`;
}

export function gauge(score, label) {
  const cx = 130;
  const cy = 120;
  const r = 100;
  const pt = (deg, rr = r) => [cx + rr * Math.cos((deg * Math.PI) / 180), cy - rr * Math.sin((deg * Math.PI) / 180)];
  const cols = ['#ff4d6a', '#ff8a4c', '#ffc857', '#7ee787', '#00e396'];
  const segs = cols.map((col, i) => {
    const a1 = 180 - i * 36 - (i ? 1.2 : 0);
    const a2 = 180 - (i + 1) * 36 + (i < 4 ? 1.2 : 0);
    const [x1, y1] = pt(a1);
    const [x2, y2] = pt(a2);
    return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${col}" stroke-width="16" fill="none" stroke-linecap="butt" opacity=".9"/>`;
  }).join('');
  const ticks = [0, 25, 50, 75, 100].map((v) => {
    const [x, y] = pt(180 - v * 1.8, r - 24);
    return `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" fill="${C.text}" font-size="10" font-family="JetBrains Mono, monospace">${v}</text>`;
  }).join('');
  const rot = (score / 100) * 180 - 90;
  const col = score < 40 ? C.red : score < 60 ? C.gold : C.green;
  return `<svg class="gauge" viewBox="0 0 260 200" role="img" aria-label="Pulso del mercado ${score} de 100, ${label}">
    <defs><filter id="gglow"><feGaussianBlur stdDeviation="6"/></filter></defs>
    <path d="M${cx - r} ${cy} A${r} ${r} 0 0 1 ${cx + r} ${cy}" stroke="rgba(255,255,255,.05)" stroke-width="30" fill="none"/>
    <g filter="url(#gglow)" opacity=".55">${segs}</g>
    ${segs}
    ${ticks}
    <g class="needle" style="transform-origin:${cx}px ${cy}px; transform: rotate(${rot}deg)">
      <path d="M${cx - 4} ${cy} L${cx} ${cy - r + 10} L${cx + 4} ${cy} Z" fill="#fff"/>
    </g>
    <circle cx="${cx}" cy="${cy}" r="9" fill="#0b1120" stroke="#fff" stroke-width="3"/>
    <text x="${cx}" y="${cy + 48}" text-anchor="middle" fill="#fff" font-size="30" font-weight="700"
      font-family="JetBrains Mono, monospace">${score}<tspan fill="${C.text}" font-size="13" font-weight="400">/100</tspan></text>
    <text x="${cx}" y="${cy + 72}" text-anchor="middle" fill="${col}" font-size="15" font-weight="700" letter-spacing="1.5"
      font-family="Space Grotesk, sans-serif">${label.toUpperCase()}</text>
  </svg>`;
}

// Abanico de escenarios Monte Carlo (percentiles 5-25-50-75-95)
export function fanChart(mc, price, { min = null, max = null, cur = '$', horizonLabel = '' } = {}) {
  const W = 340;
  const H = 190;
  const pl = 4;
  const pr = 84;
  const pt = 12;
  const pb = 22;
  const pts = [{ d: 0, p5: price, p25: price, p50: price, p75: price, p95: price }, ...mc.fan];
  let lo = Math.min(...pts.map((p) => p.p5));
  let hi = Math.max(...pts.map((p) => p.p95));
  if (min != null && min > lo * 0.85) lo = Math.min(lo, min);
  if (max != null && max < hi * 1.15) hi = Math.max(hi, max);
  const pad = (hi - lo) * 0.06;
  lo -= pad;
  hi += pad;
  const x = (d) => pl + (d / mc.days) * (W - pl - pr);
  const y = (v) => pt + (1 - (v - lo) / (hi - lo)) * (H - pt - pb);
  const band = (a, b) =>
    pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.d).toFixed(1)} ${y(p[a]).toFixed(1)}`).join(' ') + ' ' +
    pts.slice().reverse().map((p) => `L${x(p.d).toFixed(1)} ${y(p[b]).toFixed(1)}`).join(' ') + ' Z';
  const line = (k) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.d).toFixed(1)} ${y(p[k]).toFixed(1)}`).join(' ');
  const fmt = (v) => cur + (v >= 10000 ? Math.round(v).toLocaleString('en-US') : v.toFixed(v >= 1000 ? 0 : 2));
  const lastP = pts[pts.length - 1];
  const lbl = (v, col, txt) =>
    `<text x="${W - pr + 6}" y="${(y(v) + 4).toFixed(1)}" fill="${col}" font-size="10" font-family="JetBrains Mono, monospace">${txt} ${fmt(v)}</text>`;
  const level = (v, col, txt) =>
    v == null || v < lo || v > hi ? '' :
      `<line x1="${pl}" x2="${W - pr}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${col}" stroke-dasharray="4 4" stroke-width="1.2"/>
       <text x="${pl + 4}" y="${(y(v) - 4).toFixed(1)}" fill="${col}" font-size="9.5" font-family="JetBrains Mono, monospace">${txt} ${fmt(v)}</text>`;
  const id = nextId('fan');
  return `<svg class="fan" viewBox="0 0 ${W} ${H}" role="img" aria-label="Abanico de 1,000 escenarios simulados">
    <defs><linearGradient id="${id}" x1="0" x2="1"><stop offset="0" stop-color="${C.violet}" stop-opacity=".05"/><stop offset="1" stop-color="${C.violet}" stop-opacity=".28"/></linearGradient>
    <linearGradient id="${id}b" x1="0" x2="1"><stop offset="0" stop-color="${C.cyan}" stop-opacity=".1"/><stop offset="1" stop-color="${C.cyan}" stop-opacity=".42"/></linearGradient></defs>
    ${[0.25, 0.5, 0.75].map((g) => `<line x1="${pl}" x2="${W - pr}" y1="${pt + g * (H - pt - pb)}" y2="${pt + g * (H - pt - pb)}" stroke="${C.grid}"/>`).join('')}
    <path d="${band('p95', 'p5')}" fill="url(#${id})"/>
    <path d="${band('p75', 'p25')}" fill="url(#${id}b)"/>
    <line x1="${pl}" x2="${W - pr}" y1="${y(price).toFixed(1)}" y2="${y(price).toFixed(1)}" stroke="rgba(255,255,255,.35)" stroke-dasharray="2 4"/>
    <path d="${line('p50')}" fill="none" stroke="#fff" stroke-width="2"/>
    ${level(min, C.red, '🔻')}
    ${level(max, C.green, '🔺')}
    ${lbl(lastP.p95, C.green, '95%')}
    ${lbl(lastP.p50, '#fff', 'Med')}
    ${lbl(lastP.p5, C.red, ' 5%')}
    <text x="${pl}" y="${H - 6}" fill="${C.text}" font-size="10" font-family="Space Grotesk, sans-serif">Hoy</text>
    <text x="${W - pr}" y="${H - 6}" text-anchor="end" fill="${C.text}" font-size="10" font-family="Space Grotesk, sans-serif">${horizonLabel}</text>
  </svg>`;
}

// Gráfica simple de respaldo si la librería de velas no cargó (sin internet).
function fallbackLine(el, bars) {
  const closes = bars.slice(-126).map((b) => b.close);
  el.innerHTML = `<div class="chart-fallback">${sparkline(closes, { h: 240 })}</div>`;
}

// Gráfica principal de velas con medias móviles, volumen y líneas de alerta.
export function priceChart(el, bars, { sma50 = [], sma200 = [] } = {}) {
  const LW = window.LightweightCharts;
  if (!LW || !bars || !bars.length) {
    if (bars && bars.length) fallbackLine(el, bars);
    return { setRange() {}, update() {}, setLevels() {}, destroy() { el.innerHTML = ''; } };
  }
  const chart = LW.createChart(el, {
    autoSize: true,
    layout: { background: { type: 'solid', color: 'transparent' }, textColor: C.text, fontFamily: 'JetBrains Mono, monospace', fontSize: 10 },
    grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
    rightPriceScale: { borderColor: 'rgba(255,255,255,.08)' },
    timeScale: { borderColor: 'rgba(255,255,255,.08)', rightOffset: 3, fixLeftEdge: true },
    crosshair: { mode: LW.CrosshairMode.Normal },
    localization: { locale: 'es-MX' },
  });
  const candles = chart.addCandlestickSeries({
    upColor: C.green, downColor: C.red, borderVisible: false, wickUpColor: C.green, wickDownColor: C.red,
  });
  candles.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.22 } });
  const volume = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false });
  volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  const opt = { lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };
  const l50 = chart.addLineSeries({ ...opt, color: C.gold });
  const l200 = chart.addLineSeries({ ...opt, color: C.violet });

  const line = (arr) => bars.map((b, i) => (arr[i] != null ? { time: b.time, value: arr[i] } : null)).filter(Boolean);
  candles.setData(bars);
  volume.setData(bars.map((b) => ({ time: b.time, value: b.volume || 0, color: b.close >= b.open ? 'rgba(0,227,150,.28)' : 'rgba(255,77,106,.28)' })));
  l50.setData(line(sma50));
  l200.setData(line(sma200));

  let priceLines = [];
  const ctrl = {
    setRange(n) {
      const len = bars.length;
      if (!n || n >= len) chart.timeScale().fitContent();
      else chart.timeScale().setVisibleLogicalRange({ from: len - n, to: len + 2 });
    },
    update(bar) {
      candles.update(bar);
    },
    setLevels(levels) {
      priceLines.forEach((pl) => candles.removePriceLine(pl));
      priceLines = levels.map((lv) =>
        candles.createPriceLine({ price: lv.price, color: lv.color, lineWidth: 2, lineStyle: LW.LineStyle.Dashed, axisLabelVisible: true, title: lv.title })
      );
    },
    destroy() {
      chart.remove();
    },
  };
  return ctrl;
}
