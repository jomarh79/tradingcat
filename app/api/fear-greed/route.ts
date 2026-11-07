import { NextResponse } from 'next/server'
import { isOwnerRequest } from '@/lib/api-auth'
import { computeFearGreed, type Bar, type FGResult } from '@/lib/fearGreed'

// GET /api/fear-greed → índice propio de miedo y codicia (0-100) calculado con velas diarias de TwelveData.
// Usa 5 créditos por cálculo; el resultado se reutiliza varias horas (los datos son diarios).

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

let cache: { expires: number; data: FGResult | null } | null = null
let inflight: Promise<FGResult | null> | null = null

async function compute(apiKey: string): Promise<FGResult | null> {
  const [spy, vix, tlt, hyg, lqd] = await Promise.all(['SPY', 'VIX', 'TLT', 'HYG', 'LQD'].map(s => fetchBars(s, apiKey)))
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