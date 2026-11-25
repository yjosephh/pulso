// Universo de empresas que la app vigila y analiza.
// base/vol/drift solo se usan en MODO DEMO para simular precios.

export const SECTORS = [
  { id: 'tech', name: 'Tecnología', icon: '💻' },
  { id: 'ai', name: 'IA y Chips', icon: '🤖' },
  { id: 'consumer', name: 'Consumo global', icon: '🛒' },
  { id: 'finance', name: 'Finanzas', icon: '🏦' },
  { id: 'health', name: 'Salud', icon: '🧬' },
  { id: 'energy', name: 'Autos y Energía', icon: '⚡' },
];

export const UNIVERSE = [
  { s: 'AAPL', n: 'Apple', sec: 'tech', base: 232, vol: 0.26, drift: 0.12 },
  { s: 'MSFT', n: 'Microsoft', sec: 'tech', base: 455, vol: 0.24, drift: 0.14 },
  { s: 'GOOGL', n: 'Alphabet (Google)', sec: 'tech', base: 182, vol: 0.30, drift: 0.13 },
  { s: 'AMZN', n: 'Amazon', sec: 'tech', base: 205, vol: 0.32, drift: 0.15 },
  { s: 'META', n: 'Meta Platforms', sec: 'tech', base: 590, vol: 0.38, drift: 0.18 },
  { s: 'ORCL', n: 'Oracle', sec: 'tech', base: 175, vol: 0.34, drift: 0.12 },
  { s: 'CRM', n: 'Salesforce', sec: 'tech', base: 300, vol: 0.33, drift: 0.07 },
  { s: '005930.KS', n: 'Samsung Electronics', sec: 'tech', base: 58000, vol: 0.30, drift: 0.04, intl: true, cur: '₩' },

  { s: 'NVDA', n: 'NVIDIA', sec: 'ai', base: 140, vol: 0.52, drift: 0.30 },
  { s: 'AMD', n: 'AMD', sec: 'ai', base: 150, vol: 0.50, drift: 0.10 },
  { s: 'AVGO', n: 'Broadcom', sec: 'ai', base: 175, vol: 0.45, drift: 0.22 },
  { s: 'TSM', n: 'TSMC', sec: 'ai', base: 190, vol: 0.40, drift: 0.20 },
  { s: 'ASML', n: 'ASML', sec: 'ai', base: 700, vol: 0.40, drift: 0.05 },
  { s: 'PLTR', n: 'Palantir', sec: 'ai', base: 60, vol: 0.65, drift: 0.35 },

  { s: 'KO', n: 'Coca-Cola', sec: 'consumer', base: 64, vol: 0.15, drift: 0.06 },
  { s: 'PEP', n: 'PepsiCo', sec: 'consumer', base: 158, vol: 0.17, drift: 0.01 },
  { s: 'MCD', n: "McDonald's", sec: 'consumer', base: 295, vol: 0.18, drift: 0.07 },
  { s: 'PG', n: 'Procter & Gamble', sec: 'consumer', base: 168, vol: 0.16, drift: 0.07 },
  { s: 'NKE', n: 'Nike', sec: 'consumer', base: 76, vol: 0.34, drift: -0.12 },
  { s: 'WMT', n: 'Walmart', sec: 'consumer', base: 88, vol: 0.20, drift: 0.22 },
  { s: 'COST', n: 'Costco', sec: 'consumer', base: 920, vol: 0.21, drift: 0.18 },

  { s: 'V', n: 'Visa', sec: 'finance', base: 310, vol: 0.20, drift: 0.12 },
  { s: 'MA', n: 'Mastercard', sec: 'finance', base: 520, vol: 0.21, drift: 0.13 },
  { s: 'JPM', n: 'JPMorgan Chase', sec: 'finance', base: 240, vol: 0.24, drift: 0.16 },
  { s: 'BRK.B', n: 'Berkshire Hathaway', sec: 'finance', base: 470, vol: 0.17, drift: 0.12 },

  { s: 'JNJ', n: 'Johnson & Johnson', sec: 'health', base: 155, vol: 0.17, drift: 0.01 },
  { s: 'LLY', n: 'Eli Lilly', sec: 'health', base: 800, vol: 0.35, drift: 0.20 },

  { s: 'TSLA', n: 'Tesla', sec: 'energy', base: 330, vol: 0.62, drift: 0.10 },
  { s: 'XOM', n: 'ExxonMobil', sec: 'energy', base: 118, vol: 0.24, drift: 0.02 },
];

// ETFs que funcionan como "termómetro" de los índices principales.
export const INDICES = [
  { s: 'SPY', n: 'S&P 500', base: 590, vol: 0.16, drift: 0.10 },
  { s: 'QQQ', n: 'Nasdaq 100', base: 510, vol: 0.21, drift: 0.13 },
  { s: 'DIA', n: 'Dow Jones', base: 440, vol: 0.15, drift: 0.08 },
];

export function sectorName(id) {
  return (SECTORS.find((x) => x.id === id) || { name: 'Otras' }).name;
}
