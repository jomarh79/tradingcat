// Parámetros del Orquestador leídos de `oficina_parametros` (módulo 3). Funciones puras: reciben las filas ya leídas y no tocan la base.
// Columnas de la tabla: clave, valor (jsonb), version, vigente_desde (date), aprobado_at. Convención: una fila ausente significa «sin definir».
// Un parámetro vigente es la fila de mayor versión con vigente_desde <= la fecha de evaluación. Una fila con forma inválida NO se corrige
// ni se sustituye por un valor por omisión: se declara en `problemas`.

import { parseFecha } from './calendario';
import { MARGEN_CIERRE_MINUTOS } from './cierre-velas';

export const CLAVE_MARGEN_CIERRE = 'orquestador.margen_cierre_velas';
export const CLAVE_FRESCURA_PRECIO = 'frescura.precio';
export const CLAVE_VENTANA_ALERTAS = 'orquestador.ventana_alertas';
export const UNIDAD_MINUTOS = 'minutos';
/** Forma real de la fila (verificada el 23-oct): `{ "horas": 24 }`. Distinta de las otras claves, que usan `{ valor, unidad }`. */
export const CAMPO_HORAS = 'horas';
export const UNIDAD_DIAS_HABILES = 'dias_habiles';

export interface FilaParametro {
  clave: string;
  valor: unknown;
  version: number;
  /** YYYY-MM-DD */
  vigente_desde: string;
  aprobado_at?: string | null;
}

export type OrigenParametro = 'oficina_parametros' | 'constante';

export interface ParametrosOrquestador {
  /** null si la fila existe pero es inválida (no se sustituye por la constante: queda en `problemas`). */
  margen_cierre_minutos: number | null;
  margen_origen: OrigenParametro;
  /** null si el parámetro está sin definir (fila ausente) o inválido: entonces no se evalúa la frescura. */
  frescura_precio_dias_habiles: number | null;
  /** null si el parámetro está sin definir o es inválido: entonces NO se agrupan alertas (cada una se notifica). */
  ventana_alertas_horas: number | null;
  /** Para `parametros_versiones` de la entrada del Motor: solo los parámetros leídos de la base. */
  parametros_versiones: { clave: string; version: number }[];
  problemas: string[];
}

/** Fila vigente de una clave en una fecha: mayor versión con vigente_desde <= fecha. Ignora filas con versión o fecha inválidas. */
export function parametroVigente(filas: FilaParametro[], clave: string, fecha: string): FilaParametro | null {
  let mejor: FilaParametro | null = null;
  for (const f of filas) {
    if (f.clave !== clave || !Number.isInteger(f.version) || parseFecha(f.vigente_desde) === null) continue;
    if (f.vigente_desde > fecha) continue;
    if (mejor === null || f.version > mejor.version) mejor = f;
  }
  return mejor;
}

/** `{ horas: número finito >= 0 }`; si no, null. */
export function leerHoras(valor: unknown): number | null {
  if (typeof valor !== 'object' || valor === null) return null;
  const h = (valor as { horas?: unknown }).horas;
  return typeof h === 'number' && isFinite(h) && h >= 0 ? h : null;
}

/** `{ valor: número finito >= 0, unidad }` con la unidad esperada; si no, null. */
export function leerValorConUnidad(valor: unknown, unidad: string): number | null {
  if (typeof valor !== 'object' || valor === null) return null;
  const v = valor as { valor?: unknown; unidad?: unknown };
  if (v.unidad !== unidad) return null;
  return typeof v.valor === 'number' && isFinite(v.valor) && v.valor >= 0 ? v.valor : null;
}

export function resolverParametros(filas: FilaParametro[], fecha_evaluacion: string): ParametrosOrquestador {
  const problemas: string[] = [];
  const versiones: { clave: string; version: number }[] = [];

  let margen: number | null = MARGEN_CIERRE_MINUTOS;
  let margen_origen: OrigenParametro = 'constante';
  const fm = parametroVigente(filas, CLAVE_MARGEN_CIERRE, fecha_evaluacion);
  if (fm !== null) {
    margen_origen = 'oficina_parametros';
    margen = leerValorConUnidad(fm.valor, UNIDAD_MINUTOS);
    if (margen === null) problemas.push(`${CLAVE_MARGEN_CIERRE} v${fm.version}: valor inválido (se espera { "valor": número >= 0, "unidad": "${UNIDAD_MINUTOS}" })`);
    else versiones.push({ clave: CLAVE_MARGEN_CIERRE, version: fm.version });
  }

  let frescura: number | null = null;
  const ff = parametroVigente(filas, CLAVE_FRESCURA_PRECIO, fecha_evaluacion);
  if (ff !== null) {
    frescura = leerValorConUnidad(ff.valor, UNIDAD_DIAS_HABILES);
    if (frescura === null) problemas.push(`${CLAVE_FRESCURA_PRECIO} v${ff.version}: valor inválido (se espera { "valor": número >= 0, "unidad": "${UNIDAD_DIAS_HABILES}" })`);
    else versiones.push({ clave: CLAVE_FRESCURA_PRECIO, version: ff.version });
  }

  let ventana: number | null = null;
  const fv = parametroVigente(filas, CLAVE_VENTANA_ALERTAS, fecha_evaluacion);
  if (fv !== null) {
    ventana = leerHoras(fv.valor);
    if (ventana === null) problemas.push(`${CLAVE_VENTANA_ALERTAS} v${fv.version}: valor inválido (se espera { "${CAMPO_HORAS}": número >= 0 })`);
    else versiones.push({ clave: CLAVE_VENTANA_ALERTAS, version: fv.version });
  }

  return { margen_cierre_minutos: margen, margen_origen, frescura_precio_dias_habiles: frescura, ventana_alertas_horas: ventana, parametros_versiones: versiones, problemas };
}
