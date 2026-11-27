// Gestión de riesgo (Fase 2): cuánto comprar, dónde va el stop y límites de la cartera.
// El stop sale del "escenario malo" (5%) a 1 mes con la misma fórmula cuyos rangos
// se validaron en la prueba histórica. Nada de esto predice si la acción subirá:
// sirve para que una mala racha no te saque del juego.
import { mcParams, normCdf } from './analysis.js';

export const RISK_DEFAULTS = {
  capital: 0, // 0 = usar el valor de "Mis operaciones" en la cuenta virtual
  riskPct: 0.01, // pérdida máxima planeada por operación (1% del capital)
  maxPos: 0.2, // máximo por empresa
  maxSector: 0.4, // máximo por sector
  killDD: 0.15, // freno de emergencia: caída de la cuenta desde su máximo
  halfOnEarnings: true, // mitad de tamaño si presenta resultados antes de 1 mes
  fractional: true, // acciones fraccionadas
  stopDays: 21, // horizonte del stop (días hábiles)
};

const Z5 = -1.6449;
// Corrección de Broadie-Glasserman-Kou: el stop se revisa solo al cierre de cada día.
const BGK = 0.5826;

// Precio del stop de cierre: escenario malo (5%) a `days` días hábiles.
export function stopPrice(price, mu, sigma, days = 21) {
  const T = days / 252;
  return price * Math.exp((mu - 0.5 * sigma * sigma) * T + Z5 * sigma * Math.sqrt(T));
}

// Probabilidad de que ALGÚN cierre diario quede por debajo de L antes de `days`
// (primer paso de un movimiento browniano con deriva, corregido por revisión diaria).
export function probCloseBelow(price, L, mu, sigma, days = 21) {
  if (!(L > 0) || !(price > 0) || !(sigma > 0)) return NaN;
  if (L >= price) return 1;
  const T = days / 252;
  const nu = mu - 0.5 * sigma * sigma;
  const b = Math.log(L / price) - BGK * sigma * Math.sqrt(1 / 252);
  const s = sigma * Math.sqrt(T);
  const p = normCdf((b - nu * T) / s) + Math.exp((2 * nu * b) / (sigma * sigma)) * normCdf((b + nu * T) / s);
  return Math.min(1, Math.max(0, p));
}

// Stop sugerido para un análisis de la app.
export function stopFor(a, days = 21) {
  if (!a || !(a.price > 0) || !Number.isFinite(a.tech && a.tech.vol)) return null;
  const { mu, sigma } = mcParams(a);
  const stop = stopPrice(a.price, mu, sigma, days);
  return { stop, dist: 1 - stop / a.price, prob: probCloseBelow(a.price, stop, mu, sigma, days), mu, sigma, days };
}

// Tamaño de posición: el menor de cuatro límites (riesgo, máximo por empresa,
// máximo por sector y efectivo disponible).
export function sizePosition({ price, stop, capital, cash, held = 0, sectorValue = 0, profile = {}, earningsSoon = false, costs = 0.001 }) {
  const p = { ...RISK_DEFAULTS, ...profile };
  if (!(price > 0) || !(stop > 0) || stop >= price || !(capital > 0)) return null;
  const perShare = price - stop + price * costs; // pérdida por acción si se toca el stop (con costos)
  const halved = !!(earningsSoon && p.halfOnEarnings);
  const riskBudget = capital * p.riskPct * (halved ? 0.5 : 1);
  const lim = {
    risk: (riskBudget / perShare) * price,
    pos: Math.max(0, capital * p.maxPos - held),
    sector: Math.max(0, capital * p.maxSector - sectorValue),
    cash: Math.max(0, Number.isFinite(cash) ? cash : capital),
  };
  let limit = 'risk';
  for (const k of Object.keys(lim)) if (lim[k] < lim[limit]) limit = k;
  let shares = lim[limit] / price;
  if (!p.fractional) shares = Math.floor(shares + 1e-9);
  const amount = shares * price;
  return {
    shares,
    amount,
    pct: amount / capital,
    maxLoss: shares * perShare,
    maxLossPct: (shares * perShare) / capital,
    perShare,
    riskBudget,
    limit,
    lim,
    halved,
  };
}

// Caída actual de una curva de capital [{ t, v }] desde su máximo.
export function drawdownOf(eq) {
  let peak = 0;
  let cur = NaN;
  for (const p of eq || []) {
    if (p.v > peak) peak = p.v;
    cur = p.v;
  }
  return { peak, cur, dd: peak > 0 && Number.isFinite(cur) ? cur / peak - 1 : 0 };
}

// Exposición por sector y alertas de concentración de una cartera.
// positions: [{ sym, value }]; secOf(sym) => id de sector.
export function exposure(positions, capital, secOf) {
  const bySec = {};
  let invested = 0;
  for (const p of positions) {
    const s = secOf(p.sym);
    bySec[s] = (bySec[s] || 0) + p.value;
    invested += p.value;
  }
  const sectors = Object.entries(bySec).map(([id, value]) => ({ id, value, pct: capital > 0 ? value / capital : 0 })).sort((a, b) => b.value - a.value);
  const top = positions.slice().sort((a, b) => b.value - a.value).map((p) => ({ ...p, pct: capital > 0 ? p.value / capital : 0 }));
  return { sectors, top, invested, cashPct: capital > 0 ? 1 - invested / capital : 1 };
}
