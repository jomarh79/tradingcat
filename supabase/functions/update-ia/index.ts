import { serve } from "https://deno.land/std/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

// Límite de llamadas de TwelveData Free
const TWELVEDATA_MAX_CALLS = 8;

// Separación mínima entre dos análisis del MISMO ticker individual (agregar / reanalizar fila).
// Esto vive del lado del servidor — protege la cuota sin importar de dónde venga la llamada.
const SINGLE_TICKER_MIN_MINUTES = 1;

serve(async (req) => {
  // ── CORS preflight ────────────────────────────────────────────────────────
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  // Crea una función para leer variables tanto en Deno (Supabase) como en Node.js (Render)
const getEnv = (key: string) => {
  return Deno.env.get(key) || (globalThis as any).process?.env?.[key] || "";
};

const SUPABASE_URL = getEnv("SUPABASE_URL");
const SUPABASE_KEY = getEnv("SUPABASE_SERVICE_ROLE_KEY");
const API_KEY      = getEnv("TWELVEDATA_API_KEY");

  const dbHeaders = {
    apikey:         SUPABASE_KEY,
    Authorization:  `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
  };

  // ── Auth ──────────────────────────────────────────────────────────────────
  // Si viene del cron, verificar horario de mercado
 const mexicoTime = new Date(
  new Date().toLocaleString("en-US", { timeZone: "America/Mexico_City" })
)
const day  = mexicoTime.getDay()
const time = mexicoTime.getHours() + mexicoTime.getMinutes() / 60


const isMarketOpen = day >= 1 && day <= 5 && time >= 7 && time < 15

//(globalThis as any).isMarketOpen = isMarketOpen;

  // ── Ticker específico / forzar actualización ─────────────────────────────
let singleTicker: string | null = null;
let force = false;

try {
  if (req.headers.get("content-type")?.includes("application/json")) {
    const body = await req.json().catch(() => ({}));

    if (body?.ticker) {
      singleTicker = String(body.ticker).toUpperCase().trim();
    }

    force = body?.force === true;
  }
} catch {
  /* sin body está bien */
}

// Bloquear solo las ejecuciones automáticas fuera de horario.
// Permitir ticker individual o force manual desde el frontend.
if (!isMarketOpen && !singleTicker && !force) {
  return new Response("Mercado cerrado", { headers: CORS });
}

  const authHeader = req.headers.get("Authorization");

  const isCron =
    authHeader === "Bearer tradingcat-cron-2026";

  const isManual =
    authHeader === "Bearer tradingcat-manual-2026";
    
  // Si no es cron ni viene de Supabase anon key, rechazar
  if (!isCron && !req.headers.get("apikey")) {
    return new Response("Unauthorized", { status: 401, headers: CORS });
  }



  // ── Fecha México ──────────────────────────────────────────────────────────
  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

  // ── Lock — solo para ejecución completa (no para ticker individual) ───────
  if (!singleTicker) {
    const lockRes = await fetch(
      `${SUPABASE_URL}/rest/v1/update_ia_lock?id=eq.1&select=running,started_at`,
      {
      headers: dbHeaders
      })
    const lockData = await lockRes.json();
    const lock = lockData?.[0]

if (lock?.running) {

    const started = lock.started_at
        ? new Date(lock.started_at).getTime()
        : 0

    const minutes =
        (Date.now() - started) / 60000

    if (minutes < 20) {

        return new Response(
            `Skip — ocupado (${minutes.toFixed(1)} min)`,
            { headers: CORS }
        )

    }

    console.log("🔓 Lock expirado. Se recupera automáticamente.")
}
    await fetch(`${SUPABASE_URL}/rest/v1/update_ia_lock?id=eq.1`, {method: "PATCH", headers: dbHeaders, body: JSON.stringify({running: true, started_at: new Date().toISOString()}),
    });
  }

  try {
    // ── Obtener watchlist ────────────────────────────────────────────────
    let url =`${SUPABASE_URL}/rest/v1/watchlist?buy_target=gt.0&order=last_updated.asc.nullsfirst`;
    if (singleTicker) url = `${SUPABASE_URL}/rest/v1/watchlist?ticker=eq.${singleTicker}&buy_target=gt.0`;

    const res = await fetch(url, { headers: dbHeaders });
const list = await res.json();

if (!Array.isArray(list) || list.length === 0) {
  return new Response(
    singleTicker
      ? `Ticker ${singleTicker} no encontrado`
      : "Watchlist vacía",
    { headers: CORS }
  );
}

const processList = list.slice(0, TWELVEDATA_MAX_CALLS);

    // ── Protección de frecuencia para ticker individual ────────────────────
    // Esta es la única protección real contra spam: no depende del navegador,
    // así que aplica sin importar de dónde venga la llamada (botón, otra pestaña, curl, etc.)
    if (singleTicker) {
      const item = list[0];
      if (item.last_updated) {
        const minutesSince = (Date.now() - new Date(item.last_updated).getTime()) / 60000;
        if (minutesSince < SINGLE_TICKER_MIN_MINUTES) {
          return new Response(
            `⏭️ ${item.ticker} ya se actualizó hace ${minutesSince.toFixed(1)} min — espera al menos ${SINGLE_TICKER_MIN_MINUTES} min entre análisis`,
            { headers: CORS }
          );
        }
      }
    }

    let processed = 0;

    console.log(`📊 Procesando ${list.length} tickers`);

    for (let i = 0; i < processList.length; i++) {
      const item = processList[i]

      // Delay garantizado entre tickers — SIEMPRE, antes de cualquier lógica
      if (i > 0) await sleep(1000)

      try {
        // ── TwelveData: historial largo — con outputsize=100 alcanzaba para RSI/EMA20,
        // pero para EMA200 (necesita convergencia) y para armar velas semanales y sacar
        // el SMA200 semanal (resampleando estos mismos datos diarios, sin llamada extra)
        // se necesita bastante más historial.
        const controller = new AbortController()

        const timeout = setTimeout(() => controller.abort(), 8000)
        const tsRes = await fetch(
          `https://api.twelvedata.com/time_series?symbol=${item.ticker}&interval=1day&outputsize=1100&apikey=${API_KEY}`,
          { signal: controller.signal }
        )

        clearTimeout(timeout)

        if (!tsRes.ok) {
          console.error(`❌ TwelveData HTTP ${item.ticker}:`, tsRes.status)
          continue
        }

        const tsData = await tsRes.json();

        if (tsData.status === "error" || !tsData.values?.length) {
          console.log(`❌ ${item.ticker} ERROR:`, tsData);
          continue;
        }

        // Filas diarias ascendentes (fecha + cierre) — se usan para RSI/EMA/EMA200 y para
        // resamplear a semanal (SMA200). TwelveData regresa del más reciente al más antiguo.
        const dailyRows: { date: string; close: number }[] = tsData.values
          .map((v: any) => ({ date: v.datetime, close: parseFloat(v.close) }))
          .filter((r: any) => !isNaN(r.close) && r.close > 0)
          .reverse();

        if (dailyRows.length < 15) continue;

        const prices: number[] = dailyRows.map(r => r.close);

        const priceName   = tsData.meta?.symbol || item.ticker;

        const today = tsData.values[0];

        const openPrice = Number(today.open);
        const closePrice = Number(today.close);

        const price = closePrice;

        let change = 0;

        if (openPrice > 0) {
          change = ((closePrice - openPrice) / openPrice) * 100;
        }

        prices[prices.length - 1] = price;
        dailyRows[dailyRows.length - 1] = { ...dailyRows[dailyRows.length - 1], close: price };

        // ── Indicadores ────────────────────────────────────────────────
        let rsi = calculateRSI(prices);
        // Blindaje: si por cualquier razón sale fuera de rango, corregir
        if (!isFinite(rsi) || isNaN(rsi)) rsi = 50;
        rsi = Math.max(0, Math.min(100, rsi));

        const ema20      = calculateEMA(prices, 20);
        const ema200Day  = prices.length >= 200 ? calculateEMA(prices, 200) : null;
        const volatility = calculateVolatility(prices);

        // SMA 200 semanal — velas semanales armadas agrupando estas mismas filas diarias
        const weeklyCloses = resampleToWeeklyCloses(dailyRows);
        const sma200Weekly = calculateSMA(weeklyCloses, 200);

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
          ema200_day:     ema200Day !== null ? parseFloat(ema200Day.toFixed(4)) : null,
          sma200_weekly:  sma200Weekly !== null ? parseFloat(sma200Weekly.toFixed(4)) : null,
          volatility:     parseFloat(volatility.toFixed(4)),
          ai_probability: parseFloat(probability.toFixed(1)),
          ai_score:       parseFloat(score.toFixed(1)),
          ai_signal:      signal,
        };

        // ── Alerta zona ±2% ────────────────────────────────────────────
        const inZone = Math.abs((price - item.buy_target) / item.buy_target) <= 0.02;
        if (isMarketOpen && inZone && item.last_alert_date !== todayStr) {
          await sendAlert({ ticker: item.ticker, currentPrice: price, targetPrice: item.buy_target, type: "🟢 POSIBLE ENTRADA" });
          updateData.last_alert_date = todayStr;
        }

        // ── Guardar en Supabase ────────────────────────────────────────
        console.log(`💾 Guardando ${item.ticker}:`, updateData)

        const patchRes = await fetch(
          `${SUPABASE_URL}/rest/v1/watchlist?id=eq.${item.id}`,
          {
            method: "PATCH",
            headers: {
              ...dbHeaders,
              "Prefer": "return=representation" // <-- Obliga a Supabase a retornar el registro cambiado
            },
            body: JSON.stringify(updateData),
          }
        )

        const patchData = await patchRes.json();
        console.log(`📝 PATCH ${item.ticker} Estado: ${patchRes.status}`, patchData);


        if (!patchRes.ok) {
          const errText = await patchRes.text()
          console.error(`❌ PATCH ERROR ${item.ticker}:`, errText)
        }
        // También actualizar RSI en trades abiertos con este ticker  
        await fetch(
          `${SUPABASE_URL}/rest/v1/trades?ticker=eq.${item.ticker}&status=eq.open`,
          { method: "PATCH", headers: dbHeaders, body: JSON.stringify({ rsi: parseFloat(rsi.toFixed(2)) }) }
        );

        processed++;

      } catch (err) {
        console.error(`Error procesando ${item.ticker}:`, err);
      }
    }

    return new Response(
  `OK — ${processed}/${list.length} procesados · Pendientes: ${
    Math.max(0, list.length - processed)
  }`,
  { headers: CORS }
);

  } catch (e: any) {
    return new Response(`Error: ${e?.message ?? String(e)}`, { status: 500, headers: CORS });

  } finally {
    // Liberar lock solo si fue ejecución completa
    if (!singleTicker) {
      await fetch(`${SUPABASE_URL}/rest/v1/update_ia_lock?id=eq.1`, {
        method: "PATCH",
        headers: dbHeaders,
        body: JSON.stringify({
          running: false,
          started_at: null,
        }),
      });
    }
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function sendAlert(payload: Record<string, any>) {
  // Validar horario REAL al momento de enviar
  const mexicoTime = new Date(
    new Date().toLocaleString("en-US", {
      timeZone: "America/Mexico_City",
    })
  )

  const day  = mexicoTime.getDay()
  const time = mexicoTime.getHours() + mexicoTime.getMinutes() / 60

  const isMarketOpen =
    day >= 1 &&
    day <= 5 &&
    time >= 7 &&
    time < 15

  // Bloquear alertas fuera de horario
  if (!isMarketOpen) {
    console.log("🔕 Alerta bloqueada — mercado cerrado")
    return
  }

  try {
    await fetch("https://tradingcat.onrender.com/api/notify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    console.error("Error enviando alerta:", err)
  }
}

// ── Indicadores técnicos ──────────────────────────────────────────────────────

/**
 * RSI con suavizado de Wilder.
 * prices debe estar ordenado de más antiguo a más reciente.
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

function calculateSMA(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(values.length - period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

// Semana ISO (lunes a domingo) para agrupar días en semanas de forma estable entre años
function getISOWeekKey(dateStr: string): string {
  const d = new Date(dateStr.split(" ")[0] + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${weekNo}`;
}

// Agrupa velas diarias (ascendentes) en cierres semanales — toma el último cierre de cada semana ISO
function resampleToWeeklyCloses(dailyRows: { date: string; close: number }[]): number[] {
  const weeklyCloses: number[] = [];
  let currentKey: string | null = null;
  let lastClose: number | null = null;

  for (const row of dailyRows) {
    const key = getISOWeekKey(row.date);
    if (currentKey !== null && key !== currentKey && lastClose !== null) {
      weeklyCloses.push(lastClose);
    }
    currentKey = key;
    lastClose = row.close;
  }
  if (lastClose !== null) weeklyCloses.push(lastClose);

  return weeklyCloses;
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