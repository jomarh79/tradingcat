import { NextResponse } from 'next/server'

// GET /api/fundamentals?symbol=AAPL
// Trae P/E, P/S y Payout Ratio desde Finnhub (plan gratuito) — valores actuales (TTM), no serie histórica.
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
    const url = `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${apiKey}`
    const res = await fetch(url, { cache: 'no-store' })
    const data = await res.json()
    const m = data?.metric || {}

    if (!m || Object.keys(m).length === 0) {
      return NextResponse.json({ error: `Sin datos fundamentales para ${symbol}` }, { status: 502 })
    }

    // Payout Ratio: no confirmado como campo directo en el plan gratuito de Finnhub.
    // Probamos los nombres más probables; si ninguno existe, lo calculamos:
    // dividendo anual por acción / utilidad por acción (TTM) × 100.
    const payoutDirect = m.payoutRatioTTM ?? m.payoutRatio ?? m.payoutRatioAnnual ?? null
    let payoutRatio: number | null = payoutDirect
    if (payoutRatio == null && m.dividendPerShareAnnual && m.epsTTM && m.epsTTM > 0) {
      payoutRatio = (m.dividendPerShareAnnual / m.epsTTM) * 100
    }

    return NextResponse.json({
      symbol,
      pe: typeof m.peTTM === 'number' ? m.peTTM : null,
      ps: typeof m.psTTM === 'number' ? m.psTTM : null,
      payoutRatio: typeof payoutRatio === 'number' ? payoutRatio : null,
      eps: typeof m.epsTTM === 'number' ? m.epsTTM : null,
      dividendPerShareAnnual: typeof m.dividendPerShareAnnual === 'number' ? m.dividendPerShareAnnual : null,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 })
  }
}