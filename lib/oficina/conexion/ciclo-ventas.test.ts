import { describe, expect, it } from 'vitest';
import { ventasDelCiclo } from './ciclo-ventas';
import { construirDatosSalidaPcp } from './salida-pcp-bd';

const c = (f: string) => ({ execution_type: 'buy', executed_at: f });
const v = (f: string) => ({ execution_type: 'sell', executed_at: f });

describe('v0.91: ciclo actual de la posición PCP', () => {
  it('BE: la última compra (24-nov) es posterior a las dos ventas parciales → ciclo nuevo, 0 ventas', () => {
    expect(ventasDelCiclo([c('2026-11-16T10:00:00'), v('2026-11-19T10:00:00'), c('2026-11-20T10:00:00'), v('2026-11-23T10:00:00'), c('2026-11-24T10:00:00')])).toBe(0);
  });
  it('una venta parcial sin recompra después cuenta (1)', () => {
    expect(ventasDelCiclo([c('2026-11-16T10:00:00'), v('2026-11-19T10:00:00')])).toBe(1);
  });
  it('solo apertura (sin compras en ejecuciones) y una venta: cuenta', () => {
    expect(ventasDelCiclo([v('2026-11-19T10:00:00')])).toBe(1);
    expect(ventasDelCiclo([])).toBe(0);
  });
  it('los datos de salida usan el ciclo: tras recomprar, primera_salida_realizada vuelve a false', () => {
    const tr = { id: 't', entry_price: 10, initial_quantity: 2, take_profit_1: 12, take_profit_2: null, take_profit_3: null, stop_loss: null };
    const ej = (x: object[]) => x.map((e, i) => ({ id: `e${i}`, trade_id: 't', price: 10, quantity: 1, total: 10, ...e })) as never;
    const antes = construirDatosSalidaPcp(tr, ej([c('2026-11-16T10:00:00'), v('2026-11-19T10:00:00')]), null, 'X');
    expect(antes.ok && antes.datos.primera_salida_realizada).toBe(true);
    const despues = construirDatosSalidaPcp(tr, ej([c('2026-11-16T10:00:00'), v('2026-11-19T10:00:00'), c('2026-11-20T10:00:00')]), null, 'X');
    expect(despues.ok && despues.datos.primera_salida_realizada).toBe(false);
  });
});
