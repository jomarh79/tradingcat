import { NextResponse } from 'next/server'
import { isOwnerRequest } from '@/lib/api-auth'
import { computeFearGreed, type Bar, type FGResult } from '@/lib/fearGreed'

// GET /api/fear-greed → índice propio de miedo y codicia (0-100) calculado con velas diarias de TwelveData.
// Usa 4 créditos de TwelveData por cálculo; el resultado se reutiliza varias horas (los datos son diarios).
// El VIX no viene en el plan de TwelveData: se toma de la fuente oficial (CBOE) y, si falla, de la Reserva Federal (FRED).

const TTL_OK_MS = 3 * 60 * 60 * 1000
const TTL_PARTIAL_MS = 15 * 60 * 1000   // faltó algún indicador: se reintenta pronto, pero sin gastar créditos a cada rato
const TTL_FAIL_MS = 2 * 60 * 1000
const OUTPUT_SIZE = 260                 // ≈ 1 año de velas diarias (52 semanas + margen para las medias)

const getApiKey = () => process.env.TWELVEDATA_API_KEY || process.env.NEXT_PUBLIC_TWELVEDATA_API_KEY

async function fetchBars(symbol: string, apiKey: string): Promise<Bar[] | null> {
  try {
    const qs = new URLSearchParams({ symbol, interval: '1day', outputsize: String(OUTPUT_SIZE), apikey: apiKey })
    const res = await fetch(`https://api.twelvedata.com/time_series?${qs}`, { cache: 'no-store' })
    const data = await res.json()
    if (data?.status === 'error' || !Array.isArray(data?.values) || !data.values.length) return null
    return (data.values as any[])
      .map(v => ({ date: String(v.datetime).slice(0, 10), close: parseFloat(v.close) }))
      .filter(b => Number.isFinite(b.close) && b.close > 0)
      .reverse() // TwelveData responde de la más reciente a la más antigua
  } catch {
    return null
  }
}

// ── VIX desde CSV público ───────────────────────────────────────────────────
const VIX_SOURCES = [
  'https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv',
  'https://fred.stlouisfed.org/graph/fredgraph.csv?id=VIXCLS',
]

// Acepta 2026-11-06 o 11/06/2026
function normDate(raw: string): string | null {
  const t = raw.trim().replace(/"/g, '')
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10)
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null
}

// Columna de la fecha = la primera; columna del cierre = "CLOSE" (CBOE) o la última (FRED)
function parseVixCsv(text: string): Bar[] | null {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 60) return null
  const head = lines[0].split(',').map(h => h.trim().replace(/"/g, '').toUpperCase())
  const closeIdx = head.includes('CLOSE') ? head.indexOf('CLOSE') : head.length - 1
  const bars: Bar[] = []
  for (const line of lines.slice(-(OUTPUT_SIZE + 10))) {
    const cols = line.split(',')
    const date = normDate(cols[0] ?? '')
    const close = parseFloat(cols[closeIdx] ?? '')
    if (date && Number.isFinite(close) && close > 0) bars.push({ date, close })
  }
  bars.sort((a, b) => a.date.localeCompare(b.date))
  return bars.length >= 60 ? bars : null
}

async function fetchVix(): Promise<Bar[] | null> {
  for (const url of VIX_SOURCES) {
    try {
      const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) })
      if (!res.ok) continue
      const bars = parseVixCsv(await res.text())
      if (bars) return bars
    } catch { /* se prueba la siguiente fuente */ }
  }
  return null
}

let cache: { expires: number; data: FGResult | null } | null = null
let inflight: Promise<FGResult | null> | null = null

async function compute(apiKey: string): Promise<FGResult | null> {
  const [spy, tlt, hyg, lqd, vix] = await Promise.all([
    fetchBars('SPY', apiKey), fetchBars('TLT', apiKey), fetchBars('HYG', apiKey), fetchBars('LQD', apiKey),
    fetchVix(),
  ])
  const result = computeFearGreed({ spy, vix, tlt, hyg, lqd })
  const ttl = !result ? TTL_FAIL_MS : result.missing.length ? TTL_PARTIAL_MS : TTL_OK_MS
  cache = { expires: Date.now() + ttl, data: result }
  return result
}

export async function GET(request: Request) {
  if (!(await isOwnerRequest(request))) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  const apiKey = getApiKey()
  if (!apiKey) return NextResponse.json({ error: 'Falta TWELVEDATA_API_KEY' }, { status: 500 })

  if (cache && cache.expires > Date.now()) {
    return cache.data
      ? NextResponse.json(cache.data)
      : NextResponse.json({ error: 'No hay suficientes datos para calcular el índice' }, { status: 502 })
  }
  inflight ||= compute(apiKey).finally(() => { inflight = null })
  const result = await inflight
  return result
    ? NextResponse.json(result)
    : NextResponse.json({ error: 'No hay suficientes datos para calcular el índice' }, { status: 502 })
}