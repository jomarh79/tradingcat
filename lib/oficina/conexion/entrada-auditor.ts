// Arma la entrada del Auditor (auditoria_entrada.v1) con lo que el Orquestador ya tiene congelado + los hechos que debe aportar la capa de datos.
// No inventa: lo que no se declara queda en null y el Auditor lo reporta como dato faltante.
import { CONTRATO_ENTRADA, validarEntrada } from '../auditor';
import type { DatoFuente, EntradaAuditor, PlanPCP, ReglaEntrada, CompraPosicion } from '../auditor';
import { ZONA_OFICINA, calcularAporteSemanal, fechaEnZona } from '../orquestador';
import type { DatosCongelados, SolicitudNormalizada } from '../orquestador';

/** Lo que la capa de datos (posiciones, compras, análisis) debe declarar. Todo opcional: lo ausente se reporta como no declarado. */
export interface HechosAuditor {
  operacion?: Partial<EntradaAuditor['operacion']>;
  posicion?: {
    fecha_apertura?: string | null; compras?: CompraPosicion[] | null; ventas_previas?: number | null;
    costo_promedio_ponderado?: string | null; plan_pcp?: PlanPCP | null; rol?: string | null;
  };
  posiciones_abiertas?: number | null;
  datos?: Partial<EntradaAuditor['datos']>;
  datos_fuente?: DatoFuente[];
  analisis_ids?: string[];
}

export interface ArgumentosEntrada {
  run_id: string;
  solicitud: SolicitudNormalizada & { portafolio: string };
  datos: DatosCongelados;
  reglas: ReglaEntrada[];
  hechos?: HechosAuditor;
}
export type ResultadoEntrada = { ok: true; entrada: EntradaAuditor } | { ok: false; problemas: string[] };

/** Acción de la operación según el tipo de evaluación (lo que se está proponiendo, no una decisión). */
export const ACCION_POR_TIPO: Record<string, EntradaAuditor['operacion']['accion']> = {
  nueva_posicion: 'abrir', recompra: 'recomprar', posicion_abierta: 'mantener', revision_tesis: 'mantener',
  aporte_periodico: 'aporte', revision_anual_etf: 'mantener', retiro_quinquenal: 'reducir',
};

export function construirEntradaAuditor(a: ArgumentosEntrada): ResultadoEntrada {
  const { solicitud: s, datos: d, hechos: h = {} } = a;
  const problemas: string[] = [];
  if (d.posicion_existe === null) problemas.push('posicion_existe no está confirmada: el Orquestador debió dejar la corrida en pendiente_informacion');
  const accion = h.operacion?.accion ?? ACCION_POR_TIPO[s.tipo_evaluacion];
  if (!accion) problemas.push(`no hay acción para el tipo ${s.tipo_evaluacion}`);

  // Aporte semanal de ETFs: lo calcula el Orquestador (ignora cualquier otro monto) y el Auditor lo revisa.
  let aporte: EntradaAuditor['datos']['aporte_etf'] = h.datos?.aporte_etf ?? null;
  let montoAporte: string | null = null;
  let duplicado: boolean | null = null;
  if (s.tipo_evaluacion === 'aporte_periodico' && s.portafolio === 'ETF' && d.aporte_semanal) {
    const r = calcularAporteSemanal(d.aporte_semanal);
    if (r.modo !== null && r.contexto !== null) {
      montoAporte = r.modo === 'ninguno' ? null : r.contexto.monto;
      aporte = { modo: r.modo, monto_por_etf: montoAporte };
    }
    duplicado = d.aporte_semanal.duplicado;
  }

  // Semilla: dinero nuevo declarado por ti; un hecho contradictorio no se acepta en silencio.
  let origen = h.operacion?.origen_dinero ?? null;
  if (d.dinero_nuevo === true) {
    if (origen !== null && origen !== 'dinero_nuevo') problemas.push('dinero_nuevo=true contradice el origen del dinero declarado');
    origen = 'dinero_nuevo';
  } else if (d.dinero_nuevo === false && origen === 'dinero_nuevo') problemas.push('dinero_nuevo=false contradice el origen del dinero declarado');

  // Rige la versión congelada: las versiones del snapshot deben ser exactamente las de las reglas que se envían.
  const enviadas = a.reglas.map((r) => r.version_id).sort();
  const congeladas = [...d.reglas_versiones_ids].sort();
  if (congeladas.length > 0 && (enviadas.length !== congeladas.length || enviadas.some((x, i) => x !== congeladas[i]))) {
    problemas.push('las reglas enviadas no coinciden con las versiones congeladas del snapshot');
  }
  if (problemas.length > 0) return { ok: false, problemas };

  const sus = d.sustitucion_autorizada ?? null;
  const entrada: EntradaAuditor = {
    contrato: CONTRATO_ENTRADA, run_id: a.run_id, snapshot_id: d.snapshot_id, ticker: s.ticker, mercado: s.mercado,
    portafolio_codigo: s.portafolio, tipo_evaluacion: s.tipo_evaluacion,
    fecha_evaluacion: fechaEnZona(new Date(s.solicitado_en), ZONA_OFICINA),
    operacion: {
      precio: null, porcentaje_venta: null, instrumento_destino: null, dividendo_misma_empresa: null, motivo_venta: null, ...h.operacion,
      accion: accion!, origen_dinero: origen, monto: h.operacion?.monto !== undefined ? h.operacion.monto : montoAporte,
    },
    posicion: {
      existe: d.posicion_existe as boolean, fecha_apertura: null, compras: null, ventas_previas: null, costo_promedio_ponderado: null,
      plan_pcp: null, rol: null, ...h.posicion,
    },
    contexto_portafolio: { posiciones_abiertas: h.posiciones_abiertas ?? null, movimiento_ya_registrado: duplicado, sustitucion_autorizada: sus },
    datos: {
      analisis_presentes: [], ficha_pmp: null, candidata_semilla: null, recompra_con_analisis_propios: null, stop_tocado: null,
      aumenta_peso_sectorial: null, dividendo_recibido: null, neto_mensual_pcp: null, traspaso_identificable: null, historial_meses_etf: null,
      fundamentos: null, ...h.datos, aporte_etf: aporte,
    },
    datos_fuente: h.datos_fuente ?? [], analisis_ids: h.analisis_ids ?? [], reglas_vigentes: a.reglas,
  };
  const malos = validarEntrada(entrada);
  return malos.length > 0 ? { ok: false, problemas: malos } : { ok: true, entrada };
}

/** Pone la entrada del Auditor como `sobre_auditor` de los datos congelados y fija las versiones de reglas si faltaban. */
export function conSobreAuditor(datos: DatosCongelados, entrada: EntradaAuditor): DatosCongelados {
  return {
    ...datos, sobre_auditor: entrada,
    reglas_versiones_ids: datos.reglas_versiones_ids.length > 0 ? datos.reglas_versiones_ids : entrada.reglas_vigentes.map((r) => r.version_id),
  };
}
