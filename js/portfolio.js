// Construcción de portafolios (Fase 2).
// - Covarianza con "encogimiento" de Ledoit-Wolf: con 1 año de datos la matriz de
//   cómo se mueven juntas las acciones trae mucho ruido; encogerla la estabiliza.
// - Métodos: partes iguales, paridad de riesgo simple (1/volatilidad), mínima
//   varianza (con tope por empresa) y HRP (López de Prado, 2016).
// - No hay "máximo Sharpe" a propósito: necesita predecir rendimientos, que es
//   justo lo que no pasó las pruebas de Pulso.
// Funciones puras: son las mismas que se validaron con datos históricos.

export const METHODS = {
  ew: { name: 'Partes iguales', short: 'Iguales', desc: 'El mismo dinero en cada empresa. Simple y muy difícil de vencer.' },
  iv: { name: 'Paridad de riesgo simple', short: 'Paridad', desc: 'Más dinero en las acciones tranquilas y menos en las volátiles (1 / volatilidad).' },
  mv: { name: 'Mínima varianza', short: 'Mín. var.', desc: 'La combinación que menos se movió, usando cómo se mueven juntas (con tope por empresa).' },
  hrp: { name: 'HRP (paridad jerárquica)', short: 'HRP', desc: 'Agrupa las empresas que se mueven parecido y reparte el riesgo entre grupos.' },
};

// Alinea cierres por fecha (solo fechas comunes) y devuelve rendimientos diarios.
// series: [{ sym, times: ['2025-01-02', …], closes: [...] }]
export function alignReturns(series, lookback = 252) {
  const ok = series.filter((s) => s && s.closes && s.closes.length > 60);
  if (ok.length < 2) return null;
  const maps = ok.map((s) => {
    const m = new Map();
    s.times.forEach((t, i) => { if (s.closes[i] > 0) m.set(t, s.closes[i]); });
    return m;
  });
  const longest = ok.reduce((a, b) => (b.times.length > a.times.length ? b : a));
  const dates = longest.times.filter((t) => maps.every((m) => m.has(t))).slice(-(lookback + 1));
  if (dates.length < 61) return null;
  const R = [];
  for (let t = 1; t < dates.length; t++) {
    const row = new Float64Array(ok.length);
    for (let j = 0; j < ok.length; j++) row[j] = maps[j].get(dates[t]) / maps[j].get(dates[t - 1]) - 1;
    R.push(row);
  }
  return { syms: ok.map((s) => s.sym), R, dates: dates.slice(1) };
}

function demean(R) {
  const T = R.length;
  const N = R[0].length;
  const mu = new Float64Array(N);
  for (const r of R) for (let j = 0; j < N; j++) mu[j] += r[j] / T;
  return R.map((r) => r.map((v, j) => v - mu[j]));
}

// Covarianza muestral (1/(T-1)).
export function sampleCov(R) {
  const T = R.length;
  const N = R[0].length;
  const X = demean(R);
  const S = Array.from({ length: N }, () => new Float64Array(N));
  for (const x of X) {
    for (let i = 0; i < N; i++) {
      const xi = x[i];
      if (xi === 0) continue;
      const Si = S[i];
      for (let j = i; j < N; j++) Si[j] += xi * x[j];
    }
  }
  for (let i = 0; i < N; i++) {
    for (let j = i; j < N; j++) {
      S[i][j] /= T - 1;
      S[j][i] = S[i][j];
    }
  }
  return S;
}

// Ledoit & Wolf (2004), blanco = identidad escalada (igual que scikit-learn).
export function ledoitWolf(R) {
  const T = R.length;
  const N = R[0].length;
  const X = demean(R);
  const S = Array.from({ length: N }, () => new Float64Array(N));
  let sum4 = 0;
  for (const x of X) {
    let s2 = 0;
    for (let i = 0; i < N; i++) {
      const xi = x[i];
      s2 += xi * xi;
      const Si = S[i];
      for (let j = i; j < N; j++) Si[j] += xi * x[j];
    }
    sum4 += s2 * s2;
  }
  let tr = 0;
  let fro = 0;
  for (let i = 0; i < N; i++) {
    for (let j = i; j < N; j++) {
      const v = S[i][j] / T;
      S[i][j] = v;
      S[j][i] = v;
      fro += (i === j ? 1 : 2) * v * v;
      if (i === j) tr += v;
    }
  }
  const m = tr / N;
  const delta = (fro - 2 * m * tr + N * m * m) / N;
  const beta = Math.min((sum4 / T - fro) / (N * T), delta);
  const shrink = delta > 0 ? Math.max(0, beta / delta) : 0;
  const cov = S.map((row, i) => row.map((v, j) => (1 - shrink) * v + (i === j ? shrink * m : 0)));
  return { cov, shrink };
}

const matVec = (S, w) => S.map((row) => {
  let s = 0;
  for (let j = 0; j < row.length; j++) s += row[j] * w[j];
  return s;
});

function maxEig(S) {
  const N = S.length;
  let v = new Array(N).fill(1 / Math.sqrt(N));
  let lam = 0;
  for (let k = 0; k < 50; k++) {
    const u = matVec(S, v);
    const n = Math.sqrt(u.reduce((a, b) => a + b * b, 0)) || 1;
    lam = n;
    v = u.map((x) => x / n);
  }
  return lam;
}

// Proyección sobre { w : suma = 1, 0 <= w <= u } (bisección sobre el umbral).
function projCapped(v, u) {
  let lo = Math.min(...v) - u;
  let hi = Math.max(...v);
  for (let k = 0; k < 80; k++) {
    const mid = (lo + hi) / 2;
    let s = 0;
    for (const x of v) s += Math.min(u, Math.max(0, x - mid));
    if (s > 1) lo = mid;
    else hi = mid;
  }
  const tau = (lo + hi) / 2;
  return v.map((x) => Math.min(u, Math.max(0, x - tau)));
}

// Tope por empresa: recorta y reparte el sobrante en proporción entre las demás.
export function capWeights(w, cap) {
  const N = w.length;
  const u = Math.max(cap, 1 / N);
  let out = w.slice();
  for (let it = 0; it < 50; it++) {
    const over = out.reduce((s, x) => s + Math.max(0, x - u), 0);
    if (over < 1e-12) break;
    const free = out.reduce((s, x) => s + (x < u ? x : 0), 0);
    out = out.map((x) => (x >= u ? u : free > 0 ? x + (over * x) / free : x));
  }
  const s = out.reduce((a, b) => a + b, 0);
  return out.map((x) => x / s);
}

// Mínima varianza con solo compras y tope por empresa (gradiente proyectado acelerado).
export function minVariance(S, { cap = 1, iters = 3000 } = {}) {
  const N = S.length;
  const u = Math.max(cap, 1 / N + 1e-9);
  const L = 2 * maxEig(S) * 1.02;
  let w = new Array(N).fill(1 / N);
  let y = w.slice();
  let tk = 1;
  for (let it = 0; it < iters; it++) {
    const g = matVec(S, y);
    const wn = projCapped(y.map((x, i) => x - (2 * g[i]) / L), u);
    const tn = (1 + Math.sqrt(1 + 4 * tk * tk)) / 2;
    let diff = 0;
    for (let i = 0; i < N; i++) {
      diff += (wn[i] - w[i]) ** 2;
      y[i] = wn[i] + ((tk - 1) / tn) * (wn[i] - w[i]);
    }
    w = wn;
    tk = tn;
    if (diff < 1e-14) break;
  }
  return w;
}

export function invVolWeights(S) {
  const iv = S.map((r, i) => 1 / Math.sqrt(r[i]));
  const s = iv.reduce((a, b) => a + b, 0);
  return iv.map((x) => x / s);
}

// HRP (López de Prado, 2016): agrupamiento jerárquico (enlace simple) sobre la
// distancia de correlaciones, orden casi diagonal y bisección recursiva.
export function hrp(S) {
  const N = S.length;
  if (N === 1) return [1];
  const sd = S.map((r, i) => Math.sqrt(r[i]));
  const D = S.map((r, i) => r.map((x, j) => Math.sqrt(Math.max(0, 0.5 * (1 - x / (sd[i] * sd[j]))))));
  const CD = Array.from({ length: N }, () => new Float64Array(N));
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      let s = 0;
      for (let k = 0; k < N; k++) s += (D[k][i] - D[k][j]) ** 2;
      CD[i][j] = CD[j][i] = Math.sqrt(s);
    }
  }
  const order = Array.from({ length: N }, (_, i) => [i]);
  const active = new Array(N).fill(true);
  for (let step = 0; step < N - 1; step++) {
    let bi = -1;
    let bj = -1;
    let best = Infinity;
    for (let i = 0; i < N; i++) {
      if (!active[i]) continue;
      for (let j = i + 1; j < N; j++) {
        if (active[j] && CD[i][j] < best) {
          best = CD[i][j];
          bi = i;
          bj = j;
        }
      }
    }
    for (let k = 0; k < N; k++) {
      if (k !== bi && active[k]) CD[bi][k] = CD[k][bi] = Math.min(CD[bi][k], CD[bj][k]);
    }
    order[bi] = order[bi].concat(order[bj]);
    active[bj] = false;
  }
  const sorted = order[active.indexOf(true)];
  const cVar = (idx) => {
    const iv = idx.map((i) => 1 / S[i][i]);
    const s = iv.reduce((a, b) => a + b, 0);
    let v = 0;
    for (let a = 0; a < idx.length; a++) for (let b = 0; b < idx.length; b++) v += (iv[a] / s) * (iv[b] / s) * S[idx[a]][idx[b]];
    return v;
  };
  const w = new Array(N).fill(1);
  const stack = [sorted];
  while (stack.length) {
    const c = stack.pop();
    if (c.length < 2) continue;
    const h = Math.floor(c.length / 2);
    const c1 = c.slice(0, h);
    const c2 = c.slice(h);
    const v1 = cVar(c1);
    const v2 = cVar(c2);
    const alpha = 1 - v1 / (v1 + v2);
    for (const i of c1) w[i] *= alpha;
    for (const i of c2) w[i] *= 1 - alpha;
    stack.push(c1, c2);
  }
  return w;
}

// Pesos de un método a partir de la matriz de rendimientos diarios R (T x N).
export function buildWeights(method, R, { cap = 0.2 } = {}) {
  const N = R[0].length;
  let w;
  if (method === 'ew' || N === 1) w = new Array(N).fill(1 / N);
  else if (method === 'iv') w = invVolWeights(sampleCov(R));
  else if (method === 'mv') w = minVariance(ledoitWolf(R).cov, { cap });
  else if (method === 'hrp') w = hrp(sampleCov(R));
  else throw new Error('Método desconocido: ' + method);
  return capWeights(w, cap);
}

// Riesgo esperado del portafolio (anualizado) y aporte de cada empresa al riesgo.
export function portfolioRisk(w, S, ppy = 252) {
  const Sw = matVec(S, w);
  const v = w.reduce((s, x, i) => s + x * Sw[i], 0);
  const sdP = Math.sqrt(v);
  const avgSd = w.reduce((s, x, i) => s + x * Math.sqrt(S[i][i]), 0);
  return {
    vol: sdP * Math.sqrt(ppy),
    rc: w.map((x, i) => (v > 0 ? (x * Sw[i]) / v : 0)),
    divRatio: sdP > 0 ? avgSd / sdP : 1,
    effN: 1 / w.reduce((s, x) => s + x * x, 0),
  };
}

// Correlación promedio entre las acciones (a partir de la covarianza).
export function avgCorrelation(S) {
  const N = S.length;
  let s = 0;
  let n = 0;
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      s += S[i][j] / Math.sqrt(S[i][i] * S[j][j]);
      n++;
    }
  }
  return n ? s / n : NaN;
}

// Pesos -> acciones a comprar (algoritmo voraz, como PyPortfolioOpt).
// weights: { SYM: w }, prices: { SYM: p }.
export function discreteAllocation(weights, prices, total, { fractional = false } = {}) {
  const syms = Object.keys(weights).filter((s) => weights[s] > 0 && prices[s] > 0);
  const shares = {};
  let left = total;
  for (const s of syms) {
    const q = fractional ? Math.floor(((weights[s] * total) / prices[s]) * 1e4) / 1e4 : Math.floor((weights[s] * total) / prices[s]);
    shares[s] = q;
    left -= q * prices[s];
  }
  if (!fractional) {
    for (let guard = 0; guard < 10000; guard++) {
      let pick = null;
      let worst = -Infinity;
      for (const s of syms) {
        if (prices[s] > left) continue;
        const deficit = weights[s] - (shares[s] * prices[s]) / total;
        if (deficit > worst) {
          worst = deficit;
          pick = s;
        }
      }
      if (!pick) break;
      shares[pick]++;
      left -= prices[pick];
    }
  }
  const rows = syms.map((s) => ({ sym: s, shares: shares[s], price: prices[s], value: shares[s] * prices[s], target: weights[s], actual: (shares[s] * prices[s]) / total }))
    .sort((a, b) => b.target - a.target);
  return { rows, leftover: left, invested: total - left };
}
