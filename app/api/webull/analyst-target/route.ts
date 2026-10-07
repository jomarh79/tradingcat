import { NextRequest, NextResponse } from "next/server";
import { getWebullAccessToken } from "@/lib/webull-auth";
import { generateNonce, generateTimestamp, signWebullRequest } from "@/lib/webull-signature";
import { isOwnerRequest } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

const WEBULL_APP_KEY = process.env.WEBULL_APP_KEY;
const WEBULL_APP_SECRET = process.env.WEBULL_KEY_APP_SECRET;
const WEBULL_MARKET_URL = process.env.WEBULL_MARKET_DATA_URL || "https://api.webull.com";

// Acepta AAPL, BRK.B, BF-B, etc.
const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.\-]{0,11}$/;

const FETCH_TIMEOUT_MS = 8_000;
// El consenso de analistas cambia pocas veces al día: se reutiliza una hora
const TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 100;

type Result = { status: number; body: any };
const cache = new Map<string, { expires: number; data: Result }>();
const inflight = new Map<string, Promise<Result>>();

const num = (v: any): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

async function load(symbol: string): Promise<Result> {
  const auth = await getWebullAccessToken();
  if (auth.status !== "NORMAL") {
    return {
      status: 401,
      body: { success: false, error: `Token Webull no está listo (status: ${auth.status})`, requires2FA: auth.requires2FA },
    };
  }

  const path = "/market-data/fundamentals/analysis/target-prices/get";
  const queryParams: Record<string, string> = { symbol, category: "US_STOCK" };

  const timestamp = generateTimestamp();
  const nonce = generateNonce();

  const signature = signWebullRequest({
    path,
    host: new URL(WEBULL_MARKET_URL).host,
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
    const status = res.status === 429 ? 429 : 502;
    return { status, body: { success: false, symbol, httpStatus: res.status, error: text } };
  }

  const data = await res.json();

  return {
    status: 200,
    body: {
      success: true,
      symbol,
      mean: num(data?.mean),
      low: num(data?.low),
      high: num(data?.high),
      median: num(data?.median),
    },
  };
}

// GET /api/webull/analyst-target?symbol=AAPL
// Precio objetivo consenso de analistas (promedio) — usado para autocompletar
// el campo "Analistas" en la watchlist en vez de capturarlo a mano.
// Requiere sesión (Authorization: Bearer <access_token de Supabase>).
export async function GET(request: NextRequest) {
  if (!(await isOwnerRequest(request))) {
    return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 });
  }

  try {
    const symbol = (request.nextUrl.searchParams.get("symbol") || "").toUpperCase().trim();

    if (!symbol) {
      return NextResponse.json({ success: false, error: "Falta el parámetro symbol" }, { status: 400 });
    }
    if (!SYMBOL_RE.test(symbol)) {
      return NextResponse.json({ success: false, error: "Símbolo inválido" }, { status: 400 });
    }
    if (!WEBULL_APP_KEY || !WEBULL_APP_SECRET) {
      return NextResponse.json({ success: false, error: "Faltan WEBULL_APP_KEY / WEBULL_KEY_APP_SECRET" }, { status: 500 });
    }

    let result: Result;
    const hit = cache.get(symbol);
    if (hit && hit.expires > Date.now()) {
      result = hit.data;
    } else {
      let pending = inflight.get(symbol);
      if (!pending) {
        pending = load(symbol)
          .then((r) => {
            // Solo se guardan respuestas con dato: un error o un token no listo no se queda pegado en caché
            if (r.status === 200 && r.body.mean != null) {
              cache.set(symbol, { expires: Date.now() + TTL_MS, data: r });
              while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
            }
            return r;
          })
          .finally(() => inflight.delete(symbol));
        inflight.set(symbol, pending);
      }
      result = await pending;
    }

    return NextResponse.json(result.body, { status: result.status });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message ?? String(err) }, { status: 500 });
  }
}