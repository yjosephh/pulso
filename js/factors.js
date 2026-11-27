// Estudio de factores: ¿algún indicador ordena bien qué acciones lo harán MEJOR
// QUE LAS DEMÁS? Protocolo (fijado antes de ver los resultados):
//  1. Con 2016-2021 (entrenamiento) solo se elige la dirección de cada factor.
//  2. Se evalúa a ciegas con 2022 en adelante (prueba), sin volver a ajustar nada.
//  3. Se corrige por probar muchas ideas a la vez (Benjamini-Hochberg).
//  4. Se simula comprar el 20% mejor clasificado, con costos, contra el promedio.
import { analyze, rsi } from './analysis.js';
import { mean, std, spearman, ranks, blockBootstrap, benjaminiHochberg, perfMetrics } from './metrics.js';

const yieldUI = () => new Promise((r) => {
  const ch = new MessageChannel();
  ch.port1.onmessage = () => r();
  ch.port2.postMessage(0);
});

function stdLog(c, t, n) {
  const r = [];
  for (let i = t - n + 1; i <= t; i++) r.push(Math.log(c[i] / c[i - 1]));
  return std(r);
}

// need = cuántos cierres hacen falta (incluyendo el día de la decisión).
export const FACTORS = [
  { id: 'mom12_1', name: 'Tendencia de 12 meses (sin el último mes)', need: 253, f: (c, t) => c[t - 21] / c[t - 252] - 1 },
  {
    id: 'high52', name: 'Cercanía a su máximo de 52 semanas', need: 252,
    f: (c, t) => {
      let m = 0;
      for (let i = t - 251; i <= t; i++) if (c[i] > m) m = c[i];
      return c[t] / m - 1;
    },
  },
  {
    id: 'trend200', name: 'Distancia a su media de 200 días', need: 200,
    f: (c, t) => {
      let s = 0;
      for (let i = t - 199; i <= t; i++) s += c[i];
      return c[t] / (s / 200) - 1;
    },
  },
  { id: 'rev1w', name: 'Rebote: caída de la última semana', need: 6, f: (c, t) => -(c[t] / c[t - 5] - 1) },
  { id: 'rev1m', name: 'Rebote: caída del último mes', need: 22, f: (c, t) => -(c[t] / c[t - 21] - 1) },
  { id: 'lowvol', name: 'Baja volatilidad (3 meses)', need: 64, f: (c, t) => -stdLog(c, t, 63) },
  {
    id: 'rsi14', name: 'RSI de 14 días', need: 100,
    f: (c, t) => {
      const r = rsi(c.slice(t - 99, t + 1), 14);
      return r[r.length - 1];
    },
  },
  { id: 'pulsoShort', name: 'Puntaje Pulso de corto plazo (parte técnica)', need: 260, pulso: 'scoreShort' },
  { id: 'pulsoLong', name: 'Puntaje Pulso de largo plazo (parte técnica)', need: 260, pulso: 'scoreLong' },
];
export const FACTOR_NAME = Object.fromEntries(FACTORS.map((f) => [f.id, f.name]));

export const HORIZONS = [
  { h: 5, every: 1, label: '1 semana', block: 4 },
  { h: 20, every: 4, label: '1 mes', block: 3 },
];

// Alinea los cierres de una empresa al calendario de referencia (SPY).
function align(bars, dateIndex, T) {
  const c = new Array(T).fill(null);
  for (const b of bars) {
    const i = dateIndex.get(b.time);
    if (i != null && Number.isFinite(b.close) && b.close > 0) c[i] = b.close;
  }
  const first = c.findIndex((v) => v != null);
  if (first < 0) return { c, first: -1 };
  let lastV = c[first];
  let gap = 0;
  for (let i = first + 1; i < T; i++) {
    if (c[i] == null) {
      if (gap < 5) {
        c[i] = lastV;
        gap++;
      }
    } else {
      lastV = c[i];
      gap = 0;
    }
  }
  return { c, first };
}

function factorValue(F, c, t, first, meta, barsOf) {
  if (t - F.need + 1 < first || c[t] == null || c[t - F.need + 1] == null) return NaN;
  if (F.pulso) {
    const hist = barsOf(Math.max(first, t - 419), t);
    try {
      const a = analyze({ meta, history: hist, quote: null, fund: null, rec: null, news: [], fastMc: true });
      return a[F.pulso];
    } catch {
      return NaN;
    }
  }
  const v = F.f(c, t);
  return Number.isFinite(v) ? v : NaN;
}

// Percentil (0 a 1) dentro de las empresas con dato.
function pctRanks(vals) {
  const idx = [];
  const v = [];
  vals.forEach((x, i) => {
    if (Number.isFinite(x)) {
      idx.push(i);
      v.push(x);
    }
  });
  const out = new Float64Array(vals.length).fill(NaN);
  if (v.length < 2) return out;
  const r = ranks(v);
  idx.forEach((i, j) => (out[i] = (r[j] - 1) / (v.length - 1)));
  return out;
}

export async function factorStudy(datasets, spyBars, { split = '2022-01-01', cost = 0.001, topFrac = 0.2, includePulso = true, onProgress, source = '', label = '' } = {}) {
  const dates = spyBars.map((b) => b.time);
  const T = dates.length;
  const di = new Map(dates.map((d, i) => [d, i]));
  const spy = align(spyBars, di, T).c;
  const stocks = datasets
    .map((d) => ({ sym: d.meta.s, meta: d.meta, ...align(d.bars, di, T) }))
    .filter((s) => s.first >= 0);
  stocks.forEach((s) => {
    const objs = s.c.map((v, i) => (v == null ? null : { time: dates[i], open: v, high: v, low: v, close: v, volume: 0 }));
    s.barsOf = (from, to) => objs.slice(from, to + 1).filter(Boolean);
  });
  const N = stocks.length;
  const factors = FACTORS.filter((f) => includePulso || !f.pulso);
  const warm = 260;
  const tList = [];
  for (let t = warm; t + 5 < T; t += 5) tList.push(t);

  // 1) Valor de cada factor para cada empresa en cada fecha de decisión.
  const vals = factors.map(() => []);
  let last = performance.now();
  for (let k = 0; k < tList.length; k++) {
    const t = tList[k];
    const rows = factors.map(() => new Float64Array(N).fill(NaN));
    for (let s = 0; s < N; s++) {
      const st = stocks[s];
      let pa; // análisis de Pulso: se calcula una sola vez para ambos puntajes
      for (let fi = 0; fi < factors.length; fi++) {
        const F = factors[fi];
        if (F.pulso) {
          if (t - F.need + 1 < st.first || st.c[t] == null) continue;
          if (pa === undefined) {
            try {
              pa = analyze({ meta: st.meta, history: st.barsOf(Math.max(st.first, t - 419), t), quote: null, fund: null, rec: null, news: [], fastMc: true });
            } catch {
              pa = null;
            }
          }
          rows[fi][s] = pa ? pa[F.pulso] : NaN;
        } else {
          rows[fi][s] = factorValue(F, st.c, t, st.first, st.meta, st.barsOf);
        }
      }
    }
    rows.forEach((row, fi) => vals[fi].push(row));
    if (performance.now() - last > 30) {
      await yieldUI();
      last = performance.now();
      if (onProgress) onProgress(0.9 * (k / tList.length));
    }
  }

  // 2) Evaluación por horizonte.
  const results = [];
  for (const H of HORIZONS) {
    const ks = [];
    for (let k = 0; k < tList.length; k += H.every) if (tList[k] + H.h < T) ks.push(k);
    const ppy = 252 / H.h;
    const fwd = ks.map((k) => {
      const t = tList[k];
      const row = new Float64Array(N).fill(NaN);
      for (let s = 0; s < N; s++) {
        const a = stocks[s].c[t];
        const b = stocks[s].c[t + H.h];
        if (a != null && b != null) row[s] = b / a - 1;
      }
      return row;
    });
    const spyFwd = ks.map((k) => (spy[tList[k]] != null && spy[tList[k] + H.h] != null ? spy[tList[k] + H.h] / spy[tList[k]] - 1 : 0));
    const isTest = ks.map((k) => dates[tList[k]] >= split);

    const icSeries = (getVals) => ks.map((k, j) => {
      const v = getVals(k, j);
      const x = [];
      const y = [];
      for (let s = 0; s < N; s++) {
        if (Number.isFinite(v[s]) && Number.isFinite(fwd[j][s])) {
          x.push(v[s]);
          y.push(fwd[j][s]);
        }
      }
      return x.length >= 10 ? spearman(x, y) : NaN;
    });

    const evaluate = (id, name, getVals, extra = {}) => {
      const ic = icSeries(getVals);
      const tr = [];
      const te = [];
      ic.forEach((v, j) => {
        if (Number.isFinite(v)) (isTest[j] ? te : tr).push(v);
      });
      const sign = extra.sign != null ? extra.sign : mean(tr) < 0 ? -1 : 1;
      const btr = blockBootstrap(tr.map((v) => sign * v), mean, { block: H.block, seed: 11 });
      const bte = blockBootstrap(te.map((v) => sign * v), mean, { block: H.block, seed: 13 });

      // Estrategia: comprar el 20% mejor clasificado y mantener hasta la próxima decisión.
      const seg = { train: { eq: [1], ew: [1], spy: [1], prev: null }, test: { eq: [1], ew: [1], spy: [1], prev: null } };
      const excess = [];
      let turnSum = 0;
      let turnN = 0;
      ks.forEach((k, j) => {
        const v = getVals(k, j);
        const cand = [];
        for (let s = 0; s < N; s++) if (Number.isFinite(v[s]) && Number.isFinite(fwd[j][s])) cand.push(s);
        if (cand.length < 10) return;
        cand.sort((a, b) => sign * v[b] - sign * v[a]);
        const K = Math.max(3, Math.round(topFrac * cand.length));
        const picks = cand.slice(0, K);
        const sg = isTest[j] ? seg.test : seg.train;
        let turnover = 1;
        let c = cost;
        if (sg.prev) {
          const prev = new Set(sg.prev);
          turnover = picks.filter((s) => !prev.has(s)).length / K;
          c = cost * 2 * turnover;
        }
        sg.prev = picks;
        turnSum += turnover;
        turnN++;
        const port = mean(picks.map((s) => fwd[j][s])) - c;
        const ew = mean(cand.map((s) => fwd[j][s]));
        sg.eq.push(sg.eq[sg.eq.length - 1] * (1 + port));
        sg.ew.push(sg.ew[sg.ew.length - 1] * (1 + ew));
        sg.spy.push(sg.spy[sg.spy.length - 1] * (1 + spyFwd[j]));
        if (isTest[j]) excess.push(port - ew);
      });
      const bex = blockBootstrap(excess, (a) => mean(a) * ppy, { block: H.block, seed: 17 });
      const mTest = perfMetrics(seg.test.eq, { ppy });
      const mTrain = perfMetrics(seg.train.eq, { ppy });
      return {
        id,
        name,
        h: H.h,
        hLabel: H.label,
        sign,
        ...extra,
        train: { ic: btr.est, lo: btr.lo, hi: btr.hi, p: btr.pTwo, n: btr.n },
        test: { ic: bte.est, lo: bte.lo, hi: bte.hi, p: bte.pPos, n: bte.n, retention: btr.est ? bte.est / btr.est : null },
        strat: {
          test: { port: mTest, ew: perfMetrics(seg.test.ew, { ppy }), spy: perfMetrics(seg.test.spy, { ppy }), excess: { ann: bex.est, lo: bex.lo, hi: bex.hi } },
          train: { port: mTrain && mTrain.cagr, ew: (perfMetrics(seg.train.ew, { ppy }) || {}).cagr },
          turnover: turnN ? turnSum / turnN : null,
        },
      };
    };

    const hRes = [];
    factors.forEach((F, fi) => {
      hRes.push(evaluate(F.id, F.name, (k) => vals[fi][k]));
    });
    // Combinación fijada de antemano: promedio de los factores significativos SOLO en entrenamiento.
    const members = hRes.filter((r) => r.train.p < 0.1).map((r) => ({ id: r.id, sign: r.sign }));
    if (members.length >= 2) {
      const memberIdx = members.map((m) => factors.findIndex((f) => f.id === m.id));
      const cache = new Map();
      const compVals = (k) => {
        if (cache.has(k)) return cache.get(k);
        const pr = memberIdx.map((fi) => pctRanks(vals[fi][k]));
        const out = new Float64Array(N).fill(NaN);
        for (let s = 0; s < N; s++) {
          let sum = 0;
          let ok = true;
          members.forEach((m, mi) => {
            const p = pr[mi][s];
            if (!Number.isFinite(p)) ok = false;
            else sum += m.sign > 0 ? p : 1 - p;
          });
          if (ok) out[s] = sum / members.length;
        }
        cache.set(k, out);
        return out;
      };
      hRes.push(evaluate('composite', 'Combinación de factores (elegida con 2016-2021)', compVals, { sign: 1, members }));
    }
    results.push(...hRes);
    if (onProgress) onProgress(0.9 + 0.05 * (H.h === 5 ? 1 : 2));
  }

  // 3) Corrección por pruebas múltiples y veredicto.
  const q = benjaminiHochberg(results.map((r) => r.test.p));
  results.forEach((r, i) => {
    r.test.q = q[i];
    const ex = r.strat.test.excess.ann;
    r.verdict = r.test.q < 0.1 && r.test.ic > 0 && ex > 0 ? 'validado' : r.test.p < 0.1 && r.test.ic > 0 ? 'prometedor' : 'no';
  });

  const testDates = tList.map((t) => dates[t]).filter((d) => d >= split);
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    source,
    label,
    universe: N,
    symbols: stocks.map((s) => s.sym),
    split,
    cost,
    topFrac,
    period: { from: dates[tList[0]], trainTo: split, testFrom: testDates[0] || split, to: dates[tList[tList.length - 1]] },
    results,
  };
}

// Ranking en vivo para la app con un factor o combinación validada.
// datasets: [{ meta, closes: [...] }] (último elemento = precio actual).
export function liveFactorRanking(entry, datasets) {
  const comps = entry.members && entry.members.length ? entry.members : [{ id: entry.id, sign: entry.sign }];
  const raw = comps.map((m) => {
    const F = FACTORS.find((f) => f.id === m.id);
    return datasets.map((d) => {
      if (!F) return NaN;
      const c = d.closes;
      const t = c.length - 1;
      return factorValue(F, c, t, 0, d.meta, (from, to) => c.slice(from, to + 1).map((v, i) => ({ time: d.times ? d.times[from + i] : String(from + i), open: v, high: v, low: v, close: v, volume: 0 })));
    });
  });
  const prs = raw.map((v) => pctRanks(v));
  const out = datasets.map((d, s) => {
    let sum = 0;
    let ok = true;
    comps.forEach((m, mi) => {
      const p = prs[mi][s];
      if (!Number.isFinite(p)) ok = false;
      else sum += m.sign > 0 ? p : 1 - p;
    });
    return { sym: d.meta.s, score: ok ? sum / comps.length : NaN, raw: raw.map((r) => r[s]) };
  });
  return out.filter((x) => Number.isFinite(x.score)).sort((a, b) => b.score - a.score);
}
