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
| **🎯 Análisis profundo** | Para las empresas que sigues: 10,000 escenarios con el efecto de las noticias de último momento. Se recalcula solo cuando sale una noticia o el precio se mueve más de 1.5%. Te dice **Compra ahora / Preferible esperar unos días para comprar / Vende en unos días / Vende ahora / Mantén**, con cuánto podría bajar o subir mañana, en 1 semana y en 1 mes. |
| **📏 Precisión medida** | Prueba histórica: las mismas reglas aplicadas semana a semana a 10 años de precios reales (sin ver el futuro) y comparadas con lo que pasó. Muestra si cada sugerencia acierta más que el azar, si los rangos están calibrados y si seguirlas gana más que comprar y mantener. Con tus claves puedes repetirla desde la app. |
| **📊 Ranking por factores** | Ordena tus empresas por un factor (tendencia de 12 meses, baja volatilidad, rebote…) **solo si pasó la prueba fuera de muestra**. Hoy ninguno la pasó, así que la app lo dice en vez de mostrar un ranking "para comprar". |
| **💼 Cuenta virtual** | Dinero simulado con precios reales y costos (0.05% comisión + 0.05% deslizamiento): tus operaciones, un robot de factores, un robot que sigue las sugerencias y el S&P 500 como referencia, con métricas completas. Nunca se conecta a un bróker. |
| **🧭 Cartera y riesgo** | **¿Cuánto comprar?** según tu perfil (pérdida máxima por operación, máximo por empresa y por sector), stop de cierre en el escenario malo a 1 mes con su probabilidad **medida**, freno de emergencia si tu cuenta cae, armador de portafolio (partes iguales, paridad de riesgo, mínima varianza, HRP) con acciones a comprar, y plan de aportes mensuales con 5,000 escenarios. |
| **📝 Tesis por empresa** | Escribes por qué compras, tu stop, tu objetivo y cada cuánto revisarla; Pulso la revisa sola (stop, objetivo, resultados, noticias muy negativas, tendencia) y te avisa si se rompe. |
| **📅 Resultados y dividendo** | Fecha de los próximos resultados (Finnhub), cuántas veces superó la estimación y dividendo anual. Si faltan menos de 30 días, sugiere la mitad del tamaño. |
| **📓 Diario de señales** | Cada sugerencia queda registrada con su precio y a los 5 días hábiles se anota si acertó: la prueba en vivo, sin trampa posible. |
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

## 📏 Resultado de la prueba histórica (29 empresas, 2016–2026, 14,631 decisiones)

Márgenes de error por bootstrap agrupado por semana (las empresas se mueven juntas).

| Qué se midió | Resultado |
|---|---|
| Rango del 90% a 1 día / 1 semana / 1 mes | El precio real quedó dentro el **89.1% / 89.3% / 90.1%** de las veces → **bien calibrado** |
| "Compra ahora" | 58.2% vs 56.2% al azar (+2.1 pts, de −1.5 a +5.9) → **igual que el azar** |
| "Esperar unos días para comprar" | 47.0% vs 49.5% (−2.4 pts, de −5.8 a +0.8) → **igual que el azar** |
| "Vende en unos días" | 55.6% vs 60.2% (−4.6 pts, de −6.9 a −2.2) → **peor que el azar** |
| "Vende ahora" | 42.4% vs 43.9% → **igual que el azar** |

| Portafolio (29 empresas, semanal) | Ganancia anual | Sharpe | Peor caída |
|---|---|---|---|
| Seguir las sugerencias | 10.0% | 1.07 | −15% |
| Señal COMPRA/VENTA | 15.8% | 1.30 | −18% |
| Las 29 en partes iguales | 28.1% | 1.41 | −27% |
| S&P 500 | 15.5% | 0.91 | −29% |

Las sugerencias aciertan el 78% de sus operaciones y aun así ganan menos: pasan ~70% del tiempo en efectivo.

## 📊 Estudio de factores (104 grandes empresas de EE.UU.)

Protocolo fijado de antemano: dirección de cada factor elegida con 2016–2021, evaluación a ciegas en 2022–2026,
corrección por pruebas múltiples (Benjamini-Hochberg) y simulación de comprar el 20% mejor clasificado con costos.

- **Ninguno quedó validado.** El más cercano: tendencia de 12 meses sin el último mes (IC de prueba +0.023, p = 0.052),
  que coincide con décadas de evidencia académica. El robot de la cuenta virtual lo está probando con dinero simulado.
- Los puntajes propios de Pulso no predicen qué acción lo hará mejor (IC ≈ 0).

Conclusión honesta: los rangos de riesgo son confiables; las sugerencias de compra/venta y los factores, todavía no.
La prueba solo mide las reglas técnicas y la simulación (no hay historial gratuito de fundamentales y noticias).

## 🧭 Prueba de portafolio y stops (Fase 2)

Mismo código de la app, rebalanceo mensual con solo el último año de datos de cada fecha, costo 0.1% por operación.

| 104 grandes empresas, 2016–2026 | Al año | Volatilidad | Sharpe | Peor caída |
|---|---|---|---|---|
| Partes iguales | 17.8% | 17.6% | 1.02 | −34% |
| Paridad de riesgo simple | 15.8% | 16.5% | 0.97 | −33% |
| HRP | 13.5% | 15.2% | 0.91 | −32% |
| Mínima varianza | 9.7% | 13.8% | 0.74 | −32% |
| S&P 500 | 14.3% | 18.0% | 0.84 | −34% |

- Los optimizadores **sí bajan la volatilidad** (de forma confiable), pero **también la ganancia**, y ninguno mejoró el
  Sharpe: repartir en partes iguales sigue siendo la opción a vencer. En el COVID casi no protegieron; en 2022 sí.
- **Stops** (escenario malo a 1 mes, revisado al cierre): no mejoraron la ganancia (−0.3% al año, de −1.7% a +1.5%).
  Sirven para acotar la pérdida por operación (la real fue 1.11× la planeada en promedio) y para calcular cuánto comprar.
- La fórmula decía que el stop se tocaría 8% de las veces en un mes; **pasó 10.2%** (14% en acciones tranquilas,
  6% en las volátiles). La app muestra la cifra medida, no la de la fórmula.

## ⚠️ Limitaciones (siendo sinceros)

- **Alertas con la app cerrada:** las alertas son instantáneas mientras Pulso está abierta o en segundo plano
  reciente (por eso existe el *Modo vigilancia*). Si cierras la app por completo, el teléfono la congela y no
  puede vigilar precios. Para alertas 24/7 con la app cerrada hace falta un pequeño servidor que vigile los
  precios y mande notificaciones push (siguiente fase).
- **Samsung** cotiza en la bolsa de Corea; los planes gratuitos normalmente no incluyen esos datos.
- **Modo demo** usa precios y noticias simulados (marcados como DEMO). No los uses para decidir.
- **Margen de error de 1%:** se refiere a la precisión de la simulación (con 10,000 escenarios, las probabilidades
  y precios estimados varían ±1% o menos si se repite el cálculo). No significa que el precio real vaya a quedar a
  ±1% de lo estimado: eso no lo puede lograr ningún modelo. Por eso la app muestra el rango completo.
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
    ├── risk.js           # Stop, tamaño de posición, freno de emergencia
    ├── portfolio.js      # Ledoit-Wolf, mínima varianza, HRP, acciones a comprar
    ├── plan.js           # Plan de aportes (Monte Carlo con rachas de crisis)
    ├── thesis.js         # Tesis por empresa y sus revisiones automáticas
    ├── paper.js          # Cuenta virtual y diario de señales
    ├── factors.js        # Estudio de factores
    ├── backtest.js       # Prueba histórica de las reglas
    ├── metrics.js        # Sharpe, Sortino, bootstrap, Benjamini-Hochberg
    ├── data.js           # Proveedores: Demo, Finnhub, Twelve Data
    ├── charts.js         # Velas, medidor, anillos, abanico
    ├── notify.js         # Notificaciones, sonido y alertas de precio
    ├── store.js          # Guardado local y caché
    └── universe.js       # Lista de empresas y sectores
```

Para agregar o quitar empresas de forma permanente, edita `js/universe.js`. También puedes agregar
cualquier empresa desde la pantalla **Siguiendo → Buscar**.
