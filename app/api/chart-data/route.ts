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
  const outputsize = interval === '45min' ? 500 : 2500

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