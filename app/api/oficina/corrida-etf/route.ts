import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isOwnerRequest } from '@/lib/api-auth'
import { correrAporteEtf } from '@/lib/oficina/conexion'
import type { ClienteCorridaEtf } from '@/lib/oficina/conexion'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/oficina/corrida-etf
 * Cabecera: Authorization: Bearer <access_token de la sesión de Supabase>
 * Body: { "ticker": "XLK" }  (un ETF sectorial del portafolio ETF)
 *
 * Corrida determinista del aporte semanal de ETFs: lee la base con la sesión del usuario (clave anónima + su token, RLS activo; sin service role),
 * corre el Auditor de Reglas y el Motor, y registra la corrida con oficina_registrar_corrida. Solo analiza y registra: NO opera, no escribe en
 * trades ni en wallets. No devuelve ni registra tokens ni claves.
 */

const MIN_GAP_MS = 5_000 // freno básico contra clics repetidos
let lastCall = 0

export async function POST(request: Request) {
  if (!(await isOwnerRequest(request))) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const auth = request.headers.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!token || !url || !anon) {
    console.error('oficina/corrida-etf: faltan variables de entorno de Supabase')
    return NextResponse.json({ error: 'Servidor sin configurar' }, { status: 500 })
  }

  const body: unknown = await request.json().catch(() => null)

  const now = Date.now()
  if (now - lastCall < MIN_GAP_MS) {
    return NextResponse.json({ error: 'Demasiado pronto, espera unos segundos' }, { status: 429 })
  }
  lastCall = now

  // Cliente con la sesión del usuario: el token va en Authorization para que auth.uid() aplique el RLS "propias".
  const cliente = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  try {
    const r = await correrAporteEtf(cliente as unknown as ClienteCorridaEtf, body, {
      nuevoId: () => randomUUID(),
      ahora: () => new Date().toISOString(),
    })
    return NextResponse.json(r.cuerpo, { status: r.http })
  } catch (e) {
    // Solo el tipo de error: el mensaje podría contener datos de la petición.
    console.error('oficina/corrida-etf: error inesperado', e instanceof Error ? e.name : 'desconocido')
    return NextResponse.json({ ok: false, error: 'Error inesperado' }, { status: 500 })
  }
}
