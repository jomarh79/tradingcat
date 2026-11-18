import { describe, expect, it } from 'vitest';
import { velasDiariasCerradas } from './velas-cerradas';
import { proponerFichaPmp } from './ficha-propuesta';

const dia = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 1000;
const velas = [
  { time: dia('2026-11-13'), close: 930 },
  { time: dia('2026-11-16'), close: 934.8 },
  { time: dia('2026-11-17'), close: 920.84 },
];

describe('v0.64 velasDiariasCerradas (misma regla que el Técnico)', () => {
  it('después del cierre del mercado cuenta la vela de hoy (PH: 920.84 y no 934.80)', () => {
    const r = velasDiariasCerradas(velas, '2026-11-18T03:29:00Z'); // 9:29 p.m. en Ciudad de México
    expect(r.map(v => v.close)).toEqual([930, 934.8, 920.84]);
  });
  it('con el mercado abierto descarta la vela de hoy', () => {
    const r = velasDiariasCerradas(velas, '2026-11-17T18:00:00Z');
    expect(r.map(v => v.close)).toEqual([930, 934.8]);
  });
  it('si la última vela es de un día anterior ya cerrado, no descarta nada', () => {
    const r = velasDiariasCerradas(velas.slice(0, 2), '2026-11-17T14:00:00Z');
    expect(r.map(v => v.close)).toEqual([930, 934.8]);
  });
  it('ignora velas con cierre inválido y devuelve vacío sin velas', () => {
    expect(velasDiariasCerradas([{ time: dia('2026-11-16'), close: 0 }], '2026-11-18T03:29:00Z')).toEqual([]);
    expect(velasDiariasCerradas([], '2026-11-18T03:29:00Z')).toEqual([]);
  });
  it('con un instante inválido usa la regla anterior (descarta la última vela)', () => {
    const r = velasDiariasCerradas(velas, 'no es una fecha');
    expect(r.map(v => v.close)).toEqual([930, 934.8]);
  });
});

describe('v0.64 ficha con `ahora`', () => {
  const base = { ticker: 'PH', hoy: '2026-11-17', watchlist: null };
  const FIN = dia('2026-11-17');
  const N = 900;
  const T = Array.from({ length: N }, (_, i) => {
    const close = i === N - 1 ? 920.84 : i === N - 2 ? 934.8 : 100 + i * 0.5;
    return { time: FIN - (N - 1 - i) * 86400, open: close, high: close, low: close, close, volume: 1 };
  });
  it('el rendimiento se calcula al cierre de hoy cuando el mercado ya cerró', () => {
    const r = proponerFichaPmp({ ...base, velas: T, ahora: '2026-11-18T03:29:00Z' });
    expect(r.propuesta['rendimiento']?.texto ?? '').toContain('2026-11-17 (920.84)');
  });
  it('sin `ahora` conserva la regla anterior (cierre del día previo)', () => {
    const r = proponerFichaPmp({ ...base, velas: T });
    expect(r.propuesta['rendimiento']?.texto ?? '').toContain('2026-11-16 (934.8');
  });
});
