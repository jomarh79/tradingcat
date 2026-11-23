import { describe, expect, it } from 'vitest';
import { evaluarDividendoPmp } from './dividendo-pmp';

const DIA = 86400;
const AHORA = '2026-11-20T15:00:00Z';
const hoy = Date.parse(AHORA) / 1000;
/** Cierres diarios de los últimos `anios` años: precio por función del índice (0 = el más viejo). */
const cierres = (anios: number, precio: (i: number, n: number) => number) => {
  const n = Math.round(anios * 365);
  return Array.from({ length: n }, (_, i) => ({ time: Math.floor(hoy / DIA) * DIA - (n - 1 - i) * DIA, close: precio(i, n) }));
};
const divTrim = (anios: number, monto = 1) => Array.from({ length: Math.floor(anios * 4) }, (_, k) => ({ date: new Date((Math.floor(hoy / DIA) * DIA - (k * 91 + 10) * DIA) * 1000).toISOString().slice(0, 10), amount: monto }));

describe('dividendo en PMP (v0.73)', () => {
  it('precio bajo hoy (rendimiento sobre el promedio): lado verde, barata', () => {
    const r = evaluarDividendoPmp({ dividendos: divTrim(6), cierres: cierres(5.5, (i, n) => (i === n - 1 ? 50 : 100)), ahora: AHORA });
    expect(r.estado).toBe('paga_verde');
    expect(r.rendimiento_actual!).toBeGreaterThan(r.rendimiento_promedio!);
    expect(r.texto).toContain('verde');
  });
  it('precio alto hoy (rendimiento bajo el promedio): lado rojo, cara, no se compra', () => {
    const r = evaluarDividendoPmp({ dividendos: divTrim(6), cierres: cierres(5.5, (i, n) => (i === n - 1 ? 200 : 100)), ahora: AHORA });
    expect(r.estado).toBe('paga_rojo');
    expect(r.texto).toContain('cara, no se compra');
  });
  it('rendimiento igual al promedio cuenta como verde (igual que la gráfica: ≥ promedio)', () => {
    const r = evaluarDividendoPmp({ dividendos: divTrim(6), cierres: cierres(5.5, () => 100), ahora: AHORA });
    expect(r.estado).toBe('paga_verde');
    expect(r.rendimiento_actual).toBeCloseTo(r.rendimiento_promedio!, 9);
  });
  it('solo cuentan los últimos 5 años: el precio de hace 8 años no entra al promedio', () => {
    const base = cierres(5.5, () => 100);
    const viejo = Array.from({ length: 800 }, (_, i) => ({ time: base[0]!.time - (800 - i) * DIA, close: 1 }));
    const a = evaluarDividendoPmp({ dividendos: divTrim(10), cierres: base, ahora: AHORA });
    const b = evaluarDividendoPmp({ dividendos: divTrim(10), cierres: [...viejo, ...base], ahora: AHORA });
    expect(b.rendimiento_promedio).toBeCloseTo(a.rendimiento_promedio!, 9);
  });
  it('sin pagos recientes o sin pagos: no paga (se sugiere PCP); un pago de hace más de 400 días ya no cuenta', () => {
    const sin = evaluarDividendoPmp({ dividendos: [], cierres: cierres(5.5, () => 100), ahora: AHORA });
    expect(sin.estado).toBe('no_paga');
    expect(sin.texto).toContain('PCP');
    const viejo = evaluarDividendoPmp({ dividendos: [{ date: '2025-01-10', amount: 1 }], cierres: cierres(5.5, () => 100), ahora: AHORA });
    expect(viejo.estado).toBe('no_paga');
    expect(viejo.ultimo_dividendo).toEqual({ fecha: '2025-01-10', monto: 1 });
    expect(evaluarDividendoPmp({ dividendos: [{ date: '2026-02-01', amount: 0 }], cierres: cierres(5.5, () => 100), ahora: AHORA }).estado).toBe('no_paga');
  });
  it('sin datos: dividendos no consultados, sin cierres o historial corto → sin_datos (nunca se supone)', () => {
    expect(evaluarDividendoPmp({ dividendos: null, cierres: cierres(5.5, () => 100), ahora: AHORA }).estado).toBe('sin_datos');
    expect(evaluarDividendoPmp({ dividendos: divTrim(6), cierres: null, ahora: AHORA }).estado).toBe('sin_datos');
    const corto = evaluarDividendoPmp({ dividendos: divTrim(6), cierres: cierres(1.5, () => 100), ahora: AHORA });
    expect(corto.estado).toBe('sin_datos');
    expect(corto.texto).toContain('insuficiente');
    expect(evaluarDividendoPmp({ dividendos: divTrim(6), cierres: cierres(5.5, () => 100), ahora: 'x' }).estado).toBe('sin_datos');
  });
});
