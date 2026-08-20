import { serve } from "https://deno.land/std/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

// Webull permite 60 llamadas/minuto por App ID. El sleep de 1s entre
// tickers (ver loop principal) ya respeta ese límite, así que no hace
// falta cortar la lista — se procesa la watchlist completa por corrida.
// Si tu Edge Function empieza a hacer timeout con listas muy grandes
// (100+), aquí es donde hay que volver a poner un tope.
const WEBULL_MAX_CALLS = 500;

// Historial diario a pedir por ticker. Necesario para EMA200 (necesita
// convergencia) y para resamplear a semanal y sacar SMA200 semanal.
const BARS_COUNT = 1100;

// Separación mínima entre dos análisis del MISMO ticker individual (agregar / reanalizar fila).
const SINGLE_TICKER_MIN_MINUTES = 1;

// ── Webull: firma HMAC-SHA256 vía Web Crypto API (compatible con Deno) ─────

function generateNonce(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

function generateTimestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function rfc3986Encode(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

async function sha256HexUpper(message: string): Promise<string> {
  const enc = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", enc.encode(message));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

async function hmacSha256Base64(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

async function signWebullRequest({
  path,
  host,
  appKey,
  appSecret,
  timestamp,
  nonce,
  extraParams = {},
  body = "",
}: {
  path: string;
  host: string;
  appKey: string;
  appSecret: string;
  timestamp: string;
  nonce: string;
  extraParams?: Record<string, string>;
  body?: string;
}): Promise<string> {
  const params: Record<string, string> = {
    ...extraParams,
    host,
    "x-app-key": appKey,
    "x-signature-algorithm": "HMAC-SHA256",
    "x-signature-nonce": nonce,
    "x-signature-version": "1.0",
    "x-timestamp": timestamp,
  };

  const sortedKeys = Object.keys(params).sort();
  const queryString = sortedKeys.map((k) => `${k}=${params[k]}`).join("&");

  let signString = `${path}&${queryString}`;

  if (body) {
    const bodySha256 = await sha256HexUpper(body);
    signString += `&${bodySha256}`;
  }

  const encoded = rfc3986Encode(signString);
  return hmacSha256Base64(`${appSecret}&`, encoded);
}

// ── Webull: token de autenticación ─────────────────────────────────────────
// Reutiliza la misma tabla webull_auth que ya usa el flujo de Next.js.
// Como el 2FA ya se aprobó una vez desde ahí, aquí solo se lee/verifica.

interface WebullTokenRow {
  access_token: string | null;
  status: string | null;
  expires_at: number | null;
}

async function getStoredWebullToken(
  SUPABASE_URL: string,
  dbHeaders: Record<string, string>
): Promise<WebullTokenRow | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/webull_auth?id=eq.1&select=access_token,status,expires_at`,
    { headers: dbHeaders }
  );
  const data = await res.json();
  return Array.isArray(data) && data.length > 0 ? data[0] : null;
}

async function checkWebullToken(
  token: string,
  webullApiUrl: string,
  appKey: string,
  appSecret: string
): Promise<{ token: string; status: string; expires: number }> {
  const path = "/openapi/auth/token/check";
  const body = JSON.stringify({ token });
  const timestamp = generateTimestamp();
  const nonce = generateNonce();

  const signature = await signWebullRequest({
    path,
    host: new URL(webullApiUrl).host,
    appKey,
    appSecret,
    timestamp,
    nonce,
    body,
  });

  const res = await fetch(`${webullApiUrl}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-app-key": appKey,
      "x-timestamp": timestamp,
      "x-signature-version": "1.0",
      "x-signature-algorithm": "HMAC-SHA256",
      "x-signature-nonce": nonce,
      "x-version": "v2",
      "x-signature": signature,
    },
    body,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Webull Check Token ${res.status}: ${data.message || JSON.stringify(data)}`);
  }
  return data;
}

async function getWebullAccessToken(
  SUPABASE_URL: string,
  dbHeaders: Record<string, string>,
  webullApiUrl: string,
  appKey: string,
  appSecret: string
): Promise<{ token: string; status: string; requires2FA: boolean }> {
  const stored = await getStoredWebullToken(SUPABASE_URL, dbHeaders);

  if (!stored?.access_token) {
    return { token: "", status: "NO_TOKEN", requires2FA: false };
  }

  const checked = await checkWebullToken(stored.access_token, webullApiUrl, appKey, appSecret);

  // Mantener Supabase sincronizado con el estado más reciente.
  await fetch(`${SUPABASE_URL}/rest/v1/webull_auth?id=eq.1`, {
    method: "PATCH",
    headers: dbHeaders,
    body: JSON.stringify({ status: checked.status, expires_at: checked.expires, updated_at: new Date().toISOString() }),
  });

  return {
    token: checked.token,
    status: checked.status,
    requires2FA: checked.status === "PENDING",
  };
}

// ── Webull: bars diarios (reemplaza time_series de TwelveData) ────────────

interface WebullBar {
  symbol: string;
  time: string;
  open: string;
  close: string;
  high: string;
  low: string;
  volume: string;
}

async function fetchWebullBars(
  symbol: string,
  accessToken: string,
  marketDataUrl: string,
  appKey: string,
  appSecret: string,
  count = BARS_COUNT
): Promise<WebullBar[]> {
  const path = "/openapi/market-data/stock/bars";

  const queryParams: Record<string, string> = {
    symbol,
    category: "US_STOCK",
    timespan: "D",
    count: String(count),
    real_time_required: "false",
  };

  const timestamp = generateTimestamp();
  const nonce = generateNonce();

  const signature = await signWebullRequest({
    path,
    host: new URL(marketDataUrl).host,
    appKey,
    appSecret,
    timestamp,
    nonce,
    extraParams: queryParams,
  });

  const qs = new URLSearchParams(queryParams).toString();

  const res = await fetch(`${marketDataUrl}${path}?${qs}`, {
    headers: {
      Accept: "application/json",
      "x-app-key": appKey,
      "x-access-token": accessToken,
      "x-timestamp": timestamp,
      "x-signature-version": "1.0",
      "x-signature-algorithm": "HMAC-SHA256",
      "x-signature-nonce": nonce,
      "x-version": "v2",
      "x-signature": signature,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Webull Bars ${symbol} ${res.status}: ${text}`);
  }

  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error(`Webull Bars ${symbol}: respuesta inesperada — ${JSON.stringify(data)}`);
  }
  return data as WebullBar[];
}

// ── Handler principal ───────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  const getEnv = (key: string) => {
    return Deno.env.get(key) || (globalThis as any).process?.env?.[key] || "";
  };

  const SUPABASE_URL       = getEnv("SUPABASE_URL");
  const SUPABASE_KEY       = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const WEBULL_APP_KEY     = getEnv("WEBULL_APP_KEY");
  const WEBULL_APP_SECRET  = getEnv("WEBULL_KEY_APP_SECRET");
  const WEBULL_API_URL     = getEnv("WEBULL_API_URL") || "https://api.webull.com";
  const WEBULL_MARKET_URL  = getEnv("WEBULL_MARKET_DATA_URL") || "https://api.webull.com";

  const dbHeaders = {
    apikey:         SUPABASE_KEY,
    Authorization:  `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
  };

  if (!WEBULL_APP_KEY || !WEBULL_APP_SECRET) {
    return new Response(
      "Faltan WEBULL_APP_KEY / WEBULL_KEY_APP_SECRET en los secrets de Supabase Edge Functions",
      { status: 500, headers: CORS }
    );
  }

  const mexicoTime = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Mexico_City" })
  );
  const day  = mexicoTime.getDay();
  const time = mexicoTime.getHours() + mexicoTime.getMinutes() / 60;
  const isMarketOpen = day >= 1 && day <= 5 && time >= 7 && time < 15;

  let singleTicker: string | null = null;
  let force = false;

  try {
    if (req.headers.get("content-type")?.includes("application/json")) {
      const body = await req.json().catch(() => ({}));
      if (body?.ticker) singleTicker = String(body.ticker).toUpperCase().trim();
      force = body?.force === true;
    }
  } catch {
    /* sin body está bien */
  }

  if (!isMarketOpen && !singleTicker && !force) {
    return new Response("Mercado cerrado", { headers: CORS });
  }

  const authHeader = req.headers.get("Authorization");
  const isCron = authHeader === "Bearer tradingcat-cron-2026";
  const isManual = authHeader === "Bearer tradingcat-manual-2026";

  if (!isCron && !isManual && !req.headers.get("apikey")) {
    return new Response("Unauthorized", { status: 401, headers: CORS });
  }

  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

  if (!singleTicker) {
    const lockRes = await fetch(
      `${SUPABASE_URL}/rest/v1/update_ia_lock?id=eq.1&select=running,started_at`,
      { headers: dbHeaders }
    );
    const lockData = await lockRes.json();
    const lock = lockData?.[0];

    if (lock?.running) {
      const started = lock.started_at ? new Date(lock.started_at).getTime() : 0;
      const minutes = (Date.now() - started) / 60000;
      if (minutes < 20) {
        return new Response(`Skip — ocupado (${minutes.toFixed(1)} min)`, { headers: CORS });
      }
      console.log("🔓 Lock expirado. Se recupera automáticamente.");
    }

    await fetch(`${SUPABASE_URL}/rest/v1/update_ia_lock?id=eq.1`, {
      method: "PATCH", headers: dbHeaders,
      body: JSON.stringify({ running: true, started_at: new Date().toISOString() }),
    });
  }

  try {
    // ── Token de Webull ────────────────────────────────────────────────
    const auth = await getWebullAccessToken(
      SUPABASE_URL, dbHeaders, WEBULL_API_URL, WEBULL_APP_KEY, WEBULL_APP_SECRET
    );

    if (auth.status !== "NORMAL") {
      return new Response(
        `Token Webull no está listo (status: ${auth.status}). ` +
        (auth.status === "PENDING"
          ? "Aprueba el 2FA en la app de Webull y vuelve a intentar."
          : "Crea un token desde /api/webull/auth (POST) en la app Next.js primero."),
        { status: 401, headers: CORS }
      );
    }

    // ── Obtener watchlist ────────────────────────────────────────────────
    let url = `${SUPABASE_URL}/rest/v1/watchlist?buy_target=gt.0&order=last_updated.asc.nullsfirst`;
    if (singleTicker) url = `${SUPABASE_URL}/rest/v1/watchlist?ticker=eq.${singleTicker}&buy_target=gt.0`;

    const res = await fetch(url, { headers: dbHeaders });
    const list = await res.json();

    if (!Array.isArray(list) || list.length === 0) {
      return new Response(
        singleTicker ? `Ticker ${singleTicker} no encontrado` : "Watchlist vacía",
        { headers: CORS }
      );
    }

    const processList = list.slice(0, WEBULL_MAX_CALLS);

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
      const item = processList[i];

      // Delay entre tickers — Webull permite 60/min, 1s de separación lo respeta con margen.
      if (i > 0) await sleep(1000);

      try {
        const rawBars = await fetchWebullBars(
          item.ticker, auth.token, WEBULL_MARKET_URL, WEBULL_APP_KEY, WEBULL_APP_SECRET
        );

        if (!rawBars.length) {
          console.log(`❌ ${item.ticker} sin datos de Webull`);
          continue;
        }

        // Webull regresa del más reciente al más antiguo — igual que TwelveData.
        const dailyRows: { date: string; close: number }[] = rawBars
          .map((b) => ({ date: b.time, close: parseFloat(b.close) }))
          .filter((r) => !isNaN(r.close) && r.close > 0)
          .reverse();

        if (dailyRows.length < 15) continue;

        const prices: number[] = dailyRows.map((r) => r.close);
        const priceName = rawBars[0]?.symbol || item.ticker;

        const today = rawBars[0];
        const openPrice = parseFloat(today.open);
        const closePrice = parseFloat(today.close);
        const price = closePrice;

        let change = 0;
        if (openPrice > 0) change = ((closePrice - openPrice) / openPrice) * 100;

        prices[prices.length - 1] = price;
        dailyRows[dailyRows.length - 1] = { ...dailyRows[dailyRows.length - 1], close: price };

        // ── Indicadores ────────────────────────────────────────────────
        let rsi = calculateRSI(prices);
        if (!isFinite(rsi) || isNaN(rsi)) rsi = 50;
        rsi = Math.max(0, Math.min(100, rsi));

        const ema20      = calculateEMA(prices, 20);
        const ema200Day  = prices.length >= 200 ? calculateEMA(prices, 200) : null;
        const volatility = calculateVolatility(prices);

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

        const inZone = Math.abs((price - item.buy_target) / item.buy_target) <= 0.02;
        if (isMarketOpen && inZone && item.last_alert_date !== todayStr) {
          await sendAlert({ ticker: item.ticker, currentPrice: price, targetPrice: item.buy_target, type: "🟢 POSIBLE ENTRADA" });
          updateData.last_alert_date = todayStr;
        }

        console.log(`💾 Guardando ${item.ticker}:`, updateData);

        const patchRes = await fetch(
          `${SUPABASE_URL}/rest/v1/watchlist?id=eq.${item.id}`,
          {
            method: "PATCH",
            headers: { ...dbHeaders, "Prefer": "return=representation" },
            body: JSON.stringify(updateData),
          }
        );

        const patchData = await patchRes.json();
        console.log(`📝 PATCH ${item.ticker} Estado: ${patchRes.status}`, patchData);

        if (!patchRes.ok) {
          console.error(`❌ PATCH ERROR ${item.ticker}:`, patchData);
        }

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
      `OK — ${processed}/${list.length} procesados · Pendientes: ${Math.max(0, list.length - processed)}`,
      { headers: CORS }
    );

  } catch (e: any) {
    return new Response(`Error: ${e?.message ?? String(e)}`, { status: 500, headers: CORS });

  } finally {
    if (!singleTicker) {
      await fetch(`${SUPABASE_URL}/rest/v1/update_ia_lock?id=eq.1`, {
        method: "PATCH",
        headers: dbHeaders,
        body: JSON.stringify({ running: false, started_at: null }),
      });
    }
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function sendAlert(payload: Record<string, any>) {
  const mexicoTime = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Mexico_City" })
  );
  const day  = mexicoTime.getDay();
  const time = mexicoTime.getHours() + mexicoTime.getMinutes() / 60;
  const isMarketOpen = day >= 1 && day <= 5 && time >= 7 && time < 15;

  if (!isMarketOpen) {
    console.log("🔕 Alerta bloqueada — mercado cerrado");
    return;
  }

  try {
    await fetch("https://tradingcat.onrender.com/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error("Error enviando alerta:", err);
  }
}

// ── Indicadores técnicos ──────────────────────────────────────────────────────

function calculateRSI(prices: number[], period = 14): number {
  if (prices.length <= period) return 50;

  const changes: number[] = [];
  for (let i = 1; i < prices.length; i++) changes.push(prices[i] - prices[i - 1]);

  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else                 avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  if (avgGain === 0) return 0;

  const rs = avgGain / avgLoss;
  return Math.max(0, Math.min(100, 100 - (100 / (1 + rs))));
}

function calculateEMA(prices: number[], period = 20): number {
  if (prices.length === 0) return 0;
  const k = 2 / (period + 1);
  let ema = prices[0];
  for (let i = 1; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k);
  return ema;
}

function calculateSMA(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(values.length - period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

// Semana ISO (lunes a domingo). Acepta tanto "YYYY-MM-DD HH:mm:ss" (TwelveData)
// como "YYYY-MM-DDTHH:mm:ss.sssZ" (Webull) tomando los primeros 10 caracteres.
function getISOWeekKey(dateStr: string): string {
  const d = new Date(dateStr.slice(0, 10) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${weekNo}`;
}

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