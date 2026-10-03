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

// 5 años ≈ 1258 sesiones; con 1200 velas el periodo "5 años" nunca encontraba su fecha de referencia.
const BAR_COUNT = 1300;
const FETCH_TIMEOUT_MS = 10_000;
const TRANSLATE_TIMEOUT_MS = 6_000;

const TTL_RESPONSE_MS = 10 * 60 * 1000; // respuesta completa por símbolo
const TTL_BARS_MS = 30 * 60 * 1000;     // velas diarias (SPY se comparte entre todos los símbolos)
const MAX_ENTRIES = 40;

const num = (v: any): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

// ── Caché en memoria con TTL + deduplicación de peticiones en vuelo ──
type Entry<T> = { expires: number; data: T };

async function memo<T>(
  store: Map<string, Entry<T>>,
  inflight: Map<string, Promise<T>>,
  key: string,
  ttl: number,
  loader: () => Promise<T>,
  shouldCache: (data: T) => boolean
): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.data;

  const pending = inflight.get(key);
  if (pending) return pending;

  const p = loader()
    .then((data) => {
      if (shouldCache(data)) {
        store.set(key, { expires: Date.now() + ttl, data });
        while (store.size > MAX_ENTRIES) store.delete(store.keys().next().value as string);
      }
      return data;
    })
    .finally(() => inflight.delete(key));

  inflight.set(key, p);
  return p;
}

// ── Diccionario local para industrias frecuentes (evita llamadas extra) ──
const INDUSTRY_DICTIONARY: Record<string, string> = {
  "Technology": "Tecnología",
  "Software - Infrastructure": "Software - Infraestructura",
  "Software - Application": "Software - Aplicaciones",
  "Semiconductors": "Semiconductores",
  "Consumer Electronics": "Electrónica de Consumo",
  "Healthcare": "Salud",
  "Biotechnology": "Biotecnología",
  "Drug Manufacturers - General": "Fabricantes de Medicamentos",
  "Financial Services": "Servicios Financieros",
  "Credit Services": "Servicios de Crédito",
  "Banks - Diversified": "Bancos Diversificados",
  "Consumer Cyclical": "Consumo Cíclico",
  "Internet Retail": "Comercio Electrónico",
  "Auto Manufacturers": "Fabricantes de Automóviles",
  "Industrials": "Industrial",
  "Communication Services": "Servicios de Comunicación",
  "Energy": "Energía",
  "Utilities": "Servicios Públicos",
  "Real Estate": "Bienes Raíces",
  "Basic Materials": "Materiales Básicos",
};

// ── Traducción (endpoint gratuito de Google, no oficial: si falla se devuelve el inglés) ──
async function translateChunk(text: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=es&dt=t&q=${encodeURIComponent(text)}`,
      { cache: "no-store", signal: AbortSignal.timeout(TRANSLATE_TIMEOUT_MS) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data) && Array.isArray(data[0])) {
      return data[0].map((item: any) => item?.[0] ?? "").join("");
    }
    return null;
  } catch {
    return null;
  }
}

// La petición va por URL: un texto largo se corta en bloques por oraciones para no pasar el límite
function chunkText(text: string, max = 1500): string[] {
  const chunks: string[] = [];
  let cur = "";
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    for (let i = 0; i < sentence.length; i += max) {
      const piece = sentence.slice(i, i + max);
      if (cur && cur.length + 1 + piece.length > max) {
        chunks.push(cur);
        cur = piece;
      } else {
        cur = cur ? `${cur} ${piece}` : piece;
      }
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

async function translateText(text: string): Promise<string> {
  if (!text || !text.trim()) return text;
  const parts = await Promise.all(chunkText(text).map(translateChunk));
  // Si algún bloque falló, se deja todo en inglés antes que mezclar idiomas
  return parts.every((p) => p != null) ? (parts as string[]).join(" ") : text;
}

const translateIndustries = (industries: string[]) =>
  Promise.all(industries.map((ind) => INDUSTRY_DICTIONARY[ind] ?? translateText(ind)));

// ── Webull ──
async function webullGet(path: string, params: Record<string, string>, accessToken: string) {
  try {
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

    const qs = new URLSearchParams(params).toString();

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
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.warn(`[position-detail] ${path} -> HTTP ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err: any) {
    console.warn(`[position-detail] ${path} falló:`, err?.message ?? err);
    return null;
  }
}

interface WebullBar {
  time: string;
  close: string;
}
type Bar = { ms: number; close: number };

const barsCache = new Map<string, Entry<Bar[]>>();
const barsInflight = new Map<string, Promise<Bar[]>>();

function fetchDailyBars(symbol: string, accessToken: string): Promise<Bar[]> {
  return memo(
    barsCache,
    barsInflight,
    symbol,
    TTL_BARS_MS,
    async () => {
      const data = await webullGet(
        "/openapi/market-data/stock/bars",
        { symbol, category: "US_STOCK", timespan: "D", count: String(BAR_COUNT), real_time_required: "false" },
        accessToken
      );
      if (!Array.isArray(data)) return [];
      return (data as WebullBar[])
        .map((b) => ({ ms: new Date(b.time).getTime(), close: parseFloat(b.close) }))
        .filter((b) => !isNaN(b.ms) && !isNaN(b.close) && b.close > 0)
        .sort((a, b) => a.ms - b.ms);
    },
    (bars) => bars.length > 0 // una respuesta vacía no se queda pegada en caché
  );
}

// Búsqueda binaria de la vela más cercana a la fecha objetivo (las velas vienen ordenadas)
function findClosestClose(bars: Bar[], targetMs: number, toleranceDays = 10): number | null {
  if (!bars.length) return null;
  let lo = 0;
  let hi = bars.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].ms < targetMs) lo = mid + 1;
    else hi = mid;
  }
  let best = bars[lo];
  if (lo > 0 && Math.abs(bars[lo - 1].ms - targetMs) <= Math.abs(best.ms - targetMs)) best = bars[lo - 1];
  return Math.abs(best.ms - targetMs) > toleranceDays * 86400000 ? null : best.close;
}

function computeReturn(bars: Bar[], daysBack: number): number | null {
  if (!bars.length) return null;
  const latest = bars[bars.length - 1].close;
  const past = findClosestClose(bars, Date.now() - daysBack * 86400000);
  if (past == null || past === 0) return null;
  return ((latest - past) / past) * 100;
}

const PERIODS = [
  { label: "1 mes", days: 30 },
  { label: "3 meses", days: 91 },
  { label: "6 meses", days: 182 },
  { label: "1 año", days: 365 },
  { label: "5 años", days: 365 * 5 },
];

// ── Armado de cada sección ──
async function buildProfile(raw: any) {
  if (!raw) return null;
  const industries = Array.isArray(raw.industries) ? raw.industries : [];
  const [description, translatedIndustries] = await Promise.all([
    raw.profile ? translateText(raw.profile) : Promise.resolve(null),
    translateIndustries(industries),
  ]);
  const employees = raw.employees ? parseInt(raw.employees, 10) : NaN;

  return {
    companyName: raw.company_name ?? null,
    establishDate: raw.establish_date ?? null,
    exchange: raw.exhibition_code ?? null,
    description,
    employees: Number.isFinite(employees) ? employees : null,
    address: raw.address ?? null,
    ceo: raw.ceo ?? null,
    industries: translatedIndustries,
  };
}

// Próximo evento con fecha >= ayer; si no hay futuro, el más reciente (ya ordenado por fecha)
function pickUpcoming<T extends Record<string, any>>(rows: any, dateKey: string): { pick: T; upcoming: boolean } | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const dated = rows
    .map((r: any) => ({ r, t: new Date(r?.[dateKey]).getTime() }))
    .filter((x) => !isNaN(x.t))
    .sort((a, b) => a.t - b.t);
  if (!dated.length) return null;

  const cutoff = Date.now() - 86400000;
  const next = dated.find((x) => x.t >= cutoff);
  return next ? { pick: next.r, upcoming: true } : { pick: dated[dated.length - 1].r, upcoming: false };
}

type Result = { status: number; body: any };
const responseCache = new Map<string, Entry<Result>>();
const responseInflight = new Map<string, Promise<Result>>();

async function load(symbol: string): Promise<Result> {
  const auth = await getWebullAccessToken();
  if (auth.status !== "NORMAL") {
    return {
      status: 401,
      body: { success: false, error: `Token Webull no está listo (status: ${auth.status})`, requires2FA: auth.requires2FA },
    };
  }

  const [profile, earningsRaw, dividendRaw, targetRaw, stockBars, spyBars] = await Promise.all([
    // la traducción arranca en cuanto llega el perfil, sin esperar al resto
    webullGet("/market-data/fundamentals/company-profiles/get", { symbol, category: "US_STOCK" }, auth.token).then(buildProfile),
    webullGet("/market-data/fundamentals/earnings-calendars/list", { symbol, category: "US_STOCK" }, auth.token),
    webullGet("/market-data/fundamentals/dividend-calendars/list", { symbol, category: "US_STOCK" }, auth.token),
    webullGet("/market-data/fundamentals/analysis/target-prices/get", { symbol, category: "US_STOCK" }, auth.token),
    fetchDailyBars(symbol, auth.token),
    fetchDailyBars("SPY", auth.token),
  ]);

  // ── Próximo earnings ──
  let nextEarnings: any = null;
  const e = pickUpcoming<any>(earningsRaw, "expected_publish_date");
  if (e) {
    nextEarnings = {
      fiscalYear: e.pick.fiscal_year,
      fiscalPeriod: e.pick.fiscal_period,
      expectedDate: e.pick.expected_publish_date,
      epsEst: num(e.pick.eps_est),
      revEst: num(e.pick.rev_est),
      upcoming: e.upcoming, // false = es el último reporte conocido, no uno futuro
    };
  }

  // ── Próximo dividendo ──
  let nextDividend: any = null;
  const d = pickUpcoming<any>(dividendRaw, "ex_div_date");
  if (d) {
    nextDividend = {
      amount: num(d.pick.amount),
      exDivDate: d.pick.ex_div_date,
      payDate: d.pick.pay_date,
      upcoming: d.upcoming,
    };
  }

  // ── Target de analistas ──
  const analystTarget = targetRaw
    ? { mean: num(targetRaw.mean), low: num(targetRaw.low), high: num(targetRaw.high), median: num(targetRaw.median) }
    : null;

  // ── Rendimiento vs S&P 500 ──
  const periods = PERIODS.map((p) => {
    const stockReturn = computeReturn(stockBars, p.days);
    const spyReturn = computeReturn(spyBars, p.days);
    const alpha = stockReturn != null && spyReturn != null ? stockReturn - spyReturn : null;
    return { label: p.label, stockReturn, spyReturn, alpha };
  });

  const dataCoverageYears = stockBars.length ? (Date.now() - stockBars[0].ms) / (365 * 86400000) : 0;

  return {
    status: 200,
    body: {
      success: true,
      symbol,
      profile,
      nextEarnings,
      nextDividend,
      analystTarget,
      performance: { periods, dataCoverageYears },
    },
  };
}

// Solo se cachea si llegó algo útil: si Webull falló en todo, el siguiente intento vuelve a pedir
const hasUsefulData = (r: Result) =>
  r.status === 200 &&
  !!(r.body.profile || r.body.nextEarnings || r.body.nextDividend || r.body.analystTarget || r.body.performance.dataCoverageYears > 0);

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

    const { status, body } = await memo(responseCache, responseInflight, symbol, TTL_RESPONSE_MS, () => load(symbol), hasUsefulData);
    return NextResponse.json(body, { status });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message ?? String(err) }, { status: 500 });
  }
}