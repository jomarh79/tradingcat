import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

/**
 * POST /api/update-trades
 * Cabecera: Authorization: Bearer <access_token de la sesión de Supabase>
 * Body opcional: { ticker: "AAPL" } → refresca solo ese ticker; sin ticker, todos los trades abiertos
 *
 * La página de trades abiertos llama aquí (no directo a la Edge Function): el token de la función
 * (MANUAL_SECRET) vive solo en el servidor y nunca llega al navegador.
 */

const TICKER_RE = /^[A-Z0-9][A-Z0-9.\- ]{0,19}$/ // mismo criterio que la Edge Function (admite "IVV PESOS")
const EDGE_TIMEOUT_MS = 55_000
const MIN_GAP_MS = 5_000 // freno básico contra clics repetidos (la función aplica sus propios límites)
let lastCall = 0

async function isAuthorized(request: Request): Promise<boolean> {
  const auth = request.headers.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!token || !url || !anon) return false
  try {
    const { data, error } = await createClient(url, anon).auth.getUser(token)
    if (error || !data.user) return false
    // Opcional: con OWNER_EMAIL definido, solo esa cuenta puede usar la ruta
    const owner = process.env.OWNER_EMAIL?.trim().toLowerCase()
    return !owner || data.user.email?.toLowerCase() === owner
  } catch {
    return false
  }
}

export async function POST(request: Request) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const secret = process.env.MANUAL_SECRET
  if (!supabaseUrl || !supabaseKey || !secret) {
    console.error('update-trades: faltan variables de entorno (MANUAL_SECRET / Supabase)')
    return NextResponse.json({ error: 'Servidor sin configurar' }, { status: 500 })
  }

  const body = await request.json().catch(() => ({}))
  const ticker = body?.ticker ? String(body.ticker).toUpperCase().trim() : null
  if (ticker && !TICKER_RE.test(ticker)) {
    return NextResponse.json({ error: 'Ticker inválido' }, { status: 400 })
  }

  const now = Date.now()
  if (now - lastCall < MIN_GAP_MS) {
    return NextResponse.json({ error: 'Demasiado pronto, espera unos segundos' }, { status: 429 })
  }
  lastCall = now

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/update-trades`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secret}`,
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
      },
      body: JSON.stringify(ticker ? { ticker } : {}),
      signal: AbortSignal.timeout(EDGE_TIMEOUT_MS),
    })
    const text = (await res.text()).slice(0, 400)

    if (!res.ok) {
      console.error('update-trades: la función respondió', res.status, text)
      // El mensaje de la función (p. ej. "Token Webull no está listo…") es útil para ti, que ya estás autenticado
      return NextResponse.json({ ok: false, status: res.status, error: text || 'La función falló' }, { status: 502 })
    }
    return NextResponse.json({ ok: true, message: text, ticker: ticker || 'todos' })
  } catch (e: any) {
    // La función puede seguir trabajando aunque tarde más que el tiempo de espera
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
      return NextResponse.json({ ok: true, pending: true, ticker: ticker || 'todos' }, { status: 202 })
    }
    console.error('update-trades error:', e)
    return NextResponse.json({ error: 'Error de servidor' }, { status: 500 })
  }
}