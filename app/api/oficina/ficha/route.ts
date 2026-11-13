import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isOwnerRequest } from '@/lib/api-auth'
import { aprobarFicha, leerEstadoFicha } from '@/lib/oficina/conexion/ficha-aprobacion-bd'
import type { ClienteLectura } from '@/lib/oficina/conexion/corridas-lectura'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET  /api/oficina/ficha?ticker=SE → estado de la ficha PMP-09: borrador de la última corrida de PMP, qué está aprobado y qué escribes tú.
 * POST /api/oficina/ficha { ticker, aprobar: ['identidad', ...], textos: { plan_ejecucion: '...' } } → aprueba esos apartados (solo los que pides).
 * Cabecera: Authorization: Bearer <access_token de la sesión de Supabase>
 *
 * Usa la sesión del usuario (clave anónima + su token: el RLS aplica); no usa la clave de servicio. Solo escribe `ficha.ficha_pmp` del expediente PMP del ticker.
 */
function clienteDe(request: Request): { cliente: ClienteLectura } | { respuesta: NextResponse } {
  const authorization = request.headers.get('authorization')
  if (!authorization) return { respuesta: NextResponse.json({ error: 'No autorizado' }, { status: 401 }) }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    console.error('oficina/ficha: falta configuración de Supabase')
    return { respuesta: NextResponse.json({ ok: false, error: 'Servidor sin configurar' }, { status: 500 }) }
  }
  const cliente = createClient(url, anon, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as ClienteLectura
  return { cliente }
}

export async function GET(request: Request) {
  if (!(await isOwnerRequest(request))) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const c = clienteDe(request)
  if ('respuesta' in c) return c.respuesta
  try {
    const r = await leerEstadoFicha(c.cliente, new URL(request.url).searchParams.get('ticker'))
    return r.ok ? NextResponse.json({ ok: true, ...r.datos }) : NextResponse.json({ ok: false, error: r.error }, { status: r.http })
  } catch (e) {
    console.error('oficina/ficha GET: error inesperado', e instanceof Error ? e.name : 'desconocido')
    return NextResponse.json({ ok: false, error: 'Error inesperado' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  if (!(await isOwnerRequest(request))) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const c = clienteDe(request)
  if ('respuesta' in c) return c.respuesta
  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 }) }
  try {
    const r = await aprobarFicha(c.cliente, body, new Date().toISOString())
    return r.ok ? NextResponse.json({ ok: true, ...r.datos }) : NextResponse.json({ ok: false, error: r.error }, { status: r.http })
  } catch (e) {
    console.error('oficina/ficha POST: error inesperado', e instanceof Error ? e.name : 'desconocido')
    return NextResponse.json({ ok: false, error: 'Error inesperado' }, { status: 500 })
  }
}
