// Núcleo determinista de una corrida (contrato Orquestador/Director v0.4, secciones 1.2 a 1.6). Sin modelo de IA, sin base de datos.
// Coordina; no decide: valida la solicitud, fija ruta y agentes, congela, ejecuta los analistas, el Auditor y el Director a través de PUERTOS,
// entrega SIEMPRE al Motor y arma la fila de `oficina_corridas_historial`. No escribe en ninguna tabla ni opera con el bróker (regla 5).
//
// Los analistas de IA, el Auditor y el Director son puertos (`Puertos`): aquí se prueban con dobles. Quien los implemente (OpenAI, código del Auditor)
// no cambia este flujo. Tampoco se lee ni se escribe la base: el llamador entrega los datos ya congelados (`DatosCongelados`) y recibe la fila lista.
//
// [PROPUESTA] (el contrato no lo precisa; confirma o corrige):
//   C1. El Auditor se ejecuta después de los analistas, como en el paso 9, y no recibe sus salidas (solo `sobre_auditor`). Sin reintento (código).
//   C2. El Director se ejecuta en las rutas analítica y de posición abierta aunque falte un analista o el Auditor bloquee; con 1 reintento.
//   C3. Los analistas reciben SOLO su sobre (`sobres[agente]`); el Técnico recibe además el resultado de código (`tecnico_codigo`).
//   C4. Un agente opcional corre únicamente si se pide expresamente (`opciones.agentes_opcionales`); su falla no vuelve la corrida incompleta.
//   C5. Ruta determinista: no se llama a ningún puerto; los resultados de agentes requeridos (p. ej. Riesgo y Capital del aporte de ETFs) los entrega el
//       llamador ya calculados por código en `resultados_codigo`; si falta alguno queda `ausente` y el Motor responde NO_EVALUABLE.
//   C6. `momento` del Motor: PCP abrir = apertura_pcp, PCP recompra = recompra_pcp, PLP recompra = dca_plp, tomados del Técnico. Para los demás casos
//       el Técnico no define detonante: solo se usa `datos.motor.momento` si el llamador lo entrega; si no, el Motor responderá ESPERAR (sin detonante).
//   C7. Coherencia con la posición (tabla 1.3b): sin confirmar, o con una posición que contradice el tipo, `posicion_confirmada = false`
//       (el Motor da NO_EVALUABLE / posicion_no_confirmada) y la inconsistencia se guarda en `referencias.posicion_inconsistencia`.
//   C8. Un parámetro con forma inválida NO se sustituye: si es el margen de cierre, el Técnico no se calcula y se declara en `datos_faltantes`.
//   C9. `senal_salida` no evaluable (null) nunca se convierte en false: no se evalúa la salida del PCP y se declara en `datos_faltantes`.
//   C10. El cálculo de código del Técnico corre siempre que haga falta para `momento` o la salida del PCP, aunque el agente Técnico de IA sea opcional (PLP).

import { RUTA_POR_TIPO, decidir, evaluarSalidaPCP } from '../motor';
import type {
  Agente, Auditoria, Capital, ContextoAporte, ContextoRetiro, ContextoRevisionETF, ContextoSalida, EntradaMotor, EntradaSalidaPCP, EstadoDirector,
  EstadoFinal, MotivoEstado, PortafolioCodigo, ResultadoAgente, Ruta, SalidaMotor, TesisEstado, TipoEvaluacion, VeredictoAuditor,
} from '../motor';
import { ZONA_OFICINA, fechaEnZona } from './calendario';
import type { CalendarioNYSE } from './calendario';
import { instanteEvaluacion } from './cierre-velas';
import { calcularAporteSemanal } from './aporte-etf';
import type { DatosAporteSemanal } from './aporte-etf';
import { AGENTES_ORDEN, MATRIZ_AGENTES_VERSION, agentesDeCorrida, reglaEstructural } from './matriz-agentes';
import { resolverParametros } from './parametros';
import type { FilaParametro } from './parametros';
import { prepararTecnico } from './preparar-tecnico';
import type { ResultadoPrepararTecnico, UsoMomento } from './preparar-tecnico';
import type { RachaRegistrada } from './racha';
import { MOTIVO_PORTAFOLIO_SIN_REGLAS, normalizarCodigoPortafolio, validarSolicitud } from './solicitud';
import type { SolicitudNormalizada } from './solicitud';
import type { Candle } from '../tecnico';

/** Reintentos por agente de IA tras una salida inválida o un error (el validador permite uno; contrato 1.2 paso 7). */
export const REINTENTOS_POR_AGENTE = 1;
/** El Auditor es código determinista: un error no se reintenta (C1). */
export const REINTENTOS_AUDITOR = 0;
export const NOMBRE_AGENTE_AUDITOR = 'auditor';
export const NOMBRE_AGENTE_DIRECTOR = 'director';
export const NOMBRE_AGENTE_ORQUESTADOR = 'orquestador';
export const VEREDICTOS_AUDITOR: readonly VeredictoAuditor[] = ['CUMPLE', 'BLOQUEO_REGLA', 'NO_ELEGIBLE', 'NO_EVALUABLE'];

/** Uso del detonante del Técnico que alimenta `momento` del Motor, por portafolio + tipo (C6). */
export const USO_MOMENTO_POR_CASO: Readonly<Record<string, UsoMomento>> = {
  'PCP:nueva_posicion': 'apertura_pcp',
  'PCP:recompra': 'recompra_pcp',
  'PLP:recompra': 'dca_plp',
};

// ----------------------------------------------------------------------------------------------- puertos

export interface RespuestaAgente {
  estado: 'ok' | 'error';
  analisis_id?: string;
  veredicto?: string;
  /** Salida validada del agente; es lo que ve el Director. */
  salida?: unknown;
  error?: string;
  proveedor?: string;
  modelo?: string;
  tokens_in?: number;
  tokens_out?: number;
  costo_usd?: number;
}

export interface RespuestaAuditor {
  estado: 'ok' | 'error';
  veredicto?: VeredictoAuditor;
  analisis_id?: string;
  reglas_revisadas?: string[];
  error?: string;
}

export interface ContextoDirector {
  run_id: string;
  snapshot_id: string;
  ticker: string;
  mercado: string;
  portafolio_codigo: PortafolioCodigo;
  tipo_evaluacion: TipoEvaluacion;
  /** Salidas validadas de los analistas que respondieron bien. */
  salidas_analistas: Partial<Record<Agente, unknown>>;
  /** Resultado del Auditor (el Director lo ve; el Auditor no ve al Director). */
  auditoria: { veredicto: VeredictoAuditor; reglas_revisadas: string[] } | null;
  reglas_versiones_ids: string[];
  contexto: unknown;
}

export interface Puertos {
  nuevoId(): string;
  /** Instante actual, ISO 8601 con zona. */
  ahora(): string;
  analista(agente: Agente, sobre: unknown): Promise<RespuestaAgente>;
  auditor(sobre: unknown): Promise<RespuestaAuditor>;
  director(contexto: ContextoDirector): Promise<RespuestaAgente>;
}

// ----------------------------------------------------------------------------------------------- datos congelados

export interface DatosCongelados {
  snapshot_id: string;
  /** ISO 8601 con zona. */
  snapshot_generado_en: string;
  snapshot_fecha_datos: string | null;
  expediente_id: string | null;
  /** Por ticker + portafolio. null = el registro no permite confirmarlo. */
  posicion_existe: boolean | null;
  reglas_versiones_ids: string[];
  tesis_ref: { version: number; origen: string } | null;
  /** Filas de `oficina_parametros` ya leídas. */
  parametros: FilaParametro[];
  /** Velas del snapshot, para el Técnico (de la más antigua a la más reciente). */
  velas?: { diarias: Candle[]; semanales: Candle[]; fuente: string } | null;
  racha_previa?: RachaRegistrada | null;
  /** `entrada.v1` de cada analista: solo lo que su contrato autoriza. El Orquestador no añade datos de otros agentes (independencia). */
  sobres: Partial<Record<Agente, unknown>>;
  sobre_auditor: unknown;
  contexto_director?: unknown;
  /** Datos vencidos de lo que NO es el precio diario (ratios, estados financieros...). El precio vencido va como `datos_faltantes` (decisión 22-oct). */
  datos_vencidos?: string[];
  datos_faltantes?: string[];
  /** Ruta determinista: resultados de agentes calculados por código (C5). */
  resultados_codigo?: Partial<Record<Agente, ResultadoAgente>>;
  /** ETF aporte_periodico: datos para que el Orquestador calcule el aporte semanal (matriz v2, sección 7). Sustituye a C5 para este caso. */
  aporte_semanal?: DatosAporteSemanal | null;
  /** PLP nueva_posicion: sustitución autorizada por ti (origen PLP-09). Sin ella la apertura es BLOQUEADO por PLP-02. */
  sustitucion_autorizada?: { regla: string; autorizacion_id: string } | null;
  /** SEMILLA recompra: ¿es con dinero nuevo? true = BLOQUEADO (sección 10, regla 7); sin dato = pendiente_informacion. */
  dinero_nuevo?: boolean | null;
  /** Plan y compras del PCP para evaluar la salida; la señal de salida la pone el Técnico. */
  salida_pcp?: Omit<EntradaSalidaPCP, 'senal_salida'>;
  corrida_previa_id?: string | null;
  motor?: {
    capital?: Capital;
    tesis_estado?: TesisEstado;
    /** Solo se usa si el Técnico no define detonante para el caso (C6). Las confirmaciones visuales NO se conectan sin aprobación. */
    momento?: { detonante_confirmado: boolean; condicion_ejecucion?: string };
    condicion_ejecucion?: string;
    salida?: Omit<ContextoSalida, 'exigida'>;
    aporte?: ContextoAporte;
    revision_etf?: ContextoRevisionETF;
    retiro?: ContextoRetiro;
    monto_operacion?: string;
    decision_previa_id?: string;
  };
}

export interface OpcionesCorrida {
  /** Opcionales pedidos expresamente por ti (C4). */
  agentes_opcionales?: Agente[];
  calendario?: CalendarioNYSE;
}

// ----------------------------------------------------------------------------------------------- registros

export interface EjecucionRegistrada {
  run_id: string;
  agente: string;
  estado: 'ok' | 'error';
  reintentos: number;
  error: string | null;
  analisis_id: string | null;
  ticker: string;
  disparador: string;
  tipo_evaluacion: string;
  portafolio_codigo: string | null;
  expediente_id: string | null;
  proveedor: string | null;
  modelo: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  costo_usd: number | null;
  /** Para `entradas` (jsonb): en la constancia del Orquestador, el resultado y el motivo. */
  entradas: Record<string, unknown> | null;
  started_at: string;
  finished_at: string;
}

export interface ResultadoAgenteRegistro {
  agente: string;
  estado: 'ok' | 'error' | 'ausente' | 'no_ejecutado';
  analisis_id: string | null;
  reintentos: number;
  error?: string;
}

/** Fila para `oficina_corridas_historial` (sin `id`, `user_id` ni `created_at`, que pone la base o el llamador). */
export interface FilaCorrida {
  corrida_id: string;
  version: number;
  corrige_version: number | null;
  corrida_previa_id: string | null;
  expediente_id: string | null;
  ticker: string;
  mercado: string;
  portafolio_codigo: PortafolioCodigo | null;
  tipo_evaluacion: TipoEvaluacion;
  ruta: Ruta;
  disparador: string;
  iniciada_at: string;
  finalizada_at: string;
  snapshot_id: string | null;
  snapshot_generado_en: string | null;
  snapshot_fecha_datos: string | null;
  reglas_versiones_ids: string[];
  matriz_agentes_version: string;
  tesis_ref: { version: number; origen: string } | null;
  agentes_requeridos: Agente[];
  resultados_agentes: ResultadoAgenteRegistro[];
  auditoria_veredicto: VeredictoAuditor | null;
  auditoria_analisis_id: string | null;
  decision: SalidaMotor['decision'] | null;
  /** Lo pone quien inserte la decisión en `oficina_decisiones` (esa escritura no es de este módulo). */
  decision_id: string | null;
  director_estado: EstadoDirector;
  director_analisis_id: string | null;
  estado_final: EstadoFinal;
  motivos: MotivoEstado[];
  datos_vencidos: string[];
  referencias: Record<string, unknown>;
}

export type ResultadoCorrida =
  | {
      resultado: 'corrida';
      corrida_id: string;
      fila_historial: FilaCorrida;
      ejecuciones: EjecucionRegistrada[];
      entrada_motor: EntradaMotor;
      salida_motor: SalidaMotor;
      tecnico: ResultadoPrepararTecnico | null;
      avisos: string[];
    }
  | { resultado: 'pendiente_informacion'; corrida_id: string; fila_historial: FilaCorrida; ejecuciones: []; avisos: string[] }
  | { resultado: 'sin_corrida'; constancia: EjecucionRegistrada }
  | { resultado: 'solicitud_invalida'; errores: string[] };

// ----------------------------------------------------------------------------------------------- coherencia con la posición (tabla 1.3b)

const TIPOS_QUE_EXIGEN_POSICION: readonly TipoEvaluacion[] = ['recompra', 'posicion_abierta', 'revision_tesis'];

export function coherenciaPosicion(tipo: TipoEvaluacion, existe: boolean | null): { confirmada: boolean; inconsistencia: string | null } {
  if (existe === null) return { confirmada: false, inconsistencia: 'el registro de posiciones no permite confirmar si existe la posición (ticker + portafolio)' };
  if (tipo === 'nueva_posicion' && existe) {
    return { confirmada: false, inconsistencia: 'ya existe una posición para este ticker y portafolio: no se asume una compra inicial' };
  }
  if (TIPOS_QUE_EXIGEN_POSICION.includes(tipo) && !existe) {
    return { confirmada: false, inconsistencia: `no existe una posición para este ticker y portafolio y el tipo ${tipo} la supone` };
  }
  return { confirmada: true, inconsistencia: null };
}

// ----------------------------------------------------------------------------------------------- auxiliares

function mensaje(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

interface Intento<T> { respuesta: T; reintentos: number; started_at: string; finished_at: string }

async function conReintentos<T extends { estado: 'ok' | 'error'; error?: string }>(
  llamar: () => Promise<T>, max_reintentos: number, ahora: () => string,
): Promise<Intento<T>> {
  const started_at = ahora();
  let ultima: T | null = null;
  let reintentos = 0;
  for (let i = 0; i <= max_reintentos; i++) {
    try {
      ultima = await llamar();
    } catch (e) {
      ultima = { estado: 'error', error: mensaje(e) } as T;
    }
    if (ultima.estado === 'ok') break;
    if (i < max_reintentos) reintentos++;
  }
  return { respuesta: ultima as T, reintentos, started_at, finished_at: ahora() };
}

function registro(
  p: { run_id: string; sol: Pick<SolicitudNormalizada, 'disparador' | 'ticker' | 'tipo_evaluacion' | 'portafolio'>; expediente_id: string | null },
  agente: string, r: { estado: 'ok' | 'error'; error?: string; analisis_id?: string; proveedor?: string; modelo?: string; tokens_in?: number; tokens_out?: number; costo_usd?: number },
  reintentos: number, started_at: string, finished_at: string, entradas: Record<string, unknown> | null = null,
): EjecucionRegistrada {
  return {
    run_id: p.run_id, agente, estado: r.estado, reintentos, error: r.error ?? null, analisis_id: r.analisis_id ?? null,
    ticker: p.sol.ticker, disparador: p.sol.disparador, tipo_evaluacion: p.sol.tipo_evaluacion, portafolio_codigo: p.sol.portafolio,
    expediente_id: p.expediente_id, proveedor: r.proveedor ?? null, modelo: r.modelo ?? null,
    tokens_in: r.tokens_in ?? null, tokens_out: r.tokens_out ?? null, costo_usd: r.costo_usd ?? null,
    entradas, started_at, finished_at,
  };
}

function filaPendiente(
  corrida_id: string, sol: SolicitudNormalizada, datos: DatosCongelados | null, motivos: MotivoEstado[], iniciada: string, finalizada: string, referencias: Record<string, unknown>,
): FilaCorrida {
  return {
    corrida_id, version: 1, corrige_version: null, corrida_previa_id: datos?.corrida_previa_id ?? null,
    expediente_id: datos?.expediente_id ?? null, ticker: sol.ticker, mercado: sol.mercado, portafolio_codigo: sol.portafolio,
    tipo_evaluacion: sol.tipo_evaluacion, ruta: sol.ruta, disparador: sol.disparador, iniciada_at: iniciada, finalizada_at: finalizada,
    snapshot_id: datos?.snapshot_id ?? null, snapshot_generado_en: datos?.snapshot_generado_en ?? null, snapshot_fecha_datos: datos?.snapshot_fecha_datos ?? null,
    reglas_versiones_ids: datos?.reglas_versiones_ids ?? [], matriz_agentes_version: MATRIZ_AGENTES_VERSION, tesis_ref: datos?.tesis_ref ?? null,
    agentes_requeridos: [], resultados_agentes: [], auditoria_veredicto: null, auditoria_analisis_id: null,
    decision: null, decision_id: null, director_estado: 'no_aplica', director_analisis_id: null,
    estado_final: 'pendiente_informacion', motivos, datos_vencidos: [], referencias,
  };
}

// ----------------------------------------------------------------------------------------------- la corrida

export async function ejecutarCorrida(
  solicitud: unknown, datos: DatosCongelados | null, puertos: Puertos, opciones: OpcionesCorrida = {},
): Promise<ResultadoCorrida> {
  const iniciada_at = puertos.ahora();
  const instante = instanteEvaluacion(iniciada_at);
  if (instante === null) throw new Error(`puertos.ahora() debe devolver un instante ISO 8601 con zona: ${iniciada_at}`);

  const v = validarSolicitud(solicitud);
  if (v.clase === 'invalida') return { resultado: 'solicitud_invalida', errores: v.errores };

  const corrida_id = puertos.nuevoId();

  if (v.clase === 'sin_corrida') {
    // Especulativo / Spin Off: no abren corrida; constancia en oficina_ejecuciones_agentes (aprobado el 14-oct).
    const sol: Pick<SolicitudNormalizada, 'disparador' | 'ticker' | 'tipo_evaluacion' | 'portafolio'> = {
      disparador: v.disparador, ticker: v.ticker, tipo_evaluacion: v.tipo_evaluacion, portafolio: null,
    };
    const c = registro({ run_id: corrida_id, sol, expediente_id: null }, NOMBRE_AGENTE_ORQUESTADOR, { estado: 'ok' }, 0, iniciada_at, puertos.ahora(),
      { resultado: 'NO_EVALUABLE', motivo: MOTIVO_PORTAFOLIO_SIN_REGLAS });
    return { resultado: 'sin_corrida', constancia: { ...c, portafolio_codigo: normalizarCodigoPortafolio(v.portafolio_solicitado) } };
  }

  if (v.clase === 'pendiente_informacion') {
    const fila = filaPendiente(corrida_id, v.solicitud, datos, v.motivos, iniciada_at, puertos.ahora(), { posicion: null, autorizacion_usuario: null });
    return { resultado: 'pendiente_informacion', corrida_id, fila_historial: fila, ejecuciones: [], avisos: [] };
  }

  const sol = v.solicitud;
  const portafolio = sol.portafolio;
  const tipo = sol.tipo_evaluacion;
  const ruta = RUTA_POR_TIPO[tipo];
  if (datos === null) {
    const fila = filaPendiente(corrida_id, sol, null, [{ codigo: 'datos_faltantes', detalle: 'no hay datos congelados (snapshot) para esta corrida' }],
      iniciada_at, puertos.ahora(), { posicion: `${sol.ticker}:${portafolio}`, autorizacion_usuario: null });
    return { resultado: 'pendiente_informacion', corrida_id, fila_historial: fila, ejecuciones: [], avisos: [] };
  }

  // Reglas estructurales (23-oct): casos sin fila en la tabla 1.4 pero con respuesta en la matriz v2.
  const estr = reglaEstructural(portafolio, tipo);
  let bloqueoEstructural: { regla: string; fuente: string } | null = null;
  if (estr !== null) {
    if (estr.clase === 'bloqueo_salvo_sustitucion') {
      const s = datos.sustitucion_autorizada;
      if (s !== undefined && s !== null && s.regla === estr.regla_sustitucion && typeof s.autorizacion_id === 'string' && s.autorizacion_id.trim() !== '') {
        const fila = filaPendiente(corrida_id, sol, datos, [{ codigo: 'datos_faltantes', detalle: `${portafolio} + ${tipo} con sustitución autorizada (${estr.regla_sustitucion}): la tabla de agentes no tiene fila para este caso; no se asume una` }],
          iniciada_at, puertos.ahora(), { posicion: `${sol.ticker}:${portafolio}`, autorizacion_usuario: s.autorizacion_id });
        return { resultado: 'pendiente_informacion', corrida_id, fila_historial: fila, ejecuciones: [], avisos: [] };
      }
    } else if (datos.dinero_nuevo !== true) {
      const fila = filaPendiente(corrida_id, sol, datos, [{ codigo: 'datos_faltantes', detalle: `${portafolio} + ${tipo}: solo está resuelto el caso con dinero nuevo (BLOQUEADO); falta confirmar que lo es` }],
        iniciada_at, puertos.ahora(), { posicion: `${sol.ticker}:${portafolio}`, autorizacion_usuario: null });
      return { resultado: 'pendiente_informacion', corrida_id, fila_historial: fila, ejecuciones: [], avisos: [] };
    }
    bloqueoEstructural = { regla: estr.regla, fuente: estr.fuente };
  }

  const avisos: string[] = [];
  const fecha_evaluacion = fechaEnZona(instante, ZONA_OFICINA);
  const ag = agentesDeCorrida(portafolio, tipo) ?? { accion: 'abrir' as const, requeridos: [], opcionales: [] };   // estructural: sin agentes
  const requeridos = ag.requeridos;
  const pedidos = opciones.agentes_opcionales ?? [];
  const opcionales = AGENTES_ORDEN.filter(a => pedidos.includes(a) && ag.opcionales.includes(a));
  for (const a of pedidos) if (!ag.opcionales.includes(a) && !requeridos.includes(a)) avisos.push(`el agente ${a} no es opcional para ${portafolio} + ${tipo}: no se activa`);
  const ejecutar = AGENTES_ORDEN.filter(a => requeridos.includes(a) || opcionales.includes(a));

  const params = resolverParametros(datos.parametros, fecha_evaluacion);
  for (const p of params.problemas) avisos.push(`parametro_invalido: ${p}`);
  const coh = coherenciaPosicion(tipo, datos.posicion_existe);

  // ---- Técnico (código): señales, detonantes, frescura, racha
  const faltantes: string[] = [...(datos.datos_faltantes ?? [])];
  let tecnico: ResultadoPrepararTecnico | null = null;
  // C10: el cálculo de código del Técnico (señales, detonantes, cierre de velas, frescura) corre siempre que la corrida lo necesite, aunque el agente
  // Técnico de IA sea opcional y no se haya pedido: es determinista y de él salen el detonante del Motor (`momento`) y la señal de salida del PCP.
  // (PCP posición abierta ya incluye al Técnico como requerido en la tabla 1.4, de ahí sale la señal de salida.)
  const necesitaTecnico = ruta !== 'determinista'
    && (ejecutar.includes('tecnico') || USO_MOMENTO_POR_CASO[`${portafolio}:${tipo}`] !== undefined);
  if (necesitaTecnico) {
    if (datos.velas === undefined || datos.velas === null) {
      faltantes.push('tecnico: no hay velas congeladas en el snapshot');
    } else if (params.margen_cierre_minutos === null) {
      faltantes.push('tecnico: el parámetro orquestador.margen_cierre_velas es inválido; no se confirma el cierre de las velas');
    } else {
      tecnico = prepararTecnico(
        { ticker: sol.ticker, mercado: sol.mercado, evaluado_en: iniciada_at, fuente: datos.velas.fuente, velas_diarias: datos.velas.diarias, velas_semanales: datos.velas.semanales },
        opciones.calendario,
        { margen_cierre_minutos: params.margen_cierre_minutos, frescura_precio_dias_habiles: params.frescura_precio_dias_habiles, racha_previa: datos.racha_previa ?? null },
      );
      faltantes.push(...tecnico.datos_faltantes);
    }
  }

  // ---- Analistas (paralelo, aislados) o resultados por código (ruta determinista)
  const ejecuciones: EjecucionRegistrada[] = [];
  const ctx = { run_id: corrida_id, sol, expediente_id: datos.expediente_id };
  const resultados_agentes: Partial<Record<Agente, ResultadoAgente>> = {};
  const registros: ResultadoAgenteRegistro[] = [];
  const salidas_analistas: Partial<Record<Agente, unknown>> = {};
  let aporte: ReturnType<typeof calcularAporteSemanal> | null = null;

  if (ruta === 'determinista') {
    if (tipo === 'aporte_periodico') {     // solo ETF tiene este tipo en la matriz
      aporte = calcularAporteSemanal(datos.aporte_semanal);
      avisos.push(...aporte.problemas);
      if (datos.motor?.aporte !== undefined) avisos.push('motor.aporte ignorado: el aporte semanal lo calcula el Orquestador (aporte_semanal)');
    }
    for (const a of requeridos) {
      const r = aporte !== null
        ? (aporte.contexto !== null ? { estado: 'ok' as const } : undefined)   // riesgo_capital del aporte lo calcula el código
        : datos.resultados_codigo?.[a];
      resultados_agentes[a] = r ?? { estado: 'ausente' };
      registros.push({ agente: a, estado: r ? r.estado : 'ausente', analisis_id: r?.analisis_id ?? null, reintentos: 0 });
    }
  } else {
    const sobreDe = (a: Agente): unknown => {
      const base = datos.sobres[a];
      if (a !== 'tecnico' || tecnico === null) return base;
      const extra = { tecnico_codigo: { estado: tecnico.estado, snapshot: tecnico.snapshot, detonantes: tecnico.detonantes, descartes: tecnico.descartes, motivos: tecnico.motivos } };
      return typeof base === 'object' && base !== null ? { ...(base as object), ...extra } : extra;
    };
    const respuestas = await Promise.all(ejecutar.map(a => conReintentos(() => puertos.analista(a, sobreDe(a)), REINTENTOS_POR_AGENTE, () => puertos.ahora())));
    ejecutar.forEach((a, i) => {
      const it = respuestas[i]!;
      const r = it.respuesta;
      ejecuciones.push(registro(ctx, a, r, it.reintentos, it.started_at, it.finished_at));
      registros.push({ agente: a, estado: r.estado, analisis_id: r.analisis_id ?? null, reintentos: it.reintentos, ...(r.error ? { error: r.error } : {}) });
      resultados_agentes[a] = r.estado === 'ok'
        ? { estado: 'ok', ...(r.analisis_id ? { analisis_id: r.analisis_id } : {}), ...(r.veredicto !== undefined ? { veredicto: r.veredicto } : {}) }
        : { estado: 'error' };
      if (r.estado === 'ok' && r.salida !== undefined) salidas_analistas[a] = r.salida;
    });
  }

  // ---- Auditor (siempre)
  const ia = bloqueoEstructural !== null
    ? { respuesta: { estado: 'ok' as const, veredicto: 'BLOQUEO_REGLA' as VeredictoAuditor, reglas_revisadas: [bloqueoEstructural.regla] } as RespuestaAuditor, reintentos: 0, started_at: puertos.ahora(), finished_at: puertos.ahora() }
    : await conReintentos(() => puertos.auditor(datos.sobre_auditor), REINTENTOS_AUDITOR, () => puertos.ahora());
  const ra = ia.respuesta;
  let auditoria: Auditoria | null = null;
  let auditorError = ra.estado === 'error' ? (ra.error ?? 'error del Auditor') : null;
  if (ra.estado === 'ok') {
    if (ra.veredicto === undefined || !VEREDICTOS_AUDITOR.includes(ra.veredicto)) {
      auditorError = `veredicto del Auditor ausente o desconocido: ${String(ra.veredicto)}`;
    } else {
      auditoria = { veredicto: ra.veredicto, reglas_revisadas: ra.reglas_revisadas ?? [], ...(ra.analisis_id ? { analisis_id: ra.analisis_id } : {}) };
    }
  }
  if (bloqueoEstructural !== null) {
    ejecuciones.push(registro(ctx, NOMBRE_AGENTE_ORQUESTADOR, { estado: 'ok' }, 0, ia.started_at, ia.finished_at,
      { resultado: 'BLOQUEADO', motivo: 'bloqueo_estructural', regla: bloqueoEstructural.regla, fuente: bloqueoEstructural.fuente }));
  } else {
    ejecuciones.push(registro(ctx, NOMBRE_AGENTE_AUDITOR,
      { estado: auditoria === null ? 'error' : 'ok', ...(auditorError ? { error: auditorError } : {}), ...(ra.analisis_id ? { analisis_id: ra.analisis_id } : {}) },
      ia.reintentos, ia.started_at, ia.finished_at));
  }

  // ---- Director (rutas analítica y de posición abierta)
  let director: EstadoDirector = 'no_aplica';
  let director_analisis_id: string | null = null;
  if (ruta !== 'determinista' && bloqueoEstructural === null) {
    const id = await conReintentos(() => puertos.director({
      run_id: corrida_id, snapshot_id: datos.snapshot_id, ticker: sol.ticker, mercado: sol.mercado, portafolio_codigo: portafolio, tipo_evaluacion: tipo,
      salidas_analistas, auditoria: auditoria === null ? null : { veredicto: auditoria.veredicto, reglas_revisadas: auditoria.reglas_revisadas },
      reglas_versiones_ids: datos.reglas_versiones_ids, contexto: datos.contexto_director ?? null,
    }), REINTENTOS_POR_AGENTE, () => puertos.ahora());
    director = id.respuesta.estado === 'ok' ? 'ok' : 'error';
    director_analisis_id = id.respuesta.analisis_id ?? null;
    ejecuciones.push(registro(ctx, NOMBRE_AGENTE_DIRECTOR, id.respuesta, id.reintentos, id.started_at, id.finished_at));
  }

  // ---- Entrada del Motor (siempre se entrega, aunque falte algo)
  let senal_salida: boolean | null = null;
  let salida: ContextoSalida | undefined = datos.motor?.salida;
  if (portafolio === 'PCP' && tipo === 'posicion_abierta' && datos.salida_pcp !== undefined) {
    senal_salida = tecnico === null ? null : tecnico.senal_salida;
    if (senal_salida === null) {
      faltantes.push('senal_salida_pcp: no evaluable; no se evalúa la salida del PCP (no se supone false)');
    } else {
      const exigida = evaluarSalidaPCP({ ...datos.salida_pcp, senal_salida });
      salida = { ...(datos.motor?.salida ?? {}), exigida };
    }
  }

  const usoMomento = USO_MOMENTO_POR_CASO[`${portafolio}:${tipo}`];
  let momento: EntradaMotor['momento'];
  if (usoMomento !== undefined) {
    if (tecnico !== null && tecnico.momento !== null) {
      momento = { detonante_confirmado: tecnico.momento[usoMomento].detonante_confirmado, ...(datos.motor?.condicion_ejecucion ? { condicion_ejecucion: datos.motor.condicion_ejecucion } : {}) };
    }
  } else if (datos.motor?.momento !== undefined) {
    momento = { ...datos.motor.momento };
  }

  const m = datos.motor ?? {};
  const entrada_motor: EntradaMotor = {
    corrida_id, ticker: sol.ticker, portafolio_codigo: portafolio, tipo_evaluacion: tipo, ruta, fecha_evaluacion,
    reglas_versiones_ids: datos.reglas_versiones_ids, parametros_versiones: params.parametros_versiones,
    snapshot_id: datos.snapshot_id, agentes_requeridos: requeridos, resultados_agentes, auditoria, director: { estado: director },
    datos_vencidos: [...(datos.datos_vencidos ?? [])], datos_faltantes: faltantes, posicion_confirmada: coh.confirmada,
    ...(m.capital !== undefined ? { capital: m.capital } : {}),
    ...(m.tesis_estado !== undefined ? { tesis_estado: m.tesis_estado } : {}),
    ...(momento !== undefined ? { momento } : {}),
    ...(salida !== undefined ? { salida } : {}),
    ...(aporte !== null ? (aporte.contexto !== null ? { aporte: aporte.contexto } : {}) : m.aporte !== undefined ? { aporte: m.aporte } : {}),
    ...(m.revision_etf !== undefined ? { revision_etf: m.revision_etf } : {}),
    ...(m.retiro !== undefined ? { retiro: m.retiro } : {}),
    ...(m.monto_operacion !== undefined ? { monto_operacion: m.monto_operacion } : {}),
    ...(m.decision_previa_id !== undefined ? { decision_previa_id: m.decision_previa_id } : {}),
  };
  const salida_motor = decidir(entrada_motor);

  const finalizada_at = puertos.ahora();
  const referencias: Record<string, unknown> = {
    posicion: `${sol.ticker}:${portafolio}`,
    autorizacion_usuario: null,
    ...(coh.inconsistencia !== null ? { posicion_inconsistencia: coh.inconsistencia } : {}),
    ...(tecnico !== null ? { tecnico: tecnico.referencias.tecnico } : {}),
    ...(bloqueoEstructural !== null ? { bloqueo_estructural: bloqueoEstructural } : {}),
    ...(aporte !== null && aporte.modo !== null ? { aporte_modo: aporte.modo } : {}),
    ...(datos.sustitucion_autorizada ? { autorizacion_sustitucion: datos.sustitucion_autorizada } : {}),
    ...(avisos.length > 0 ? { avisos } : {}),
    ...(datos.datos_faltantes !== undefined || faltantes.length > 0 ? { datos_faltantes: faltantes } : {}),
    ...(tecnico !== null && tecnico.datos_faltantes_detalle.length > 0 ? { datos_faltantes_detalle: tecnico.datos_faltantes_detalle } : {}),
  };
  const fila: FilaCorrida = {
    corrida_id, version: 1, corrige_version: null, corrida_previa_id: datos.corrida_previa_id ?? null,
    expediente_id: datos.expediente_id, ticker: sol.ticker, mercado: sol.mercado, portafolio_codigo: portafolio, tipo_evaluacion: tipo, ruta,
    disparador: sol.disparador, iniciada_at, finalizada_at,
    snapshot_id: datos.snapshot_id, snapshot_generado_en: datos.snapshot_generado_en, snapshot_fecha_datos: datos.snapshot_fecha_datos,
    reglas_versiones_ids: datos.reglas_versiones_ids, matriz_agentes_version: MATRIZ_AGENTES_VERSION, tesis_ref: datos.tesis_ref,
    agentes_requeridos: requeridos, resultados_agentes: registros,
    auditoria_veredicto: salida_motor.auditoria_veredicto, auditoria_analisis_id: auditoria?.analisis_id ?? null,
    decision: salida_motor.decision, decision_id: null, director_estado: director, director_analisis_id,
    estado_final: salida_motor.estado_final, motivos: salida_motor.motivos_estado,
    datos_vencidos: entrada_motor.datos_vencidos, referencias,
  };

  return { resultado: 'corrida', corrida_id, fila_historial: fila, ejecuciones, entrada_motor, salida_motor, tecnico, avisos };
}
