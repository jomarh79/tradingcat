import { NextResponse } from 'next/server'

// GET /api/fundamentals?symbol=AAPL
// Trae P/E, P/S, Payout Ratio y Dividend Yield desde Finnhub (plan gratuito) — valores actuales (TTM),
// más el promedio de esos mismos ratios entre las empresas comparables de su sector (peers).
// También trae el historial propio (últimos 5 años de 10-K) incluyendo flujo de caja operativo y
// capital contable, usado en el chart page para construir las series diarias de P/E, P/S, P/CF y P/B.

function extractRatios(m: Record<string, any>) {
  const payoutDirect = m.payoutRatioTTM ?? m.payoutRatio ?? m.payoutRatioAnnual ?? null
  let payoutRatio: number | null = typeof payoutDirect === 'number' ? payoutDirect : null
  if (payoutRatio == null && typeof m.dividendPerShareAnnual === 'number' && typeof m.epsTTM === 'number' && m.epsTTM > 0) {
    payoutRatio = (m.dividendPerShareAnnual / m.epsTTM) * 100
  }
  const dividendYield = m.currentDividendYieldTTM ?? m.dividendYieldIndicatedAnnual ?? null

  return {
    pe: typeof m.peTTM === 'number' ? m.peTTM : null,
    ps: typeof m.psTTM === 'number' ? m.psTTM : null,
    pcf: typeof m.pfcfTTM === 'number' ? m.pfcfTTM : null,
    pb: typeof m.pb === 'number' ? m.pb : null,
    payoutRatio,
    dividendYield: typeof dividendYield === 'number' ? dividendYield : null,
  }
}

async function fetchMetric(symbol: string, apiKey: string) {
  const res = await fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${apiKey}`, { cache: 'no-store' })
  const data = await res.json()
  return data?.metric && Object.keys(data.metric).length > 0 ? data.metric : null
}

// Nombres XBRL alternativos — varían de empresa a empresa, se prueban en orden hasta encontrar uno
const CONCEPT_CANDIDATES = {
  eps: ['us-gaap_EarningsPerShareDiluted', 'us-gaap_EarningsPerShareBasicAndDiluted', 'us-gaap_EarningsPerShareBasic'],
  revenue: [
    'us-gaap_RevenueFromContractWithCustomerExcludingAssessedTax',
    'us-gaap_RevenueFromContractWithCustomerIncludingAssessedTax',
    'us-gaap_Revenues',
    'us-gaap_SalesRevenueNet',
  ],
  shares: [
    'us-gaap_WeightedAverageNumberOfDilutedSharesOutstanding',
    'us-gaap_WeightedAverageNumberOfShareOutstandingBasicAndDiluted',
    'us-gaap_WeightedAverageNumberOfSharesOutstandingBasic',
  ],
  dividendPerShare: ['us-gaap_CommonStockDividendsPerShareDeclared', 'us-gaap_CommonStockDividendsPerShareCashPaid'],
  operatingCashFlow: [
    'us-gaap_NetCashProvidedByUsedInOperatingActivities',
    'us-gaap_NetCashProvidedByUsedInOperatingActivitiesContinuingOperations',
  ],
  stockholdersEquity: [
    'us-gaap_StockholdersEquity',
    'us-gaap_StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
  ],
}

function findConcept(report: any, candidates: string[]): number | null {
  const sections = ['ic', 'bs', 'cf'] // income statement, balance sheet, cash flow
  for (const candidate of candidates) {
    for (const section of sections) {
      const items = report?.[section]
      if (!Array.isArray(items)) continue
      const hit = items.find((it: any) => it.concept === candidate)
      if (hit && typeof hit.value === 'number') return hit.value
    }
  }
  return null
}

async function fetchOwnHistory(symbol: string, apiKey: string) {
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/financials-reported?symbol=${encodeURIComponent(symbol)}&freq=annual&token=${apiKey}`,
      { cache: 'no-store' }
    )
    const data = await res.json()
    const reports: any[] = Array.isArray(data?.data) ? data.data : []

    // Solo 10-K, un reporte por año (el más reciente si hay duplicados/enmiendas), últimos 5 años
    const byYear = new Map<number, any>()
    reports
      .filter(r => r.form === '10-K' && r.year)
      .forEach(r => {
        const existing = byYear.get(r.year)
        if (!existing || new Date(r.filedDate) > new Date(existing.filedDate)) byYear.set(r.year, r)
      })

    const lastFive = Array.from(byYear.values())
      .sort((a, b) => b.year - a.year)
      .slice(0, 5)

    return lastFive.map(r => ({
      year: r.year,
      endDate: r.endDate,
      // Fecha real de presentación ante la SEC — el mercado no "sabe" el número hasta este día,
      // no hasta el cierre del año fiscal (endDate). Se usa para las series diarias de ratios.
      filedDate: r.filedDate ?? null,
      eps: findConcept(r.report, CONCEPT_CANDIDATES.eps),
      revenue: findConcept(r.report, CONCEPT_CANDIDATES.revenue),
      sharesOutstanding: findConcept(r.report, CONCEPT_CANDIDATES.shares),
      dividendPerShare: findConcept(r.report, CONCEPT_CANDIDATES.dividendPerShare),
      operatingCashFlow: findConcept(r.report, CONCEPT_CANDIDATES.operatingCashFlow),
      stockholdersEquity: findConcept(r.report, CONCEPT_CANDIDATES.stockholdersEquity),
    }))
  } catch {
    return [] // ETFs y algunos extranjeros no presentan 10-K — se queda vacío, no rompe el resto
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const symbol = searchParams.get('symbol')?.trim().toUpperCase()

  if (!symbol) {
    return NextResponse.json({ error: 'Falta el parámetro symbol' }, { status: 400 })
  }

  const apiKey = process.env.NEXT_PUBLIC_FINNHUB_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Falta la variable de entorno NEXT_PUBLIC_FINNHUB_KEY en este proyecto' }, { status: 500 })
  }

  try {
    const ownMetric = await fetchMetric(symbol, apiKey)
    if (!ownMetric) {
      return NextResponse.json({ error: `Sin datos fundamentales para ${symbol}` }, { status: 502 })
    }
    const own = extractRatios(ownMetric)

    // ── Comparación contra sector (peers) ──
    let sectorAvg: ReturnType<typeof extractRatios> | null = null
    let peerCount = 0
    try {
      const peersRes = await fetch(`https://finnhub.io/api/v1/stock/peers?symbol=${encodeURIComponent(symbol)}&grouping=sector&token=${apiKey}`, { cache: 'no-store' })
      const peersList = await peersRes.json()
      const peers: string[] = (Array.isArray(peersList) ? peersList : [])
        .filter((p: string) => p && p.toUpperCase() !== symbol)
        .slice(0, 6)

      const peerRatiosList: ReturnType<typeof extractRatios>[] = []
      for (const peer of peers) {
        const pm = await fetchMetric(peer, apiKey)
        if (pm) peerRatiosList.push(extractRatios(pm))
      }
      peerCount = peerRatiosList.length

      if (peerCount > 0) {
        const avgOf = (key: keyof ReturnType<typeof extractRatios>) => {
          const vals = peerRatiosList.map(p => p[key]).filter((v): v is number => typeof v === 'number')
          return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null
        }
        sectorAvg = { pe: avgOf('pe'), ps: avgOf('ps'), pcf: avgOf('pcf'), pb: avgOf('pb'), payoutRatio: avgOf('payoutRatio'), dividendYield: avgOf('dividendYield') }
      }
    } catch {
      // si falla el sector, seguimos devolviendo al menos los valores propios
    }

        // Nombre real de la empresa (Finnhub Company Profile)
    let companyName: string | null = null
    try {
      const profileRes = await fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`, { cache: 'no-store' })
      const profile = await profileRes.json()
      companyName = typeof profile?.name === 'string' && profile.name.trim() ? profile.name.trim() : null
    } catch {
      // sin nombre no rompe el resto — se queda null
    }

        return NextResponse.json({ symbol, ...own, sectorAvg, peerCount, companyName, ownHistory: await fetchOwnHistory(symbol, apiKey) })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 })
  }
}