import { NextResponse } from 'next/server'

import { isOwnerRequest } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

const MODEL = 'openrouter/free'
const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.\-]{0,11}$/
// Un poco menos que el timeout del panel (60 s) para que el error llegue como JSON y no como corte
const FETCH_TIMEOUT_MS = 55_000
const MAX_TOKENS = 1200 // 500 palabras en español + JSON no caben en 400 tokens: la respuesta salía cortada

// Mismo ticker = mismo análisis durante un rato: ahorra llamadas al modelo gratuito (que tiene límites)
const TTL_MS = 3 * 60 * 60 * 1000
const MAX_ENTRIES = 100
type Payload = { content: string; similarTickers: string[] }
const cache = new Map<string, { expires: number; data: Payload }>()
const inflight = new Map<string, Promise<{ data: Payload; cacheable: boolean }>>()

// Texto corto y sin saltos de línea para meterlo en el prompt (evita inyectar instrucciones por los campos)
const clean = (v: unknown, max = 60): string =>
  typeof v === 'string' ? v.replace(/[\r\n"`{}]/g, ' ').trim().slice(0, max) : ''
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : null
}

class UpstreamError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

function buildPrompt(ticker: string, ctx: { country: string; sector: string; subsector: string; rsi: number | null }) {
  const lines = [
    ctx.country && `País: ${ctx.country}`,
    ctx.sector && `Sector: ${ctx.sector}`,
    ctx.subsector && `Subsector: ${ctx.subsector}`,
    ctx.rsi != null && `RSI actual: ${ctx.rsi.toFixed(1)}`,
  ].filter(Boolean)

  return `Actúa como un terminal Bloomberg institucional con IA.

El usuario tiene una posición en ${ticker}.${lines.length ? `\nContexto conocido:\n${lines.join('\n')}` : ''}

Devuelve ÚNICAMENTE un JSON válido con esta estructura:

{
  "content": "🏢 EMPRESA\\nTexto...\\n\\n⚙️ PRODUCTOS / SERVICIOS\\n- item\\n- item\\n\\n📰 NOTICIAS RECIENTES\\n- noticia\\n- noticia\\n\\n📊 SENTIMIENTO FINANCIERO\\nTexto...",
  "similarTickers": ["AAA","BBB","CCC","DDD","EEE"]
}

Dentro de "content" genera EXACTAMENTE estas secciones:

🏢 EMPRESA
Nombre completo de la empresa y descripción ejecutiva en 2-3 líneas.

⚙️ PRODUCTOS / SERVICIOS
- Producto o servicio principal
- Producto o servicio principal
- Producto o servicio principal

📰 NOTICIAS RECIENTES
- Catalizador reciente
- Riesgo o noticia relevante
- Tendencia importante

📊 SENTIMIENTO FINANCIERO
Resumen de sentimiento, momentum, analistas y riesgos en 3-4 líneas.

En "similarTickers" pon 5 símbolos bursátiles de empresas comparables a ${ticker} (sin incluir ${ticker}).

Reglas:
- Responde SOLO JSON válido
- Dentro de "content" usa \\n para los saltos de línea
- No markdown, no bloques de código, no texto fuera del JSON
- No tienes acceso a internet: no inventes fechas, cifras ni noticias concretas; si no estás seguro, describe tendencias generales del negocio y dilo
- Español profesional, tono ejecutivo institucional
- Máximo 500 palabras`
}

async function generate(ticker: string, ctx: Parameters<typeof buildPrompt>[1], referer: string) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': referer,
      'X-Title': 'TradingCat',
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.1,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: buildPrompt(ticker, ctx) }],
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    // Solo el estado y el mensaje del proveedor; no se vuelca la respuesta completa al log
    console.error('OpenRouter', response.status, data?.error?.message ?? '')
    throw new UpstreamError(
      response.status === 429 ? 'Límite del proveedor de IA alcanzado, intenta en un momento' : `OpenRouter ${response.status}`,
      response.status === 429 ? 429 : 502
    )
  }

  const raw: string = data?.choices?.[0]?.message?.content || ''
  if (!raw.trim()) throw new UpstreamError('La IA devolvió una respuesta vacía', 502)

  try {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}') + 1
    const parsed = JSON.parse(raw.substring(start, end))

    const content = typeof parsed.content === 'string' ? parsed.content : ''
    if (!content.trim()) throw new Error('sin content')

    const similarTickers = (Array.isArray(parsed.similarTickers) ? parsed.similarTickers : [])
      .map((t: unknown) => String(t ?? '').toUpperCase().trim())
      .filter((t: string, i: number, arr: string[]) => SYMBOL_RE.test(t) && t !== ticker && arr.indexOf(t) === i)
      .slice(0, 5)

    return { data: { content, similarTickers }, cacheable: true }
  } catch {
    // JSON mal formado o cortado: se muestra el texto tal cual, pero no se guarda en caché
    console.error('No se pudo parsear la respuesta de la IA para', ticker)
    return { data: { content: raw, similarTickers: [] }, cacheable: false }
  }
}

export async function POST(request: Request) {
    if (!(await isOwnerRequest(request))) {
    return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 })
  }
  try {
    if (!process.env.OPENROUTER_API_KEY) {
      return NextResponse.json({ ok: false, error: 'Falta OPENROUTER_API_KEY' }, { status: 500 })
    }

    const body = await request.json().catch(() => null)
    const ticker = String(body?.ticker ?? '').toUpperCase().trim()
    if (!SYMBOL_RE.test(ticker)) {
      return NextResponse.json({ ok: false, error: 'Ticker inválido' }, { status: 400 })
    }

    // El panel ya enviaba estos datos y la ruta los ignoraba
    const ctx = {
      country: clean(body?.country),
      sector: clean(body?.sector),
      subsector: clean(body?.subsector),
      rsi: num(body?.rsi),
    }

    // El contexto cambia poco: se cachea por ticker (el RSI no entra en la llave a propósito)
    const key = `${ticker}|${ctx.country}|${ctx.sector}|${ctx.subsector}`
    const hit = cache.get(key)
    if (hit && hit.expires > Date.now()) {
      return NextResponse.json({ ok: true, ...hit.data })
    }

    let pending = inflight.get(key)
    if (!pending) {
      const referer = request.headers.get('origin') || new URL(request.url).origin
      pending = generate(ticker, ctx, referer)
        .then((r) => {
          if (r.cacheable) {
            cache.set(key, { expires: Date.now() + TTL_MS, data: r.data })
            while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string)
          }
          return r
        })
        .finally(() => inflight.delete(key))
      inflight.set(key, pending)
    }

    const { data } = await pending
    return NextResponse.json({ ok: true, ...data })
  } catch (err: any) {
    if (err instanceof UpstreamError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status })
    }
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      return NextResponse.json({ ok: false, error: 'La IA tardó demasiado en responder, intenta de nuevo' }, { status: 504 })
    }
    console.error('ai-terminal:', err)
    return NextResponse.json({ ok: false, error: err?.message || 'Error interno' }, { status: 500 })
  }
}