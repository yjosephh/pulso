// Persistencia local segura (el navegador puede bloquear localStorage).
const PREFIX = 'pulso:';

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* almacenamiento lleno o bloqueado: seguimos en memoria */
  }
}

export function remove(key) {
  try { localStorage.removeItem(PREFIX + key); } catch { /* nada */ }
}

// Caché con caducidad (para no gastar el límite gratuito de las APIs).
export function cacheGet(key, maxAgeMs) {
  const hit = load('c:' + key, null);
  if (!hit) return null;
  if (Date.now() - hit.t > maxAgeMs) return null;
  return hit.v;
}

export function cacheSet(key, value) {
  save('c:' + key, { t: Date.now(), v: value });
}

export function clearCache() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX + 'c:'))
      .forEach((k) => localStorage.removeItem(k));
  } catch { /* nada */ }
}

export function clearAll() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .forEach((k) => localStorage.removeItem(k));
  } catch { /* nada */ }
}
