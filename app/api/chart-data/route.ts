import { NextResponse } from 'next/server'

// GET /api/chart-data?symbol=AAPL&interval=1day
// interval soportados: 45min | 1day | 1week | 1month

const VALID_INTERVALS = new Set(['45min', '1day', '1week', '1month'])

function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = []
  let prev: number | null = null
  const k = 2 / (period + 1)
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { out.push(null); continue }
    if (prev === null) {
      const seed = values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period
      prev = seed
    } else {
      prev = values[i] * k + prev * (1 - k)
    }
    out.push(prev)
  }
  return out
}

function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = []
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { out.push(null); continue }
    const slice = values.slice(i - period + 1, i + 1)
    out.push(slice.reduce((a, b) => a + b, 0) / period)
  }
  return out
}

// TwelveData regresa 'yyyy-MM-dd' (diario+) o 'yyyy-MM-dd HH:mm:ss' (intradía), en hora local del exchange
function toUnixSeconds(datetimeStr: string): number {
  const iso = datetimeStr.includes(' ') ? datetimeStr.replace(' ', 'T') : datetimeStr + 'T00:00:00'
  return Math.floor(new Date(iso).getTime() / 1000)
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const symbol = searchParams.get('symbol')?.trim().toUpperCase()
  const interval = searchParams.get('interval') || '1day'

  if (!symbol) {
    return NextResponse.json({ error: 'Falta el parámetro symbol' }, { status: 400 })
  }
  if (!VALID_INTERVALS.has(interval)) {
    return NextResponse.json({ error: `Intervalo inválido: ${interval}` }, { status: 400 })
  }

  const apiKey = process.env.NEXT_PUBLIC_TWELVEDATA_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Falta la variable de entorno NEXT_PUBLIC_TWELVEDATA_API_KEY en este proyecto' }, { status: 500 })
  }

    // Tamaño de la ventana: suficiente para que las medias de 200 periodos tengan sentido

  const outputsizeMap: Record<string, number> = {
  '45min': 1000,
  '1day': 2500,
  '1week': 520,
  '1month': 210,
}

const outputsize = outputsizeMap[interval]

  try {
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=${outputsize}&apikey=${apiKey}`
    const res = await fetch(url, { cache: 'no-store' })
    const data = await res.json()

    if (data.status === 'error' || !Array.isArray(data.values) || data.values.length === 0) {
      return NextResponse.json({ error: data.message || `Sin datos para ${symbol} en ${interval}` }, { status: 502 })
    }

    // TwelveData regresa del más reciente al más antiguo — invertimos para orden cronológico
    const candles = [...data.values]
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
    const useEma = interval === '45min' || interval === '1day'
    const periods: { n: number; key: string }[] = useEma
      ? [{ n: 8, key: 'ema8' }, { n: 21, key: 'ema21' }, { n: 50, key: 'ema50' }, { n: 100, key: 'ema100' }, { n: 200, key: 'ema200' }]
      : [{ n: 10, key: 'sma10' }, { n: 20, key: 'sma20' }, { n: 50, key: 'sma50' }, { n: 100, key: 'sma100' }, { n: 200, key: 'sma200' }]

    const mas: Record<string, { time: number; value: number | null }[]> = {}
    periods.forEach(p => {
      const values = useEma ? ema(closes, p.n) : sma(closes, p.n)
      mas[p.key] = candles.map((c, i) => ({ time: c.time, value: values[i] }))
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

// POST /api/chart-data  { symbol: "AAPL" } — máximo/mínimo de los últimos 10 años, 5 años y 52 semanas
// (siempre en diario, sin importar el intervalo que se esté viendo)
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const symbol = String(body?.symbol || '').trim().toUpperCase()
  if (!symbol) return NextResponse.json({ error: 'Falta symbol' }, { status: 400 })

  const apiKey = process.env.NEXT_PUBLIC_TWELVEDATA_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'Falta NEXT_PUBLIC_TWELVEDATA_API_KEY' }, { status: 500 })

  try {
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=5000&apikey=${apiKey}`
    const res = await fetch(url, { cache: 'no-store' })
    const data = await res.json()

    if (data.status === 'error' || !Array.isArray(data.values) || data.values.length === 0) {
      return NextResponse.json({ error: data.message || `Sin datos diarios para ${symbol}` }, { status: 502 })
    }

    const YEARS_LONG = 10
    const YEARS_SHORT = 5
    const WEEKS_52 = 52
    const cutoffLong = Date.now() - YEARS_LONG * 365 * 24 * 60 * 60 * 1000
    const cutoffShort = Date.now() - YEARS_SHORT * 365 * 24 * 60 * 60 * 1000
    const cutoff52w = Date.now() - WEEKS_52 * 7 * 24 * 60 * 60 * 1000

    let maxPrice = -Infinity, maxDate = ''
    let minPrice = Infinity, minDate = ''
    let maxPrice5 = -Infinity, maxDate5 = ''
    let minPrice5 = Infinity, minDate5 = ''
    let maxPrice52 = -Infinity, maxDate52 = ''
    let minPrice52 = Infinity, minDate52 = ''

    data.values.forEach((v: any) => {
      const t = new Date(v.datetime + 'T00:00:00').getTime()
      if (t < cutoffLong) return
      const h = parseFloat(v.high)
      const l = parseFloat(v.low)
      if (!isNaN(h) && h > maxPrice) { maxPrice = h; maxDate = v.datetime }
      if (!isNaN(l) && l < minPrice) { minPrice = l; minDate = v.datetime }
      if (t >= cutoffShort) {
        if (!isNaN(h) && h > maxPrice5) { maxPrice5 = h; maxDate5 = v.datetime }
        if (!isNaN(l) && l < minPrice5) { minPrice5 = l; minDate5 = v.datetime }
      }
      if (t >= cutoff52w) {
        if (!isNaN(h) && h > maxPrice52) { maxPrice52 = h; maxDate52 = v.datetime }
        if (!isNaN(l) && l < minPrice52) { minPrice52 = l; minDate52 = v.datetime }
      }
    })

    if (maxPrice === -Infinity || minPrice === Infinity) {
      return NextResponse.json({ error: 'No se pudo calcular máximo/mínimo' }, { status: 502 })
    }

    // Velas diarias compactas (fecha + cierre) — se usan para cruzar con fechas de reportes 10-K en /api/fundamentals
    const dailyCloses = data.values
      .map((v: any) => ({ date: v.datetime, close: parseFloat(v.close) }))
      .filter((c: any) => !isNaN(c.close))
      .reverse() // cronológico

    return NextResponse.json({
      symbol,
      years: YEARS_LONG,
      max: { price: maxPrice, date: maxDate },
      min: { price: minPrice, date: minDate },
      max5: maxPrice5 !== -Infinity ? { price: maxPrice5, date: maxDate5 } : null,
      min5: minPrice5 !== Infinity ? { price: minPrice5, date: minDate5 } : null,
      max52: maxPrice52 !== -Infinity ? { price: maxPrice52, date: maxDate52 } : null,
      min52: minPrice52 !== Infinity ? { price: minPrice52, date: minDate52 } : null,
      dailyCloses,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 })
  }
}