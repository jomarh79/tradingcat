import { describe, expect, it } from 'vitest';
import type { Candle } from '../tecnico';
import { construirDatosSalidaPmp } from './salida-pmp-bd';

const compra = (id: string, total: unknown) => ({ id, trade_id: 'T', execution_type: 'buy', price: 10, quantity: 1, executed_at: '2026-09-01T15:00:00Z', total });
const venta = (id: string, fecha: string) => ({ id, trade_id: 'T', execution_type: 'sell', price: 12, quantity: 0.5, executed_at: `${fecha}T15:00:00Z`, total: 6 });
const trade = (extra: Record<string, unknown> = {}) => ({ id: 'T', take_profit_1: 12, take_profit_2: '15.5', take_profit_3: null, tp1_hit: false, tp2_hit: false, tp3_hit: false, ...extra });

describe('construirDatosSalidaPmp', () => {
  it('suma las compras y toma los niveles del trade', () => {
    const r = construirDatosSalidaPmp(trade(), [compra('a', 40), compra('b', '10.5')], null, 'GKOS', 'TwelveData');
    expect(r).toMatchObject({ ok: true, datos: { monto_invertido: '50.5', ultima_venta: null, senales_previas: null } });
    if (r.ok) expect(r.datos.niveles).toEqual([{ nivel: '12', cumplido: false }, { nivel: '15.5', cumplido: false }, { nivel: null, cumplido: false }]);
  });
  it('nivel 0, vacío o ausente = sin nivel; la casilla solo cuenta si es exactamente true', () => {
    const r = construirDatosSalidaPmp(trade({ take_profit_1: 0, take_profit_2: '', tp1_hit: true, tp2_hit: 'true' }), [compra('a', 50)], null, 'GKOS', 'x');
    if (!r.ok) throw new Error('debía ser ok');
    expect(r.datos.niveles.map(n => n.nivel)).toEqual([null, null, null]);
    expect(r.datos.niveles.map(n => n.cumplido)).toEqual([true, false, false]);
  });
  it('las ventas no se suman al monto invertido y se toma la fecha de la última', () => {
    const r = construirDatosSalidaPmp(trade(), [compra('a', 50), venta('v1', '2026-09-20'), venta('v2', '2026-10-05')], null, 'GKOS', 'x');
    expect(r).toMatchObject({ ok: true, datos: { monto_invertido: '50', ultima_venta: '2026-10-05' } });
  });
  it('sin velas, tras una salida las señales previas quedan en null (no se inventan)', () => {
    const r = construirDatosSalidaPmp(trade({ tp1_hit: true }), [compra('a', 50), venta('v', '2026-10-05')], null, 'GKOS', 'x');
    expect(r).toMatchObject({ ok: true, datos: { senales_previas: null, ultima_venta: '2026-10-05' } });
  });
  it('con una salida marcada pero sin venta registrada: señales previas null', () => {
    const r = construirDatosSalidaPmp(trade({ tp1_hit: true }), [compra('a', 50)], { diarias: [] as Candle[], semanales: [] as Candle[] }, 'GKOS', 'x');
    expect(r).toMatchObject({ ok: true, datos: { senales_previas: null, ultima_venta: null } });
  });
  it('rechaza trade ausente, compras inválidas, nivel no numérico y venta sin fecha', () => {
    expect(construirDatosSalidaPmp(null, [compra('a', 50)], null, 'GKOS', 'x')).toMatchObject({ ok: false });
    expect(construirDatosSalidaPmp(trade(), [], null, 'GKOS', 'x')).toMatchObject({ ok: false });
    expect(construirDatosSalidaPmp(trade(), [compra('a', 'abc')], null, 'GKOS', 'x')).toMatchObject({ ok: false });
    expect(construirDatosSalidaPmp(trade({ take_profit_2: 'doce' }), [compra('a', 50)], null, 'GKOS', 'x')).toMatchObject({ ok: false });
    expect(construirDatosSalidaPmp(trade(), [compra('a', 50), { ...venta('v', '2026-10-05'), executed_at: null }], null, 'GKOS', 'x')).toMatchObject({ ok: false });
  });
});
