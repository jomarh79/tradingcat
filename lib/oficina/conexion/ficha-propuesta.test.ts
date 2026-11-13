import { describe, expect, it } from 'vitest';
import { fechaDeVela, proponerFichaPmp } from './ficha-propuesta';
import type { Candle } from '../tecnico';

const DIA = 86400;
const T0 = Date.UTC(2024, 0, 1) / 1000;
/** n velas diarias desde 2024-01-01, con cierre creciendo 0.1% por día (volatilidad cero) salvo que se dé f. */
const serie = (n: number, f: (i: number) => number = i => 100 * 1.001 ** i): Candle[] =>
  Array.from({ length: n }, (_, i) => ({ time: T0 + i * DIA, open: f(i), high: f(i), low: f(i), close: f(i), volume: 1 }));
const WL = { rol: 'mixto', negocio: 'Comercio electrónico y pagos', competidores: null, portafolios: ['PMP'] };

describe('fechaDeVela', () => {
  it('acepta segundos y milisegundos', () => {
    expect(fechaDeVela(T0)).toBe('2024-01-01');
    expect(fechaDeVela(T0 * 1000)).toBe('2024-01-01');
  });
});

describe('proponerFichaPmp', () => {
  const hoy = '2026-11-12';
  it('propone identidad, índices, rendimiento y volatilidad con velas suficientes', () => {
    const r = proponerFichaPmp({ ticker: 'SE', hoy, velas: serie(900), watchlist: WL });
    expect(Object.keys(r.propuesta).sort()).toEqual(['decision_final', 'identidad', 'indices_referencia', 'plan_ejecucion', 'rendimiento', 'volatilidad_riesgo']);
    expect(r.propuesta['identidad']?.texto).toBe('SE · mercado US · portafolio PMP · rol mixto · negocio: Comercio electrónico y pagos');
    expect(r.propuesta['indices_referencia']?.texto).toContain('SPY, QQQ, DIA, QUAL');
    expect(r.propuesta['rendimiento']?.texto).toMatch(/1 mes \+2\.1%.*1 año \+28\.6%.*3 años \+112\.9%/);
    expect(r.propuesta['volatilidad_riesgo']?.texto).toMatch(/Volatilidad anualizada 0\.0%.*caída máxima desde un máximo \+0\.0%/);
  });
  it('dividendos y correlación no se proponen y quedan declarados; plan y decisión salen de las reglas aprobadas', () => {
    const r = proponerFichaPmp({ ticker: 'SE', hoy, velas: serie(900), watchlist: null });
    for (const a of ['dividendos_fundamentales', 'correlacion']) {
      expect(r.propuesta[a]).toBeUndefined();
      expect(r.no_propuestos.join('|')).toContain(`${a}:`);
    }
    expect(r.propuesta['identidad']?.texto).toBe('SE · mercado US · portafolio PMP · rol sin definir');
    expect(r.propuesta['plan_ejecucion']?.texto).toMatch(/50 USD.*2 de las 5 señales.*14% anualizado/);
    expect(r.propuesta['decision_final']?.texto).toMatch(/yo autorizo.*revisar la venta del 100%/);
    expect(r.no_propuestos.join('|')).not.toMatch(/plan_ejecucion|decision_final/);
  });
  it('descarta la vela del día en curso', () => {
    const v = serie(300);
    const hoyDe = fechaDeVela(v[299]!.time);
    const r = proponerFichaPmp({ ticker: 'SE', hoy: hoyDe, velas: v, watchlist: null });
    expect(r.propuesta['rendimiento']?.texto).toContain(`Al cierre del ${fechaDeVela(v[298]!.time)}`);
  });
  it('pocas velas: solo los rendimientos que alcanzan; sin volatilidad si hay menos de 60 retornos', () => {
    const r = proponerFichaPmp({ ticker: 'SE', hoy, velas: serie(40), watchlist: null });
    expect(r.propuesta['rendimiento']?.texto).toContain('1 mes');
    expect(r.propuesta['rendimiento']?.texto).not.toContain('3 meses');
    expect(r.propuesta['volatilidad_riesgo']).toBeUndefined();
    expect(r.no_propuestos.join('|')).toMatch(/volatilidad_riesgo: se necesitan al menos 60/);
  });
  it('sin velas: no inventa rendimiento ni volatilidad', () => {
    for (const velas of [null, [] as Candle[]]) {
      const r = proponerFichaPmp({ ticker: 'SE', hoy, velas, watchlist: null });
      expect(r.propuesta['rendimiento']).toBeUndefined();
      expect(r.propuesta['volatilidad_riesgo']).toBeUndefined();
      expect(r.no_propuestos.join('|')).toMatch(/rendimiento: sin velas/);
    }
  });
  it('mide la caída máxima con una serie que sube y cae', () => {
    const f = (i: number) => (i < 100 ? 100 + i : 199 - (i - 100) * 0.5 + (i % 2));
    const r = proponerFichaPmp({ ticker: 'SE', hoy, velas: serie(300, f), watchlist: null });
    expect(r.propuesta['volatilidad_riesgo']?.texto).toMatch(/caída máxima desde un máximo −\d+\.\d%/);
  });
  it('recorta un negocio muy largo', () => {
    const r = proponerFichaPmp({ ticker: 'SE', hoy, velas: null, watchlist: { ...WL, negocio: 'x'.repeat(300) } });
    expect(r.propuesta['identidad']?.texto.length).toBeLessThan(260);
    expect(r.propuesta['identidad']?.texto).toContain('…');
  });
});
