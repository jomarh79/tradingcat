import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { isOwnerRequest } from '@/lib/api-auth'
import { MIN_ESPERA_PRUEBA_MS, ejecutarAnalisisReal, leerConfigDatos, resolverProveedorIa } from '@/lib/oficina/agentes-ia'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Webull + 3 llamadas a Finnhub + 2 llamadas al modelo pueden tardar varios minutos en conjunto.
export const maxDuration = 300

/**
 * POST /api/oficina/analisis-fundamental
 * Cabecera: Authorization: Bearer <access_token de la sesión de Supabase>
 * Body: { "ticker": "GKOS", "con_director": true, "portafolio": "PMP" }   (con_director y portafolio son opcionales)
 *
 * El servidor trae solo los datos: estado de resultados de Webull (llamando a /api/webull/income-statement con el token del dueño) y balance, flujo de caja
 * y ratios de Finnhub (clave solo servidor, variable FINNHUB_API_KEY). Luego corre el Analista Fundamental y el Director con el proveedor de IA elegido.
 * SOLO analiza: no lee ni escribe en Supabase, no guarda análisis y no opera. Al Director NUNCA se le envían posiciones ni datos del portafolio del usuario.
 * No devuelve ni registra claves ni tokens (solo NOMBRES de variables que falten).
 */

let lastCall = 0

export async function POST(request: Request) {
  if (!(await isOwnerRequest(request))) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  const authorization = request.headers.get('authorization')
  if (!authorization) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const config = resolverProveedorIa(process.env)
  if (!config.ok) {
    console.error('oficina/analisis-fundamental: falta configuración del proveedor de IA')
    return NextResponse.json({ ok: false, error: `Servidor sin configurar. Faltan: ${config.faltan.join(', ')}` }, { status: 500 })
  }
  const datos = leerConfigDatos(process.env)
  if (!datos.ok) {
    console.error('oficina/analisis-fundamental: falta configuración de datos')
    return NextResponse.json({ ok: false, error: `Servidor sin configurar. Faltan: ${datos.faltan.join(', ')}` }, { status: 500 })
  }

  const body: unknown = await request.json().catch(() => null)

  const now = Date.now()
  if (now - lastCall < MIN_ESPERA_PRUEBA_MS) {
    return NextResponse.json({ error: 'Demasiado pronto, espera unos segundos' }, { status: 429 })
  }
  lastCall = now

  try {
    const r = await ejecutarAnalisisReal(
      {
        llamar: config.llamar,
        proveedor: config.proveedor,
        modelo_analista: config.modelo_analista,
        modelo_director: config.modelo_director,
        nuevoId: () => randomUUID(),
        ahora: () => new Date().toISOString(),
      },
      { fetchFn: fetch, origen: datos.base_url ?? new URL(request.url).origin, authorization, finnhub_key: datos.finnhub_key },
      body,
    )
    return NextResponse.json(r.cuerpo, { status: r.http })
  } catch (e) {
    // Solo el tipo de error: el mensaje podría contener datos de la petición.
    console.error('oficina/analisis-fundamental: error inesperado', e instanceof Error ? e.name : 'desconocido')
    return NextResponse.json({ ok: false, error: 'Error inesperado' }, { status: 500 })
  }
}
