const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

// Los tokens se leen de los secrets de la función (CRON_SECRET / MANUAL_SECRET). Mientras no los definas se usan
// los valores de siempre, para que el cron y el botón de abiertos sigan funcionando sin cambios.
// Cuando los definas, actualiza también el header del cron y el cliente, y quita estos valores por defecto.
const CRON_TOKEN   = `Bearer ${Deno.env.get("CRON_SECRET")   ?? "tradingcat-cron-2026"}`;
const MANUAL_TOKEN = `Bearer ${Deno.env.get("MANUAL_SECRET") ?? "tradingcat-manual-2026"}`;

const NOTIFY_URL = "https://tradingcat.onrender.com/api/notify";

// Webull permite hasta 20 símbolos por petición de snapshot
const SNAPSHOT_BATCH_SIZE = 20;

// Separación mínima entre dos refrescos del MISMO trade individual (ícono por fila)
const SINGLE_TICKER_MIN_MINUTES = 1;

const FETCH_TIMEOUT_MS = 10_000;
const PATCH_CONCURRENCY = 10;

// Columnas que necesita esta función (una sola vez, para las dos consultas)
const TRADE_COLUMNS =
  "id,ticker,stop_loss,stop_hit,take_profit_1,tp1_hit,take_profit_2,tp2_hit,take_profit_3,tp3_hit,last_trade_alert_date,last_price_updated_at";

// Acepta AAPL, BRK.B, BF-B y también listados con espacio como "IVV PESOS"
const TICKER_RE = /^[A-Z0-9][A-Z0-9.\- ]{0,19}$/;

// fetch con tiempo límite: una llamada colgada ya no deja la función esperando hasta que Supabase la corte
const fetchT = (url: string, init: RequestInit = {}) =>
  fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

// Comparación sin atajos por longitud/contenido (no revela por tiempo cuántos caracteres coinciden)
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── Reloj de México (una sola implementación para el handler y las alertas) ──
function mexicoClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Mexico_City",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  const time = Number(get("hour")) + Number(get("minute")) / 60;
  return { day, time };
}

// Ventana amplia (7:00–15:00 CDMX) que cubre el horario de Nueva York con y sin horario de verano.
// No considera festivos de la bolsa.
function isMarketOpenNow(): boolean {
  const { day, time } = mexicoClock();
  return day >= 1 && day <= 5 && time >= 7 && time < 15;
}

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
  const res = await fetchT(
    `${SUPABASE_URL}/rest/v1/webull_auth?id=eq.1&select=access_token,status,expires_at`,
    { headers: dbHeaders }
  );
  if (!res.ok) throw new Error(`No se pudo leer webull_auth (${res.status})`);
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

  const res = await fetchT(`${webullApiUrl}${path}`, {
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

  const patch = await fetchT(`${SUPABASE_URL}/rest/v1/webull_auth?id=eq.1`, {
    method: "PATCH",
    headers: dbHeaders,
    body: JSON.stringify({ status: checked.status, expires_at: checked.expires, updated_at: new Date().toISOString() }),
  });
  if (!patch.ok) console.error("No se pudo guardar el estado del token:", await patch.text());

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

  const res = await fetchT(`${marketDataUrl}${path}?${qs}`, {
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
    const text = (await res.text()).slice(0, 300);
    throw new Error(`Webull Snapshot ${res.status}: ${text}`);
  }

  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error(`Webull Snapshot: respuesta inesperada — ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data as WebullSnapshot[];
}

type Quote = { price: number; change: number | null };

// Precio actual, o el cierre anterior si no hay; null si ninguno es válido.
// change es null cuando Webull no lo manda (antes se guardaba un 0 falso).
function snapshotToQuote(snap: WebullSnapshot): Quote | null {
  const last = parseFloat(snap.price);
  const prev = parseFloat(snap.pre_close);
  const price = last > 0 ? last : prev > 0 ? prev : 0;
  if (price <= 0) return null;

  const ratio = parseFloat(snap.change_ratio);
  return { price, change: Number.isFinite(ratio) ? ratio * 100 : null };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

// true solo si /api/notify confirmó el envío (si falla, la alerta se reintenta en la siguiente corrida)
async function sendAlert(payload: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetchT(NOTIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`Alerta rechazada por /api/notify (${res.status})`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Error enviando alerta:", err);
    return false;
  }
}

// ── Handler principal ───────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  const SUPABASE_URL       = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_KEY       = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const SUPABASE_ANON_KEY  = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const WEBULL_APP_KEY     = Deno.env.get("WEBULL_APP_KEY") || "";
  const WEBULL_APP_SECRET  = Deno.env.get("WEBULL_KEY_APP_SECRET") || "";
  const WEBULL_API_URL     = Deno.env.get("WEBULL_API_URL") || "https://api.webull.com";
  const WEBULL_MARKET_URL  = Deno.env.get("WEBULL_MARKET_DATA_URL") || "https://api.webull.com";

  // ── Autorización ──────────────────────────────────────────────────────────
  // Antes bastaba con mandar CUALQUIER valor en el header "apikey". Ahora debe ser uno de los tokens,
  // o la clave anon/service del proyecto.
  const authHeader = req.headers.get("Authorization") ?? "";
  const apikey     = req.headers.get("apikey") ?? "";
  const isCron     = safeEqual(authHeader, CRON_TOKEN);
  const isManual   = safeEqual(authHeader, MANUAL_TOKEN);
  const hasProjectKey =
    (SUPABASE_ANON_KEY !== "" && safeEqual(apikey, SUPABASE_ANON_KEY)) ||
    (SUPABASE_KEY !== "" && safeEqual(apikey, SUPABASE_KEY));

  if (!isCron && !isManual && !hasProjectKey) {
    return new Response("Unauthorized", { status: 401, headers: CORS });
  }

  const marketOpen = isMarketOpenNow();

  if (isCron && !marketOpen) {
    return new Response("Mercado cerrado (cron bloqueado)", { headers: CORS });
  }

  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

  // ── Ticker específico — refresco individual desde el ícono por fila ───────
  let singleTicker: string | null = null;
  if (req.headers.get("content-type")?.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    if (body?.ticker) singleTicker = String(body.ticker).toUpperCase().trim();
  }
  // El ticker va dentro de la URL del filtro: se valida para que nadie pueda agregar condiciones propias
  if (singleTicker && !TICKER_RE.test(singleTicker)) {
    return new Response("Ticker inválido", { status: 400, headers: CORS });
  }

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
    let tradesUrl = `${SUPABASE_URL}/rest/v1/trades?status=eq.open&select=${TRADE_COLUMNS}`;
    if (singleTicker) tradesUrl += `&ticker=eq.${encodeURIComponent(singleTicker)}`;

    const res = await fetchT(tradesUrl, { headers });
    if (!res.ok) {
      return new Response(`Error leyendo trades (${res.status}): ${(await res.text()).slice(0, 300)}`, { status: 500, headers: CORS });
    }
    const trades = await res.json();

    if (!Array.isArray(trades) || trades.length === 0) {
      return new Response(
        singleTicker ? `Ticker ${singleTicker} no encontrado entre trades abiertos` : "Sin trades abiertos",
        { headers: CORS }
      );
    }

    // ── Protección de frecuencia para refresco individual ──────────────
    // Se toma la actualización MÁS reciente entre todos los trades abiertos de ese ticker (puede haber varios).
    if (singleTicker) {
      const lastMs = Math.max(
        0,
        ...trades.map((t: any) => (t.last_price_updated_at ? new Date(t.last_price_updated_at).getTime() : 0))
      );
      if (lastMs > 0) {
        const minutesSince = (Date.now() - lastMs) / 60000;
        if (minutesSince < SINGLE_TICKER_MIN_MINUTES) {
          return new Response(
            `⏭️ ${singleTicker} ya se actualizó hace ${minutesSince.toFixed(1)} min — espera al menos ${SINGLE_TICKER_MIN_MINUTES} min`,
            { headers: CORS }
          );
        }
      }
    }

    // ── Snapshot en lote — dedupe tickers y agrupa en bloques de 20 ─────
    // Se excluyen proactivamente tickers con espacio (ej. "IVV PESOS") — son
    // listados fuera de Webull (BMV en pesos) que ningún proveedor reconoce
    // hoy; reintentarlos cada corrida solo genera error y ruido en logs.
    const allUniqueTickers: string[] = Array.from(new Set(trades.map((t: any) => String(t.ticker))));
    const uniqueTickers = allUniqueTickers.filter((t) => !/\s/.test(t));
    const skippedTickers = allUniqueTickers.filter((t) => /\s/.test(t));
    if (skippedTickers.length > 0) {
      console.log(`⏭️ Símbolos excluidos (no soportados por Webull): ${skippedTickers.join(", ")}`);
    }
    const batches = chunk(uniqueTickers, SNAPSHOT_BATCH_SIZE);

    const quoteMap = new Map<string, Quote>();

    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      try {
        const snapshots = await fetchWebullSnapshotBatch(
          batch, auth.token, WEBULL_MARKET_URL, WEBULL_APP_KEY, WEBULL_APP_SECRET
        );
        for (const snap of snapshots) {
          const quote = snapshotToQuote(snap);
          if (quote) quoteMap.set(String(snap.symbol).toUpperCase(), quote);
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
            const quote = single[0] ? snapshotToQuote(single[0]) : null;
            if (quote) quoteMap.set(String(single[0].symbol).toUpperCase(), quote);
          } catch (innerErr) {
            console.error(`Símbolo problemático confirmado: ${symbol}`, innerErr);
          }
        }
      }

      // Respeta el límite de 1 req/seg entre lotes (no hace falta esperar después del último)
      if (b < batches.length - 1) await sleep(1100);
    }

    // ── Actualización de cada trade (en grupos de 10 en paralelo) ───────
    let updated = 0, alerted = 0, skipped = 0;

    const processTrade = async (trade: any) => {
      try {
        const quote = quoteMap.get(String(trade.ticker).toUpperCase());

        if (!quote) {
          if (skippedTickers.includes(trade.ticker)) {
            console.log(`⏭️ ${trade.ticker} excluido de Webull (símbolo no soportado) — se deja igual`);
          } else {
            console.error(`Sin snapshot Webull para ${trade.ticker}`);
          }
          skipped++;
          return;
        }

        const { price, change } = quote;

        const updateData: Record<string, unknown> = {
          last_price: parseFloat(price.toFixed(4)),
          last_price_updated_at: new Date().toISOString(),
        };
        // Si Webull no mandó la variación, se conserva la anterior en vez de escribir un 0 falso
        if (change != null) updateData.day_change = parseFloat(change.toFixed(2));

        // ── Alertas — 1 vez por día por trade ─────────────────────────
        const alreadyAlerted = (trade.last_trade_alert_date ?? "") === todayStr;

        if (!alreadyAlerted && marketOpen) {
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
            const sent = await sendAlert({ ticker: trade.ticker, type: alertMsg, currentPrice: price, targetPrice: alertTarget });
            // Solo se marca el día si la alerta realmente salió; si falló, se reintenta en la próxima corrida
            if (sent) {
              updateData.last_trade_alert_date = todayStr;
              alerted++;
            }
          }
        }

        const patchRes = await fetchT(
          `${SUPABASE_URL}/rest/v1/trades?id=eq.${encodeURIComponent(String(trade.id))}`,
          { method: "PATCH", headers, body: JSON.stringify(updateData) }
        );

        if (patchRes.ok) updated++;
        else console.error(`Error actualizando ${trade.ticker}:`, await patchRes.text());

      } catch (err) {
        console.error(`Error en ${trade.ticker}:`, err);
        skipped++;
      }
    };

    for (const group of chunk(trades, PATCH_CONCURRENCY)) {
      await Promise.all(group.map(processTrade));
    }

    return new Response(`OK — ${updated} actualizados, ${alerted} alertas, ${skipped} saltados`, { headers: CORS });

  } catch (e: any) {
    return new Response(`Error: ${e?.message ?? String(e)}`, {
      status: 500,
      headers: CORS
    });
  }
});