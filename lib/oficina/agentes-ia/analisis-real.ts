// Análisis del Fundamental (y el Director) con datos reales traídos por el servidor. SOLO analiza: no lee ni escribe en Supabase, no guarda y no opera.
// [PROPUESTA] El Director recibe SOLO el análisis del Fundamental, el ticker y el código de portafolio elegido. NUNCA se añaden posiciones, capital ni datos del
// portafolio del usuario mientras se use la capa gratuita de Gemini (Google puede usar lo enviado para entrenar).
import { CLAVES_ANALISIS_REAL } from './constantes';
import { obtenerDatosFundamental } from './datos-reales';
import type { DepsDatosReales } from './datos-reales';
import { PORTAFOLIOS_PRUEBA, TICKER_PRUEBA_RE, ejecutarPruebaFundamental } from './prueba-fundamental';
import type { DepsPrueba, ResultadoPrueba } from './prueba-fundamental';
import { esObjeto } from './utilidades';

export async function ejecutarAnalisisReal(deps: DepsPrueba, datosDeps: DepsDatosReales, body: unknown): Promise<ResultadoPrueba> {
  const bad = (error: string): ResultadoPrueba => ({ http: 400, cuerpo: { ok: false, error } });
  if (!esObjeto(body)) return bad('el cuerpo debe ser un objeto JSON');
  const extra = Object.keys(body).filter(k => !(CLAVES_ANALISIS_REAL as readonly string[]).includes(k));
  if (extra.length > 0) return bad(`campos no permitidos: ${extra.join(', ')}`);
  const ticker = typeof body['ticker'] === 'string' ? body['ticker'].trim().toUpperCase() : '';
  if (!TICKER_PRUEBA_RE.test(ticker)) return bad('ticker inválido');
  if (body['con_director'] !== undefined && typeof body['con_director'] !== 'boolean') return bad('con_director debe ser booleano');
  if (body['portafolio'] !== undefined && !(PORTAFOLIOS_PRUEBA as readonly unknown[]).includes(body['portafolio'])) return bad(`portafolio debe ser ${PORTAFOLIOS_PRUEBA.join('|')}`);

  const d = await obtenerDatosFundamental(datosDeps, ticker);
  if (!d.ok) return { http: d.http, cuerpo: { ok: false, error: d.error } };
  const { fuentes, ...resto } = d.datos;
  const pasa: Record<string, unknown> = { ...resto, ticker };
  if (body['con_director'] !== undefined) pasa['con_director'] = body['con_director'];
  if (body['portafolio'] !== undefined) pasa['portafolio'] = body['portafolio'];
  const r = await ejecutarPruebaFundamental(deps, pasa);
  return { http: r.http, cuerpo: { ...r.cuerpo, fuentes } };
}
