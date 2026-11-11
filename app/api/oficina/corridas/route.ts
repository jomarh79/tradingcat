import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isOwnerRequest } from '@/lib/api-auth'
import { detalleCorrida, listarCorridas } from '@/lib/oficina/conexion/corridas-lectura'
import type { ClienteLectura } from '@/lib/oficina/conexion/corridas-lectura'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/oficina/corridas?ticker=GKOS&limite=50      → lista de corridas (la más reciente primero)
 * GET /api/oficina/corridas?id=<corrida_id uuid>        → detalle: agentes, reglas del Auditor, motivos y datos faltantes
 * Cabecera: Authorization: Bearer <access_token de la sesión de Supabase>
 *
 * SOLO LECTURA. Usa la sesión del usuario (clave anónima + su token: el RLS aplica); no usa la clave de servicio ni escribe en ninguna tabla.
 */
export async function GET(request: Request) {
  if (!(await isOwnerRequest(request))) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  const authorization = request.headers.get('authorization')
  if (!authorization) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    const faltan = [!url ? 'NEXT_PUBLIC_SUPABASE_URL' : '', !anon ? 'NEXT_PUBLIC_SUPABASE_ANON_KEY' : ''].filter(Boolean)
    console.error('oficina/corridas: falta configuración de Supabase')
    return NextResponse.json({ ok: false, error: `Servidor sin configurar. Faltan: ${faltan.join(', ')}` }, { status: 500 })
  }
  const cliente = createClient(url, anon, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as ClienteLectura

  try {
    const params = new URL(request.url).searchParams
    const id = params.get('id')
    if (id !== null) {
      const d = await detalleCorrida(cliente, id)
      return d.ok ? NextResponse.json({ ok: true, ...d.datos }) : NextResponse.json({ ok: false, error: d.error }, { status: d.http })
    }
    const l = await listarCorridas(cliente, { ticker: params.get('ticker'), limite: params.get('limite') })
    return l.ok ? NextResponse.json({ ok: true, corridas: l.datos }) : NextResponse.json({ ok: false, error: l.error }, { status: l.http })
  } catch (e) {
    console.error('oficina/corridas: error inesperado', e instanceof Error ? e.name : 'desconocido')
    return NextResponse.json({ ok: false, error: 'Error inesperado' }, { status: 500 })
  }
}