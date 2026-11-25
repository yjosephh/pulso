// Notificaciones (sistema + dentro de la app), sonido, vibración y alertas de precio.
import { load, save } from './store.js';

const opts = { sound: true };
export function configureNotify(o) {
  Object.assign(opts, o);
}

// ---------------- Sonido ----------------
let audioCtx = null;
export function unlockAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { /* sin audio */ }
}

function beep(kind) {
  if (!audioCtx || !opts.sound) return;
  const notes = kind === 'down' ? [880, 660, 440] : kind === 'up' ? [440, 660, 880] : [660, 990];
  notes.forEach((f, i) => {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    o.connect(g);
    g.connect(audioCtx.destination);
    const t = audioCtx.currentTime + i * 0.13;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.start(t);
    o.stop(t + 0.14);
  });
}

// ---------------- Permisos ----------------
export const notifSupported = () => 'Notification' in window;
export const notifPermission = () => (notifSupported() ? Notification.permission : 'unsupported');

export async function requestNotifPermission() {
  if (!notifSupported()) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

// ---------------- Historial ----------------
let history = load('notifs', []);
export const getHistory = () => history;
export const unreadCount = () => history.filter((n) => !n.read).length;
export function markAllRead() {
  history.forEach((n) => (n.read = true));
  save('notifs', history);
}
export function clearHistory() {
  history = [];
  save('notifs', history);
}

// ---------------- Enviar notificación ----------------
export async function notify({ title, body, kind = 'info', sym = null, system = true }) {
  const item = { id: Date.now() + Math.random(), title, body, kind, sym, t: Date.now(), read: false };
  history.unshift(item);
  history = history.slice(0, 80);
  save('notifs', history);
  window.dispatchEvent(new CustomEvent('pulso:notify', { detail: item }));

  const down = kind === 'alert-down' || kind === 'sell';
  const up = kind === 'alert-up' || kind === 'buy';
  beep(down ? 'down' : up ? 'up' : 'info');
  try {
    const active = !navigator.userActivation || navigator.userActivation.hasBeenActive;
    if (navigator.vibrate && active) navigator.vibrate(kind.startsWith('alert') ? [250, 100, 250, 100, 500] : [120, 60, 120]);
  } catch { /* sin vibración */ }

  if (system && notifPermission() === 'granted') {
    const o = {
      body,
      icon: 'icons/icon-192.png',
      badge: 'icons/badge-96.png',
      vibrate: [200, 100, 200],
      data: { url: sym ? `./index.html#/empresa/${encodeURIComponent(sym)}` : './index.html' },
    };
    if (sym) {
      o.tag = `${kind}-${sym}`;
      o.renotify = true;
    }
    try {
      const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
      if (reg) await reg.showNotification(title, o);
      else new Notification(title, o);
    } catch {
      try { new Notification(title, o); } catch { /* el navegador no lo permite */ }
    }
  }
  return item;
}

// ---------------- Alertas de precio ----------------
let alerts = load('alerts', {});
const persist = () => save('alerts', alerts);

const money = (v, cur) => cur + (v >= 10000 ? Math.round(v).toLocaleString('en-US') : v.toFixed(2));

export const Alerts = {
  all: () => alerts,
  get: (sym) => alerts[sym] || null,
  set(sym, { min, max }) {
    alerts[sym] = { min: min ?? null, max: max ?? null, minFired: false, maxFired: false, created: Date.now() };
    persist();
  },
  remove(sym) {
    delete alerts[sym];
    persist();
  },
  rearm(sym) {
    const a = alerts[sym];
    if (!a) return;
    a.minFired = false;
    a.maxFired = false;
    persist();
  },
  // Se llama en cada tick de precio: el aviso es inmediato.
  check(sym, price, name, cur = '$') {
    const a = alerts[sym];
    if (!a || !isFinite(price)) return;
    if (a.min != null && !a.minFired && price <= a.min) {
      a.minFired = true;
      a.firedAt = Date.now();
      persist();
      notify({
        title: `🔻 ${sym} llegó a tu precio mínimo`,
        body: `${name} cotiza en ${money(price, cur)} (tu alerta: ${money(a.min, cur)}). Revisa el análisis antes de decidir.`,
        kind: 'alert-down',
        sym,
      });
    }
    if (a.max != null && !a.maxFired && price >= a.max) {
      a.maxFired = true;
      a.firedAt = Date.now();
      persist();
      notify({
        title: `🔺 ${sym} llegó a tu precio máximo`,
        body: `${name} cotiza en ${money(price, cur)} (tu alerta: ${money(a.max, cur)}).`,
        kind: 'alert-up',
        sym,
      });
    }
  },
};
