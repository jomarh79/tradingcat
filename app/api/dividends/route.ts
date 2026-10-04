import { NextRequest, NextResponse } from "next/server";
import { getWebullAccessToken } from "@/lib/webull-auth";
import { generateNonce, generateTimestamp, signWebullRequest } from "@/lib/webull-signature";

export const dynamic = "force-dynamic";

const WEBULL_APP_KEY = process.env.WEBULL_APP_KEY;
const WEBULL_APP_SECRET = process.env.WEBULL_KEY_APP_SECRET;
const WEBULL_MARKET_URL = process.env.WEBULL_MARKET_DATA_URL || "https://api.webull.com";
const WEBULL_HOST = new URL(WEBULL_MARKET_URL).host;

// Acepta AAPL, BRK.B, BF-B, etc.
const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.\-]{0,11}$/;

const DEFAULT_YEARS = 10;
const MAX_YEARS = 20; // Webull limita a 20 años (80 trimestres) en este endpoint
const FETCH_TIMEOUT_MS = 10_000;

// El historial de dividendos cambia una vez por trimestre: se reutiliza horas, no segundos
const TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ENTRIES = 80;

type Result = { status: number; body: any };
const cache = new Map<string, { expires: number; data: Result }>();
const inflight = new Map<string, Promise<Result>>();

// "yyyy-MM-dd" tal cual; cualquier otro formato se convierte. null si no es una fecha válida.
function toDayKey(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString().slice(0, 10);
}

async function load(symbol: string, years: number): Promise<Result> {
  const auth = await getWebullAccessToken();
  if (auth.status !== "NORMAL") {
    return {
      status: 401,
      body: { error: `Token Webull no está listo (status: ${auth.status})`, requires2FA: auth.requires2FA },
    };
  }

  const path = "/market-data/fundamentals/income-statements/get";
  const queryParams: Record<string, string> = {
    symbol,
    category: "US_STOCK",
    type: "QUARTERLY",
    count: String(Math.min(years * 4, MAX_YEARS * 4)),
  };

  const timestamp = generateTimestamp();
  const nonce = generateNonce();

  const signature = signWebullRequest({
    path,
    host: WEBULL_HOST,
    appKey: WEBULL_APP_KEY!,
    appSecret: WEBULL_APP_SECRET!,
    timestamp,
    nonce,
    extraParams: queryParams,
  });

  const res = await fetch(`${WEBULL_MARKET_URL}${path}?${new URLSearchParams(queryParams)}`, {
    headers: {
      Accept: "application/json",
      "x-app-key": WEBULL_APP_KEY!,
      "x-access-token": auth.token,
      "x-timestamp": timestamp,
      "x-signature-version": "1.0",
      "x-signature-algorithm": "HMAC-SHA256",
      "x-signature-nonce": nonce,
      "x-version": "v2",
      "x-signature": signature,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 200);
    // Un 401/403 de Webull no se reenvía tal cual: el cliente lo confundiría con "token no listo" de esta app
    return { status: res.status === 429 ? 429 : 502, body: { error: `Webull ${res.status}: ${text}` } };
  }

  const raw = await res.json();
  if (!Array.isArray(raw)) {
    return { status: 502, body: { error: "Respuesta inesperada de Webull" } };
  }

  const cutoff = new Date(Date.now() - years * 365 * 86400000).toISOString().slice(0, 10);

  // Una fecha por trimestre (end_date = cierre del trimestre, NO la fecha de pago ni la ex-dividendo)
  const byDay = new Map<string, number>();
  for (const q of raw) {
    const date = toDayKey(q?.end_date);
    const amount = q?.dps != null ? parseFloat(q.dps) : NaN;
    if (!date || !Number.isFinite(amount) || amount <= 0 || date < cutoff) continue;
    if (!byDay.has(date)) byDay.set(date, amount);
  }

  const dividends = Array.from(byDay.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, amount]) => ({ date, amount }));

  return { status: 200, body: { symbol, years, dividends } };
}

// GET /api/dividends?symbol=BX&years=10
// Historial de dividendos vía Webull income-statements (campo "dps" — dividendos
// por acción, trimestral). Finnhub bloquea /stock/dividend en el plan gratuito
// ("You don't have access to this resource"), así que usamos Webull en su lugar.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const symbol = (searchParams.get("symbol") || "").toUpperCase().trim();

    // Un valor no numérico (o fuera de rango) antes producía count=NaN y una lista vacía sin explicación
    const parsedYears = parseInt(searchParams.get("years") || String(DEFAULT_YEARS), 10);
    const years = Number.isFinite(parsedYears) ? Math.min(Math.max(parsedYears, 1), MAX_YEARS) : DEFAULT_YEARS;

    if (!symbol) {
      return NextResponse.json({ error: "Falta el parámetro symbol" }, { status: 400 });
    }
    if (!SYMBOL_RE.test(symbol)) {
      return NextResponse.json({ error: "Símbolo inválido" }, { status: 400 });
    }
    if (!WEBULL_APP_KEY || !WEBULL_APP_SECRET) {
      return NextResponse.json({ error: "Faltan WEBULL_APP_KEY / WEBULL_KEY_APP_SECRET" }, { status: 500 });
    }

    const key = `${symbol}|${years}`;
    let result: Result;

    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) {
      result = hit.data;
    } else {
      let pending = inflight.get(key);
      if (!pending) {
        pending = load(symbol, years)
          .then((r) => {
            // Solo se guardan respuestas buenas: un error o un token no listo no se queda pegado en caché
            if (r.status === 200) {
              cache.set(key, { expires: Date.now() + TTL_MS, data: r });
              while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
            }
            return r;
          })
          .finally(() => inflight.delete(key));
        inflight.set(key, pending);
      }
      result = await pending;
    }

    return NextResponse.json(result.body, { status: result.status });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}