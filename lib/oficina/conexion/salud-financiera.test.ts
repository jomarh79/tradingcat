import { describe, expect, it } from 'vitest';
import { evaluarSaludFinanciera } from './salud-financiera';

const income = (ttm: number | null, ...anuales: [number, number][]) => ({
  success: true, ttm: ttm === null ? null : { netIncome: ttm }, annual: anuales.map(([fiscalYear, netIncome]) => ({ fiscalYear, netIncome })),
});
const metric = (ttm?: number, anual?: number) => ({ metric: { ...(ttm !== undefined ? { freeCashFlowTTM: ttm } : {}), ...(anual !== undefined ? { freeCashFlowAnnual: anual } : {}) } });
const reporte = (year: number, fo: number, capex: number) => ({
  data: [{ year, quarter: 0, form: '10-K', startDate: `${year}-01-01`, endDate: `${year}-12-31`, filedDate: `${year + 1}-02-01`, report: {
    cf: [
      { concept: 'us-gaap_NetCashProvidedByUsedInOperatingActivities', value: fo, unit: 'usd', label: 'op' },
      { concept: 'us-gaap_PaymentsToAcquirePropertyPlantAndEquipment', value: capex, unit: 'usd', label: 'capex' },
    ], bs: [], ic: [],
  } }],
});

describe('salud financiera de PCP (v0.71, informativa)', () => {
  it('ganancias y flujo positivos: sólida', () => {
    const r = evaluarSaludFinanciera({ income_statement: income(500, [2024, 300], [2025, 400]), finnhub_metric: metric(250, 200) });
    expect(r.ganancias).toMatchObject({ estado: 'positivo', ttm: 500, anual: 400, fy: 'fy2025' });
    expect(r.flujo_caja.estado).toBe('positivo');
    expect(r.resumen).toBe('solida');
    expect(r.texto).toContain('no compra');
  });
  it('ambos negativos: débil', () => {
    const r = evaluarSaludFinanciera({ income_statement: income(-5, [2025, -10]), finnhub_metric: metric(-3, -4) });
    expect(r.resumen).toBe('debil');
    expect(r.texto).toContain('cuánto invertir');
  });
  it('ganancias positivas y flujo negativo: mixta; TTM y año que no coinciden: mixto', () => {
    expect(evaluarSaludFinanciera({ income_statement: income(50, [2025, 40]), finnhub_metric: metric(-3, -4) }).resumen).toBe('mixta');
    const m = evaluarSaludFinanciera({ income_statement: income(-5, [2025, 40]), finnhub_metric: metric(3, 4) });
    expect(m.ganancias.estado).toBe('mixto');
    expect(m.resumen).toBe('mixta');
  });
  it('sin TTM usa el último año fiscal; sin ningún dato: sin_datos (nunca se rellena)', () => {
    expect(evaluarSaludFinanciera({ income_statement: income(null, [2024, -1], [2025, 9]), finnhub_metric: metric(undefined, 5) }).ganancias).toMatchObject({ estado: 'positivo', ttm: null, anual: 9 });
    const v = evaluarSaludFinanciera({});
    expect(v.resumen).toBe('sin_datos');
    expect(v.ganancias.estado).toBe('sin_datos');
    expect(v.flujo_caja.estado).toBe('sin_datos');
    expect(evaluarSaludFinanciera({ income_statement: 'x', finnhub_metric: 5 }).resumen).toBe('sin_datos');
  });
  it('flujo anual desde el reporte de Finnhub (operativo − capex), con el año más reciente', () => {
    const r = evaluarSaludFinanciera({ income_statement: income(10, [2025, 10]), finnhub_reportado: { data: [...reporte(2024, 100, 20).data, ...reporte(2025, 50, 80).data] } });
    expect(r.flujo_caja.fy).toBe('fy2025');
    expect(r.flujo_caja.anual).toBe(-30);
    expect(r.flujo_caja.estado).toBe('negativo');
  });
});
