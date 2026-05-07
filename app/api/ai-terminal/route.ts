import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const body = await request.json()

    const {
      ticker,
      country,
      sector,
      subsector,
    } = body

    const response = await fetch(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'mistralai/mistral-7b-instruct',
          messages: [
            {
              role: 'system',
              content:
                'Actúa como un terminal Bloomberg con IA profesional. Responde en español de forma ejecutiva, clara y resumida.',
            },
            {
              role: 'user',
              content: `
Ticker: ${ticker}
País: ${country}
Sector: ${sector}
Subsector: ${subsector}

Devuelve:

1. Nombre completo y descripción breve.
2. Productos o servicios principales.
3. Noticias relevantes recientes.
4. Tickers similares.
5. Sentimiento financiero actual.
`,
            },
          ],
          temperature: 0.4,
          max_tokens: 500,
        }),
      }
    )

    const data = await response.json()

    return NextResponse.json({
      ok: true,
      content:
        data?.choices?.[0]?.message?.content ??
        'No se pudo generar respuesta IA',
    })

  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: err?.message ?? 'Error IA terminal',
      },
      {
        status: 500,
      }
    )
  }
}