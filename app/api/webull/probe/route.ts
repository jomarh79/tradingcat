import { NextRequest, NextResponse } from "next/server";
import { getWebullAccessToken } from "@/lib/webull-auth";
import { generateNonce, generateTimestamp, signWebullRequest } from "@/lib/webull-signature";

export const dynamic = "force-dynamic";

const WEBULL_APP_KEY = process.env.WEBULL_APP_KEY;
const WEBULL_APP_SECRET = process.env.WEBULL_KEY_APP_SECRET;
const WEBULL_MARKET_URL = process.env.WEBULL_MARKET_DATA_URL || "https://api.webull.com";

// GET /api/webull/probe?path=/market-data/fundamentals/financial/income-statement/get&symbol=AAPL&category=US_STOCK&period=annual
//
// Endpoint TEMPORAL para descubrir paths/params de Webull sin redeploy —
// pasa cualquier "path" + query params extra y firma la petición igual que
// los demás endpoints. BORRAR una vez que confirmemos los paths que necesitamos.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const path = searchParams.get("path");

    if (!path) {
      return NextResponse.json({ success: false, error: "Falta el parámetro path" }, { status: 400 });
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

    // Todos los query params excepto "path" se reenvían tal cual a Webull
    const queryParams: Record<string, string> = {};
    searchParams.forEach((value, key) => {
      if (key !== "path") queryParams[key] = value;
    });

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

    const res = await fetch(`${WEBULL_MARKET_URL}${path}${qs ? `?${qs}` : ""}`, {
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

    const text = await res.text();
    let data: unknown;
    try { data = JSON.parse(text); } catch { data = text; }

    return NextResponse.json({
      success: res.ok,
      httpStatus: res.status,
      pathTried: path,
      paramsTried: queryParams,
      response: data,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message ?? String(err) }, { status: 500 });
  }
}