// Lectura de corridas para la pantalla /oficina (SOLO LECTURA: no inserta, no actualiza, no borra, no opera).
// Cliente inyectado (sesión del usuario; el RLS aplica). Devuelve datos ya recortados y con forma estable para la pantalla.

import { esUuid } from '../orquestador/persistencia';

/** Lo mínimo de supabase-js que usa este módulo (encadenado: select → filtros → order → limit, y se espera con await). */
export interface ClienteLectura {
  from(tabla: string): any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export const LIMITE_LISTA_DEFECTO = 50;
export const LIMITE_LISTA_MAXIMO = 100;
const MAX_TEXTOS_POR_AGENTE = 8;
const MAX_LARGO_TEXTO = 400;

const COLUMNAS_LISTA =
  'id,corrida_id,version,ticker,portafolio_codigo,tipo_evaluacion,decision,estado_final,director_estado,auditoria_veredicto,iniciada_at,finalizada_at,motivos';

export interface CorridaResumen {
  id: string;
  corrida_id: string;
  version: number;
  ticker: string | null;
  portafolio_codigo: string | null;
  tipo_evaluacion: string | null;
  decision: string | null;
  estado_final: string;
  director_estado: string;
  auditoria_veredicto: string | null;
  iniciada_at: string;
  finalizada_at: string | null;
  motivos_total: number;
}

export interface ReglaAuditor { codigo: string; resultado: string; detalle: string }
export interface Motivo { codigo: string; detalle: string }
export interface AgenteDetalle {
  agente: string;
  estado: string;
  reintentos: number | null;
  error: string | null;
  veredicto: string | null;
  puntaje: number | null;
  confianza: string | number | null;
  textos: string[];
  negativos: string[];
}
export interface PlanSalidaPmp {
  total_salidas: number | null;
  hechas: number | null;
  siguiente: number | null;
  nivel_siguiente: string | null;
  precio_actual: string | null;
  confirmaciones_minimas: number | null;
  motivo: string | null;
  confirmaciones_nuevas: string[];
  faltantes: string[];
  exigida: { decision: string; porcentaje: number | null; detalle: string } | null;
}
export interface CorridaDetalle {
  corrida: CorridaResumen & { ruta: string | null; disparador: string | null; snapshot_fecha_datos: string | null };
  agentes: AgenteDetalle[];
  director: AgenteDetalle | null;
  reglas_auditor: ReglaAuditor[];
  motivos: Motivo[];
  datos_faltantes: string[];
  avisos: string[];
  datos_vencidos: string[];
  /** Plan de salidas de PMP (posición abierta); null si la corrida no lo calculó. */
  salida_pmp: PlanSalidaPmp | null;
}

export type ResultadoLectura<T> = { ok: true; datos: T } | { ok: false; http: number; error: string };

const esObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const txt = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Convierte un elemento libre (texto u objeto) en una línea corta legible. */
export function textoCorto(x: unknown): string {
  let s: string;
  if (typeof x === 'string') s = x;
  else if (esObj(x)) {
    const c = x['texto'] ?? x['descripcion'] ?? x['hallazgo'] ?? x['detalle'] ?? x['resumen'];
    s = typeof c === 'string' ? c : JSON.stringify(x);
  } else s = String(x);
  return s.length > MAX_LARGO_TEXTO ? `${s.slice(0, MAX_LARGO_TEXTO)}…` : s;
}

/** Solo letras, números, punto y guion; sin comodines de LIKE. */
export function limpiarTicker(v: unknown): string {
  return typeof v === 'string' ? v.toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 12) : '';
}

export function limiteSeguro(v: unknown): number {
  const n = typeof v === 'string' ? Number.parseInt(v, 10) : typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n) || n < 1) return LIMITE_LISTA_DEFECTO;
  return Math.min(Math.floor(n), LIMITE_LISTA_MAXIMO);
}

function resumenDe(f: Record<string, unknown>): CorridaResumen {
  return {
    id: String(f['id'] ?? ''), corrida_id: String(f['corrida_id'] ?? ''), version: typeof f['version'] === 'number' ? f['version'] : 1,
    ticker: txt(f['ticker']), portafolio_codigo: txt(f['portafolio_codigo']), tipo_evaluacion: txt(f['tipo_evaluacion']),
    decision: txt(f['decision']), estado_final: txt(f['estado_final']) ?? '', director_estado: txt(f['director_estado']) ?? '',
    auditoria_veredicto: txt(f['auditoria_veredicto']), iniciada_at: txt(f['iniciada_at']) ?? '', finalizada_at: txt(f['finalizada_at']),
    motivos_total: arr(f['motivos']).length,
  };
}

export async function listarCorridas(cliente: ClienteLectura, opc: { ticker?: unknown; limite?: unknown }): Promise<ResultadoLectura<CorridaResumen[]>> {
  const ticker = limpiarTicker(opc.ticker);
  let q = cliente.from('oficina_corridas_historial').select(COLUMNAS_LISTA);
  if (ticker !== '') q = q.ilike('ticker', `%${ticker}%`);
  const r = await q.order('iniciada_at', { ascending: false }).limit(limiteSeguro(opc.limite));
  if (r.error) return { ok: false, http: 500, error: 'No se pudieron leer las corridas' };
  const filas = arr(r.data).filter(esObj);
  return { ok: true, datos: filas.map(resumenDe) };
}

function agenteDe(reg: Record<string, unknown>, an: Record<string, unknown> | undefined): AgenteDetalle {
  const salida = an !== undefined && esObj(an['salida']) ? (an['salida'] as Record<string, unknown>) : {};
  const conf = an?.['confianza'];
  const puntaje = an?.['puntaje'];
  return {
    agente: txt(reg['agente']) ?? '',
    estado: txt(reg['estado']) ?? '',
    reintentos: typeof reg['reintentos'] === 'number' ? reg['reintentos'] : null,
    error: txt(reg['error']),
    veredicto: an !== undefined ? txt(an['veredicto']) : null,
    puntaje: typeof puntaje === 'number' ? puntaje : typeof puntaje === 'string' && puntaje !== '' && Number.isFinite(Number(puntaje)) ? Number(puntaje) : null,
    confianza: typeof conf === 'string' || typeof conf === 'number' ? conf : null,
    textos: arr(salida['hallazgos']).slice(0, MAX_TEXTOS_POR_AGENTE).map(textoCorto),
    negativos: arr(salida['negativos']).slice(0, MAX_TEXTOS_POR_AGENTE).map(textoCorto),
  };
}

const ORDEN_REGLA: Record<string, number> = { incumple: 0, no_evaluable: 1, cumple: 3 };

export function reglasDe(analisisAuditor: Record<string, unknown> | undefined): ReglaAuditor[] {
  if (analisisAuditor === undefined || !esObj(analisisAuditor['salida'])) return [];
  const reglas = arr((analisisAuditor['salida'] as Record<string, unknown>)['resultados_reglas']).filter(esObj).map(x => ({
    codigo: txt(x['codigo']) ?? '', resultado: txt(x['resultado']) ?? '', detalle: textoCorto(x['detalle'] ?? ''),
  }));
  return reglas.sort((a, b) => (ORDEN_REGLA[a.resultado] ?? 2) - (ORDEN_REGLA[b.resultado] ?? 2) || a.codigo.localeCompare(b.codigo));
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function planSalidaDe(ref: Record<string, unknown>): PlanSalidaPmp | null {
  const x = ref['salida_pmp'];
  if (!esObj(x)) return null;
  const e = x['exigida'];
  return {
    total_salidas: num(x['total_salidas']), hechas: num(x['hechas']), siguiente: num(x['siguiente']), nivel_siguiente: txt(x['nivel_siguiente']), precio_actual: txt(x['precio_actual']), confirmaciones_minimas: num(x['confirmaciones_minimas']), motivo: txt(x['motivo']),
    confirmaciones_nuevas: arr(x['confirmaciones_nuevas']).map(textoCorto), faltantes: arr(x['faltantes']).map(textoCorto),
    exigida: esObj(e) ? { decision: txt(e['decision']) ?? '', porcentaje: num(e['porcentaje']), detalle: textoCorto(e['detalle'] ?? '') } : null,
  };
}

export async function detalleCorrida(cliente: ClienteLectura, corrida_id: unknown): Promise<ResultadoLectura<CorridaDetalle>> {
  if (!esUuid(corrida_id)) return { ok: false, http: 400, error: 'Identificador de corrida inválido' };
  const rc = await cliente.from('oficina_corridas_historial').select('*').eq('corrida_id', corrida_id).order('version', { ascending: false }).limit(1);
  if (rc.error) return { ok: false, http: 500, error: 'No se pudo leer la corrida' };
  const fila = arr(rc.data).filter(esObj)[0];
  if (fila === undefined) return { ok: false, http: 404, error: 'Corrida no encontrada' };

  const registros = arr(fila['resultados_agentes']).filter(esObj);
  const ids = new Set<string>();
  for (const x of registros) if (esUuid(x['analisis_id'])) ids.add(x['analisis_id'] as string);
  for (const k of ['auditoria_analisis_id', 'director_analisis_id']) if (esUuid(fila[k])) ids.add(fila[k] as string);

  const porId = new Map<string, Record<string, unknown>>();
  if (ids.size > 0) {
    const ra = await cliente.from('oficina_analisis').select('id,agente,veredicto,puntaje,confianza,salida').in('id', [...ids]);
    if (ra.error) return { ok: false, http: 500, error: 'No se pudieron leer los análisis de la corrida' };
    for (const a of arr(ra.data).filter(esObj)) porId.set(String(a['id']), a);
  }
  const analisisDe = (id: unknown): Record<string, unknown> | undefined => (typeof id === 'string' ? porId.get(id) : undefined);

  const agentes = registros.map(x => agenteDe(x, analisisDe(x['analisis_id'])));
  const dAn = analisisDe(fila['director_analisis_id']);
  const director = dAn !== undefined
    ? { ...agenteDe({ agente: 'director', estado: txt(fila['director_estado']) ?? '' }, dAn), textos: [] as string[], negativos: [] as string[] }
    : null;
  const ref = esObj(fila['referencias']) ? (fila['referencias'] as Record<string, unknown>) : {};
  const motivos = arr(fila['motivos']).filter(esObj).map(m => ({ codigo: txt(m['codigo']) ?? '', detalle: textoCorto(m['detalle'] ?? '') }));

  return {
    ok: true,
    datos: {
      corrida: { ...resumenDe(fila), ruta: txt(fila['ruta']), disparador: txt(fila['disparador']), snapshot_fecha_datos: txt(fila['snapshot_fecha_datos']) },
      agentes, director,
      reglas_auditor: reglasDe(analisisDe(fila['auditoria_analisis_id'])),
      motivos,
      datos_faltantes: arr(ref['datos_faltantes']).map(textoCorto),
      avisos: arr(ref['avisos']).map(textoCorto),
      datos_vencidos: arr(fila['datos_vencidos']).map(textoCorto),
      salida_pmp: planSalidaDe(ref),
    },
  };
}
