import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { isOwnerRequest } from '@/lib/api-auth'
import { leerConfigDatos } from '@/lib/oficina/agentes-ia'
import { evaluarSenalPmp } from '@/lib/oficina/conexion/senal-pmp'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/oficina/senal { ticker } → ¿el ticker tiene hoy señal de entrada de PMP (≥ 2 de 5 señales técnicas con el cierre de la última vela cerrada)?
 * Autorización: cabecera x-notify-secret (la Edge Function update-ia, mismo secreto que /api/notify) o la sesión del dueño (Authorization: Bearer).
 * Solo lectura: no guarda nada, no manda correos, no compra ni vende. La Edge Function guarda el estado y avisa.
 */
const safeEqual = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y) }
let lastCall = 0

export async function POST(request: Request) {
  const secret = process.env.NOTIFY_SECRET
  const provided = request.headers.get('x-notify-secret')
  const porSecreto = !!secret && !!provided && safeEqual(provided, secret)
  if (!porSecreto && !(await isOwnerRequest(request))) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const datos = leerConfigDatos(process.env)
  if (!datos.ok) {
    console.error('oficina/senal: falta configuración de datos')
    return NextResponse.json({ ok: false, error: `Servidor sin configurar. Faltan: ${datos.faltan.join(', ')}` }, { status: 500 })
  }
  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 }) }
  const o = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {}

  const now = Date.now()
  if (now - lastCall < 8000) return NextResponse.json({ ok: false, error: 'Demasiado pronto, espera unos segundos' }, { status: 429 }) // 2 consultas de velas por ticker; TwelveData permite 8 por minuto
  lastCall = now

  try {
    const deps = { fetchFn: fetch, origen: datos.base_url ?? new URL(request.url).origin, authorization: request.headers.get('authorization') ?? 'Bearer interno', finnhub_key: datos.finnhub_key }
    const r = await evaluarSenalPmp(deps, o['ticker'], new Date().toISOString())
    return r.ok ? NextResponse.json({ ok: true, ...r.datos }) : NextResponse.json({ ok: false, error: r.error }, { status: r.http })
  } catch (e) {
    console.error('oficina/senal: error inesperado', e instanceof Error ? e.name : 'desconocido')
    return NextResponse.json({ ok: false, error: 'Error inesperado' }, { status: 500 })
  }
}
