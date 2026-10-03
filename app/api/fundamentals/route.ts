import { NextResponse } from 'next/server'

// GET /api/fundamentals?symbol=AAPL
// Trae P/E, P/S, Payout Ratio y Dividend Yield desde Finnhub (plan gratuito) — valores actuales (TTM),
// más el promedio de esos mismos ratios entre las empresas comparables de su sector (peers).
// También trae el historial propio (últimos 5 años de 10-K) incluyendo flujo de caja operativo y
// capital contable, usado en el chart page para construir las series diarias de P/E, P/S, P/CF y P/B.

const FINNHUB_URL = 'https://finnhub.io/api/v1'
const FETCH_TIMEOUT_MS = 10_000
const MAX_PEERS = 6

// Los fundamentales cambian poco: se reutilizan horas, no segundos (el plan gratuito permite ~60 llamadas/min)
const TTL_OK_MS = 6 * 60 * 60 * 1000
const TTL_EMPTY_MS = 30 * 60 * 1000   // símbolo sin datos (ETF, ticker inválido)
const TTL_PARTIAL_MS = 2 * 60 * 1000  // algo falló (peers, historial): se reintenta pronto
const MAX_METRICS = 300
const MAX_RESPONSES = 80

// Acepta AAPL, BRK.B, BF-B, etc.
const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.\-]{0,11}$/

// Preferimos una variable privada; NEXT_PUBLIC_ queda como respaldo para no romper el despliegue actual.
// (Una variable NEXT_PUBLIC_ se incrusta en el JavaScript del navegador.)
const getApiKey = () => process.env.FINNHUB_API_KEY || process.env.NEXT_PUBLIC_FINNHUB_KEY

/* ─────────────────────────────────────────────────────────────
   CLIENTE FINNHUB + CACHÉ
───────────────────────────────────────────────────────────── */

class FinnhubError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

// La clave va en un header (no en la URL) para que no quede en logs ni en mensajes de error
async function finnhubGet(path: string, params: Record<string, string>, apiKey: string): Promise<any> {
  const res = await fetch(`${FINNHUB_URL}${path}?${new URLSearchParams(params)}`, {
    headers: { 'X-Finnhub-Token': apiKey },
    cache: 'no-store',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (res.status === 429) throw new FinnhubError('Límite de peticiones de Finnhub alcanzado, intenta en un minuto', 429)
  if (!res.ok) throw new FinnhubError(`Finnhub respondió HTTP ${res.status}`, 502)
  try {
    return await res.json()
  } catch {
    throw new FinnhubError('Finnhub devolvió una respuesta inválida', 502)
  }
}

type Entry<T> = { expires: number; data: T }

// Caché con TTL decidido por el resultado (ttl 0 = no guardar) + deduplicación de peticiones en vuelo
async function memo<T>(
  store: Map<string, Entry<T>>,
  inflight: Map<string, Promise<T>>,
  max: number,
  key: string,
  load: () => Promise<{ data: T; ttl: number }>
): Promise<T> {
  const hit = store.get(key)
  if (hit && hit.expires > Date.now()) return hit.data

  const pending = inflight.get(key)
  if (pending) return pending

  const p = load()
    .then(({ data, ttl }) => {
      if (ttl > 0) {
        store.set(key, { expires: Date.now() + ttl, data })
        while (store.size > max) store.delete(store.keys().next().value as string)
      }
      return data
    })
    .finally(() => inflight.delete(key))

  inflight.set(key, p)
  return p
}

/* ─────────────────────────────────────────────────────────────
   RATIOS
───────────────────────────────────────────────────────────── */

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
    payoutRatio,
    dividendYield: typeof dividendYield === 'number' ? dividendYield : null,
  }
}

type Ratios = ReturnType<typeof extractRatios>

const metricStore = new Map<string, Entry<Record<string, any> | null>>()
const metricInflight = new Map<string, Promise<Record<string, any> | null>>()

// Compartida entre el símbolo pedido y los peers: si un peer ya se consultó, no se vuelve a pedir
function fetchMetric(symbol: string, apiKey: string) {
  return memo(metricStore, metricInflight, MAX_METRICS, symbol, async () => {
    const data = await finnhubGet('/stock/metric', { symbol, metric: 'all' }, apiKey)
    const metric = data?.metric && Object.keys(data.metric).length > 0 ? data.metric : null
    return { data: metric, ttl: metric ? TTL_OK_MS : TTL_EMPTY_MS }
  })
}

/* ─────────────────────────────────────────────────────────────
   HISTORIAL PROPIO (10-K)
───────────────────────────────────────────────────────────── */

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
  depreciationAmortization: [
    'us-gaap_DepreciationDepletionAndAmortization',
    'us-gaap_DepreciationAmortizationAndAccretionNet',
    'us-gaap_DepreciationAndAmortization',
  ],
  capitalExpenditures: [
    'us-gaap_PaymentsToAcquirePropertyPlantAndEquipment',
    'us-gaap_PaymentsToAcquireProductiveAssets',
    'us-gaap_PaymentsForCapitalImprovements',
  ],
}

const SECTIONS = ['ic', 'bs', 'cf'] as const // income statement, balance sheet, cash flow

// Un índice por reporte (concepto → valor, primera aparición) en vez de recorrer las listas por cada búsqueda.
// Mantiene la misma prioridad de antes: primero el candidato, y dentro de él ic → bs → cf.
function indexReport(report: any): Record<(typeof SECTIONS)[number], Map<string, any>> {
  const idx = { ic: new Map<string, any>(), bs: new Map<string, any>(), cf: new Map<string, any>() }
  for (const section of SECTIONS) {
    const items = report?.[section]
    if (!Array.isArray(items)) continue
    for (const it of items) {
      if (typeof it?.concept === 'string' && !idx[section].has(it.concept)) idx[section].set(it.concept, it.value)
    }
  }
  return idx
}

function findConcept(idx: ReturnType<typeof indexReport>, candidates: string[]): number | null {
  for (const candidate of candidates) {
    for (const section of SECTIONS) {
      const value = idx[section].get(candidate)
      if (typeof value === 'number') return value
    }
  }
  return null
}

// ok=false → falló la petición (no se guarda en caché); ok=true con lista vacía → ETF/extranjero sin 10-K
async function fetchOwnHistory(symbol: string, apiKey: string): Promise<{ rows: any[]; ok: boolean }> {
  try {
    const data = await finnhubGet('/stock/financials-reported', { symbol, freq: 'annual' }, apiKey)
    const reports: any[] = Array.isArray(data?.data) ? data.data : []

    // Solo 10-K, un reporte por año (el más reciente si hay duplicados/enmiendas), últimos 5 años
    const byYear = new Map<number, any>()
    reports
      .filter((r) => r.form === '10-K' && r.year)
      .forEach((r) => {
        const existing = byYear.get(r.year)
        if (!existing || new Date(r.filedDate) > new Date(existing.filedDate)) byYear.set(r.year, r)
      })

    const lastFive = Array.from(byYear.values())
      .sort((a, b) => b.year - a.year)
      .slice(0, 5)

    const rows = lastFive.map((r) => {
      const idx = indexReport(r.report)
      return {
        year: r.year,
        endDate: r.endDate,
        // Fecha real de presentación ante la SEC — el mercado no "sabe" el número hasta este día,
        // no hasta el cierre del año fiscal (endDate). Se usa para las series diarias de ratios.
        filedDate: r.filedDate ?? null,
        eps: findConcept(idx, CONCEPT_CANDIDATES.eps),
        revenue: findConcept(idx, CONCEPT_CANDIDATES.revenue),
        sharesOutstanding: findConcept(idx, CONCEPT_CANDIDATES.shares),
        dividendPerShare: findConcept(idx, CONCEPT_CANDIDATES.dividendPerShare),
        operatingCashFlow: findConcept(idx, CONCEPT_CANDIDATES.operatingCashFlow),
        stockholdersEquity: findConcept(idx, CONCEPT_CANDIDATES.stockholdersEquity),
        depreciationAmortization: findConcept(idx, CONCEPT_CANDIDATES.depreciationAmortization),
        capitalExpenditures: findConcept(idx, CONCEPT_CANDIDATES.capitalExpenditures),
      }
    })
    return { rows, ok: true }
  } catch {
    return { rows: [], ok: false }
  }
}

/* ─────────────────────────────────────────────────────────────
   SECTOR (PEERS)
───────────────────────────────────────────────────────────── */

async function fetchSectorAvg(
  symbol: string,
  apiKey: string
): Promise<{ sectorAvg: Ratios | null; peerCount: number; ok: boolean }> {
  try {
    const peersList = await finnhubGet('/stock/peers', { symbol, grouping: 'sector' }, apiKey)
    const peers: string[] = (Array.isArray(peersList) ? peersList : [])
      .filter((p: any): p is string => typeof p === 'string' && p.toUpperCase() !== symbol)
      .slice(0, MAX_PEERS)

    // En paralelo (antes eran 6 peticiones una tras otra); cada peer reutiliza la caché de métricas
    const settled = await Promise.allSettled(peers.map((p) => fetchMetric(p, apiKey)))

    let ok = true
    const peerRatios: Ratios[] = []
    for (const s of settled) {
      if (s.status === 'rejected') ok = false
      else if (s.value) peerRatios.push(extractRatios(s.value))
    }
    if (peerRatios.length === 0) return { sectorAvg: null, peerCount: 0, ok }

    const avgOf = (key: keyof Ratios) => {
      const vals = peerRatios.map((p) => p[key]).filter((v): v is number => typeof v === 'number')
      return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null
    }
    return {
      sectorAvg: { pe: avgOf('pe'), ps: avgOf('ps'), payoutRatio: avgOf('payoutRatio'), dividendYield: avgOf('dividendYield') },
      peerCount: peerRatios.length,
      ok,
    }
  } catch {
    // si falla el sector, seguimos devolviendo al menos los valores propios
    return { sectorAvg: null, peerCount: 0, ok: false }
  }
}

/* ─────────────────────────────────────────────────────────────
   GET
───────────────────────────────────────────────────────────── */

type Result = { status: number; body: any }
const responseStore = new Map<string, Entry<Result>>()
const responseInflight = new Map<string, Promise<Result>>()

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const symbol = searchParams.get('symbol')?.trim().toUpperCase()

  if (!symbol) {
    return NextResponse.json({ error: 'Falta el parámetro symbol' }, { status: 400 })
  }
  if (!SYMBOL_RE.test(symbol)) {
    return NextResponse.json({ error: 'Símbolo inválido' }, { status: 400 })
  }

  const apiKey = getApiKey()
  if (!apiKey) {
    return NextResponse.json({ error: 'Falta la variable de entorno FINNHUB_API_KEY (o NEXT_PUBLIC_FINNHUB_KEY) en este proyecto' }, { status: 500 })
  }

  try {
    const { status, body } = await memo(responseStore, responseInflight, MAX_RESPONSES, symbol, async () => {
      const ownMetric = await fetchMetric(symbol, apiKey) // si falla (429, red) se propaga y no se guarda nada
      if (!ownMetric) {
        return { data: { status: 502, body: { error: `Sin datos fundamentales para ${symbol}` } }, ttl: TTL_EMPTY_MS }
      }

      // Solo si el símbolo tiene datos se gastan las llamadas de sector e historial, y van en paralelo
      const [sector, history] = await Promise.all([fetchSectorAvg(symbol, apiKey), fetchOwnHistory(symbol, apiKey)])

      return {
        data: {
          status: 200,
          body: {
            symbol,
            ...extractRatios(ownMetric),
            sectorAvg: sector.sectorAvg,
            peerCount: sector.peerCount,
            ownHistory: history.rows,
          },
        },
        ttl: sector.ok && history.ok ? TTL_OK_MS : TTL_PARTIAL_MS,
      }
    })

    return NextResponse.json(body, { status })
  } catch (err: any) {
    const status = err instanceof FinnhubError ? err.status : 500
    return NextResponse.json({ error: err?.message ?? String(err) }, { status })
  }
}