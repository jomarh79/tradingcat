// Recompra de PMP (v0.87, decisión de Jaime 25-nov): 10 USD cada vez que el cierre toca el stop O hay una señal de recompra (RSI sobrevendido, Koncorde bajo cero,
// banda inferior de Mogalef, nivel pasado). Tope: un activo no puede pasar del 10% del portafolio (activos comprados + efectivo). Código determinista, sin IA.
import { dec, menorQue } from './decimal';

export const MONTO_RECOMPRA_PMP = '10';
/** v0.88: PLP recompra 5 USD (PLP-03) con el mismo disparo (stop O señal) y sin tope de monto ni de número de recompras. */
export const MONTO_RECOMPRA_PLP = '5';
export const TOPE_ACTIVO_PMP_PCT = 10;
const FACTOR = BigInt('100000000');

/** Texto decimal (hasta 2 decimales, truncado) de un valor en la escala interna de `dec`. Solo para mostrar. */
function texto(n: bigint): string {
  const neg = n < BigInt(0);
  const a = neg ? -n : n;
  const centavos = (a % FACTOR) / BigInt(1000000);
  return `${neg ? '-' : ''}${a / FACTOR}.${centavos.toString().padStart(2, '0')}`;
}

export interface LimiteActivoPMP {
  /** Valor invertido hoy en el activo, valor del portafolio (activos + efectivo), tope (10%) y lo que quedaría invertido tras la recompra. USD, 2 decimales. */
  posicion_actual: string;
  portafolio_total: string;
  tope: string;
  posicion_despues: string;
  excede: boolean;
}

/** `posicion_actual` y `otras_posiciones` son lo invertido (neto de ventas) en cada activo abierto del portafolio; `efectivo` el efectivo disponible. */
export function limiteActivoPMP(e: { posicion_actual: string; otras_posiciones: readonly string[]; efectivo: string; monto: string }): LimiteActivoPMP {
  const actual = dec(e.posicion_actual);
  let total = actual + dec(e.efectivo);
  for (const o of e.otras_posiciones) total += dec(o);
  const tope = (total * BigInt(TOPE_ACTIVO_PMP_PCT)) / BigInt(100);
  const despues = actual + dec(e.monto);
  return { posicion_actual: texto(actual), portafolio_total: texto(total), tope: texto(tope), posicion_despues: texto(despues), excede: despues > tope };
}

export interface EntradaRecompraPMP {
  /** Cierre de la última vela cerrada y stop de `trades` (null = sin stop). */
  precio_actual: string;
  stop: string | null;
  /** Detonante recompra_pmp del Técnico (al menos una señal cumplida) y sus señales; null = el Técnico no pudo evaluarlas. */
  senal_confirmada: boolean | null;
  senales_cumplidas: readonly string[];
  /** Monto de la recompra (por omisión el de PMP). */
  monto?: string;
}
export interface ResultadoRecompraPMP {
  monto: string;
  por_stop: boolean;
  por_senal: boolean;
  /** Stop O señal. */
  disparada: boolean;
  precio_actual: string;
  stop: string | null;
  senales_cumplidas: string[];
  /** Lo que no se pudo evaluar (nunca se supone false). */
  faltantes: string[];
}

export function evaluarRecompraPMP(e: EntradaRecompraPMP): ResultadoRecompraPMP {
  const faltantes: string[] = [];
  const por_stop = e.stop !== null && e.stop !== '' && !menorQue(e.stop, e.precio_actual);   // cierre en o bajo el stop
  if (e.senal_confirmada === null) faltantes.push('recompra_pmp: el Técnico no pudo evaluar las señales de recompra; solo cuenta el stop');
  const por_senal = e.senal_confirmada === true;
  return { monto: e.monto ?? MONTO_RECOMPRA_PMP, por_stop, por_senal, disparada: por_stop || por_senal, precio_actual: e.precio_actual, stop: e.stop ?? null, senales_cumplidas: [...e.senales_cumplidas], faltantes };
}
