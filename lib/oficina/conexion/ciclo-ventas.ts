// Ciclo actual de una posición PCP (v0.91, decisión de Jaime 25-nov): tras la primera salida parcial lo que queda se trata como una sola compra, y si luego se
// recompra el ciclo empieza de cero. Por eso las ventas que cuentan son solo las hechas DESPUÉS de la última compra (por fecha y hora de executed_at).
// Sin compras en `trade_executions` (solo la apertura, que vive en `trades`) toda venta es posterior a la última compra.
const COMPRA = 'buy';
const VENTA = 'sell';

export function ventasDelCiclo(ejecuciones: ReadonlyArray<{ execution_type: string; executed_at: string | null }>): number {
  let ultimaCompra = '';
  for (const e of ejecuciones) if (e.execution_type === COMPRA && typeof e.executed_at === 'string' && e.executed_at > ultimaCompra) ultimaCompra = e.executed_at;
  return ejecuciones.filter(e => e.execution_type === VENTA && !(typeof e.executed_at === 'string' && ultimaCompra !== '' && e.executed_at < ultimaCompra)).length;
}
