import { DECISIONES, ErrorMotor, TIPOS_EVALUACION } from './tipos';
import type { Decision, Ruta, TipoEvaluacion } from './tipos';

/** Vocabulario por tipo de evaluación (contrato del Motor, sección 3). Debe coincidir con
 *  la restricción oficina_decisiones_vocabulario_tipo_ck de la base. */
export const VOCABULARIO_POR_TIPO: Readonly<Record<TipoEvaluacion, readonly Decision[]>> = {
  nueva_posicion: ['COMPRAR', 'ESPERAR', 'NO_COMPRAR', 'VIGILAR', 'NO_EVALUABLE', 'BLOQUEADO'],
  recompra: ['RECOMPRAR', 'ESPERAR', 'NO_RECOMPRAR', 'NO_EVALUABLE', 'BLOQUEADO'],
  posicion_abierta: ['MANTENER', 'MANTENER_BAJO_VIGILANCIA', 'REDUCIR', 'VENDER', 'ESPERAR', 'NO_EVALUABLE', 'BLOQUEADO'],
  revision_tesis: ['MANTENER', 'MANTENER_BAJO_VIGILANCIA', 'REDUCIR', 'VENDER', 'ESPERAR', 'NO_EVALUABLE', 'BLOQUEADO'],
  aporte_periodico: ['COMPRAR', 'NO_COMPRAR', 'NO_EVALUABLE', 'BLOQUEADO'],
  revision_anual_etf: ['MANTENER', 'REDUCIR', 'VENDER', 'NO_EVALUABLE'],
  retiro_quinquenal: ['REDUCIR', 'NO_EVALUABLE'],
};

export const RUTA_POR_TIPO: Readonly<Record<TipoEvaluacion, Ruta>> = {
  nueva_posicion: 'analitica',
  recompra: 'analitica',
  revision_tesis: 'analitica',
  posicion_abierta: 'posicion_abierta',
  aporte_periodico: 'determinista',
  revision_anual_etf: 'determinista',
  retiro_quinquenal: 'determinista',
};

/** La base obliga requiere_autorizacion = true en estas cuatro (decisiones_operacion_autorizacion_ck). */
export const DECISIONES_OPERATIVAS: ReadonlySet<Decision> =
  new Set<Decision>(['COMPRAR', 'RECOMPRAR', 'REDUCIR', 'VENDER']);

export function requiereAutorizacion(decision: Decision): boolean {
  return DECISIONES_OPERATIVAS.has(decision);
}

/** Rechaza una decisión fuera del vocabulario del tipo. No traduce ni corrige (regla 1 y 2). */
export function validarDecision(tipo: TipoEvaluacion, decision: string): asserts decision is Decision {
  if (!(TIPOS_EVALUACION as readonly string[]).includes(tipo)) {
    throw new ErrorMotor(`Tipo de evaluación desconocido: ${tipo}`);
  }
  if (!(DECISIONES as readonly string[]).includes(decision)) {
    throw new ErrorMotor(`Decisión fuera del vocabulario único: ${decision}`);
  }
  if (!(VOCABULARIO_POR_TIPO[tipo] as readonly string[]).includes(decision)) {
    throw new ErrorMotor(`La decisión ${decision} no está permitida para ${tipo}`);
  }
}
