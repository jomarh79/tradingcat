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

const FETCH_TIMEOUT_MS = 10_000;
// Los estados financieros cambian una vez por trimestre: se reutilizan horas, no segundos
const TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ENTRIES = 80;

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

interface ForecastEntry {
  fiscal_year: number;
  fiscal_period: number;
  actual: string | null;
  est: string | null;
  reported: boolean;
}

class WebullError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// Una sola llamada firmada para todos los endpoints de esta ruta
async function webullGet(path: string, params: Record<string, string>, accessToken: string): Promise<any> {
  const timestamp = generateTimestamp();
  const nonce = generateNonce();

  const signature = signWebullRequest({
    path,
    host: WEBULL_HOST,
    appKey: WEBULL_APP_KEY!,
    appSecret: WEBULL_APP_SECRET!,
    timestamp,
    nonce,
    extraParams: params,
  });

  const res = await fetch(`${WEBULL_MARKET_URL}${path}?${new URLSearchParams(params)}`, {
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
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 200); // sin volcar respuestas enormes al cliente
    throw new WebullError(`Webull ${path} ${res.status}: ${text}`, res.status === 429 ? 429 : 502);
  }
  return res.json();
}

async function fetchIncomeStatements(
  symbol: string,
  type: "ANNUAL" | "QUARTERLY",
  count: number,
  accessToken: string
): Promise<RawIncomeEntry[]> {
  const data = await webullGet(
    "/market-data/fundamentals/income-statements/get",
    { symbol, category: "US_STOCK", type, count: String(count) },
    accessToken
  );
  return Array.isArray(data) ? data : [];
}

async function fetchForecastEps(symbol: string, accessToken: string): Promise<ForecastEntry[]> {
  try {
    const data = await webullGet("/market-data/fundamentals/forecast-eps/get", { symbol, category: "US_STOCK" }, accessToken);
    return Array.isArray(data) ? data : [];
  } catch {
    return []; // sin forecast no debe romper el resto (ej. ETFs)
  }
}

function num(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
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

type Parsed = ReturnType<typeof parseEntry>;

// Posición absoluta del trimestre (Q1..Q4) para comparar y ordenar: dos trimestres son consecutivos si difieren en 1
const quarterIndex = (year: number, period: number) => Number(year) * 4 + (Number(period) - 1);
const isQuarter = (period: number) => Number(period) >= 1 && Number(period) <= 4;

// ── TTM — suma de los últimos 4 trimestres consecutivos (flujo) + shares del trimestre más reciente ──
// Si faltan trimestres, o un campo no tiene dato en alguno de ellos, ese campo queda en null:
// antes se sumaba como 0 y un EPS faltante aparecía como "EPS TTM = 0".
function buildTtm(rawQuarterly: RawIncomeEntry[]): Parsed | null {
  const quarters = rawQuarterly
    .map(parseEntry)
    .filter((q) => isQuarter(q.fiscalPeriod))
    .sort((a, b) => quarterIndex(b.fiscalYear, b.fiscalPeriod) - quarterIndex(a.fiscalYear, a.fiscalPeriod));

  const last4 = quarters.slice(0, 4);
  if (last4.length < 4) return null;
  for (let i = 1; i < 4; i++) {
    const prev = quarterIndex(last4[i - 1].fiscalYear, last4[i - 1].fiscalPeriod);
    const cur = quarterIndex(last4[i].fiscalYear, last4[i].fiscalPeriod);
    if (prev - cur !== 1) return null; // hay un hueco: la suma no sería un año real
  }

  const sum = (key: keyof Parsed): number | null => {
    let acc = 0;
    for (const q of last4) {
      const v = q[key];
      if (typeof v !== "number") return null;
      acc += v;
    }
    return acc;
  };

  const latest = last4[0];
  return {
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

// ── Forward EPS — suma de los PRÓXIMOS 4 TRIMESTRES consecutivos (no por año fiscal calendario) ──
// Webull solo regresa ~5 trimestres en total, casi nunca 4 completos dentro de un mismo año fiscal,
// así que agrupar por año daba sumas parciales (1-2 trimestres) disfrazadas de "EPS anual".
// Solo se reporta con 4 trimestres consecutivos y con estimado: una suma parcial es peor que no mostrar nada.
function buildForwardEps(forecast: ForecastEntry[]) {
  const next4 = forecast
    .filter((f) => f.actual == null && f.est != null && isQuarter(f.fiscal_period)) // sin resultado real todavía = a futuro
    .sort((a, b) => quarterIndex(a.fiscal_year, a.fiscal_period) - quarterIndex(b.fiscal_year, b.fiscal_period))
    .slice(0, 4);

  if (next4.length !== 4) return null;
  for (let i = 1; i < 4; i++) {
    const prev = quarterIndex(next4[i - 1].fiscal_year, next4[i - 1].fiscal_period);
    const cur = quarterIndex(next4[i].fiscal_year, next4[i].fiscal_period);
    if (cur - prev !== 1) return null; // un trimestre sin estimado en medio
  }

  const epsValues = next4.map((f) => num(f.est)).filter((v): v is number => v != null);
  if (epsValues.length !== 4) return null;

  return {
    fiscalYear: next4[3].fiscal_year,
    eps: epsValues.reduce((a, b) => a + b, 0),
    quartersCovered: 4,
  };
}

// ── Caché con deduplicación de peticiones en vuelo ──
type Result = { status: number; body: any };
const cache = new Map<string, { expires: number; data: Result }>();
const inflight = new Map<string, Promise<Result>>();

async function load(symbol: string): Promise<Result> {
  const auth = await getWebullAccessToken();
  if (auth.status !== "NORMAL") {
    return {
      status: 401,
      body: { success: false, error: `Token Webull no está listo (status: ${auth.status})`, requires2FA: auth.requires2FA },
    };
  }

  const [rawAnnual, rawQuarterly, forecast] = await Promise.all([
    fetchIncomeStatements(symbol, "ANNUAL", 10, auth.token),
    fetchIncomeStatements(symbol, "QUARTERLY", 4, auth.token),
    fetchForecastEps(symbol, auth.token),
  ]);

  if (!rawAnnual.length) {
    return { status: 502, body: { success: false, symbol, error: "Sin datos de income statement para este símbolo" } };
  }

  // Ascendente por año — más viejo primero
  const annual = rawAnnual.map(parseEntry).sort((a, b) => a.fiscalYear - b.fiscalYear);

  return {
    status: 200,
    body: {
      success: true,
      symbol,
      annual,
      ttm: buildTtm(rawQuarterly),
      forwardEps: buildForwardEps(forecast),
    },
  };
}

export async function GET(request: NextRequest) {
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
            // Solo se guardan respuestas buenas: un error o un token sin listo no se queda pegado en caché
            if (r.status === 200) {
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
    const status = err instanceof WebullError ? err.status : 500;
    return NextResponse.json({ success: false, error: err?.message ?? String(err) }, { status });
  }
}