// Análisis del Fundamental y el Director con datos reales Y guardado: expediente → análisis en `oficina_analisis` → corrida en `oficina_corridas_historial`.
// Orden (nada se escribe antes de tener los datos): (1) validar el cuerpo, (2) traer datos del servidor (Webull y Finnhub), (3) armar y validar el sobre,
// (4) leer portafolio y posición (solo lectura), (5) recuperar o crear el expediente y leer si ya tiene tesis vigente, (6) correr el flujo del Orquestador
// con los puertos de IA (cada análisis validado se guarda al producirse), (7) registrar la corrida y sus ejecuciones con `oficina_registrar_corrida`.
// Solo analiza y registra: no opera, no escribe en TradingCat, no cambia reglas ni tesis. Cliente inyectado (sesión del usuario, RLS activo).
//
// [PROPUESTA] Privacidad (capa gratuita de Gemini): mientras DIRECTOR_VE_DATOS_PRIVADOS sea false, el Director NO recibe el resultado del Auditor ni los
// ids de reglas ni el tipo de evaluación real (`posicion_abierta` delata que hay posición): recibe `nueva_posicion` y `auditoria: null`. El Motor y el
// registro de la corrida sí usan los valores reales. La salida guardada del Director lleva una anotación del código que lo deja escrito.
// [PROPUESTA] Fuera del Fundamental, los demás analistas no existen todavía: la corrida de un portafolio que los exige queda incompleta y así se registra.
// Límite conocido: el análisis y la corrida son escrituras distintas; si el registro de la corrida falla, los análisis ya guardados quedan sin corrida
// (la respuesta lo dice: `persistencia.estado` distinto de `guardada`).
import {
  AGENTE_FUNDAMENTAL, CLAVE_ANOTACIONES_CODIGO, COLUMNAS_TESIS_EXPEDIENTE, DIRECTOR_VE_DATOS_PRIVADOS, DISPARADOR_ANALISIS_GUARDADO, MERCADO_PRUEBA,
  PORTAFOLIO_PRUEBA_POR_OMISION, TABLA_EXPEDIENTES_TESIS, TIPO_EVALUACION_ABIERTA, TIPO_EVALUACION_NUEVA,
} from './constantes';
import { validarCuerpoAnalisis } from './analisis-real';
import { clasificarTesisPropuesta, hayTesisVigente } from './clasificar-tesis';
import { obtenerDatosFundamental } from './datos-reales';
import type { DepsDatosReales } from './datos-reales';
import { guardarAnalisisIa } from './persistencia-ia';
import type { TrazabilidadIa } from './persistencia-ia';
import { construirSobreFundamental } from './prueba-fundamental';
import type { DepsPrueba, ResultadoPrueba } from './prueba-fundamental';
import { crearPuertoAnalista, crearPuertoDirector } from './puertos-ia';
import { esObjeto } from './utilidades';
import { COLUMNAS_POSICIONES, TABLA_POSICIONES } from '../conexion/hechos-bd';
import { obtenerOCrearExpediente } from '../conexion/expediente-bd';
import { ejecutarCorridaConAuditoria, resolverPortfolioId } from '../conexion/flujo-auditoria';
import type { ClienteOficina } from '../conexion/flujo-auditoria';
import { COLUMNAS_PARAMETROS, TABLA_PARAMETROS } from '../conexion/datos-aporte-etf';
import { almacenSupabase, persistirResultado } from '../orquestador/persistencia';
import type { ClienteSupabaseMinimo } from '../orquestador/persistencia';
import { ZONA_OFICINA, fechaEnZona } from '../orquestador/calendario';
import type { ContextoDirector, DatosCongelados, Puertos, RespuestaAgente } from '../orquestador/corrida';
import type { FilaParametro } from '../orquestador/parametros';
import type { PortafolioCodigo } from '../motor/tipos';

export type ClienteGuardado = ClienteOficina & ClienteSupabaseMinimo;
type Fila = Record<string, unknown>;

async function leerFilas(cliente: ClienteOficina, tabla: string, columnas: string, filtros: [string, string][]): Promise<{ filas: Fila[] } | { error: string }> {
  try {
    let q = cliente.from(tabla).select(columnas);
    for (const [c, v] of filtros) q = q.eq(c, v);
    const r = await q;
    if (r.error) return { error: `${tabla}: ${r.error.message}` };
    if (!Array.isArray(r.data)) return { error: `${tabla}: la consulta no devolvió filas` };
    return { filas: r.data as Fila[] };
  } catch (e) {
    return { error: `${tabla}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Resumen corto de la respuesta de un agente (sin la salida completa: esa ya quedó guardada). */
function resumenAgente(r: RespuestaAgente | undefined, extra: Record<string, unknown> = {}): Record<string, unknown> {
  if (r === undefined) return { estado: 'no_ejecutado' };
  const s = esObjeto(r.salida) ? r.salida : {};
  return {
    estado: r.estado,
    ...(r.error !== undefined ? { error: r.error } : {}), ...(r.analisis_id !== undefined ? { analisis_id: r.analisis_id } : {}),
    ...(r.veredicto !== undefined ? { veredicto: r.veredicto } : {}), ...(r.proveedor !== undefined ? { proveedor: r.proveedor } : {}), ...(r.modelo !== undefined ? { modelo: r.modelo } : {}),
    ...(r.tokens_in !== undefined ? { tokens_in: r.tokens_in } : {}), ...(r.tokens_out !== undefined ? { tokens_out: r.tokens_out } : {}),
    ...(s['puntaje'] !== undefined ? { puntaje: s['puntaje'] } : {}), ...(s['confianza'] !== undefined ? { confianza: s['confianza'] } : {}),
    ...(s['nivel_confianza'] !== undefined ? { nivel_confianza: s['nivel_confianza'] } : {}), ...extra,
  };
}

/** Lo único que el Director recibe mientras se use la capa gratuita: sin resultado del Auditor, sin ids de reglas, sin contexto y con el tipo neutro (el real delata si hay posición). */
export function sanearContextoDirector(ctx: ContextoDirector): ContextoDirector {
  if (DIRECTOR_VE_DATOS_PRIVADOS) return ctx;
  return { ...ctx, auditoria: null, contexto: null, reglas_versiones_ids: [], tipo_evaluacion: TIPO_EVALUACION_NUEVA };
}

export async function ejecutarAnalisisGuardado(cliente: ClienteGuardado, deps: DepsPrueba, datosDeps: DepsDatosReales, body: unknown): Promise<ResultadoPrueba> {
  const bad = (http: number, error: string, extra: Record<string, unknown> = {}): ResultadoPrueba => ({ http, cuerpo: { ok: false, error, guardado: false, ...extra } });
  const v = validarCuerpoAnalisis(body);
  if (!v.ok) return bad(400, v.error);
  if (!v.cuerpo.guardar) return bad(400, 'esta función solo guarda: falta guardar true');
  if (v.cuerpo.con_director === false) return bad(400, 'con guardar el Director siempre se ejecuta: con_director no puede ser false');
  const ticker = v.cuerpo.ticker;
  const portafolio = (v.cuerpo.portafolio ?? PORTAFOLIO_PRUEBA_POR_OMISION) as PortafolioCodigo;

  // (2) datos reales: sin escribir nada
  const d = await obtenerDatosFundamental(datosDeps, ticker);
  if (!d.ok) return bad(d.http, d.error);
  const { fuentes, ...resto } = d.datos;

  // (3) sobre del Fundamental
  const run_id = deps.nuevoId();
  const snapshot_id = deps.nuevoId();
  const ahora = deps.ahora();
  const armado = construirSobreFundamental({ ...resto, ticker }, ticker, { run_id, snapshot_id, generado_en: ahora });
  if (!armado.ok) return bad(armado.http, armado.error);

  // (4) portafolio y posición (solo lectura). Sin confirmarlos no se crea nada ni se llama a ningún modelo.
  const falla = (etapa: string, problemas: string[]): ResultadoPrueba => bad(422, 'no se pudo preparar el guardado: no se llamó a ningún modelo ni se escribió nada', { etapa, problemas });
  const pf = await resolverPortfolioId(cliente, portafolio);
  if (!pf.ok) return falla('portafolio', pf.problemas);
  const pos = await leerFilas(cliente, TABLA_POSICIONES, COLUMNAS_POSICIONES, [['portfolio_id', pf.portfolio_id], ['ticker', ticker]]);
  if ('error' in pos) return falla('posicion', [pos.error]);
  if (pos.filas.length > 1) return falla('posicion', [`${TABLA_POSICIONES}: hay ${pos.filas.length} posiciones abiertas de ${ticker} en ${portafolio} (ambiguo)`]);
  const posicion_existe = pos.filas.length === 1;
  const tipo_evaluacion = posicion_existe ? TIPO_EVALUACION_ABIERTA : TIPO_EVALUACION_NUEVA;
  const par = await leerFilas(cliente, TABLA_PARAMETROS, COLUMNAS_PARAMETROS, []);
  if ('error' in par) return falla('parametros', [par.error]);

  // (5) expediente y tesis vigente
  const exp = await obtenerOCrearExpediente(cliente, { ticker, mercado: MERCADO_PRUEBA, portfolio_id: pf.portfolio_id, portafolio_codigo: portafolio, posicion_existe });
  if (!exp.ok) return falla('expediente', exp.problemas);
  const tes = await leerFilas(cliente, TABLA_EXPEDIENTES_TESIS, COLUMNAS_TESIS_EXPEDIENTE, [['id', exp.expediente_id]]);
  if ('error' in tes) return falla('tesis', [tes.error]);
  if (tes.filas.length !== 1) return falla('tesis', [`${TABLA_EXPEDIENTES_TESIS}: se esperaba 1 fila del expediente y hay ${tes.filas.length}`]);
  const tesis_vigente_previa = hayTesisVigente(tes.filas[0]?.['tesis_vigente']);

  // (6) flujo del Orquestador con los puertos de IA; cada análisis validado se guarda al producirse
  const guardar = async (salida: Record<string, unknown>, tra: TrazabilidadIa): Promise<{ ok: true; analisis_id: string } | { ok: false; error: string }> => {
    const g = await guardarAnalisisIa(cliente, salida, tra, { expediente_id: exp.expediente_id, ejecucion_id: null });
    return g.ok ? { ok: true, analisis_id: g.analisis_id } : { ok: false, error: g.problemas.join('; ') };
  };
  let clasificacion_tesis = clasificarTesisPropuesta(undefined, tesis_vigente_previa);
  const guardarDirector = (salida: Record<string, unknown>, tra: TrazabilidadIa): ReturnType<typeof guardar> => {
    clasificacion_tesis = clasificarTesisPropuesta(salida, tesis_vigente_previa);
    return guardar({
      ...salida,
      [CLAVE_ANOTACIONES_CODIGO]: {
        clasificacion_tesis, tesis_vigente_previa,
        ...(DIRECTOR_VE_DATOS_PRIVADOS ? {} : { contexto_enviado_al_director: { tipo_evaluacion: TIPO_EVALUACION_NUEVA, auditoria: null, reglas_versiones_ids: [] } }),
      },
    }, tra);
  };
  const opc = {
    llamar: deps.llamar, modelo_analista: deps.modelo_analista, modelo_director: deps.modelo_director, ahora: deps.ahora,
    guardar_analista: guardar, guardar_director: guardarDirector, ...(deps.proveedor !== undefined ? { proveedor: deps.proveedor } : {}),
  };
  const respuestas: { fundamental?: RespuestaAgente; director?: RespuestaAgente } = {};
  const analistaIa = crearPuertoAnalista(opc);
  const directorIa = crearPuertoDirector(opc);
  const base: Omit<Puertos, 'auditor'> = {
    nuevoId: () => run_id, ahora: deps.ahora,
    analista: async (agente, sobre) => {
      const r = await analistaIa(agente, sobre);
      if (agente === AGENTE_FUNDAMENTAL) respuestas.fundamental = r;
      return r;
    },
    director: async (ctx: ContextoDirector) => {
      const r = await directorIa(sanearContextoDirector(ctx));
      respuestas.director = r;
      return r;
    },
  };
  const datos: DatosCongelados = {
    snapshot_id, snapshot_generado_en: ahora, snapshot_fecha_datos: fechaEnZona(new Date(ahora), ZONA_OFICINA), expediente_id: exp.expediente_id, posicion_existe,
    reglas_versiones_ids: [], tesis_ref: null, parametros: par.filas as unknown as FilaParametro[], velas: null,
    sobres: { [AGENTE_FUNDAMENTAL]: armado.sobre }, sobre_auditor: null, motor: {},
  };
  const solicitud = {
    contrato: 'solicitud.v1', disparador: DISPARADOR_ANALISIS_GUARDADO, ticker, mercado: MERCADO_PRUEBA, portafolio_codigo: portafolio, tipo_evaluacion,
    origen: { watchlist_id: null, alerta_id: null }, solicitado_en: ahora,
  };
  const flujo = await ejecutarCorridaConAuditoria(cliente, solicitud, datos, base);

  // (7) registro atómico de la corrida y sus ejecuciones
  const persistencia = await persistirResultado(flujo.corrida, almacenSupabase(cliente));
  const c = flujo.corrida;
  const cuerpo: Record<string, unknown> = {
    ok: persistencia.estado === 'guardada', ticker, portafolio, guardado: true, run_id, tipo_evaluacion, posicion_existe,
    expediente: { id: exp.expediente_id, creado: exp.creado, tesis_vigente_previa },
    avisos_datos: armado.avisos, items: armado.items.length, items_finnhub: armado.items_finnhub, fuentes,
    fundamental: resumenAgente(respuestas.fundamental),
    director: resumenAgente(respuestas.director, respuestas.director?.estado === 'ok' ? { clasificacion_tesis } : {}),
    analisis_completo: respuestas.fundamental?.estado === 'ok' && respuestas.director?.estado === 'ok',
    resultado_corrida: c.resultado,
    persistencia,
  };
  if (c.resultado === 'corrida') {
    const f = c.fila_historial;
    Object.assign(cuerpo, { corrida_id: c.corrida_id, estado_final: f.estado_final, decision: f.decision, auditoria_veredicto: f.auditoria_veredicto, motivos: f.motivos });
  }
  return { http: persistencia.estado === 'guardada' ? 200 : 500, cuerpo };
}
