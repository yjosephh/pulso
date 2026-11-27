// PULSO · aplicación principal
import { UNIVERSE, INDICES, SECTORS, sectorName } from './universe.js';
import { createProvider, LiveProvider, isoDate, hashStr } from './data.js';
import { analyze, marketPulse, simulate, sma, sentiment, deepAnalysis } from './analysis.js';
import { sparkline, gauge, ring, fanChart, priceChart, equityChart } from './charts.js';
import {
  notify, Alerts, configureNotify, unlockAudio, notifPermission, notifSupported,
  requestNotifPermission, getHistory, unreadCount, markAllRead, clearHistory,
} from './notify.js';
import { load, save, clearCache, clearAll } from './store.js';
import { runBacktest, HIT, baseRates } from './backtest.js';
import { factorStudy, liveFactorRanking, FACTOR_NAME, HORIZONS } from './factors.js';
import { PaperBook, SignalJournal, ACCOUNTS, PAPER_COSTS } from './paper.js';

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isNum = (v) => typeof v === 'number' && isFinite(v);
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');

function money(v, cur = '$') {
  if (!isNum(v)) return '—';
  const dec = Math.abs(v) >= 10000 ? 0 : 2;
  return cur + v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
const pct = (v, d = 2) => (isNum(v) ? (v >= 0 ? '+' : '') + v.toFixed(d) + '%' : '—');
const pctR = (v, d = 1) => (isNum(v) ? pct(v * 100, d) : '—');
const num = (v, d = 1, suf = '') => (isNum(v) ? v.toFixed(d) + suf : '—');
function ago(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'ahora';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
}

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------
const DEFAULTS = { mode: 'demo', finnhubKey: '', tdKey: '', scanEvery: 15, notifySignals: true, sound: true };
const TABS = ['mercado', 'ranking', 'siguiendo', 'noticias', 'ajustes', 'precision', 'cuenta'];

const state = {
  settings: { ...DEFAULTS, ...load('settings', {}) },
  custom: load('custom', []),
  follow: load('follow', ['AAPL', 'NVDA', 'KO']),
  provider: null,
  token: 0,
  quotes: {},
  hist: {},
  analyses: {},
  profiles: {},
  news: [],
  companyNews: {},
  pulse: null,
  status: null,
  conn: 'off',
  scanning: false,
  progress: { done: 0, total: 0, current: '' },
  lastScan: 0,
  tab: 'mercado',
  detail: null,
  detailPushed: false,
  chart: null,
  chartBar: null,
  chartTf: 126,
  rankFilter: 'all',
  rankHorizon: load('rankHorizon', 'long'),
  newsFilter: 'market',
  mcTab: 'short',
  watchMode: false,
  wakeLock: null,
  manualScan: false,
  deep: {},
  raw: {},
  newsSeen: load('newsSeen', {}),
  bt: { ref: null, user: load('bt:user', null), show: 'auto', running: false, stop: false, prog: null, refLoading: true },
  fs: { ref: null, refApp: null, user: load('fs:user', null) },
  factorRank: null,
  factorEntry: load('factorEntry', null),
  paper: null,
  journal: null,
};
configureNotify({ sound: state.settings.sound });

const allCompanies = () => {
  const seen = new Set(UNIVERSE.map((c) => c.s));
  return [...UNIVERSE, ...state.custom.filter((c) => !seen.has(c.s))];
};
function meta(sym) {
  return allCompanies().find((c) => c.s === sym) || INDICES.find((c) => c.s === sym) || { s: sym, n: sym, sec: 'custom' };
}
const curOf = (sym) => meta(sym).cur || '$';
const analysesList = () => Object.values(state.analyses).filter((a) => a && !a.error);
const combined = (a) => a.scoreLong * 0.6 + a.scoreShort * 0.4;

// ---------------------------------------------------------------------------
// Componentes pequeños
// ---------------------------------------------------------------------------
function logo(sym, size = 40) {
  const m = meta(sym);
  const p = state.profiles[sym];
  const img = p && safeUrl(p.logo) ? `<img src="${esc(p.logo)}" alt="" loading="lazy" onerror="this.remove()">` : '';
  return `<div class="logo" style="--h:${hashStr(sym) % 360};width:${size}px;height:${size}px">${img}<span>${esc((m.n || sym).charAt(0))}</span></div>`;
}
function sigBadge(a) {
  const cls = { 'COMPRA FUERTE': 'sbuy', COMPRA: 'buy', MANTENER: 'hold', VENTA: 'sell', 'VENTA FUERTE': 'ssell' }[a.signal];
  return `<span class="sig ${cls}">${a.signal}</span>`;
}
const riskBadge = (a) => `<span class="risk r-${a.risk.toLowerCase()}">RIESGO ${a.risk.toUpperCase()}</span>`;
const pxEl = (sym, v, cls = 'px') => `<span class="${cls} mono" data-px="${esc(sym)}">${money(v, curOf(sym))}</span>`;
const chgEl = (sym, v) => `<span class="chg ${v >= 0 ? 'up' : 'down'}" data-chg="${esc(sym)}">${pct(v)}</span>`;
const disclaimer = () =>
  `<p class="disclaimer">Pulso es una herramienta educativa de análisis algorítmico. No es asesoría financiera personalizada. Las señales y simulaciones se basan en datos históricos y no garantizan resultados futuros. Invierte solo lo que puedas permitirte perder.</p>`;

function progressNote() {
  if (!state.scanning) return '';
  const { done, total, current } = state.progress;
  return `<div class="scanning-note"><span>Analizando ${esc(current)}… ${done}/${total}</span><div class="progress"><i style="width:${total ? (done / total) * 100 : 0}%"></i></div></div>`;
}

// ---------------------------------------------------------------------------
// Vistas
// ---------------------------------------------------------------------------
function viewMercado() {
  const p = state.pulse;
  const list = analysesList();
  const top = list.slice().sort((a, b) => combined(b) - combined(a)).slice(0, 6);
  const risky = list.filter((a) => a.signalType === 'sell' || a.verdict.tone === 'bad').sort((a, b) => combined(a) - combined(b)).slice(0, 4);

  const hero = p
    ? `<div class="gauge-wrap">${gauge(p.score, p.label)}</div>
       <p class="summary">${esc(p.summary)}</p>
       <div class="stats3">
         <div><b>${Math.round(p.above50 * 100)}%</b><span>sobre su media 50d</span></div>
         <div><b class="up">${p.buys}</b><span>señales de compra</span></div>
         <div><b class="down">${p.sells}</b><span>señales de venta</span></div>
       </div>`
    : `<div class="skel" style="height:170px;margin:10px 0"></div><div class="skel" style="height:60px"></div>`;

  const idx = INDICES.map((ix) => {
    const q = state.quotes[ix.s];
    const h = state.hist[ix.s];
    return `<div class="idx"><div class="n">${ix.n}</div>${pxEl(ix.s, q && q.price)}${chgEl(ix.s, q ? q.changePct : 0)}
      ${sparkline(h ? h.slice(-40).map((b) => b.close).concat(q && q.price ? [q.price] : []) : null, { h: 30 })}</div>`;
  }).join('');

  const opp = top.map((a) => `
    <article class="opp" data-open="${esc(a.sym)}">
      <div class="opp-top">${logo(a.sym, 38)}<div class="info"><b>${esc(a.sym)}</b><small>${esc(a.name)}</small></div>${ring(a.scoreLong, { size: 44 })}</div>
      ${pxEl(a.sym, a.price)} ${chgEl(a.sym, a.changePct)}
      <div class="verdict-mini">${a.verdict.emoji} ${esc(a.verdict.title)}</div>
      <div class="chips-row">${sigBadge(a)}<span class="chip-s">${esc(a.verdict.horizon)}</span></div>
    </article>`).join('');

  const heat = p ? p.sectors.map((s) => {
    const k = Math.max(-1, Math.min(1, s.change / 2.5));
    const bg = k >= 0 ? `rgba(0,227,150,${0.08 + k * 0.4})` : `rgba(255,77,106,${0.08 - k * 0.4})`;
    return `<div class="tile" data-filter="${s.id}" style="background:${bg}">
      <span class="t-name">${s.icon} ${esc(s.name)}</span><span class="t-chg">${pct(s.change)}</span>
      <small>Puntaje largo plazo ${s.long}/100 · ${s.count} empresas</small></div>`;
  }).join('') : '';

  return `
    <section class="card hero glow">
      <div class="sec-head"><div><div class="eyebrow">Análisis del mercado</div><h2>Pulso del mercado</h2></div>
        <span class="upd">${state.lastScan ? 'Actualizado ' + ago(state.lastScan) : ''}</span></div>
      ${progressNote()}
      ${hero}
    </section>
    ${precisionCard()}
    ${paperCard()}
    <section>
      <div class="sec-title"><h3>Índices</h3><span class="muted">${esc(state.status ? state.status.label : '')}</span></div>
      <div class="idx-grid">${idx}</div>
    </section>
    <section>
      <div class="sec-title"><h3>🔥 Mejores oportunidades</h3><a href="#/ranking">Ver ranking →</a></div>
      <div class="hscroll">${opp || '<div class="skel" style="flex:0 0 210px;height:170px"></div>'.repeat(3)}</div>
    </section>
    ${risky.length ? `<section>
      <div class="sec-title"><h3>⚠️ Señales de riesgo</h3><span class="muted">según el modelo</span></div>
      <div class="list">${risky.map((a) => rowHtml(a, null, 'short')).join('')}</div>
    </section>` : ''}
    ${heat ? `<section><div class="sec-title"><h3>🗺️ Mapa de sectores</h3><span class="muted">cambio de hoy</span></div><div class="heat">${heat}</div></section>` : ''}
    <section>
      <div class="sec-title"><h3>📰 Último momento</h3><a href="#/noticias">Ver todas →</a></div>
      ${state.news.slice(0, 4).map(newsHtml).join('') || '<div class="skel" style="height:80px"></div>'}
    </section>
    ${disclaimer()}`;
}

function rowHtml(a, rank, horizon) {
  const sc = horizon === 'short' ? a.scoreShort : a.scoreLong;
  return `<article class="row ${rank != null ? 'ranked' : ''}" data-open="${esc(a.sym)}">
    ${rank != null ? `<span class="rank">${rank}</span>` : ''}
    ${logo(a.sym)}
    <div class="info"><b>${esc(a.name)}</b><small>${esc(a.sym)} · ${esc(sectorName(a.sec))}</small></div>
    <div class="right">${pxEl(a.sym, a.price)}${chgEl(a.sym, a.changePct)}</div>
    ${ring(sc, { size: 46 })}
    <div class="badges">${sigBadge(a)}${riskBadge(a)}<span class="chip-s">${esc(a.verdict.horizon)}</span></div>
  </article>`;
}

function viewRanking() {
  const h = state.rankHorizon;
  if (h === 'factors') return viewFactorRank();
  let list = analysesList();
  if (state.rankFilter !== 'all') list = list.filter((a) => a.sec === state.rankFilter);
  list.sort((a, b) => (h === 'short' ? b.scoreShort - a.scoreShort : b.scoreLong - a.scoreLong));
  const errors = Object.values(state.analyses).filter((a) => a && a.error && (state.rankFilter === 'all' || a.sec === state.rankFilter));
  const n = allCompanies().length;
  return `
    <div class="page-head"><h2>Ranking de oportunidades</h2>
      <p>${n} empresas · ${(n * 2000).toLocaleString('en-US')} escenarios simulados por análisis</p></div>
    ${rankSeg(h)}
    <div class="chips">
      <button class="chip ${state.rankFilter === 'all' ? 'active' : ''}" data-filter="all">Todas</button>
      ${SECTORS.map((s) => `<button class="chip ${state.rankFilter === s.id ? 'active' : ''}" data-filter="${s.id}">${s.icon} ${s.name}</button>`).join('')}
      ${state.custom.length ? `<button class="chip ${state.rankFilter === 'custom' ? 'active' : ''}" data-filter="custom">➕ Agregadas</button>` : ''}
    </div>
    ${progressNote()}
    <div class="list">
      ${list.map((a, i) => rowHtml(a, i + 1, h)).join('') || (state.scanning ? '<div class="skel" style="height:74px"></div>'.repeat(5) : '<div class="empty">Sin resultados todavía. Toca el botón central para analizar.</div>')}
      ${errors.map((e) => `<article class="row err">${logo(e.sym)}<div class="info"><b>${esc(e.name)}</b><small>${esc(e.sym)} · ${esc(e.error)}</small></div></article>`).join('')}
    </div>
    <p class="hint">Puntaje 0-100: ${h === 'long'
      ? 'tendencia de fondo (SMA200, cruce dorado, 12 meses), calidad (márgenes, ROE), crecimiento, valuación, deuda, consenso de analistas, noticias y 1,000 escenarios a 1 año.'
      : 'precio vs medias 20/50 días, MACD, RSI, rendimiento del último mes, noticias, analistas y 1,000 escenarios a 1 mes.'}</p>
    ${disclaimer()}`;
}

function alertChips(sym) {
  const al = Alerts.get(sym);
  if (!al || (al.min == null && al.max == null)) return '<span class="muted small">Sin alerta de precio</span>';
  const cur = curOf(sym);
  let out = '';
  if (al.min != null) out += `<span class="al min ${al.minFired ? 'fired' : ''}">🔻 ${money(al.min, cur)} ${al.minFired ? '· DISPARADA' : '· armada'}</span>`;
  if (al.max != null) out += `<span class="al max ${al.maxFired ? 'fired' : ''}">🔺 ${money(al.max, cur)} ${al.maxFired ? '· DISPARADA' : '· armada'}</span>`;
  return out;
}

function viewSiguiendo() {
  const cards = state.follow.map((sym) => {
    const a = state.analyses[sym];
    const q = state.quotes[sym];
    const h = state.hist[sym];
    const price = q ? q.price : a && a.price;
    const al = Alerts.get(sym);
    let prob = '';
    if (a && !a.error && isNum(a.tech.vol) && al) {
      const lv = [al.min, al.max].filter((x) => x != null);
      if (lv.length) {
        const mc = simulate(a, 21, { levels: lv });
        prob = `<p class="hint">🎲 Probabilidad estimada de tocar ${lv.length > 1 ? 'tus precios' : 'tu precio'} en 1 mes: <b>${lv.map((l, i) => `${money(l, curOf(sym))} → ${Math.round(mc.levelProb[i] * 100)}%`).join(' · ')}</b></p>`;
      }
    }
    return `<article class="card watch" data-open="${esc(sym)}">
      <div class="w-head">${logo(sym, 44)}<div class="info"><b>${esc(meta(sym).n)}</b><small>${esc(sym)}</small></div>
        <div class="right">${pxEl(sym, price)}${chgEl(sym, q ? q.changePct : a ? a.changePct : 0)}</div></div>
      ${sparkline(h ? h.slice(-60).map((b) => b.close).concat(price ? [price] : []) : null, { h: 40 })}
      <div class="w-alerts">${alertChips(sym)}<span class="sp"></span>
        ${al && (al.minFired || al.maxFired) ? `<button class="btn sm" data-action="rearm" data-sym="${esc(sym)}">↺ Rearmar</button>` : ''}
        <button class="btn sm primary" data-action="alert" data-sym="${esc(sym)}">🔔 Alerta</button>
        <button class="btn sm ghost" data-action="unfollow" data-sym="${esc(sym)}" aria-label="Dejar de seguir">✕</button></div>
      ${state.deep[sym] ? deepMini(sym) : a && !a.error ? `<div class="w-verdict tone-${a.verdict.tone}">${a.verdict.emoji} <b>${esc(a.verdict.title)}</b> · Horizonte: ${esc(a.verdict.horizon)} · ${sigBadge(a)}</div>` : ''}
      ${prob}
    </article>`;
  }).join('');

  const wl = 'wakeLock' in navigator;
  return `
    <div class="page-head"><h2>En seguimiento</h2><p>Noticias en vivo · 10,000 escenarios por empresa · alertas instantáneas</p></div>
    <a class="card prec-link" href="#/cuenta"><b>💼 Cuenta virtual</b><span class="muted small">Prueba con dinero simulado: tus operaciones, los robots y el S&amp;P 500 →</span></a>
    <div class="card search">
      <input id="search" type="search" placeholder="🔍 Buscar empresa para seguir (ej. Tesla, KO)" autocomplete="off" enterkeyhint="search">
      <div id="search-res" class="search-res"></div>
    </div>
    <div class="card" style="margin-top:12px">
      <div class="setting" style="padding:0">
        <div><b>🛡️ Modo vigilancia</b><small>${wl ? 'Mantiene la pantalla encendida para que las alertas lleguen al instante (ideal con el cargador conectado).' : 'Tu navegador no permite mantener la pantalla encendida.'}</small></div>
        <label class="switch"><input type="checkbox" data-setting="watchMode" ${state.watchMode ? 'checked' : ''} ${wl ? '' : 'disabled'}><span></span></label>
      </div>
    </div>
    ${notifPermission() !== 'granted' ? `<div class="banner warn" style="margin-top:12px"><span>🔕 Activa las notificaciones para recibir las alertas aunque estés en otra app.</span><a href="#" data-action="enable-notif">Activar</a></div>` : ''}
    ${cards || `<div class="empty"><div class="big">⭐</div>Aún no sigues ninguna empresa.<br>Abre cualquier empresa y toca <b>★</b> para seguirla y poner alertas de precio.</div>`}
    ${disclaimer()}`;
}

function newsHtml(n) {
  const s = sentiment(n.headline + ' ' + (n.summary || ''));
  const cls = s > 0.1 ? 'pos' : s < -0.1 ? 'neg' : 'neu';
  const lbl = s > 0.1 ? 'POSITIVA' : s < -0.1 ? 'NEGATIVA' : 'NEUTRAL';
  const url = safeUrl(n.url);
  const img = safeUrl(n.image);
  const rel = (n.related || '').split(',').filter(Boolean).slice(0, 3).map((r) => `<span class="tag">$${esc(r)}</span>`).join('');
  const tag = url ? 'a' : 'div';
  return `<${tag} class="news" ${url ? `href="${esc(url)}" target="_blank" rel="noopener noreferrer"` : ''}>
    <div class="n-body"><div class="n-meta"><span class="sent ${cls}">${lbl}</span><span>${esc(n.source || '')} · ${ago((n.datetime || 0) * 1000)}</span>${rel}${n.demo ? '<span class="tag" style="color:var(--violet-2)">DEMO</span>' : ''}</div>
      <div class="n-title">${esc(n.headline)}</div></div>
    ${img ? `<img src="${esc(img)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
  </${tag}>`;
}

function viewNoticias() {
  let items;
  if (state.newsFilter === 'mine') {
    items = state.follow.flatMap((s) => (state.companyNews[s] || []).map((n) => ({ ...n, related: n.related || s })));
    const seen = new Set();
    items = items.filter((n) => !seen.has(n.headline) && seen.add(n.headline)).sort((a, b) => b.datetime - a.datetime);
  } else items = state.news;
  const pos = items.filter((n) => sentiment(n.headline + ' ' + (n.summary || '')) > 0.1).length;
  const neg = items.filter((n) => sentiment(n.headline + ' ' + (n.summary || '')) < -0.1).length;
  return `
    <div class="page-head"><h2>Noticias</h2><p>Último momento con análisis de sentimiento automático</p></div>
    <div class="seg">
      <button class="${state.newsFilter === 'market' ? 'active' : ''}" data-news="market">🌎 Mercado</button>
      <button class="${state.newsFilter === 'mine' ? 'active' : ''}" data-news="mine">⭐ Mis empresas</button>
    </div>
    ${items.length ? `<p class="hint" style="margin:0 0 12px">Tono: <span class="up">${pos} positivas</span> · <span class="down">${neg} negativas</span> · ${items.length - pos - neg} neutrales</p>` : ''}
    ${items.slice(0, 50).map(newsHtml).join('') || (state.scanning ? '<div class="skel" style="height:80px;margin-bottom:8px"></div>'.repeat(4) : '<div class="empty">No hay noticias por ahora.</div>')}
    ${disclaimer()}`;
}

function viewAjustes() {
  const s = state.settings;
  const perm = notifPermission();
  const permTxt = { granted: '✅ Activadas', denied: '⛔ Bloqueadas en el navegador', default: '⚪ No activadas', unsupported: '❌ No soportadas en este navegador' }[perm];
  return `
    <div class="page-head"><h2>Ajustes</h2><p>Fuente de datos, notificaciones y metodología</p></div>
    <section class="card">
      <h3>📡 Fuente de datos</h3>
      <div class="seg">
        <button class="${s.mode === 'demo' ? 'active' : ''}" data-mode="demo">🧪 Demo (simulado)</button>
        <button class="${s.mode === 'live' ? 'active' : ''}" data-mode="live">🟢 En vivo</button>
      </div>
      <label class="field"><span>Clave API de Finnhub <a href="https://finnhub.io/register" target="_blank" rel="noopener">Obtener gratis ↗</a></span>
        <input id="fhKey" type="password" autocomplete="off" placeholder="Pega tu clave de Finnhub" value="${esc(s.finnhubKey)}"></label>
      <label class="field"><span>Clave API de Twelve Data <a href="https://twelvedata.com/register" target="_blank" rel="noopener">Obtener gratis ↗</a></span>
        <input id="tdKey" type="password" autocomplete="off" placeholder="Pega tu clave de Twelve Data" value="${esc(s.tdKey)}"></label>
      <button class="btn primary block" style="margin-top:12px" data-action="save-keys">Guardar y conectar datos reales</button>
      <div id="key-test" class="hint"></div>
      <p class="hint"><b>Finnhub</b>: precios en tiempo real, noticias, fundamentales y analistas (gratis, 60 consultas/min). <b>Twelve Data</b>: historial diario para gráficas e indicadores técnicos (gratis, 800 consultas/día). Las claves se guardan solo en este dispositivo. El primer análisis en vivo tarda unos minutos por los límites gratuitos; después usa caché.</p>
    </section>
    <section class="card">
      <h3>🔔 Notificaciones y alertas</h3>
      <div class="setting"><div><b>Estado</b><small>${permTxt}</small></div>
        ${perm !== 'granted' && perm !== 'unsupported' ? '<button class="btn sm primary" data-action="enable-notif">Activar</button>' : ''}
        ${perm === 'granted' ? '<button class="btn sm" data-action="test-notif">Probar</button>' : ''}</div>
      <div class="setting"><div><b>Señales de compra/venta</b><small>Avisarme cuando el modelo detecte nuevas señales o eventos técnicos</small></div>
        <label class="switch"><input type="checkbox" data-setting="notifySignals" ${s.notifySignals ? 'checked' : ''}><span></span></label></div>
      <div class="setting"><div><b>Sonido</b><small>Tono al dispararse una alerta</small></div>
        <label class="switch"><input type="checkbox" data-setting="sound" ${s.sound ? 'checked' : ''}><span></span></label></div>
      <div class="setting"><div><b>Analizar automáticamente cada</b><small>Re-escanea el mercado completo</small></div>
        <select data-setting="scanEvery" class="btn sm" style="background:rgba(0,0,0,.35)">
          ${[5, 15, 30, 60].map((m) => `<option value="${m}" ${+s.scanEvery === m ? 'selected' : ''}>${m} min</option>`).join('')}
        </select></div>
      <p class="hint">Las alertas de precio se revisan en cada movimiento del precio y suenan al instante mientras Pulso esté abierta (o en segundo plano reciente). En iPhone, primero instala la app en la pantalla de inicio para poder recibir notificaciones.</p>
    </section>
    <a class="card prec-link" href="#/precision"><b>📏 Precisión medida</b><span class="muted small">Ver qué tan seguido aciertan las reglas en 11 años de datos reales →</span></a>
    <details class="card">
      <summary>🧠 ¿Cómo analiza Pulso?</summary>
      <div class="hint" style="margin:0">
        <p><b>1. Técnico:</b> medias móviles de 20, 50 y 200 días, cruce dorado/muerte, MACD, RSI, Bandas de Bollinger, volatilidad y caída máxima.</p>
        <p><b>2. Fundamental:</b> P/E vs crecimiento, márgenes, ROE, crecimiento de ventas/utilidades, deuda y dividendo.</p>
        <p><b>3. Analistas:</b> consenso de recomendaciones de Wall Street.</p>
        <p><b>4. Noticias:</b> sentimiento automático de titulares recientes (positivo/negativo).</p>
        <p><b>5. Monte Carlo:</b> 1,000 escenarios de precio a 1 mes y 1,000 a 1 año por empresa, usando su volatilidad histórica y un rendimiento esperado conservador (encogido hacia ~8% anual para no extrapolar rachas).</p>
        <p><b>6. Análisis profundo (empresas que sigues):</b> 10,000 escenarios con choques de "colas gruesas" (caídas y subidas bruscas realistas) y el efecto de las noticias de las últimas 72 h. Se recalcula al salir una noticia nueva o si el precio se mueve más de 1.5%. Da la sugerencia (compra ahora / espera unos días / vende en unos días / vende ahora / mantén) y el rango de cuánto podría bajar o subir mañana, en 1 semana y en 1 mes. El margen de error de la simulación se mantiene en ±1% o menos.</p>
        <p>Todo se combina en un <b>puntaje de corto plazo</b> (señal COMPRA/MANTENER/VENTA) y uno de <b>largo plazo</b>, más un veredicto honesto con lo bueno y lo malo. Es un modelo: puede equivocarse, sobre todo ante noticias inesperadas.</p>
      </div>
    </details>
    <section class="card">
      <h3>🗂️ Datos</h3>
      <div class="row-btns" style="margin-top:4px">
        <button class="btn" data-action="clear-cache">Borrar caché</button>
        <button class="btn danger" data-action="reset">Restablecer todo</button>
      </div>
    </section>
    ${disclaimer()}`;
}

// ---------------------------------------------------------------------------
// Precisión medida (prueba histórica)
// ---------------------------------------------------------------------------
const REC_LABEL = { 'buy-now': '🟢 Compra ahora', 'buy-wait': '🟡 Esperar unos días para comprar', 'sell-wait': '🟠 Vende en unos días', 'sell-now': '🔴 Vende ahora', hold: '⚪ Mantén y vigila' };
const SIG_LABEL = { buy: '📈 Señal COMPRA', sell: '📉 Señal VENTA' };
const VERDICT = { ventaja: ['buy', 'VENTAJA REAL'], azar: ['hold', 'IGUAL QUE EL AZAR'], peor: ['sell', 'PEOR QUE EL AZAR'] };
const pp = (x, d = 1) => (isNum(x) ? (x * 100).toFixed(d) + '%' : '—');
const pts = (x) => (isNum(x) ? (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + ' pts' : '—');

function btResults() {
  const b = state.bt;
  if (b.show === 'user' && b.user) return b.user;
  if (b.show === 'ref' && b.ref) return b.ref;
  return b.user || b.ref;
}

async function loadBtRef() {
  try {
    const r = await fetch('data/backtest-ref.json', { cache: 'no-cache' });
    state.bt.ref = r.ok ? await r.json() : null;
  } catch { state.bt.ref = null; }
  try {
    const r2 = await fetch('data/factors-ref.json', { cache: 'no-cache' });
    const j = r2.ok ? await r2.json() : null;
    state.fs.ref = j && j.big;
    state.fs.refApp = j && j.app;
  } catch { /* sin estudio de factores */ }
  state.bt.refLoading = false;
  if (!state.scanning && analysesList().length) afterScanPhase1();
  if (['precision', 'mercado', 'ranking', 'cuenta'].includes(state.tab)) scheduleRender();
  if (state.detail) renderDetailBody();
}

function btConclusions(R) {
  const out = [];
  const codes = ['buy-now', 'buy-wait', 'sell-wait', 'sell-now'].map((k) => [k, R.codes[k]]).filter(([, c]) => c && c.n >= 30);
  const adv = codes.filter(([, c]) => c.verdict === 'ventaja');
  const worse = codes.filter(([, c]) => c.verdict === 'peor');
  if (!adv.length) {
    out.push({ tone: 'bad', txt: `Ninguna de las ${codes.length} sugerencias superó al azar de forma confiable${worse.length ? ` y ${worse.length} fue${worse.length > 1 ? 'ron peores' : ' peor'} que el azar` : ''}. Hoy las sugerencias de compra/venta NO tienen ventaja demostrada.` });
  } else {
    out.push({ tone: 'good', txt: `Con ventaja real sobre el azar: ${adv.map(([k, c]) => `${REC_LABEL[k]} (${pts(c.edge)})`).join(', ')}.` });
    const rest = codes.filter(([, c]) => c.verdict !== 'ventaja');
    if (rest.length) out.push({ tone: 'warn', txt: `Sin ventaja: ${rest.map(([k, c]) => `${REC_LABEL[k]} (${pts(c.edge)}${c.verdict === 'peor' ? ', peor que el azar' : ''})`).join(', ')}.` });
  }
  const cov = R.coverage[5].in90;
  const d = cov - 0.9;
  out.push({
    tone: Math.abs(d) <= 0.03 ? 'good' : 'warn',
    txt: Math.abs(d) <= 0.03
      ? `Los rangos de "cuánto podría bajar o subir" están bien calibrados: a 1 semana, el precio real quedó dentro del rango del 90% el ${pp(cov)} de las veces.`
      : d < 0
        ? `Los rangos son demasiado estrechos: a 1 semana, el precio real quedó dentro del rango "del 90%" solo el ${pp(cov)} de las veces.`
        : `Los rangos son algo amplios: a 1 semana, el precio real quedó dentro el ${pp(cov)} de las veces (lo ideal es 90%).`,
  });
  const S = R.strategy;
  out.push({ tone: S.deep.cagr > S.bh.cagr ? 'good' : 'bad', txt: `Seguir las sugerencias (comprar en "Compra ahora", vender en "Vende") dio ${pp(S.deep.cagr)} al año contra ${pp(S.bh.cagr)} de solo comprar y mantener; le ganó en ${S.deep.beats} de ${S.n} empresas.` });
  out.push({ tone: S.sig.cagr > S.bh.cagr ? 'good' : 'bad', txt: `Seguir la señal COMPRA/VENTA dio ${pp(S.sig.cagr)} al año (le ganó a comprar y mantener en ${S.sig.beats} de ${S.n} empresas).` });
  if (R.spy) out.push({ tone: 'neutral', txt: `Referencia: comprar el S&P 500 (SPY) y no tocarlo dio ${pp(R.spy.cagr)} al año en el mismo periodo.` });
  return out;
}

function btProgHtml() {
  const p = state.bt.prog;
  if (!p) return '';
  return `<div class="scanning-note"><span>${esc(p.phase || '')} ${esc(p.sym || '')} · ${(p.i || 0) + 1}/${p.total || '…'}</span><div class="progress"><i style="width:${Math.round((p.frac || 0) * 100)}%"></i></div></div>`;
}

function btLine(sym, code) {
  const R = btResults();
  if (!R) return '';
  if (code === 'hold') return `<a class="bt-line" href="#/precision">📏 "Mantén y vigila" no es una apuesta, así que no tiene tasa de acierto. Ver la precisión medida →</a>`;
  const g = R.codes[code];
  if (!g || !g.n) return '';
  const y1 = R.period.from.slice(0, 4);
  const y2 = R.period.to.slice(0, 4);
  const ps = R.per[sym] && R.per[sym].codes[code];
  let txt;
  if (ps && ps[0] >= 15) txt = `en ${sym} (${y1}–${y2}) esta sugerencia salió ${ps[0]} veces y acertó ${pp(ps[1])}; al azar pasaba ${pp(ps[2])} (${pts(ps[1] - ps[2])}).`;
  else txt = `en ${R.symbols} empresas (${y1}–${y2}) esta sugerencia acertó ${pp(g.hit)} de ${g.n.toLocaleString('en-US')} veces; al azar pasaba ${pp(g.base)}.`;
  const v = VERDICT[g.verdict];
  return `<a class="bt-line" href="#/precision">📏 Historial real: ${txt} En general: <span class="sig ${v[0]}">${v[1]}</span> →</a>`;
}

function precisionCard() {
  const R = btResults();
  if (!R) return '';
  const codes = ['buy-now', 'buy-wait', 'sell-wait', 'sell-now'].map((k) => R.codes[k]).filter((c) => c && c.n >= 30);
  const adv = codes.filter((c) => c.verdict === 'ventaja').length;
  return `<a class="card prec-card" href="#/precision">
    <div class="eyebrow">Precisión medida · ${Math.round(R.years)} años de datos reales</div>
    <div class="prec-grid">
      <div><b class="${adv ? 'up' : 'down'}">${adv}/${codes.length}</b><span>sugerencias con ventaja real</span></div>
      <div><b>${pp(R.coverage[5].in90, 0)}</b><span>aciertos del rango a 1 semana (ideal 90%)</span></div>
      <div><b class="${R.strategy.deep.cagr > R.strategy.bh.cagr ? 'up' : 'down'}">${pp(R.strategy.deep.cagr)}</b><span>al año vs ${pp(R.strategy.bh.cagr)} comprar y mantener</span></div>
    </div>
    <span class="muted small">Ver la prueba completa →</span>
  </a>`;
}

function viewPrecision() {
  const b = state.bt;
  const R = btResults();
  const live = state.provider && state.provider.mode === 'live' && state.settings.tdKey;
  const runBox = `<section class="card">
    <h3>🔁 Repetir la prueba con mis datos</h3>
    <p class="hint" style="margin-top:0">Descarga ~11 años de cada empresa que sigue Pulso con tu clave de Twelve Data (1 consulta por empresa; tarda ~5 min por el límite gratuito) y vuelve a probar todas las reglas.</p>
    <div id="bt-prog">${b.running ? btProgHtml() : ''}</div>
    ${b.running
      ? '<button class="btn danger block" data-action="bt-stop">Detener</button>'
      : `<button class="btn primary block" data-action="bt-run" ${live ? '' : 'disabled'}>Ejecutar prueba histórica</button>${live ? '' : '<p class="hint warn">Necesitas el modo En vivo con tu clave de Twelve Data (Ajustes).</p>'}`}
  </section>`;
  const head = `<div class="page-head"><h2>📏 Precisión medida</h2><p>Las reglas de Pulso probadas contra lo que realmente pasó en el mercado</p></div>`;
  if (!R) return head + (b.refLoading ? '<div class="skel" style="height:200px"></div>' : '<div class="empty">Todavía no hay resultados.</div>') + runBox + disclaimer();

  const toggle = b.user && b.ref ? `<div class="seg">
      <button class="${R === b.ref ? 'active' : ''}" data-bt="ref">Referencia</button>
      <button class="${R === b.user ? 'active' : ''}" data-bt="user">Mi prueba</button></div>` : '';
  const codeRow = (label, c) => (c && c.n ? `<div class="bt-row">
      <div class="bt-name">${label}<small>${c.n.toLocaleString('en-US')} veces · cuenta como acierto si ${esc(c.desc)}</small></div>
      <div class="bt-nums"><b>${pp(c.hit)}</b><small>azar ${pp(c.base)}</small></div>
      <div class="bt-edge"><span class="sig ${VERDICT[c.verdict][0]}">${VERDICT[c.verdict][1]}</span><small>${pts(c.edge)}${Number.isFinite(c.lo) ? ` (de ${pts(c.lo)} a ${pts(c.hi)})` : ` · margen ±${(c.ci * 100).toFixed(1)}`}</small></div>
    </div>` : '');
  const cov = (h, label) => {
    const c = R.coverage[h];
    const ok90 = Math.abs(c.in90 - 0.9) <= 0.03;
    const ok50 = Math.abs(c.in50 - 0.5) <= 0.03;
    return `<tr><td>${label}</td><td class="${ok90 ? 'up' : 'down'}">${pp(c.in90)}</td><td class="${ok50 ? 'up' : 'down'}">${pp(c.in50)}</td></tr>`;
  };
  const S = R.strategy;
  const stat = (label, x, sub, good) => `<div class="ind"><span>${label}</span><b class="${good == null ? '' : good ? 'up' : 'down'}">${x}</b><small>${sub}</small></div>`;
  const perRows = Object.entries(R.per).sort((a, b2) => (b2[1].deep - b2[1].bh) - (a[1].deep - a[1].bh)).map(([sym, x]) =>
    `<tr><td><b>${esc(sym)}</b></td><td>${pp(x.cov90[1], 0)}</td><td class="${x.deep > x.bh ? 'up' : 'down'}">${pp(x.deep)}</td><td class="${x.sig > x.bh ? 'up' : 'down'}">${pp(x.sig)}</td><td>${pp(x.bh)}</td></tr>`).join('');

  return `${head}
    ${toggle}
    <section class="card glow">
      <div class="eyebrow">${esc(R.source)}</div>
      <h3 style="margin-top:6px">${R.symbols} empresas · ${R.period.from} a ${R.period.to} · ${R.evals.toLocaleString('en-US')} decisiones simuladas</h3>
      <ul class="bt-concl">${btConclusions(R).map((c) => `<li class="tone-${c.tone}">${esc(c.txt)}</li>`).join('')}</ul>
      <p class="hint">Cómo se hizo: cada semana de esos años, Pulso aplicó sus reglas usando solo los precios conocidos hasta ese día (sin ver el futuro) y después se comparó con lo que realmente pasó. Comisión supuesta: ${(R.commission * 100).toFixed(1)}% por operación.</p>
    </section>
    <section class="card">
      <h3>🎯 ¿Las sugerencias aciertan más que el azar?</h3>
      <p class="hint" style="margin-top:0">"Azar" es qué tan seguido pasaba eso de todos modos en esas mismas empresas (por ejemplo, las acciones suben en ~55% de las semanas). Una sugerencia solo sirve si acierta claramente más que eso.</p>
      ${['buy-now', 'buy-wait', 'sell-wait', 'sell-now'].map((k) => codeRow(REC_LABEL[k], R.codes[k])).join('')}
      ${R.codes['buy-wait'] && R.codes['buy-wait'].n ? `<p class="hint">Piso estimado (al esperar para comprar): se alcanzó el ${pp(R.codes['buy-wait'].reachTarget)} de las veces · techo estimado (al vender en unos días): ${pp(R.codes['sell-wait'].reachTarget)} (lo ideal es ~50%).</p>` : ''}
      <h4 class="sub" style="margin:16px 0 4px;font-size:14px">Señal de corto plazo (Ranking)</h4>
      ${['buy', 'sell'].map((k) => codeRow(SIG_LABEL[k], R.signals[k])).join('')}
    </section>
    <section class="card">
      <h3>📐 ¿Los rangos de "cuánto podría bajar o subir" son confiables?</h3>
      <table class="bt-table"><thead><tr><th>Horizonte</th><th>Dentro del rango 90%</th><th>Dentro del rango 50%</th></tr></thead>
        <tbody>${cov(1, 'Mañana')}${cov(5, '1 semana')}${cov(21, '1 mes')}</tbody></table>
      <p class="hint">Si los rangos estuvieran perfectamente calibrados, el precio real caería dentro del rango del 90% nueve de cada diez veces y dentro del del 50% la mitad de las veces. Verde = a menos de 3 puntos de lo ideal.</p>
    </section>
    <section class="card">
      <h3>💰 ¿Seguir a Pulso gana más que comprar y mantener?</h3>
      ${S.deep && S.deep.sharpe !== undefined ? metricsTable([['Seguir sugerencias', S.deep], ['Señal COMPRA/VENTA', S.sig], [`Las ${S.n} en partes iguales`, S.bh], ['S&P 500', S.spy || R.spy]]) : `<div class="ind-grid">
        ${stat('Seguir sugerencias', pp(S.deep.cagr) + ' /año', `caída máx. ${pp(S.deep.mdd, 0)}`, S.deep.cagr > S.bh.cagr)}
        ${stat('Seguir señal COMPRA/VENTA', pp(S.sig.cagr) + ' /año', `caída máx. ${pp(S.sig.mdd, 0)}`, S.sig.cagr > S.bh.cagr)}
        ${stat('Comprar y mantener', pp(S.bh.cagr) + ' /año', `caída máx. ${pp(S.bh.mdd, 0)}`, null)}
      </div>`}
      <p class="hint">Portafolio con el dinero repartido en partes iguales entre las ${S.n} empresas, decisiones una vez por semana y ${(R.commission * 100).toFixed(1)}% de comisión por operación. Sharpe y Sortino miden ganancia por unidad de riesgo (más de 1 es bueno); Calmar = ganancia anual / peor caída; Kelly = qué fracción del capital apostaría la fórmula (negativo = no apostar).</p>
    </section>
    <details class="card">
      <summary>🏢 Resultado por empresa</summary>
      <table class="bt-table"><thead><tr><th></th><th>Rango 90% (1 sem)</th><th>Sugerencias</th><th>Señal</th><th>Comprar y mantener</th></tr></thead><tbody>${perRows}</tbody></table>
      <p class="hint">Rendimiento anual promedio de cada forma de invertir en esa empresa.</p>
    </details>
    ${factorSection(state.fs.ref, 'Factores: ¿alguno predice qué acciones lo harán mejor que las demás?')}
    ${factorSection(state.fs.refApp, 'Réplica con las empresas de Pulso')}
    ${state.fs.user ? factorSection(state.fs.user, 'Factores con tus datos') : ''}
    ${journalSection()}
    <section class="card">
      <h3>⚠️ Lo que esta prueba NO mide</h3>
      <ul class="bt-concl">
        <li>Fundamentales, analistas y noticias: no hay historial gratuito de cómo estaban en cada fecha, así que solo se probaron las reglas técnicas y la simulación. Esa parte de la app sigue sin medirse.</li>
        <li>Sesgo de supervivencia: las empresas son las ganadoras de hoy; en 2016 nadie sabía que NVIDIA o Lilly subirían tanto. Eso infla el "comprar y mantener".</li>
        <li>Un solo periodo (mayormente alcista). En un mercado bajista largo los resultados podrían ser distintos.</li>
        <li>No incluye impuestos ni el diferencial de precio al comprar/vender.</li>
        <li>Los márgenes de error se calculan agrupando por semana (las empresas se mueven juntas); aun así, un periodo de 10 años es corto para conclusiones definitivas.</li>
      </ul>
    </section>
    ${runBox}
    ${disclaimer()}`;
}

async function runUserBacktest() {
  const b = state.bt;
  if (b.running) return;
  const prov = state.provider;
  if (!prov || prov.mode !== 'live' || !state.settings.tdKey || !prov.getLongHistory) {
    toast({ title: 'Falta configurar', body: 'Activa el modo En vivo con tu clave de Twelve Data.', kind: 'info' });
    return;
  }
  b.running = true;
  b.stop = false;
  const metas = [...allCompanies().filter((c) => !c.intl), INDICES[0]];
  b.prog = { phase: 'Descargando', sym: '', i: 0, total: metas.length, frac: 0 };
  if (state.tab === 'precision') renderView();
  const upd = () => { const el = $('#bt-prog'); if (el) el.innerHTML = btProgHtml(); };
  const datasets = [];
  const errors = [];
  for (let i = 0; i < metas.length && !b.stop; i++) {
    b.prog = { phase: 'Descargando historial de', sym: metas[i].s, i, total: metas.length, frac: (i / metas.length) * 0.5 };
    upd();
    try {
      const bars = await prov.getLongHistory(metas[i].s);
      if (bars && bars.length > 320) datasets.push({ meta: metas[i], bars });
    } catch (e) { errors.push(metas[i].s + ': ' + e.message); }
  }
  let res = null;
  if (!b.stop && datasets.length > 1) {
    res = await runBacktest(datasets, {
      source: 'Twelve Data · tus datos (precios ajustados)',
      shouldStop: () => b.stop,
      onProgress: (p) => { b.prog = { phase: 'Probando reglas en', sym: p.sym, i: p.i, total: p.total, frac: 0.5 + p.frac * 0.4 }; upd(); },
    });
    const spyD = datasets.find((d) => d.meta.s === 'SPY');
    const stocksD = datasets.filter((d) => d.meta.s !== 'SPY');
    if (!b.stop && spyD && stocksD.length >= 10) {
      try {
        const fres = await factorStudy(stocksD, spyD.bars, {
          source: 'Twelve Data · tus datos (precios ajustados)',
          label: `Tus ${stocksD.length} empresas`,
          onProgress: (f) => { b.prog = { phase: 'Probando factores', sym: '', i: 0, total: 1, frac: 0.9 + f * 0.1 }; upd(); },
        });
        state.fs.user = fres;
        save('fs:user', fres);
      } catch { /* el estudio de factores es opcional */ }
    }
  }
  b.running = false;
  b.prog = null;
  if (res && !b.stop) {
    b.user = res;
    b.show = 'user';
    save('bt:user', res);
    notify({ title: '📏 Prueba histórica terminada', body: `${res.symbols} empresas, ${res.evals.toLocaleString('en-US')} decisiones simuladas.${errors.length ? ` Sin datos: ${errors.length}.` : ''}`, kind: 'info' });
  } else if (!b.stop) {
    toast({ title: 'No se pudo completar', body: errors[0] || 'Sin datos suficientes.', kind: 'info' });
  }
  if (state.tab === 'precision') renderView();
}

// ---------------------------------------------------------------------------
// Fase 1: factores validados, cuenta virtual y diario de señales
// ---------------------------------------------------------------------------
const pxOf = (sym) => {
  const q = state.quotes[sym];
  return q && q.price > 0 ? q.price : NaN;
};
const pctS = (x, d = 1) => {
  if (!Number.isFinite(x)) return '—';
  const v = Math.abs(x) < 0.5 * 10 ** -(d + 2) ? 0 : x; // evita mostrar -0.0%
  return (v >= 0 ? '+' : '') + (v * 100).toFixed(d) + '%';
};
const fmtIC = (x) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(3) : '—');
const num2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '—');
const SHORT = { mom12_1: 'Tendencia 12 meses', high52: 'Cerca de máximos', trend200: 'Sobre media 200d', rev1w: 'Rebote 1 semana', rev1m: 'Rebote 1 mes', lowvol: 'Baja volatilidad', rsi14: 'RSI', pulsoShort: 'Pulso corto', pulsoLong: 'Pulso largo', composite: 'Combinación' };
const entryKey = (r) => r.id + ':' + r.h;
const FVERDICT = { validado: ['buy', 'VALIDADO'], prometedor: ['hold', 'PROMETEDOR'], no: ['sell', 'NO VALIDADO'] };

function metricsTable(cols) {
  const rows = [
    ['Ganancia anual (CAGR)', (m) => pp(m.cagr)],
    ['Sharpe', (m) => num2(m.sharpe)],
    ['Sortino', (m) => num2(m.sortino)],
    ['Peor caída', (m) => pp(m.mdd, 0)],
    ['Calmar', (m) => num2(m.calmar)],
    ['Años en la peor caída', (m) => (Number.isFinite(m.maxDdYears) ? m.maxDdYears.toFixed(1) : '—')],
    ['Operaciones', (m) => (m.trades ? m.trades.toLocaleString('en-US') : '—')],
    ['% operaciones ganadoras', (m) => (m.winRate != null ? pp(m.winRate, 0) : '—')],
    ['Factor de beneficio', (m) => num2(m.profitFactor)],
    ['Ganancia media por operación', (m) => (m.expectancy != null ? pctS(m.expectancy) : '—')],
    ['Kelly', (m) => (m.kelly != null ? pctS(m.kelly, 0) : '—')],
    ['SQN', (m) => num2(m.sqn)],
  ];
  return `<div class="m-wrap"><table class="bt-table m-table"><thead><tr><th></th>${cols.map(([l]) => `<th>${esc(l)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(([label, f]) => `<tr><td>${label}</td>${cols.map(([, m]) => `<td>${m ? f(m) : '—'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function factorRow(r) {
  const v = FVERDICT[r.verdict];
  const ex = r.strat.test.excess;
  return `<div class="bt-row">
    <div class="bt-name">${esc(r.name)}${r.sign < 0 ? ' <small style="display:inline">(al revés: gana lo de abajo)</small>' : ''}
      <small>IC entrenamiento ${fmtIC(r.train.ic)} · IC prueba ${fmtIC(r.test.ic)} (de ${fmtIC(r.test.lo)} a ${fmtIC(r.test.hi)}) · q = ${Number.isFinite(r.test.q) ? r.test.q.toFixed(2) : '—'}${r.members ? ' · combina: ' + r.members.map((m) => SHORT[m.id] || m.id).join(', ') : ''}</small></div>
    <div class="bt-nums"><b class="${ex.ann > 0 ? 'up' : 'down'}">${pctS(ex.ann)}</b><small>top 20% vs promedio /año</small></div>
    <div class="bt-edge"><span class="sig ${v[0]}">${v[1]}</span><small>${pp(r.strat.test.port && r.strat.test.port.cagr)} al año vs ${pp(r.strat.test.ew && r.strat.test.ew.cagr)} promedio</small></div>
  </div>`;
}

function factorSection(F, title) {
  if (!F) return '';
  const nVal = F.results.filter((r) => r.verdict === 'validado').length;
  const byH = HORIZONS.map((H) => {
    const list = F.results.filter((r) => r.h === H.h);
    return list.length ? `<h4 class="sub" style="margin:14px 0 2px;font-size:14px">Mantener ${H.label}</h4>${list.map(factorRow).join('')}` : '';
  }).join('');
  return `<section class="card">
    <h3>📊 ${title}</h3>
    <p class="hint" style="margin-top:0">${esc(F.label)}. Entrenamiento: ${F.period.from} a 2021 (solo para elegir la dirección de cada factor). Prueba a ciegas: ${F.period.testFrom} a ${F.period.to}. IC = qué tan bien coincide el orden del factor con el orden real de ganancias (0 = nada; en finanzas 0.03 a 0.05 ya es útil). q = probabilidad de que sea suerte tras corregir por probar ${F.results.length} ideas.</p>
    <div class="concl-line tone-${nVal ? 'good' : 'bad'}">${nVal ? `✅ ${nVal} quedó validado en los años de prueba.` : '❌ Ninguno quedó validado en los años de prueba.'}</div>
    ${byH}
    <p class="hint">VALIDADO = q &lt; 0.10, IC positivo en la prueba y el 20% de arriba le ganó al promedio después de costos (${(F.cost * 100).toFixed(1)}% por operación). PROMETEDOR = señal débil sin confirmar.</p>
  </section>`;
}

const baseCache = new Map();
function liveBase(sym, code) {
  const h = state.hist[sym];
  if (!h || h.length < 30 || !HIT[code]) return NaN;
  let rates = baseCache.get(sym);
  if (!rates) {
    const c = h.map((b) => b.close);
    const ev = [];
    for (let i = 0; i + 5 < c.length; i++) {
      const w = c.slice(i + 1, i + 6);
      ev.push({ r5: c[i + 5] / c[i] - 1, r21: 0, min5: Math.min(...w) / c[i] - 1, max5: Math.max(...w) / c[i] - 1 });
    }
    rates = baseRates(ev);
    baseCache.set(sym, rates);
  }
  return HIT[code].base(rates);
}

function journalSection() {
  const J = state.journal;
  if (!J) return '';
  J.evaluate((sym) => state.hist[sym]);
  const st = J.stats(liveBase);
  const rows = Object.keys(HIT).map((k) => {
    const x = st[k];
    return `<tr><td>${REC_LABEL[k]}</td><td>${x.n}</td><td>${x.n ? pp(x.hit) : '—'}</td><td>${x.n && Number.isFinite(x.base) ? pp(x.base) : '—'}</td><td>${x.pending}</td></tr>`;
  }).join('');
  const recent = J.list.slice(0, 10).map((e) => {
    const ok = e.r5 != null && HIT[e.code] ? HIT[e.code].hit(e) : null;
    return `<div class="tr-row"><b>${esc(e.sym)}</b> ${REC_LABEL[e.code] || esc(e.label)} a ${money(e.price, curOf(e.sym))}
      ${e.r5 != null ? `<span class="${ok ? 'up' : 'down'}">${ok ? '✅' : '❌'} ${pctS(e.r5)} en 1 semana</span>` : '<span class="muted">⏳ esperando 5 días hábiles</span>'}<small>${e.date}</small></div>`;
  }).join('');
  return `<section class="card">
    <h3>📓 Diario de señales en vivo</h3>
    <p class="hint" style="margin-top:0">Cada sugerencia para tus empresas seguidas queda registrada con su precio; a los 5 días hábiles se anota si acertó. Es la prueba hacia adelante: no se puede hacer trampa porque ese futuro aún no existía. Se necesitan al menos 30 señales evaluadas por tipo para concluir algo.</p>
    <table class="bt-table"><thead><tr><th>Sugerencia</th><th>Evaluadas</th><th>Aciertos</th><th>Azar</th><th>Pendientes</th></tr></thead><tbody>${rows}</tbody></table>
    ${recent ? `<h4 class="sub" style="margin:14px 0 4px;font-size:13px">Últimas señales</h4>${recent}` : '<p class="hint">Aún no hay señales registradas. Sigue algunas empresas (★) para empezar.</p>'}
    <p class="hint">${J.list.length} señales registradas en este dispositivo${state.provider && state.provider.mode === 'demo' ? ' · modo demo: con datos simulados esto no sirve como evidencia' : ''}.</p>
  </section>`;
}

function validatedEntries() {
  const F = state.fs.ref;
  if (!F) return [];
  return F.results.filter((r) => r.verdict === 'validado').sort((a, b) => b.test.ic - a.test.ic);
}
function currentEntry() {
  const v = validatedEntries();
  return v.find((r) => entryKey(r) === state.factorEntry) || v[0] || null;
}
// Si nada quedó validado, el robot de la cuenta virtual prueba (con dinero simulado)
// el candidato "prometedor" con menor p cuya dirección coincide con la teoría.
function candidateEntry() {
  const F = state.fs.ref;
  if (!F) return null;
  const c = F.results.filter((r) => r.verdict === 'prometedor' && r.sign > 0 && r.strat.test.excess.ann > 0).sort((a, b) => a.test.p - b.test.p);
  return c[0] || null;
}
function robotEntry() {
  const v = currentEntry();
  if (v) return { entry: v, validated: true };
  const c = candidateEntry();
  return c ? { entry: c, validated: false } : null;
}

function computeFactorRanking() {
  const re = robotEntry();
  if (!re) {
    state.factorRank = null;
    return;
  }
  const { entry, validated } = re;
  const datasets = allCompanies().filter((c) => !c.intl).map((c) => {
    const h = state.hist[c.s];
    if (!h || h.length < 260) return null;
    const closes = h.map((b) => b.close);
    const times = h.map((b) => b.time);
    const q = state.quotes[c.s];
    if (q && q.price > 0) {
      const d = isoDate(new Date(q.ts || Date.now()));
      if (d > times[times.length - 1]) {
        closes.push(q.price);
        times.push(d);
      } else if (d === times[times.length - 1]) closes[closes.length - 1] = q.price;
    }
    return { meta: c, closes, times };
  }).filter(Boolean);
  state.factorRank = { entry, validated, list: liveFactorRanking(entry, datasets), at: Date.now() };
}

function afterScanPhase1() {
  computeFactorRanking();
  const P = state.paper;
  if (!P) return;
  P.ensureSpy(pxOf);
  const fr = state.factorRank;
  if (fr && fr.list.length >= 5) {
    const K = Math.max(3, Math.round(0.2 * fr.list.length));
    const targets = fr.list.slice(0, K).map((x) => x.sym).filter((sym) => pxOf(sym) > 0);
    const label = (SHORT[fr.entry.id] || fr.entry.name) + (fr.validated ? '' : ', candidato sin validar');
    if (P.rebalanceFactors(targets, pxOf, label)) {
      toast({ title: '📊 Robot de factores rebalanceó (simulado)', body: `${label} · top 20%: ${targets.join(', ')}`, kind: 'info' });
    }
  }
  P.snapshot(pxOf);
  if (state.journal) state.journal.evaluate((sym) => state.hist[sym]);
  if (['cuenta', 'ranking', 'mercado'].includes(state.tab)) scheduleRender();
}

const rankSeg = (h) => `<div class="seg">
  <button class="${h === 'long' ? 'active' : ''}" data-horizon="long">🌱 Largo</button>
  <button class="${h === 'short' ? 'active' : ''}" data-horizon="short">⚡ Corto</button>
  <button class="${h === 'factors' ? 'active' : ''}" data-horizon="factors">📊 Factores</button>
</div>`;

function viewFactorRank() {
  const F = state.fs.ref;
  const head = `<div class="page-head"><h2>Ranking por factores</h2><p>Solo se muestra lo que pasó la prueba con años que no se usaron para diseñarlo</p></div>`;
  if (!F) return head + rankSeg('factors') + (state.bt.refLoading ? '<div class="skel" style="height:160px"></div>' : '<div class="empty">No se encontró la investigación de factores.</div>');
  const v = validatedEntries();
  if (!v.length) {
    const prom = F.results.filter((r) => r.verdict === 'prometedor');
    return `${head}${rankSeg('factors')}
      <section class="card"><h3>🚫 Ningún factor pasó la prueba</h3>
        <p class="hint" style="margin-top:0">En ${F.universe} empresas, ningún indicador ordenó las acciones mejor que el azar de forma confiable en los años de prueba (${F.period.testFrom.slice(0, 4)} en adelante). Por honestidad, Pulso no muestra un ranking "para comprar".</p>
        ${prom.length ? `<p class="hint">Prometedores, sin confirmar: ${prom.map((r) => `${esc(SHORT[r.id] || r.name)} (${r.hLabel})`).join(', ')}.</p>` : ''}
        ${state.factorRank && !state.factorRank.validated ? `<p class="hint">🧪 Para juntar evidencia en vivo sin arriesgar dinero, el robot de la cuenta virtual está probando el candidato más prometedor: <b>${esc(state.factorRank.entry.name)}</b> (${state.factorRank.entry.hLabel}). Si en unos meses le gana al S&amp;P 500 ahí, será una pista real; si no, se descarta.</p>` : ''}
        <div class="row-btns"><a class="btn" href="#/precision">Ver la investigación</a><a class="btn" href="#/cuenta">Ver la cuenta virtual</a></div></section>${disclaimer()}`;
  }
  const entry = currentEntry();
  const fr = state.factorRank;
  const T = entry.strat.test;
  const chips = v.length > 1 ? `<div class="chips">${v.map((r) => `<button class="chip ${entryKey(r) === entryKey(entry) ? 'active' : ''}" data-fentry="${entryKey(r)}">${esc(SHORT[r.id] || r.id)} · ${r.hLabel}</button>`).join('')}</div>` : '';
  const K = fr ? Math.max(3, Math.round(0.2 * fr.list.length)) : 0;
  const rows = fr ? fr.list.map((x, i) => {
    const a = state.analyses[x.sym];
    const q = state.quotes[x.sym];
    const sc = Math.round(x.score * 100);
    return `<article class="row ranked" data-open="${esc(x.sym)}"><span class="rank">${i + 1}</span>${logo(x.sym)}
      <div class="info"><b>${esc(meta(x.sym).n)}</b><small>${esc(x.sym)} · ${esc(sectorName(meta(x.sym).sec))}</small></div>
      <div class="right">${pxEl(x.sym, q ? q.price : a && a.price)}${chgEl(x.sym, q ? q.changePct : 0)}</div>${ring(sc, { size: 46 })}
      <div class="badges">${i < K ? '<span class="sig sbuy">TOP 20%</span>' : ''}<span class="chip-s">percentil ${sc}</span></div></article>`;
  }).join('') : '<div class="skel" style="height:74px"></div>'.repeat(4);
  return `${head}${rankSeg('factors')}${chips}
    <section class="card glow">
      <div class="eyebrow">Factor validado · mantener ${entry.hLabel}</div>
      <h3 style="margin-top:6px">${esc(entry.name)}${entry.sign < 0 ? ' (al revés)' : ''}</h3>
      <div class="prec-grid">
        <div><b class="up">${fmtIC(entry.test.ic)}</b><span>IC en años de prueba (${fmtIC(entry.test.lo)} a ${fmtIC(entry.test.hi)})</span></div>
        <div><b class="${T.excess.ann > 0 ? 'up' : 'down'}">${pctS(T.excess.ann)}</b><span>top 20% vs promedio por año, después de costos</span></div>
        <div><b>${pp(T.port && T.port.cagr)}</b><span>al año vs ${pp(T.ew && T.ew.cagr)} promedio y ${pp(T.spy && T.spy.cagr)} S&amp;P 500</span></div>
      </div>
      <p class="hint">Probado en ${F.universe} empresas: dirección elegida con ${F.period.from.slice(0, 4)}–2021 y evaluado a ciegas en ${F.period.testFrom.slice(0, 4)}–${F.period.to.slice(0, 4)}. Aquí se aplica a tus ${fr ? fr.list.length : 0} empresas. Cómo usarlo: comprar en partes iguales el 20% de arriba y revisar cada ${entry.h === 5 ? 'semana' : 'mes'}.</p>
    </section>
    <div class="list">${rows}</div>
    <p class="hint">Percentil 100 = la mejor clasificada de tus empresas según este factor. Un factor validado da una ventaja pequeña EN PROMEDIO entre muchas acciones; no garantiza que cada una suba.</p>
    ${disclaimer()}`;
}

function paperCard() {
  const P = state.paper;
  if (!P) return '';
  const cells = ['manual', 'factors', 'pulso', 'spy'].map((id) => {
    const r = P.value(id, pxOf) / P.s.start - 1;
    return `<div><b class="${r >= 0 ? 'up' : 'down'}">${pctS(r)}</b><span>${ACCOUNTS[id].icon} ${ACCOUNTS[id].name}</span></div>`;
  }).join('');
  return `<a class="card prec-card" href="#/cuenta"><div class="eyebrow">💼 Cuenta virtual · desde ${new Date(P.s.created).toLocaleDateString('es-MX')}</div>
    <div class="acc-mini">${cells}</div><span class="muted small">Ver las cuentas →</span></a>`;
}

function viewCuenta() {
  const P = state.paper;
  if (!P) return '<div class="empty">Cargando…</div>';
  const ids = ['manual', 'factors', 'pulso', 'spy'];
  const colors = { manual: '#22d3ee', factors: '#00e396', pulso: '#ffc857', spy: '#a78bfa' };
  const fr = state.factorRank;
  const cards = ids.map((id) => {
    const a = P.acc(id);
    const v = P.value(id, pxOf);
    const r = v / P.s.start - 1;
    const pos = Object.entries(a.pos);
    let status = '';
    if (id === 'factors') {
      status = fr
        ? `${fr.validated ? 'Factor validado' : 'Probando candidato NO validado'}: ${SHORT[fr.entry.id] || fr.entry.name}. ${a.last ? `Próximo rebalanceo en ${Math.max(0, Math.ceil((a.last + 6.5 * 864e5 - Date.now()) / 864e5))} día(s).` : 'Primer rebalanceo al terminar el análisis.'}`
        : 'En espera: no hay factor validado ni candidato, así que este robot no opera.';
    }
    if (id === 'pulso') status = `Sigue tus ${state.follow.length} empresas.`;
    const posRows = pos.map(([sym, ps]) => {
      const px = pxOf(sym) || ps.last;
      const res = px / ps.avg - 1;
      return `<tr><td><b>${esc(sym)}</b></td><td>${ps.qty.toFixed(ps.qty < 10 ? 3 : 1)}</td><td>${money(ps.avg)}</td><td>${money(ps.qty * px)}</td><td class="${res >= 0 ? 'up' : 'down'}">${pctS(res)}</td></tr>`;
    }).join('');
    const trRows = a.trades.slice(0, 12).map((t) => `<div class="tr-row"><span class="${t.side === 'buy' ? 'up' : 'down'}">${t.side === 'buy' ? 'COMPRA' : 'VENTA'}</span> <b>${esc(t.sym)}</b> ${t.qty.toFixed(t.qty < 10 ? 3 : 1)} a ${money(t.price)}${t.ret != null ? ` <span class="${t.ret >= 0 ? 'up' : 'down'}">${pctS(t.ret)}</span>` : ''}<small>${ago(t.t)} · ${esc(t.why || '')}</small></div>`).join('');
    return `<article class="card acc" style="--ac:${colors[id]}">
      <div class="acc-head"><span class="acc-ic">${ACCOUNTS[id].icon}</span><div><b>${ACCOUNTS[id].name}</b><small>${esc(ACCOUNTS[id].desc)}</small></div></div>
      <div class="acc-val"><b>${money(v)}</b><span class="${r >= 0 ? 'up' : 'down'}">${pctS(r)}</span></div>
      <div class="acc-sub">Efectivo ${money(a.cash)} · ${pos.length} posiciones · ${a.trades.length} operaciones${status ? ' · ' + esc(status) : ''}</div>
      ${pos.length ? `<details><summary>Posiciones</summary><table class="bt-table"><thead><tr><th></th><th>Cantidad</th><th>Costo prom.</th><th>Valor</th><th>Resultado</th></tr></thead><tbody>${posRows}</tbody></table></details>` : ''}
      ${a.trades.length ? `<details><summary>Últimas operaciones</summary>${trRows}</details>` : ''}
    </article>`;
  }).join('');
  const series = ids.map((id) => ({ name: ACCOUNTS[id].name, color: colors[id], pts: P.acc(id).eq }));
  const mcols = ids.map((id) => [ACCOUNTS[id].name, P.metrics(id)]);
  const days = P.daily('spy').length;
  return `<div class="page-head"><h2>💼 Cuenta virtual</h2><p>Dinero simulado con precios reales y costos (${(PAPER_COSTS.commission * 100).toFixed(2)}% de comisión + ${(PAPER_COSTS.slippage * 100).toFixed(2)}% de deslizamiento). Nunca se conecta a un bróker.</p></div>
    <section class="card glow">
      <h3>📈 Evolución desde ${new Date(P.s.created).toLocaleDateString('es-MX')}</h3>
      ${equityChart(series)}
      <div class="legend" style="flex-wrap:wrap">${ids.map((id) => `<span><i style="background:${colors[id]}"></i>${ACCOUNTS[id].name}</span>`).join('')}</div>
      <p class="hint">La prueba honesta antes de usar dinero real: que una estrategia le gane aquí a la línea del S&amp;P 500 durante 3 a 6 meses. Se guarda un punto por hora mientras usas la app, y los robots solo actúan cuando la app está abierta.</p>
    </section>
    ${cards}
    <section class="card">
      <h3>📏 Métricas</h3>
      ${days >= 20 ? metricsTable(mcols) : `<p class="hint" style="margin-top:0">Las métricas aparecen con al menos 20 días de registros (llevas ${days}).</p>`}
    </section>
    <section class="card">
      <h3>⚙️ Reiniciar</h3>
      <label class="field"><span>Capital inicial (simulado, USD)</span><input id="paper-start" type="number" inputmode="decimal" min="100" step="100" value="${P.s.start}"></label>
      <button class="btn danger block" data-action="paper-reset">Reiniciar las 4 cuentas</button>
    </section>
    ${disclaimer()}`;
}

function openTradeModal(sym) {
  const P = state.paper;
  const price = pxOf(sym);
  const a = P.acc('manual');
  const ps = a.pos[sym];
  openModal(`<div class="grab"></div>
    <h3>💼 Operar ${esc(sym)} con dinero simulado</h3>
    <p class="muted" style="margin:6px 0 0">Precio actual ${pxEl(sym, price)} · efectivo disponible ${money(a.cash)}</p>
    ${ps ? `<p class="hint">Tienes ${ps.qty.toFixed(3)} acciones · costo promedio ${money(ps.avg)} · resultado ${pctS(price / ps.avg - 1)}</p>` : ''}
    <label class="field"><span>Monto a comprar (USD simulados)</span><input id="paper-amt" type="number" inputmode="decimal" min="1" step="10" value="${Math.max(0, Math.min(1000, Math.floor(a.cash)))}"></label>
    <div class="quick">${[250, 500, 1000, 2500].map((v) => `<button data-pamt="${v}">$${v.toLocaleString('en-US')}</button>`).join('')}</div>
    <div class="row-btns">
      <button class="btn primary" data-action="paper-buy" data-sym="${esc(sym)}" ${price > 0 ? '' : 'disabled'}>Comprar</button>
      ${ps ? `<button class="btn danger" data-action="paper-sell" data-sym="${esc(sym)}">Vender todo</button>` : ''}
    </div>
    <p class="hint">Se cobra ${(PAPER_COSTS.commission * 100).toFixed(2)}% de comisión y ${(PAPER_COSTS.slippage * 100).toFixed(2)}% de deslizamiento por operación, como en la vida real. Tus resultados aparecen en Cuenta virtual.</p>`);
}

const VIEWS = { mercado: viewMercado, ranking: viewRanking, siguiendo: viewSiguiendo, noticias: viewNoticias, ajustes: viewAjustes, precision: viewPrecision, cuenta: viewCuenta };

// ---------------------------------------------------------------------------
// Renderizado
// ---------------------------------------------------------------------------
let renderTimer = null;
let lastRender = 0;
function renderView(scrollTop = false) {
  clearTimeout(renderTimer);
  renderTimer = null;
  lastRender = Date.now();
  $('#view').innerHTML = VIEWS[state.tab]();
  $$('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === state.tab));
  if (scrollTop) window.scrollTo(0, 0);
}
function scheduleRender(force = false) {
  const typing = document.activeElement && document.activeElement.closest('#view') && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
  if (typing && !force) return;
  if (state.tab === 'ajustes' && !force) return;
  if (renderTimer) return;
  const wait = Math.max(0, 600 - (Date.now() - lastRender));
  renderTimer = setTimeout(() => renderView(), wait);
}

function renderTicker() {
  const items = [...INDICES, ...allCompanies()].filter((m) => state.quotes[m.s]).map((m) => {
    const q = state.quotes[m.s];
    return `<span class="tk" data-open="${INDICES.includes(m) ? '' : esc(m.s)}"><b>${esc(m.s)}</b>${pxEl(m.s, q.price)}${chgEl(m.s, q.changePct)}</span>`;
  }).join('');
  $('#ticker').innerHTML = items ? items + items : '<span class="tk"><b>Cargando cotizaciones…</b></span>';
}

function renderChrome() {
  const conn = $('#conn');
  const demo = state.provider && state.provider.mode === 'demo';
  conn.className = 'conn ' + (demo ? 'demo' : state.conn === 'live' ? 'live' : '');
  conn.textContent = demo ? 'DEMO' : state.conn === 'live' ? 'EN VIVO' : 'SIN CONEXIÓN';
  const b = $('#mode-banner');
  if (demo) {
    b.innerHTML = `<div class="banner"><span><b>MODO DEMO</b> · datos simulados</span><a href="#/ajustes">Usar datos reales →</a></div>`;
  } else if (!state.settings.tdKey) {
    b.innerHTML = `<div class="banner warn"><span><b>SIN HISTORIAL</b> · agrega la clave de Twelve Data para gráficas y análisis técnico</span><a href="#/ajustes">Agregar →</a></div>`;
  } else b.innerHTML = '';
  const n = unreadCount();
  const badge = $('#bell-badge');
  badge.hidden = n === 0;
  badge.textContent = n > 9 ? '9+' : n;
  $('.scan-btn').classList.toggle('busy', state.scanning);
}

// ---------------------------------------------------------------------------
// Precios en vivo
// ---------------------------------------------------------------------------
const pending = new Map();
let flushTimer = null;
function onTick(sym, price) {
  if (!isNum(price)) return;
  pending.set(sym, price);
  if (!flushTimer) flushTimer = setTimeout(flushTicks, 300);
}
function flash(el, up) {
  el.classList.remove('fu', 'fd');
  void el.offsetWidth;
  el.classList.add(up ? 'fu' : 'fd');
}
function paintPrice(sym, q, old) {
  const cur = curOf(sym);
  $$(`[data-px="${sym}"]`).forEach((el) => {
    el.textContent = money(q.price, cur);
    if (old != null && old !== q.price) flash(el, q.price > old);
  });
  $$(`[data-chg="${sym}"]`).forEach((el) => {
    el.textContent = pct(q.changePct);
    el.classList.toggle('up', q.changePct >= 0);
    el.classList.toggle('down', q.changePct < 0);
  });
}
function flushTicks() {
  flushTimer = null;
  for (const [sym, price] of pending) {
    const q = state.quotes[sym] || (state.quotes[sym] = { prevClose: price, open: price, high: price, low: price });
    const old = q.price;
    q.price = price;
    q.high = Math.max(q.high ?? price, price);
    q.low = Math.min(q.low ?? price, price);
    q.ts = Date.now();
    if (q.prevClose) {
      q.change = price - q.prevClose;
      q.changePct = (q.change / q.prevClose) * 100;
    }
    const a = state.analyses[sym];
    if (a && !a.error) {
      a.price = price;
      a.changePct = q.changePct;
    }
    paintPrice(sym, q, old);
    Alerts.check(sym, price, meta(sym).n, curOf(sym));
    if (state.detail === sym) updateDetailLive(sym);
    // Si el precio se movió más de 1.5% desde el último análisis profundo, se recalcula.
    const dp = state.deep[sym];
    if (dp && state.follow.includes(sym) && Math.abs(price / dp.price - 1) > 0.015 && Date.now() - dp.at > 60e3) {
      computeDeep(sym, { reason: 'price' });
      if (state.detail === sym) renderDetailBody();
      if (state.tab === 'siguiendo') scheduleRender();
    }
  }
  pending.clear();
}

// ---------------------------------------------------------------------------
// Análisis profundo (10,000 escenarios) y noticias de último momento
// ---------------------------------------------------------------------------
const newsKey = (n) => String(n.id != null ? n.id : n.headline);
const REASON_TXT = { scan: 'análisis general', news: 'por noticia nueva', price: 'por movimiento de precio', manual: 'recalculado a mano' };

function computeDeep(sym, { reason = 'scan', notifyChange = true } = {}) {
  const a = state.analyses[sym];
  if (!a || a.error) return null;
  const d = deepAnalysis(a, state.companyNews[sym]);
  if (!d) return null;
  d.at = Date.now();
  d.reason = reason;
  state.deep[sym] = d;
  if (state.follow.includes(sym) && state.journal) {
    state.journal.add({ sym, code: d.rec.code, label: d.rec.label, price: d.price });
    if (state.paper && state.paper.onRecommendation(sym, d.rec.code, d.price, state.follow.length)) state.paper.snapshot(pxOf, true);
  }
  const key = 'deepRecs:' + state.provider.mode;
  const recs = load(key, {});
  const prev = recs[sym];
  if (prev !== d.rec.code) {
    recs[sym] = d.rec.code;
    save(key, recs);
  }
  if (notifyChange && state.settings.notifySignals && prev && prev !== d.rec.code) {
    notify({
      title: `🎯 ${sym}: ${d.rec.label}`,
      body: `${d.rec.text} (${d.N.toLocaleString('en-US')} escenarios, margen de error ±${(d.moe * 100).toFixed(2)}%)`,
      kind: d.rec.kind,
      sym,
    });
  }
  return d;
}

function reanalyze(sym) {
  const raw = state.raw[sym];
  if (!raw) return;
  try {
    state.analyses[sym] = analyze({ meta: meta(sym), history: state.hist[sym] || null, quote: state.quotes[sym] || null, fund: raw.fund, rec: raw.rec, news: state.companyNews[sym] });
  } catch { /* conserva el análisis anterior */ }
}

let newsPolling = false;
let lastNewsPoll = Date.now();
async function pollFollowedNews() {
  if (newsPolling || !state.provider || state.scanning) return;
  newsPolling = true;
  lastNewsPoll = Date.now();
  const prov = state.provider;
  const token = state.token;
  try {
    for (const sym of state.follow.slice(0, 15)) {
      const a = state.analyses[sym];
      if (!a || a.error) continue;
      let items;
      try { items = await prov.getCompanyNews(sym, { fresh: true }); } catch { continue; }
      if (token !== state.token) return;
      const known = state.newsSeen[sym];
      const seen = new Set(known || []);
      const fresh = items.filter((n) => !seen.has(newsKey(n)));
      state.newsSeen[sym] = [...new Set([...items.map(newsKey), ...(known || [])])].slice(0, 100);
      state.companyNews[sym] = items;
      if (!known || !fresh.length) continue;
      reanalyze(sym);
      const d = computeDeep(sym, { reason: 'news', notifyChange: false });
      if (state.settings.notifySignals) {
        const cur = curOf(sym);
        const h = d && d.h[5];
        notify({
          title: `📰 ${sym}: ${fresh.length > 1 ? fresh.length + ' noticias nuevas' : 'noticia de último momento'}`,
          body: `"${fresh[0].headline}"` + (d ? ` → ${d.rec.emoji} ${d.rec.label}. En 1 semana: entre ${money(h.p5, cur)} y ${money(h.p95, cur)} (más probable ${money(h.p50, cur)}).` : ''),
          kind: d ? d.rec.kind : 'info',
          sym,
        });
      }
      if (state.detail === sym) renderDetailBody();
    }
  } finally {
    newsPolling = false;
    save('newsSeen', state.newsSeen);
    if (state.tab === 'siguiendo' || state.tab === 'noticias') scheduleRender();
  }
}
setInterval(() => {
  if (!state.provider) return;
  const every = state.provider.mode === 'demo' ? 45e3 : 5 * 60e3;
  if (Date.now() - lastNewsPoll >= every) pollFollowedNews();
}, 15e3);

function rangeBar(label, h, price, cur) {
  const lo = h.p5;
  const span = h.p95 - lo || 1;
  const x = (v) => Math.max(0, Math.min(100, ((v - lo) / span) * 100));
  return `<div class="rb">
    <div class="rb-head"><b>${label}</b><span>Prob. de subir <b class="${h.probUp >= 0.5 ? 'up' : 'down'}">${Math.round(h.probUp * 100)}%</b></span></div>
    <div class="rb-bar"><i class="rb-band" style="left:${x(h.p25)}%;width:${x(h.p75) - x(h.p25)}%"></i><i class="rb-now" style="left:${x(price)}%"></i><i class="rb-med" style="left:${x(h.p50)}%"></i></div>
    <div class="rb-foot"><span class="down">${money(h.p5, cur)}<small>podría bajar ${pctR(h.p5 / price - 1)}</small></span><span class="mid">${money(h.p50, cur)}<small>más probable</small></span><span class="up">${money(h.p95, cur)}<small>podría subir ${pctR(h.p95 / price - 1)}</small></span></div>
  </div>`;
}

function deepCard(sym) {
  if (!state.follow.includes(sym)) {
    return `<section class="card deep-cta">
      <h3>🎯 Análisis profundo · 10,000 escenarios</h3>
      <p class="hint" style="margin-top:0">Sigue esta empresa y Pulso vigilará sus noticias de último momento: cada vez que salga una noticia o el precio se mueva, simulará 10,000 escenarios y te dirá si conviene comprar ahora, esperar unos días o vender, con cuánto podría bajar o subir.</p>
      <button class="btn primary block" style="margin-top:12px" data-action="follow" data-sym="${esc(sym)}">☆ Seguir y activar</button>
    </section>`;
  }
  const d = state.deep[sym];
  const a = state.analyses[sym];
  if (!d) {
    const noHist = a && !a.error && !isNum(a.tech.vol);
    return `<section class="card"><h3>🎯 Análisis profundo</h3><p class="hint">${noHist ? 'Necesita el historial de precios (agrega tu clave de Twelve Data en Ajustes).' : 'Calculando 10,000 escenarios…'}</p></section>`;
  }
  const r = d.rec;
  const cur = d.cur;
  const ni = d.news;
  return `<section class="card deep rec-${r.code}">
    <div class="eyebrow">El modelo sugiere · ${d.N.toLocaleString('en-US')} escenarios</div>
    <div class="rec-big">${r.emoji} ${r.label}</div>
    <p>${esc(r.text)}</p>
    <div class="rec-target"><span>${r.targetLabel}</span><b>${money(r.target, cur)}</b><small>${pctR(r.target / d.price - 1)}</small></div>
    ${btLine(sym, r.code)}
    <div class="rec-conf">Confianza del modelo: <b>${r.confidence}</b> · señales consideradas:</div>
    <div class="reasons">${r.reasons.map((x) => `<span class="ev ${x.dir > 0 ? 'buy' : x.dir < 0 ? 'sell' : 'info'}">${esc(x.txt)}</span>`).join('')}</div>
    <h4 class="sub">¿Cuánto podría bajar o subir?</h4>
    ${rangeBar('Mañana', d.h[1], d.price, cur)}
    ${rangeBar('En 1 semana', d.h[5], d.price, cur)}
    ${rangeBar('En 1 mes', d.h[21], d.price, cur)}
    <p class="hint">Cada barra va del escenario malo (5%) al bueno (95%): 9 de cada 10 escenarios quedan dentro. La zona clara es el rango probable (la mitad de los escenarios), la línea blanca es el precio actual y el punto azul, el precio más probable.</p>
    <div class="news-imp">📰 ${ni.count
      ? `${ni.count} noticias en 72 h (${ni.pos} positivas, ${ni.neg} negativas) → efecto estimado ${pctR(d.params.newsWeek, 2)} en la semana y volatilidad ${pctR(d.params.sigmaEff / d.params.sigma - 1, 0)}.`
      : 'Sin noticias recientes: la simulación usa solo el precio y su volatilidad.'}
      ${ni.latest ? `<div class="latest">Última: "${esc(ni.latest.headline)}" · ${ago(ni.latest.datetime * 1000)}</div>` : ''}</div>
    <div class="moe">🎯 Margen de error de la simulación: <b>±${(d.moe * 100).toFixed(2)}%</b> (95% de confianza)</div>
    <details class="moe-info"><summary>¿Qué significa el margen de error?</summary>
      <p>Con ${d.N.toLocaleString('en-US')} escenarios, las probabilidades y precios estimados tienen un error de cálculo de ±${(d.moe * 100).toFixed(2)}% o menos: si repitiéramos la simulación, saldría prácticamente igual. Si el error pasara de 1%, Pulso aumenta automáticamente los escenarios (hasta 40,000).</p>
      <p>Eso <b>no</b> significa que el precio real vaya a quedar a ±1% de la estimación: el mercado reacciona a sorpresas que ningún modelo conoce. Por eso te mostramos el rango completo de cuánto podría bajar o subir.</p>
    </details>
    <div class="deep-foot"><span class="muted small">Calculado ${ago(d.at)} · ${REASON_TXT[d.reason] || ''}</span>
      <button class="btn sm" data-action="deep-recalc" data-sym="${esc(sym)}">↻ Recalcular</button></div>
  </section>`;
}

function deepMini(sym) {
  const d = state.deep[sym];
  if (!d) return '';
  const h = d.h[5];
  const cur = d.cur;
  const r = d.rec;
  const ni = d.news;
  const fresh = ni.latest && Date.now() / 1000 - ni.latest.datetime < 12 * 3600;
  return `<div class="deep-mini rec-${r.code}">
    <div class="dm-rec">${r.emoji} ${r.label}</div>
    <div class="dm-range">En 1 semana: entre <b class="down">${money(h.p5, cur)}</b> y <b class="up">${money(h.p95, cur)}</b> · más probable <b>${money(h.p50, cur)}</b></div>
    <div class="dm-meta">🎯 ${d.N.toLocaleString('en-US')} escenarios · margen ±${(d.moe * 100).toFixed(2)}% · confianza ${r.confidence.toLowerCase()}</div>
    ${fresh ? `<div class="dm-news">📰 ${ago(ni.latest.datetime * 1000)}: ${esc(ni.latest.headline)}</div>` : ''}
  </div>`;
}

// ---------------------------------------------------------------------------
// Proveedor y escaneo
// ---------------------------------------------------------------------------
function liveSymbols() {
  return [...new Set([...state.follow, ...INDICES.map((i) => i.s), ...allCompanies().map((c) => c.s)])];
}

function initProvider() {
  if (state.provider) state.provider.disconnect();
  state.token++;
  state.provider = createProvider(state.settings);
  state.paper = new PaperBook(state.provider.mode);
  state.journal = new SignalJournal(state.provider.mode);
  state.factorRank = null;
  baseCache.clear();
  Object.assign(state, { analyses: {}, quotes: {}, hist: {}, profiles: {}, pulse: null, news: [], companyNews: {}, scanning: false, conn: 'off', deep: {}, raw: {} });
  state.provider.connect(liveSymbols(), onTick, (s) => {
    state.conn = s;
    renderChrome();
  });
  renderChrome();
  renderTicker();
}

async function analyzeOne(sym, prov, token) {
  const m = meta(sym);
  try {
    const [hist, quote, fund, rec, news, profile] = await Promise.all([
      prov.getHistory(sym).catch(() => null),
      prov.getQuote(sym).catch(() => null),
      prov.getFundamentals(sym).catch(() => null),
      prov.getRecommendation(sym).catch(() => null),
      prov.getCompanyNews(sym).catch(() => []),
      prov.getProfile(sym).catch(() => null),
    ]);
    if (token !== state.token) return;
    if (!quote && !hist) throw new Error(m.intl ? 'Sin datos en el plan gratuito (bolsa de Corea)' : 'Sin datos disponibles');
    if (hist) state.hist[sym] = hist;
    if (quote) {
      const prev = state.quotes[sym];
      // Si ya llegaron ticks en vivo más recientes, conservamos ese precio.
      state.quotes[sym] = prev && prev.ts > quote.ts ? { ...quote, price: prev.price, changePct: prev.changePct } : quote;
    }
    if (profile) state.profiles[sym] = profile;
    state.companyNews[sym] = news || [];
    state.raw[sym] = { fund, rec };
    state.analyses[sym] = analyze({ meta: m, history: hist, quote: state.quotes[sym] || null, fund, rec, news });
    if (state.follow.includes(sym)) {
      if (!state.newsSeen[sym]) {
        state.newsSeen[sym] = (news || []).map(newsKey).slice(0, 100);
        save('newsSeen', state.newsSeen);
      }
      computeDeep(sym, { reason: 'scan' });
    }
  } catch (e) {
    if (token !== state.token) return;
    state.analyses[sym] = { sym, name: m.n, sec: m.sec, error: e.message || 'Error' };
  }
}

async function runScan({ manual = false } = {}) {
  if (manual) showScanFx();
  if (state.scanning) return;
  const prov = state.provider;
  const token = state.token;
  const syms = [...new Set([...state.follow, ...allCompanies().map((c) => c.s)])];
  state.scanning = true;
  state.progress = { done: 0, total: syms.length, current: '' };
  renderChrome();
  scheduleRender();

  try { state.status = await prov.getMarketStatus(); } catch { /* opcional */ }
  try { state.news = await prov.getMarketNews(); } catch { /* opcional */ }
  await Promise.all(INDICES.map(async (ix) => {
    const [h, q] = await Promise.all([prov.getHistory(ix.s).catch(() => null), prov.getQuote(ix.s).catch(() => null)]);
    if (token !== state.token) return;
    if (h) state.hist[ix.s] = h;
    if (q) state.quotes[ix.s] = q;
  }));
  if (token !== state.token) return;
  renderTicker();

  let i = 0;
  const worker = async () => {
    while (i < syms.length && token === state.token) {
      const sym = syms[i++];
      state.progress.current = sym;
      updateScanFx();
      await analyzeOne(sym, prov, token);
      state.progress.done++;
      updateScanFx();
      scheduleRender();
      if (prov.mode === 'demo') await sleep(state.manualScan ? 180 : 20);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (token !== state.token) return;

  state.pulse = marketPulse(state.analyses, SECTORS);
  state.lastScan = Date.now();
  state.scanning = false;
  renderTicker();
  renderChrome();
  renderView();
  if (state.detail) renderDetailBody();
  finishScanFx();
  emitSignalNotifications();
  afterScanPhase1();
}

function emitSignalNotifications() {
  if (!state.settings.notifySignals) return;
  const list = analysesList();
  if (!list.length) return;
  const prev = load('signals:' + state.provider.mode, null);
  const today = isoDate();
  const sent = load('sentEvents', {});
  const cur = {};
  const changes = [];
  const evs = [];
  for (const a of list) {
    cur[a.sym] = a.signal;
    if (prev && prev[a.sym] && prev[a.sym] !== a.signal && a.signalType !== 'hold') changes.push(a);
    for (const ev of a.events) {
      if (ev.type === 'info') continue;
      const k = `${a.sym}|${ev.txt}|${today}`;
      if (!sent[k]) {
        sent[k] = 1;
        if (prev && state.follow.includes(a.sym)) evs.push({ a, ev });
      }
    }
  }
  Object.keys(sent).forEach((k) => { if (!k.endsWith(today)) delete sent[k]; });
  save('sentEvents', sent);
  save('signals:' + state.provider.mode, cur);

  if (!prev) {
    const top = list.slice().sort((a, b) => combined(b) - combined(a)).slice(0, 3).map((a) => a.sym).join(', ');
    const p = state.pulse;
    notify({
      title: '📊 Análisis del mercado completado',
      body: `Mercado en modo ${p ? p.label.toUpperCase() : '—'}. ${p ? p.buys : 0} señales de compra y ${p ? p.sells : 0} de venta. Destacan: ${top}.`,
      kind: 'info',
    });
    return;
  }
  changes.sort((a, b) => Math.abs(b.scoreShort - 50) - Math.abs(a.scoreShort - 50));
  changes.slice(0, 4).forEach((a) => notify({
    title: `${a.signalType === 'buy' ? '📈' : '📉'} Señal de ${a.signal}: ${a.sym}`,
    body: `${a.name} · ${money(a.price, a.cur)} · ${a.verdict.title} (horizonte: ${a.verdict.horizon}). Corto ${a.scoreShort}/100 · Largo ${a.scoreLong}/100.`,
    kind: a.signalType,
    sym: a.sym,
  }));
  if (changes.length > 4) notify({ title: `+${changes.length - 4} señales nuevas`, body: 'Revisa el ranking para verlas todas.', kind: 'info' });
  evs.slice(0, 3).forEach(({ a, ev }) => notify({
    title: `⚡ ${a.sym}: ${ev.txt}`,
    body: `${a.name} · ${money(a.price, a.cur)} · Señal del modelo: ${a.signal}.`,
    kind: ev.type,
    sym: a.sym,
  }));
}

// ---------------------------------------------------------------------------
// Efecto de escaneo
// ---------------------------------------------------------------------------
function showScanFx() {
  state.manualScan = true;
  const el = $('#scanfx');
  el.innerHTML = `<div class="sfx">
    <div class="radar">${[[30, 40], [140, 60], [70, 150], [160, 140], [100, 30]].map(([x, y], i) => `<i class="blip" style="left:${x}px;top:${y}px;animation-delay:${i * 0.4}s"></i>`).join('')}<div class="cur" id="sfx-cur">···</div></div>
    <h3>Analizando el mercado</h3>
    <div class="count" id="sfx-count">0 escenarios simulados</div>
    <div class="progress"><i id="sfx-bar"></i></div>
    <div class="steps" id="sfx-steps">Técnico · Fundamentales · Analistas · Noticias · Monte Carlo</div>
    <button class="btn" data-action="close-scanfx">Seguir en segundo plano</button>
  </div>`;
  el.classList.add('open');
  updateScanFx();
}
const STEP_TXT = ['📈 Calculando medias móviles, MACD y RSI', '🏦 Revisando márgenes, deuda y valuación', '🧑‍💼 Leyendo consenso de analistas', '📰 Midiendo el sentimiento de noticias', '🎲 Simulando 2,000 escenarios de precio'];
function updateScanFx() {
  if (!state.manualScan) return;
  const { done, total, current } = state.progress;
  const c = $('#sfx-cur');
  if (!c) return;
  c.textContent = current || '···';
  $('#sfx-count').textContent = `${(done * 2000).toLocaleString('en-US')} escenarios simulados · ${done}/${total || '…'} empresas`;
  $('#sfx-bar').style.width = (total ? (done / total) * 100 : 0) + '%';
  $('#sfx-steps').textContent = STEP_TXT[done % STEP_TXT.length];
}
function finishScanFx() {
  if (!state.manualScan) return;
  const c = $('#sfx-cur');
  if (c) c.textContent = '✓';
  const st = $('#sfx-steps');
  if (st) st.textContent = `Listo: ${analysesList().length} empresas analizadas.`;
  setTimeout(() => {
    closeScanFx();
    if (!state.detail) location.hash = '#/ranking';
  }, 900);
}
function closeScanFx() {
  state.manualScan = false;
  $('#scanfx').classList.remove('open');
}

// ---------------------------------------------------------------------------
// Detalle de empresa
// ---------------------------------------------------------------------------
function chartBars(sym) {
  const h = state.hist[sym];
  if (!h || !h.length) return null;
  const bars = h.slice();
  const q = state.quotes[sym];
  if (q && isNum(q.price)) {
    const d = isoDate(new Date(q.ts || Date.now()));
    const lb = bars[bars.length - 1];
    if (d > lb.time) {
      bars.push({ time: d, open: q.open || q.price, high: Math.max(q.high || q.price, q.price), low: Math.min(q.low || q.price, q.price), close: q.price, volume: 0 });
    } else if (d === lb.time) {
      bars[bars.length - 1] = { ...lb, close: q.price, high: Math.max(lb.high, q.price), low: Math.min(lb.low, q.price) };
    }
  }
  return bars;
}

function goDetail(sym) {
  if (!sym) return;
  state.detailPushed = true;
  location.hash = '#/empresa/' + encodeURIComponent(sym);
}

async function openDetail(sym) {
  if (state.detail === sym && $('#sheet').classList.contains('open')) return;
  destroyChart();
  state.detail = sym;
  state.mcTab = 'short';
  const m = meta(sym);
  const q = state.quotes[sym];
  const a = state.analyses[sym];
  const followed = state.follow.includes(sym);
  $('#sheet').innerHTML = `
    <div class="sheet-top">
      <button class="icon-btn" data-action="close-detail" aria-label="Volver">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="m15 18-6-6 6-6"/></svg></button>
      ${logo(sym, 36)}
      <div class="st-title"><b>${esc(m.n)}</b><small>${esc(sym)} · ${esc(sectorName(m.sec))}</small></div>
      <button class="icon-btn ${followed ? 'on' : ''}" data-action="follow" data-sym="${esc(sym)}" aria-label="Seguir">★</button>
    </div>
    <div class="sheet-body">
      <div class="d-price">${pxEl(sym, q ? q.price : a && a.price, 'big')}${chgEl(sym, q ? q.changePct : 0)}
        <span class="st">${esc(state.status ? state.status.label : '')}${a && a.updated ? ' · análisis ' + ago(a.updated) : ''}</span></div>
      <div class="card chart-card">
        <div class="tf">${[[21, '1M'], [63, '3M'], [126, '6M'], [252, '1A'], [9999, 'Todo']].map(([n, l]) => `<button data-tf="${n}" class="${state.chartTf === n ? 'active' : ''}">${l}</button>`).join('')}</div>
        <div id="chart" class="chart"><div class="skel" style="height:100%"></div></div>
        <div class="legend"><span><i style="background:var(--gold)"></i>Media 50d</span><span><i style="background:var(--violet-2)"></i>Media 200d</span><span><i style="background:var(--red);height:2px"></i>Alertas</span></div>
      </div>
      <div class="d-actions">
        <button class="btn primary" data-action="alert" data-sym="${esc(sym)}">🔔 Alerta de precio</button>
        <button class="btn" data-action="follow" data-sym="${esc(sym)}">${followed ? '★ Siguiendo' : '☆ Seguir'}</button>
      </div>
      <button class="btn block" style="margin-bottom:12px" data-action="paper-open" data-sym="${esc(sym)}">💼 Comprar o vender con dinero simulado</button>
      <div id="d-body"></div>
    </div>`;
  $('#sheet').classList.add('open');
  $('#sheet').scrollTop = 0;
  document.body.classList.add('noscroll');
  renderDetailBody();

  if (!a || a.error || !state.hist[sym]) {
    await analyzeOne(sym, state.provider, state.token);
    if (state.detail !== sym) return;
    const q2 = state.quotes[sym];
    if (q2) paintPrice(sym, q2);
    renderDetailBody();
  }
  buildChart(sym);
}

function destroyChart() {
  if (state.chart) {
    try { state.chart.destroy(); } catch { /* nada */ }
  }
  state.chart = null;
  state.chartBar = null;
}

function buildChart(sym) {
  const el = $('#chart');
  if (!el) return;
  const bars = chartBars(sym);
  if (!bars) {
    el.innerHTML = `<div class="empty small">${state.provider.mode === 'live' && !state.settings.tdKey ? 'Agrega tu clave de Twelve Data en Ajustes para ver la gráfica histórica.' : 'Sin historial disponible para esta empresa.'}</div>`;
    return;
  }
  el.innerHTML = '';
  const closes = bars.map((b) => b.close);
  state.chart = priceChart(el, bars, { sma50: sma(closes, 50), sma200: sma(closes, 200) });
  state.chartBar = { ...bars[bars.length - 1] };
  state.chart.setRange(state.chartTf);
  applyAlertLines(sym);
}

function applyAlertLines(sym) {
  if (!state.chart) return;
  const al = Alerts.get(sym);
  const lv = [];
  if (al && al.min != null) lv.push({ price: al.min, color: '#ff4d6a', title: 'Mín' });
  if (al && al.max != null) lv.push({ price: al.max, color: '#00e396', title: 'Máx' });
  state.chart.setLevels(lv);
}

function updateDetailLive(sym) {
  const q = state.quotes[sym];
  if (!state.chart || !state.chartBar || !q) return;
  const today = isoDate(new Date(q.ts || Date.now()));
  let b = state.chartBar;
  if (today > b.time) b = state.chartBar = { time: today, open: b.close, high: q.price, low: q.price, close: q.price, volume: 0 };
  b.close = q.price;
  b.high = Math.max(b.high, q.price);
  b.low = Math.min(b.low, q.price);
  try { state.chart.update({ ...b }); } catch { /* nada */ }
}

function renderDetailBody() {
  const sym = state.detail;
  const box = $('#d-body');
  if (!sym || !box) return;
  const a = state.analyses[sym];
  if (!a) {
    box.innerHTML = `<div class="card"><div class="skel" style="height:140px"></div></div><div class="card"><div class="skel" style="height:200px"></div></div>`;
    return;
  }
  if (a.error) {
    box.innerHTML = `<div class="card"><h3>No se pudo analizar ${esc(sym)}</h3><p class="hint">${esc(a.error)}</p></div>`;
    return;
  }
  const cur = a.cur;
  const v = a.verdict;
  const al = Alerts.get(sym);
  const t = a.tech;
  const f = a.fund || {};

  // Monte Carlo con abanico
  let mcHtml = '';
  if (isNum(t.vol)) {
    const days = state.mcTab === 'short' ? 21 : 252;
    const levels = al ? [al.min, al.max].filter((x) => x != null) : [];
    const mc = simulate(a, days, { levels, fanPoints: 24 });
    const r = (x) => x / a.price - 1;
    mcHtml = `<section class="card">
      <h3>🎲 1,000 escenarios simulados</h3>
      <div class="seg"><button data-mc="short" class="${state.mcTab === 'short' ? 'active' : ''}">1 mes</button><button data-mc="long" class="${state.mcTab === 'long' ? 'active' : ''}">1 año</button></div>
      ${fanChart(mc, a.price, { min: al && al.min, max: al && al.max, cur, horizonLabel: days === 21 ? '1 mes' : '1 año' })}
      <div class="mc-stats">
        <div><span>Probabilidad de ganar</span><b class="${mc.probUp >= 0.5 ? 'up' : 'down'}">${Math.round(mc.probUp * 100)}%</b><small>de 1,000 escenarios</small></div>
        <div><span>Escenario mediano</span><b>${pctR(r(mc.p50))}</b><small>${money(mc.p50, cur)}</small></div>
        <div><span>Pesimista (peor 5%)</span><b class="down">${pctR(r(mc.p5))}</b><small>${money(mc.p5, cur)}</small></div>
        <div><span>Optimista (mejor 5%)</span><b class="up">${pctR(r(mc.p95))}</b><small>${money(mc.p95, cur)}</small></div>
      </div>
      ${levels.length ? `<p class="hint">🔔 Probabilidad de tocar tu${levels.length > 1 ? 's' : ''} alerta${levels.length > 1 ? 's' : ''} en ${days === 21 ? '1 mes' : '1 año'}: ${levels.map((l, i) => `<b>${money(l, cur)} → ${Math.round(mc.levelProb[i] * 100)}%</b>`).join(' · ')}</p>` : ''}
      <p class="hint">Supuestos: volatilidad histórica ${pctR(mc.sigma, 0).replace('+', '')} anual y rendimiento esperado ${pctR(mc.mu, 1)} anual (40% su propio historial + 60% el promedio del mercado, para no exagerar rachas). Son escenarios posibles, no una predicción.</p>
    </section>`;
  }

  const factorRows = (arr) => arr.map((x) => {
    const w = Math.abs(x.value) * 50;
    const col = x.value >= 0 ? 'var(--green)' : 'var(--red)';
    const pos = x.value >= 0 ? `left:50%;width:${w}%` : `left:${50 - w}%;width:${w}%`;
    return `<div class="factor"><span>${esc(x.label)}</span><div class="fbar"><i style="${pos};background:${col}"></i></div></div>`;
  }).join('');

  const an = a.analyst;
  const ind = (label, val, sub = '') => `<div class="ind"><span>${label}</span><b>${val}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const news = (state.companyNews[sym] || []).slice(0, 6);

  box.innerHTML = `
    <section class="card verdict ${v.tone}">
      <div class="eyebrow">Veredicto del modelo</div>
      <div class="v-head" style="margin-top:8px"><span class="v-emoji">${v.emoji}</span><div><div class="v-title">${esc(v.title)}</div>${sigBadge(a)} ${riskBadge(a)}</div></div>
      <p>${esc(v.text)}</p>
      <div class="scores">
        <div>${ring(a.scoreShort, { size: 54 })}<span>Corto plazo<br>(días-semanas)</span></div>
        <div>${ring(a.scoreLong, { size: 54 })}<span>Largo plazo<br>(1 año o más)</span></div>
        <div><span class="risk-big" style="color:${a.risk === 'Alto' ? 'var(--red)' : a.risk === 'Medio' ? 'var(--gold)' : 'var(--green)'}">${a.risk.toUpperCase()}</span><span>Riesgo<br>(volatilidad)</span></div>
      </div>
      <div class="horizon"><span>¿Conviene a corto o largo plazo?</span><b>${esc(v.horizon)}</b></div>
    </section>
    ${deepCard(sym)}
    ${a.events.length ? `<section class="card"><h3>⚡ Eventos técnicos recientes</h3><div class="events">${a.events.map((e) => `<span class="ev ${e.type}">${esc(e.txt)}</span>`).join('')}</div></section>` : ''}
    ${mcHtml}
    <section class="card pc">
      <div class="pros"><h4>Lo bueno</h4><ul>${a.pros.map((x) => `<li>${esc(x)}</li>`).join('') || '<li>Nada destacable.</li>'}</ul></div>
      <div class="cons"><h4>Lo malo</h4><ul>${a.cons.map((x) => `<li>${esc(x)}</li>`).join('') || '<li>Nada destacable.</li>'}</ul></div>
    </section>
    ${an ? `<section class="card"><h3>🧑‍💼 Consenso de analistas</h3>
      <div class="abar"><i style="width:${(an.buy / an.total) * 100}%;background:var(--green)"></i><i style="width:${(an.hold / an.total) * 100}%;background:var(--gold)"></i><i style="width:${(an.sell / an.total) * 100}%;background:var(--red)"></i></div>
      <div class="alegend"><span class="up">Comprar ${an.buy}</span><span style="color:var(--gold)">Mantener ${an.hold}</span><span class="down">Vender ${an.sell}</span></div></section>` : ''}
    <section class="card">
      <h3>📐 Indicadores</h3>
      <div class="ind-grid">
        ${ind('RSI (14)', num(t.rsi, 0), t.rsi > 70 ? 'Sobrecompra' : t.rsi < 30 ? 'Sobreventa' : 'Zona neutral')}
        ${ind('MACD', isNum(t.macdHist) ? (t.macdHist >= 0 ? '<span class="up">Alcista</span>' : '<span class="down">Bajista</span>') : '—', isNum(t.macd) ? `Línea ${t.macd.toFixed(2)}` : '')}
        ${ind('Media 50 días', money(t.sma50, cur), isNum(t.sma50) ? (a.price > t.sma50 ? 'Precio por encima' : 'Precio por debajo') : '')}
        ${ind('Media 200 días', money(t.sma200, cur), isNum(t.sma200) ? (a.price > t.sma200 ? 'Precio por encima' : 'Precio por debajo') : '')}
        ${ind('Rend. 1 mes / 1 año', `${pctR(t.mom1m, 1)}`, `1 año: ${pctR(t.mom12m, 1)}`)}
        ${ind('Rango 52 semanas', `${money(t.low52, cur)}`, `a ${money(t.high52, cur)}`)}
        ${ind('Volatilidad anual', isNum(t.vol) ? (t.vol * 100).toFixed(0) + '%' : '—', `Caída máx. 1a: ${pctR(t.mdd, 0)}`)}
        ${ind('Beta', num(f.beta, 2), isNum(f.beta) ? (f.beta > 1.2 ? 'Más volátil que el mercado' : f.beta < 0.8 ? 'Más estable que el mercado' : 'Similar al mercado') : '')}
        ${ind('P/E', num(f.pe, 1), 'Precio / utilidades')}
        ${ind('Crec. ventas', num(f.revGrowth, 1, '%'), `Utilidades: ${num(f.epsGrowth, 1, '%')}`)}
        ${ind('Margen neto', num(f.netMargin, 1, '%'), `ROE: ${num(f.roe, 0, '%')}`)}
        ${ind('Deuda / capital', num(f.debtEq, 2), `Dividendo: ${num(f.divYield, 2, '%')}`)}
      </div>
    </section>
    <details class="card">
      <summary>🧮 Desglose del puntaje</summary>
      <h4 style="margin:0 0 8px;font-size:13px;color:var(--muted)">CORTO PLAZO · ${a.scoreShort}/100</h4>
      <div class="factors">${factorRows(a.factors.short)}</div>
      <h4 style="margin:14px 0 8px;font-size:13px;color:var(--muted)">LARGO PLAZO · ${a.scoreLong}/100</h4>
      <div class="factors">${factorRows(a.factors.long)}</div>
    </details>
    <section style="margin-top:12px">
      <div class="sec-title"><h3>📰 Noticias de ${esc(a.name)}</h3><span class="muted">tono: ${a.news.count ? (a.news.score > 0.1 ? '<span class="up">positivo</span>' : a.news.score < -0.1 ? '<span class="down">negativo</span>' : 'neutral') : '—'}</span></div>
      ${news.map(newsHtml).join('') || '<p class="hint">Sin noticias recientes.</p>'}
    </section>
    ${disclaimer()}`;
}

function closeDetail() {
  if (!state.detail) return;
  state.detail = null;
  destroyChart();
  $('#sheet').classList.remove('open');
  document.body.classList.remove('noscroll');
}

// ---------------------------------------------------------------------------
// Editor de alertas
// ---------------------------------------------------------------------------
let modalRaf = 0;
function openModal(html) {
  const m = $('#modal');
  m.innerHTML = `<div class="modal-card">${html}</div>`;
  cancelAnimationFrame(modalRaf);
  modalRaf = requestAnimationFrame(() => m.classList.add('open'));
}
function closeModal() {
  cancelAnimationFrame(modalRaf); // por si se cierra antes de terminar de abrir
  $('#modal').classList.remove('open');
}

function openAlertEditor(sym) {
  const a = state.analyses[sym];
  const q = state.quotes[sym];
  const price = q ? q.price : a && a.price;
  const cur = curOf(sym);
  const al = Alerts.get(sym);
  const qb = (side, arr) => arr.map((p) => `<button data-q="${side}" data-p="${p}">${p > 0 ? '+' : ''}${p}%</button>`).join('');
  openModal(`
    <div class="grab"></div>
    <h3>🔔 Alerta de precio · ${esc(sym)}</h3>
    <p class="muted" style="margin:6px 0 0">${esc(meta(sym).n)} · precio actual ${pxEl(sym, price)}</p>
    <label class="field"><span>🔻 Avísame si BAJA a (precio mínimo)</span>
      <input id="al-min" type="number" inputmode="decimal" step="0.01" min="0" placeholder="Ej. ${price ? (price * 0.95).toFixed(2) : ''}" value="${al && al.min != null ? al.min : ''}"></label>
    <div class="quick">${qb('min', [-2, -5, -10, -20])}</div>
    <div class="prob" id="prob-min"></div>
    <label class="field"><span>🔺 Avísame si SUBE a (precio máximo, opcional)</span>
      <input id="al-max" type="number" inputmode="decimal" step="0.01" min="0" placeholder="Ej. ${price ? (price * 1.1).toFixed(2) : ''}" value="${al && al.max != null ? al.max : ''}"></label>
    <div class="quick">${qb('max', [2, 5, 10, 20])}</div>
    <div class="prob" id="prob-max"></div>
    <div class="err-msg" id="al-err"></div>
    <div class="row-btns">
      ${al ? `<button class="btn danger" data-action="alert-delete" data-sym="${esc(sym)}">Eliminar</button>` : `<button class="btn ghost" data-action="close-modal">Cancelar</button>`}
      <button class="btn primary" data-action="alert-save" data-sym="${esc(sym)}">Guardar alerta</button>
    </div>
    ${notifPermission() !== 'granted' && notifSupported() ? `<div class="banner warn" style="margin-top:14px"><span>Activa las notificaciones para recibir el aviso aunque estés en otra app.</span><a href="#" data-action="enable-notif">Activar</a></div>` : ''}
    <p class="hint">La alerta se revisa con cada movimiento del precio en vivo y suena al instante (con vibración y notificación).</p>`);
  state.alertSym = sym;
  updateAlertProbs();
}

function updateAlertProbs() {
  const sym = state.alertSym;
  const a = state.analyses[sym];
  const mn = parseFloat($('#al-min') && $('#al-min').value);
  const mx = parseFloat($('#al-max') && $('#al-max').value);
  const pm = $('#prob-min');
  const px = $('#prob-max');
  if (!pm) return;
  pm.textContent = '';
  px.textContent = '';
  if (!a || a.error || !isNum(a.tech.vol)) return;
  const lv = [];
  if (isNum(mn) && mn > 0) lv.push(mn);
  if (isNum(mx) && mx > 0) lv.push(mx);
  if (!lv.length) return;
  const mc = simulate(a, 21, { levels: lv });
  let k = 0;
  if (isNum(mn) && mn > 0) pm.textContent = `🎲 ${pctR(mn / a.price - 1)} del precio actual · probabilidad de tocarlo en 1 mes: ${Math.round(mc.levelProb[k++] * 100)}%`;
  if (isNum(mx) && mx > 0) px.textContent = `🎲 ${pctR(mx / a.price - 1)} del precio actual · probabilidad de tocarlo en 1 mes: ${Math.round(mc.levelProb[k] * 100)}%`;
}

function saveAlert(sym) {
  const q = state.quotes[sym];
  const a = state.analyses[sym];
  const price = q ? q.price : a && a.price;
  const mn = parseFloat($('#al-min').value);
  const mx = parseFloat($('#al-max').value);
  const err = $('#al-err');
  const min = isNum(mn) && mn > 0 ? mn : null;
  const max = isNum(mx) && mx > 0 ? mx : null;
  if (min == null && max == null) { err.textContent = 'Escribe al menos un precio.'; return; }
  if (min != null && isNum(price) && min >= price) { err.textContent = 'El precio mínimo debe ser menor al precio actual.'; return; }
  if (max != null && isNum(price) && max <= price) { err.textContent = 'El precio máximo debe ser mayor al precio actual.'; return; }
  Alerts.set(sym, { min, max });
  if (!state.follow.includes(sym)) toggleFollow(sym, true);
  closeModal();
  applyAlertLines(sym);
  if (state.detail === sym) renderDetailBody();
  if (state.tab === 'siguiendo') renderView();
  toast({ title: '✅ Alerta guardada', body: `Te avisaremos cuando ${sym} ${min != null ? `baje a ${money(min, curOf(sym))}` : ''}${min != null && max != null ? ' o ' : ''}${max != null ? `suba a ${money(max, curOf(sym))}` : ''}.`, kind: 'info' });
  if (notifPermission() === 'default') requestNotifPermission().then(() => state.tab === 'siguiendo' && renderView());
}

// ---------------------------------------------------------------------------
// Seguimiento, búsqueda, ajustes
// ---------------------------------------------------------------------------
function toggleFollow(sym, force) {
  const on = force ?? !state.follow.includes(sym);
  state.follow = on ? [...new Set([sym, ...state.follow])] : state.follow.filter((s) => s !== sym);
  save('follow', state.follow);
  if (state.provider) state.provider.setSubscriptions(liveSymbols());
  $$(`#sheet [data-action="follow"]`).forEach((b) => {
    if (b.classList.contains('icon-btn')) b.classList.toggle('on', on);
    else b.textContent = on ? '★ Siguiendo' : '☆ Seguir';
  });
  if (on && state.analyses[sym] && !state.analyses[sym].error) {
    if (!state.newsSeen[sym]) {
      state.newsSeen[sym] = (state.companyNews[sym] || []).map(newsKey).slice(0, 100);
      save('newsSeen', state.newsSeen);
    }
    computeDeep(sym, { reason: 'manual', notifyChange: false });
  }
  if (state.detail === sym) renderDetailBody();
  if (state.tab === 'siguiendo') renderView();
}

let searchTimer = null;
function onSearch(q) {
  clearTimeout(searchTimer);
  const box = $('#search-res');
  if (!q.trim()) { box.innerHTML = ''; return; }
  searchTimer = setTimeout(async () => {
    box.innerHTML = '<span class="muted small">Buscando…</span>';
    let res = [];
    try { res = await state.provider.search(q); } catch (e) { box.innerHTML = `<span class="muted small">${esc(e.message)}</span>`; return; }
    box.innerHTML = res.map((r) => `<div class="sr"><div><b>${esc(r.symbol)}</b><small>${esc(r.description)}</small></div>
      ${state.follow.includes(r.symbol) ? '<span class="muted small">Siguiendo</span>' : `<button class="btn sm primary" data-action="add-follow" data-sym="${esc(r.symbol)}" data-name="${esc(r.description)}">＋ Seguir</button>`}</div>`).join('') || '<span class="muted small">Sin resultados.</span>';
  }, 350);
}

async function addFollow(sym, name) {
  if (!allCompanies().some((c) => c.s === sym)) {
    state.custom.push({ s: sym, n: name || sym, sec: 'custom' });
    save('custom', state.custom);
  }
  toggleFollow(sym, true);
  renderView();
  await analyzeOne(sym, state.provider, state.token);
  renderView();
}

async function saveKeys() {
  const fk = $('#fhKey').value.trim();
  const tk = $('#tdKey').value.trim();
  const out = $('#key-test');
  if (!fk) { out.innerHTML = '<span class="down">Necesitas al menos la clave de Finnhub para datos reales.</span>'; return; }
  out.textContent = 'Probando conexión…';
  const test = new LiveProvider({ finnhubKey: fk, tdKey: tk });
  const msgs = [];
  try {
    const q = await test.getQuote('AAPL');
    msgs.push(q ? `<span class="up">✓ Finnhub conectado (AAPL ${money(q.price)})</span>` : '<span class="down">✗ Finnhub no devolvió datos</span>');
  } catch (e) { msgs.push(`<span class="down">✗ Finnhub: ${esc(e.message)}</span>`); out.innerHTML = msgs.join('<br>'); return; }
  if (tk) {
    try {
      const h = await test.getHistory('AAPL');
      msgs.push(h ? `<span class="up">✓ Twelve Data conectado (${h.length} días de historial)</span>` : '<span class="down">✗ Twelve Data sin datos</span>');
    } catch (e) { msgs.push(`<span class="down">✗ Twelve Data: ${esc(e.message)}</span>`); }
  } else msgs.push('<span style="color:var(--gold)">• Sin clave de Twelve Data: no habrá gráficas ni análisis técnico.</span>');
  out.innerHTML = msgs.join('<br>');
  state.settings = { ...state.settings, finnhubKey: fk, tdKey: tk, mode: 'live' };
  save('settings', state.settings);
  initProvider();
  runScan({ manual: true });
}

function setMode(mode) {
  if (mode === 'live' && !state.settings.finnhubKey) {
    const out = $('#key-test');
    if (out) out.innerHTML = '<span style="color:var(--gold)">Pega tu clave de Finnhub y toca “Guardar y conectar”.</span>';
    $('#fhKey') && $('#fhKey').focus();
    return;
  }
  state.settings.mode = mode;
  save('settings', state.settings);
  initProvider();
  renderView();
  runScan();
}

async function setWatchMode(on) {
  if (on) {
    try {
      state.wakeLock = await navigator.wakeLock.request('screen');
      state.watchMode = true;
      toast({ title: '🛡️ Modo vigilancia activo', body: 'La pantalla se mantendrá encendida para recibir alertas al instante.', kind: 'info' });
    } catch {
      state.watchMode = false;
      toast({ title: 'No disponible', body: 'Tu navegador no permitió mantener la pantalla encendida.', kind: 'info' });
    }
  } else {
    state.watchMode = false;
    try { if (state.wakeLock) await state.wakeLock.release(); } catch { /* nada */ }
    state.wakeLock = null;
  }
  if (state.tab === 'siguiendo') renderView();
}

let scanInterval = null;
function scheduleScans() {
  clearInterval(scanInterval);
  scanInterval = setInterval(() => runScan(), Math.max(5, +state.settings.scanEvery || 15) * 60e3);
}

// Respaldo: si el WebSocket no está conectado, refrescamos por REST las
// cotizaciones de las empresas seguidas para que las alertas sigan funcionando.
setInterval(async () => {
  if (!state.provider || state.provider.mode !== 'live' || state.conn === 'live') return;
  for (const sym of state.follow.slice(0, 15)) {
    try {
      const q = await state.provider.getQuote(sym);
      if (!q) continue;
      const prev = state.quotes[sym];
      state.quotes[sym] = { ...(prev || {}), ...q, price: prev ? prev.price : q.price };
      onTick(sym, q.price);
    } catch { /* límite alcanzado: siguiente ciclo */ }
  }
}, 90e3);

// ---------------------------------------------------------------------------
// Notificaciones dentro de la app
// ---------------------------------------------------------------------------
function toast({ title, body, kind = 'info', sym = null }) {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = `<div><b>${esc(title)}</b><p>${esc(body)}</p></div>`;
  el.addEventListener('click', () => {
    if (sym) goDetail(sym);
    el.remove();
  });
  $('#toasts').prepend(el);
  const ms = kind.startsWith('alert') ? 9000 : 5000;
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }, ms);
}
window.addEventListener('pulso:notify', (e) => {
  toast(e.detail);
  renderChrome();
  if (state.tab === 'siguiendo') scheduleRender();
  if ($('#panel').classList.contains('open')) openPanel();
});

function openPanel() {
  const list = getHistory();
  $('#panel').innerHTML = `<div class="panel-card">
    <div class="panel-head"><h3>🔔 Notificaciones</h3><div style="display:flex;gap:6px">
      <button class="btn sm" data-action="clear-notifs">Borrar</button><button class="btn sm" data-action="close-panel">Cerrar</button></div></div>
    ${list.map((n) => `<div class="nt ${n.read ? '' : 'unread'}" data-open="${esc(n.sym || '')}">
      <div><b>${esc(n.title)}</b><p>${esc(n.body)}</p><small>${ago(n.t)}</small></div></div>`).join('') || '<div class="empty">Sin notificaciones todavía.</div>'}
  </div>`;
  $('#panel').classList.add('open');
  markAllRead();
  renderChrome();
}

// ---------------------------------------------------------------------------
// Bienvenida
// ---------------------------------------------------------------------------
function showOnboarding() {
  openModal(`<div class="onb">
    <div class="grab"></div>
    <div class="eyebrow">Bienvenido a</div>
    <h2>PULSO · tu radar del mercado 📡</h2>
    <ul>
      <li>Analiza ${allCompanies().length} empresas globales (Apple, NVIDIA, Coca-Cola, Samsung…) con técnico, fundamentales, analistas y noticias.</li>
      <li>Simula <b>1,000 escenarios</b> de precio por empresa a 1 mes y otros 1,000 a 1 año.</li>
      <li>Te dice con honestidad si el modelo la ve bien o mal, y si conviene a <b>corto</b> o <b>largo plazo</b>.</li>
      <li>Te avisa al instante cuando una acción toca tu precio objetivo.</li>
    </ul>
    <div class="disclaimer-box">⚠️ Pulso es una herramienta educativa de análisis algorítmico, no un asesor financiero certificado. Ningún modelo predice el mercado con certeza: úsalo como apoyo, investiga por tu cuenta y nunca inviertas dinero que no puedas permitirte perder.</div>
    <p class="hint">Empiezas en <b>modo demo</b> (datos simulados). En Ajustes puedes conectar datos reales gratis.</p>
    <div class="row-btns" style="flex-direction:column">
      <button class="btn primary block" data-action="onb-accept" data-notif="1">Activar notificaciones y empezar</button>
      <button class="btn ghost block" data-action="onb-accept">Empezar sin notificaciones</button>
    </div></div>`);
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------
async function handleAction(action, el) {
  const sym = el.dataset.sym;
  switch (action) {
    case 'scan': runScan({ manual: true }); break;
    case 'close-scanfx': closeScanFx(); break;
    case 'close-detail':
      if (state.detailPushed) history.back();
      else location.hash = '#/' + state.tab;
      break;
    case 'follow': toggleFollow(sym); break;
    case 'unfollow': toggleFollow(sym, false); break;
    case 'add-follow': addFollow(sym, el.dataset.name); break;
    case 'bt-run': runUserBacktest(); break;
    case 'bt-stop': state.bt.stop = true; break;
    case 'paper-open': openTradeModal(sym); break;
    case 'paper-buy': {
      const amt = parseFloat($('#paper-amt') && $('#paper-amt').value);
      const tr = state.paper.buy('manual', sym, amt, pxOf(sym), 'Decisión propia');
      closeModal();
      if (tr) {
        state.paper.snapshot(pxOf, true);
        toast({ title: `💼 Compraste ${sym} (simulado)`, body: `${tr.qty.toFixed(3)} acciones a ${money(tr.price)}`, kind: 'info' });
      } else toast({ title: 'No se pudo comprar', body: 'Revisa el monto, el efectivo disponible o que haya precio.', kind: 'info' });
      if (state.tab === 'cuenta') renderView();
      break;
    }
    case 'paper-sell': {
      const tr = state.paper.sell('manual', sym, null, pxOf(sym), 'Decisión propia');
      closeModal();
      if (tr) {
        state.paper.snapshot(pxOf, true);
        toast({ title: `💼 Vendiste ${sym} (simulado)`, body: `Resultado de la operación: ${pctS(tr.ret)}`, kind: 'info' });
      }
      if (state.tab === 'cuenta') renderView();
      break;
    }
    case 'paper-reset': {
      const v = parseFloat($('#paper-start') && $('#paper-start').value) || 10000;
      if (confirm('¿Reiniciar las 4 cuentas virtuales? Se borran posiciones e historial simulado.')) {
        state.paper.reset(Math.max(100, v));
        afterScanPhase1();
        renderView();
      }
      break;
    }
    case 'deep-recalc': {
      const d = computeDeep(sym, { reason: 'manual', notifyChange: false });
      renderDetailBody();
      if (d) toast({ title: `🎯 ${sym} recalculado`, body: `${d.N.toLocaleString('en-US')} escenarios · ${d.rec.label}`, kind: 'info' });
      break;
    }
    case 'alert': openAlertEditor(sym); break;
    case 'alert-save': saveAlert(sym); break;
    case 'alert-delete':
      Alerts.remove(sym);
      closeModal();
      applyAlertLines(sym);
      if (state.detail === sym) renderDetailBody();
      if (state.tab === 'siguiendo') renderView();
      break;
    case 'rearm':
      Alerts.rearm(sym);
      renderView();
      break;
    case 'close-modal': closeModal(); break;
    case 'open-notifs': openPanel(); break;
    case 'close-panel': $('#panel').classList.remove('open'); break;
    case 'clear-notifs': clearHistory(); openPanel(); break;
    case 'enable-notif': {
      const r = await requestNotifPermission();
      if (r === 'granted') notify({ title: '🔔 Notificaciones activadas', body: 'Te avisaremos de señales y alertas de precio.', kind: 'info' });
      else if (r === 'denied') toast({ title: 'Notificaciones bloqueadas', body: 'Actívalas desde la configuración del navegador para este sitio.', kind: 'info' });
      if ($('#modal').classList.contains('open') && state.alertSym) openAlertEditor(state.alertSym);
      renderView();
      break;
    }
    case 'test-notif':
      notify({ title: '🔻 Prueba: AAPL llegó a tu precio mínimo', body: 'Así se verá una alerta de precio. ¡Funciona!', kind: 'alert-down', sym: 'AAPL' });
      break;
    case 'save-keys': saveKeys(); break;
    case 'clear-cache':
      clearCache();
      toast({ title: 'Caché borrada', body: 'El próximo análisis descargará datos frescos.', kind: 'info' });
      break;
    case 'reset':
      if (confirm('¿Borrar claves, alertas, empresas seguidas y notificaciones de este dispositivo?')) {
        clearAll();
        location.hash = '';
        location.reload();
      }
      break;
    case 'onb-accept':
      save('accepted', Date.now());
      closeModal();
      if (el.dataset.notif) {
        const r = await requestNotifPermission();
        if (r === 'granted') notify({ title: '🔔 ¡Listo!', body: 'Recibirás señales del modelo y alertas de precio.', kind: 'info' });
      }
      break;
    default: break;
  }
}

function bindEvents() {
  document.addEventListener('click', (e) => {
    unlockAudio();
    const act = e.target.closest('[data-action]');
    if (act) {
      if (act.tagName === 'A') e.preventDefault();
      handleAction(act.dataset.action, act);
      return;
    }
    const tf = e.target.closest('[data-tf]');
    if (tf) {
      state.chartTf = +tf.dataset.tf;
      $$('[data-tf]').forEach((b) => b.classList.toggle('active', b === tf));
      if (state.chart) state.chart.setRange(state.chartTf);
      return;
    }
    const mc = e.target.closest('[data-mc]');
    if (mc) { state.mcTab = mc.dataset.mc; renderDetailBody(); return; }
    const hz = e.target.closest('[data-horizon]');
    if (hz) { state.rankHorizon = hz.dataset.horizon; save('rankHorizon', state.rankHorizon); renderView(); return; }
    const fl = e.target.closest('[data-filter]');
    if (fl) {
      state.rankFilter = fl.dataset.filter;
      if (state.tab !== 'ranking') location.hash = '#/ranking';
      else renderView();
      return;
    }
    const fe = e.target.closest('[data-fentry]');
    if (fe) {
      state.factorEntry = fe.dataset.fentry;
      save('factorEntry', state.factorEntry);
      computeFactorRanking();
      renderView();
      return;
    }
    const pa = e.target.closest('[data-pamt]');
    if (pa) {
      const inp = $('#paper-amt');
      if (inp) inp.value = pa.dataset.pamt;
      return;
    }
    const bts = e.target.closest('[data-bt]');
    if (bts) { state.bt.show = bts.dataset.bt; renderView(); return; }
    const nf = e.target.closest('[data-news]');
    if (nf) { state.newsFilter = nf.dataset.news; renderView(); return; }
    const md = e.target.closest('[data-mode]');
    if (md) { setMode(md.dataset.mode); return; }
    const q = e.target.closest('[data-q]');
    if (q) {
      const s = state.alertSym;
      const qq = state.quotes[s];
      const price = qq ? qq.price : state.analyses[s] && state.analyses[s].price;
      if (isNum(price)) {
        $(q.dataset.q === 'min' ? '#al-min' : '#al-max').value = (price * (1 + +q.dataset.p / 100)).toFixed(2);
        updateAlertProbs();
      }
      return;
    }
    const open = e.target.closest('[data-open]');
    if (open && open.dataset.open) {
      if ($('#panel').classList.contains('open')) $('#panel').classList.remove('open');
      goDetail(open.dataset.open);
      return;
    }
    if (e.target.id === 'modal') closeModal();
    if (e.target.id === 'panel') $('#panel').classList.remove('open');
  });

  document.addEventListener('input', (e) => {
    if (e.target.id === 'search') onSearch(e.target.value);
    if (e.target.id === 'al-min' || e.target.id === 'al-max') updateAlertProbs();
  });

  document.addEventListener('change', (e) => {
    const k = e.target.dataset.setting;
    if (!k) return;
    if (k === 'watchMode') { setWatchMode(e.target.checked); return; }
    state.settings[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    save('settings', state.settings);
    if (k === 'sound') configureNotify({ sound: state.settings.sound });
    if (k === 'scanEvery') scheduleScans();
  });

  window.addEventListener('hashchange', onRoute);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if ($('#modal').classList.contains('open')) closeModal();
    else if ($('#panel').classList.contains('open')) $('#panel').classList.remove('open');
    else if (state.detail) handleAction('close-detail', document.body);
  });
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && state.watchMode && (!state.wakeLock || state.wakeLock.released)) {
      try { state.wakeLock = await navigator.wakeLock.request('screen'); } catch { /* nada */ }
    }
  });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'open') {
        const h = new URL(e.data.url, location.href).hash;
        if (h) location.hash = h;
      }
    });
  }
}

function onRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  const [page, arg] = h.split('/');
  if (page === 'empresa' && arg) {
    if (!$('#view').innerHTML) renderView();
    openDetail(decodeURIComponent(arg));
    return;
  }
  if (state.detail) closeDetail();
  state.detailPushed = false;
  const next = TABS.includes(page) ? page : 'mercado';
  const changed = next !== state.tab;
  state.tab = next;
  renderView(changed);
}

// ---------------------------------------------------------------------------
// Inicio
// ---------------------------------------------------------------------------
function boot() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  bindEvents();
  initProvider();
  onRoute();
  if (!load('accepted', null)) showOnboarding();
  runScan();
  scheduleScans();
  loadBtRef();
  setInterval(() => {
    // refresca los "hace X min" sin molestar
    if (state.tab === 'mercado' && !state.scanning) scheduleRender();
  }, 60e3);
}

boot();
