import { describe, expect, it } from 'vitest';
import { compararPer } from './valuacion-modelos';


describe('comparación del P/E actual con el promedio de 5 años (v0.72, PMP)', () => {
  // un reporte anual por año; cierre = 100 y EPS distinto para dar P/E 10, 12, 14, 16, 18 (promedio 14)
  const hist = [2020, 2021, 2022, 2023, 2024].map((y, i) => ({ year: y, endDate: `${y}-12-31`, eps: 100 / (10 + 2 * i) }));
  const cierres = hist.map(h => ({ date: h.endDate, close: 100 }));
  const base = { historial: hist, cierres, eps_ttm: 5, precio: 60 };
  it('P/E actual por debajo del promedio: por_debajo; por encima o igual: por_encima', () => {
    const a = compararPer({ ...base, pe_actual: 12 });
    expect(a).toMatchObject({ relacion: 'por_debajo', per_actual: 12, puntos: 5, origen_per_actual: 'fundamentals' });
    expect(a.per_promedio).toBeCloseTo(14, 6);
    expect(compararPer({ ...base, pe_actual: 20 }).relacion).toBe('por_encima');
    expect(compararPer({ ...base, pe_actual: 14 }).relacion).toBe('por_encima');
  });
  it('sin P/E de la fuente usa cierre ÷ EPS TTM (60 ÷ 5 = 12)', () => {
    const r = compararPer({ ...base, pe_actual: null });
    expect(r).toMatchObject({ per_actual: 12, origen_per_actual: 'cierre / EPS TTM', relacion: 'por_debajo' });
  });
  it('solo cuentan los últimos 5 años y se necesitan al menos 3 con EPS positivo; sin comparación no se inventa', () => {
    const viejo = [{ year: 2010, endDate: '2010-12-31', eps: 100 / 40 }, ...hist];
    expect(compararPer({ ...base, historial: viejo, cierres: [...cierres, { date: '2010-12-31', close: 100 }], pe_actual: 12 }).per_promedio).toBeCloseTo(14, 6);
    const pocos = compararPer({ ...base, historial: hist.slice(0, 2), pe_actual: 12 });
    expect(pocos).toMatchObject({ relacion: null, per_promedio: null, puntos: 2 });
    expect(pocos.motivo).toContain('al menos 3');
    const sinEps = compararPer({ ...base, historial: hist.map(h => ({ ...h, eps: -1 })), pe_actual: 12 });
    expect(sinEps.relacion).toBeNull();
    expect(compararPer({ ...base, pe_actual: null, eps_ttm: -2 })).toMatchObject({ relacion: null, per_actual: null });
  });
});
