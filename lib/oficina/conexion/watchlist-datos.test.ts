import { describe, expect, it } from 'vitest';
import { apartadosDeclarados, interpretarWatchlist } from './watchlist-datos';
import { resolverHechosPosicion } from './index';
import type { FilasPosicion } from './index';

const fila = (x: Record<string, unknown> = {}) => ({ id: 'w1', ticker: 'META', rol: 'mixto', portafolios: ['PMP'], competidores: 'GOOGL, SNAP', notes: 'Redes sociales y publicidad', ...x });

describe('interpretarWatchlist', () => {
  it('lee rol, negocio (Notas), competidores y portafolios sin avisos si el portafolio está marcado', () => {
    const r = interpretarWatchlist([fila()], 'META', 'PMP');
    expect(r.datos).toEqual({ rol: 'mixto', negocio: 'Redes sociales y publicidad', competidores: 'GOOGL, SNAP', portafolios: ['PMP'] });
    expect(r.avisos).toEqual([]);
  });
  it('portafolio no marcado: solo avisa, los datos siguen', () => {
    const r = interpretarWatchlist([fila({ portafolios: ['PCP'] })], 'META', 'PMP');
    expect(r.datos?.rol).toBe('mixto');
    expect(r.avisos.join('|')).toMatch(/no tiene marcado PMP \(marcados: PCP\)/);
  });
  it('sin portafolios marcados: avisa', () => {
    expect(interpretarWatchlist([fila({ portafolios: [] })], 'META', 'PMP').avisos.join('|')).toMatch(/no tiene portafolios marcados/);
  });
  it('ticker ausente o repetido: sin datos y con aviso', () => {
    expect(interpretarWatchlist([], 'META', 'PMP')).toMatchObject({ datos: null });
    expect(interpretarWatchlist([], 'META', 'PMP').avisos.join('|')).toMatch(/no está en la watchlist/);
    const r = interpretarWatchlist([fila(), fila({ id: 'w2' })], 'META', 'PMP');
    expect(r.datos).toBeNull();
    expect(r.avisos.join('|')).toMatch(/2 veces/);
  });
  it('rol inválido o vacío: no se usa (y el inválido se avisa); textos vacíos son null', () => {
    const a = interpretarWatchlist([fila({ rol: 'core' })], 'META', 'PMP');
    expect(a.datos?.rol).toBeNull();
    expect(a.avisos.join('|')).toMatch(/«core».*no es válido/);
    const b = interpretarWatchlist([fila({ rol: '', notes: '   ', competidores: null })], 'META', 'PMP');
    expect(b.datos).toMatchObject({ rol: null, negocio: null, competidores: null });
    expect(b.avisos).toEqual([]);
  });
  it('portafolios con basura: se filtran', () => {
    expect(interpretarWatchlist([fila({ portafolios: ['PMP', 'XYZ', 3] })], 'META', 'PMP').datos?.portafolios).toEqual(['PMP']);
    expect(interpretarWatchlist([fila({ portafolios: 'PMP' })], 'META', 'PMP').datos?.portafolios).toEqual([]);
  });
  it('apartadosDeclarados solo suma lo que tiene valor', () => {
    expect(apartadosDeclarados({ rol: 'flujo', negocio: null, competidores: 'X', portafolios: [] })).toEqual({ rol: true, competidores: true });
    expect(apartadosDeclarados({ rol: null, negocio: null, competidores: null, portafolios: [] })).toEqual({});
  });
});

const PF = '11111111-1111-4111-8111-111111111111';
const TR = '22222222-2222-4222-8222-222222222222';
const EX = '33333333-3333-4333-8333-333333333333';
const F = (ficha: unknown, rol: string | null): FilasPosicion => ({
  posiciones: [{ trade_id: TR, portfolio_id: PF, ticker: 'META', fecha_apertura: '2026-10-06' }],
  ejecuciones: [{ id: 'e1', trade_id: TR, execution_type: 'buy', price: 10, quantity: 5, executed_at: '2026-10-06T14:30:00', total: 50 }],
  capital: [{ portfolio_id: PF, posiciones_abiertas: 4 }],
  expedientes: [{ id: EX, ticker: 'META', portfolio_id: PF, rol_posicion: rol, ficha }],
});
const Q = { portfolio_id: PF, ticker: 'META', posicion_existe: true };

describe('resolverHechosPosicion con watchlist', () => {
  it('el rol de la watchlist manda sobre el del expediente', () => {
    const r = resolverHechosPosicion(F({}, 'flujo'), { ...Q, watchlist: { rol: 'mixto', negocio: null, competidores: null, portafolios: [] } });
    expect(r.ok && r.hechos.posicion?.rol).toBe('mixto');
  });
  it('sin rol en la watchlist, se queda el del expediente', () => {
    const r = resolverHechosPosicion(F({}, 'flujo'), { ...Q, watchlist: { rol: null, negocio: 'x', competidores: null, portafolios: [] } });
    expect(r.ok && r.hechos.posicion?.rol).toBe('flujo');
  });
  it('rol, negocio y competidores de la watchlist completan la ficha; no pisan lo que ya estaba aprobado', () => {
    const r = resolverHechosPosicion(F({}, null), { ...Q, watchlist: { rol: 'mixto', negocio: 'neg', competidores: 'c', portafolios: [] } });
    expect(r.ok && r.hechos.datos?.ficha_pmp).toMatchObject({ rol: true, negocio: true, competidores: true });
    const s = resolverHechosPosicion(F({}, null), { ...Q, watchlist: { rol: null, negocio: null, competidores: 'c', portafolios: [] } });
    expect(s.ok && s.hechos.datos?.ficha_pmp).toMatchObject({ competidores: true });
    expect(s.ok && s.hechos.datos?.ficha_pmp?.['negocio']).not.toBe(true);
  });
  it('sin watchlist no cambia nada', () => {
    const a = resolverHechosPosicion(F({}, 'flujo'), Q);
    const b = resolverHechosPosicion(F({}, 'flujo'), { ...Q, watchlist: null });
    expect(a).toEqual(b);
  });
});
