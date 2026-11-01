// Prueba controlada de punta a punta del Fundamental (y opcionalmente el Director) con OpenAI y datos entregados a mano.
// SOLO analiza: no lee ni escribe en Supabase, no guarda análisis (modo simulado: el guardado devuelve un id de relleno que NUNCA se expone) y no opera.
// La ruta POST /api/oficina/prueba-fundamental es solo el pegamento: valida al dueño y llama a `ejecutarPruebaFundamental`.
import {
  AGENTE_FUNDAMENTAL, MAX_ITEMS_EXTRA, MERCADO_PRUEBA, PORTAFOLIO_PRUEBA_POR_OMISION, TIPO_EVALUACION_PRUEBA,
} from './constantes';
import type { LlamadaModelo } from './cliente-openai';
import { armarSobreFundamental, itemsDesdeIncomeStatement } from './datos-fundamental';
import { crearPuertoAnalista, crearPuertoDirector } from './puertos-ia';
import { esObjeto, resumirErrores } from './utilidades';
import { validarSobreFundamental } from './validar-fundamental';
import type { ItemDato } from './validar-fundamental';
import type { ContextoDirector } from '../orquestador/corrida';
import type { PortafolioCodigo } from '../motor/tipos';

export const TICKER_PRUEBA_RE = /^[A-Z0-9][A-Z0-9.\-]{0,9}$/;
export const PORTAFOLIOS_PRUEBA: readonly PortafolioCodigo[] = ['PMP', 'PCP', 'PLP', 'ETF', 'SEMILLA'];
const CLAVES_PERMITIDAS = ['ticker', 'income_statement', 'items_extra', 'con_director', 'portafolio'];
/** Id de relleno del guardado simulado. Nunca sale en la respuesta. */
const ID_SIMULADO = '00000000-0000-4000-8000-000000000000';

export interface DepsPrueba {
  llamar: LlamadaModelo; modelo_analista: string; modelo_director: string;
  nuevoId: () => string; ahora: () => string;
  /** Proveedor para la trazabilidad (opcional; por omisión 'openai'). */
  proveedor?: string;
}
export interface ResultadoPrueba { http: number; cuerpo: Record<string, unknown> }

function resumenAgente(r: { estado: string; error?: string; veredicto?: string; salida?: unknown; proveedor?: string; modelo?: string; tokens_in?: number; tokens_out?: number }): Record<string, unknown> {
  return {
    estado: r.estado, ...(r.error !== undefined ? { error: r.error } : {}), ...(r.veredicto !== undefined ? { veredicto: r.veredicto } : {}),
    ...(r.proveedor !== undefined ? { proveedor: r.proveedor } : {}), ...(r.modelo !== undefined ? { modelo: r.modelo } : {}), ...(r.tokens_in !== undefined ? { tokens_in: r.tokens_in } : {}),
    ...(r.tokens_out !== undefined ? { tokens_out: r.tokens_out } : {}), ...(r.salida !== undefined ? { salida: r.salida } : {}),
  };
}

export async function ejecutarPruebaFundamental(deps: DepsPrueba, body: unknown): Promise<ResultadoPrueba> {
  const bad = (error: string): ResultadoPrueba => ({ http: 400, cuerpo: { ok: false, error } });
  if (!esObjeto(body)) return bad('el cuerpo debe ser un objeto JSON');
  const extra = Object.keys(body).filter(k => !CLAVES_PERMITIDAS.includes(k));
  if (extra.length > 0) return bad(`campos no permitidos: ${extra.join(', ')}`);
  const ticker = typeof body['ticker'] === 'string' ? body['ticker'].trim().toUpperCase() : '';
  if (!TICKER_PRUEBA_RE.test(ticker)) return bad('ticker inválido');
  const conDirector = body['con_director'] === undefined ? true : body['con_director'];
  if (typeof conDirector !== 'boolean') return bad('con_director debe ser booleano');
  const portafolio = body['portafolio'] === undefined ? PORTAFOLIO_PRUEBA_POR_OMISION : body['portafolio'];
  if (typeof portafolio !== 'string' || !(PORTAFOLIOS_PRUEBA as readonly string[]).includes(portafolio)) return bad(`portafolio debe ser ${PORTAFOLIOS_PRUEBA.join('|')}`);
  const itemsExtra = body['items_extra'] === undefined ? [] : body['items_extra'];
  if (!Array.isArray(itemsExtra) || itemsExtra.length > MAX_ITEMS_EXTRA) return bad(`items_extra debe ser una lista de máximo ${MAX_ITEMS_EXTRA} elementos`);

  const run_id = deps.nuevoId();
  const snapshot_id = deps.nuevoId();
  const generado_en = deps.ahora();
  const datos = itemsDesdeIncomeStatement(body['income_statement'], { generado_en });
  if (!datos.ok) return { http: 422, cuerpo: { ok: false, error: `datos insuficientes: ${resumirErrores(datos.errores, 5)}` } };
  const items = (datos.items as ItemDato[]).concat(itemsExtra as ItemDato[]);
  const sobre = armarSobreFundamental({ run_id, snapshot_id, generado_en, ticker, mercado: MERCADO_PRUEBA, items, tesis_vigente: null });
  const valido = validarSobreFundamental(sobre);
  if (!valido.ok) return { http: 422, cuerpo: { ok: false, error: `el sobre no es válido: ${resumirErrores(valido.errores, 8)}` } };

  const simulado = async (): Promise<{ ok: true; analisis_id: string }> => ({ ok: true, analisis_id: ID_SIMULADO });
  const opc = { llamar: deps.llamar, modelo_analista: deps.modelo_analista, modelo_director: deps.modelo_director, ahora: deps.ahora, guardar_analista: simulado, guardar_director: simulado, ...(deps.proveedor !== undefined ? { proveedor: deps.proveedor } : {}) };
  const rf = await crearPuertoAnalista(opc)(AGENTE_FUNDAMENTAL, valido.valor);
  const cuerpo: Record<string, unknown> = {
    ok: true, ticker, guardado: false, items: items.length, avisos_datos: datos.avisos, fundamental: resumenAgente(rf),
  };
  if (!conDirector) return { http: 200, cuerpo };
  if (rf.estado !== 'ok') return { http: 200, cuerpo: { ...cuerpo, director: { estado: 'omitido', motivo: 'el Fundamental no produjo una salida validada' } } };
  const contexto: ContextoDirector = {
    run_id, snapshot_id, ticker, mercado: MERCADO_PRUEBA, portafolio_codigo: portafolio as PortafolioCodigo, tipo_evaluacion: TIPO_EVALUACION_PRUEBA,
    salidas_analistas: { [AGENTE_FUNDAMENTAL]: rf.salida }, auditoria: null, reglas_versiones_ids: [], contexto: null,
  };
  const rd = await crearPuertoDirector(opc)(contexto);
  return { http: 200, cuerpo: { ...cuerpo, director: resumenAgente(rd) } };
}
