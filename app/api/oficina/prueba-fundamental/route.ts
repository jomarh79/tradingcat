import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { isOwnerRequest } from '@/lib/api-auth'
import { MIN_ESPERA_PRUEBA_MS, ejecutarPruebaFundamental, resolverProveedorIa } from '@/lib/oficina/agentes-ia'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/oficina/prueba-fundamental
 * Cabecera: Authorization: Bearer <access_token de la sesión de Supabase>
 * Body: { "ticker": "GKOS", "income_statement": <JSON de /api/webull/income-statement?symbol=GKOS>,
 *         "items_extra": [ { id, campo, valor, unidad, fuente, fecha_dato } ]  (opcional, datos puestos a mano),
 *         "con_director": true, "portafolio": "PMP" }
 *
 * Prueba de punta a punta del Analista Fundamental (y el Director) con el proveedor de IA elegido en PROVEEDOR_IA (openai o gemini) y datos entregados en la petición.
 * SOLO analiza: no lee ni escribe en Supabase, no guarda análisis y no opera. Cuesta llamadas al proveedor de IA: solo el dueño, con espera mínima.
 * No devuelve ni registra claves ni tokens (solo se leen los NOMBRES de variables que falten).
 */

let lastCall = 0

export async function POST(request: Request) {
  if (!(await isOwnerRequest(request))) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const config = resolverProveedorIa(process.env)
  if (!config.ok) {
    console.error('oficina/prueba-fundamental: falta configuración del proveedor de IA')
    return NextResponse.json({ ok: false, error: `Servidor sin configurar. Faltan: ${config.faltan.join(', ')}` }, { status: 500 })
  }

  const body: unknown = await request.json().catch(() => null)

  const now = Date.now()
  if (now - lastCall < MIN_ESPERA_PRUEBA_MS) {
    return NextResponse.json({ error: 'Demasiado pronto, espera unos segundos' }, { status: 429 })
  }
  lastCall = now

  try {
    const r = await ejecutarPruebaFundamental(
      {
        llamar: config.llamar,
        proveedor: config.proveedor,
        modelo_analista: config.modelo_analista,
        modelo_director: config.modelo_director,
        nuevoId: () => randomUUID(),
        ahora: () => new Date().toISOString(),
      },
      body,
    )
    return NextResponse.json(r.cuerpo, { status: r.http })
  } catch (e) {
    // Solo el tipo de error: el mensaje podría contener datos de la petición.
    console.error('oficina/prueba-fundamental: error inesperado', e instanceof Error ? e.name : 'desconocido')
    return NextResponse.json({ ok: false, error: 'Error inesperado' }, { status: 500 })
  }
}
