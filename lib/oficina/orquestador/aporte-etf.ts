// Aporte semanal de ETFs sectoriales (matriz v2, sección 7, ruta 2): lo calcula el Orquestador como código determinista.
// El Auditor revisa y el Motor decide (`decidirAporte`); aquí solo se arma el contexto que el Motor necesita.
//
// Regla (tu decisión del 25-oct): según el efectivo de la semana, USD 2 por ETF sectorial si alcanza para todos; si no, USD 1 por ETF si alcanza
// para todos; si no alcanza ni eso, no se compra ningún ETF (nunca un aporte parcial a algunos ETFs).
// OJO: esto reemplaza ETF-01 v2 (13-oct, todo o nada, sin aporte reducido) y la línea 336 de la matriz. El catálogo de reglas sigue en v2:
// hay que subir ETF-01 a una versión 3 para que el Auditor no lea una regla distinta de lo que aplica el Orquestador.
// El Motor usa el mismo valor para el umbral y para el monto del aporte reducido, así que el Orquestador le entrega ya resuelto el nivel
// (monto y requerido del nivel que alcanza) y el nivel queda en `modo`. El Motor no se modifica.
// Nada se inventa: sin efectivo, sin número de ETFs válido o sin saber si hay duplicado, el contexto no es verificable y el Motor responde NO_EVALUABLE.

import type { ContextoAporte } from '../motor';
import { mayorOIgual } from '../motor/decimal';

/** Aporte por ETF sectorial, en USD (matriz v2, sección 7). Es parámetro: pasa a `oficina_parametros` cuando lo autorices. */
export const MONTO_POR_ETF_SECTORIAL_USD = 2;
/** Aporte por ETF cuando el efectivo no alcanza para el completo (25-oct). */
export const MONTO_REDUCIDO_POR_ETF_USD = 1;

export type ModoAporte = 'completo' | 'reducido' | 'ninguno';

export interface DatosAporteSemanal {
  /** Efectivo disponible en la billetera ETF, decimal en texto. null = no se pudo leer. */
  efectivo_disponible: string | null;
  /** ETFs sectoriales que reciben aporte esta semana (entero >= 1). */
  etfs_sectoriales: number;
  /** ¿Ya está registrada la transferencia de este aporte? null = no se pudo verificar. */
  duplicado: boolean | null;
}

export interface ResultadoAporteSemanal {
  /** null si no se pudo armar nada (número de ETFs inválido). */
  contexto: ContextoAporte | null;
  /** null si no hay contexto o no es verificable. */
  modo: ModoAporte | null;
  problemas: string[];
}

const DECIMAL = /^\d+(\.\d{1,8})?$/;

export function calcularAporteSemanal(d: DatosAporteSemanal | null | undefined): ResultadoAporteSemanal {
  if (d === null || d === undefined) return { contexto: null, modo: null, problemas: ['aporte_semanal: no se entregaron los datos del aporte'] };
  if (!Number.isInteger(d.etfs_sectoriales) || d.etfs_sectoriales < 1) {
    return { contexto: null, modo: null, problemas: [`aporte_semanal: etfs_sectoriales inválido (${String(d.etfs_sectoriales)}); debe ser un entero >= 1`] };
  }
  const problemas: string[] = [];
  let efectivo: string | null = null;
  if (d.efectivo_disponible === null) {
    problemas.push('aporte_semanal: no hay efectivo disponible');
  } else if (typeof d.efectivo_disponible !== 'string' || !DECIMAL.test(d.efectivo_disponible.trim())) {
    problemas.push(`aporte_semanal: efectivo_disponible inválido (${String(d.efectivo_disponible)})`);
  } else {
    efectivo = d.efectivo_disponible.trim();
  }
  if (d.duplicado === null || typeof d.duplicado !== 'boolean') problemas.push('aporte_semanal: no se pudo verificar si el aporte es duplicado');
  const n = d.etfs_sectoriales;
  const completo = MONTO_POR_ETF_SECTORIAL_USD * n;
  const reducido = MONTO_REDUCIDO_POR_ETF_USD * n;
  const verificable = problemas.length === 0 && efectivo !== null;
  let modo: ModoAporte | null = null;
  let monto = MONTO_POR_ETF_SECTORIAL_USD;
  let requerido = completo;
  if (verificable) {
    if (mayorOIgual(efectivo!, String(completo))) modo = 'completo';
    else if (mayorOIgual(efectivo!, String(reducido))) { modo = 'reducido'; monto = MONTO_REDUCIDO_POR_ETF_USD; requerido = reducido; }
    else { modo = 'ninguno'; monto = MONTO_REDUCIDO_POR_ETF_USD; requerido = reducido; }
  }
  return {
    contexto: {
      monto: String(monto),
      monto_requerido: String(requerido),
      monto_reducido: null,
      efectivo_disponible: efectivo,
      duplicado: d.duplicado === true,
      elegibilidad_verificable: problemas.length === 0,
    },
    modo,
    problemas,
  };
}
