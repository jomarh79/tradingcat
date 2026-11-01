import { describe, expect, it } from 'vitest';
import { armarSobreFundamental, fechaDe, itemsDesdeIncomeStatement, validarSobreFundamental } from './index';
import { RUN_ID, SNAP_ID } from './fixtures.test-util';

const GEN = '2026-10-30T18:00:00.000Z';
const entrada = (fy: number, ingresos: number | null, extra: Record<string, unknown> = {}) => ({
  fiscalYear: fy, fiscalPeriod: 0, endDate: `${fy}-12-31`, currency: 'USD', revenue: ingresos, costOfRevenue: null, grossProfit: ingresos === null ? null : ingresos * 0.8,
  opex: null, sgaExp: null, rndExp: null, opIncome: ingresos === null ? null : ingresos * 0.2, otherNetIncome: null, ebt: null, incomeTax: null,
  netIncome: ingresos === null ? null : ingresos * 0.1, dilutedAvgShares: 1000, dilutedEps: ingresos === null ? null : ingresos * 0.1 / 1000, interestNet: null, ...extra,
});
const resp = (over: Record<string, unknown> = {}) => ({
  success: true, symbol: 'GKOS',
  annual: [entrada(2022, 1000), entrada(2023, 1200), entrada(2024, 1500)],
  ttm: entrada(2025, 1800, { endDate: '2025-09-30T00:00:00', fiscalYear: 2025 }),
  forwardEps: { fiscalYear: 2026, eps: 2.5, quartersCovered: 3 },
  ...over,
});
const porId = (items: { id: string }[], id: string) => items.find(i => i.id === id);

describe('fechaDe', () => {
  it('acepta AAAA-MM-DD con o sin hora y rechaza lo que no es fecha real', () => {
    expect(fechaDe('2025-12-31')).toBe('2025-12-31');
    expect(fechaDe('2025-12-31T00:00:00')).toBe('2025-12-31');
    for (const x of ['2025-13-01', '2025-02-30', '31/12/2025', '', null, 20251231, undefined, 'x2025-12-31']) expect(fechaDe(x)).toBeNull();
  });
});

describe('itemsDesdeIncomeStatement', () => {
  it('convierte los campos brutos de cada año y del TTM con fuente, fecha y unidad', () => {
    const r = itemsDesdeIncomeStatement(resp(), { generado_en: GEN });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(porId(r.items, 'ingresos_fy2024')).toEqual({ id: 'ingresos_fy2024', campo: 'ingresos_fy2024', valor: 1500, unidad: 'USD', fuente: 'Webull Fundamentals API (estado de resultados)', fecha_dato: '2024-12-31' });
    expect(porId(r.items, 'eps_diluido_fy2024')).toMatchObject({ unidad: 'USD por acción', valor: 0.15 });
    expect(porId(r.items, 'acciones_diluidas_fy2024')).toMatchObject({ unidad: 'acciones', valor: 1000 });
    expect(porId(r.items, 'ingresos_ttm')).toMatchObject({ valor: 1800, fecha_dato: '2025-09-30' });
    expect(porId(r.items, 'utilidad_bruta_fy2022')).toMatchObject({ valor: 800 });
    expect(porId(r.items, 'utilidad_operativa_fy2022')).toMatchObject({ valor: 200 });
    expect(porId(r.items, 'utilidad_neta_fy2022')).toMatchObject({ valor: 100 });
  });
  it('calcula márgenes y crecimiento en código, con fuente de cálculo, redondeados a 4 decimales', () => {
    const r = itemsDesdeIncomeStatement(resp({ annual: [entrada(2023, 3), entrada(2024, 4)] }), { generado_en: GEN });
    if (!r.ok) throw new Error('x');
    expect(porId(r.items, 'margen_bruto_fy2024')).toMatchObject({ valor: 0.8, unidad: 'ratio', fuente: 'Calculado por código a partir del estado de resultados de Webull', fecha_dato: '2024-12-31' });
    expect(porId(r.items, 'margen_operativo_fy2024')).toMatchObject({ valor: 0.2 });
    expect(porId(r.items, 'margen_neto_fy2024')).toMatchObject({ valor: 0.1 });
    expect(porId(r.items, 'crecimiento_ingresos_fy2024')).toMatchObject({ valor: 0.3333, fecha_dato: '2024-12-31' });
    expect(porId(r.items, 'crecimiento_utilidad_neta_fy2024')).toMatchObject({ valor: 0.3333 });
    expect(porId(r.items, 'crecimiento_eps_diluido_fy2024')).toMatchObject({ valor: 0.3333 });
    expect(porId(r.items, 'crecimiento_ingresos_fy2023')).toBeUndefined();
    expect(porId(r.items, 'crecimiento_ingresos_ttm')).toBeUndefined();
    expect(porId(r.items, 'margen_bruto_ttm')).toMatchObject({ valor: 0.8, fecha_dato: '2025-09-30' });
  });
  it('el crecimiento usa el valor absoluto del año anterior y no se calcula con anterior 0 o nulo', () => {
    const r = itemsDesdeIncomeStatement(resp({ annual: [entrada(2023, 1, { netIncome: -100 }), entrada(2024, 1, { netIncome: -50 }), entrada(2025, 1, { netIncome: 0 }), entrada(2026, 1, { netIncome: 10 })], ttm: null }), { generado_en: GEN });
    if (!r.ok) throw new Error('x');
    expect(porId(r.items, 'crecimiento_utilidad_neta_fy2024')).toMatchObject({ valor: 0.5 });
    expect(porId(r.items, 'crecimiento_utilidad_neta_fy2025')).toMatchObject({ valor: 1 });
    expect(porId(r.items, 'crecimiento_utilidad_neta_fy2026')).toBeUndefined();
  });
  it('un valor nulo se omite y se avisa; no se rellena con cero', () => {
    const r = itemsDesdeIncomeStatement(resp({ annual: [entrada(2024, null)], ttm: null }), { generado_en: GEN });
    if (!r.ok) throw new Error('x');
    expect(porId(r.items, 'ingresos_fy2024')).toBeUndefined();
    expect(porId(r.items, 'acciones_diluidas_fy2024')).toBeDefined();
    expect(r.avisos).toContain('fy2024: ingresos sin dato (se omite, no se rellena)');
    expect(r.avisos).toContain('ttm: sin datos en la respuesta');
    expect(porId(r.items, 'margen_bruto_fy2024')).toBeUndefined();
  });
  it('sin ingresos o con ingresos 0 no hay márgenes', () => {
    const r = itemsDesdeIncomeStatement(resp({ annual: [entrada(2024, 0)], ttm: null }), { generado_en: GEN });
    if (!r.ok) throw new Error('x');
    expect(porId(r.items, 'ingresos_fy2024')).toMatchObject({ valor: 0 });
    expect(porId(r.items, 'margen_bruto_fy2024')).toBeUndefined();
    expect(porId(r.items, 'margen_neto_fy2024')).toBeUndefined();
  });
  it('fecha ilegible: se omite todo el periodo y se avisa (no se inventa la fecha)', () => {
    const r = itemsDesdeIncomeStatement(resp({ annual: [entrada(2023, 1000), entrada(2024, 1500, { endDate: 'sin fecha' })] }), { generado_en: GEN });
    if (!r.ok) throw new Error('x');
    expect(porId(r.items, 'ingresos_fy2024')).toBeUndefined();
    expect(porId(r.items, 'ingresos_fy2023')).toBeDefined();
    expect(r.avisos).toContain('fy2024: endDate ilegible, se omite el periodo (no se inventa la fecha)');
    expect(r.avisos).toHaveLength(1);
  });
  it('solo toma los últimos 5 años por omisión y respeta la opción anios', () => {
    const anual = [2018, 2019, 2020, 2021, 2022, 2023, 2024].map(y => entrada(y, 1000 + y));
    const r = itemsDesdeIncomeStatement(resp({ annual: anual, ttm: null }), { generado_en: GEN });
    if (!r.ok) throw new Error('x');
    expect(porId(r.items, 'ingresos_fy2019')).toBeUndefined();
    expect(porId(r.items, 'ingresos_fy2020')).toBeDefined();
    const r2 = itemsDesdeIncomeStatement(resp({ annual: anual, ttm: null }), { generado_en: GEN, anios: 2 });
    if (!r2.ok) throw new Error('x');
    expect(porId(r2.items, 'ingresos_fy2022')).toBeUndefined();
    expect(porId(r2.items, 'ingresos_fy2023')).toBeDefined();
  });
  it('EPS estimado: usa la fecha de consulta y lo dice en el nombre; se omite si falta o es inválido', () => {
    const r = itemsDesdeIncomeStatement(resp(), { generado_en: GEN });
    if (!r.ok) throw new Error('x');
    expect(porId(r.items, 'eps_estimado_fy2026_a_fecha_de_consulta')).toMatchObject({ valor: 2.5, fecha_dato: '2026-10-30', unidad: 'USD por acción', fuente: 'Webull Fundamentals API (estado de resultados)' });
    for (const fe of [null, undefined, { fiscalYear: 2026 }, { eps: 'x', fiscalYear: 2026 }, { eps: 1 }]) {
      const s = itemsDesdeIncomeStatement(resp({ forwardEps: fe }), { generado_en: GEN });
      if (!s.ok) throw new Error('x');
      expect(s.items.some(i => i.campo.startsWith('eps_estimado'))).toBe(false);
    }
    const mala = itemsDesdeIncomeStatement(resp(), { generado_en: 'ayer' });
    if (!mala.ok) throw new Error('x');
    expect(mala.avisos).toContain('forwardEps: generado_en ilegible, se omite el EPS estimado');
  });
  it('moneda: usa la de la entrada y USD si falta', () => {
    const r = itemsDesdeIncomeStatement(resp({ annual: [entrada(2024, 100, { currency: 'MXN' }), entrada(2025, 100, { currency: undefined })], ttm: null }), { generado_en: GEN });
    if (!r.ok) throw new Error('x');
    expect(porId(r.items, 'ingresos_fy2024')).toMatchObject({ unidad: 'MXN' });
    expect(porId(r.items, 'eps_diluido_fy2024')).toMatchObject({ unidad: 'MXN por acción' });
    expect(porId(r.items, 'ingresos_fy2025')).toMatchObject({ unidad: 'USD' });
  });
  it('success distinto de true se rechaza aunque venga annual', () => {
    expect(itemsDesdeIncomeStatement({ success: false, annual: [entrada(2024, 100)] }, { generado_en: GEN }).ok).toBe(false);
    expect(itemsDesdeIncomeStatement({ success: true, annual: [entrada(2024, 100)] }, { generado_en: GEN }).ok).toBe(true);
  });
  it('un margen no se calcula si falta el numerador o el ingreso; con datos se redondea a 4 decimales', () => {
    const a = itemsDesdeIncomeStatement(resp({ annual: [entrada(2024, 100, { netIncome: null })], ttm: null }), { generado_en: GEN });
    if (!a.ok) throw new Error('x');
    expect(porId(a.items, 'margen_neto_fy2024')).toBeUndefined();
    expect(porId(a.items, 'margen_bruto_fy2024')).toBeDefined();
    const b = itemsDesdeIncomeStatement(resp({ annual: [entrada(2024, null, { netIncome: 5 })], ttm: null }), { generado_en: GEN });
    if (!b.ok) throw new Error('x');
    expect(porId(b.items, 'margen_neto_fy2024')).toBeUndefined();
    const c = itemsDesdeIncomeStatement(resp({ annual: [entrada(2024, 3, { netIncome: 1 })], ttm: null }), { generado_en: GEN });
    if (!c.ok) throw new Error('x');
    expect(porId(c.items, 'margen_neto_fy2024')).toMatchObject({ valor: 0.3333 });
  });
  it('el crecimiento no se calcula si falta el valor actual o el anterior', () => {
    const a = itemsDesdeIncomeStatement(resp({ annual: [entrada(2023, 1, { netIncome: null }), entrada(2024, 1, { netIncome: 10 })], ttm: null }), { generado_en: GEN });
    if (!a.ok) throw new Error('x');
    expect(porId(a.items, 'crecimiento_utilidad_neta_fy2024')).toBeUndefined();
    const b = itemsDesdeIncomeStatement(resp({ annual: [entrada(2023, 1, { netIncome: 10 }), entrada(2024, 1, { netIncome: null })], ttm: null }), { generado_en: GEN });
    if (!b.ok) throw new Error('x');
    expect(porId(b.items, 'crecimiento_utilidad_neta_fy2024')).toBeUndefined();
  });
  it('valores no finitos (Infinity, NaN) se tratan como sin dato', () => {
    const r = itemsDesdeIncomeStatement(resp({ annual: [entrada(2024, Infinity, { netIncome: NaN })], ttm: null }), { generado_en: GEN });
    if (!r.ok) throw new Error('x');
    expect(porId(r.items, 'ingresos_fy2024')).toBeUndefined();
    expect(porId(r.items, 'utilidad_neta_fy2024')).toBeUndefined();
  });
  it('respuestas inválidas: sin éxito, sin annual, sin periodos legibles o entradas que no son objetos', () => {
    expect(itemsDesdeIncomeStatement(null, { generado_en: GEN })).toEqual({ ok: false, errores: ['la respuesta de income-statement no es exitosa (success !== true)'] });
    expect(itemsDesdeIncomeStatement({ success: false, error: 'x' }, { generado_en: GEN }).ok).toBe(false);
    expect(itemsDesdeIncomeStatement({ success: true }, { generado_en: GEN })).toEqual({ ok: false, errores: ['la respuesta de income-statement no trae `annual`'] });
    expect(itemsDesdeIncomeStatement({ success: true, annual: [] }, { generado_en: GEN })).toEqual({ ok: false, errores: ['no hay ningún periodo con fecha legible'] });
    const r = itemsDesdeIncomeStatement({ success: true, annual: ['x', entrada(2024, 100)], ttm: 5 }, { generado_en: GEN });
    if (!r.ok) throw new Error('x');
    expect(r.avisos).toContain('fyundefined: entrada inválida, se omite');
    expect(r.avisos).toContain('ttm: entrada inválida, se omite');
    expect(porId(r.items, 'ingresos_fy2024')).toBeDefined();
  });
  it('los items generados pasan el validador del sobre', () => {
    const r = itemsDesdeIncomeStatement(resp(), { generado_en: GEN });
    if (!r.ok) throw new Error('x');
    const s = armarSobreFundamental({ run_id: RUN_ID, snapshot_id: SNAP_ID, generado_en: GEN, ticker: 'GKOS', mercado: 'US', items: r.items, tesis_vigente: null });
    expect(validarSobreFundamental(s).ok).toBe(true);
  });
});

describe('armarSobreFundamental', () => {
  it('arma el sobre entrada.v1 con snapshot y tesis', () => {
    const s = armarSobreFundamental({ run_id: RUN_ID, snapshot_id: SNAP_ID, generado_en: GEN, ticker: 'GKOS', mercado: 'US', items: [], tesis_vigente: { texto: 't', version: 1, origen: 'al_entrar' } });
    expect(s).toEqual({
      contrato: 'entrada.v1', run_id: RUN_ID, agente: 'fundamental', ticker: 'GKOS', mercado: 'US',
      snapshot: { id: SNAP_ID, generado_en: GEN, datos: { items: [] } }, tesis_vigente: { texto: 't', version: 1, origen: 'al_entrar' },
    });
  });
});
