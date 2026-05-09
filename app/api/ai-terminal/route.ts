import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { ticker } = body

    if (!process.env.OPENROUTER_API_KEY) {
      return NextResponse.json(
        { ok: false, error: 'Falta API KEY' },
        { status: 500 }
      )
    }

    const prompt = `
Actúa como un terminal Bloomberg institucional con IA.

El usuario tiene una posición en ${ticker}.

Devuelve ÚNICAMENTE un JSON válido con esta estructura:

{
  "content": "🏢 EMPRESA\\nTexto...\\n\\n⚙️ PRODUCTOS / SERVICIOS\\n- item\\n- item\\n\\n📰 NOTICIAS RECIENTES\\n- noticia\\n- noticia\\n\\n📊 SENTIMIENTO FINANCIERO\\nTexto...",
  "similarTickers": ["AAA","BBB","CCC"]
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

Reglas:
- Responde SOLO JSON válido
- No markdown
- No bloques de código
- No texto fuera del JSON
- Español profesional
- Tono ejecutivo institucional
- Máximo 500 palabras
`

    const response = await fetch(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:3000',
        },
        body: JSON.stringify({
          model: 'openrouter/free',
          temperature: 0.1,
          max_tokens: 400,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ]
        })
      }
    )

    const data = await response.json()
    if (!response.ok) {
      console.log('OPENROUTER ERROR:')
      console.log(JSON.stringify(data, null, 2))

      return NextResponse.json({
        ok: false,
        error: `OpenRouter ${response.status}`
      })
    }

    console.log('FULL OPENROUTER RESPONSE ----------------')
    console.dir(data, { depth: null })
    console.log('----------------------------------------')
    const raw =
      data?.choices?.[0]?.message?.content || ''

    try {
      const start = raw.indexOf('{')
      const end = raw.lastIndexOf('}') + 1

      const cleanJson = raw.substring(start, end)

      const parsed = JSON.parse(cleanJson)

      return NextResponse.json({
        ok: true,
        content: parsed.content || '',
        similarTickers: parsed.similarTickers || []
      })

    } catch (e) {
      console.error('ERROR PARSEANDO:')
      console.error(raw)

      return NextResponse.json({
        ok: true,
        content: raw,
        similarTickers: []
      })
    }

  } catch (err: any) {
    console.error('ERROR REAL:')
    console.error(err)

    return NextResponse.json(
      {
        ok: false,
        error: err?.message || 'Error interno'
      },
      {
        status: 500
      }
    )
  }
}