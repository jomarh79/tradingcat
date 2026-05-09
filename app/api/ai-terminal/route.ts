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
Actúa como terminal Bloomberg profesional.

Ticker: ${ticker}

Responde ÚNICAMENTE un JSON válido con este formato:

{
  "content": "Resumen ejecutivo corto del activo",
  "similarTickers": ["AMD","INTC","TSM"]
}

NO markdown.
NO bloques de código.
SOLO JSON válido.
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