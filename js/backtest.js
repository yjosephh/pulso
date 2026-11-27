// Prueba histórica (backtesting) de las reglas de Pulso.
// Recorre la historia semana por semana: en cada fecha ejecuta las MISMAS reglas
// de la app usando solo los datos disponibles ese día (sin ver el futuro) y luego
// compara la sugerencia con lo que realmente pasó después.
import { analyze, deepAnalysis } from './analysis.js';
import { mean, perfMetrics, weekKey } from './metrics.js';
import { mulberry32 } from './data.js';

export const BT = { step: 5, warmup: 260, window: 420, paths: 2000, commission: 0.001 };

// Cede el control a la interfaz sin depender de temporizadores (que el navegador
// frena en segundo plano).
const yieldUI = () => new Promise((r) => {
  const ch = new MessageChannel();
  ch.port1.onmessage = () => r();
  ch.port2.postMessage(0);
});

export async function evaluateSymbol(meta, bars, { onTick, shouldStop } = {}) {
  const closes = bars.map((b) => b.close);
  const n = bars.length;
  const out = [];
  let last = performance.now();
  for (let t = BT.warmup; t < n - 21; t += BT.step) {
    if (shouldStop && shouldStop()) break;
    const hist = bars.slice(Math.max(0, t - BT.window + 1), t + 1);
    let a;
    let d;
    try {
      // Sin fundamentales, analistas ni noticias: no hay historial gratuito de
      // cómo estaban en cada fecha (usar los de hoy sería hacer trampa).
      a = analyze({ meta, history: hist, quote: null, fund: null, rec: null, news: [], fastMc: true });
      d = deepAnalysis(a, [], { paths: BT.paths, maxPaths: BT.paths, maxMoe: 1 });
    } catch {
      continue;
    }
    if (!d) continue;
    const p0 = closes[t];
    const w5 = closes.slice(t + 1, t + 6);
    const f = { 1: closes[t + 1], 5: closes[t + 5], 21: closes[t + 21] };
    out.push({
      date: bars[t].time,
      p0,
      rec: d.rec.code,
      sig: a.signalType,
      r1: f[1] / p0 - 1,
      r5: f[5] / p0 - 1,
      r21: f[21] / p0 - 1,
      min5: Math.min(...w5) / p0 - 1,
      max5: Math.max(...w5) / p0 - 1,
      low5: d.low5 / p0 - 1,
      high5: d.high5 / p0 - 1,
      in90: [1, 5, 21].map((h) => f[h] >= d.h[h].p5 && f[h] <= d.h[h].p95),
      in50: [1, 5, 21].map((h) => f[h] >= d.h[h].p25 && f[h] <= d.h[h].p75),
    });
    if (performance.now() - last > 30) {
      await yieldUI();
      last = performance.now();
      if (onTick) onTick((t - BT.warmup) / Math.max(1, n - 21 - BT.warmup));
    }
  }
  return out;
}

// Simula seguir una regla de entrada/salida con decisiones semanales y comisión.
// Devuelve también el rendimiento de cada semana y de cada operación cerrada.
function strategy(evals, enter, exit, c = BT.commission) {
  let eq = 1;
  let pos = 0;
  let entryEq = 1;
  let inv = 0;
  const weekly = [];
  const trades = [];
  for (let i = 0; i < evals.length - 1; i++) {
    const e = evals[i];
    const before = eq;
    if (!pos && enter(e)) {
      pos = 1;
      entryEq = eq;
      eq *= 1 - c;
    } else if (pos && exit(e)) {
      pos = 0;
      eq *= 1 - c;
      trades.push(eq / entryEq - 1);
    }
    if (pos) {
      eq *= evals[i + 1].p0 / e.p0;
      inv++;
    }
    weekly.push({ date: e.date, r: eq / before - 1 });
  }
  if (pos) {
    eq *= 1 - c;
    trades.push(eq / entryEq - 1);
    weekly[weekly.length - 1].r = (1 + weekly[weekly.length - 1].r) * (1 - c) - 1;
  }
  const years = ((evals.length - 1) * BT.step) / 252;
  return { ret: eq - 1, cagr: Math.pow(Math.max(eq, 1e-9), 1 / years) - 1, trades, exposure: inv / Math.max(1, evals.length - 1), weekly };
}

const share = (arr, fn) => (arr.length ? arr.filter(fn).length / arr.length : 0);

// Qué cuenta como "acierto" para cada sugerencia, y qué tan seguido pasa eso
// de todos modos (el "azar" con el que se compara).
export const HIT = {
  'buy-now': { hit: (e) => e.r5 > 0, base: (b) => b.up5, desc: 'subió en 1 semana' },
  'buy-wait': { hit: (e) => e.min5 < -0.01, base: (b) => b.dip5, desc: 'en 5 días hubo un precio al menos 1% más barato' },
  'sell-wait': { hit: (e) => e.max5 > 0.01, base: (b) => b.rise5, desc: 'en 5 días hubo un precio al menos 1% más alto' },
  'sell-now': { hit: (e) => e.r5 < 0, base: (b) => 1 - b.up5, desc: 'bajó en 1 semana' },
};
export const SIG = {
  buy: { hit: (e) => e.r5 > 0, base: (b) => b.up5, desc: 'subió en 1 semana' },
  sell: { hit: (e) => e.r5 < 0, base: (b) => 1 - b.up5, desc: 'bajó en 1 semana' },
};

export function baseRates(evals) {
  return {
    up5: share(evals, (e) => e.r5 > 0),
    up21: share(evals, (e) => e.r21 > 0),
    dip5: share(evals, (e) => e.min5 < -0.01),
    rise5: share(evals, (e) => e.max5 > 0.01),
  };
}

// Ventaja sobre el azar con margen de error por bootstrap AGRUPADO POR SEMANA:
// las empresas se mueven juntas, así que cada semana cuenta como un bloque.
function hitStats(rows, def, seed = 3) {
  const n = rows.length;
  if (!n) return { n: 0 };
  const hit = share(rows, (r) => def.hit(r.e));
  const base = mean(rows.map((r) => def.base(r.b)));
  const byWeek = new Map();
  for (const r of rows) {
    const w = weekKey(r.e.date);
    if (!byWeek.has(w)) byWeek.set(w, { h: 0, b: 0, n: 0 });
    const g = byWeek.get(w);
    g.h += def.hit(r.e) ? 1 : 0;
    g.b += def.base(r.b);
    g.n++;
  }
  const weeks = [...byWeek.keys()].sort((a, b) => a - b).map((w) => byWeek.get(w));
  const W = weeks.length;
  const B = 1000;
  const L = Math.min(4, W);
  const rng = mulberry32(seed);
  const edges = new Float64Array(B);
  for (let b = 0; b < B; b++) {
    let h = 0;
    let bs = 0;
    let cnt = 0;
    let k = 0;
    while (k < W) {
      const s = Math.floor(rng() * (W - L + 1));
      for (let j = 0; j < L && k < W; j++, k++) {
        const g = weeks[s + j];
        h += g.h;
        bs += g.b;
        cnt += g.n;
      }
    }
    edges[b] = cnt ? h / cnt - bs / cnt : 0;
  }
  edges.sort();
  const lo = edges[Math.floor(0.025 * B)];
  const hi = edges[Math.floor(0.975 * B)];
  const edge = hit - base;
  const verdict = lo > 0 ? 'ventaja' : hi < 0 ? 'peor' : 'azar';
  return { n, weeks: W, hit, base, edge, lo, hi, ci: (hi - lo) / 2, verdict, avgR5: mean(rows.map((r) => r.e.r5)), avgR21: mean(rows.map((r) => r.e.r21)) };
}

// Junta los rendimientos semanales de todas las empresas en un portafolio que
// reparte el dinero en partes iguales (como haría una persona con 29 acciones).
function portfolio(list, spyWeekly, withTrades = true) {
  const byWeek = new Map();
  list.forEach((st) => st.weekly.forEach(({ date, r }) => {
    const w = weekKey(date);
    if (!byWeek.has(w)) byWeek.set(w, []);
    byWeek.get(w).push(r);
  }));
  const weeks = [...byWeek.keys()].sort((a, b) => a - b).filter((w) => !spyWeekly || spyWeekly.has(w));
  const eq = [1];
  weeks.forEach((w) => eq.push(eq[eq.length - 1] * (1 + mean(byWeek.get(w)))));
  const trades = withTrades ? list.flatMap((st) => st.trades) : [];
  return { weeks, metrics: perfMetrics(eq, { ppy: 52, trades: trades.length ? trades : null }) };
}

export function summarizeBacktest(datasets, meta = {}) {
  // datasets: [{ sym, evals }]
  const valid = datasets.filter((d) => d.evals.length > 20 && d.sym !== 'SPY');
  const all = [];
  const per = {};
  const strat = { deep: [], sig: [], bh: [] };
  let from = null;
  let to = null;

  for (const { sym, evals } of valid) {
    const b = baseRates(evals);
    evals.forEach((e) => all.push({ e, b, sym }));
    from = !from || evals[0].date < from ? evals[0].date : from;
    to = !to || evals[evals.length - 1].date > to ? evals[evals.length - 1].date : to;

    const deep = strategy(evals, (e) => e.rec === 'buy-now', (e) => e.rec === 'sell-now' || e.rec === 'sell-wait');
    const sig = strategy(evals, (e) => e.sig === 'buy', (e) => e.sig === 'sell');
    const bh = strategy(evals, () => true, () => false);
    strat.deep.push(deep);
    strat.sig.push(sig);
    strat.bh.push(bh);

    const codes = {};
    for (const [code, def] of Object.entries(HIT)) {
      const rows = evals.filter((e) => e.rec === code);
      if (rows.length) codes[code] = [rows.length, +share(rows, def.hit).toFixed(4), +def.base(b).toFixed(4)];
    }
    per[sym] = {
      n: evals.length,
      from: evals[0].date,
      to: evals[evals.length - 1].date,
      codes,
      cov90: [0, 1, 2].map((i) => +share(evals, (e) => e.in90[i]).toFixed(4)),
      deep: +deep.cagr.toFixed(4),
      sig: +sig.cagr.toFixed(4),
      bh: +bh.cagr.toFixed(4),
    };
  }

  const codes = {};
  for (const [code, def] of Object.entries(HIT)) codes[code] = { ...hitStats(all.filter((r) => r.e.rec === code), def), desc: def.desc };
  const holdRows = all.filter((r) => r.e.rec === 'hold');
  codes.hold = { n: holdRows.length, avgR5: mean(holdRows.map((r) => r.e.r5)), avgR21: mean(holdRows.map((r) => r.e.r21)) };
  const bw = all.filter((r) => r.e.rec === 'buy-wait');
  const sw = all.filter((r) => r.e.rec === 'sell-wait');
  codes['buy-wait'].reachTarget = share(bw, (r) => r.e.min5 <= r.e.low5);
  codes['sell-wait'].reachTarget = share(sw, (r) => r.e.max5 >= r.e.high5);

  const signals = {};
  for (const [k, def] of Object.entries(SIG)) signals[k] = { ...hitStats(all.filter((r) => r.e.sig === k), def, 5), desc: def.desc };

  const coverage = {};
  [1, 5, 21].forEach((h, i) => {
    coverage[h] = { in90: share(all, (r) => r.e.in90[i]), in50: share(all, (r) => r.e.in50[i]) };
  });

  const spyD = datasets.find((d) => d.sym === 'SPY');
  const spyStrat = spyD && spyD.evals.length > 20 ? strategy(spyD.evals, () => true, () => false) : null;
  const spyWeeks = spyStrat ? new Set(spyStrat.weekly.map((x) => weekKey(x.date))) : null;
  const pDeep = portfolio(strat.deep, spyWeeks);
  const pSig = portfolio(strat.sig, spyWeeks);
  const pBh = portfolio(strat.bh, spyWeeks, false);
  let spyM = null;
  if (spyStrat) {
    const keep = new Set(pBh.weeks);
    const eq = [1];
    spyStrat.weekly.filter((x) => keep.has(weekKey(x.date))).forEach((x) => eq.push(eq[eq.length - 1] * (1 + x.r)));
    spyM = perfMetrics(eq, { ppy: 52 });
  }
  const beats = (list) => list.filter((x, i) => x.cagr > strat.bh[i].cagr).length;
  const avg = (list, k) => mean(list.map((x) => x[k]));

  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    source: meta.source || '',
    period: { from, to },
    years: from && to ? (new Date(to) - new Date(from)) / (365.25 * 864e5) : 0,
    symbols: valid.length,
    evals: all.length,
    step: BT.step,
    paths: BT.paths,
    commission: BT.commission,
    avgAll: { r5: mean(all.map((r) => r.e.r5)), r21: mean(all.map((r) => r.e.r21)), up5: share(all, (r) => r.e.r5 > 0) },
    codes,
    signals,
    coverage,
    strategy: {
      deep: { ...pDeep.metrics, beats: beats(strat.deep), exposure: avg(strat.deep, 'exposure'), tradesPerStock: mean(strat.deep.map((x) => x.trades.length)) },
      sig: { ...pSig.metrics, beats: beats(strat.sig), exposure: avg(strat.sig, 'exposure'), tradesPerStock: mean(strat.sig.map((x) => x.trades.length)) },
      bh: { ...pBh.metrics, exposure: 1 },
      spy: spyM,
      n: valid.length,
    },
    spy: spyM,
    per,
  };
}

export async function runBacktest(datasets, { onProgress, shouldStop, source } = {}) {
  const results = [];
  for (let i = 0; i < datasets.length; i++) {
    const { meta, bars } = datasets[i];
    if (shouldStop && shouldStop()) break;
    if (onProgress) onProgress({ sym: meta.s, i, total: datasets.length, frac: i / datasets.length });
    const evals = await evaluateSymbol(meta, bars, {
      shouldStop,
      onTick: (f) => onProgress && onProgress({ sym: meta.s, i, total: datasets.length, frac: (i + f) / datasets.length }),
    });
    results.push({ sym: meta.s, evals });
  }
  return summarizeBacktest(results, { source });
}
