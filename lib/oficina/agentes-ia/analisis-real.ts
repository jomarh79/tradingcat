// Análisis del Fundamental (y el Director) con datos reales traídos por el servidor. SOLO analiza: no lee ni escribe en Supabase, no guarda y no opera.
// [PROPUESTA] El Director recibe SOLO el análisis del Fundamental, el ticker y el código de portafolio elegido. NUNCA se añaden posiciones, capital ni datos del
// portafolio del usuario mientras se use la capa gratuita de Gemini (Google puede usar lo enviado para entrenar).
import { CLAVES_ANALISIS_REAL } from './constantes';
import { obtenerDatosFundamental } from './datos-reales';
import type { DepsDatosReales } from './datos-reales';
import { PORTAFOLIOS_PRUEBA, TICKER_PRUEBA_RE, ejecutarPruebaFundamental } from './prueba-fundamental';
import type { DepsPrueba, ResultadoPrueba } from './prueba-fundamental';
import { esObjeto } from './utilidades';

export interface CuerpoAnalisis { ticker: string; con_director?: boolean; portafolio?: string; guardar: boolean; monto?: string }
export type ResultadoCuerpo = { ok: true; cuerpo: CuerpoAnalisis } | { ok: false; error: string };

/** Valida el cuerpo de la ruta de análisis (con o sin guardado) antes de traer datos o llamar a un modelo. */
export function validarCuerpoAnalisis(body: unknown): ResultadoCuerpo {
  const bad = (error: string): ResultadoCuerpo => ({ ok: false, error });
  if (!esObjeto(body)) return bad('el cuerpo debe ser un objeto JSON');
  const extra = Object.keys(body).filter(k => !(CLAVES_ANALISIS_REAL as readonly string[]).includes(k));
  if (extra.length > 0) return bad(`campos no permitidos: ${extra.join(', ')}`);
  const ticker = typeof body['ticker'] === 'string' ? body['ticker'].trim().toUpperCase() : '';
  if (!TICKER_PRUEBA_RE.test(ticker)) return bad('ticker inválido');
  if (body['con_director'] !== undefined && typeof body['con_director'] !== 'boolean') return bad('con_director debe ser booleano');
  if (body['portafolio'] !== undefined && !(PORTAFOLIOS_PRUEBA as readonly unknown[]).includes(body['portafolio'])) return bad(`portafolio debe ser ${PORTAFOLIOS_PRUEBA.join('|')}`);
  if (body['guardar'] !== undefined && typeof body['guardar'] !== 'boolean') return bad('guardar debe ser booleano');
  // v0.21: monto de la operación que declara el usuario en cada corrida (USD, positivo, hasta 2 decimales). No hay monto por omisión.
  let monto: string | undefined;
  if (body['monto'] !== undefined) {
    const m = body['monto'];
    const t = typeof m === 'number' && Number.isFinite(m) ? String(m) : typeof m === 'string' ? m.trim() : '';
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(t) || Number(t) <= 0) return bad('monto debe ser un número positivo en USD con hasta 2 decimales');
    monto = t;
  }
  return {
    ok: true,
    cuerpo: {
      ticker, guardar: body['guardar'] === true,
      ...(body['con_director'] !== undefined ? { con_director: body['con_director'] as boolean } : {}),
      ...(body['portafolio'] !== undefined ? { portafolio: body['portafolio'] as string } : {}),
      ...(monto !== undefined ? { monto } : {}),
    },
  };
}

export async function ejecutarAnalisisReal(deps: DepsPrueba, datosDeps: DepsDatosReales, body: unknown): Promise<ResultadoPrueba> {
  const v = validarCuerpoAnalisis(body);
  if (!v.ok) return { http: 400, cuerpo: { ok: false, error: v.error } };
  if (v.cuerpo.monto !== undefined) return { http: 400, cuerpo: { ok: false, error: 'monto solo aplica con guardar: sin guardar no corre el Auditor' } };
  if (v.cuerpo.guardar) return { http: 400, cuerpo: { ok: false, error: 'guardar requiere la conexión con la base de datos: usa la ruta con sesión' } };
  const { ticker } = v.cuerpo;

  const d = await obtenerDatosFundamental(datosDeps, ticker);
  if (!d.ok) return { http: d.http, cuerpo: { ok: false, error: d.error } };
  const { fuentes, ...resto } = d.datos;
  const pasa: Record<string, unknown> = { ...resto, ticker };
  if (v.cuerpo.con_director !== undefined) pasa['con_director'] = v.cuerpo.con_director;
  if (v.cuerpo.portafolio !== undefined) pasa['portafolio'] = v.cuerpo.portafolio;
  const r = await ejecutarPruebaFundamental(deps, pasa);
  return { http: r.http, cuerpo: { ...r.cuerpo, fuentes } };
}
