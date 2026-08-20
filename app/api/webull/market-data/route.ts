import { NextRequest, NextResponse } from "next/server";
import { getWebullAccessToken } from "@/lib/webull-auth";
import {
  generateNonce,
  generateTimestamp,
  signWebullRequest,
} from "@/lib/webull-signature";

export const dynamic = "force-dynamic";

const APP_KEY = process.env.WEBULL_APP_KEY;
const APP_SECRET = process.env.WEBULL_KEY_APP_SECRET;

// IMPORTANTE: data-api.webull.com es el endpoint de streaming MQTT,
// no de REST/HTTP. El Data API (histórico/snapshots vía HTTP) vive en
// api.webull.com, el mismo host que se usa para auth/token.
const BASE_URL =
  process.env.WEBULL_MARKET_DATA_URL || "https://api.webull.com";

function createHeaders({
  path,
  queryParams,
  accessToken,
}: {
  path: string;
  queryParams: Record<string, string>;
  accessToken: string;
}) {
  if (!APP_KEY || !APP_SECRET) {
    throw new Error("Faltan WEBULL_APP_KEY o WEBULL_KEY_APP_SECRET");
  }

  const timestamp = generateTimestamp();
  const nonce = generateNonce();

  const signature = signWebullRequest({
    path,
    host: new URL(BASE_URL).host,
    appKey: APP_KEY,
    appSecret: APP_SECRET,
    timestamp,
    nonce,
    extraParams: queryParams,
  });

  return {
    Accept: "application/json",
    "x-app-key": APP_KEY,
    "x-access-token": accessToken,
    "x-timestamp": timestamp,
    "x-signature-version": "1.0",
    "x-signature-algorithm": "HMAC-SHA256",
    "x-signature-nonce": nonce,
    "x-version": "v2",
    "x-signature": signature,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;

    const symbol =
      searchParams.get("ticker")?.toUpperCase().trim() ||
      searchParams.get("symbol")?.toUpperCase().trim() ||
      "AAPL";

    const count = searchParams.get("count") || "10";
    const timespan = searchParams.get("timespan") || "D";

    const auth = await getWebullAccessToken();

    if (auth.status !== "NORMAL") {
      return NextResponse.json(
        {
          success: false,
          error: `Token Webull no está NORMAL: ${auth.status}`,
          requires2FA: auth.requires2FA,
        },
        { status: 401 }
      );
    }

    const path = "/openapi/market-data/stock/bars";

    const queryParams: Record<string, string> = {
      symbol,
      category: "US_STOCK",
      timespan,
      count,
      real_time_required: "false",
    };

    const queryString = new URLSearchParams(queryParams).toString();
    const url = `${BASE_URL}${path}?${queryString}`;

    const headers = createHeaders({
      path,
      queryParams,
      accessToken: auth.token,
    });

    console.log(`📊 Webull Market Data: ${symbol}`);

    const response = await fetch(url, {
      method: "GET",
      headers,
      cache: "no-store",
    });

    const text = await response.text();
    let data: unknown;

    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    if (!response.ok) {
      console.error(
        `❌ Webull Market Data ${symbol}:`,
        response.status,
        data
      );

      return NextResponse.json(
        {
          success: false,
          symbol,
          httpStatus: response.status,
          data,
        },
        { status: response.status }
      );
    }

    return NextResponse.json({
      success: true,
      symbol,
      count: parseInt(count, 10),
      data,
    });
  } catch (error) {
    // Imprime el objeto de error completo y su causa en la consola de Next.js
    console.error("❌ Error detallado en API Webull:", error);

    const fetchError = error as Error & { cause?: unknown };

    return NextResponse.json(
      {
        success: false,
        error: fetchError.message,
        cause: fetchError.cause ? String(fetchError.cause) : undefined,
      },
      { status: 500 }
    );
  }
}