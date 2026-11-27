// Tesis por empresa (Fase 2): escribir ANTES de comprar por qué la compras y
// cuándo la venderías. No predice nada; sirve contra un sesgo muy documentado:
// vender rápido las ganadoras y aferrarse a las perdedoras (Odean, 1998).
import { load, save } from './store.js';

export const CHECKS = [
  { k: 'business', txt: 'Entiendo cómo gana dinero esta empresa' },
  { k: 'moat', txt: 'Tiene una ventaja difícil de copiar (marca, red, costos, patentes)' },
  { k: 'debt', txt: 'Su deuda es manejable' },
  { k: 'price', txt: 'No estoy pagando cualquier precio (valuación razonable)' },
  { k: 'patience', txt: 'La mantendría aunque cayera 30% sin que cambie su historia' },
];

export const STATUS = {
  intacta: { emoji: '🟢', label: 'Tesis intacta', tone: 'good' },
  revisar: { emoji: '🟡', label: 'Revisa tu tesis', tone: 'warn' },
  rota: { emoji: '🔴', label: 'Tesis rota', tone: 'bad' },
};

export class ThesisBook {
  constructor(mode) {
    this.key = 'thesis:' + mode;
    this.map = load(this.key, {});
  }

  get(sym) {
    return this.map[sym] || null;
  }

  set(sym, data) {
    const prev = this.map[sym];
    this.map[sym] = { created: Date.now(), log: [], ...prev, ...data, updated: Date.now() };
    this.persist();
    return this.map[sym];
  }

  log(sym, entry) {
    const th = this.map[sym];
    if (!th) return;
    th.log = [{ t: Date.now(), ...entry }, ...(th.log || [])].slice(0, 30);
    this.persist();
  }

  remove(sym) {
    delete this.map[sym];
    this.persist();
  }

  persist() {
    save(this.key, this.map);
  }

  list() {
    return Object.entries(this.map);
  }
}

// Revisa las condiciones de la tesis con los datos de hoy.
// ctx: { price, a (análisis), earnings ({ next: { date } }), newsImp ({ score, count }), fmt (dinero) }
export function evalThesis(th, { price, a, earnings, newsImp, fmt = (v) => '$' + v.toFixed(2), now = Date.now() }) {
  const flags = [];
  if (!th || !(price > 0)) return { status: 'intacta', flags, level: 0 };
  if (th.stop > 0 && price <= th.stop) {
    flags.push({ lvl: 2, k: 'stop', txt: `Está en ${fmt(price)}, por debajo de tu stop de ${fmt(th.stop)}. Tu regla dice vender si cierra así.` });
  } else if (th.stop > 0 && price <= th.stop * 1.03) {
    flags.push({ lvl: 1, k: 'near-stop', txt: `A menos de 3% de tu stop (${fmt(th.stop)}).` });
  }
  if (th.target > 0 && price >= th.target) {
    flags.push({ lvl: 1, k: 'target', txt: `Llegó a tu objetivo de ${fmt(th.target)}: decide si la historia sigue o tomas ganancias.` });
  }
  const reviewDays = th.reviewDays || 90;
  const lastRev = th.lastReview || th.created;
  if (lastRev && now - lastRev >= reviewDays * 864e5) {
    flags.push({ lvl: 1, k: 'review', txt: `Pasaron ${Math.floor((now - lastRev) / 864e5)} días desde tu última revisión (la planeaste cada ${reviewDays}).` });
  }
  if (earnings && earnings.next && earnings.next.date) {
    const days = Math.ceil((Date.parse(earnings.next.date + 'T12:00:00Z') - now) / 864e5);
    if (days >= 0 && days <= 7) flags.push({ lvl: 1, k: 'earnings', txt: `Presenta resultados ${days === 0 ? 'hoy' : days === 1 ? 'mañana' : `en ${days} días`}: relee tu tesis antes.` });
  }
  if (newsImp && newsImp.count >= 3 && newsImp.score < -0.3) {
    flags.push({ lvl: 1, k: 'news', txt: `Noticias muy negativas en 72 h (${newsImp.count}): ¿cambian tu razón para tenerla?` });
  }
  // Solo avisa si al escribir la tesis estaba por ENCIMA de su media de 200 días.
  if (th.type === 'largo' && th.trendAtEntry !== false && a && a.tech && a.tech.sma200 > 0 && price < a.tech.sma200) {
    flags.push({ lvl: 1, k: 'trend', txt: 'Perdió su media de 200 días (la tendencia de fondo se volteó).' });
  }
  if (th.type === 'corto' && th.created && now - th.created > 30 * 864e5) {
    flags.push({ lvl: 1, k: 'time', txt: 'Tu plan era de corto plazo y ya pasó más de un mes.' });
  }
  const level = flags.reduce((m, f) => Math.max(m, f.lvl), 0);
  return { status: level === 2 ? 'rota' : level === 1 ? 'revisar' : 'intacta', flags, level };
}
