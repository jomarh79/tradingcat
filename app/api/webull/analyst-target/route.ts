import { NextRequest, NextResponse } from "next/server";
import { getWebullAccessToken } from "@/lib/webull-auth";
import { generateNonce, generateTimestamp, signWebullRequest } from "@/lib/webull-signature";

export const dynamic = "force-dynamic";

const WEBULL_APP_KEY = process.env.WEBULL_APP_KEY;
const WEBULL_APP_SECRET = process.env.WEBULL_KEY_APP_SECRET;
const WEBULL_MARKET_URL = process.env.WEBULL_MARKET_DATA_URL || "https://api.webull.com";

// GET /api/webull/analyst-target?symbol=AAPL
// Precio objetivo consenso de analistas (promedio) — usado para autocompletar
// el campo "Analistas" en la watchlist en vez de capturarlo a mano.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const symbol = (searchParams.get("symbol") || "").toUpperCase().trim();

    if (!symbol) {
      return NextResponse.json({ success: false, error: "Falta el parámetro symbol" }, { status: 400 });
    }
    if (!WEBULL_APP_KEY || !WEBULL_APP_SECRET) {
      return NextResponse.json({ success: false, error: "Faltan WEBULL_APP_KEY / WEBULL_KEY_APP_SECRET" }, { status: 500 });
    }

    const auth = await getWebullAccessToken();
    if (auth.status !== "NORMAL") {
      return NextResponse.json(
        { success: false, error: `Token Webull no está listo (status: ${auth.status})`, requires2FA: auth.requires2FA },
        { status: 401 }
      );
    }

    const path = "/market-data/fundamentals/analysis/target-prices/get";
    const queryParams: Record<string, string> = { symbol, category: "US_STOCK" };

    const timestamp = generateTimestamp();
    const nonce = generateNonce();

    const signature = signWebullRequest({
      path,
      host: new URL(WEBULL_MARKET_URL).host,
      appKey: WEBULL_APP_KEY,
      appSecret: WEBULL_APP_SECRET,
      timestamp,
      nonce,
      extraParams: queryParams,
    });

    const qs = new URLSearchParams(queryParams).toString();

    const res = await fetch(`${WEBULL_MARKET_URL}${path}?${qs}`, {
      headers: {
        Accept: "application/json",
        "x-app-key": WEBULL_APP_KEY,
        "x-access-token": auth.token,
        "x-timestamp": timestamp,
        "x-signature-version": "1.0",
        "x-signature-algorithm": "HMAC-SHA256",
        "x-signature-nonce": nonce,
        "x-version": "v2",
        "x-signature": signature,
      },
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ success: false, symbol, httpStatus: res.status, error: text }, { status: res.status });
    }

    const data = await res.json();
    const mean = parseFloat(data?.mean);

    return NextResponse.json({
      success: true,
      symbol,
      mean: !isNaN(mean) ? mean : null,
      low: data?.low != null ? parseFloat(data.low) : null,
      high: data?.high != null ? parseFloat(data.high) : null,
      median: data?.median != null ? parseFloat(data.median) : null,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message ?? String(err) }, { status: 500 });
  }
}