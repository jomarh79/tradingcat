// Aprobación de la tesis que propone el Director (v0.58). Funciones puras. La propuesta vive en la salida del Director (`oficina_analisis.salida.tesis`) y NADA cambia
// hasta que el usuario la aprueba. Al aprobar se escribe la tesis vigente del expediente (`tesis_vigente` = texto, `tesis_version` + 1) y se agrega una entrada al
// historial `ficha.tesis_historial` (con la corrida de origen y la tesis anterior), para no perder las versiones previas.
import { CLAVE_ANOTACIONES_CODIGO, ESTADO_TESIS_PROPUESTA, TESIS_CAMBIO, TESIS_PRIMERA_PROPUESTA } from '../agentes-ia/constantes';

export const CLAVE_HISTORIAL_TESIS = 'tesis_historial';
export const HISTORIAL_TESIS_MAXIMO = 30;
export const MAX_LARGO_TESIS = 4000;

export type ClasificacionAprobable = typeof TESIS_PRIMERA_PROPUESTA | typeof TESIS_CAMBIO;

export interface EntradaTesis {
  version: number;
  texto: string;
  aprobada_en: string;
  corrida_id: string;
  clasificacion: ClasificacionAprobable;
  /** Texto de la tesis anterior (null si era la primera). */
  anterior: string | null;
}

const esObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** `tesis_vigente` del expediente: texto, o un objeto con `texto`. Cualquier otra forma = no se puede leer como texto (null). */
export function textoDeTesisVigente(v: unknown): string | null {
  if (typeof v === 'string') return texto(v);
  if (esObj(v)) return texto(v['texto']);
  return null;
}

/** Propuesta del Director en su salida; null si no propone nada. La clasificación la puso el código al guardar (no el modelo). */
export function propuestaDeDirector(salida: unknown): { texto: string; clasificacion: ClasificacionAprobable | null } | null {
  if (!esObj(salida) || !esObj(salida['tesis'])) return null;
  const t = salida['tesis'];
  const propuesta = texto(t['propuesta']);
  if (t['estado'] !== ESTADO_TESIS_PROPUESTA || propuesta === null) return null;
  const anot = salida[CLAVE_ANOTACIONES_CODIGO];
  const c = esObj(anot) ? anot['clasificacion_tesis'] : undefined;
  return { texto: propuesta, clasificacion: c === TESIS_PRIMERA_PROPUESTA || c === TESIS_CAMBIO ? c : null };
}

export function leerHistorialTesis(ficha: unknown): EntradaTesis[] {
  if (!esObj(ficha) || !Array.isArray(ficha[CLAVE_HISTORIAL_TESIS])) return [];
  return (ficha[CLAVE_HISTORIAL_TESIS] as unknown[]).filter((x): x is EntradaTesis =>
    esObj(x) && typeof x['version'] === 'number' && typeof x['texto'] === 'string' && typeof x['corrida_id'] === 'string');
}

/** Agrega la entrada sin tocar el resto de la ficha; conserva las últimas HISTORIAL_TESIS_MAXIMO. */
export function agregarTesis(ficha: unknown, e: EntradaTesis): Record<string, unknown> {
  const base = esObj(ficha) ? { ...ficha } : {};
  base[CLAVE_HISTORIAL_TESIS] = [...leerHistorialTesis(ficha), e].slice(-HISTORIAL_TESIS_MAXIMO);
  return base;
}
