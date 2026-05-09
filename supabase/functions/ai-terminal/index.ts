import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { ticker, country, sector, subsector, rsi, entry_price, quantity } = body

    if (!process.env.OPENROUTER_API_KEY) {
      return NextResponse.json(
        { ok: false, error: 'OPENROUTER_API_KEY no configurada en .env.local' },
        { status: 500 }
      )
    }

    const rsiLine     = rsi         ? `RSI actual: ${Number(rsi).toFixed(1)}` : ''
    const entryLine   = entry_price ? `Precio de entrada: $${Number(entry_price).toFixed(2)}` : ''
    const qtyLine     = quantity    ? `Cantidad en cartera: ${quantity} acciones` : ''

    const prompt = `Actúa como un terminal de Bloomberg con IA. El usuario tiene una posición en ${ticker}.

Contexto:
- País: ${country || 'No especificado'}
- Sector: ${sector || 'No especificado'}
- Subsector: ${subsector || 'No especificado'}
${rsiLine}
${entryLine}
${qtyLine}

Devuelve un resumen ejecutivo escaneable en español con EXACTAMENTE estas secciones:

🏢 EMPRESA
Nombre completo y descripción breve en 2-3 líneas.

⚙️ PRODUCTOS / SERVICIOS
- Producto o servicio 1
- Producto o servicio 2
- Producto o servicio 3

📰 NOTICIAS RECIENTES
- Catalizador o noticia relevante 1
- Catalizador o noticia relevante 2
- Catalizador o noticia relevante 3

🔗 TICKERS SIMILARES
Devuelve entre 3 y 8 tickers similares, competidores o altamente correlacionados separados por coma.

📊 SENTIMIENTO FINANCIERO
Resumen del sentimiento actual, analistas, momentum y riesgos clave en 3-4 líneas.
${rsi ? `
💡 LECTURA RSI (${Number(rsi).toFixed(1)})
Interpretación del RSI actual para este activo en 2 líneas.` : ''}

Tono: profesional, directo, ejecutivo.

Al final responde ÚNICAMENTE en JSON válido con esta estructura:

{
  "content": "todo el análisis completo aquí",
  "similarTickers": ["AAA","BBB","CCC"]
}

No uses markdown.
No uses bloques de código.
No agregues texto fuera del JSON.
`

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type':  'application/json',
        'HTTP-Referer':  'https://tradingcat.onrender.com',
        'X-Title':       'TraderCat Terminal',
      },
      body: JSON.stringify({
        model:       'deepseek/deepseek-chat-v3-0324:free',
        temperature: 0.3,
        max_tokens:  800,
        messages: [
          {
            role:    'system',
            content: 'Eres un terminal Bloomberg institucional con IA. Respondes exclusivamente en español, de forma profesional, directa y estructurada. Nunca añades texto fuera de las secciones solicitadas.',
          },
          {
            role:    'user',
            content: prompt,
          },
        ],
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('OpenRouter error:', response.status, errText)
      return NextResponse.json(
        { ok: false, error: `Error API OpenRouter: ${response.status}` },
        { status: 502 }
      )
    }

    const data = await response.json()

  const raw =
    data?.choices?.[0]?.message?.content ?? ''

  console.log('RAW IA RESPONSE:')
  console.log(raw)

try {
  const parsed = JSON.parse(raw)

  return NextResponse.json({
    ok: true,
    content: parsed.content || '',
    similarTickers: parsed.similarTickers || [],
  })

} catch (e) {
  console.error('Error parseando JSON IA:', raw)

  return NextResponse.json({
    ok: true,
    content: raw,
    similarTickers: [],
  })
}

  } catch (err: any) {
    console.error('AI Terminal error:', err)
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Error interno del servidor' },
      { status: 500 }
    )
  }
}