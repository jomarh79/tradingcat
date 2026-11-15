/** Revisión semestral de PMP (PMP-11), reglas aprobadas el 10-nov. Código determinista y puro; no escribe nada.
 *
 *  - Rendimiento anualizado = (valor estimado vigente ÷ cierre actual)^(12 ÷ horizonte_meses) − 1; por debajo de 14% → «revisar venta del 100%».
 *  - «Pierde fundamentales» = al menos 2 de 4 deterioros: (1) ingresos y márgenes, (2) deuda vs ingresos (+25 pp), (3) flujo de caja libre negativo
 *    (4 trimestres seguidos o 2 años fiscales seguidos), (4) deterioro de activos reconocido > 5% de los activos totales. Un criterio sin datos es NO_EVALUABLE (nunca se supone).
 *  - El resultado es una TAREA de revisión: la venta nunca es automática (`venta_automatica` siempre false) y la decide el usuario.
 *  - [PROPUESTA] umbrales del criterio 1 (no estaban fijados): ingresos TTM caen más de 10% contra el TTM del año previo, o el margen operativo cae 5 pp o más. */

export const RENDIMIENTO_MINIMO_PCT = 14;
export const HORIZONTE_MESES_PMP = 36;
export const DETERIORO_DEUDA_PP = 25;
export const DETERIORO_ACTIVOS_PCT = 5;
export const CAIDA_INGRESOS_PCT = 10;
export const CAIDA_MARGEN_PP = 5;
export const DETERIOROS_PARA_PERDER = 2;
export const TRIMESTRES_FCF = 4;
export const ANIOS_FCF = 2;

export type EstadoCriterio = 'deterioro' | 'sin_deterioro' | 'no_evaluable';

export interface Rendimiento14 {
  estado: 'evaluado' | 'no_evaluable';
  anualizado_pct: number | null;
  por_debajo: boolean | null;
  detalle: string;
}

const finito = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export function rendimientoAnualizado(valor_estimado: number | null, cierre: number | null, horizonte_meses: number = HORIZONTE_MESES_PMP): Rendimiento14 {
  if (!finito(valor_estimado) || !finito(cierre) || valor_estimado <= 0 || cierre <= 0 || !finito(horizonte_meses) || horizonte_meses <= 0) {
    return { estado: 'no_evaluable', anualizado_pct: null, por_debajo: null, detalle: 'Falta el valor estimado vigente, el cierre actual o el horizonte (valores positivos)' };
  }
  const crudo = (Math.pow(valor_estimado / cierre, 12 / horizonte_meses) - 1) * 100;
  return {
    estado: 'evaluado', anualizado_pct: Math.round(crudo * 100) / 100, por_debajo: Math.round(crudo * 100) / 100 < RENDIMIENTO_MINIMO_PCT, // se compara redondeado a 2 decimales (sin ruido de coma flotante en el límite)
    detalle: `(${valor_estimado} ÷ ${cierre})^(12/${horizonte_meses}) − 1 = ${(Math.round(crudo * 100) / 100).toFixed(2)}% (mínimo ${RENDIMIENTO_MINIMO_PCT}%)`,
  };
}

export interface DatosFundamentalesPMP {
  ingresos_ttm: number | null;
  ingresos_ttm_previo: number | null;
  margen_operativo_ttm: number | null;      // ratio 0..1
  margen_operativo_previo: number | null;   // ratio 0..1, mismo periodo del año previo
  deuda_total: number | null;
  deuda_total_previa: number | null;
  /** Flujo de caja libre de los últimos trimestres (más reciente al final) y de los últimos años fiscales; null o lista corta = sin datos. */
  fcf_trimestres: readonly (number | null)[] | null;
  fcf_anuales: readonly (number | null)[] | null;
  deterioro_activos: number | null;
  activos_totales: number | null;
}

export interface CriterioFundamental { codigo: 'ingresos_margenes' | 'deuda_vs_ingresos' | 'flujo_caja_libre' | 'deterioro_activos'; estado: EstadoCriterio; detalle: string }

const crece = (a: number, b: number): number => ((a - b) / Math.abs(b)) * 100;

export function evaluarCriterios(d: DatosFundamentalesPMP): CriterioFundamental[] {
  const out: CriterioFundamental[] = [];

  // 1. ingresos y márgenes
  {
    const ing = finito(d.ingresos_ttm) && finito(d.ingresos_ttm_previo) && d.ingresos_ttm_previo !== 0 ? crece(d.ingresos_ttm, d.ingresos_ttm_previo) : null;
    const mar = finito(d.margen_operativo_ttm) && finito(d.margen_operativo_previo) ? Math.round((d.margen_operativo_ttm - d.margen_operativo_previo) * 1e6) / 1e4 : null;
    if (ing === null && mar === null) out.push({ codigo: 'ingresos_margenes', estado: 'no_evaluable', detalle: 'Sin ingresos ni margen operativo comparables' });
    else if ((ing !== null && ing < -CAIDA_INGRESOS_PCT) || (mar !== null && mar <= -CAIDA_MARGEN_PP)) {
      out.push({ codigo: 'ingresos_margenes', estado: 'deterioro', detalle: `Ingresos ${ing === null ? 'sin dato' : ing.toFixed(1) + '%'}; margen operativo ${mar === null ? 'sin dato' : mar.toFixed(1) + ' pp'}` });
    } else if (ing === null || mar === null) {
      out.push({ codigo: 'ingresos_margenes', estado: 'no_evaluable', detalle: `Solo se pudo medir una de las dos (ingresos ${ing === null ? 'sin dato' : ing.toFixed(1) + '%'}; margen ${mar === null ? 'sin dato' : mar.toFixed(1) + ' pp'})` });
    } else out.push({ codigo: 'ingresos_margenes', estado: 'sin_deterioro', detalle: `Ingresos ${ing.toFixed(1)}%; margen operativo ${mar.toFixed(1)} pp` });
  }

  // 2. deuda vs ingresos
  {
    const ing = finito(d.ingresos_ttm) && finito(d.ingresos_ttm_previo) && d.ingresos_ttm_previo !== 0 ? crece(d.ingresos_ttm, d.ingresos_ttm_previo) : null;
    const deu = finito(d.deuda_total) && finito(d.deuda_total_previa) && d.deuda_total_previa > 0 ? crece(d.deuda_total, d.deuda_total_previa) : null;
    if (ing === null || deu === null) out.push({ codigo: 'deuda_vs_ingresos', estado: 'no_evaluable', detalle: 'Sin deuda o ingresos comparables' });
    else {
      const dif = deu - ing;
      out.push({ codigo: 'deuda_vs_ingresos', estado: dif >= DETERIORO_DEUDA_PP ? 'deterioro' : 'sin_deterioro', detalle: `Deuda ${deu.toFixed(1)}% vs ingresos ${ing.toFixed(1)}% (diferencia ${dif.toFixed(1)} pp; límite ${DETERIORO_DEUDA_PP})` });
    }
  }

  // 3. flujo de caja libre
  {
    const t = d.fcf_trimestres, a = d.fcf_anuales;
    const ultT = t && t.length >= TRIMESTRES_FCF ? t.slice(-TRIMESTRES_FCF) : null;
    const ultA = a && a.length >= ANIOS_FCF ? a.slice(-ANIOS_FCF) : null;
    const tCompleto = ultT !== null && ultT.every(finito);
    const aCompleto = ultA !== null && ultA.every(finito);
    const tNeg = tCompleto && (ultT as number[]).every(x => x < 0);
    const aNeg = aCompleto && (ultA as number[]).every(x => x < 0);
    if (tNeg || aNeg) out.push({ codigo: 'flujo_caja_libre', estado: 'deterioro', detalle: tNeg ? `Negativo en los últimos ${TRIMESTRES_FCF} trimestres` : `Negativo en los últimos ${ANIOS_FCF} años fiscales` });
    else if (tCompleto || aCompleto) out.push({ codigo: 'flujo_caja_libre', estado: 'sin_deterioro', detalle: 'Hay flujo de caja libre no negativo en el periodo revisado' });
    else out.push({ codigo: 'flujo_caja_libre', estado: 'no_evaluable', detalle: 'Sin flujo de caja libre suficiente (4 trimestres o 2 años)' });
  }

  // 4. deterioro de activos
  {
    if (!finito(d.deterioro_activos) || !finito(d.activos_totales) || d.activos_totales <= 0) out.push({ codigo: 'deterioro_activos', estado: 'no_evaluable', detalle: 'Sin deterioro de activos o activos totales' });
    else {
      const pct = (Math.abs(d.deterioro_activos) / d.activos_totales) * 100;
      out.push({ codigo: 'deterioro_activos', estado: pct > DETERIORO_ACTIVOS_PCT ? 'deterioro' : 'sin_deterioro', detalle: `Deterioro ${pct.toFixed(2)}% de los activos (límite ${DETERIORO_ACTIVOS_PCT}%)` });
    }
  }
  return out;
}

export interface PerdidaFundamentales { estado: 'pierde' | 'no_pierde' | 'no_evaluable'; deterioros: number; sin_datos: number; criterios: CriterioFundamental[] }

export function perdidaDeFundamentales(d: DatosFundamentalesPMP): PerdidaFundamentales {
  const criterios = evaluarCriterios(d);
  const deterioros = criterios.filter(c => c.estado === 'deterioro').length;
  const sin = criterios.filter(c => c.estado === 'no_evaluable').length;
  const estado = deterioros >= DETERIOROS_PARA_PERDER ? 'pierde' : deterioros + sin < DETERIOROS_PARA_PERDER ? 'no_pierde' : 'no_evaluable';
  return { estado, deterioros, sin_datos: sin, criterios };
}

export interface ResultadoRevisionPMP {
  resultado: 'revisar_venta_100' | 'mantener' | 'no_evaluable';
  venta_automatica: false;
  motivos: string[];
  rendimiento: Rendimiento14;
  fundamentales: PerdidaFundamentales;
}

export function revisionSemestralPMP(e: { valor_estimado: number | null; cierre: number | null; horizonte_meses?: number; fundamentales: DatosFundamentalesPMP }): ResultadoRevisionPMP {
  const rendimiento = rendimientoAnualizado(e.valor_estimado, e.cierre, e.horizonte_meses);
  const fundamentales = perdidaDeFundamentales(e.fundamentales);
  const motivos: string[] = [];
  if (rendimiento.por_debajo === true) motivos.push(`Rendimiento anualizado ${rendimiento.anualizado_pct}% por debajo de ${RENDIMIENTO_MINIMO_PCT}%`);
  if (fundamentales.estado === 'pierde') motivos.push(`Pierde fundamentales (${fundamentales.deterioros} de 4 deterioros)`);
  let resultado: ResultadoRevisionPMP['resultado'];
  if (motivos.length > 0) resultado = 'revisar_venta_100';
  else if (rendimiento.estado === 'evaluado' && fundamentales.estado === 'no_pierde') resultado = 'mantener';
  else {
    resultado = 'no_evaluable';
    if (rendimiento.estado !== 'evaluado') motivos.push(rendimiento.detalle);
    if (fundamentales.estado === 'no_evaluable') motivos.push(`Fundamentales no evaluables (${fundamentales.deterioros} deterioros, ${fundamentales.sin_datos} criterios sin datos)`);
  }
  return { resultado, venta_automatica: false, motivos, rendimiento, fundamentales };
}
