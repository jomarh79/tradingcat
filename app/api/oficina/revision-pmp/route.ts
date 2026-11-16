import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isOwnerRequest } from '@/lib/api-auth'
import { leerConfigDatos } from '@/lib/oficina/agentes-ia'
import { ejecutarRevisionPmp } from '@/lib/oficina/conexion/revision-pmp-bd'
import type { ClienteLectura } from '@/lib/oficina/conexion/corridas-lectura'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/oficina/revision-pmp { ticker, anios? }   (anios 1..10, por omisión 1, como la tarjeta de valuación de /position)
 * Cabecera: Authorization: Bearer <access_token de la sesión de Supabase>
 * Revisión semestral de PMP (PMP-11): rendimiento anualizado contra 14% y pérdida de fundamentales (2 de 4).
 * Solo lectura: no guarda nada, no compra ni vende. El resultado es una tarea de revisión; la venta nunca es automática.
 * Usa la sesión del usuario (clave anónima + su token: el RLS aplica); no usa la clave de servicio.
 */
let lastCall = 0

export async function POST(request: Request) {
  if (!(await isOwnerRequest(request))) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const authorization = request.headers.get('authorization')
  if (!authorization) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const datos = leerConfigDatos(process.env)
  if (!datos.ok) {
    console.error('oficina/revision-pmp: falta configuración de datos')
    return NextResponse.json({ ok: false, error: `Servidor sin configurar. Faltan: ${datos.faltan.join(', ')}` }, { status: 500 })
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    console.error('oficina/revision-pmp: falta configuración de Supabase')
    return NextResponse.json({ ok: false, error: 'Servidor sin configurar' }, { status: 500 })
  }
  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 }) }
  const o = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
  const ticker = o['ticker']
  const anios = typeof o['anios'] === 'number' ? o['anios'] : undefined

  const now = Date.now()
  if (now - lastCall < 5000) return NextResponse.json({ ok: false, error: 'Demasiado pronto, espera unos segundos' }, { status: 429 })
  lastCall = now

  try {
    const cliente = createClient(url, anon, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    }) as unknown as ClienteLectura
    const deps = { fetchFn: fetch, origen: datos.base_url ?? new URL(request.url).origin, authorization, finnhub_key: datos.finnhub_key }
    const r = await ejecutarRevisionPmp(deps, cliente, ticker, new Date().toISOString(), anios)
    return r.ok ? NextResponse.json({ ok: true, ...r.datos }) : NextResponse.json({ ok: false, error: r.error }, { status: r.http })
  } catch (e) {
    console.error('oficina/revision-pmp: error inesperado', e instanceof Error ? e.name : 'desconocido')
    return NextResponse.json({ ok: false, error: 'Error inesperado' }, { status: 500 })
  }
}
