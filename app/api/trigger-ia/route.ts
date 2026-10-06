import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

/**
 * POST /api/trigger-ia
 * Cabecera: Authorization: Bearer <access_token de la sesión de Supabase>
 * Body opcional: { ticker: "AAPL", force: true }  → sin ticker procesa todos
 *
 * Corre en el servidor: no tiene restricciones CORS al llamar la Edge Function y guarda el token
 * de la función FUERA del código (variable de entorno UPDATE_IA_TOKEN).
 */

const TICKER_RE = /^[A-Z0-9.\-^=]{1,15}$/
const EDGE_TIMEOUT_MS = 50_000

// ── Protección de cuota (en memoria: se reinicia al redesplegar, pero frena bucles y abusos) ──
const GLOBAL_MIN_GAP_MS = 10 * 60 * 1000  // "todos los tickers" como máximo cada 10 min
const SINGLE_MIN_GAP_MS = 8 * 1000        // separación entre cualquier análisis individual
const TICKER_MIN_GAP_MS = 60 * 1000       // mismo ticker como máximo cada minuto
let lastGlobal = 0
let lastSingle = 0
const lastByTicker = new Map<string, number>()

async function authorizedUser(request: Request): Promise<{ ok: boolean; email?: string }> {
  const auth = request.headers.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!token || !url || !anon) return { ok: false }
  try {
    const { data, error } = await createClient(url, anon).auth.getUser(token)
    if (error || !data.user) return { ok: false }
    // Opcional: si defines OWNER_EMAIL, solo esa cuenta puede disparar el análisis
    const owner = process.env.OWNER_EMAIL?.trim().toLowerCase()
    if (owner && data.user.email?.toLowerCase() !== owner) return { ok: false }
    return { ok: true, email: data.user.email ?? undefined }
  } catch {
    return { ok: false }
  }
}

export async function POST(request: Request) {
  const user = await authorizedUser(request)
  if (!user.ok) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  try {
    const body = await request.json().catch(() => ({}))

    const rawTicker = body?.ticker ? String(body.ticker).toUpperCase().trim() : null
    if (rawTicker && !TICKER_RE.test(rawTicker)) {
      return NextResponse.json({ error: 'Ticker inválido' }, { status: 400 })
    }
    const ticker = rawTicker
    const force = body?.force === true

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    const edgeToken = process.env.UPDATE_IA_TOKEN
    if (!supabaseUrl || !supabaseKey || !edgeToken) {
      console.error('trigger-ia: faltan variables de entorno (UPDATE_IA_TOKEN / Supabase)')
      return NextResponse.json({ error: 'Servidor sin configurar' }, { status: 500 })
    }

    // Límites de frecuencia
    const now = Date.now()
    if (!ticker) {
      const wait = GLOBAL_MIN_GAP_MS - (now - lastGlobal)
      if (wait > 0) {
        return NextResponse.json({ error: 'Análisis global reciente', retryAfterSec: Math.ceil(wait / 1000) }, { status: 429 })
      }
      lastGlobal = now
    } else {
      const waitSingle = SINGLE_MIN_GAP_MS - (now - lastSingle)
      const waitTicker = TICKER_MIN_GAP_MS - (now - (lastByTicker.get(ticker) ?? 0))
      const wait = Math.max(waitSingle, waitTicker)
      if (wait > 0) {
        return NextResponse.json({ error: 'Demasiado pronto', retryAfterSec: Math.ceil(wait / 1000) }, { status: 429 })
      }
      lastSingle = now
      lastByTicker.set(ticker, now)
      if (lastByTicker.size > 500) lastByTicker.clear()
    }

    const edgeUrl = `${supabaseUrl}/functions/v1/update-ia`

    let res: Response
    try {
      res = await fetch(edgeUrl, {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${edgeToken}`,
          'Content-Type':  'application/json',
          'apikey':        supabaseKey,
        },
        body: JSON.stringify({ ...(ticker ? { ticker } : {}), force }),
        signal: AbortSignal.timeout(EDGE_TIMEOUT_MS),
      })
    } catch (e: any) {
      // La función puede seguir trabajando aunque tarde más del tiempo de espera: se avisa como "en proceso"
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
        return NextResponse.json({ ok: true, pending: true, ticker: ticker || 'todos' }, { status: 202 })
      }
      throw e
    }

    const text = await res.text()
    if (!res.ok) {
      // Antes la ruta respondía 200 aunque la función fallara, y la página lo tomaba como éxito
      console.error('trigger-ia: update-ia respondió', res.status, text.slice(0, 300))
      return NextResponse.json(
        { ok: false, status: res.status, error: 'La función de análisis falló', ticker: ticker || 'todos' },
        { status: 502 }
      )
    }

    return NextResponse.json({ ok: true, status: res.status, ticker: ticker || 'todos' })
  } catch (err: any) {
    console.error('trigger-ia error:', err)
    return NextResponse.json({ error: 'Error de servidor' }, { status: 500 })
  }
}