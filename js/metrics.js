// Métricas de desempeño, correlación por rangos, bootstrap por bloques y
// control de falsos descubrimientos (Benjamini-Hochberg).
import { mulberry32 } from './data.js';

export const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

export function std(a) {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}

// Rangos promedio (los empates reciben el rango medio).
export function ranks(a) {
  const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
  const r = new Array(a.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

export function pearson(x, y) {
  const n = x.length;
  if (n < 3) return NaN;
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
}

// Coeficiente de información (IC): correlación de Spearman.
export const spearman = (x, y) => pearson(ranks(x), ranks(y));

// Bootstrap por bloques móviles: respeta que semanas seguidas se parecen entre sí.
// pPos = probabilidad estimada de que el valor real sea <= 0 (prueba de una cola).
export function blockBootstrap(series, stat = mean, { B = 2000, block = 4, seed = 7 } = {}) {
  const n = series.length;
  const est = n ? stat(series) : NaN;
  if (n < 8) return { est, lo: NaN, hi: NaN, pPos: NaN, pTwo: NaN, n };
  const rng = mulberry32(seed);
  const L = Math.max(1, Math.min(block, n));
  const vals = new Float64Array(B);
  const buf = new Array(n);
  for (let b = 0; b < B; b++) {
    let k = 0;
    while (k < n) {
      const s = Math.floor(rng() * (n - L + 1));
      for (let j = 0; j < L && k < n; j++) buf[k++] = series[s + j];
    }
    vals[b] = stat(buf);
  }
  vals.sort();
  let le = 0;
  let ge = 0;
  for (const v of vals) {
    if (v <= 0) le++;
    if (v >= 0) ge++;
  }
  return {
    est,
    lo: vals[Math.floor(0.025 * B)],
    hi: vals[Math.min(B - 1, Math.floor(0.975 * B))],
    pPos: le / B,
    pTwo: Math.min(1, (2 * Math.min(le, ge)) / B),
    n,
  };
}

// Benjamini-Hochberg: convierte valores p en valores q (falsos descubrimientos).
export function benjaminiHochberg(ps) {
  const m = ps.length;
  const order = ps.map((p, i) => [Number.isFinite(p) ? p : 1, i]).sort((a, b) => a[0] - b[0]);
  const q = new Array(m);
  let min = 1;
  for (let k = m - 1; k >= 0; k--) {
    const [p, i] = order[k];
    min = Math.min(min, (p * m) / (k + 1));
    q[i] = min;
  }
  return q;
}

// Métricas de una curva de capital (valores al cierre de cada periodo).
// trades = rendimientos de cada operación cerrada (opcional).
export function perfMetrics(equity, { ppy = 52, trades = null } = {}) {
  const n = equity.length - 1;
  if (n < 2) return null;
  const rets = [];
  for (let i = 1; i <= n; i++) rets.push(equity[i] / equity[i - 1] - 1);
  const years = n / ppy;
  const growth = equity[n] / equity[0];
  const m = mean(rets);
  const s = std(rets);
  const down = Math.sqrt(mean(rets.map((r) => Math.min(0, r) ** 2)));
  let peak = equity[0];
  let mdd = 0;
  let dur = 0;
  let maxDur = 0;
  for (const v of equity) {
    if (v >= peak) {
      peak = v;
      dur = 0;
    } else {
      dur++;
      maxDur = Math.max(maxDur, dur);
      mdd = Math.min(mdd, v / peak - 1);
    }
  }
  const cagr = Math.pow(Math.max(growth, 1e-9), 1 / years) - 1;
  const out = {
    periods: n,
    years,
    total: growth - 1,
    cagr,
    vol: s * Math.sqrt(ppy),
    sharpe: s > 0 ? (m / s) * Math.sqrt(ppy) : null,
    sortino: down > 0 ? (m / down) * Math.sqrt(ppy) : null,
    mdd,
    calmar: mdd < 0 ? cagr / -mdd : null,
    maxDdYears: maxDur / ppy,
  };
  if (trades && trades.length) {
    const w = trades.filter((x) => x > 0);
    const l = trades.filter((x) => x <= 0);
    const sumW = w.reduce((a, b) => a + b, 0);
    const sumL = l.reduce((a, b) => a + b, 0);
    const avgWin = w.length ? sumW / w.length : 0;
    const avgLoss = l.length ? sumL / l.length : 0;
    const winRate = w.length / trades.length;
    const sd = std(trades);
    out.trades = trades.length;
    out.winRate = winRate;
    out.avgWin = avgWin;
    out.avgLoss = avgLoss;
    out.profitFactor = sumL < 0 ? sumW / -sumL : null;
    out.expectancy = mean(trades);
    // SQN de Van Tharp (raíz de N limitada a 100 operaciones).
    out.sqn = sd > 0 ? (Math.sqrt(Math.min(trades.length, 100)) * mean(trades)) / sd : null;
    out.kelly = avgLoss < 0 && avgWin > 0 ? winRate - (1 - winRate) / (avgWin / -avgLoss) : null;
  }
  return out;
}

// Semana ISO aproximada (lunes a domingo) para agrupar fechas de distintas empresas.
export function weekKey(date) {
  const [y, m, d] = date.split('-').map(Number);
  return Math.floor((Date.UTC(y, m - 1, d) / 864e5 + 3) / 7);
}
