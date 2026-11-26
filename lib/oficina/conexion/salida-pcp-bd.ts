// Datos para la salida de PCP (v0.65), leídos de la base (solo lectura):
//   trades(id, entry_price, initial_quantity) -> compra inicial (la apertura NO tiene fila en trade_executions)
//   trade_executions(execution_type, price, quantity, executed_at, total) -> recompras (compras con su precio y cantidad) y ventas parciales
//   trades(take_profit_1..3, tp1_hit..tp3_hit, stop_loss) -> niveles planeados con su casilla «cumplido» y el stop de referencia
//   oficina_expedientes.ficha.plan_pcp -> plan declarado (solo con estado 'declarado'; una propuesta pendiente no es un plan)
// No inventa nada: un dato inválido devuelve `problemas` y la corrida no se prepara. El cálculo de la salida NO está aquí (ver motor/salida-pcp.ts).

import { aDec, textoDec } from '../auditor/numeros';
import type { CompraPCP, EntradaSalidaPCP, NivelSalidaPCP } from '../motor';
import { ventasDelCiclo } from './ciclo-ventas';
import { compraDeApertura } from './apertura-trade';
import { deducirPlanPcp } from './plan-pcp';
import { EJECUCION_COMPRA, EJECUCION_VENTA, ESTADO_PLAN_DECLARADO, FICHA_CLAVE_PLAN, MODALIDADES_PLAN } from './hechos-bd';
import type { FilaEjecucion } from './hechos-bd';

export const COLUMNAS_TRADE_SALIDA_PCP = 'id,entry_price,initial_quantity,take_profit_1,take_profit_2,take_profit_3,tp1_hit,tp2_hit,tp3_hit,stop_loss';

export type DatosSalidaPcp = Omit<EntradaSalidaPCP, 'senal_salida' | 'precio_actual'>;
export type ResultadoDatosSalidaPcp = { ok: true; datos: DatosSalidaPcp; avisos: string[] } | { ok: false; problemas: string[] };

const esObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function nivelDe(valor: unknown, cumplido: unknown, nombre: string, problemas: string[]): NivelSalidaPCP {
  if (valor === null || valor === undefined || valor === '') return { nivel: null, cumplido: cumplido === true };
  const d = aDec(typeof valor === 'number' ? String(valor) : valor);
  if (d === null) { problemas.push(`trades.${nombre} no es un número válido`); return { nivel: null, cumplido: cumplido === true }; }
  // 0 o negativo = «sin nivel» (así lo deja la página de trades cuando no se llena)
  return { nivel: d > BigInt(0) ? textoDec(d) : null, cumplido: cumplido === true };
}

/** Plan declarado en la ficha del expediente; null si no hay o no está declarado. */
export function planPcpDeFicha(ficha: unknown): { plan: 'una_compra' | 'escalonado' | null; problema?: string } {
  if (!esObj(ficha)) return { plan: null };
  const p = ficha[FICHA_CLAVE_PLAN];
  if (!esObj(p) || p['estado'] !== ESTADO_PLAN_DECLARADO) return { plan: null };
  const m = MODALIDADES_PLAN.find(x => x === p['modalidad']);
  return m !== undefined ? { plan: m } : { plan: null, problema: `ficha.plan_pcp declarado con modalidad inválida (${String(p['modalidad'])})` };
}

export function construirDatosSalidaPcp(trade: unknown, ejecuciones: FilaEjecucion[], ficha: unknown, ticker: string): ResultadoDatosSalidaPcp {
  const problemas: string[] = [];
  const avisos: string[] = [];
  if (!esObj(trade)) return { ok: false, problemas: [`${ticker}: no se encontró el trade de la posición`] };

  const niveles: [NivelSalidaPCP, NivelSalidaPCP, NivelSalidaPCP] = [
    nivelDe(trade['take_profit_1'], trade['tp1_hit'], 'take_profit_1', problemas),
    nivelDe(trade['take_profit_2'], trade['tp2_hit'], 'take_profit_2', problemas),
    nivelDe(trade['take_profit_3'], trade['tp3_hit'], 'take_profit_3', problemas),
  ];
  const st = trade['stop_loss'];
  let stop: string | null = null;
  if (st !== null && st !== undefined && st !== '') {
    const d = aDec(typeof st === 'number' ? String(st) : st);
    if (d === null) problemas.push('trades.stop_loss no es un número válido');
    else stop = d > BigInt(0) ? textoDec(d) : null;
  }

  const comprasEj = ejecuciones.filter(x => x.execution_type === EJECUCION_COMPRA);
  const compras: CompraPCP[] = [];
  const apertura = compraDeApertura(trade, comprasEj);
  if (apertura !== null) compras.push({ cantidad: textoDec(apertura.cantidad), precio: textoDec(apertura.precio) });
  for (const x of comprasEj) {
    const q = aDec(x.quantity);
    const p = aDec(x.price);
    if (q === null || p === null || q <= BigInt(0) || p <= BigInt(0)) { problemas.push(`${ticker}: compra ${x.id} sin precio o cantidad válidos`); continue; }
    compras.push({ cantidad: textoDec(q), precio: textoDec(p) });
  }
  if (compras.length === 0) problemas.push(`${ticker}: no hay compras con precio y cantidad válidos para calcular el costo promedio`);
  // v0.91: solo cuentan las ventas posteriores a la última compra (ciclo actual); una recompra después de una venta parcial reinicia el ciclo
  const ventas = ventasDelCiclo(ejecuciones);

  const pl = planPcpDeFicha(ficha);
  if (pl.problema) problemas.push(`${ticker}: ${pl.problema}`);
  // v0.66: sin plan declarado, se deduce de las compras reales (una compra = una_compra; con recompras = escalonado). Lo declarado manda.
  let plan = pl.plan;
  if (plan === null && !pl.problema) {
    plan = deducirPlanPcp(compras.length, 'posicion_abierta');
    if (plan !== null) avisos.push(`El plan de PCP no está declarado en la ficha: se deduce de tus trades (${compras.length} compra(s) = ${plan === 'una_compra' ? 'una compra' : 'escalonado'})`);
  }
  if (problemas.length > 0) return { ok: false, problemas };
  return { ok: true, datos: { plan, compras, stop, niveles, primera_salida_realizada: ventas > 0 }, avisos };
}
