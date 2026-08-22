import { serve } from "https://deno.land/std/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const CRON_TOKEN = "Bearer tradingcat-cron-2026";

// Webull permite hasta 20 símbolos por petición de snapshot
const SNAPSHOT_BATCH_SIZE = 20;

// Separación mínima entre dos refrescos del MISMO trade individual (ícono por fila)
const SINGLE_TICKER_MIN_MINUTES = 1;

// ── Webull: firma HMAC-SHA256 vía Web Crypto API (compatible con Deno) ─────
// (Duplicado intencionalmente de update-ia/index.ts para no tocar esa función,
// que ya está en producción y funcionando.)

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
// Reutiliza la misma tabla webull_auth ya usada por el flujo de Next.js y por update-ia.

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

// ── Webull: snapshot en lote (reemplaza el quote de Finnhub, uno por uno) ──

interface WebullSnapshot {
  symbol: string;
  price: string;
  open: string;
  high: string;
  low: string;
  volume: string;
  change: string;
  change_ratio: string;
  pre_close: string;
  last_trade_time: number;
}

async function fetchWebullSnapshotBatch(
  symbols: string[],
  accessToken: string,
  marketDataUrl: string,
  appKey: string,
  appSecret: string
): Promise<WebullSnapshot[]> {
  const path = "/openapi/market-data/stock/snapshot";

  const queryParams: Record<string, string> = {
    symbols: symbols.join(","),
    category: "US_STOCK",
    extend_hour_required: "false",
    overnight_required: "false",
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
    throw new Error(`Webull Snapshot ${res.status}: ${text}`);
  }

  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error(`Webull Snapshot: respuesta inesperada — ${JSON.stringify(data)}`);
  }
  return data as WebullSnapshot[];
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ── Handler principal ───────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  const authHeader = req.headers.get("Authorization");
  const isCron      = authHeader === CRON_TOKEN;
  const isManual    = authHeader === "Bearer tradingcat-manual-2026";

  if (!isCron && !isManual && !req.headers.get("apikey")) {
    return new Response("Unauthorized", { status: 401, headers: CORS });
  }

  const mexicoNow = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Mexico_City" })
  );
  const day = mexicoNow.getDay();
  const time = mexicoNow.getHours() + mexicoNow.getMinutes() / 60;
  const isMarketOpen = day >= 1 && day <= 5 && time >= 7 && time < 15;

  if (isCron && !isMarketOpen) {
    return new Response("Mercado cerrado (cron bloqueado)", { headers: CORS });
  }

  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

  // ── Ticker específico — refresco individual desde el ícono por fila ───────
  let singleTicker: string | null = null;
  try {
    if (req.headers.get("content-type")?.includes("application/json")) {
      const body = await req.json().catch(() => ({}));
      if (body?.ticker) singleTicker = String(body.ticker).toUpperCase().trim();
    }
  } catch {
    /* sin body está bien */
  }

  const SUPABASE_URL       = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_KEY       = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const WEBULL_APP_KEY     = Deno.env.get("WEBULL_APP_KEY") || "";
  const WEBULL_APP_SECRET  = Deno.env.get("WEBULL_KEY_APP_SECRET") || "";
  const WEBULL_API_URL     = Deno.env.get("WEBULL_API_URL") || "https://api.webull.com";
  const WEBULL_MARKET_URL  = Deno.env.get("WEBULL_MARKET_DATA_URL") || "https://api.webull.com";

  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };

  if (!WEBULL_APP_KEY || !WEBULL_APP_SECRET) {
    return new Response(
      "Faltan WEBULL_APP_KEY / WEBULL_KEY_APP_SECRET en los secrets de Supabase Edge Functions",
      { status: 500, headers: CORS }
    );
  }

  try {
    // ── Token de Webull ────────────────────────────────────────────────
    const auth = await getWebullAccessToken(
      SUPABASE_URL, headers, WEBULL_API_URL, WEBULL_APP_KEY, WEBULL_APP_SECRET
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

    // ── Trades abiertos ────────────────────────────────────────────────
    let tradesUrl = `${SUPABASE_URL}/rest/v1/trades?status=eq.open&select=id,ticker,stop_loss,stop_hit,take_profit_1,tp1_hit,take_profit_2,tp2_hit,take_profit_3,tp3_hit,last_trade_alert_date,last_price_updated_at`;
    if (singleTicker) {
      tradesUrl = `${SUPABASE_URL}/rest/v1/trades?status=eq.open&ticker=eq.${singleTicker}&select=id,ticker,stop_loss,stop_hit,take_profit_1,tp1_hit,take_profit_2,tp2_hit,take_profit_3,tp3_hit,last_trade_alert_date,last_price_updated_at`;
    }

    const res = await fetch(tradesUrl, { headers });
    const trades = await res.json();

    if (!Array.isArray(trades) || trades.length === 0) {
      return new Response(
        singleTicker ? `Ticker ${singleTicker} no encontrado entre trades abiertos` : "Sin trades abiertos",
        { headers: CORS }
      );
    }

    // ── Protección de frecuencia para refresco individual ──────────────
    if (singleTicker) {
      const item = trades[0];
      if (item.last_price_updated_at) {
        const minutesSince = (Date.now() - new Date(item.last_price_updated_at).getTime()) / 60000;
        if (minutesSince < SINGLE_TICKER_MIN_MINUTES) {
          return new Response(
            `⏭️ ${item.ticker} ya se actualizó hace ${minutesSince.toFixed(1)} min — espera al menos ${SINGLE_TICKER_MIN_MINUTES} min`,
            { headers: CORS }
          );
        }
      }
    }

    // ── Snapshot en lote — dedupe tickers y agrupa en bloques de 20 ─────
    // Se excluyen proactivamente tickers con espacio (ej. "IVV PESOS") — son
    // listados fuera de Webull (BMV en pesos) que ningún proveedor reconoce
    // hoy; reintentarlos cada corrida solo genera error y ruido en logs.
    const allUniqueTickers = Array.from(new Set(trades.map((t: any) => t.ticker)));
    const uniqueTickers = allUniqueTickers.filter((t) => !/\s/.test(t));
    const skippedTickers = allUniqueTickers.filter((t) => /\s/.test(t));
    if (skippedTickers.length > 0) {
      console.log(`⏭️ Símbolos excluidos (no soportados por Webull): ${skippedTickers.join(", ")}`);
    }
    const batches = chunk(uniqueTickers, SNAPSHOT_BATCH_SIZE);

    const quoteMap = new Map<string, { price: number; change: number }>();

    for (const batch of batches) {
      try {
        const snapshots = await fetchWebullSnapshotBatch(
          batch, auth.token, WEBULL_MARKET_URL, WEBULL_APP_KEY, WEBULL_APP_SECRET
        );

        for (const snap of snapshots) {
          const price = parseFloat(snap.price) > 0
            ? parseFloat(snap.price)
            : parseFloat(snap.pre_close) || 0;

          if (price <= 0) continue;

          const changeRatio = parseFloat(snap.change_ratio);
          const change = !isNaN(changeRatio) ? changeRatio * 100 : 0;

          quoteMap.set(snap.symbol, { price, change });
        }
      } catch (err) {
        // Un solo símbolo problemático puede tumbar el lote completo (20 tickers).
        // Fallback: reintentar uno por uno para no perder los que sí son válidos.
        console.error("Error en batch de snapshot, reintentando individualmente:", batch, err);

        for (const symbol of batch) {
          try {
            await sleep(1100); // respeta 1 req/seg
            const single = await fetchWebullSnapshotBatch(
              [symbol], auth.token, WEBULL_MARKET_URL, WEBULL_APP_KEY, WEBULL_APP_SECRET
            );
            const snap = single[0];
            if (!snap) continue;

            const price = parseFloat(snap.price) > 0
              ? parseFloat(snap.price)
              : parseFloat(snap.pre_close) || 0;
            if (price <= 0) continue;

            const changeRatio = parseFloat(snap.change_ratio);
            const change = !isNaN(changeRatio) ? changeRatio * 100 : 0;

            quoteMap.set(snap.symbol, { price, change });
          } catch (innerErr) {
            console.error(`Símbolo problemático confirmado: ${symbol}`, innerErr);
          }
        }
      }

      // Respeta el límite de 1 req/seg si hay más de un lote
      if (batches.length > 1) await sleep(1100);
    }

    let updated = 0, alerted = 0, skipped = 0;

    for (const trade of trades) {
      try {
        const quote = quoteMap.get(trade.ticker);

        if (!quote) {
          if (skippedTickers.includes(trade.ticker)) {
            console.log(`⏭️ ${trade.ticker} excluido de Webull (símbolo no soportado) — se deja igual`);
          } else {
            console.error(`Sin snapshot Webull para ${trade.ticker}`);
          }
          skipped++;
          continue;
        }

        const { price, change } = quote;

        const updateData: Record<string, any> = {
          last_price: parseFloat(price.toFixed(4)),
          day_change: parseFloat(change.toFixed(2)),
          last_price_updated_at: new Date().toISOString(),
        };

        // ── Alertas — 1 vez por día por trade ─────────────────────────
        const alreadyAlerted = (trade.last_trade_alert_date ?? "") === todayStr;

        if (!alreadyAlerted && isMarketOpen) {
          let alertMsg    = "";
          let alertTarget = 0;

          if (trade.stop_loss && !trade.stop_hit && price <= Number(trade.stop_loss)) {
            alertMsg = "🚨 STOP LOSS ALCANZADO"; alertTarget = Number(trade.stop_loss);
          }
          else if (trade.take_profit_3 && !trade.tp3_hit && price >= Number(trade.take_profit_3)) {
            alertMsg = "💰 TAKE PROFIT 3 ALCANZADO"; alertTarget = Number(trade.take_profit_3);
          }
          else if (trade.take_profit_2 && !trade.tp2_hit && price >= Number(trade.take_profit_2)) {
            alertMsg = "💰 TAKE PROFIT 2 ALCANZADO"; alertTarget = Number(trade.take_profit_2);
          }
          else if (trade.take_profit_1 && !trade.tp1_hit && price >= Number(trade.take_profit_1)) {
            alertMsg = "💰 TAKE PROFIT 1 ALCANZADO"; alertTarget = Number(trade.take_profit_1);
          }

          if (alertMsg) {
            await sendAlert({ ticker: trade.ticker, type: alertMsg, currentPrice: price, targetPrice: alertTarget });
            updateData.last_trade_alert_date = todayStr;
            alerted++;
          }
        }

        const patchRes = await fetch(
          `${SUPABASE_URL}/rest/v1/trades?id=eq.${trade.id}`,
          { method: "PATCH", headers, body: JSON.stringify(updateData) }
        );

        if (patchRes.ok) updated++;
        else console.error(`Error actualizando ${trade.ticker}:`, await patchRes.text());

      } catch (err) {
        console.error(`Error en ${trade.ticker}:`, err);
        skipped++;
      }
    }

    return new Response(`OK — ${updated} actualizados, ${alerted} alertas, ${skipped} saltados`, { headers: CORS });

  } catch (e: any) {
    return new Response(`Error: ${e?.message ?? String(e)}`, {
      status: 500,
      headers: CORS
    });
  }
});

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function sendAlert(payload: Record<string, any>): Promise<void> {
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