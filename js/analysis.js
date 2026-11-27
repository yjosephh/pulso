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
    t.macdHistPrev = m.hist[m.hist.length - 2];
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

// ---------------------------------------------------------------------------
// ANÁLISIS PROFUNDO (empresas en seguimiento)
// 10,000+ escenarios con impacto de noticias de último momento.
// El "margen de error" medido es el de la SIMULACIÓN (precisión del cálculo),
// no el del precio futuro: ningún modelo predice el mercado con 1% de error.
// ---------------------------------------------------------------------------

// Choques con "colas gruesas" (t de Student, 4 grados de libertad) escalados a
// varianza 1: las caídas y subidas bruscas son más realistas que con la normal.
function studentT(rng, df = 4) {
  const z = gaussFrom(rng);
  let c = 0;
  for (let i = 0; i < df; i++) {
    const g = gaussFrom(rng);
    c += g * g;
  }
  return (z / Math.sqrt(c / df)) * Math.sqrt((df - 2) / df);
}

// Sentimiento de las noticias de las últimas 72 h, pesando más las recientes.
export function newsImpact(items, now = Date.now()) {
  const nowS = now / 1000;
  const recent = (items || []).filter((n) => n && n.datetime && nowS - n.datetime < 72 * 3600 && nowS - n.datetime > -3600);
  const out = { score: 0, count: recent.length, fresh: 0, pos: 0, neg: 0, latest: null };
  if (!recent.length) return out;
  let sw = 0;
  let ws = 0;
  for (const n of recent) {
    const age = Math.max(0, (nowS - n.datetime) / 3600);
    const w = Math.exp(-age / 24);
    const s = sentiment(n.headline + ' ' + (n.summary || ''));
    sw += w;
    ws += w * s;
    if (s > 0.1) out.pos++;
    else if (s < -0.1) out.neg++;
    if (age < 24) out.fresh++;
  }
  out.score = ws / sw;
  out.latest = recent.slice().sort((a, b) => b.datetime - a.datetime)[0];
  return out;
}

function summarize(arr, price) {
  const s = arr.slice().sort();
  const q = (x) => s[Math.min(s.length - 1, Math.floor(x * s.length))];
  let up = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i] > price) up++;
  return { p5: q(0.05), p25: q(0.25), p50: q(0.5), p75: q(0.75), p95: q(0.95), probUp: up / arr.length };
}

// Margen de error (95%) de la mediana por el método de lotes.
function batchMoe(arr, B = 20) {
  const n = Math.floor(arr.length / B);
  const meds = [];
  for (let b = 0; b < B; b++) {
    const s = arr.slice(b * n, (b + 1) * n).sort();
    meds.push(s[Math.floor(n / 2)]);
  }
  const m = meds.reduce((x, y) => x + y, 0) / B;
  const sd = Math.sqrt(meds.reduce((x, y) => x + (y - m) ** 2, 0) / (B - 1));
  return (1.96 * sd) / Math.sqrt(B) / m;
}

function runDeep({ price, mu, muNews, sigma, N, seed }) {
  const rng = mulberry32(seed);
  const dt = 1 / 252;
  const sd = sigma * Math.sqrt(dt);
  const v1 = new Float64Array(N);
  const v5 = new Float64Array(N);
  const v21 = new Float64Array(N);
  const lo5 = new Float64Array(N);
  const hi5 = new Float64Array(N);
  // El efecto de las noticias se desvanece en unos días (vida media ~3 días).
  const drifts = [];
  for (let d = 1; d <= 21; d++) drifts.push((mu + muNews * Math.exp(-(d - 1) / 4) - 0.5 * sigma * sigma) * dt);
  for (let p = 0; p < N; p++) {
    let s = price;
    let lo = price;
    let hi = price;
    for (let d = 1; d <= 21; d++) {
      s *= Math.exp(drifts[d - 1] + sd * studentT(rng));
      if (d <= 5) {
        if (s < lo) lo = s;
        if (s > hi) hi = s;
      }
      if (d === 1) v1[p] = s;
      else if (d === 5) {
        v5[p] = s;
        lo5[p] = lo;
        hi5[p] = hi;
      }
    }
    v21[p] = s;
  }
  const h = { 1: summarize(v1, price), 5: summarize(v5, price), 21: summarize(v21, price) };
  const probMoe = Math.max(...[1, 5, 21].map((k) => 1.96 * Math.sqrt((h[k].probUp * (1 - h[k].probUp)) / N)));
  const medMoe = Math.max(batchMoe(v1), batchMoe(v5), batchMoe(v21));
  const loS = lo5.slice().sort();
  const hiS = hi5.slice().sort();
  return {
    N,
    h,
    moe: Math.max(probMoe, medMoe),
    probMoe,
    medMoe,
    low5: loS[Math.floor(N / 2)],
    high5: hiS[Math.floor(N / 2)],
  };
}

export function deepAnalysis(a, news, { paths = 10000, maxPaths = 40000, maxMoe = 0.01 } = {}) {
  if (!a || a.error || !isNum(a.price) || !isNum(a.tech.vol)) return null;
  const price = a.price;
  const { mu, sigma } = mcParams(a);
  const ni = newsImpact(news);
  const intensity = Math.min(1, ni.fresh / 3 + ni.count / 12);
  // Noticias positivas/negativas inclinan la tendencia de corto plazo y,
  // si son fuertes, aumentan la volatilidad esperada.
  const muNews = clamp(ni.score * 1.2 * (0.4 + 0.6 * intensity), -1.2, 1.2);
  const sigmaEff = sigma * (1 + 0.35 * Math.abs(ni.score) * (0.3 + 0.7 * intensity));
  const seed = hashStr(a.sym + ':' + price.toFixed(2) + ':' + ni.count + ':' + isoDate());

  // Si el margen de error supera el 1%, duplicamos los escenarios (hasta 40,000).
  let N = paths;
  let sim;
  for (;;) {
    sim = runDeep({ price, mu, muNews, sigma: sigmaEff, N, seed });
    if (sim.moe <= maxMoe || N >= maxPaths) break;
    N = Math.min(maxPaths, N * 2);
  }
  let newsWeek = 0;
  for (let d = 1; d <= 5; d++) newsWeek += (muNews * Math.exp(-(d - 1) / 4)) / 252;

  const d = { sym: a.sym, price, cur: a.cur, ...sim, news: ni, params: { mu, muNews, sigma, sigmaEff, newsWeek } };
  d.rec = recommend(a, d);
  return d;
}

const REC_META = {
  'buy-now': { emoji: '🟢', label: 'COMPRA AHORA', kind: 'buy' },
  'buy-wait': { emoji: '🟡', label: 'PREFERIBLE ESPERAR UNOS DÍAS PARA COMPRAR', kind: 'info' },
  'sell-wait': { emoji: '🟠', label: 'VENDE EN UNOS DÍAS', kind: 'info' },
  'sell-now': { emoji: '🔴', label: 'VENDE AHORA', kind: 'sell' },
  hold: { emoji: '⚪', label: 'MANTÉN Y VIGILA', kind: 'info' },
};

function recommend(a, d) {
  const t = a.tech;
  const p = a.price;
  const m$ = (v) => a.cur + (v >= 10000 ? Math.round(v).toLocaleString('en-US') : v.toFixed(2));
  const pc = (v) => (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
  const h5 = d.h[5];
  const up5 = h5.probUp;
  const med5 = h5.p50 / p - 1;
  const bb = t.bb;
  const bbPos = bb && bb.upper > bb.lower ? (p - bb.lower) / (bb.upper - bb.lower) : 0.5;
  const rsiV = isNum(t.rsi) ? t.rsi : 50;
  const macdUp = isNum(t.macdHist) && isNum(t.macdHistPrev) ? t.macdHist > t.macdHistPrev : null;
  const ns = d.news.count ? d.news.score : 0;
  const low = bbPos < 0.3 || rsiV < 40;
  const high = bbPos > 0.8 || rsiV > 65;
  const longS = a.scoreLong;

  const reasons = [
    { k: 'rsi', txt: `RSI ${rsiV.toFixed(0)} (${rsiV < 40 ? 'bajo' : rsiV > 65 ? 'alto' : 'medio'})`, dir: rsiV < 40 ? 1 : rsiV > 65 ? -1 : 0 },
    { k: 'zone', txt: `Precio en zona ${bbPos < 0.3 ? 'baja' : bbPos > 0.8 ? 'alta' : 'media'} de su rango de 20 días`, dir: bbPos < 0.3 ? 1 : bbPos > 0.8 ? -1 : 0 },
  ];
  if (macdUp != null) reasons.push({ k: 'macd', txt: macdUp ? 'Impulso (MACD) girando al alza' : 'Impulso (MACD) perdiendo fuerza', dir: macdUp ? 1 : -1 });
  if (d.news.count) reasons.push({ k: 'news', txt: `Noticias 72 h: ${ns > 0.1 ? 'positivas' : ns < -0.1 ? 'negativas' : 'neutrales'} (${d.news.count})`, dir: ns > 0.1 ? 1 : ns < -0.1 ? -1 : 0 });
  reasons.push({ k: 'mc', txt: `Prob. de subir en 1 semana: ${Math.round(up5 * 100)}%`, dir: up5 > 0.52 ? 1 : up5 < 0.48 ? -1 : 0 });
  reasons.push({ k: 'long', txt: `Largo plazo ${longS}/100`, dir: longS >= 60 ? 1 : longS < 45 ? -1 : 0 });

  let code;
  let weak = false;
  if (high && (up5 < 0.48 || ns < -0.2 || (macdUp === false && rsiV > 70))) code = 'sell-now';
  else if (longS < 40 && a.scoreShort < 35 && ns <= 0 && !low) {
    code = 'sell-now';
    weak = true;
  } else if (high && macdUp !== false && up5 >= 0.48) code = 'sell-wait';
  else if (low && longS >= 55 && (macdUp === true || up5 >= 0.52) && ns > -0.15) code = 'buy-now';
  else if (bbPos < 0.55 && longS >= 45 && (med5 < 0 || ns < -0.15 || macdUp === false)) code = 'buy-wait';
  else code = 'hold';

  const shortR = reasons.filter((r) => r.k !== 'long');
  let agree;
  if (code === 'buy-now') agree = reasons.filter((r) => r.dir === 1).length;
  else if (code === 'sell-now') agree = reasons.filter((r) => r.dir === -1).length;
  else if (code === 'buy-wait') agree = shortR.filter((r) => r.dir === -1).length + (longS >= 55 ? 1 : 0) + (low ? 1 : 0);
  else if (code === 'sell-wait') agree = shortR.filter((r) => r.dir === 1 && r.k !== 'rsi' && r.k !== 'zone').length + (high ? 1 : 0);
  else agree = 3;
  const confidence = agree >= 4 ? 'Alta' : agree >= 3 ? 'Media' : 'Baja';

  let text;
  let target;
  let targetLabel;
  if (code === 'buy-now') {
    target = h5.p50;
    targetLabel = 'Más probable en 1 semana';
    text = `El precio está bajo y el impulso empieza a girar a favor${ns > 0.1 ? ', con noticias positivas' : ''}. En 1 semana el escenario más probable es ${m$(h5.p50)} (${pc(med5)}).`;
  } else if (code === 'buy-wait') {
    target = d.low5;
    targetLabel = 'Posible piso en los próximos días';
    text = `El precio todavía podría bajar${ns < -0.15 ? ' (las noticias recientes son negativas)' : macdUp === false ? ' (el impulso sigue perdiendo fuerza)' : ''}. El modelo estima un piso cercano a ${m$(d.low5)} (${pc(d.low5 / p - 1)}) en los próximos días; esperar a que se estabilice ahí sería mejor punto de compra.`;
  } else if (code === 'sell-wait') {
    target = d.high5;
    targetLabel = 'Posible techo en los próximos días';
    text = `Está en zona alta, pero el impulso sigue a favor: podría subir hasta cerca de ${m$(d.high5)} (${pc(d.high5 / p - 1)}) en los próximos días. Si tienes acciones, el modelo sugiere vender en unos días, cerca de ese nivel.`;
  } else if (code === 'sell-now') {
    target = h5.p25;
    targetLabel = 'Escenario bajista en 1 semana';
    text = weak
      ? `Tendencia bajista y fundamentales débiles${ns < -0.1 ? ', con noticias negativas' : ''}. Si tienes acciones, el modelo sugiere vender ahora: la probabilidad de subir en 1 semana es de ${Math.round(up5 * 100)}%.`
      : `Está en zona alta y las señales se están volteando${ns < -0.1 ? ' (noticias negativas)' : ''}. El riesgo de bajada supera al potencial de subida (prob. de subir en 1 semana: ${Math.round(up5 * 100)}%). Si tienes acciones, el modelo sugiere vender ahora.`;
  } else {
    target = h5.p50;
    targetLabel = 'Más probable en 1 semana';
    const zone = high
      ? 'Está en zona alta, pero las señales no coinciden: no es buen precio para comprar y tampoco hay motivo claro para vender.'
      : low
        ? 'Está en zona baja, pero todavía no hay señales claras de rebote.'
        : 'El precio está en zona media y las señales no coinciden.';
    text = `${zone} El modelo no ve ventaja clara hoy; escenario más probable en 1 semana: ${m$(h5.p50)} (${pc(med5)}).`;
  }
  return { code, ...REC_META[code], text, target, targetLabel, confidence, reasons };
}
