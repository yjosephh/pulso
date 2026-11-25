// Proveedores de datos de mercado.
//  - DemoProvider: datos simulados (para probar la app sin claves).
//  - LiveProvider: Finnhub (cotizaciones en tiempo real, noticias, fundamentales,
//    analistas) + Twelve Data (historial diario para gráficas e indicadores).
import { UNIVERSE, INDICES } from './universe.js';
import { cacheGet, cacheSet } from './store.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HOUR = 3600e3;
const DAY = 24 * HOUR;

export function isoDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

// Limita las llamadas por minuto para respetar los planes gratuitos.
class RateLimiter {
  constructor(max, windowMs = 60e3) {
    this.max = max;
    this.win = windowMs;
    this.calls = [];
    this.chain = Promise.resolve();
  }
  schedule(fn) {
    const run = async () => {
      for (;;) {
        const now = Date.now();
        this.calls = this.calls.filter((t) => now - t < this.win);
        if (this.calls.length < this.max) break;
        await sleep(this.win - (now - this.calls[0]) + 60);
      }
      this.calls.push(Date.now());
      return fn();
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }
}

// ---------------------------------------------------------------------------
// Utilidades de aleatoriedad reproducible (modo demo)
// ---------------------------------------------------------------------------
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussFrom(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const META = Object.fromEntries([...UNIVERSE, ...INDICES].map((x) => [x.s, x]));

function lastTradingDays(count) {
  const out = [];
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - 1); // la vela de "hoy" se construye en vivo
  while (out.length < count) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(isoDate(d));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out.reverse();
}

// ---------------------------------------------------------------------------
// DEMO
// ---------------------------------------------------------------------------
const POS_T = [
  '{n} supera las expectativas de ganancias del trimestre',
  'Analistas elevan el precio objetivo de {n}',
  '{n} anuncia alianza estratégica en inteligencia artificial',
  'Fuerte demanda impulsa las ventas de {n} a nivel mundial',
  '{n} recompra acciones y eleva su dividendo',
  '{n} toca nuevos máximos tras resultados sólidos',
];
const NEG_T = [
  '{n} enfrenta investigación regulatoria en Europa',
  'Analistas rebajan la recomendación de {n} por valuación exigente',
  'Ventas de {n} caen en China por mayor competencia',
  '{n} advierte sobre el impacto de aranceles en sus márgenes',
  'Demanda colectiva contra {n} genera temor entre inversionistas',
];
const NEU_T = [
  '{n} presentará resultados la próxima semana',
  '{n} nombra nuevo director financiero',
  'Lo que hay que saber de {n} antes de su conferencia anual',
];
const MARKET_T = [
  'La Reserva Federal mantiene las tasas; Wall Street atento a la inflación',
  'Acciones de inteligencia artificial lideran el rally del Nasdaq',
  'Sube el rendimiento de los bonos y presiona a las tecnológicas',
  'Datos de empleo mejores de lo esperado impulsan a los índices',
  'Temor a una desaceleración global sacude a los mercados',
  'El petróleo cae por mayor oferta de la OPEP',
  'Inversionistas rotan hacia empresas defensivas de consumo',
  'Récord de inversión en centros de datos impulsa a fabricantes de chips',
];

const SECTOR_F = {
  tech: { pe: [24, 38], margin: [18, 34], roe: [22, 55], de: [0.3, 1.6], div: [0.3, 1.0], beta: [1.0, 1.3], grow: 9 },
  ai: { pe: [35, 75], margin: [12, 50], roe: [15, 70], de: [0.1, 0.9], div: [0, 0.7], beta: [1.4, 2.1], grow: 22 },
  consumer: { pe: [18, 30], margin: [3, 24], roe: [18, 45], de: [0.8, 2.4], div: [1.8, 3.4], beta: [0.5, 0.8], grow: 3 },
  finance: { pe: [12, 32], margin: [22, 50], roe: [14, 45], de: [0.5, 2.2], div: [0.6, 2.4], beta: [0.85, 1.1], grow: 7 },
  health: { pe: [16, 60], margin: [15, 30], roe: [20, 60], de: [0.4, 1.8], div: [0.8, 3.0], beta: [0.4, 0.7], grow: 7 },
  energy: { pe: [13, 70], margin: [6, 14], roe: [10, 25], de: [0.1, 0.5], div: [0, 3.4], beta: [0.8, 2.0], grow: 2 },
};

export class DemoProvider {
  constructor() {
    this.mode = 'demo';
    this.hist = {};
    this.live = {};
    this.timer = null;
  }

  meta(sym) {
    return META[sym] || { s: sym, n: sym, base: 100, vol: 0.3, drift: 0.08, sec: 'tech' };
  }

  async getHistory(sym) {
    if (this.hist[sym]) return this.hist[sym];
    const m = this.meta(sym);
    const rng = mulberry32(hashStr(sym));
    const dates = lastTradingDays(420);
    const sd = m.vol / Math.sqrt(252);
    let p = 1;
    let regime = m.drift;
    const raw = [];
    for (let i = 0; i < dates.length; i++) {
      if (i % 60 === 0) regime = m.drift + gaussFrom(rng) * m.vol * 0.9;
      const open = p * (1 + gaussFrom(rng) * sd * 0.25);
      const close = open * Math.exp((regime - 0.5 * m.vol * m.vol) / 252 + gaussFrom(rng) * sd);
      const high = Math.max(open, close) * (1 + Math.abs(gaussFrom(rng)) * sd * 0.45);
      const low = Math.min(open, close) * (1 - Math.abs(gaussFrom(rng)) * sd * 0.45);
      const volume = Math.round((2e7 + rng() * 6e7) * (1 + Math.abs(gaussFrom(rng)) * 0.6));
      raw.push({ time: dates[i], open, high, low, close, volume });
      p = close;
    }
    const k = m.base / p; // escalamos para terminar en el precio base
    const bars = raw.map((b) => ({
      time: b.time,
      open: b.open * k,
      high: b.high * k,
      low: b.low * k,
      close: b.close * k,
      volume: b.volume,
    }));
    this.hist[sym] = bars;
    return bars;
  }

  async getQuote(sym) {
    const bars = await this.getHistory(sym);
    const prevClose = bars[bars.length - 1].close;
    if (!this.live[sym]) {
      const rng = mulberry32(hashStr(sym + isoDate()));
      const m = this.meta(sym);
      const open = prevClose * (1 + gaussFrom(rng) * (m.vol / Math.sqrt(252)) * 0.6);
      this.live[sym] = { open, high: open, low: open, price: open };
    }
    const l = this.live[sym];
    return {
      price: l.price,
      prevClose,
      change: l.price - prevClose,
      changePct: ((l.price - prevClose) / prevClose) * 100,
      open: l.open,
      high: l.high,
      low: l.low,
      ts: Date.now(),
    };
  }

  async getProfile(sym) {
    const m = this.meta(sym);
    return { name: m.n, logo: '', industry: m.sec, country: m.intl ? 'KR' : 'US', weburl: '' };
  }

  async getFundamentals(sym) {
    const m = this.meta(sym);
    const f = SECTOR_F[m.sec] || SECTOR_F.tech;
    const rng = mulberry32(hashStr('f' + sym));
    const r = ([a, b]) => a + (b - a) * rng();
    const revGrowth = f.grow + m.drift * 40 + gaussFrom(rng) * 4;
    const bars = await this.getHistory(sym);
    const closes = bars ? bars.slice(-252).map((b) => b.close) : null;
    return {
      pe: r(f.pe) * (m.s === 'PLTR' ? 3 : 1),
      revGrowth,
      epsGrowth: revGrowth * 1.4 + gaussFrom(rng) * 6,
      netMargin: r(f.margin),
      roe: r(f.roe),
      debtEq: r(f.de),
      divYield: r(f.div),
      beta: r(f.beta),
      high52: closes ? Math.max(...closes) : null,
      low52: closes ? Math.min(...closes) : null,
      marketCap: null,
    };
  }

  async getRecommendation(sym) {
    const m = this.meta(sym);
    const rng = mulberry32(hashStr('r' + sym));
    const bias = Math.max(0.1, Math.min(0.9, 0.55 + m.drift * 1.2 + (rng() - 0.5) * 0.3));
    const total = 30 + Math.floor(rng() * 20);
    const buyish = Math.round(total * bias);
    const strongBuy = Math.round(buyish * 0.45);
    const buy = buyish - strongBuy;
    const sell = Math.round((total - buyish) * 0.3 * rng());
    const strongSell = Math.round(sell * 0.3);
    const hold = Math.max(0, total - buyish - sell - strongSell);
    return { strongBuy, buy, hold, sell, strongSell, period: isoDate() };
  }

  async getMarketNews() {
    const rng = mulberry32(hashStr('news' + isoDate()));
    const now = Date.now() / 1000;
    const items = [];
    MARKET_T.forEach((h, i) => {
      items.push({
        id: 'm' + i,
        headline: h,
        summary: 'Noticia de ejemplo generada en modo demo.',
        source: 'Pulso Demo',
        url: '',
        datetime: Math.round(now - rng() * 36 * 3600),
        related: '',
        demo: true,
      });
    });
    UNIVERSE.slice(0, 18).forEach((m, i) => {
      items.push(this.makeNews(m, rng, now, 'g' + i));
    });
    return items.sort((a, b) => b.datetime - a.datetime);
  }

  makeNews(m, rng, now, id) {
    const bias = 0.5 + m.drift * 1.5;
    const x = rng();
    const pool = x < bias * 0.75 ? POS_T : x < bias * 0.75 + 0.18 ? NEU_T : NEG_T;
    const h = pool[Math.floor(rng() * pool.length)].replace('{n}', m.n);
    return {
      id,
      headline: h,
      summary: 'Noticia de ejemplo generada en modo demo.',
      source: 'Pulso Demo',
      url: '',
      datetime: Math.round(now - rng() * 72 * 3600),
      related: m.s,
      demo: true,
    };
  }

  async getCompanyNews(sym) {
    const m = this.meta(sym);
    const rng = mulberry32(hashStr('cn' + sym + isoDate()));
    const now = Date.now() / 1000;
    const out = [];
    for (let i = 0; i < 6; i++) out.push(this.makeNews(m, rng, now, sym + i));
    return out.sort((a, b) => b.datetime - a.datetime);
  }

  async getMarketStatus() {
    return { isOpen: true, session: 'demo', label: 'Demo · simulado' };
  }

  async search(q) {
    const t = q.trim().toLowerCase();
    return UNIVERSE.filter((m) => m.s.toLowerCase().includes(t) || m.n.toLowerCase().includes(t))
      .slice(0, 8)
      .map((m) => ({ symbol: m.s, description: m.n }));
  }

  connect(symbols, onTick, onStatus) {
    this.disconnect();
    this.subs = new Set(symbols);
    onStatus && onStatus('live');
    this.timer = setInterval(() => {
      for (const sym of this.subs) {
        const l = this.live[sym];
        if (!l || Math.random() > 0.45) continue;
        const m = this.meta(sym);
        const sd = m.vol / Math.sqrt(252);
        l.price *= Math.exp(gaussFrom(Math.random) * sd * 0.12 + m.drift / 252 / 300);
        l.high = Math.max(l.high, l.price);
        l.low = Math.min(l.low, l.price);
        onTick(sym, l.price, Date.now());
      }
    }, 1200);
  }

  setSubscriptions(symbols) {
    this.subs = new Set(symbols);
  }

  disconnect() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

// ---------------------------------------------------------------------------
// EN VIVO: Finnhub + Twelve Data
// ---------------------------------------------------------------------------
const FH = 'https://finnhub.io/api/v1';
const TD = 'https://api.twelvedata.com';

export class LiveProvider {
  constructor({ finnhubKey, tdKey }) {
    this.mode = 'live';
    this.fhKey = finnhubKey.trim();
    this.tdKey = (tdKey || '').trim();
    this.fhLimit = new RateLimiter(55);
    this.tdLimit = new RateLimiter(8);
    this.ws = null;
    this.subs = new Set();
    this.closed = false;
    this.backoff = 2000;
  }

  async fh(path, params = {}) {
    const url = new URL(FH + path);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    url.searchParams.set('token', this.fhKey);
    return this.fhLimit.schedule(async () => {
      const r = await fetch(url);
      if (r.status === 429) throw new Error('Límite de Finnhub alcanzado, reintenta en un minuto');
      if (r.status === 401) throw new Error('Clave de Finnhub inválida');
      if (r.status === 403) throw new Error('No disponible en el plan gratuito');
      if (!r.ok) throw new Error('Finnhub respondió ' + r.status);
      return r.json();
    });
  }

  async getQuote(sym) {
    const q = await this.fh('/quote', { symbol: sym });
    if (!q || !q.c) return null;
    return {
      price: q.c,
      prevClose: q.pc,
      change: q.d,
      changePct: q.dp,
      open: q.o,
      high: q.h,
      low: q.l,
      ts: (q.t || Date.now() / 1000) * 1000,
    };
  }

  async getHistory(sym) {
    if (!this.tdKey) return null;
    const ck = 'h:' + sym + ':' + isoDate();
    const hit = cacheGet(ck, 12 * HOUR);
    if (hit) return hit;
    const url = new URL(TD + '/time_series');
    if (sym.endsWith('.KS')) {
      url.searchParams.set('symbol', sym.replace('.KS', ''));
      url.searchParams.set('exchange', 'KRX');
    } else {
      url.searchParams.set('symbol', sym);
    }
    url.searchParams.set('interval', '1day');
    url.searchParams.set('outputsize', '420');
    url.searchParams.set('apikey', this.tdKey);

    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.tdLimit.schedule(() => fetch(url).then((r) => r.json()));
      if (res && res.status === 'ok' && Array.isArray(res.values)) {
        const bars = res.values
          .map((v) => ({
            time: v.datetime.slice(0, 10),
            open: +v.open,
            high: +v.high,
            low: +v.low,
            close: +v.close,
            volume: +v.volume || 0,
          }))
          .reverse();
        cacheSet(ck, bars);
        return bars;
      }
      if (res && res.code === 429 && attempt === 0) {
        await sleep(61e3); // créditos del minuto agotados: esperamos y reintentamos
        continue;
      }
      throw new Error((res && res.message) || 'Sin historial disponible');
    }
    return null;
  }

  async getProfile(sym) {
    const ck = 'p:' + sym;
    const hit = cacheGet(ck, 7 * DAY);
    if (hit) return hit;
    const p = await this.fh('/stock/profile2', { symbol: sym });
    const out = {
      name: p.name,
      logo: p.logo,
      industry: p.finnhubIndustry,
      country: p.country,
      weburl: p.weburl,
      marketCap: p.marketCapitalization,
    };
    cacheSet(ck, out);
    return out;
  }

  async getFundamentals(sym) {
    const ck = 'f:' + sym;
    const hit = cacheGet(ck, 12 * HOUR);
    if (hit) return hit;
    const r = await this.fh('/stock/metric', { symbol: sym, metric: 'all' });
    const m = (r && r.metric) || {};
    const num = (...vals) => {
      for (const v of vals) if (typeof v === 'number' && isFinite(v)) return v;
      return null;
    };
    const out = {
      pe: num(m.peTTM, m.peBasicExclExtraTTM, m.peExclExtraTTM),
      revGrowth: num(m.revenueGrowthTTMYoy, m.revenueGrowthQuarterlyYoy),
      epsGrowth: num(m.epsGrowthTTMYoy, m.epsGrowthQuarterlyYoy),
      netMargin: num(m.netProfitMarginTTM, m.netProfitMarginAnnual),
      roe: num(m.roeTTM, m.roeRfy),
      debtEq: num(m['totalDebt/totalEquityQuarterly'], m['totalDebt/totalEquityAnnual']),
      divYield: num(m.dividendYieldIndicatedAnnual, m.currentDividendYieldTTM),
      beta: num(m.beta),
      high52: num(m['52WeekHigh']),
      low52: num(m['52WeekLow']),
      marketCap: num(m.marketCapitalization),
    };
    cacheSet(ck, out);
    return out;
  }

  async getRecommendation(sym) {
    const ck = 'r:' + sym;
    const hit = cacheGet(ck, DAY);
    if (hit) return hit;
    const r = await this.fh('/stock/recommendation', { symbol: sym });
    const out = Array.isArray(r) && r.length ? r[0] : null;
    cacheSet(ck, out);
    return out;
  }

  async getMarketNews() {
    const hit = cacheGet('news', 10 * 60e3);
    if (hit) return hit;
    const r = await this.fh('/news', { category: 'general' });
    const out = (Array.isArray(r) ? r : []).slice(0, 60);
    cacheSet('news', out);
    return out;
  }

  async getCompanyNews(sym) {
    const ck = 'n:' + sym;
    const hit = cacheGet(ck, 30 * 60e3);
    if (hit) return hit;
    const to = isoDate();
    const from = isoDate(new Date(Date.now() - 7 * DAY));
    const r = await this.fh('/company-news', { symbol: sym, from, to });
    const out = (Array.isArray(r) ? r : []).slice(0, 15);
    cacheSet(ck, out);
    return out;
  }

  async getMarketStatus() {
    const hit = cacheGet('status', 5 * 60e3);
    if (hit) return hit;
    const r = await this.fh('/stock/market-status', { exchange: 'US' });
    const labels = { 'pre-market': 'Pre-apertura', regular: 'Mercado abierto', 'post-market': 'Post-cierre' };
    const out = {
      isOpen: !!r.isOpen,
      session: r.session,
      label: r.isOpen ? labels[r.session] || 'Mercado abierto' : r.holiday ? 'Cerrado · ' + r.holiday : 'Mercado cerrado',
    };
    cacheSet('status', out);
    return out;
  }

  async search(q) {
    const r = await this.fh('/search', { q });
    return ((r && r.result) || [])
      .filter((x) => x.type === 'Common Stock' || x.type === 'ADR' || !x.type)
      .slice(0, 8)
      .map((x) => ({ symbol: x.symbol, description: x.description }));
  }

  connect(symbols, onTick, onStatus) {
    this.closed = false;
    this.onTick = onTick;
    this.onStatus = onStatus;
    this.subs = new Set(symbols.filter((s) => !s.includes('.KS')).slice(0, 50));
    this.open();
  }

  open() {
    try {
      this.ws = new WebSocket('wss://ws.finnhub.io?token=' + encodeURIComponent(this.fhKey));
    } catch {
      this.onStatus && this.onStatus('off');
      return;
    }
    this.ws.onopen = () => {
      this.backoff = 2000;
      this.onStatus && this.onStatus('live');
      for (const s of this.subs) this.ws.send(JSON.stringify({ type: 'subscribe', symbol: s }));
    };
    this.ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'trade' && Array.isArray(msg.data)) {
        for (const d of msg.data) this.onTick(d.s, d.p, d.t);
      }
    };
    this.ws.onclose = () => {
      this.onStatus && this.onStatus('off');
      if (this.closed) return;
      setTimeout(() => !this.closed && this.open(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 30e3);
    };
    this.ws.onerror = () => { try { this.ws.close(); } catch { /* nada */ } };
  }

  setSubscriptions(symbols) {
    const next = new Set(symbols.filter((s) => !s.includes('.KS')).slice(0, 50));
    const ready = this.ws && this.ws.readyState === 1;
    if (ready) {
      for (const s of this.subs) if (!next.has(s)) this.ws.send(JSON.stringify({ type: 'unsubscribe', symbol: s }));
      for (const s of next) if (!this.subs.has(s)) this.ws.send(JSON.stringify({ type: 'subscribe', symbol: s }));
    }
    this.subs = next;
  }

  disconnect() {
    this.closed = true;
    if (this.ws) try { this.ws.close(); } catch { /* nada */ }
    this.ws = null;
  }
}

export function createProvider(settings) {
  if (settings.mode === 'live' && settings.finnhubKey) return new LiveProvider(settings);
  return new DemoProvider();
}
