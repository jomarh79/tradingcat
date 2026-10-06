import { Resend } from 'resend'
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { timingSafeEqual } from 'crypto'

export const runtime = 'nodejs'

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null
const NOTIFY_TO = process.env.NOTIFY_TO || 'ciberdgor@gmail.com'

// ── Autorización ────────────────────────────────────────────────────────────
// Antes cualquiera que conociera la URL podía mandarte correos con el contenido que quisiera
// (y gastar tu cuota de Resend). Ahora se exige UNA de estas dos cosas:
//   1) cabecera  x-notify-secret: <NOTIFY_SECRET>   → para el cron / Edge Function de Supabase
//   2) cabecera  Authorization: Bearer <access_token> de una sesión válida → para la app
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a), bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

async function isAuthorized(request: Request): Promise<boolean> {
  const secret = process.env.NOTIFY_SECRET
  const provided = request.headers.get('x-notify-secret')
  if (secret && provided && safeEqual(provided, secret)) return true

  const auth = request.headers.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (token && url && anon) {
    try {
      const { data, error } = await createClient(url, anon).auth.getUser(token)
      return !error && !!data.user
    } catch { /* se trata como no autorizado */ }
  }
  return false
}

// ── Límite de envíos (en memoria; basta para frenar un abuso accidental) ────
const WINDOW_MS = 60 * 60 * 1000
const MAX_PER_WINDOW = 40
let sent: number[] = []
function rateLimited(): boolean {
  const now = Date.now()
  sent = sent.filter(t => now - t < WINDOW_MS)
  if (sent.length >= MAX_PER_WINDOW) return true
  sent.push(now)
  return false
}

// ── Utilidades ──────────────────────────────────────────────────────────────
// Todo lo que viene en el cuerpo se escapa antes de entrar al HTML del correo
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const TICKER_RE = /^[A-Z0-9.\-^=]{1,15}$/

export async function POST(request: Request) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  if (!resend) {
    return NextResponse.json({ error: 'Resend no configurado' }, { status: 503 })
  }

  let body: any
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const ticker = String(body?.ticker ?? '').trim().toUpperCase()
  const type = String(body?.type ?? '').trim().toUpperCase().slice(0, 40)
  const price = Number(body?.currentPrice)
  const target = Number(body?.targetPrice)
  const rsiNum = body?.rsi == null || body.rsi === '' ? null : Number(body.rsi)

  if (!TICKER_RE.test(ticker))              return NextResponse.json({ error: 'Ticker inválido' }, { status: 400 })
  if (!type)                                return NextResponse.json({ error: 'Falta el tipo de alerta' }, { status: 400 })
  if (!Number.isFinite(price) || price < 0) return NextResponse.json({ error: 'Precio actual inválido' }, { status: 400 })
  if (!Number.isFinite(target) || target < 0) return NextResponse.json({ error: 'Precio objetivo inválido' }, { status: 400 })
  if (rsiNum !== null && !Number.isFinite(rsiNum)) return NextResponse.json({ error: 'RSI inválido' }, { status: 400 })

  if (rateLimited()) {
    return NextResponse.json({ error: 'Demasiadas notificaciones, intenta más tarde' }, { status: 429 })
  }

  // Colores dinámicos: Verde para entradas, Rojo para Stop, Amarillo para TP
  const isEntry = type.includes('ENTRADA')
  const isStop = type.includes('STOP') || type.includes('VENTA')
  const accentColor = isEntry ? '#22c55e' : isStop ? '#f43f5e' : '#eab308'

  const safeType = esc(type)
  const safeTicker = esc(ticker)
  const safePrice = price.toFixed(2)
  const safeTarget = target.toFixed(2)
  const safeRsi = rsiNum === null ? 'N/A' : rsiNum.toFixed(1)

  try {
    const { error } = await resend.emails.send({
      from: 'Trading Cat <onboarding@resend.dev>',
      to: NOTIFY_TO,
      // Sin saltos de línea en el asunto (evita inyección de cabeceras)
      subject: `${type.replace(/[\r\n]/g, ' ')}: ${ticker}`,
      html: `
        <div style="font-family: sans-serif; background: #000; color: #fff; padding: 30px; border-radius: 15px; border: 1px solid #222;">
          <h1 style="color: ${accentColor}; margin-bottom: 10px; font-size: 24px;">${safeType}</h1>
          <p style="color: #888; font-size: 16px;">Movimiento detectado en <strong>${safeTicker}</strong></p>

          <div style="background: #111; padding: 25px; border-radius: 10px; margin-top: 20px; border: 1px solid #333;">
            <p style="font-size: 1.2rem; margin: 10px 0;">💰 Precio Actual: <strong style="color: #fff;">$${safePrice}</strong></p>
            <p style="font-size: 1.2rem; margin: 10px 0;">🎯 Objetivo: <strong style="color: #fff;">$${safeTarget}</strong></p>
            <p style="font-size: 1.1rem; margin: 10px 0;">📊 RSI: <strong style="color: #fff;">${safeRsi}</strong></p>
          </div>

          <p style="font-size: 0.8rem; color: #444; margin-top: 25px; border-top: 1px solid #222; padding-top: 15px;">
            Trading Cat System • Notificación Automática
          </p>
        </div>
      `,
    })

    if (error) {
      console.error('Resend error:', error)
      return NextResponse.json({ error: 'No se pudo enviar el correo' }, { status: 502 })
    }
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('notify error:', e)
    return NextResponse.json({ error: 'Error de servidor' }, { status: 500 })
  }
}