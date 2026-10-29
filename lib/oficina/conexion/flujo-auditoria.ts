// Flujo que une la conexión: expediente → reglas → hechos de la posición → entrada del Auditor → corrida del Orquestador → análisis guardado.
// Orden definido el 28-oct: (1) solicitud, (2) buscar el expediente por ticker y portafolio, (3) recuperarlo o crearlo (id real de Supabase),
// (4) contexto de la corrida (reglas, hechos, plan), (5) agentes y Auditor, (6) registrar la corrida. Sin expediente NO se guarda `oficina_analisis`.
// El cliente se INYECTA (sesión del usuario: el RLS "propias" aplica y `user_id` lo pone la base; con clave de servicio se pasa `user_id` explícito).
// No hay datos simulados aquí: los tests usan una base en memoria solo para probar el orden y los errores.
//
// Si la preparación falla (no hay portafolio, expediente, reglas o hechos), la corrida NO se detiene en silencio ni se inventa nada: el motivo
// entra en `datos_faltantes`, el Auditor responde error (sin ejecutarse) y el Orquestador deja la corrida incompleta o pendiente según su contrato.
// El único puerto que implementa este módulo es el del Auditor; los analistas y el Director llegan como puertos base.
import { fechaEnZona, ZONA_OFICINA } from '../orquestador/calendario';
import { ejecutarCorrida } from '../orquestador/corrida';
import type { DatosCongelados, OpcionesCorrida, Puertos, RespuestaAuditor, ResultadoCorrida } from '../orquestador/corrida';
import { validarSolicitud } from '../orquestador/solicitud';
import type { SolicitudNormalizada } from '../orquestador/solicitud';
import { puertoAuditor } from '../auditor/puerto';
import { esUuid } from '../orquestador/persistencia';
import { conSobreAuditor, construirEntradaAuditor } from './entrada-auditor';
import { obtenerOCrearExpediente } from './expediente-bd';
import { cargarHechosPosicion } from './hechos-bd';
import type { ConsultaFiltrable } from './hechos-bd';
import { guardarAnalisisAuditor } from './persistencia-auditor';
import { cargarFilasReglas, resolverReglas } from './reglas-bd';

export const TABLA_PORTAFOLIOS_CONFIG = 'oficina_portafolios_config';
export const COLUMNAS_PORTAFOLIOS_CONFIG = 'portfolio_id,codigo';

/** Un solo cliente cubre todas las lecturas y escrituras del flujo (supabase-js lo cumple estructuralmente). */
export interface ClienteOficina {
  from(tabla: string): {
    select(columnas: string): ConsultaFiltrable;
    insert(fila: Record<string, unknown>): {
      select(columnas: string): { single(): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> };
    };
  };
}
export interface OpcionesFlujo { user_id?: string | null }

export type ResultadoPortafolio = { ok: true; portfolio_id: string } | { ok: false; problemas: string[]; error_bd?: string };

/** Traduce el código del portafolio al `portfolio_id` real usando `oficina_portafolios_config`. Debe haber exactamente una fila. */
export async function resolverPortfolioId(cliente: ClienteOficina, codigo: string, user_id?: string | null): Promise<ResultadoPortafolio> {
  try {
    let q = cliente.from(TABLA_PORTAFOLIOS_CONFIG).select(COLUMNAS_PORTAFOLIOS_CONFIG);
    if (user_id !== undefined && user_id !== null) q = q.eq('user_id', user_id);
    const r = await q.eq('codigo', codigo);
    if (r.error) return { ok: false, problemas: [`${TABLA_PORTAFOLIOS_CONFIG}: ${r.error.message}`], error_bd: r.error.message };
    if (!Array.isArray(r.data)) return { ok: false, problemas: [`${TABLA_PORTAFOLIOS_CONFIG}: la consulta no devolvió filas`] };
    if (r.data.length !== 1) return { ok: false, problemas: [`${TABLA_PORTAFOLIOS_CONFIG}: se esperaba 1 fila del portafolio ${codigo} y hay ${r.data.length}`] };
    const id = (r.data[0] as { portfolio_id?: unknown }).portfolio_id;
    if (!esUuid(id)) return { ok: false, problemas: [`${TABLA_PORTAFOLIOS_CONFIG}: el portafolio ${codigo} no trae un portfolio_id válido`] };
    return { ok: true, portfolio_id: id };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return { ok: false, problemas: [`${TABLA_PORTAFOLIOS_CONFIG}: ${m}`], error_bd: m };
  }
}

export interface ArgumentosPreparacion {
  run_id: string;
  solicitud: SolicitudNormalizada & { portafolio: NonNullable<SolicitudNormalizada['portafolio']> };
  datos: DatosCongelados;
  user_id?: string | null;
}
export type ResultadoPreparacion =
  | { ok: true; datos: DatosCongelados; expediente_id: string; portfolio_id: string; expediente_creado: boolean }
  | { ok: false; problemas: string[]; etapa: string };

/** Pasos 2 a 4: deja `datos` con expediente_id real, versiones de reglas y `sobre_auditor`. No ejecuta agentes. */
export async function prepararAuditoria(cliente: ClienteOficina, a: ArgumentosPreparacion): Promise<ResultadoPreparacion> {
  const falla = (etapa: string, problemas: string[]): ResultadoPreparacion => ({ ok: false, etapa, problemas });
  try {
    const s = a.solicitud;
    if (a.datos.posicion_existe === null) return falla('posicion', ['posicion_existe no está confirmada: no se crea el expediente ni se construye la entrada del Auditor']);

    const pf = await resolverPortfolioId(cliente, s.portafolio, a.user_id);
    if (!pf.ok) return falla('portafolio', pf.problemas);

    const exp = await obtenerOCrearExpediente(cliente, {
      user_id: a.user_id, ticker: s.ticker, mercado: s.mercado, portfolio_id: pf.portfolio_id, portafolio_codigo: s.portafolio, posicion_existe: a.datos.posicion_existe,
    });
    if (!exp.ok) return falla('expediente', exp.problemas);
    if (a.datos.expediente_id !== null && a.datos.expediente_id !== exp.expediente_id) {
      return falla('expediente', [`el expediente de los datos congelados (${a.datos.expediente_id}) no es el de la base (${exp.expediente_id})`]);
    }

    const carga = await cargarFilasReglas(cliente);
    if (!carga.ok) return falla('reglas', [carga.error]);
    const congeladas = a.datos.reglas_versiones_ids;
    const reglas = resolverReglas(carga.filas, {
      fecha: fechaEnZona(new Date(s.solicitado_en), ZONA_OFICINA), ...(congeladas.length > 0 ? { versiones_ids: congeladas } : {}),
    });
    if (reglas.problemas.length > 0) return falla('reglas', reglas.problemas);

    const hechos = await cargarHechosPosicion(cliente, { portfolio_id: pf.portfolio_id, ticker: s.ticker, posicion_existe: a.datos.posicion_existe });
    if (!hechos.ok) return falla('hechos', hechos.problemas);

    const base: DatosCongelados = { ...a.datos, expediente_id: exp.expediente_id };
    const entrada = construirEntradaAuditor({ run_id: a.run_id, solicitud: s, datos: base, reglas: reglas.reglas, hechos: hechos.hechos });
    if (!entrada.ok) return falla('entrada', entrada.problemas);
    return { ok: true, datos: conSobreAuditor(base, entrada.entrada), expediente_id: exp.expediente_id, portfolio_id: pf.portfolio_id, expediente_creado: exp.creado };
  } catch (e) {
    return falla('excepcion', [e instanceof Error ? e.message : String(e)]);
  }
}

/** Puerto del Auditor con guardado: corre el Auditor (código) y escribe su salida en `oficina_analisis`. Si no se puede guardar, es error (no se finge). */
export function puertoAuditorBd(cliente: ClienteOficina, p: { expediente_id: string; user_id?: string | null }): (sobre: unknown) => Promise<RespuestaAuditor> {
  return async (sobre) => {
    const r = await puertoAuditor(sobre);
    if (r.salida === undefined) return { estado: 'error', error: r.error ?? 'el Auditor no devolvió salida' };
    const g = await guardarAnalisisAuditor(cliente, r.salida, { user_id: p.user_id, expediente_id: p.expediente_id, ejecucion_id: null });
    if (!g.ok) return { estado: 'error', error: `no se pudo guardar el análisis del Auditor: ${g.problemas.join('; ')}` };
    return { estado: 'ok', veredicto: r.veredicto, analisis_id: g.analisis_id, reglas_revisadas: r.reglas_revisadas };
  };
}

export interface ResultadoFlujo {
  corrida: ResultadoCorrida;
  /** null cuando la solicitud no llegó a necesitar al Auditor (inválida, sin corrida, pendiente por solicitud o sin datos). */
  preparacion: ResultadoPreparacion | null;
}

/**
 * Corrida completa con la base real: prepara la entrada del Auditor y entrega todo a `ejecutarCorrida`. Los analistas y el Director llegan como puertos base.
 * El `run_id` del Auditor es el `corrida_id` de la corrida.
 */
export async function ejecutarCorridaConAuditoria(
  cliente: ClienteOficina, solicitud: unknown, datos: DatosCongelados | null, base: Omit<Puertos, 'auditor'>, opciones: OpcionesCorrida = {}, flujo: OpcionesFlujo = {},
): Promise<ResultadoFlujo> {
  const run_id = base.nuevoId();
  // El Orquestador pide un solo id (el corrida_id): es el mismo run_id con el que se arma la entrada del Auditor.
  const nuevoId = (): string => run_id;
  const sinAuditor = async (): Promise<RespuestaAuditor> => ({ estado: 'error', error: 'el Auditor no se ejecuta para esta solicitud' });

  const v = validarSolicitud(solicitud);
  if (v.clase !== 'aceptada' || datos === null) {
    return { corrida: await ejecutarCorrida(solicitud, datos, { ...base, nuevoId, auditor: sinAuditor }, opciones), preparacion: null };
  }
  const prep = await prepararAuditoria(cliente, { run_id, solicitud: v.solicitud, datos, user_id: flujo.user_id });
  if (prep.ok) {
    const auditor = puertoAuditorBd(cliente, { expediente_id: prep.expediente_id, user_id: flujo.user_id });
    return { corrida: await ejecutarCorrida(solicitud, prep.datos, { ...base, nuevoId, auditor }, opciones), preparacion: prep };
  }
  const motivos = prep.problemas.map((m) => `auditor (${prep.etapa}): ${m}`);
  const sinEntrada: DatosCongelados = { ...datos, datos_faltantes: [...(datos.datos_faltantes ?? []), ...motivos] };
  const auditor = async (): Promise<RespuestaAuditor> => ({ estado: 'error', error: `no se construyó la entrada del Auditor: ${prep.problemas.join('; ')}` });
  return { corrida: await ejecutarCorrida(solicitud, sinEntrada, { ...base, nuevoId, auditor }, opciones), preparacion: prep };
}
