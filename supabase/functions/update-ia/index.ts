import { serve } from "https://deno.land/std/http/server.ts";

// ── Token fijo igual que update-prices ──────────────────────────────────────
const CRON_TOKEN = "Bearer tradingcat-cron-2026";

serve(async (req) => {
  const authHeader = req.headers.get("Authorization");
  if (authHeader !== CRON_TOKEN) {
    return new Response("Unauthorized", { status: 401 });
  }

  // ── Hora México ──────────────────────────────────────────────────────────
  const now = new Date();

const mexicoTime = new Date(
  now.toLocaleString("en-US", { timeZone: "America/Mexico_City" })
);

const todayStr = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Mexico_City",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(mexicoTime);

  const day  = mexicoTime.getDay();
  const time = mexicoTime.getHours() + mexicoTime.getMinutes() / 60;

  // Solo Lun-Vie 7:30am–3:00pm hora México
  if (day < 1 || day > 5 || time < 7.5 || time >= 15) {
    return new Response("Mercado cerrado");
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const API_KEY      = Deno.env.get("TWELVEDATA_API_KEY")!;

  const headers = {
    apikey:        SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
  };

  // ── Lock: evitar ejecuciones simultáneas ────────────────────────────────
  const lockRes  = await fetch(`${SUPABASE_URL}/rest/v1/update_ia_lock?id=eq.1`, { headers });
  const lockData = await lockRes.json();

  if (lockData[0]?.running) {
    return new Response("Skip — ya hay una ejecución en curso");
  }

  // Activar lock
  await fetch(`${SUPABASE_URL}/rest/v1/update_ia_lock?id=eq.1`, {
    method:  "PATCH",
    headers,
    body:    JSON.stringify({ running: true }),
  });

  try {
    // ── Obtener watchlist ────────────────────────────────────────────────
    const res  = await fetch(`${SUPABASE_URL}/rest/v1/watchlist`, { headers });
    const list = await res.json();

    if (!Array.isArray(list) || list.length === 0) {
      return new Response("Watchlist vacía");
    }

    for (const item of list) {
      try {
        // ── Historial de 30 días (1 llamada → precio + indicadores) ────
        const tsRes  = await fetch(
          `https://api.twelvedata.com/time_series?symbol=${item.ticker}&interval=1day&outputsize=30&apikey=${API_KEY}`
        );
        const tsData = await tsRes.json();

        if (tsData.status === "error" || !tsData.values?.length) {
          console.warn(`Sin datos para ${item.ticker}:`, tsData.message);
          continue;
        }

        // Los valores vienen de más reciente a más antiguo → invertir
        const prices: number[] = tsData.values
          .map((v: any) => parseFloat(v.close))
          .filter((p: number) => !isNaN(p))
          .reverse();

        if (prices.length < 2) continue;

        // Precio actual y cambio del día (de los últimos dos cierres)
        const price    = prices[prices.length - 1];
        const prevDay  = prices[prices.length - 2];
        const change   = prevDay > 0 ? ((price - prevDay) / prevDay) * 100 : 0;

        // Nombre del activo (si viene en el meta)
        const priceName: string = tsData.meta?.symbol || item.ticker;

        // ── Indicadores técnicos ─────────────────────────────────────
        const rsi        = calculateRSI(prices);
        const ema20      = calculateEMA(prices, 20);
        const volatility = calculateVolatility(prices);

        // ── Modelo IA ────────────────────────────────────────────────
        const { probability, score, signal } = predictProbability({
          rsi,
          price,
          ema20,
          volatility,
          price_change:    change,
          target:          item.buy_target,
          analyst_target:  item.analyst_target,
        });

        // ── Construir payload de actualización ───────────────────────
        const updateData: Record<string, any> = {
          // Precios (reemplaza update-prices)
          current_price: parseFloat(price.toFixed(4)),
          price_change:  parseFloat(change.toFixed(2)),
          price_name:    priceName,
          last_updated:  new Date().toISOString(),
          // Indicadores IA
          rsi:            parseFloat(rsi.toFixed(2)),
          ema20:          parseFloat(ema20.toFixed(4)),
          volatility:     parseFloat(volatility.toFixed(4)),
          ai_probability: parseFloat(probability.toFixed(1)),
          ai_score:       parseFloat(score.toFixed(1)),
          ai_signal:      signal,
        };

        // ── Alerta de precio en zona objetivo (±2%) ──────────────────
        const inZone = Math.abs((price - item.buy_target) / item.buy_target) <= 0.02;
        if (inZone && item.last_alert_date !== todayStr) {
          await sendAlert({
            ticker:       item.ticker,
            currentPrice: price,
            targetPrice:  item.buy_target,
            type:         "🟢 POSIBLE ENTRADA",
          });
          updateData.last_alert_date = todayStr;
        }

        // ── Alerta IA cuando probabilidad > 80% ─────────────────────
        if (probability > 80 && item.last_ai_alert_date !== todayStr) {
          await sendAlert({
            ticker:       item.ticker,
            currentPrice: price,
            targetPrice:  item.buy_target,
            rsi:          rsi.toFixed(2),
            type:         `🤖 IA ${signal} (${probability.toFixed(0)}%)`,
          });
          updateData.last_ai_alert_date = todayStr;
        }

        // ── Guardar en Supabase ──────────────────────────────────────
        const patchRes = await fetch(
          `${SUPABASE_URL}/rest/v1/watchlist?id=eq.${item.id}`,
          { method: "PATCH", headers, body: JSON.stringify(updateData) }
        );

        if (!patchRes.ok) {
          const err = await patchRes.text();
          console.error(`Error actualizando ${item.ticker}:`, err);
        }

      } catch (tickerErr) {
        // Error en un ticker no detiene el loop
        console.error(`Error procesando ${item.ticker}:`, tickerErr);
      }

      // Rate limit TwelveData plan gratuito: 8 req/min → ~8s entre llamadas
      await sleep(8000);
    }

    return new Response(`OK — ${list.length} tickers procesados`);

  } catch (e: any) {
    return new Response(`Error: ${e?.message ?? String(e)}`, { status: 500 });

  } finally {
    // Siempre liberar el lock
    await fetch(`${SUPABASE_URL}/rest/v1/update_ia_lock?id=eq.1`, {
      method:  "PATCH",
      headers,
      body:    JSON.stringify({ running: false }),
    });
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendAlert(payload: Record<string, any>) {
  try {
    await fetch("https://tradingcat.onrender.com/api/notify", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
  } catch {
    // No bloquear si falla el envío
  }
}

// ── Indicadores técnicos ─────────────────────────────────────────────────────

/**
 * RSI estándar (Wilder) sobre los últimos `period` cierres.
 * Requiere al menos period + 1 precios.
 */
function calculateRSI(prices: number[], period = 14): number {
  if (prices.length <= period) return 50;

  // Calcular variaciones
  const changes = prices.slice(1).map((p, i) => p - prices[i]);

  // Promedios iniciales de ganancias y pérdidas (primeros `period` cambios)
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else                 avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  // Suavizado de Wilder para el resto
  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  if (avgGain === 0) return 0;

  const rs  = avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);

  return Math.max(0, Math.min(100, rsi));
}

/** EMA (Media Móvil Exponencial) */
function calculateEMA(prices: number[], period = 20): number {
  if (prices.length === 0) return 0;
  const k = 2 / (period + 1);
  let ema  = prices[0];
  for (let i = 1; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

/** Volatilidad: desviación estándar de retornos diarios × 100 */
function calculateVolatility(prices: number[]): number {
  if (prices.length < 2) return 0;
  const returns = prices.slice(1).map((p, i) => (p - prices[i]) / prices[i]);
  const avg      = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + (r - avg) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * 100;
}

// ── Modelo IA ─────────────────────────────────────────────────────────────────

interface IAInput {
  rsi:            number;
  price:          number;
  ema20:          number;
  volatility:     number;
  price_change:   number;
  target:         number;
  analyst_target: number | null;
}

function predictProbability(input: IAInput): {
  probability: number;
  score:       number;
  signal:      string;
} {
  const { rsi, price, ema20, volatility, price_change, target, analyst_target } = input;
  let score = 0;

  // RSI — sobrevendido es oportunidad de compra
  if      (rsi < 30) score += 20;
  else if (rsi < 45) score += 10;
  else if (rsi > 70) score -= 15;

  // Precio vs EMA20 — por encima de la media es tendencia positiva
  if (price > ema20) score += 15;
  else               score -= 10;

  // Distancia al objetivo de compra
  const dist = Math.abs((price - target) / target);
  if      (dist < 0.02) score += 25;
  else if (dist < 0.05) score += 15;
  else if (dist < 0.10) score += 5;

  // Momentum del día
  if      (price_change > 0 && price_change < 3) score += 10;
  else if (price_change < 0)                     score += 5;  // retroceso = posible entrada
  else                                            score -= 10; // subida exagerada

  // Volatilidad — baja es mejor para entrar
  if      (volatility < 2) score += 10;
  else if (volatility > 4) score -= 10;

  // Potencial vs objetivo de analistas
  if (analyst_target && analyst_target > 0) {
    const upside = (analyst_target - price) / price;
    if      (upside > 0.10) score += 15;
    else if (upside > 0.05) score += 10;
    else if (upside < 0)    score -= 10; // ya superó el consenso
  }

  // Probabilidad entre 5% y 95%
  const probability = Math.max(5, Math.min(95, 50 + score));

  let signal = "NO TRADE";
  if      (probability > 80) signal = "🔥 STRONG BUY";
  else if (probability > 65) signal = "⚡ BUY";
  else if (probability > 50) signal = "👀 WATCH";

  return { probability, score, signal };
}