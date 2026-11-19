import { describe, expect, it } from 'vitest';
import { clasificarCompetidor, formatearCompetidores, parseCompetidores, tieneCompetidor, validarCasillas } from './competidores';

describe('parseCompetidores', () => {
  it('separa por coma, punto y coma, diagonal y espacios; mayúsculas; sin repetidos', () => {
    expect(parseCompetidores('alc, blco;sght / alc')).toEqual(['ALC', 'BLCO', 'SGHT']);
  });
  it('máximo 4', () => { expect(parseCompetidores('A,B,C,D,E,F')).toEqual(['A', 'B', 'C', 'D']); });
  it('vacío, null y undefined dan lista vacía', () => {
    expect(parseCompetidores('')).toEqual([]);
    expect(parseCompetidores(null)).toEqual([]);
    expect(parseCompetidores(undefined)).toEqual([]);
    expect(parseCompetidores(' , ; ')).toEqual([]);
  });
});

describe('formatearCompetidores y tieneCompetidor', () => {
  it('ida y vuelta', () => {
    const t = formatearCompetidores(['ALC', 'BLCO']);
    expect(t).toBe('ALC, BLCO');
    expect(parseCompetidores(t)).toEqual(['ALC', 'BLCO']);
  });
  it('exige al menos uno', () => {
    expect(tieneCompetidor('ALC')).toBe(true);
    expect(tieneCompetidor('')).toBe(false);
    expect(tieneCompetidor('  ')).toBe(false);
    expect(tieneCompetidor(null)).toBe(false);
  });
});

describe('validarCasillas', () => {
  it('ignora las casillas vacías y pasa a mayúsculas', () => {
    expect(validarCasillas(['alc', '', ' blco ', ''], 'GKOS')).toEqual({ ok: true, tickers: ['ALC', 'BLCO'] });
  });
  it('acepta tickers con punto o guion', () => {
    expect(validarCasillas(['BRK.B', 'BF-B', '', ''], 'GKOS')).toEqual({ ok: true, tickers: ['BRK.B', 'BF-B'] });
  });
  it('rechaza tickers inválidos, repetidos y el propio', () => {
    expect(validarCasillas(['AL C', '', '', ''], 'GKOS')).toMatchObject({ ok: false });
    expect(validarCasillas(['1ABC', '', '', ''], 'GKOS')).toMatchObject({ ok: false });
    expect(validarCasillas(['ALC', 'alc', '', ''], 'GKOS')).toMatchObject({ ok: false, error: 'ALC está repetido' });
    expect(validarCasillas(['gkos', '', '', ''], 'GKOS')).toMatchObject({ ok: false });
  });
  it('todas vacías es válido (la exigencia de uno es de la corrida, no del guardado)', () => {
    expect(validarCasillas(['', '', '', ''], 'GKOS')).toEqual({ ok: true, tickers: [] });
  });
  it('más de 4 casillas con valor se rechaza', () => {
    expect(validarCasillas(['A', 'B', 'C', 'D', 'E'], 'GKOS')).toMatchObject({ ok: false });
  });
});

describe('clasificarCompetidor', () => {
  const wl = new Set(['ALC', 'BLCO']);
  const ab = new Set(['BLCO', 'META']);
  it('abierto manda sobre watchlist; watchlist; ninguno', () => {
    expect(clasificarCompetidor('blco', wl, ab)).toBe('abierto');
    expect(clasificarCompetidor('alc', wl, ab)).toBe('watchlist');
    expect(clasificarCompetidor('META', wl, ab)).toBe('abierto');
    expect(clasificarCompetidor('SGHT', wl, ab)).toBe('ninguno');
  });
});
