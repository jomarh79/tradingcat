import { dec, mayorOIgual } from './decimal';
import type { SalidaExigida } from './tipos';

/** Plan de salidas de PMP (reglas aprobadas el 10-nov). Código determinista; el Motor solo recibe el resultado.
 *
 *  - Cuántas salidas: 2 si lo invertido es 50 USD o menos (25% y el resto), 3 si es más (25%, 25% y el resto). Las compras en fracciones de acción casi nunca
 *    cierran justo en 50: se tolera hasta `TOLERANCIA_MONTO` USD de más (50.40 sigue siendo «50»). Las recompras suman al monto invertido.
 *  - Los niveles planeados de cada salida son TP1, TP2 y TP3 del trade (soportes/resistencias que se fijan al entrar); la casilla «cumplido» dice cuáles ya se hicieron.
 *  - Un nivel planeado basta solo: precio actual ≥ nivel de la siguiente salida.
 *  - Los demás criterios (banda superior de Mogalef, RSI sobrecomprado, resistencia pasada) piden DOS confirmaciones. Tras una salida, esas dos tienen que ser
 *    NUEVAS: señales que hoy se cumplen y que NO se cumplían en la vela de la salida anterior [PROPUESTA de lectura de «dos confirmaciones nuevas»].
 *  - El 25% de REDUCIR es sobre la posición que se tenga EN ESE MOMENTO (con las recompras que haya habido); la última salida es VENDER todo lo que queda.
 *  - Cuando una salida se cumple, el usuario marca su casilla «cumplido» (TP1/TP2/TP3) en Trades abiertos y la siguiente pasa a evaluarse; la Oficina no escribe en `trades`.
 *  - Nunca decide el 14% anualizado (eso es una revisión semestral aparte) ni vende por stop. */

export const MONTO_LIMITE_DOS_SALIDAS = '50';
/** USD de más que se toleran sobre el límite por compras en fracciones [PROPUESTA: 1 USD]. */
export const TOLERANCIA_MONTO = '1';
export const PORCENTAJE_SALIDA_PARCIAL = 25;
export const REGLA_SALIDA_PMP = 'PMP-SALIDA';
export const SENALES_SALIDA_PMP = ['RSI_SOBRECOMPRA', 'MOGALEF_BANDA_SUPERIOR', 'RESISTENCIA_PASADA'] as const;
export const CONFIRMACIONES_MINIMAS = 2;

export interface NivelSalidaPMP { nivel: string | null; cumplido: boolean }

export interface EntradaSalidaPMP {
  /** Suma de las compras de la posición (USD), cadena decimal. */
  monto_invertido: string;
  precio_actual: string;
  /** TP1, TP2 y TP3 del trade, en ese orden. */
  niveles: [NivelSalidaPMP, NivelSalidaPMP, NivelSalidaPMP];
  /** Señales de salida cumplidas HOY (las tres calculadas por el Técnico; las no evaluables no se incluyen). */
  senales_hoy: readonly string[];
  /** Señales cumplidas en la vela de la salida anterior. null = no se pudo reconstruir (con una salida previa, las confirmaciones no se evalúan). */
  senales_previas: readonly string[] | null;
}

export interface ResultadoSalidaPMP {
  exigida: SalidaExigida | null;
  /** Precio con el que se evaluó (cierre de la última vela cerrada) y cuántas confirmaciones se piden: para mostrarlos. */
  precio_actual: string;
  confirmaciones_minimas: number;
  total_salidas: 2 | 3;
  hechas: number;
  /** Número (1..total) de la siguiente salida; null si ya se hicieron todas. */
  siguiente: number | null;
  nivel_siguiente: string | null;
  motivo: 'nivel_planeado' | 'confirmaciones' | null;
  confirmaciones_nuevas: string[];
  /** Lo que no se pudo evaluar (nunca se supone false). */
  faltantes: string[];
}

export function totalSalidasPMP(monto_invertido: string): 2 | 3 {
  return dec(monto_invertido) <= dec(MONTO_LIMITE_DOS_SALIDAS) + dec(TOLERANCIA_MONTO) ? 2 : 3;
}

export function evaluarSalidaPMP(e: EntradaSalidaPMP): ResultadoSalidaPMP {
  const total = totalSalidasPMP(e.monto_invertido);
  const planeados = e.niveles.slice(0, total);
  const hechas = planeados.filter(n => n.cumplido).length;
  const idx = planeados.findIndex(n => !n.cumplido);   // índice 0-based de la siguiente salida
  const faltantes: string[] = [];
  const base = { total_salidas: total, hechas, precio_actual: e.precio_actual, confirmaciones_minimas: CONFIRMACIONES_MINIMAS, confirmaciones_nuevas: [] as string[], faltantes };

  if (idx === -1) {
    return { ...base, exigida: null, siguiente: null, nivel_siguiente: null, motivo: null };
  }
  const numero = idx + 1;
  const nivel = planeados[idx]?.nivel ?? null;
  const ultima = numero === total;

  let motivo: ResultadoSalidaPMP['motivo'] = null;
  let detalleMotivo = '';
  if (nivel !== null) {
    if (mayorOIgual(e.precio_actual, nivel)) {
      motivo = 'nivel_planeado';
      detalleMotivo = `el precio ${e.precio_actual} llegó al nivel planeado de la salida ${numero} (TP${numero} = ${nivel})`;
    }
  } else {
    faltantes.push(`take_profit_${numero}: sin nivel planeado para la salida ${numero}; solo cuentan las confirmaciones`);
  }

  let nuevas: string[] = [];
  const habiaSalida = hechas > 0;
  if (habiaSalida && e.senales_previas === null) {
    faltantes.push('senales_previas_salida_pmp: hay una salida marcada como cumplida pero no se pudo reconstruir la vela de la venta anterior (¿el trade no tiene la venta registrada?); no se evalúan las confirmaciones nuevas, solo el nivel planeado');
  } else {
    const previas = habiaSalida ? new Set(e.senales_previas ?? []) : new Set<string>();
    nuevas = SENALES_SALIDA_PMP.filter(s => e.senales_hoy.includes(s) && !previas.has(s));
    if (motivo === null && nuevas.length >= CONFIRMACIONES_MINIMAS) {
      motivo = 'confirmaciones';
      detalleMotivo = `${nuevas.length} confirmaciones ${habiaSalida ? 'nuevas ' : ''}de salida (${nuevas.join(', ')})`;
    }
  }

  if (motivo === null) {
    return { ...base, confirmaciones_nuevas: nuevas, exigida: null, siguiente: numero, nivel_siguiente: nivel, motivo: null };
  }
  const exigida: SalidaExigida = ultima
    ? { decision: 'VENDER', porcentaje: 100, regla: REGLA_SALIDA_PMP, detalle: `Salida ${numero} de ${total} (última): ${detalleMotivo}; se vende todo lo que queda` }
    : { decision: 'REDUCIR', porcentaje: PORCENTAJE_SALIDA_PARCIAL, regla: REGLA_SALIDA_PMP, detalle: `Salida ${numero} de ${total}: ${detalleMotivo}; se reduce el ${PORCENTAJE_SALIDA_PARCIAL}% de la posición que tengas en ese momento` };
  return { ...base, confirmaciones_nuevas: nuevas, exigida, siguiente: numero, nivel_siguiente: nivel, motivo };
}
