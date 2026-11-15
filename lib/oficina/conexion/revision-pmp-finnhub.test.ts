import { describe, expect, it } from 'vitest';
import { datosFinnhubRevision } from './revision-pmp-finnhub';
import { datosFundamentalesDeItems } from './revision-pmp-datos';

const cf = (fo: number | null, px: number | null, extra: Array<[string, number]> = []) => [
  ...(fo === null ? [] : [{ concept: 'us-gaap_NetCashProvidedByUsedInOperatingActivities', unit: 'u_usd', value: fo }]),
  ...(px === null ? [] : [{ concept: 'us-gaap_PaymentsToAcquirePropertyPlantAndEquipment', unit: 'u_usd', value: px }]),
  ...extra.map(([concept, value]) => ({ concept, unit: 'u_usd', value })),
];
const rep = (year: number, quarter: number, endDate: string, cfl: unknown[]) => ({ year, quarter, form: quarter === 0 ? '10-K' : '10-Q', endDate, filedDate: endDate, report: { bs: [], cf: cfl } });

// FY2025: Q1 acum 10, Q2 acum 30, Q3 acum 60, anual 100 → trimestres 10, 20, 30, 40. FY2026: Q1 acum 5 → 5
const trimestral = { data: [rep(2026, 1, '2026-03-31', cf(25, 20)), rep(2025, 3, '2025-09-30', cf(80, 20)), rep(2025, 2, '2025-06-30', cf(40, 10)), rep(2025, 1, '2025-03-31', cf(15, 5))] };
const anual = { data: [rep(2025, 0, '2025-12-31', cf(130, 30, [['us-gaap_AssetImpairmentCharges', 12]]))] };

describe('flujo de caja libre por trimestre desde Finnhub', () => {
  it('reconstruye trimestres por diferencia y toma los 4 últimos consecutivos', () => {
    const r = datosFinnhubRevision(anual, trimestral);
    expect(r.fcf_trimestres).toEqual([20, 30, 40, 5]);
  });
  it('sin piezas suficientes no inventa: null con aviso', () => {
    const r = datosFinnhubRevision(anual, { data: [rep(2025, 3, '2025-09-30', cf(80, 20))] });
    expect(r.fcf_trimestres).toBeNull();
    expect(r.avisos.join(' ')).toContain('4 trimestres consecutivos');
  });
  it('un hueco en medio rompe la ventana', () => {
    const t = { data: trimestral.data.filter(x => !(x.year === 2025 && x.quarter === 2)) };
    expect(datosFinnhubRevision(anual, t).fcf_trimestres).toBeNull();
  });
});

describe('deterioro de activos del último año fiscal', () => {
  it('suma las partidas de deterioro del flujo de caja', () => {
    expect(datosFinnhubRevision(anual, trimestral).deterioro).toEqual({ fy: 2025, valor: 12 });
  });
  it('flujo de caja completo sin partidas de deterioro = 0 (propuesta); incompleto = no evaluable', () => {
    expect(datosFinnhubRevision({ data: [rep(2025, 0, '2025-12-31', cf(130, 30))] }, trimestral).deterioro).toEqual({ fy: 2025, valor: 0 });
    expect(datosFinnhubRevision({ data: [rep(2025, 0, '2025-12-31', [])] }, trimestral).deterioro).toBeNull();
    expect(datosFinnhubRevision(undefined, undefined).deterioro).toBeNull();
  });
  it('unidad distinta de USD se ignora', () => {
    const a = { data: [rep(2025, 0, '2025-12-31', [{ concept: 'us-gaap_NetCashProvidedByUsedInOperatingActivities', unit: 'u_eur', value: 5 }])] };
    expect(datosFinnhubRevision(a, undefined).deterioro).toBeNull();
  });
});

describe('integración con los datos de la revisión', () => {
  it('el deterioro usa los activos totales del mismo año fiscal', () => {
    const items = [{ id: 'a', campo: 'activos_totales_fy2025', valor: 1000, unidad: 'USD', fuente: 'x', fecha_dato: '2025-12-31' }];
    const r = datosFundamentalesDeItems(items, datosFinnhubRevision(anual, trimestral));
    expect(r.datos).toMatchObject({ deterioro_activos: 12, activos_totales: 1000, fcf_trimestres: [20, 30, 40, 5] });
  });
});
