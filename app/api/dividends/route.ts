import { NextRequest, NextResponse } from "next/server";
import { getWebullAccessToken } from "@/lib/webull-auth";
import { generateNonce, generateTimestamp, signWebullRequest } from "@/lib/webull-signature";

export const dynamic = "force-dynamic";

const WEBULL_APP_KEY = process.env.WEBULL_APP_KEY;
const WEBULL_APP_SECRET = process.env.WEBULL_KEY_APP_SECRET;
const WEBULL_MARKET_URL = process.env.WEBULL_MARKET_DATA_URL || "https://api.webull.com";

// GET /api/dividends?symbol=BX&years=10
// Historial de dividendos vía Webull income-statements (campo "dps" — dividendos
// por acción, trimestral). Finnhub bloquea /stock/dividend en el plan gratuito
// ("You don't have access to this resource"), así que usamos Webull en su lugar.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const symbol = (searchParams.get("symbol") || "").toUpperCase().trim();
    const years = parseInt(searchParams.get("years") || "10", 10);

    if (!symbol) {
      return NextResponse.json({ error: "Falta el parámetro symbol" }, { status: 400 });
    }
    if (!WEBULL_APP_KEY || !WEBULL_APP_SECRET) {
      return NextResponse.json({ error: "Faltan WEBULL_APP_KEY / WEBULL_KEY_APP_SECRET" }, { status: 500 });
    }

    const auth = await getWebullAccessToken();
    if (auth.status !== "NORMAL") {
      return NextResponse.json(
        { error: `Token Webull no está listo (status: ${auth.status})`, requires2FA: auth.requires2FA },
        { status: 401 }
      );
    }

    const path = "/market-data/fundamentals/income-statements/get";
    const queryParams: Record<string, string> = {
      symbol,
      category: "US_STOCK",
      type: "QUARTERLY",
      count: String(Math.min(years * 4, 80)), // Webull limita a 20 años (80 trimestres) por defecto en este endpoint
    };

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
      return NextResponse.json({ error: `Webull ${res.status}: ${text}` }, { status: res.status });
    }

    const raw = await res.json();
    if (!Array.isArray(raw)) {
      return NextResponse.json({ error: "Respuesta inesperada de Webull", raw }, { status: 502 });
    }

    const cutoff = Date.now() - years * 365 * 86400000;

    const dividends = raw
      .map((q: any) => ({
        date: q.end_date,
        amount: q.dps != null ? parseFloat(q.dps) : null,
      }))
      .filter((d: any) => d.date && d.amount != null && d.amount > 0 && new Date(d.date).getTime() >= cutoff)
      .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return NextResponse.json({ symbol, years, dividends });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}