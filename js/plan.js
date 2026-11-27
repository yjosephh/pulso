// Plan de aportes (Fase 2): ¿cuánto podrías juntar invirtiendo cada mes?
// Simulación Monte Carlo con rachas de calma y de crisis (cadena de Markov),
// para que los meses malos lleguen juntos, como pasa en la realidad.
import { mulberry32, gaussFrom } from './data.js';

export const PLAN_PRESETS = {
  prudente: {
    name: 'Prudente',
    ret: 0.06,
    vol: 0.16,
    desc: '6% al año. Supuesto conservador: varios bancos de inversión esperan entre 3% y 7% al año para la bolsa de EE.UU. en la próxima década, porque hoy está cara.',
  },
  historico: {
    name: 'Histórico S&P 500',
    ret: 0.099,
    vol: 0.195,
    desc: '9.9% al año, volatilidad ~19.5%: el promedio del S&P 500 de 1928 a 2024 con dividendos reinvertidos (datos de Damodaran, NYU). El pasado no garantiza el futuro.',
  },
};

export const INFLATION = 0.03;

// Multiplicadores de volatilidad: meses tranquilos y meses de crisis.
// Con P(crisis) estacionaria = 1/6, la varianza promedio queda en 1.
const CALM = 0.85;
const STRESS = 1.545;
const STAY_CALM = 0.95;
const STAY_STRESS = 0.75;
const P_STRESS = (1 - STAY_CALM) / (2 - STAY_CALM - STAY_STRESS);

// Choques aleatorios reutilizables (mismos escenarios al cambiar los montos).
export function makeShocks(months, paths = 5000, seed = 20260101) {
  const rng = mulberry32(seed);
  const z = new Float32Array(months * paths);
  for (let p = 0; p < paths; p++) {
    let stress = rng() < P_STRESS;
    for (let m = 0; m < months; m++) {
      stress = stress ? rng() < STAY_STRESS : rng() >= STAY_CALM;
      z[p * months + m] = gaussFrom(rng) * (stress ? STRESS : CALM);
    }
  }
  return { months, paths, z };
}

function finalsOf(shocks, { initial, monthly, ret, vol }) {
  const { months: M, paths: P, z } = shocks;
  const mu = Math.log(1 + ret) / 12;
  const sd = vol / Math.sqrt(12);
  const out = new Float64Array(P);
  for (let p = 0; p < P; p++) {
    let v = initial;
    const o = p * M;
    for (let m = 0; m < M; m++) v = (v + monthly) * Math.exp(mu + sd * z[o + m]);
    out[p] = v;
  }
  return out;
}

const qtl = (sorted, x) => sorted[Math.min(sorted.length - 1, Math.floor(x * sorted.length))];

// ret = rendimiento anual "típico" (geométrico), vol = volatilidad anual.
// Aporte al inicio de cada mes. Devuelve el abanico año por año.
export function runPlan(shocks, { initial = 0, monthly = 0, ret = 0.06, vol = 0.16, goal = 0 } = {}) {
  const { months: M, paths: P, z } = shocks;
  const mu = Math.log(1 + ret) / 12;
  const sd = vol / Math.sqrt(12);
  const Y = Math.floor(M / 12);
  const yearVals = Array.from({ length: Y + 1 }, () => new Float64Array(P));
  const finals = new Float64Array(P);
  const drops = new Float64Array(P);
  for (let p = 0; p < P; p++) {
    let v = initial;
    // Índice del rendimiento (sin aportes) para medir la peor caída que te tocaría vivir.
    let idx = 1;
    let peak = 1;
    let mdd = 0;
    const o = p * M;
    yearVals[0][p] = v;
    for (let m = 0; m < M; m++) {
      const g = Math.exp(mu + sd * z[o + m]);
      v = (v + monthly) * g;
      idx *= g;
      if (idx > peak) peak = idx;
      else if (idx / peak - 1 < mdd) mdd = idx / peak - 1;
      if ((m + 1) % 12 === 0) yearVals[(m + 1) / 12][p] = v;
    }
    finals[p] = v;
    drops[p] = mdd;
  }
  const fan = yearVals.map((arr, y) => {
    const s = Array.from(arr).sort((a, b) => a - b);
    return { y, p5: qtl(s, 0.05), p25: qtl(s, 0.25), p50: qtl(s, 0.5), p75: qtl(s, 0.75), p95: qtl(s, 0.95), contrib: initial + monthly * 12 * y };
  });
  const contributed = initial + monthly * M;
  let below = 0;
  let hit = 0;
  for (const v of finals) {
    if (v < contributed) below++;
    if (goal > 0 && v >= goal) hit++;
  }
  const dropsS = Array.from(drops).sort((a, b) => a - b);
  return {
    months: M,
    paths: P,
    fan,
    final: fan[fan.length - 1],
    contributed,
    probBelow: below / P,
    probGoal: goal > 0 ? hit / P : null,
    typicalDrop: qtl(dropsS, 0.5), // caída máxima en un escenario típico
    badDrop: qtl(dropsS, 0.1), // 1 de cada 10 escenarios cae más que esto
  };
}

// Aporte mensual necesario para llegar a `goal` con probabilidad `target`.
export function solveMonthly(shocks, { initial = 0, ret, vol }, goal, target = 0.8) {
  if (!(goal > 0)) return null;
  const prob = (monthly) => {
    const f = finalsOf(shocks, { initial, monthly, ret, vol });
    let n = 0;
    for (const v of f) if (v >= goal) n++;
    return n / f.length;
  };
  if (prob(0) >= target) return 0;
  let lo = 0;
  let hi = Math.max(50, goal / shocks.months);
  for (let k = 0; k < 30 && prob(hi) < target; k++) hi *= 2;
  for (let k = 0; k < 28; k++) {
    const mid = (lo + hi) / 2;
    if (prob(mid) >= target) hi = mid;
    else lo = mid;
  }
  return hi;
}
