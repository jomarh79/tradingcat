// Módulo 3: persistencia de la corrida en `oficina_corridas_historial` y `oficina_ejecuciones_agentes` (esquema y CHECKs que pegaste el 23 y 25-oct).
//
// Qué hace: convierte la salida de `ejecutarCorrida` en filas listas para insertar, REPITE en código cada CHECK de la base (para fallar antes de
// tocar la base y con un mensaje claro) y entrega las filas a un puerto `Almacen`. No decide nada de negocio y no modifica la corrida.
// La base es la autoridad: si un CHECK cambia, hay que actualizar las constantes de este archivo (copiadas de `pg_get_constraintdef`).
//
// [PROPUESTA] (a) `oficina_ejecuciones_agentes` no tiene columnas `analisis_id` ni `reintentos`: para los agentes distintos de `orquestador` van dentro de
// `entradas` ({reintentos, analisis_id}); la constancia del orquestador conserva EXACTAMENTE la forma aprobada el 14-oct y no se toca.
// (b) La tabla de corridas es inmutable (sin UPDATE/DELETE), por eso la escritura es ATÓMICA (decisión del 25-oct): una sola llamada a la función SQL
// `oficina_registrar_corrida`, que inserta corrida y ejecuciones en una transacción. Sin reintentos silenciosos: el error de la base se devuelve tal cual.
// (c) `user_id` lo pone la base con `auth.uid()`: solo se envía si lo pasas en las opciones (por ejemplo con el cliente de servicio, donde auth.uid() es null).

import { ZONA_OFICINA } from './calendario';
import type { EjecucionRegistrada, FilaCorrida, ResultadoCorrida } from './corrida';


// ---- constantes copiadas de los CHECK de la base
const DISPARADORES_BD = ['usuario', 'watchlist', 'alerta', 'programado', 'revision_posicion', 'backtesting_aprobado'];
const PORTAFOLIOS_CORRIDAS_BD = ['PMP', 'PCP', 'PLP', 'ETF', 'SEMILLA'];
const PORTAFOLIOS_EJECUCIONES_BD = [...PORTAFOLIOS_CORRIDAS_BD, 'ESPECULATIVO', 'SPIN_OFF'];
const ESTADOS_EJECUCION_BD = ['en_curso', 'ok', 'error'];
const VEREDICTOS_BD = ['CUMPLE', 'BLOQUEO_REGLA', 'NO_ELEGIBLE', 'NO_EVALUABLE'];
const DECISIONES_BD = ['COMPRAR', 'RECOMPRAR', 'MANTENER', 'MANTENER_BAJO_VIGILANCIA', 'ESPERAR', 'NO_COMPRAR', 'NO_RECOMPRAR', 'REDUCIR', 'VENDER', 'VIGILAR', 'NO_EVALUABLE', 'BLOQUEADO'];
const DIRECTOR_BD = ['ok', 'pendiente', 'error', 'no_aplica'];
const ESTADOS_FINALES_BD = ['completada', 'incompleta', 'bloqueada', 'pendiente_informacion'];
const RUTAS_BD = ['analitica', 'determinista', 'posicion_abierta'];
const TIPOS_BD = ['nueva_posicion', 'posicion_abierta', 'recompra', 'revision_tesis', 'aporte_periodico', 'revision_anual_etf', 'retiro_quinquenal'];
const VOCABULARIO_POR_TIPO_BD: Readonly<Record<string, readonly string[]>> = {
  nueva_posicion: ['COMPRAR', 'ESPERAR', 'NO_COMPRAR', 'VIGILAR', 'NO_EVALUABLE', 'BLOQUEADO'],
  recompra: ['RECOMPRAR', 'ESPERAR', 'NO_RECOMPRAR', 'NO_EVALUABLE', 'BLOQUEADO'],
  posicion_abierta: ['MANTENER', 'MANTENER_BAJO_VIGILANCIA', 'REDUCIR', 'VENDER', 'ESPERAR', 'NO_EVALUABLE', 'BLOQUEADO'],
  revision_tesis: ['MANTENER', 'MANTENER_BAJO_VIGILANCIA', 'REDUCIR', 'VENDER', 'ESPERAR', 'NO_EVALUABLE', 'BLOQUEADO'],
  aporte_periodico: ['COMPRAR', 'NO_COMPRAR', 'NO_EVALUABLE', 'BLOQUEADO'],
  revision_anual_etf: ['MANTENER', 'REDUCIR', 'VENDER', 'NO_EVALUABLE'],
  retiro_quinquenal: ['REDUCIR', 'NO_EVALUABLE'],
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const esUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

function uuidObligatorio(errores: string[], campo: string, v: unknown): void {
  if (!esUuid(v)) errores.push(`${campo} no es un uuid: ${String(v)}`);
}
function uuidOpcional(errores: string[], campo: string, v: unknown): void {
  if (v !== null && v !== undefined && !esUuid(v)) errores.push(`${campo} no es un uuid: ${String(v)}`);
}

// ---- corrida
/** Errores que la base rechazaría (vacío = la fila pasa los CHECK conocidos). */
export function verificarFilaCorrida(f: FilaCorrida): string[] {
  const e: string[] = [];
  uuidObligatorio(e, 'corrida_id', f.corrida_id);
  uuidOpcional(e, 'corrida_previa_id', f.corrida_previa_id);
  uuidOpcional(e, 'expediente_id', f.expediente_id);
  uuidOpcional(e, 'snapshot_id', f.snapshot_id);
  uuidOpcional(e, 'auditoria_analisis_id', f.auditoria_analisis_id);
  uuidOpcional(e, 'director_analisis_id', f.director_analisis_id);
  uuidOpcional(e, 'decision_id', f.decision_id);
  // version_chk
  if (!((f.version === 1 && f.corrige_version === null) || (f.version > 1 && f.corrige_version !== null && f.corrige_version < f.version))) {
    e.push(`version_chk: version ${f.version} con corrige_version ${String(f.corrige_version)}`);
  }
  if (!DISPARADORES_BD.includes(f.disparador)) e.push(`disparador_chk: ${f.disparador}`);
  if (!ESTADOS_FINALES_BD.includes(f.estado_final)) e.push(`estado_chk: ${f.estado_final}`);
  if (!RUTAS_BD.includes(f.ruta)) e.push(`ruta_chk: ${f.ruta}`);
  if (f.portafolio_codigo !== null && !PORTAFOLIOS_CORRIDAS_BD.includes(f.portafolio_codigo)) e.push(`portafolio_chk: ${f.portafolio_codigo}`);
  if (f.tipo_evaluacion !== null && !TIPOS_BD.includes(f.tipo_evaluacion)) e.push(`tipo_chk: ${f.tipo_evaluacion}`);
  if (f.auditoria_veredicto !== null && !VEREDICTOS_BD.includes(f.auditoria_veredicto)) e.push(`auditoria_chk: ${f.auditoria_veredicto}`);
  if (f.decision !== null && !DECISIONES_BD.includes(f.decision)) e.push(`decision_chk: ${f.decision}`);
  if (!DIRECTOR_BD.includes(f.director_estado)) e.push(`director_chk: ${f.director_estado}`);
  // bloqueada_chk: (estado_final = 'bloqueada') = COALESCE(decision = 'BLOQUEADO', false)
  if ((f.estado_final === 'bloqueada') !== (f.decision === 'BLOQUEADO')) e.push('bloqueada_chk: estado bloqueada <=> decision BLOQUEADO');
  if (f.estado_final === 'completada' && f.decision === null) e.push('completada_chk: una corrida completada exige decision');
  if (f.estado_final === 'completada' && !(f.director_estado === 'ok' || f.director_estado === 'no_aplica')) e.push('director_completada_chk: completada exige Director ok o no_aplica');
  if (f.ruta === 'determinista' && f.director_estado !== 'no_aplica') e.push('director_ruta_chk: la ruta determinista exige director no_aplica');
  if (f.estado_final !== 'completada' && f.motivos.length === 0) e.push('motivos_chk: una corrida no completada exige motivos');
  if (f.decision === 'NO_EVALUABLE' && !(f.estado_final === 'incompleta' || f.estado_final === 'pendiente_informacion')) e.push('noevaluable_chk: NO_EVALUABLE exige incompleta o pendiente_informacion');
  if (f.decision !== null && f.tipo_evaluacion !== null) {
    const permitidas = VOCABULARIO_POR_TIPO_BD[f.tipo_evaluacion];
    if (permitidas !== undefined && !permitidas.includes(f.decision)) e.push(`vocabulario_tipo_chk: ${f.decision} no es válida para ${f.tipo_evaluacion}`);
  }
  if (f.finalizada_at !== null && Date.parse(f.finalizada_at) < Date.parse(f.iniciada_at)) e.push('tiempos_chk: finalizada_at es anterior a iniciada_at');
  if (Number.isNaN(Date.parse(f.iniciada_at))) e.push(`iniciada_at no es una fecha: ${f.iniciada_at}`);
  return e;
}

export function filaCorridaParaBd(f: FilaCorrida, user_id?: string): Record<string, unknown> {
  return {
    ...(user_id !== undefined ? { user_id } : {}),
    corrida_id: f.corrida_id, version: f.version, corrige_version: f.corrige_version, corrida_previa_id: f.corrida_previa_id, expediente_id: f.expediente_id,
    ticker: f.ticker, mercado: f.mercado, portafolio_codigo: f.portafolio_codigo, tipo_evaluacion: f.tipo_evaluacion, ruta: f.ruta, disparador: f.disparador,
    iniciada_at: f.iniciada_at, finalizada_at: f.finalizada_at,
    snapshot_id: f.snapshot_id, snapshot_generado_en: f.snapshot_generado_en, snapshot_fecha_datos: f.snapshot_fecha_datos,
    reglas_versiones_ids: f.reglas_versiones_ids, matriz_agentes_version: f.matriz_agentes_version, agentes_requeridos: f.agentes_requeridos,
    resultados_agentes: f.resultados_agentes, auditoria_veredicto: f.auditoria_veredicto, auditoria_analisis_id: f.auditoria_analisis_id,
    decision_id: f.decision_id, decision: f.decision, director_estado: f.director_estado, director_analisis_id: f.director_analisis_id,
    estado_final: f.estado_final, motivos: f.motivos, datos_vencidos: f.datos_vencidos, tesis_ref: f.tesis_ref, referencias: f.referencias,
  };
}

// ---- ejecuciones
export const AGENTE_SIN_EXTRAS = 'orquestador';

export function verificarEjecucion(x: EjecucionRegistrada): string[] {
  const e: string[] = [];
  uuidObligatorio(e, 'run_id', x.run_id);
  uuidOpcional(e, 'expediente_id', x.expediente_id);
  if (x.agente.trim() === '') e.push('agente vacío');
  if (!ESTADOS_EJECUCION_BD.includes(x.estado)) e.push(`estado_check: ${x.estado}`);
  if (!DISPARADORES_BD.includes(x.disparador)) e.push(`disparador_check: ${x.disparador}`);
  if (x.portafolio_codigo !== null && !PORTAFOLIOS_EJECUCIONES_BD.includes(x.portafolio_codigo)) e.push(`portafolio_codigo_check: ${x.portafolio_codigo}`);
  if (Number.isNaN(Date.parse(x.started_at))) e.push(`started_at no es una fecha: ${x.started_at}`);
  return e;
}

export function filaEjecucionParaBd(x: EjecucionRegistrada, user_id?: string): Record<string, unknown> {
  const entradas = x.agente === AGENTE_SIN_EXTRAS
    ? x.entradas
    : { ...(x.entradas ?? {}), reintentos: x.reintentos, ...(x.analisis_id !== null ? { analisis_id: x.analisis_id } : {}) };
  return {
    ...(user_id !== undefined ? { user_id } : {}),
    run_id: x.run_id, agente: x.agente, expediente_id: x.expediente_id, ticker: x.ticker, disparador: x.disparador,
    proveedor: x.proveedor, modelo: x.modelo, tokens_in: x.tokens_in, tokens_out: x.tokens_out, costo_usd: x.costo_usd,
    entradas, estado: x.estado, error: x.error, started_at: x.started_at, finished_at: x.finished_at,
    tipo_evaluacion: x.tipo_evaluacion, portafolio_codigo: x.portafolio_codigo,
  };
}

// ---- almacén y orquestación de la escritura
export const FUNCION_REGISTRO = 'oficina_registrar_corrida';

export interface Almacen {
  /**
   * Registra la corrida y sus ejecuciones en UNA sola operación atómica (función SQL `oficina_registrar_corrida`): o se escribe todo o no se escribe nada.
   * `corrida` es null solo para la constancia de Especulativo / Spin Off. Devuelve el mensaje de error de la base TAL CUAL, o null si fue bien.
   * Nunca lanza y nunca reintenta.
   */
  registrar(corrida: Record<string, unknown> | null, ejecuciones: Record<string, unknown>[]): Promise<{ error: string | null }>;
}

export type ResultadoPersistencia =
  | { estado: 'guardada'; corrida_id: string | null; filas_corrida: number; filas_ejecuciones: number }
  | { estado: 'rechazada_antes_de_escribir'; errores: string[] }
  | { estado: 'fallo'; error: string }
  | { estado: 'nada_que_guardar'; motivo: string };

export interface OpcionesPersistencia { user_id?: string }

/** Guarda lo que produjo `ejecutarCorrida`. Verifica TODO antes de escribir y escribe con una sola llamada atómica: si algo falla, no queda nada. */
export async function persistirResultado(r: ResultadoCorrida, almacen: Almacen, opciones: OpcionesPersistencia = {}): Promise<ResultadoPersistencia> {
  if (r.resultado === 'solicitud_invalida') return { estado: 'nada_que_guardar', motivo: 'la solicitud es inválida: no es una corrida' };
  const uid = opciones.user_id;
  if (r.resultado === 'sin_corrida') {
    const errores = verificarEjecucion(r.constancia);
    if (errores.length > 0) return { estado: 'rechazada_antes_de_escribir', errores };
    const w = await almacen.registrar(null, [filaEjecucionParaBd(r.constancia, uid)]);
    return w.error === null ? { estado: 'guardada', corrida_id: null, filas_corrida: 0, filas_ejecuciones: 1 } : { estado: 'fallo', error: w.error };
  }
  const errores = [...verificarFilaCorrida(r.fila_historial), ...r.ejecuciones.flatMap(x => verificarEjecucion(x).map(m => `${x.agente}: ${m}`))];
  if (errores.length > 0) return { estado: 'rechazada_antes_de_escribir', errores };
  const w = await almacen.registrar(filaCorridaParaBd(r.fila_historial, uid), r.ejecuciones.map(y => filaEjecucionParaBd(y, uid)));
  if (w.error !== null) return { estado: 'fallo', error: w.error };
  return { estado: 'guardada', corrida_id: r.corrida_id, filas_corrida: 1, filas_ejecuciones: r.ejecuciones.length };
}

/** Adaptador mínimo para supabase-js (tipado estructural: no importa la librería). Llama a la función SQL y devuelve el error tal cual. */
export interface ClienteSupabaseMinimo {
  rpc(funcion: string, args: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }>;
}
export function almacenSupabase(cliente: ClienteSupabaseMinimo): Almacen {
  return {
    async registrar(corrida, ejecuciones) {
      try {
        const { error } = await cliente.rpc(FUNCION_REGISTRO, { p_corrida: corrida, p_ejecuciones: ejecuciones });
        return { error: error === null ? null : error.message };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}

/** Zona en la que se interpretan las fechas de negocio (la de la Oficina). Solo referencia para quien arme el almacén. */
export const ZONA_PERSISTENCIA = ZONA_OFICINA;
