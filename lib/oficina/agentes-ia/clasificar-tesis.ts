// Clasificación de la tesis que propone el Director: primera propuesta o cambio de una tesis vigente. Código puro.
// Convención aprobada (3-nov): el contrato `integracion.v1` no cambia; `tesis.estado = propuesta_cambio` sin tesis vigente significa PRIMERA PROPUESTA.
// Quien distingue es el código, mirando la columna `tesis_vigente` del expediente; el modelo no lo decide.
import { ESTADO_TESIS_PROPUESTA, TESIS_CAMBIO, TESIS_PRIMERA_PROPUESTA, TESIS_SIN_PROPUESTA } from './constantes';
import { esObjeto, textoNoVacio } from './utilidades';

export type ClasificacionTesis = typeof TESIS_PRIMERA_PROPUESTA | typeof TESIS_CAMBIO | typeof TESIS_SIN_PROPUESTA;

/** ¿La columna `tesis_vigente` del expediente trae una tesis? null, texto vacío, objeto vacío y lista vacía = no. Cualquier otro valor cuenta como tesis (criterio conservador). */
export function hayTesisVigente(valor: unknown): boolean {
  if (valor === null || valor === undefined) return false;
  if (typeof valor === 'string') return valor.trim() !== '';
  if (Array.isArray(valor)) return valor.length > 0;
  if (esObjeto(valor)) return Object.keys(valor).length > 0;
  return true;
}

export function clasificarTesisPropuesta(salidaDirector: unknown, hayVigente: boolean): ClasificacionTesis {
  const tesis = esObjeto(salidaDirector) ? salidaDirector['tesis'] : undefined;
  if (!esObjeto(tesis) || tesis['estado'] !== ESTADO_TESIS_PROPUESTA || !textoNoVacio(tesis['propuesta'])) return TESIS_SIN_PROPUESTA;
  return hayVigente ? TESIS_CAMBIO : TESIS_PRIMERA_PROPUESTA;
}
