import { NextResponse } from "next/server";
import crypto from "crypto";
import { getWebullAccessToken } from "@/lib/webull-auth";

export const dynamic = "force-dynamic";

const APP_KEY = process.env.WEBULL_APP_KEY;
const APP_SECRET = process.env.WEBULL_KEY_APP_SECRET;
const BASE_URL =
  process.env.WEBULL_API_URL || "https://api.webull.com";

function generateNonce(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

function generateTimestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Genera la firma Webull.
 *
 * IMPORTANTE:
 * Webull exige incluir en la firma:
 *
 * - path
 * - query parameters
 * - headers de firma
 * - MD5 del body si existe
 *
 * x-access-token NO participa en la firma.
 * x-signature tampoco.
 * x-version tampoco.
 */
function createSignature({
  path,
  queryParams,
  timestamp,
  nonce,
  body = "",
}: {
  path: string;
  queryParams: Record<string, string>;
  timestamp: string;
  nonce: string;
  body?: string;
}): string {
  if (!APP_KEY || !APP_SECRET) {
    throw new Error(
      "Faltan WEBULL_APP_KEY o WEBULL_KEY_APP_SECRET"
    );
  }

  const host = new URL(BASE_URL).host;

  /**
   * Unimos:
   *
   * query params
   * +
   * headers que participan en la firma
   */
  const params: Record<string, string> = {
    ...queryParams,

    host,

    "x-app-key": APP_KEY,
    "x-signature-algorithm": "HMAC-SHA1",
    "x-signature-nonce": nonce,
    "x-signature-version": "1.0",
    "x-timestamp": timestamp,
  };

  /**
   * Orden alfabético de TODOS los parámetros.
   */
  const sortedKeys = Object.keys(params).sort();

  const queryString = sortedKeys
    .map((key) => `${key}=${params[key]}`)
    .join("&");

  /**
   * Construimos str3.
   */
  let signString = `${path}&${queryString}`;

  /**
   * Para GET no hay body.
   *
   * Si en el futuro utilizamos POST con JSON,
   * aquí se agregará el MD5 del body.
   */
  if (body) {
    const bodyMd5 = crypto
      .createHash("md5")
      .update(body, "utf8")
      .digest("hex")
      .toUpperCase();

    signString += `&${bodyMd5}`;
  }

  /**
   * Webull indica que el URL encoding se aplica
   * al string completo.
   */
  const encoded = encodeURIComponent(signString);

  /**
   * App Secret + "&"
   */
  const signingKey = `${APP_SECRET}&`;

  /**
   * HMAC-SHA1 + Base64
   */
  return crypto
    .createHmac("sha1", signingKey)
    .update(encoded, "utf8")
    .digest("base64");
}

function createHeaders({
  path,
  queryParams,
  accessToken,
}: {
  path: string;
  queryParams: Record<string, string>;
  accessToken: string;
}) {
  const timestamp = generateTimestamp();
  const nonce = generateNonce();

  const signature = createSignature({
    path,
    queryParams,
    timestamp,
    nonce,
  });

  return {
    Accept: "application/json",

    "x-app-key": APP_KEY!,
    "x-access-token": accessToken,

    "x-timestamp": timestamp,
    "x-signature-version": "1.0",
    "x-signature-algorithm": "HMAC-SHA1",
    "x-signature-nonce": nonce,

    "x-version": "v2",

    "x-signature": signature,
  };
}

export async function GET(request: Request) {
  try {
    /**
     * ------------------------------------------------------------
     * 1. Obtener símbolo
     * ------------------------------------------------------------
     */

    const { searchParams } = new URL(request.url);

    const symbol =
      searchParams.get("ticker")?.toUpperCase().trim() ||
      searchParams.get("symbol")?.toUpperCase().trim() ||
      "AAPL";

    /**
     * ------------------------------------------------------------
     * 2. Obtener token Webull
     * ------------------------------------------------------------
     */

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

    /**
     * ------------------------------------------------------------
     * 3. Endpoint Webull
     * ------------------------------------------------------------
     */

    const path =
      "/openapi/market-data/stock/bars";

    /**
     * Parámetros EXACTOS de la petición.
     *
     * Estos mismos parámetros deben:
     *
     * 1. enviarse en la URL
     * 2. incluirse en la firma
     */
    const queryParams: Record<string, string> = {
      symbol,
      category: "US_STOCK",
      timespan: "D",
      count: "10",
      real_time_required: "false",
    };

    /**
     * ------------------------------------------------------------
     * 4. Construir URL
     * ------------------------------------------------------------
     */

    const queryString = new URLSearchParams(
      queryParams
    ).toString();

    const url =
      `${BASE_URL}${path}?${queryString}`;

    /**
     * ------------------------------------------------------------
     * 5. Headers firmados
     * ------------------------------------------------------------
     */

    const headers = createHeaders({
      path,
      queryParams,
      accessToken: auth.token,
    });

    console.log(
      `📊 Webull Market Data: ${symbol}`
    );

    /**
     * ------------------------------------------------------------
     * 6. Petición
     * ------------------------------------------------------------
     */

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

    /**
     * ------------------------------------------------------------
     * 7. Error Webull
     * ------------------------------------------------------------
     */

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
        {
          status: response.status,
        }
      );
    }

    /**
     * ------------------------------------------------------------
     * 8. Éxito
     * ------------------------------------------------------------
     */

    return NextResponse.json({
      success: true,
      symbol,
      count: 10,
      data,
    });

  } catch (error) {
    console.error(
      "❌ Webull Market Data error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Error desconocido",
      },
      { status: 500 }
    );
  }
}