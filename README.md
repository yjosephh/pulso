# 📡 Pulso · Análisis de Mercados

App para el celular (PWA instalable) que analiza el mercado de valores, te da señales de compra/venta
según un modelo algorítmico, simula 1,000 escenarios de precio por empresa y te avisa al instante
cuando una acción llega al precio que tú marques.

> ⚠️ **Aviso:** Pulso es una herramienta educativa de análisis algorítmico. **No es asesoría financiera.**
> Ningún modelo predice el mercado con certeza. Investiga por tu cuenta y nunca inviertas dinero que no
> puedas permitirte perder.

---

## ✨ Qué hace

| Pantalla | Función |
|---|---|
| **Mercado** | "Pulso del mercado" (índice 0-100 de miedo/codicia), resumen en texto de cómo está el mercado hoy, índices (S&P 500, Nasdaq, Dow), mejores oportunidades, señales de riesgo, mapa de sectores y noticias de último momento. |
| **Ranking** | 29 empresas globales (Apple, Microsoft, NVIDIA, Samsung, Coca-Cola, Visa, Tesla…) ordenadas por puntaje de **largo** o **corto plazo**, con filtro por sector. |
| **🔍 Botón central** | Ejecuta el análisis completo del mercado (técnico + fundamentales + analistas + noticias + 58,000 simulaciones). |
| **Detalle de empresa** | Gráfica de velas con medias de 50 y 200 días, veredicto honesto ("Pinta bien", "Mala idea por ahora"…), si conviene a corto o largo plazo, abanico de 1,000 escenarios, lo bueno y lo malo, indicadores, consenso de analistas y noticias. |
| **Siguiendo** | Tus empresas con precio en vivo, alertas de precio mínimo/máximo, probabilidad de que toquen tu precio, y "Modo vigilancia" (mantiene la pantalla encendida). |
| **Noticias** | Noticias del mercado y de tus empresas con sentimiento automático (positiva/negativa/neutral). |
| **🔔 Notificaciones** | Señales nuevas de COMPRA/VENTA, eventos técnicos (cruce dorado, MACD, RSI) y alertas de precio, con sonido y vibración. |

### 🧠 Cómo analiza

1. **Técnico:** medias móviles 20/50/200, cruce dorado / de la muerte, MACD, RSI, Bollinger, volatilidad, caída máxima.
2. **Fundamental:** P/E vs crecimiento, márgenes, ROE, crecimiento de ventas/utilidades, deuda, dividendo.
3. **Analistas:** consenso de recomendaciones de Wall Street.
4. **Noticias:** sentimiento de titulares recientes.
5. **Monte Carlo:** 1,000 escenarios a 1 mes y 1,000 a 1 año por empresa (volatilidad histórica + rendimiento esperado moderado).

Todo se combina en un **puntaje de corto plazo** (señal COMPRA FUERTE / COMPRA / MANTENER / VENTA / VENTA FUERTE)
y un **puntaje de largo plazo**, más un nivel de riesgo. En el detalle puedes abrir el "Desglose del puntaje"
para ver exactamente qué factores suman y cuáles restan.

---

## 🚀 Probarla en la computadora

Necesitas Python (ya lo tienes). Desde la carpeta `pulso`:

```bash
python -m http.server 8765
```

Abre <http://localhost:8765>. Empieza en **modo demo** con datos simulados (funciona sin claves).

---

## 📱 Instalarla en el celular

Las notificaciones y la instalación requieren **HTTPS**, así que hay que publicar la carpeta `pulso` en un
hosting gratuito. Opciones fáciles:

- **Netlify Drop:** entra a <https://app.netlify.com/drop> y arrastra la carpeta `pulso`. Te da una URL `https://…netlify.app`.
- **GitHub Pages:** sube la carpeta a un repositorio propio y activa *Settings → Pages*.

Luego, en el celular abre esa URL y:

- **Android (Chrome):** menú ⋮ → **Instalar app** / *Agregar a pantalla principal*.
- **iPhone (Safari, iOS 16.4+):** botón Compartir → **Agregar a inicio**. Abre Pulso desde el ícono para poder activar notificaciones.

Después abre la app → toca **Activar notificaciones**.

---

## 🟢 Conectar datos reales (gratis)

1. Crea una cuenta gratis en **Finnhub** (<https://finnhub.io/register>) y copia tu API key.
   → precios en tiempo real, noticias, fundamentales y analistas (60 consultas/min).
2. Crea una cuenta gratis en **Twelve Data** (<https://twelvedata.com/register>) y copia tu API key.
   → historial diario para las gráficas y el análisis técnico (800 consultas/día).
3. En la app: **⚙️ Ajustes → pega las dos claves → Guardar y conectar datos reales**.

Las claves se guardan solo en tu teléfono. El primer análisis en vivo tarda unos 3-4 minutos por los
límites gratuitos; después usa caché y es rápido.

---

## ⚠️ Limitaciones (siendo sinceros)

- **Alertas con la app cerrada:** las alertas son instantáneas mientras Pulso está abierta o en segundo plano
  reciente (por eso existe el *Modo vigilancia*). Si cierras la app por completo, el teléfono la congela y no
  puede vigilar precios. Para alertas 24/7 con la app cerrada hace falta un pequeño servidor que vigile los
  precios y mande notificaciones push (siguiente fase).
- **Samsung** cotiza en la bolsa de Corea; los planes gratuitos normalmente no incluyen esos datos.
- **Modo demo** usa precios y noticias simulados (marcados como DEMO). No los uses para decidir.
- **El modelo puede equivocarse**, sobre todo ante noticias inesperadas. Las simulaciones muestran escenarios
  posibles según la volatilidad pasada, no el futuro.

---

## 🗂️ Estructura

```
pulso/
├── index.html            # Estructura y menú
├── manifest.webmanifest  # Instalación como app
├── sw.js                 # Service worker (offline + notificaciones)
├── css/styles.css        # Tema "trading neón"
├── icons/                # Íconos de la app
└── js/
    ├── app.js            # Pantallas, navegación, escaneo, alertas
    ├── analysis.js       # Indicadores, puntajes, veredicto, Monte Carlo
    ├── data.js           # Proveedores: Demo, Finnhub, Twelve Data
    ├── charts.js         # Velas, medidor, anillos, abanico
    ├── notify.js         # Notificaciones, sonido y alertas de precio
    ├── store.js          # Guardado local y caché
    └── universe.js       # Lista de empresas y sectores
```

Para agregar o quitar empresas de forma permanente, edita `js/universe.js`. También puedes agregar
cualquier empresa desde la pantalla **Siguiendo → Buscar**.
