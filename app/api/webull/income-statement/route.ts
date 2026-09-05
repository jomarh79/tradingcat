import { NextRequest, NextResponse } from "next/server";
import { getWebullAccessToken } from "@/lib/webull-auth";
import { generateNonce, generateTimestamp, signWebullRequest } from "@/lib/webull-signature";

export const dynamic = "force-dynamic";

const WEBULL_APP_KEY = process.env.WEBULL_APP_KEY;
const WEBULL_APP_SECRET = process.env.WEBULL_KEY_APP_SECRET;
const WEBULL_MARKET_URL = process.env.WEBULL_MARKET_DATA_URL || "https://api.webull.com";

interface RawIncomeEntry {
  fiscal_year: number;
  fiscal_period: number; // 0 = FY, 1-4 = Q1-Q4
  end_date: string;
  currency: string;
  publish_date: string;
  total_revenue: string;
  revenue: string;
  cost_of_revenue: string;
  gross_profit: string;
  opex: string;
  sga_exp: string;
  rnd_exp: string;
  op_income: string;
  other_net_income: string;
  ebt: string;
  income_tax: string;
  net_income: string;
  diluted_avg_shares: string;
  diluted_eps_incl_extra: string;
  diluted_eps_excl_extra: string;
}

async function fetchIncomeStatements(
  symbol: string,
  type: "ANNUAL" | "QUARTERLY",
  count: number,
  accessToken: string
): Promise<RawIncomeEntry[]> {
  const path = "/market-data/fundamentals/income-statements/get";
  const queryParams: Record<string, string> = {
    symbol,
    category: "US_STOCK",
    type,
    count: String(count),
  };

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

  const qs = new URLSearchParams(queryParams).toString();

  const res = await fetch(`${WEBULL_MARKET_URL}${path}?${qs}`, {
    headers: {
      Accept: "application/json",
      "x-app-key": WEBULL_APP_KEY!,
      "x-access-token": accessToken,
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
    throw new Error(`Webull Income Statement (${type}) ${res.status}: ${text}`);
  }

  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

interface ForecastEntry {
  fiscal_year: number;
  fiscal_period: number;
  actual: string | null;
  est: string | null;
  reported: boolean;
}

async function fetchForecastEps(symbol: string, accessToken: string): Promise<ForecastEntry[]> {
  const path = "/market-data/fundamentals/forecast-eps/get";
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

  const qs = new URLSearchParams(queryParams).toString();

  const res = await fetch(`${WEBULL_MARKET_URL}${path}?${qs}`, {
    headers: {
      Accept: "application/json",
      "x-app-key": WEBULL_APP_KEY!,
      "x-access-token": accessToken,
      "x-timestamp": timestamp,
      "x-signature-version": "1.0",
      "x-signature-algorithm": "HMAC-SHA256",
      "x-signature-nonce": nonce,
      "x-version": "v2",
      "x-signature": signature,
    },
    cache: "no-store",
  });

  if (!res.ok) return []; // sin forecast no debe romper el resto (ej. ETFs)
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

function num(v: string | null | undefined): number | null {
  if (v == null) return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

// Convierte un RawIncomeEntry (strings) a números, listo para el frontend
function parseEntry(e: RawIncomeEntry) {
  return {
    fiscalYear: e.fiscal_year,
    fiscalPeriod: e.fiscal_period,
    endDate: e.end_date,
    currency: e.currency,
    revenue: num(e.revenue ?? e.total_revenue),
    costOfRevenue: num(e.cost_of_revenue),
    grossProfit: num(e.gross_profit),
    opex: num(e.opex),
    sgaExp: num(e.sga_exp),
    rndExp: num(e.rnd_exp),
    opIncome: num(e.op_income),
    otherNetIncome: num(e.other_net_income),
    ebt: num(e.ebt),
    incomeTax: num(e.income_tax),
    netIncome: num(e.net_income),
    dilutedAvgShares: num(e.diluted_avg_shares),
    dilutedEps: num(e.diluted_eps_incl_extra ?? e.diluted_eps_excl_extra),
  };
}

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

    const [rawAnnual, rawQuarterly, forecast] = await Promise.all([
      fetchIncomeStatements(symbol, "ANNUAL", 10, auth.token),
      fetchIncomeStatements(symbol, "QUARTERLY", 4, auth.token),
      fetchForecastEps(symbol, auth.token),
    ]);

    if (!rawAnnual.length) {
      return NextResponse.json({ success: false, symbol, error: "Sin datos de income statement para este símbolo" }, { status: 502 });
    }

    // Ascendente por año — más viejo primero
    const annual = rawAnnual
      .map(parseEntry)
      .sort((a, b) => a.fiscalYear - b.fiscalYear);

    // ── TTM — suma de los últimos 4 trimestres (flujo) + shares del trimestre más reciente ──
    let ttm: ReturnType<typeof parseEntry> | null = null;
    if (rawQuarterly.length > 0) {
      const parsedQ = rawQuarterly.map(parseEntry).sort((a, b) => b.fiscalYear * 10 - a.fiscalYear * 10 || b.fiscalPeriod - a.fiscalPeriod);
      const last4 = parsedQ.slice(0, 4);

      const sum = (key: keyof ReturnType<typeof parseEntry>) =>
        last4.reduce((acc, q) => {
          const v = q[key];
          return typeof v === "number" ? acc + v : acc;
        }, 0);

      const latest = parsedQ[0];

      ttm = {
        fiscalYear: latest.fiscalYear,
        fiscalPeriod: 0,
        endDate: latest.endDate,
        currency: latest.currency,
        revenue: sum("revenue"),
        costOfRevenue: sum("costOfRevenue"),
        grossProfit: sum("grossProfit"),
        opex: sum("opex"),
        sgaExp: sum("sgaExp"),
        rndExp: sum("rndExp"),
        opIncome: sum("opIncome"),
        otherNetIncome: sum("otherNetIncome"),
        ebt: sum("ebt"),
        incomeTax: sum("incomeTax"),
        netIncome: sum("netIncome"),
        dilutedAvgShares: latest.dilutedAvgShares, // no se suma — es un promedio, no un flujo
        dilutedEps: sum("dilutedEps"),
      };
    }

        // ── Forward EPS — suma de los PRÓXIMOS 4 TRIMESTRES consecutivos (no por año fiscal
    // calendario) — Webull solo regresa ~5 trimestres en total, casi nunca 4 completos
    // dentro de un mismo año fiscal, así que agrupar por año daba sumas parciales
    // (1-2 trimestres) disfrazadas de "EPS anual", muy por debajo del real.
    let forwardEps: { fiscalYear: number; eps: number; quartersCovered: number } | null = null;

    const future = forecast
      .filter((f) => f.actual == null && f.est != null) // sin resultado real todavía = a futuro
      .sort((a, b) => a.fiscal_year * 10 + a.fiscal_period - (b.fiscal_year * 10 + b.fiscal_period));

    const next4 = future.slice(0, 4);

    // Solo se reporta si hay 4 trimestres consecutivos reales — una suma parcial
    // (1-3 trimestres) es peor que no mostrar nada, porque parece un EPS anual y no lo es.
    if (next4.length === 4) {
      const epsValues = next4.map((f) => num(f.est)).filter((v): v is number => v != null);
      if (epsValues.length === 4) {
        forwardEps = {
          fiscalYear: next4[next4.length - 1].fiscal_year,
          eps: epsValues.reduce((a, b) => a + b, 0),
          quartersCovered: 4,
        };
      }
    }

    return NextResponse.json({
      success: true,
      symbol,
      annual,
      ttm,
      forwardEps,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message ?? String(err) }, { status: 500 });
  }
}