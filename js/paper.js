// Cuenta virtual (dinero simulado) y diario de señales en vivo.
// Sirve para probar las estrategias HACIA ADELANTE, con precios reales y costos,
// antes de arriesgar dinero de verdad. Nunca se conecta a un bróker.
import { load, save } from './store.js';
import { isoDate } from './data.js';
import { perfMetrics } from './metrics.js';
import { HIT } from './backtest.js';

// Costos por operación (igual que QuantDinger): 0.05% de comisión + 0.05% de deslizamiento.
export const PAPER_COSTS = { commission: 0.0005, slippage: 0.0005 };

export const ACCOUNTS = {
  manual: { name: 'Mis operaciones', icon: '🧑', desc: 'Lo que tú decides comprar y vender, con dinero simulado.' },
  factors: { name: 'Robot de factores', icon: '📊', desc: 'Cada semana compra el 20% mejor clasificado por el factor validado (si no hay, prueba el candidato más prometedor) y vende lo que sale.' },
  pulso: { name: 'Robot de sugerencias', icon: '🎯', desc: 'Compra en "Compra ahora" y vende en "Vende" (solo las empresas que sigues).' },
  spy: { name: 'S&P 500 (referencia)', icon: '🏛️', desc: 'Compra el índice el primer día y no lo toca. Es la vara contra la que se mide todo.' },
};

const blank = (cash) => ({ cash, pos: {}, trades: [], eq: [] });

export class PaperBook {
  constructor(mode, start = 10000) {
    this.key = 'paper:' + mode;
    this.s = load(this.key, null);
    if (!this.s || this.s.v !== 1) this.reset(start);
  }

  reset(start = 10000) {
    this.s = { v: 1, created: Date.now(), start, acc: { manual: blank(start), factors: { ...blank(start), last: 0 }, pulso: blank(start), spy: blank(start) } };
    this.persist();
  }

  persist() {
    save(this.key, this.s);
  }

  acc(id) {
    return this.s.acc[id];
  }

  value(id, px) {
    const a = this.acc(id);
    let v = a.cash;
    for (const [sym, p] of Object.entries(a.pos)) {
      const price = px(sym);
      v += p.qty * (Number.isFinite(price) && price > 0 ? price : p.last || p.avg);
    }
    return v;
  }

  buy(id, sym, amount, price, why = '') {
    const a = this.acc(id);
    if (!(price > 0) || !(amount > 0)) return null;
    const spend = Math.min(amount, a.cash);
    if (spend < 1) return null;
    const fill = price * (1 + PAPER_COSTS.slippage);
    const qty = spend / (fill * (1 + PAPER_COSTS.commission));
    const fee = qty * fill * PAPER_COSTS.commission;
    const p = a.pos[sym] || { qty: 0, avg: 0, since: Date.now() };
    p.avg = (p.qty * p.avg + qty * fill * (1 + PAPER_COSTS.commission)) / (p.qty + qty);
    p.qty += qty;
    p.last = price;
    a.pos[sym] = p;
    a.cash = Math.max(0, a.cash - (qty * fill + fee));
    const tr = { t: Date.now(), sym, side: 'buy', qty, price: fill, fee, why };
    a.trades.unshift(tr);
    a.trades = a.trades.slice(0, 400);
    this.persist();
    return tr;
  }

  sell(id, sym, qty, price, why = '') {
    const a = this.acc(id);
    const p = a.pos[sym];
    if (!p || !(price > 0)) return null;
    const q = Math.min(qty == null ? p.qty : qty, p.qty);
    if (!(q > 0)) return null;
    const fill = price * (1 - PAPER_COSTS.slippage);
    const gross = q * fill;
    const fee = gross * PAPER_COSTS.commission;
    a.cash += gross - fee;
    const ret = (fill * (1 - PAPER_COSTS.commission)) / p.avg - 1;
    p.qty -= q;
    p.last = price;
    if (p.qty <= 1e-9) delete a.pos[sym];
    const tr = { t: Date.now(), sym, side: 'sell', qty: q, price: fill, fee, ret, why };
    a.trades.unshift(tr);
    a.trades = a.trades.slice(0, 400);
    this.persist();
    return tr;
  }

  // Guarda el valor de cada cuenta (como máximo una vez por hora, salvo force).
  snapshot(px, force = false) {
    const now = Date.now();
    for (const id of Object.keys(this.s.acc)) {
      const a = this.acc(id);
      const last = a.eq[a.eq.length - 1];
      if (!force && last && now - last.t < 3600e3) continue;
      a.eq.push({ t: now, v: this.value(id, px) });
      if (a.eq.length > 3000) a.eq.splice(0, a.eq.length - 3000);
    }
    this.persist();
  }

  // Serie diaria (último valor de cada día) para calcular métricas.
  daily(id) {
    const map = new Map();
    for (const p of this.acc(id).eq) map.set(new Date(p.t).toISOString().slice(0, 10), p.v);
    return [...map.values()];
  }

  metrics(id) {
    const d = this.daily(id);
    if (d.length < 20) return null;
    const trades = this.acc(id).trades.filter((t) => t.side === 'sell').map((t) => t.ret);
    return perfMetrics(d, { ppy: 252, trades: trades.length ? trades : null });
  }

  // Referencia: compra el S&P 500 con todo el efectivo la primera vez que hay precio.
  ensureSpy(px) {
    const a = this.acc('spy');
    if (Object.keys(a.pos).length || a.cash < 1) return false;
    const p = px('SPY');
    return !!(p > 0 && this.buy('spy', 'SPY', a.cash, p, 'Compra inicial del índice'));
  }

  // Robot de factores: reparte en partes iguales entre los símbolos objetivo.
  // Solo rebalancea si pasaron al menos 6.5 días desde la última vez.
  rebalanceFactors(targets, px, label, force = false) {
    const a = this.acc('factors');
    if (!targets.length) return false;
    if (!force && a.last && Date.now() - a.last < 6.5 * 864e5) return false;
    for (const sym of Object.keys(a.pos)) {
      if (!targets.includes(sym)) {
        const p = px(sym);
        if (p > 0) this.sell('factors', sym, null, p, `Sale del top 20% (${label})`);
      }
    }
    const per = this.value('factors', px) / targets.length;
    for (const sym of targets) {
      const p = px(sym);
      if (!(p > 0)) continue;
      const cur = (a.pos[sym] ? a.pos[sym].qty : 0) * p;
      if (cur > per * 1.1) this.sell('factors', sym, (cur - per) / p, p, `Ajuste de peso (${label})`);
    }
    for (const sym of targets) {
      const p = px(sym);
      if (!(p > 0)) continue;
      const cur = (a.pos[sym] ? a.pos[sym].qty : 0) * p;
      if (per - cur > per * 0.1) this.buy('factors', sym, per - cur, p, `Entra al top 20% (${label})`);
    }
    a.last = Date.now();
    this.persist();
    return true;
  }

  // Robot de sugerencias: misma regla que se probó en la prueba histórica.
  onRecommendation(sym, code, price, nFollow) {
    const a = this.acc('pulso');
    const held = !!a.pos[sym];
    if (code === 'buy-now' && !held) {
      return !!this.buy('pulso', sym, Math.min(a.cash, this.s.start / Math.max(1, nFollow)), price, 'Sugerencia: COMPRA AHORA');
    }
    if ((code === 'sell-now' || code === 'sell-wait') && held) {
      return !!this.sell('pulso', sym, null, price, code === 'sell-now' ? 'Sugerencia: VENDE AHORA' : 'Sugerencia: VENDE EN UNOS DÍAS');
    }
    return false;
  }
}

// Diario de señales: guarda cada sugerencia con su precio y, cuando pasan los
// días, anota qué pasó realmente. Es la prueba en vivo (no se puede hacer trampa).
export class SignalJournal {
  constructor(mode) {
    this.key = 'journal:' + mode;
    this.list = load(this.key, []);
  }

  persist() {
    this.list = this.list.slice(0, 1500);
    save(this.key, this.list);
  }

  add({ sym, code, label, price }) {
    if (!code || code === 'hold' || !(price > 0)) return false;
    const prev = this.list.find((e) => e.sym === sym);
    if (prev && prev.code === code && Date.now() - prev.t < 3 * 864e5) return false;
    this.list.unshift({ id: Date.now() + sym, sym, code, label, price, t: Date.now(), date: isoDate() });
    this.persist();
    return true;
  }

  // histOf(sym) => barras diarias [{ time, close }]
  evaluate(histOf) {
    let changed = false;
    for (const e of this.list) {
      if (e.r5 != null) continue;
      const bars = histOf(e.sym);
      if (!bars || !bars.length) continue;
      let i0 = -1;
      for (let i = bars.length - 1; i >= 0; i--) {
        if (bars[i].time <= e.date) {
          i0 = i;
          break;
        }
      }
      if (i0 < 0) continue;
      const fut = bars.slice(i0 + 1, i0 + 6).map((b) => b.close);
      if (fut.length >= 1 && e.r1 == null) {
        e.r1 = fut[0] / e.price - 1;
        changed = true;
      }
      if (fut.length >= 5) {
        e.r5 = fut[4] / e.price - 1;
        e.min5 = Math.min(...fut) / e.price - 1;
        e.max5 = Math.max(...fut) / e.price - 1;
        changed = true;
      }
    }
    if (changed) this.persist();
  }

  // baseOf(sym, code) => qué tan seguido pasa "el acierto" de todos modos en esa empresa.
  stats(baseOf) {
    const out = {};
    for (const code of Object.keys(HIT)) {
      const rows = this.list.filter((e) => e.code === code && e.r5 != null);
      const pending = this.list.filter((e) => e.code === code && e.r5 == null).length;
      if (!rows.length) {
        out[code] = { n: 0, pending };
        continue;
      }
      const hits = rows.filter((e) => HIT[code].hit(e)).length;
      const bases = rows.map((e) => baseOf(e.sym, code)).filter(Number.isFinite);
      out[code] = { n: rows.length, pending, hit: hits / rows.length, base: bases.length ? bases.reduce((a, b) => a + b, 0) / bases.length : NaN };
    }
    return out;
  }
}
