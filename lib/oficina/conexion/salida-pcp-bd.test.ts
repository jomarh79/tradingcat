import { describe, expect, it } from 'vitest';
import { construirDatosSalidaPcp, planPcpDeFicha } from './salida-pcp-bd';

const compra = (id: string, price: unknown, quantity: unknown) => ({ id, trade_id: 'T', execution_type: 'buy', price, quantity, executed_at: '2026-11-10T15:00:00Z', total: 1 });
const venta = (id: string) => ({ id, trade_id: 'T', execution_type: 'sell', price: 12, quantity: 0.5, executed_at: '2026-11-12T15:00:00Z', total: 6 });
const trade = (extra: Record<string, unknown> = {}) => ({ id: 'T', entry_price: 100, initial_quantity: 0.25, take_profit_1: 110, take_profit_2: '120', take_profit_3: 0, tp1_hit: false, tp2_hit: false, tp3_hit: false, stop_loss: 92, ...extra });
const fichaPlan = (modalidad: string, estado = 'declarado') => ({ plan_pcp: { estado, modalidad } });

describe('construirDatosSalidaPcp', () => {
  it('la apertura sale de trades y las recompras de trade_executions, con precio y cantidad', () => {
    const r = construirDatosSalidaPcp(trade(), [compra('a', 90, 0.3)], fichaPlan('escalonado'), 'AMD');
    if (!r.ok) throw new Error(r.problemas.join('; '));
    expect(r.datos.compras).toEqual([{ cantidad: '0.25', precio: '100' }, { cantidad: '0.3', precio: '90' }]);
    expect(r.datos.plan).toBe('escalonado');
    expect(r.datos.stop).toBe('92');
    expect(r.datos.niveles).toEqual([{ nivel: '110', cumplido: false }, { nivel: '120', cumplido: false }, { nivel: null, cumplido: false }]);
    expect(r.datos.primera_salida_realizada).toBe(false);
    expect(r.avisos).toEqual([]);
  });
  it('si una ejecución ya trae la cantidad inicial, es la apertura y no se suma dos veces', () => {
    const r = construirDatosSalidaPcp(trade(), [compra('a', 100, 0.25)], fichaPlan('una_compra'), 'AMD');
    if (!r.ok) throw new Error('debía ser ok');
    expect(r.datos.compras).toHaveLength(1);
  });
  it('una venta registrada marca la primera salida como realizada', () => {
    const r = construirDatosSalidaPcp(trade(), [compra('a', 90, 0.3), venta('v')], fichaPlan('escalonado'), 'AMD');
    if (!r.ok) throw new Error('debía ser ok');
    expect(r.datos.primera_salida_realizada).toBe(true);
  });
  it('plan no declarado o propuesta pendiente: se deduce de las compras y se avisa (v0.66)', () => {
    for (const ficha of [{}, null, fichaPlan('escalonado', 'pendiente_de_validacion')]) {
      const una = construirDatosSalidaPcp(trade(), [], ficha, 'AMD');
      if (!una.ok) throw new Error('debía ser ok');
      expect(una.datos.plan).toBe('una_compra');
      expect(una.avisos.join('|')).toContain('se deduce de tus trades');
      const varias = construirDatosSalidaPcp(trade(), [compra('a', 90, 0.3)], ficha, 'AMD');
      if (!varias.ok) throw new Error('debía ser ok');
      expect(varias.datos.plan).toBe('escalonado');
    }
  });
  it('el plan declarado manda sobre la deducción', () => {
    const r = construirDatosSalidaPcp(trade(), [compra('a', 90, 0.3)], fichaPlan('una_compra'), 'AMD');
    if (!r.ok) throw new Error('debía ser ok');
    expect(r.datos.plan).toBe('una_compra');
    expect(r.avisos).toEqual([]);
  });
  it('modalidad inválida, nivel inválido o compra sin precio: problemas, sin rellenar', () => {
    expect(construirDatosSalidaPcp(trade(), [], fichaPlan('raro'), 'AMD')).toMatchObject({ ok: false });
    expect(construirDatosSalidaPcp(trade({ take_profit_1: 'abc' }), [], fichaPlan('escalonado'), 'AMD')).toMatchObject({ ok: false });
    expect(construirDatosSalidaPcp(trade({ stop_loss: 'x' }), [], fichaPlan('escalonado'), 'AMD')).toMatchObject({ ok: false });
    const r = construirDatosSalidaPcp(trade(), [compra('a', null, 1)], fichaPlan('escalonado'), 'AMD');
    expect(r).toMatchObject({ ok: false });
  });
  it('sin compras válidas ni apertura: problema', () => {
    expect(construirDatosSalidaPcp({ id: 'T' }, [], fichaPlan('escalonado'), 'AMD')).toMatchObject({ ok: false });
    expect(construirDatosSalidaPcp(null, [], null, 'AMD')).toMatchObject({ ok: false });
  });
  it('stop 0 o vacío = sin stop; casillas tp solo con true exacto', () => {
    const r = construirDatosSalidaPcp(trade({ stop_loss: 0, tp1_hit: true, tp2_hit: 'true' }), [], fichaPlan('escalonado'), 'AMD');
    if (!r.ok) throw new Error('debía ser ok');
    expect(r.datos.stop).toBeNull();
    expect((r.datos.niveles ?? []).map(n => n.cumplido)).toEqual([true, false, false]);
  });
});

describe('planPcpDeFicha', () => {
  it('solo cuenta el plan declarado', () => {
    expect(planPcpDeFicha(fichaPlan('una_compra'))).toEqual({ plan: 'una_compra' });
    expect(planPcpDeFicha(fichaPlan('una_compra', 'pendiente_de_validacion'))).toEqual({ plan: null });
    expect(planPcpDeFicha('x')).toEqual({ plan: null });
  });
});
