// PULSO · aplicación principal
import { UNIVERSE, INDICES, SECTORS, sectorName } from './universe.js';
import { createProvider, LiveProvider, isoDate, hashStr } from './data.js';
import { analyze, marketPulse, simulate, sma, sentiment } from './analysis.js';
import { sparkline, gauge, ring, fanChart, priceChart } from './charts.js';
import {
  notify, Alerts, configureNotify, unlockAudio, notifPermission, notifSupported,
  requestNotifPermission, getHistory, unreadCount, markAllRead, clearHistory,
} from './notify.js';
import { load, save, clearCache, clearAll } from './store.js';

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
const TABS = ['mercado', 'ranking', 'siguiendo', 'noticias', 'ajustes'];

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
  let list = analysesList();
  if (state.rankFilter !== 'all') list = list.filter((a) => a.sec === state.rankFilter);
  list.sort((a, b) => (h === 'short' ? b.scoreShort - a.scoreShort : b.scoreLong - a.scoreLong));
  const errors = Object.values(state.analyses).filter((a) => a && a.error && (state.rankFilter === 'all' || a.sec === state.rankFilter));
  const n = allCompanies().length;
  return `
    <div class="page-head"><h2>Ranking de oportunidades</h2>
      <p>${n} empresas · ${(n * 2000).toLocaleString('en-US')} escenarios simulados por análisis</p></div>
    <div class="seg">
      <button class="${h === 'long' ? 'active' : ''}" data-horizon="long">🌱 Largo plazo</button>
      <button class="${h === 'short' ? 'active' : ''}" data-horizon="short">⚡ Corto plazo</button>
    </div>
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
      ${a && !a.error ? `<div class="w-verdict tone-${a.verdict.tone}">${a.verdict.emoji} <b>${esc(a.verdict.title)}</b> · Horizonte: ${esc(a.verdict.horizon)} · ${sigBadge(a)}</div>` : ''}
      ${prob}
    </article>`;
  }).join('');

  const wl = 'wakeLock' in navigator;
  return `
    <div class="page-head"><h2>En seguimiento</h2><p>Precios en vivo y alertas instantáneas de precio</p></div>
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
    <details class="card">
      <summary>🧠 ¿Cómo analiza Pulso?</summary>
      <div class="hint" style="margin:0">
        <p><b>1. Técnico:</b> medias móviles de 20, 50 y 200 días, cruce dorado/muerte, MACD, RSI, Bandas de Bollinger, volatilidad y caída máxima.</p>
        <p><b>2. Fundamental:</b> P/E vs crecimiento, márgenes, ROE, crecimiento de ventas/utilidades, deuda y dividendo.</p>
        <p><b>3. Analistas:</b> consenso de recomendaciones de Wall Street.</p>
        <p><b>4. Noticias:</b> sentimiento automático de titulares recientes (positivo/negativo).</p>
        <p><b>5. Monte Carlo:</b> 1,000 escenarios de precio a 1 mes y 1,000 a 1 año por empresa, usando su volatilidad histórica y un rendimiento esperado conservador (encogido hacia ~8% anual para no extrapolar rachas).</p>
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

const VIEWS = { mercado: viewMercado, ranking: viewRanking, siguiendo: viewSiguiendo, noticias: viewNoticias, ajustes: viewAjustes };

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
  }
  pending.clear();
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
  Object.assign(state, { analyses: {}, quotes: {}, hist: {}, profiles: {}, pulse: null, news: [], companyNews: {}, scanning: false, conn: 'off' });
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
    state.analyses[sym] = analyze({ meta: m, history: hist, quote: state.quotes[sym] || null, fund, rec, news });
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
function openModal(html) {
  const m = $('#modal');
  m.innerHTML = `<div class="modal-card">${html}</div>`;
  requestAnimationFrame(() => m.classList.add('open'));
}
function closeModal() {
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
  setInterval(() => {
    // refresca los "hace X min" sin molestar
    if (state.tab === 'mercado' && !state.scanning) scheduleRender();
  }, 60e3);
}

boot();
