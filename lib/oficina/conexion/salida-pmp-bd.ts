// Datos para el plan de salidas de PMP, leídos de la base (solo lectura):
//   trades(id, take_profit_1..3, tp1_hit..tp3_hit)  -> niveles planeados y casillas «cumplido» (las que llenas en Nuevo Trade / Trades abiertos)
//   trades(entry_price, initial_quantity) -> compra inicial (la apertura NO tiene fila en trade_executions)
//   trade_executions(execution_type, executed_at, total) -> recompras (suman al monto invertido) y fecha de la última venta.
// No inventa nada: un dato inválido devuelve `problemas` y la corrida no se prepara. El cálculo de la salida NO está aquí (ver motor/salida-pmp.ts).

import { aDec, REGEX_FECHA, textoDec } from '../auditor/numeros';
import type { NivelSalidaPMP } from '../motor/salida-pmp';
import { senalesDeSalidaAntesDe } from '../orquestador/senales-previas';
import type { Candle } from '../tecnico';
import { compraDeApertura } from './apertura-trade';
import { EJECUCION_COMPRA, EJECUCION_VENTA } from './hechos-bd';
import type { FilaEjecucion } from './hechos-bd';

export const TABLA_TRADES = 'trades';
export const COLUMNAS_TRADE_SALIDA = 'id,entry_price,initial_quantity,take_profit_1,take_profit_2,take_profit_3,tp1_hit,tp2_hit,tp3_hit';

export interface DatosSalidaPmp {
  monto_invertido: string;
  niveles: [NivelSalidaPMP, NivelSalidaPMP, NivelSalidaPMP];
  /** Fecha (AAAA-MM-DD) de la última venta registrada; null si no hay ventas. */
  ultima_venta: string | null;
  /** Señales de salida cumplidas antes de esa venta; null si no hay venta previa o no se pudieron reconstruir. */
  senales_previas: string[] | null;
}
export type ResultadoDatosSalidaPmp = { ok: true; datos: DatosSalidaPmp } | { ok: false; problemas: string[] };

const esObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function nivelDe(valor: unknown, cumplido: unknown, nombre: string, problemas: string[]): NivelSalidaPMP {
  if (valor === null || valor === undefined || valor === '') return { nivel: null, cumplido: cumplido === true };
  const d = aDec(typeof valor === 'number' ? String(valor) : valor);
  if (d === null) { problemas.push(`trades.${nombre} no es un número válido`); return { nivel: null, cumplido: cumplido === true }; }
  // 0 o negativo = «sin nivel» (así lo deja la página de trades cuando no se llena)
  return { nivel: d > BigInt(0) ? textoDec(d) : null, cumplido: cumplido === true };
}

export function construirDatosSalidaPmp(
  trade: unknown, ejecuciones: FilaEjecucion[], velas: { diarias: Candle[]; semanales: Candle[] } | null, ticker: string, fuente_velas: string,
): ResultadoDatosSalidaPmp {
  const problemas: string[] = [];
  if (!esObj(trade)) return { ok: false, problemas: [`${ticker}: no se encontró el trade de la posición`] };

  const niveles: DatosSalidaPmp['niveles'] = [
    nivelDe(trade['take_profit_1'], trade['tp1_hit'], 'take_profit_1', problemas),
    nivelDe(trade['take_profit_2'], trade['tp2_hit'], 'take_profit_2', problemas),
    nivelDe(trade['take_profit_3'], trade['tp3_hit'], 'take_profit_3', problemas),
  ];

  const apertura = compraDeApertura(trade, ejecuciones.filter(x => x.execution_type === EJECUCION_COMPRA));
  let invertido = apertura !== null ? apertura.total : BigInt(0);
  let ultima: string | null = null;
  for (const x of ejecuciones) {
    if (x.execution_type === EJECUCION_COMPRA) {
      const t = aDec(x.total);
      if (t === null || t <= BigInt(0)) { problemas.push(`${ticker}: compra ${x.id} sin total válido`); continue; }
      invertido += t;
    } else if (x.execution_type === EJECUCION_VENTA) {
      const f = typeof x.executed_at === 'string' ? x.executed_at.slice(0, 10) : '';
      if (!REGEX_FECHA.test(f)) { problemas.push(`${ticker}: venta ${x.id} sin fecha (executed_at)`); continue; }
      if (ultima === null || f > ultima) ultima = f;
    }
  }
  if (invertido <= BigInt(0)) problemas.push(`${ticker}: no hay compras con total válido para calcular el monto invertido`);
  if (problemas.length > 0) return { ok: false, problemas };

  const hechas = niveles.filter(n => n.cumplido).length;
  const senales_previas = hechas > 0 && ultima !== null && velas !== null ? senalesDeSalidaAntesDe(velas, ultima, ticker, fuente_velas) : null;
  return { ok: true, datos: { monto_invertido: textoDec(invertido), niveles, ultima_venta: ultima, senales_previas } };
}
