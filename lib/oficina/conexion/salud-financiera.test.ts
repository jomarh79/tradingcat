import { describe, expect, it } from 'vitest';
import { esIndustriaFinanciera, evaluarSaludFinanciera } from './salud-financiera';

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
  it('una medida negativa y la otra no: mixta (bloquea en PMP)', () => {
    expect(evaluarSaludFinanciera({ income_statement: income(50, [2025, 40]), finnhub_metric: metric(-3, -4) }).resumen).toBe('mixta');
    expect(evaluarSaludFinanciera({ income_statement: income(-50, [2025, -40]), finnhub_metric: metric(3, 4) }).resumen).toBe('mixta');
  });
  it('v0.72 (22-nov): TTM y último año que no coinciden en una medida es «aceptable» (cumple); ganancias sin datos y flujo positivo es «incompleta»; flujo sin datos con ganancias positivas NO bloquea (v0.82: aceptable con aviso)', () => {
    const m = evaluarSaludFinanciera({ income_statement: income(-5, [2025, 40]), finnhub_metric: metric(3, 4) });
    expect(m.ganancias.estado).toBe('mixto');
    expect(m.resumen).toBe('aceptable');
    expect(m.texto).toContain('no coinciden');
    expect(evaluarSaludFinanciera({ finnhub_metric: metric(9, 9) }).resumen).toBe('incompleta');
    const sinFlujo = evaluarSaludFinanciera({ income_statement: income(5, [2025, 4]) }, { obligatoria: true });
    expect(sinFlujo.resumen).toBe('aceptable');
    expect(sinFlujo.avisos.join(' ')).toContain('flujo de caja libre sin datos');
    expect(sinFlujo.texto).toContain('no bloquea');
    // ganancias negativas con flujo sin datos siguen bloqueando
    expect(evaluarSaludFinanciera({ income_statement: income(-5, [2025, -4]) }, { obligatoria: true }).resumen).toBe('mixta');
    expect(evaluarSaludFinanciera({ income_statement: income(-5, [2025, -4]) }).resumen).toBe('mixta');
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
  it('v0.72: en PMP el texto dice que es obligatoria; en PCP, que es informativa', () => {
    const f = { income_statement: income(-5, [2025, -10]), finnhub_metric: metric(-3, -4) };
    expect(evaluarSaludFinanciera(f, { obligatoria: true }).texto).toContain('PMP exige');
    expect(evaluarSaludFinanciera(f, { obligatoria: true }).texto).toContain('obligatoria en PMP');
    expect(evaluarSaludFinanciera(f).texto).toContain('solo informativa');
  });
});

describe('financieras (v0.79): el flujo de caja libre no cuenta, basta con ganancias', () => {
  it('detecta industrias financieras de Finnhub y no otras', () => {
    for (const i of ['Banking', 'Financial Services', 'Insurance', 'Investment Banking & Brokerage', 'Capital Markets']) expect(esIndustriaFinanciera(i)).toBe(true);
    for (const i of ['Medical Devices', 'Technology', 'Retail', '', null, undefined]) expect(esIndustriaFinanciera(i)).toBe(false);
  });
  it('banco con ganancias y flujo de caja negativo: sólida (como GS)', () => {
    const f = { income_statement: income(22169, [2025, 17176]), finnhub_metric: metric(-47000, -47218) };
    const gral = evaluarSaludFinanciera(f, { obligatoria: true });
    expect(gral.resumen).toBe('mixta');
    const fin = evaluarSaludFinanciera(f, { obligatoria: true, industria: 'Banking' });
    expect(fin).toMatchObject({ resumen: 'solida', financiera: true, industria: 'Banking' });
    expect(fin.flujo_caja.estado).toBe('negativo');
    expect(fin.texto).toContain('el flujo de caja libre no se evalúa');
  });
  it('banco sin ganancias: débil; sin datos de ganancias: sin_datos; mixto: aceptable', () => {
    expect(evaluarSaludFinanciera({ income_statement: income(-5, [2025, -10]), finnhub_metric: metric(9, 9) }, { industria: 'Banking' }).resumen).toBe('debil');
    expect(evaluarSaludFinanciera({ finnhub_metric: metric(9, 9) }, { industria: 'Banking' }).resumen).toBe('sin_datos');
    expect(evaluarSaludFinanciera({ income_statement: income(5, [2025, -10]) }, { industria: 'Insurance' }).resumen).toBe('aceptable');
  });
  it('empresa no financiera mantiene la regla general', () => {
    const r = evaluarSaludFinanciera({ income_statement: income(500, [2025, 400]), finnhub_metric: metric(-3, -4) }, { industria: 'Technology' });
    expect(r).toMatchObject({ financiera: false, resumen: 'mixta' });
  });
});
