import { NextRequest, NextResponse } from "next/server";
import { getWebullAccessToken } from "@/lib/webull-auth";
import { generateNonce, generateTimestamp, signWebullRequest } from "@/lib/webull-signature";

export const dynamic = "force-dynamic";

const WEBULL_APP_KEY = process.env.WEBULL_APP_KEY;
const WEBULL_APP_SECRET = process.env.WEBULL_KEY_APP_SECRET;
const WEBULL_MARKET_URL = process.env.WEBULL_MARKET_DATA_URL || "https://api.webull.com";

// ── Diccionario local para industrias frecuentes (Evita llamadas API extras) ──
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
  "Basic Materials": "Materiales Básicos"
};

// ── Función para traducir texto usando la API gratuita de Google Translate ──
async function translateText(text: string): Promise<string> {
  if (!text || text.trim() === "") return text;
  try {
    const res = await fetch(
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=es&dt=t&q=${encodeURIComponent(text)}`,
      { cache: "no-store" }
    );
    if (!res.ok) return text;
    const data = await res.json();
    if (Array.isArray(data) && Array.isArray(data[0])) {
      return data[0].map((item: any) => item[0]).join("");
    }
    return text;
  } catch {
    return text; // Si falla, devuelve el texto original en inglés
  }
}

// ── Traducir lista de industrias ──
async function translateIndustries(industries: string[]): Promise<string[]> {
  return Promise.all(
    industries.map(async (ind) => {
      if (INDUSTRY_DICTIONARY[ind]) return INDUSTRY_DICTIONARY[ind];
      return await translateText(ind);
    })
  );
}

async function webullGet(path: string, params: Record<string, string>, accessToken: string) {
  const timestamp = generateTimestamp();
  const nonce = generateNonce();

  const signature = signWebullRequest({
    path,
    host: new URL(WEBULL_MARKET_URL).host,
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
  });

  if (!res.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

interface WebullBar {
  time: string;
  close: string;
}

async function fetchDailyBars(symbol: string, accessToken: string): Promise<{ ms: number; close: number }[]> {
  const data = await webullGet(
    "/openapi/market-data/stock/bars",
    { symbol, category: "US_STOCK", timespan: "D", count: "1200", real_time_required: "false" },
    accessToken
  );
  if (!Array.isArray(data)) return [];
  return (data as WebullBar[])
    .map((b) => ({ ms: new Date(b.time).getTime(), close: parseFloat(b.close) }))
    .filter((b) => !isNaN(b.ms) && !isNaN(b.close) && b.close > 0)
    .sort((a, b) => a.ms - b.ms);
}

function findClosestClose(bars: { ms: number; close: number }[], targetMs: number, toleranceDays = 10): number | null {
  if (!bars.length) return null;
  let best: { ms: number; close: number } | null = null;
  let bestDiff = Infinity;
  for (const b of bars) {
    const diff = Math.abs(b.ms - targetMs);
    if (diff < bestDiff) { bestDiff = diff; best = b; }
  }
  if (!best || bestDiff > toleranceDays * 86400000) return null;
  return best.close;
}

function computeReturn(bars: { ms: number; close: number }[], daysBack: number): number | null {
  if (!bars.length) return null;
  const latest = bars[bars.length - 1].close;
  const targetMs = Date.now() - daysBack * 86400000;
  const past = findClosestClose(bars, targetMs);
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

    const [profileRaw, earningsRaw, dividendRaw, targetRaw, stockBars, spyBars] = await Promise.all([
      webullGet("/market-data/fundamentals/company-profiles/get", { symbol, category: "US_STOCK" }, auth.token),
      webullGet("/market-data/fundamentals/earnings-calendars/list", { symbol, category: "US_STOCK" }, auth.token),
      webullGet("/market-data/fundamentals/dividend-calendars/list", { symbol, category: "US_STOCK" }, auth.token),
      webullGet("/market-data/fundamentals/analysis/target-prices/get", { symbol, category: "US_STOCK" }, auth.token),
      fetchDailyBars(symbol, auth.token),
      fetchDailyBars("SPY", auth.token),
    ]);

    // ── Perfil de empresa (Traducido al español) ──
    let profile = null;
    if (profileRaw) {
      const translatedDescription = profileRaw.profile
        ? await translateText(profileRaw.profile)
        : null;

      const rawIndustries = Array.isArray(profileRaw.industries) ? profileRaw.industries : [];
      const translatedIndustries = await translateIndustries(rawIndustries);

      profile = {
        companyName: profileRaw.company_name ?? null,
        establishDate: profileRaw.establish_date ?? null,
        exchange: profileRaw.exhibition_code ?? null,
        description: translatedDescription,
        employees: profileRaw.employees ? parseInt(profileRaw.employees, 10) : null,
        address: profileRaw.address ?? null,
        ceo: profileRaw.ceo ?? null,
        industries: translatedIndustries,
      };
    }

    // ── Próximo earnings ──
    let nextEarnings: any = null;
    if (Array.isArray(earningsRaw) && earningsRaw.length > 0) {
      const now = Date.now();
      const upcoming = earningsRaw
        .filter((e: any) => e.expected_publish_date && new Date(e.expected_publish_date).getTime() >= now - 86400000)
        .sort((a: any, b: any) => new Date(a.expected_publish_date).getTime() - new Date(b.expected_publish_date).getTime());
      const pick = upcoming[0] || earningsRaw[earningsRaw.length - 1];
      if (pick) {
        nextEarnings = {
          fiscalYear: pick.fiscal_year,
          fiscalPeriod: pick.fiscal_period,
          expectedDate: pick.expected_publish_date,
          epsEst: pick.eps_est != null ? parseFloat(pick.eps_est) : null,
          revEst: pick.rev_est != null ? parseFloat(pick.rev_est) : null,
        };
      }
    }

    // ── Próximo dividendo ──
    let nextDividend: any = null;
    if (Array.isArray(dividendRaw) && dividendRaw.length > 0) {
      const now = Date.now();
      const upcoming = dividendRaw
        .filter((d: any) => d.ex_div_date && new Date(d.ex_div_date).getTime() >= now - 86400000)
        .sort((a: any, b: any) => new Date(a.ex_div_date).getTime() - new Date(b.ex_div_date).getTime());
      const pick = upcoming[0] || dividendRaw[dividendRaw.length - 1];
      if (pick) {
        nextDividend = {
          amount: pick.amount != null ? parseFloat(pick.amount) : null,
          exDivDate: pick.ex_div_date,
          payDate: pick.pay_date,
        };
      }
    }

    // ── Target de analistas ──
    const analystTarget = targetRaw
      ? {
          mean: targetRaw.mean != null ? parseFloat(targetRaw.mean) : null,
          low: targetRaw.low != null ? parseFloat(targetRaw.low) : null,
          high: targetRaw.high != null ? parseFloat(targetRaw.high) : null,
          median: targetRaw.median != null ? parseFloat(targetRaw.median) : null,
        }
      : null;

    // ── Rendimiento vs S&P 500 ──
    const periods = PERIODS.map((p) => {
      const stockReturn = computeReturn(stockBars, p.days);
      const spyReturn = computeReturn(spyBars, p.days);
      const alpha = stockReturn != null && spyReturn != null ? stockReturn - spyReturn : null;
      return { label: p.label, stockReturn, spyReturn, alpha };
    });

    const dataCoverageYears = stockBars.length
      ? (Date.now() - stockBars[0].ms) / (365 * 86400000)
      : 0;

    return NextResponse.json({
      success: true,
      symbol,
      profile,
      nextEarnings,
      nextDividend,
      analystTarget,
      performance: { periods, dataCoverageYears },
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message ?? String(err) }, { status: 500 });
  }
}