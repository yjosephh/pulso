// Motor de análisis de Pulso.
// Combina: análisis técnico, fundamentales, consenso de analistas, sentimiento
// de noticias y 1,000 escenarios Monte Carlo por horizonte.
// Es un modelo algorítmico y educativo: NO predice el futuro.
import { mulberry32, hashStr, gaussFrom, isoDate } from './data.js';

const clamp = (x, a = -1, b = 1) => Math.max(a, Math.min(b, x));
const last = (arr) => arr[arr.length - 1];
const isNum = (v) => typeof v === 'number' && isFinite(v);

// ---------------------------------------------------------------------------
// Indicadores técnicos
// ---------------------------------------------------------------------------
export function sma(v, n) {
  const out = new Array(v.length).fill(null);
  let s = 0;
  for (let i = 0; i < v.length; i++) {
    s += v[i];
    if (i >= n) s -= v[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}

export function ema(v, n) {
  const out = new Array(v.length).fill(null);
  if (v.length < n) return out;
  const k = 2 / (n + 1);
  let prev = 0;
  for (let i = 0; i < n; i++) prev += v[i];
  prev /= n;
  out[n - 1] = prev;
  for (let i = n; i < v.length; i++) {
    prev = v[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rsi(c, n = 14) {
  const out = new Array(c.length).fill(null);
  if (c.length <= n) return out;
  let g = 0;
  let l = 0;
  for (let i = 1; i <= n; i++) {
    const d = c[i] - c[i - 1];
    if (d > 0) g += d;
    else l -= d;
  }
  g /= n;
  l /= n;
  out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = n + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n;
    l = (l * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

export function macd(c) {
  const e12 = ema(c, 12);
  const e26 = ema(c, 26);
  const line = c.map((_, i) => (e12[i] != null && e26[i] != null ? e12[i] - e26[i] : null));
  const start = line.findIndex((x) => x != null);
  const signal = new Array(c.length).fill(null);
  if (start >= 0) ema(line.slice(start), 9).forEach((x, j) => (signal[start + j] = x));
  const hist = line.map((x, i) => (x != null && signal[i] != null ? x - signal[i] : null));
  return { line, signal, hist };
}

function bollinger(c, n = 20, k = 2) {
  if (c.length < n) return null;
  const w = c.slice(-n);
  const mid = w.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(w.reduce((a, b) => a + (b - mid) ** 2, 0) / n);
  return { mid, upper: mid + k * sd, lower: mid - k * sd };
}

function volatility(c, n = 252) {
  const w = c.slice(-(n + 1));
  const rets = [];
  for (let i = 1; i < w.length; i++) rets.push(Math.log(w[i] / w[i - 1]));
  if (rets.length < 20) return null;
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((a, b) => a + (b - m) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(v * 252);
}

function maxDrawdown(c, n = 252) {
  const w = c.slice(-n);
  let peak = w[0];
  let mdd = 0;
  for (const x of w) {
    peak = Math.max(peak, x);
    mdd = Math.min(mdd, x / peak - 1);
  }
  return mdd;
}

function change(c, n) {
  if (c.length <= n) return null;
  return last(c) / c[c.length - 1 - n] - 1;
}

function crossedUp(a, b, lookback) {
  for (let i = a.length - lookback; i < a.length; i++) {
    if (i < 1 || a[i] == null || b[i] == null || a[i - 1] == null || b[i - 1] == null) continue;
    if (a[i - 1] <= b[i - 1] && a[i] > b[i]) return true;
  }
  return false;
}

function crossedDown(a, b, lookback) {
  for (let i = a.length - lookback; i < a.length; i++) {
    if (i < 1 || a[i] == null || b[i] == null || a[i - 1] == null || b[i - 1] == null) continue;
    if (a[i - 1] >= b[i - 1] && a[i] < b[i]) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Sentimiento de noticias (léxico bilingüe español / inglés)
// ---------------------------------------------------------------------------
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const POS = new Set(norm(
  'beat beats surge surges soar soars jump jumps rally rallies record gain gains growth upgrade upgraded ' +
  'strong strength profit profits raise raises raised bullish outperform boost boosts win wins expands expansion ' +
  'approval approved partnership breakthrough tops higher rise rises optimism rebound buyback dividend ' +
  'supera superan sube suben dispara disparan record ganancia ganancias crecimiento eleva elevan mejora mejoran fuerte ' +
  'alianza aprobacion impulsa impulsan rebote optimismo maximos beneficio beneficios recompra solidos demanda'
).split(/\s+/));

const NEG = new Set(norm(
  'miss misses plunge plunges fall falls drop drops slump slumps cut cuts downgrade downgraded weak weakness loss losses ' +
  'lawsuit probe investigation fine fined recall bearish underperform layoffs decline declines lower warning warns ' +
  'fears fear tariff tariffs crash bankruptcy fraud antitrust slowdown recession selloff ' +
  'cae caen caida desploma desploman perdida perdidas demanda colectiva investigacion multa recorte recortes debil ' +
  'despidos advierte riesgo aranceles temor temores minimos rebaja rebajan desaceleracion presiona sacude'
).split(/\s+/));

export function sentiment(text) {
  const words = norm(text || '').split(/[^a-z0-9]+/);
  let p = 0;
  let n = 0;
  for (const w of words) {
    if (POS.has(w)) p++;
    if (NEG.has(w)) n++;
  }
  if (p + n === 0) return 0;
  return (p - n) / (p + n);
}

export function newsSentiment(items) {
  if (!items || !items.length) return { score: 0, count: 0 };
  const recent = items.slice(0, 15);
  const scores = recent.map((x) => sentiment(x.headline + ' ' + (x.summary || '')));
  return { score: scores.reduce((a, b) => a + b, 0) / scores.length, count: recent.length };
}

// ---------------------------------------------------------------------------
// Monte Carlo: 1,000 escenarios de precio (movimiento browniano geométrico)
// ---------------------------------------------------------------------------
export function monteCarlo({ price, mu, sigma, days, paths = 1000, levels = [], fanPoints = 0, seed = 1 }) {
  const rng = mulberry32(seed);
  const dt = 1 / 252;
  const drift = (mu - 0.5 * sigma * sigma) * dt;
  const vol = sigma * Math.sqrt(dt);
  const finals = new Float64Array(paths);
  const hits = levels.map(() => 0);
  const fanSet = new Set();
  for (let k = 1; k <= fanPoints; k++) fanSet.add(Math.max(1, Math.round((days * k) / fanPoints)));
  const fanSteps = [...fanSet].sort((a, b) => a - b);
  const fanVals = fanSteps.map(() => new Float64Array(paths));

  for (let p = 0; p < paths; p++) {
    let s = price;
    let lo = s;
    let hi = s;
    let f = 0;
    for (let d = 1; d <= days; d++) {
      s *= Math.exp(drift + vol * gaussFrom(rng));
      if (s < lo) lo = s;
      if (s > hi) hi = s;
      while (f < fanSteps.length && d === fanSteps[f]) {
        fanVals[f][p] = s;
        f++;
      }
    }
    finals[p] = s;
    levels.forEach((lv, i) => {
      if ((lv <= price && lo <= lv) || (lv > price && hi >= lv)) hits[i]++;
    });
  }

  const sorted = Array.from(finals).sort((a, b) => a - b);
  const q = (arr, x) => arr[Math.min(arr.length - 1, Math.floor(x * arr.length))];
  let up = 0;
  for (const v of finals) if (v > price) up++;

  return {
    days,
    paths,
    mu,
    sigma,
    probUp: up / paths,
    p5: q(sorted, 0.05),
    p25: q(sorted, 0.25),
    p50: q(sorted, 0.5),
    p75: q(sorted, 0.75),
    p95: q(sorted, 0.95),
    levelProb: hits.map((h) => h / paths),
    fan: fanSteps.map((d, k) => {
      const s = Array.from(fanVals[k]).sort((a, b) => a - b);
      return { d, p5: q(s, 0.05), p25: q(s, 0.25), p50: q(s, 0.5), p75: q(s, 0.75), p95: q(s, 0.95) };
    }),
  };
}

// Supuestos del modelo: deriva histórica "encogida" hacia el promedio del
// mercado (~8% anual) para no extrapolar rachas, y volatilidad histórica.
export function mcParams(a) {
  const sigma = clamp(a.tech.vol || 0.3, 0.08, 1.2);
  const hist = isNum(a.tech.mom12m) ? a.tech.mom12m : 0.08;
  const mu = clamp(0.4 * hist + 0.6 * 0.08, -0.25, 0.35);
  return { mu, sigma };
}

export function simulate(a, days, opts = {}) {
  const { mu, sigma } = mcParams(a);
  return monteCarlo({
    price: a.price,
    mu,
    sigma,
    days,
    levels: opts.levels || [],
    fanPoints: opts.fanPoints || 0,
    seed: hashStr(a.sym + days + isoDate()),
  });
}

// ---------------------------------------------------------------------------
// Análisis completo de una empresa
// ---------------------------------------------------------------------------
const pctTxt = (x, d = 1) => (x >= 0 ? '+' : '') + (x * 100).toFixed(d) + '%';

export function analyze({ meta, history, quote, fund, rec, news }) {
  const a = {
    sym: meta.s,
    name: meta.n,
    sec: meta.sec,
    cur: meta.cur || '$',
    partial: false,
    tech: {},
    fund: fund || null,
    analyst: null,
    news: newsSentiment(news),
    factors: { short: [], long: [] },
    pros: [],
    cons: [],
    events: [],
    updated: Date.now(),
  };

  // Serie de cierres + precio en vivo
  const bars = history ? history.slice() : [];
  const closes = bars.map((b) => b.close);
  if (quote && isNum(quote.price) && closes.length) {
    const qd = isoDate(new Date(quote.ts || Date.now()));
    const lastDate = last(bars).time;
    if (qd === lastDate) closes[closes.length - 1] = quote.price;
    else if (qd > lastDate) closes.push(quote.price);
  }
  a.price = quote && isNum(quote.price) ? quote.price : closes.length ? last(closes) : null;
  a.changePct = quote && isNum(quote.changePct) ? quote.changePct : 0;
  a.prevClose = quote ? quote.prevClose : null;
  if (!isNum(a.price)) throw new Error('Sin precio disponible');

  const S = a.factors.short;
  const L = a.factors.long;
  const add = (arr, key, label, value, w) => arr.push({ key, label, value: clamp(value), w });

  // ---------------- Técnico ----------------
  const hasTech = closes.length >= 60;
  if (hasTech) {
    const p = a.price;
    const s20 = sma(closes, 20);
    const s50 = sma(closes, 50);
    const s200 = sma(closes, 200);
    const r = rsi(closes);
    const m = macd(closes);
    const t = a.tech;
    t.sma20 = last(s20);
    t.sma50 = last(s50);
    t.sma200 = last(s200);
    t.rsi = last(r);
    t.macd = last(m.line);
    t.macdSignal = last(m.signal);
    t.macdHist = last(m.hist);
    t.bb = bollinger(closes);
    t.vol = volatility(closes);
    t.mdd = maxDrawdown(closes);
    t.mom1m = change(closes, 21);
    t.mom3m = change(closes, 63);
    t.mom6m = change(closes, 126);
    t.mom12m = change(closes, 252) ?? change(closes, closes.length - 1);
    const win = closes.slice(-252);
    t.high52 = Math.max(...win);
    t.low52 = Math.min(...win);
    t.dist52h = p / t.high52 - 1;

    // Corto plazo
    add(S, 'trend20', 'Precio vs media 20 días', (p / t.sma20 - 1) / 0.05, 1.5);
    add(S, 'trend50', 'Precio vs media 50 días', (p / t.sma50 - 1) / 0.08, 1);
    if (isNum(t.macdHist)) add(S, 'macd', 'Impulso MACD', t.macdHist / (p * 0.01), 1.5);
    if (isNum(t.rsi)) {
      const rv = t.rsi < 30 ? 0.6 : t.rsi < 45 ? 0.15 : t.rsi < 65 ? 0.45 : t.rsi < 75 ? -0.15 : -0.85;
      add(S, 'rsi', 'RSI (sobrecompra / sobreventa)', rv, 1.5);
    }
    if (isNum(t.mom1m)) add(S, 'mom1m', 'Rendimiento último mes', t.mom1m / 0.1, 1);

    // Largo plazo
    if (isNum(t.sma200)) {
      add(L, 'trend200', 'Precio vs media 200 días', (p / t.sma200 - 1) / 0.15, 1.5);
      add(L, 'golden', 'Cruce SMA50 / SMA200', t.sma50 > t.sma200 ? 0.7 : -0.7, 1);
    }
    if (isNum(t.mom12m)) add(L, 'mom12m', 'Rendimiento 12 meses', t.mom12m / 0.3, 1);
    if (isNum(t.vol)) {
      const riskV = (t.vol > 0.45 ? -0.6 : t.vol > 0.3 ? -0.15 : 0.3) + (t.mdd < -0.4 ? -0.4 : t.mdd < -0.25 ? -0.15 : 0.1);
      add(L, 'risk', 'Volatilidad y caídas', riskV, 1);
    }

    // Eventos técnicos recientes (disparan notificaciones)
    if (crossedUp(m.line, m.signal, 3)) a.events.push({ type: 'buy', txt: 'Cruce alcista del MACD' });
    if (crossedDown(m.line, m.signal, 3)) a.events.push({ type: 'sell', txt: 'Cruce bajista del MACD' });
    if (crossedUp(s50, s200, 5)) a.events.push({ type: 'buy', txt: 'Cruce dorado (SMA50 sobre SMA200)' });
    if (crossedDown(s50, s200, 5)) a.events.push({ type: 'sell', txt: 'Cruce de la muerte (SMA50 bajo SMA200)' });
    const thirty = r.map(() => 30);
    if (crossedUp(r, thirty, 3)) a.events.push({ type: 'buy', txt: 'RSI sale de sobreventa (posible rebote)' });
    if (t.rsi > 75) a.events.push({ type: 'sell', txt: 'RSI en sobrecompra extrema' });
    if (crossedUp(closes, s50, 2)) a.events.push({ type: 'buy', txt: 'Rompe al alza su media de 50 días' });
    if (crossedDown(closes, s200, 2)) a.events.push({ type: 'sell', txt: 'Pierde su media de 200 días' });
    if (p >= t.high52 * 0.999) a.events.push({ type: 'info', txt: 'Nuevo máximo de 52 semanas' });

    // Pros / contras técnicos
    if (isNum(t.sma200)) {
      if (p > t.sma200) a.pros.push('Cotiza sobre su media de 200 días: tendencia de fondo alcista.');
      else a.cons.push('Cotiza bajo su media de 200 días: tendencia de fondo bajista.');
      if (t.sma50 > t.sma200) a.pros.push('Media de 50 días por encima de la de 200 (estructura sana).');
      else a.cons.push('Media de 50 días por debajo de la de 200 (estructura débil).');
    }
    if (t.rsi > 70) a.cons.push(`RSI en ${t.rsi.toFixed(0)}: sobrecomprada, riesgo de corrección a corto plazo.`);
    else if (t.rsi < 30) a.pros.push(`RSI en ${t.rsi.toFixed(0)}: sobrevendida, posible rebote técnico.`);
    if (t.macdHist > 0) a.pros.push('MACD positivo: el impulso de corto plazo es comprador.');
    else a.cons.push('MACD negativo: el impulso de corto plazo es vendedor.');
    if (t.vol > 0.45) a.cons.push(`Volatilidad muy alta (${(t.vol * 100).toFixed(0)}% anual): movimientos bruscos.`);
    else if (t.vol < 0.22) a.pros.push(`Volatilidad baja (${(t.vol * 100).toFixed(0)}% anual): acción estable.`);
    if (t.mdd < -0.3) a.cons.push(`Llegó a caer ${pctTxt(t.mdd, 0)} desde su máximo en el último año.`);
    if (t.dist52h > -0.03) a.pros.push('Cerca de máximos de 52 semanas (fuerza relativa).');
    else if (t.dist52h < -0.3) a.cons.push(`Está ${pctTxt(t.dist52h, 0)} por debajo de su máximo anual.`);
  } else {
    a.partial = true;
    if (fund && isNum(fund.high52) && isNum(fund.low52)) {
      a.tech.high52 = fund.high52;
      a.tech.low52 = fund.low52;
      a.tech.dist52h = a.price / fund.high52 - 1;
    }
  }

  // ---------------- Fundamentales ----------------
  const f = fund || {};
  if (fund) {
    if (isNum(f.netMargin) || isNum(f.roe)) {
      const mv = isNum(f.netMargin) ? clamp((f.netMargin - 8) / 15) : 0;
      const rv = isNum(f.roe) ? clamp((f.roe - 12) / 20) : 0;
      add(L, 'quality', 'Calidad (márgenes y ROE)', (mv + rv) / (isNum(f.netMargin) && isNum(f.roe) ? 2 : 1), 2);
    }
    if (isNum(f.revGrowth) || isNum(f.epsGrowth)) {
      const g = isNum(f.revGrowth) ? f.revGrowth : f.epsGrowth;
      const ge = isNum(f.epsGrowth) ? f.epsGrowth : g;
      add(L, 'growth', 'Crecimiento de ventas y utilidades', (clamp((g - 3) / 15) * 2 + clamp(ge / 25)) / 3, 1.5);
    }
    if (isNum(f.pe) || f.pe === null) {
      const g = isNum(f.epsGrowth) ? f.epsGrowth : isNum(f.revGrowth) ? f.revGrowth : 5;
      let v;
      if (!isNum(f.pe) || f.pe <= 0) v = -0.5;
      else {
        const peg = f.pe / Math.max(g, 2);
        v = f.pe < 15 ? 0.6 : peg < 1.2 ? 0.5 : peg < 2 ? 0.15 : peg < 3 ? -0.25 : -0.7;
        if (f.pe > 60) v = Math.min(v, -0.4);
      }
      add(L, 'value', 'Valuación (P/E vs crecimiento)', v, 1.5);
    }
    if (isNum(f.debtEq)) add(L, 'debt', 'Endeudamiento', f.debtEq < 0.5 ? 0.5 : f.debtEq < 1.5 ? 0.1 : f.debtEq < 2.5 ? -0.3 : -0.6, 0.75);
    if (isNum(f.divYield) && f.divYield > 0) add(L, 'div', 'Dividendo', clamp(f.divYield / 3, 0, 1) * 0.6, 0.5);

    if (isNum(f.netMargin)) {
      if (f.netMargin > 20) a.pros.push(`Márgenes netos altos (${f.netMargin.toFixed(1)}%): negocio muy rentable.`);
      else if (f.netMargin < 5) a.cons.push(`Márgenes netos bajos (${f.netMargin.toFixed(1)}%).`);
    }
    if (isNum(f.roe) && f.roe > 25) a.pros.push(`ROE de ${f.roe.toFixed(0)}%: usa muy bien el capital.`);
    if (isNum(f.revGrowth)) {
      if (f.revGrowth > 12) a.pros.push(`Ventas creciendo ${f.revGrowth.toFixed(1)}% anual.`);
      else if (f.revGrowth < 0) a.cons.push(`Ventas cayendo (${f.revGrowth.toFixed(1)}% anual).`);
    }
    if (isNum(f.pe) && f.pe > 0) {
      if (f.pe > 45) a.cons.push(`Valuación exigente (P/E ${f.pe.toFixed(0)}): el mercado ya descuenta mucho crecimiento.`);
      else if (f.pe < 18) a.pros.push(`Valuación razonable (P/E ${f.pe.toFixed(1)}).`);
    } else if (f.pe !== undefined) {
      a.cons.push('Sin utilidades positivas recientes (P/E no disponible).');
    }
    if (isNum(f.debtEq) && f.debtEq > 2) a.cons.push(`Deuda elevada (deuda/capital ${f.debtEq.toFixed(1)}).`);
    if (isNum(f.divYield) && f.divYield >= 2) a.pros.push(`Paga dividendo de ${f.divYield.toFixed(1)}% anual.`);
  } else {
    a.partial = true;
  }

  // ---------------- Analistas ----------------
  if (rec) {
    const buy = (rec.strongBuy || 0) + (rec.buy || 0);
    const sell = (rec.strongSell || 0) + (rec.sell || 0);
    const total = buy + sell + (rec.hold || 0);
    if (total > 0) {
      a.analyst = { buy, sell, hold: rec.hold || 0, total, buyPct: buy / total, sellPct: sell / total };
      add(L, 'analysts', 'Consenso de analistas', (a.analyst.buyPct - 0.5) * 2 - a.analyst.sellPct, 1.5);
      add(S, 'analysts', 'Consenso de analistas', (a.analyst.buyPct - 0.5) * 2, 0.5);
      if (a.analyst.buyPct >= 0.7) a.pros.push(`${Math.round(a.analyst.buyPct * 100)}% de los analistas recomienda comprar.`);
      else if (a.analyst.buyPct < 0.4) a.cons.push(`Solo ${Math.round(a.analyst.buyPct * 100)}% de los analistas recomienda comprar.`);
    }
  }

  // ---------------- Noticias ----------------
  if (a.news.count > 0) {
    add(S, 'news', 'Sentimiento de noticias', a.news.score * 2, 1);
    add(L, 'news', 'Sentimiento de noticias', a.news.score * 1.5, 0.4);
    if (a.news.score > 0.15) a.pros.push('Noticias recientes con tono mayormente positivo.');
    else if (a.news.score < -0.15) a.cons.push('Noticias recientes con tono mayormente negativo.');
  }

  // ---------------- Monte Carlo (1,000 + 1,000 escenarios) ----------------
  if (isNum(a.tech.vol)) {
    a.mcShort = simulate(a, 21);
    a.mcLong = simulate(a, 252);
    add(S, 'mc', 'Simulación 1 mes (1,000 escenarios)', (a.mcShort.probUp - 0.5) * 4, 0.5);
    add(L, 'mc', 'Simulación 1 año (1,000 escenarios)', (a.mcLong.probUp - 0.5) * 3, 0.5);
    const med = a.mcLong.p50 / a.price - 1;
    const worst = a.mcLong.p5 / a.price - 1;
    if (worst < -0.4) a.cons.push(`En el 5% de escenarios más malos podría perder ${pctTxt(worst, 0)} en un año.`);
    if (a.mcLong.probUp > 0.6) a.pros.push(`Gana en ${Math.round(a.mcLong.probUp * 100)}% de 1,000 escenarios simulados a 1 año (mediana ${pctTxt(med)}).`);
  }

  // ---------------- Puntajes ----------------
  const score = (arr) => {
    const w = arr.reduce((s, x) => s + x.w, 0);
    if (!w) return 50;
    return Math.round(50 + (50 * arr.reduce((s, x) => s + x.w * x.value, 0)) / w);
  };
  a.scoreShort = score(S);
  a.scoreLong = score(L);

  // Riesgo
  const beta = isNum(f.beta) ? f.beta : 1;
  const vol = isNum(a.tech.vol) ? a.tech.vol : 0.3;
  const mdd = isNum(a.tech.mdd) ? a.tech.mdd : -0.2;
  const riskScore = clamp(vol / 0.6, 0, 1) * 0.5 + clamp(Math.abs(mdd) / 0.5, 0, 1) * 0.3 + clamp(beta / 2, 0, 1) * 0.2;
  a.riskScore = riskScore;
  a.risk = riskScore < 0.33 ? 'Bajo' : riskScore < 0.55 ? 'Medio' : 'Alto';

  // Señal de trading (corto plazo)
  const s = a.scoreShort;
  a.signal = s >= 80 ? 'COMPRA FUERTE' : s >= 66 ? 'COMPRA' : s <= 20 ? 'VENTA FUERTE' : s <= 34 ? 'VENTA' : 'MANTENER';
  a.signalType = s >= 66 ? 'buy' : s <= 34 ? 'sell' : 'hold';

  // Horizonte y veredicto honesto
  const l = a.scoreLong;
  let v;
  if (l >= 65 && s >= 60) {
    v = { tone: 'good', emoji: '🚀', title: 'Pinta bien', horizon: 'Corto y largo plazo',
      text: 'Fundamentales sólidos y tendencia a favor. El modelo la ve atractiva tanto para operar a corto plazo como para mantener a largo plazo.' };
  } else if (l >= 65 && s < 45) {
    v = { tone: 'good', emoji: '🧭', title: 'Buena empresa, mal momento', horizon: 'Largo plazo',
      text: 'La empresa es de calidad, pero el precio viene débil. Para largo plazo el modelo la ve bien; a corto plazo todavía podría seguir cayendo.' };
  } else if (l >= 62) {
    v = { tone: 'good', emoji: '🌱', title: 'Sólida para largo plazo', horizon: 'Largo plazo',
      text: 'Buenos fundamentales y tendencia de fondo positiva. A corto plazo no hay una señal clara, así que el modelo la ve más para mantener con paciencia.' };
  } else if (s >= 66 && l < 50) {
    v = { tone: 'warn', emoji: '⚡', title: 'Solo especulativa', horizon: 'Corto plazo',
      text: 'Tiene impulso fuerte a corto plazo, pero los fundamentales no justifican una inversión de largo plazo. Si se opera, es de riesgo alto y con salida planeada.' };
  } else if (s >= 62) {
    v = { tone: 'warn', emoji: '📈', title: 'Oportunidad de corto plazo', horizon: 'Corto plazo',
      text: 'El momento técnico es favorable, aunque el largo plazo es apenas neutral. El modelo la ve más para una operación corta que para mantener años.' };
  } else if (l < 40 && s < 42) {
    v = { tone: 'bad', emoji: '🛑', title: 'Mala idea por ahora', horizon: 'Ninguno',
      text: 'Tendencia bajista y fundamentales débiles o caros. Siendo sinceros, el modelo no ve ventaja en invertir aquí en este momento.' };
  } else if (s <= 34) {
    v = { tone: 'bad', emoji: '📉', title: 'Presión vendedora', horizon: 'Esperar',
      text: 'El precio está perdiendo fuerza a corto plazo. El modelo sugiere esperar a que se estabilice antes de considerar entrar.' };
  } else {
    v = { tone: 'neutral', emoji: '✋', title: 'Esperar', horizon: 'Esperar',
      text: 'Sin ventaja clara ni a corto ni a largo plazo. El modelo sugiere vigilarla y esperar una mejor señal.' };
  }
  a.verdict = v;
  if (a.partial) {
    a.verdict.text += ' (Análisis parcial: faltan datos de historial o fundamentales.)';
  }
  return a;
}

// ---------------------------------------------------------------------------
// Pulso general del mercado
// ---------------------------------------------------------------------------
export function marketPulse(analyses, sectorList) {
  const list = Object.values(analyses).filter((a) => a && !a.error);
  if (!list.length) return null;
  const withTech = list.filter((a) => isNum(a.tech.sma50));
  const share = (arr, fn) => (arr.length ? arr.filter(fn).length / arr.length : 0.5);
  const avg = (arr) => (arr.length ? arr.reduce((x, y) => x + y, 0) / arr.length : 0);

  const above50 = share(withTech, (a) => a.price > a.tech.sma50);
  const above200 = share(withTech.filter((a) => isNum(a.tech.sma200)), (a) => a.price > a.tech.sma200);
  const avgRsi = avg(withTech.map((a) => a.tech.rsi).filter(isNum));
  const posMom = share(withTech, (a) => a.tech.mom1m > 0);
  const avgChg = avg(list.map((a) => a.changePct || 0));
  const avgNews = avg(list.filter((a) => a.news.count).map((a) => a.news.score));

  const score = Math.round(100 * (
    0.3 * above50 +
    0.15 * above200 +
    0.2 * clamp((avgRsi - 30) / 40, 0, 1) +
    0.15 * posMom +
    0.1 * clamp(0.5 + avgChg / 4, 0, 1) +
    0.1 * clamp(0.5 + avgNews, 0, 1)
  ));
  const label = score < 20 ? 'Miedo extremo' : score < 40 ? 'Miedo' : score < 60 ? 'Neutral' : score < 80 ? 'Codicia' : 'Euforia';

  const sectors = sectorList.map((sec) => {
    const items = list.filter((a) => a.sec === sec.id);
    return {
      ...sec,
      count: items.length,
      change: avg(items.map((a) => a.changePct || 0)),
      long: Math.round(avg(items.map((a) => a.scoreLong))),
      short: Math.round(avg(items.map((a) => a.scoreShort))),
    };
  }).filter((x) => x.count);
  const byChange = sectors.slice().sort((a, b) => b.change - a.change);
  const best = byChange[0];
  const worst = byChange[byChange.length - 1];
  const buys = list.filter((a) => a.signalType === 'buy').length;
  const sells = list.filter((a) => a.signalType === 'sell').length;

  const mood = {
    'Miedo extremo': 'El mercado está en pánico: muchas empresas en caída y noticias negativas. Históricamente, el miedo extremo a veces abre oportunidades de largo plazo, pero el corto plazo es peligroso.',
    Miedo: 'El mercado está defensivo: predominan las caídas y el impulso es débil. Conviene priorizar empresas de calidad y no perseguir rebotes.',
    Neutral: 'El mercado está indeciso, sin una dirección clara. Es un momento para ser selectivo.',
    Codicia: 'El mercado está optimista: la mayoría de las empresas sube con buen impulso. Ojo con comprar lo que ya subió demasiado.',
    Euforia: 'El mercado está eufórico: subidas generalizadas y RSI elevados. En estas fases el riesgo de corrección aumenta.',
  }[label];

  const summary = `${mood} ${Math.round(above50 * 100)}% de las empresas analizadas cotiza sobre su media de 50 días. ` +
    (best && worst && best !== worst
      ? `Hoy lidera ${best.name} (${best.change >= 0 ? '+' : ''}${best.change.toFixed(2)}%) y el más débil es ${worst.name} (${worst.change >= 0 ? '+' : ''}${worst.change.toFixed(2)}%). `
      : '') +
    `El modelo detecta ${buys} señal${buys === 1 ? '' : 'es'} de compra y ${sells} de venta.`;

  return { score, label, above50, above200, avgRsi, posMom, avgChg, avgNews, sectors, best, worst, buys, sells, summary, count: list.length };
}
