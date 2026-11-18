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

/** v0.60: ¿el Fundamental marcó algún punto de la tesis vigente como `se_debilita` o `se_rompe`? true/false si comparó; null si no se puede saber (sin salida, sin lista o lista vacía). */
export function fundamentalMarcaCambio(salidaFundamental: unknown): boolean | null {
  if (!esObjeto(salidaFundamental)) return null;
  const cam = salidaFundamental['cambios_vs_tesis_vigente'];
  if (!Array.isArray(cam) || cam.length === 0) return null;
  const estados = cam.map(c => (esObjeto(c) ? c['estado'] : undefined));
  if (estados.some(e => e === 'se_debilita' || e === 'se_rompe')) return true;
  return estados.every(e => e === 'se_mantiene') ? false : null;
}

/** `cambioMarcado` (v0.60): con tesis vigente, si el Fundamental la comparó y todo "se_mantiene" (false), la propuesta del Director es solo una reescritura y no se ofrece. null = no se sabe: se ofrece (no se oculta nada por duda). */
export function clasificarTesisPropuesta(salidaDirector: unknown, hayVigente: boolean, cambioMarcado: boolean | null = null): ClasificacionTesis {
  const tesis = esObjeto(salidaDirector) ? salidaDirector['tesis'] : undefined;
  if (!esObjeto(tesis) || tesis['estado'] !== ESTADO_TESIS_PROPUESTA || !textoNoVacio(tesis['propuesta'])) return TESIS_SIN_PROPUESTA;
  if (hayVigente && cambioMarcado === false) return TESIS_SIN_PROPUESTA;
  return hayVigente ? TESIS_CAMBIO : TESIS_PRIMERA_PROPUESTA;
}
