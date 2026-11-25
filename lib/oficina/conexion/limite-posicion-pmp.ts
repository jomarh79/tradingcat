// Tope de 10% por activo en PMP (v0.87): lo invertido en cada posición abierta del portafolio (apertura + compras − ventas, nunca menos de 0) más el efectivo
// es el valor del portafolio; la recompra no puede dejar el activo por encima del 10%. Solo lectura. Un dato ilegible NO se rellena: devuelve error y el Motor
// deja la recompra NO_EVALUABLE.
import { aDec, textoDec } from '../auditor/numeros';
import { limiteActivoPMP } from '../motor/recompra-pmp';
import type { LimiteActivoPMP } from '../motor/recompra-pmp';
import { compraDeApertura } from './apertura-trade';
import { COLUMNAS_EJECUCIONES, EJECUCION_COMPRA, EJECUCION_VENTA, TABLA_EJECUCIONES, TABLA_POSICIONES } from './hechos-bd';

type Fila = Record<string, unknown>;
export type LectorFilas = (tabla: string, columnas: string, filtros: [string, string][]) => Promise<{ filas: Fila[] } | { error: string }>;

/** Lo invertido hoy en una posición: apertura + compras − ventas (USD, escala de `aDec`), nunca menos de 0. null si algún dato es ilegible. */
export function invertidoNeto(trade: unknown, ejecuciones: Fila[]): bigint | null {
  const cero = BigInt(0);
  const compras = ejecuciones.filter(x => x['execution_type'] === EJECUCION_COMPRA);
  const apertura = compraDeApertura(trade, compras as { quantity: unknown }[]);
  let neto = apertura !== null ? apertura.total : cero;
  for (const x of ejecuciones) {
    const t = aDec(x['total']);
    if (x['execution_type'] === EJECUCION_COMPRA) { if (t === null || t <= cero) return null; neto += t; }
    else if (x['execution_type'] === EJECUCION_VENTA) { if (t === null || t < cero) return null; neto -= t; }
  }
  return neto < cero ? cero : neto;
}

export async function calcularLimitePosicionPmp(
  leer: LectorFilas, o: { portfolio_id: string; trade_id: string; efectivo: unknown; monto: string },
): Promise<{ ok: true; limite: LimiteActivoPMP } | { ok: false; error: string }> {
  const ef = aDec(typeof o.efectivo === 'number' ? String(o.efectivo) : o.efectivo);
  if (ef === null) return { ok: false, error: 'no se pudo leer el efectivo del portafolio' };
  const pos = await leer(TABLA_POSICIONES, 'trade_id', [['portfolio_id', o.portfolio_id]]);
  if ('error' in pos) return { ok: false, error: pos.error };
  const ids = Array.from(new Set([o.trade_id, ...pos.filas.map(f => f['trade_id']).filter((x): x is string => typeof x === 'string' && x !== '')]));
  let actual = '0';
  const otras: string[] = [];
  for (const id of ids) {
    const tr = await leer('trades', 'id,entry_price,initial_quantity', [['id', id]]);
    if ('error' in tr) return { ok: false, error: tr.error };
    const ej = await leer(TABLA_EJECUCIONES, COLUMNAS_EJECUCIONES, [['trade_id', id]]);
    if ('error' in ej) return { ok: false, error: ej.error };
    const n = tr.filas.length === 1 ? invertidoNeto(tr.filas[0], ej.filas) : null;
    if (n === null) return { ok: false, error: `no se pudo calcular lo invertido en el trade ${id}` };
    if (id === o.trade_id) actual = textoDec(n); else otras.push(textoDec(n));
  }
  return { ok: true, limite: limiteActivoPMP({ posicion_actual: actual, otras_posiciones: otras, efectivo: textoDec(ef), monto: o.monto }) };
}
