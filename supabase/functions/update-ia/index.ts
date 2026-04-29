import { serve } from "https://deno.land/std/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const CRON_TOKEN = "Bearer tradingcat-cron-2026";

serve(async (req) => {
  // ── CORS preflight ────────────────────────────────────────────────────────
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const API_KEY      = Deno.env.get("TWELVEDATA_API_KEY")!;

  const dbHeaders = {
    apikey:         SUPABASE_KEY,
    Authorization:  `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
  };

  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  const isCron     = authHeader === CRON_TOKEN;

  // Si viene del cron, verificar horario de mercado
 const mexicoTime = new Date(
  new Date().toLocaleString("en-US", { timeZone: "America/Mexico_City" })
)
const day  = mexicoTime.getDay()
const time = mexicoTime.getHours() + mexicoTime.getMinutes() / 60

const isMarketOpen = day >= 1 && day <= 5 && time >= 8.05 && time < 15

if (!isMarketOpen) {
  return new Response("Mercado cerrado", { headers: CORS })
}

  // Si no es cron ni viene de Supabase anon key, rechazar
  if (!isCron && !req.headers.get("apikey")) {
  return new Response("Unauthorized", { status: 401, headers: CORS });
}

  // ── Ticker específico (cuando se agrega uno nuevo desde el frontend) ──────
  // Body opcional: { ticker: "AAPL" } para procesar solo ese ticker
  let singleTicker: string | null = null;
  try {
    if (req.headers.get("content-type")?.includes("application/json")) {
      const body = await req.json().catch(() => ({}));
      if (body?.ticker) singleTicker = String(body.ticker).toUpperCase().trim();
    }
  } catch { /* sin body está bien */ }

  // ── Fecha México ──────────────────────────────────────────────────────────
  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

  // ── Lock — solo para ejecución completa (no para ticker individual) ───────
  if (!singleTicker) {
    const lockRes  = await fetch(`${SUPABASE_URL}/rest/v1/update_ia_lock?id=eq.1&select=running`, { headers: dbHeaders });
    const lockData = await lockRes.json();
    if (lockData?.[0]?.running) {
      return new Response("Skip — ocupado", { headers: CORS });
    }
    await fetch(`${SUPABASE_URL}/rest/v1/update_ia_lock?id=eq.1`, {
      method: "PATCH", headers: dbHeaders, body: JSON.stringify({ running: true }),
    });
  }

  try {
    // ── Obtener watchlist ────────────────────────────────────────────────
    let url = `${SUPABASE_URL}/rest/v1/watchlist`;
    if (singleTicker) url += `?ticker=eq.${singleTicker}`;

    const res  = await fetch(url, { headers: dbHeaders });
    const list = await res.json();

    if (!Array.isArray(list) || list.length === 0) {
      return new Response(singleTicker ? `Ticker ${singleTicker} no encontrado` : "Watchlist vacía", { headers: CORS });
    }

    let processed = 0;

    console.log(`📊 Procesando ${list.length} tickers`);

    for (const item of list) {
      try {
        // ── TwelveData: historial de 100 días para RSI preciso ────────
        const tsRes  = await fetch(
          `https://api.twelvedata.com/time_series?symbol=${item.ticker}&interval=1day&outputsize=100&apikey=${API_KEY}`
        );
        const tsData = await tsRes.json();

        if (tsData.status === "error" || !tsData.values?.length) {
          console.log(`❌ ${item.ticker} ERROR: ${tsData.message}`);
          continue;
        }

        // Invertir: TwelveData devuelve más reciente primero
        const prices: number[] = tsData.values
          .map((v: any) => parseFloat(v.close))
          .filter((p: number) => !isNaN(p) && p > 0)
          .reverse();

        // Necesitamos al menos period + 1 precios para RSI válido
        if (prices.length < 15) continue;

        const price     = prices[prices.length - 1];
        const prevDay   = prices[prices.length - 2];
        const change    = ((price - prevDay) / prevDay) * 100;
        const priceName = tsData.meta?.symbol || item.ticker;

        // ── Indicadores ────────────────────────────────────────────────
        let rsi = calculateRSI(prices);
        // Blindaje: si por cualquier razón sale fuera de rango, corregir
        if (!isFinite(rsi) || isNaN(rsi)) rsi = 50;
        rsi = Math.max(0, Math.min(100, rsi));

        const ema20      = calculateEMA(prices, 20);
        const volatility = calculateVolatility(prices);

        const { probability, score, signal } = predictProbability({
          rsi, price, ema20, volatility,
          price_change:   change,
          target:         item.buy_target,
          analyst_target: item.analyst_target,
        });

        const updateData: Record<string, any> = {
          current_price:  parseFloat(price.toFixed(4)),
          price_change:   parseFloat(change.toFixed(2)),
          price_name:     priceName,
          last_updated:   new Date().toISOString(),
          rsi:            parseFloat(rsi.toFixed(2)),
          ema20:          parseFloat(ema20.toFixed(4)),
          volatility:     parseFloat(volatility.toFixed(4)),
          ai_probability: parseFloat(probability.toFixed(1)),
          ai_score:       parseFloat(score.toFixed(1)),
          ai_signal:      signal,
        };

        // ── Alerta zona ±2% ────────────────────────────────────────────
        const inZone = Math.abs((price - item.buy_target) / item.buy_target) <= 0.02;
        if (inZone && item.last_alert_date !== todayStr) {
          await sendAlert({ ticker: item.ticker, currentPrice: price, targetPrice: item.buy_target, type: "🟢 POSIBLE ENTRADA" });
          updateData.last_alert_date = todayStr;
        }

        // ── Alerta IA ─────────────────────────────────────────────────
        if (probability > 80 && item.last_ai_alert_date !== todayStr) {
          await sendAlert({
            ticker: item.ticker, currentPrice: price, targetPrice: item.buy_target,
            rsi: rsi.toFixed(2), type: `🤖 IA ${signal} (${probability.toFixed(0)}%)`,
          });
          updateData.last_ai_alert_date = todayStr;
        }

        // ── Guardar en Supabase ────────────────────────────────────────
        await fetch(`${SUPABASE_URL}/rest/v1/watchlist?id=eq.${item.id}`, {
          method: "PATCH", headers: dbHeaders, body: JSON.stringify(updateData),
        });

        processed++;

      } catch (err) {
        console.error(`Error procesando ${item.ticker}:`, err);
      }

      // Rate limit TwelveData gratuito: 8 req/min → 8s entre llamadas
      // Solo aplicar delay si hay más de un ticker pendiente
      if (list.length > 1 && list.indexOf(item) < list.length - 1) {
        await sleep(8000);
      }
    }

    return new Response(`OK — ${processed}/${list.length} tickers procesados`, { headers: CORS });

  } catch (e: any) {
    return new Response(`Error: ${e?.message ?? String(e)}`, { status: 500, headers: CORS });

  } finally {
    // Liberar lock solo si fue ejecución completa
    if (!singleTicker) {
      await fetch(`${SUPABASE_URL}/rest/v1/update_ia_lock?id=eq.1`, {
        method: "PATCH", headers: dbHeaders, body: JSON.stringify({ running: false }),
      });
    }
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function sendAlert(payload: Record<string, any>) {
  try {
    await fetch("https://tradingcat.onrender.com/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch { /* silencioso */ }
}

// ── Indicadores técnicos ──────────────────────────────────────────────────────

/**
 * RSI con suavizado de Wilder.
 * prices debe estar ordenado de más antiguo a más reciente.
 * Con outputsize=100 y period=14 tenemos suficiente historia para el suavizado.
 */
function calculateRSI(prices: number[], period = 14): number {
  if (prices.length <= period) return 50;

  // Calcular cambios diarios
  const changes: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }

  // Promedios iniciales (primeros `period` cambios)
  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else                 avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  // Suavizado de Wilder para el resto de los cambios
  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  if (avgGain === 0) return 0;

  const rs = avgGain / avgLoss;
  // Resultado garantizado entre 0 y 100
  return Math.max(0, Math.min(100, 100 - (100 / (1 + rs))));
}

function calculateEMA(prices: number[], period = 20): number {
  if (prices.length === 0) return 0;
  const k = 2 / (period + 1);
  let ema  = prices[0];
  for (let i = 1; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function calculateVolatility(prices: number[]): number {
  if (prices.length < 2) return 0;
  const returns = prices.slice(1).map((p, i) => (p - prices[i]) / prices[i]);
  const avg      = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + (r - avg) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * 100;
}

function predictProbability(input: {
  rsi: number; price: number; ema20: number; volatility: number;
  price_change: number; target: number; analyst_target: number | null;
}) {
  const { rsi, price, ema20, volatility, price_change, target, analyst_target } = input;
  let score = 0;

  if      (rsi < 30) score += 20;
  else if (rsi < 45) score += 10;
  else if (rsi > 70) score -= 15;

  if (price > ema20) score += 15; else score -= 10;

  const dist = Math.abs((price - target) / target);
  if      (dist < 0.02) score += 25;
  else if (dist < 0.05) score += 15;
  else if (dist < 0.10) score += 5;

  if      (price_change < 0)  score += 5;
  else if (price_change > 3)  score -= 10;

  if      (volatility < 2) score += 10;
  else if (volatility > 4) score -= 10;

  if (analyst_target && analyst_target > price) score += 15;

  const probability = Math.max(5, Math.min(95, 50 + score));

  let signal = "NO TRADE";
  if      (probability > 80) signal = "🔥 STRONG BUY";
  else if (probability > 65) signal = "⚡ BUY";
  else if (probability > 50) signal = "👀 WATCH";

  return { probability, score, signal };
}