import { NextResponse } from 'next/server'

// GET /api/dividends?symbol=BX&years=10
// Historial de dividendos (fecha ex-dividendo + monto) desde Finnhub.
// Webull solo expone un calendario hacia adelante (próximos pagos programados),
// no historial — por eso este endpoint específico usa Finnhub.

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const symbol = searchParams.get('symbol')?.trim().toUpperCase()
  const years = parseInt(searchParams.get('years') || '10', 10)

  if (!symbol) {
    return NextResponse.json({ error: 'Falta el parámetro symbol' }, { status: 400 })
  }

  const apiKey = process.env.NEXT_PUBLIC_FINNHUB_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Falta NEXT_PUBLIC_FINNHUB_KEY' }, { status: 500 })
  }

  const to = new Date()
  const from = new Date()
  from.setFullYear(from.getFullYear() - years)

  const fmt = (d: Date) => d.toISOString().split('T')[0]

  try {
    const url = `https://finnhub.io/api/v1/stock/dividend?symbol=${encodeURIComponent(symbol)}&from=${fmt(from)}&to=${fmt(to)}&token=${apiKey}`
    const res = await fetch(url, { cache: 'no-store' })
    const data = await res.json()

    if (!Array.isArray(data)) {
      return NextResponse.json({ error: 'Respuesta inesperada de Finnhub', raw: data }, { status: 502 })
    }

    const dividends = data
      .map((d: any) => ({
        date: d.date ?? d.payDate ?? null, // fecha ex-dividendo
        amount: d.adjustedAmount != null ? d.adjustedAmount : (d.amount != null ? d.amount : null),
      }))
      .filter((d: any) => d.date && d.amount != null)
      .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime())

    return NextResponse.json({ symbol, years, dividends })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 })
  }
}