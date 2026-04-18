import { NextResponse } from 'next/server'

/**
 * POST /api/trigger-ia
 * Body opcional: { ticker: "AAPL" } para procesar solo ese ticker
 *
 * Esta route corre en el servidor (Node.js), no en el navegador,
 * por lo que no tiene restricciones CORS al llamar la Edge Function.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const ticker = body?.ticker ? String(body.ticker).toUpperCase().trim() : null

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: 'Variables de entorno faltantes' }, { status: 500 })
    }

    const edgeUrl = `${supabaseUrl}/functions/v1/update-ia`

    const res = await fetch(edgeUrl, {
      method:  'POST',
      headers: {
        'Authorization':  'Bearer tradingcat-cron-2026',
        'Content-Type':   'application/json',
        'apikey':         supabaseKey,
      },
      body: ticker ? JSON.stringify({ ticker }) : '{}',
    })

    const text = await res.text()

    return NextResponse.json({
      ok:      res.ok,
      status:  res.status,
      message: text,
      ticker:  ticker || 'todos',
    })

  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 })
  }
}