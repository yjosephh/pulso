// Prueba histórica (backtesting) de las reglas de Pulso.
// Recorre la historia semana por semana: en cada fecha ejecuta las MISMAS reglas
// de la app usando solo los datos disponibles ese día (sin ver el futuro) y luego
// compara la sugerencia con lo que realmente pasó después.
import { analyze, deepAnalysis } from './analysis.js';

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
function strategy(evals, enter, exit, c = BT.commission) {
  let eq = 1;
  let pos = 0;
  let trades = 0;
  let peak = 1;
  let mdd = 0;
  let inv = 0;
  for (let i = 0; i < evals.length - 1; i++) {
    const e = evals[i];
    if (!pos && enter(e)) {
      pos = 1;
      eq *= 1 - c;
      trades++;
    } else if (pos && exit(e)) {
      pos = 0;
      eq *= 1 - c;
      trades++;
    }
    if (pos) {
      eq *= evals[i + 1].p0 / e.p0;
      inv++;
    }
    peak = Math.max(peak, eq);
    mdd = Math.min(mdd, eq / peak - 1);
  }
  if (pos) eq *= 1 - c;
  const years = ((evals.length - 1) * BT.step) / 252;
  return { ret: eq - 1, cagr: Math.pow(Math.max(eq, 1e-9), 1 / years) - 1, mdd, trades, exposure: inv / Math.max(1, evals.length - 1) };
}

const share = (arr, fn) => (arr.length ? arr.filter(fn).length / arr.length : 0);
const mean = (arr) => (arr.length ? arr.reduce((x, y) => x + y, 0) / arr.length : 0);

// Qué cuenta como "acierto" para cada sugerencia, y qué tan seguido pasa eso
// de todos modos (el "azar" con el que se compara).
const HIT = {
  'buy-now': { hit: (e) => e.r5 > 0, base: (b) => b.up5, desc: 'subió en 1 semana' },
  'buy-wait': { hit: (e) => e.min5 < -0.01, base: (b) => b.dip5, desc: 'en 5 días hubo un precio al menos 1% más barato' },
  'sell-wait': { hit: (e) => e.max5 > 0.01, base: (b) => b.rise5, desc: 'en 5 días hubo un precio al menos 1% más alto' },
  'sell-now': { hit: (e) => e.r5 < 0, base: (b) => 1 - b.up5, desc: 'bajó en 1 semana' },
};
const SIG = {
  buy: { hit: (e) => e.r5 > 0, base: (b) => b.up5, desc: 'subió en 1 semana' },
  sell: { hit: (e) => e.r5 < 0, base: (b) => 1 - b.up5, desc: 'bajó en 1 semana' },
};

function baseRates(evals) {
  return {
    up5: share(evals, (e) => e.r5 > 0),
    up21: share(evals, (e) => e.r21 > 0),
    dip5: share(evals, (e) => e.min5 < -0.01),
    rise5: share(evals, (e) => e.max5 > 0.01),
  };
}

function hitStats(rows, def) {
  // rows: [{ e, b }] — evaluación y tasas base de su propia empresa
  const n = rows.length;
  if (!n) return { n: 0 };
  const hit = share(rows, (r) => def.hit(r.e));
  const base = mean(rows.map((r) => def.base(r.b)));
  const ci = 1.96 * Math.sqrt((base * (1 - base)) / n);
  const edge = hit - base;
  const verdict = edge > ci ? 'ventaja' : edge < -ci ? 'peor' : 'azar';
  return { n, hit, base, edge, ci, verdict, avgR5: mean(rows.map((r) => r.e.r5)), avgR21: mean(rows.map((r) => r.e.r21)) };
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
    evals.forEach((e) => all.push({ e, b }));
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
      const rows = evals.filter((e) => e.rec === code).map((e) => ({ e, b }));
      const s = hitStats(rows, def);
      if (s.n) codes[code] = [s.n, +s.hit.toFixed(4), +s.base.toFixed(4)];
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
  // Calibración de los "objetivos": ¿se alcanzó el piso/techo estimado ~50% de las veces?
  const bw = all.filter((r) => r.e.rec === 'buy-wait');
  const sw = all.filter((r) => r.e.rec === 'sell-wait');
  codes['buy-wait'].reachTarget = share(bw, (r) => r.e.min5 <= r.e.low5);
  codes['sell-wait'].reachTarget = share(sw, (r) => r.e.max5 >= r.e.high5);

  const signals = {};
  for (const [k, def] of Object.entries(SIG)) signals[k] = { ...hitStats(all.filter((r) => r.e.sig === k), def), desc: def.desc };

  const coverage = {};
  [1, 5, 21].forEach((h, i) => {
    coverage[h] = { in90: share(all, (r) => r.e.in90[i]), in50: share(all, (r) => r.e.in50[i]) };
  });

  const agg = (list) => ({
    cagr: mean(list.map((x) => x.cagr)),
    ret: mean(list.map((x) => x.ret)),
    mdd: mean(list.map((x) => x.mdd)),
    trades: mean(list.map((x) => x.trades)),
    exposure: mean(list.map((x) => x.exposure)),
  });
  const beats = (list) => list.filter((x, i) => x.cagr > strat.bh[i].cagr).length;

  const spyD = datasets.find((d) => d.sym === 'SPY');
  const spy = spyD && spyD.evals.length > 20 ? strategy(spyD.evals, () => true, () => false) : null;

  return {
    version: 1,
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
      deep: { ...agg(strat.deep), beats: beats(strat.deep) },
      sig: { ...agg(strat.sig), beats: beats(strat.sig) },
      bh: agg(strat.bh),
      n: valid.length,
    },
    spy: spy ? { cagr: spy.cagr, ret: spy.ret, mdd: spy.mdd } : null,
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
