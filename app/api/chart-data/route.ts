import { NextResponse } from 'next/server'

// GET  /api/chart-data?symbol=AAPL&interval=1day
//      interval soportados: 45min | 1day | 1week | 1month
// POST /api/chart-data  { symbol: "AAPL" } — máximo/mínimo de 10 años, 5 años y 52 semanas
//      (siempre en diario, sin importar el intervalo que se esté viendo)

const VALID_INTERVALS = new Set(['45min', '1day', '1week', '1month'])

// Tamaño de la ventana: suficiente para que las medias de 200 periodos tengan sentido
const OUTPUT_SIZE: Record<string, number> = {
  '45min': 1000,
  '1week': 520,
  '1month': 210,
}
// El diario se pide UNA sola vez (5000 velas) y lo comparten el gráfico (últimas 2500) y las estadísticas
const DAILY_FETCH_SIZE = 5000
const DAILY_CHART_CANDLES = 2500

// Cuánto tiempo se reutiliza una respuesta de TwelveData (cuida los créditos del plan)
const TTL_INTRADAY_MS = 60 * 1000
const TTL_DEFAULT_MS = 5 * 60 * 1000
const MAX_CACHE_ENTRIES = 60

// Acepta AAPL, BRK.B, EUR/USD, etc. Evita gastar créditos con basura.
const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.\-:/]{0,19}$/

// Preferimos una variable privada; NEXT_PUBLIC_ queda como respaldo para no romper el despliegue actual.
// (Una variable NEXT_PUBLIC_ se puede filtrar al navegador si algún día se usa en código de cliente.)
const getApiKey = () => process.env.TWELVEDATA_API_KEY || process.env.NEXT_PUBLIC_TWELVEDATA_API_KEY

// ── Indicadores ──────────────────────────────────────────────────────────────
function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = []
  let prev: number | null = null
  const k = 2 / (period + 1)
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { out.push(null); continue }
    if (prev === null) {
      prev = values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period
    } else {
      prev = values[i] * k + prev * (1 - k)
    }
    out.push(prev)
  }
  return out
}

// Suma deslizante: O(n) en vez de recortar un arreglo por cada vela
function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = []
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= period) sum -= values[i - period]
    out.push(i < period - 1 ? null : sum / period)
  }
  return out
}

// TwelveData regresa 'yyyy-MM-dd' (diario+) o 'yyyy-MM-dd HH:mm:ss' (intradía), en hora local del exchange.
// Se interpreta como UTC a propósito: así la gráfica muestra la hora del exchange sin depender de la zona del servidor.
function toUnixSeconds(datetimeStr: string): number {
  const iso = datetimeStr.includes(' ') ? datetimeStr.replace(' ', 'T') : datetimeStr + 'T00:00:00'
  return Math.floor(Date.parse(iso + 'Z') / 1000)
}

// ── Cliente de TwelveData con caché en memoria y deduplicación de peticiones en vuelo ──
const cache = new Map<string, { expires: number; data: any }>()
const inflight = new Map<string, Promise<any>>()

async function fetchTimeSeries(symbol: string, interval: string, outputsize: number, apiKey: string) {
  const ttl = interval === '45min' ? TTL_INTRADAY_MS : TTL_DEFAULT_MS
  const key = `${symbol}|${interval}|${outputsize}` // sin la apikey

  const hit = cache.get(key)
  if (hit && hit.expires > Date.now()) return hit.data

  const pending = inflight.get(key)
  if (pending) return pending

  const request = (async () => {
    const qs = new URLSearchParams({ symbol, interval, outputsize: String(outputsize), apikey: apiKey })
    const res = await fetch(`https://api.twelvedata.com/time_series?${qs}`, { cache: 'no-store' })
    const data = await res.json()

    // Solo se guardan respuestas buenas: un error o un límite de créditos no se queda pegado en caché
    if (data.status !== 'error' && Array.isArray(data.values) && data.values.length > 0) {
      cache.set(key, { expires: Date.now() + ttl, data })
      while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value as string)
    }
    return data
  })().finally(() => inflight.delete(key))

  inflight.set(key, request)
  return request
}

const hasNoData = (data: any) => data.status === 'error' || !Array.isArray(data.values) || data.values.length === 0
// TwelveData responde 200 con code 429 cuando se acaban los créditos por minuto
const errorStatus = (data: any) => (data?.code === 429 ? 429 : 502)

function parseSymbol(raw: unknown): string | null {
  const symbol = String(raw ?? '').trim().toUpperCase()
  return SYMBOL_RE.test(symbol) ? symbol : null
}

// ── GET: velas + medias móviles ──────────────────────────────────────────────
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const interval = searchParams.get('interval') || '1day'

  if (!searchParams.get('symbol')?.trim()) {
    return NextResponse.json({ error: 'Falta el parámetro symbol' }, { status: 400 })
  }
  const symbol = parseSymbol(searchParams.get('symbol'))
  if (!symbol) {
    return NextResponse.json({ error: 'Símbolo inválido' }, { status: 400 })
  }
  if (!VALID_INTERVALS.has(interval)) {
    return NextResponse.json({ error: `Intervalo inválido: ${interval}` }, { status: 400 })
  }

  const apiKey = getApiKey()
  if (!apiKey) {
    return NextResponse.json({ error: 'Falta la variable de entorno TWELVEDATA_API_KEY (o NEXT_PUBLIC_TWELVEDATA_API_KEY) en este proyecto' }, { status: 500 })
  }

  try {
    const isDaily = interval === '1day'
    const data = await fetchTimeSeries(symbol, interval, isDaily ? DAILY_FETCH_SIZE : OUTPUT_SIZE[interval], apiKey)

    if (hasNoData(data)) {
      return NextResponse.json({ error: data.message || `Sin datos para ${symbol} en ${interval}` }, { status: errorStatus(data) })
    }

    // TwelveData regresa del más reciente al más antiguo: se recorta (diario) y se invierte para orden cronológico
    const values: any[] = isDaily ? data.values.slice(0, DAILY_CHART_CANDLES) : data.values
    const candles = [...values]
      .reverse()
      .map((v: any) => ({
        time: toUnixSeconds(v.datetime),
        open: parseFloat(v.open),
        high: parseFloat(v.high),
        low: parseFloat(v.low),
        close: parseFloat(v.close),
        volume: v.volume ? parseFloat(v.volume) : 0,
      }))
      .filter(c => !isNaN(c.close))

    const closes = candles.map(c => c.close)

    // 45min y diario → EMA 8/21/50/100/200 · semanal y mensual → SMA 10/20/50/100/200
    const useEma = interval === '45min' || isDaily
    const periods: { n: number; key: string }[] = useEma
      ? [{ n: 8, key: 'ema8' }, { n: 21, key: 'ema21' }, { n: 50, key: 'ema50' }, { n: 100, key: 'ema100' }, { n: 200, key: 'ema200' }]
      : [{ n: 10, key: 'sma10' }, { n: 20, key: 'sma20' }, { n: 50, key: 'sma50' }, { n: 100, key: 'sma100' }, { n: 200, key: 'sma200' }]

    const mas: Record<string, { time: number; value: number | null }[]> = {}
    periods.forEach(p => {
      const series = useEma ? ema(closes, p.n) : sma(closes, p.n)
      mas[p.key] = candles.map((c, i) => ({ time: c.time, value: series[i] }))
    })

    return NextResponse.json({
      symbol,
      interval,
      priceName: data.meta?.symbol || symbol,
      candles,
      mas,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 })
  }
}

// ── POST: máximos / mínimos históricos ───────────────────────────────────────
type Extreme = { price: number; date: string }

// Máximo y mínimo de las filas con fecha >= cutoff. Las filas vienen de la más reciente a la más antigua,
// y con empates se conserva la más reciente (comparación estricta), igual que antes.
function extremes(rows: { t: number; h: number; l: number; date: string }[], cutoff: number) {
  let max: Extreme | null = null
  let min: Extreme | null = null
  for (const r of rows) {
    if (r.t < cutoff) continue
    if (!isNaN(r.h) && (!max || r.h > max.price)) max = { price: r.h, date: r.date }
    if (!isNaN(r.l) && (!min || r.l < min.price)) min = { price: r.l, date: r.date }
  }
  return { max, min }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  if (!String(body?.symbol || '').trim()) {
    return NextResponse.json({ error: 'Falta symbol' }, { status: 400 })
  }
  const symbol = parseSymbol(body.symbol)
  if (!symbol) return NextResponse.json({ error: 'Símbolo inválido' }, { status: 400 })

  const apiKey = getApiKey()
  if (!apiKey) return NextResponse.json({ error: 'Falta TWELVEDATA_API_KEY (o NEXT_PUBLIC_TWELVEDATA_API_KEY)' }, { status: 500 })

  try {
    const data = await fetchTimeSeries(symbol, '1day', DAILY_FETCH_SIZE, apiKey)

    if (hasNoData(data)) {
      return NextResponse.json({ error: data.message || `Sin datos diarios para ${symbol}` }, { status: errorStatus(data) })
    }

    const YEARS_LONG = 10
    const YEARS_SHORT = 5
    const WEEKS_52 = 52
    const DAY_MS = 24 * 60 * 60 * 1000
    const now = Date.now()

    const rows = (data.values as any[]).map(v => ({
      t: Date.parse(v.datetime + 'T00:00:00Z'),
      h: parseFloat(v.high),
      l: parseFloat(v.low),
      date: v.datetime as string,
    }))

    const long  = extremes(rows, now - YEARS_LONG * 365 * DAY_MS)
    const short = extremes(rows, now - YEARS_SHORT * 365 * DAY_MS)
    const w52   = extremes(rows, now - WEEKS_52 * 7 * DAY_MS)

    if (!long.max || !long.min) {
      return NextResponse.json({ error: 'No se pudo calcular máximo/mínimo' }, { status: 502 })
    }

    // Velas diarias compactas (fecha + cierre) — se usan para cruzar con fechas de reportes 10-K en /api/fundamentals
    const dailyCloses = (data.values as any[])
      .map(v => ({ date: v.datetime as string, close: parseFloat(v.close) }))
      .filter(c => !isNaN(c.close))
      .reverse() // cronológico

    return NextResponse.json({
      symbol,
      years: YEARS_LONG,
      max: long.max,
      min: long.min,
      max5: short.max,
      min5: short.min,
      max52: w52.max,
      min52: w52.min,
      dailyCloses,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 })
  }
}