import { describe, expect, it } from 'vitest';
import { itemsDesdeFinnhub, validarSobreFundamental, armarSobreFundamental } from './index';
import { RUN_ID, SNAP_ID } from './fixtures.test-util';

const GEN = '2026-10-31T19:00:00.000Z';
const c = (concept: string, value: unknown, unit = 'u_usd') => ({ concept, unit, label: 'x', value });
// Valores reales de GKOS (10-K 2025 y 10-Q T3 2026) tal como los devolvió Finnhub.
const bs2025 = [
  c('us-gaap_CashAndCashEquivalentsAtCarryingValue', 90813000.0), c('us-gaap_AvailableForSaleSecuritiesDebtSecurities', 187947000.0), c('us-gaap_AssetsCurrent', 474984000),
  c('us-gaap_Assets', 893487000), c('us-gaap_LiabilitiesCurrent', 101275000), c('us-gaap_Liabilities', 237332000), c('us-gaap_StockholdersEquity', 656155000),
  c('us-gaap_FinanceLeaseLiabilityNoncurrent', 68109000.0), c('gkos_DepositAssetsAndOtherAssetsNoncurrent', 21859000),
];
const cf2025 = [
  c('us-gaap_NetCashProvidedByUsedInOperatingActivities', -14800000.0), c('us-gaap_PaymentsToAcquirePropertyPlantAndEquipment', 7666000),
  c('us-gaap_NetCashProvidedByUsedInInvestingActivities', -77613000), c('us-gaap_NetCashProvidedByUsedInFinancingActivities', 11886000), c('us-gaap_ShareBasedCompensation', 63218000),
];
const rep = (year: number, quarter: number, form: string, fin: string, filed: string, bs: unknown[], cf: unknown[]) => ({ year, quarter, form, endDate: `${fin} 00:00:00`, filedDate: `${filed} 00:00:00`, report: { bs, cf, ic: [] } });
const anual = (extra: unknown[] = []) => ({ cik: '1', data: [rep(2025, 0, '10-K', '2025-12-31', '2026-02-23', bs2025, cf2025), ...extra] });
const trimestral = { data: [rep(2026, 3, '10-Q', '2026-09-30', '2026-10-28', [], [c('us-gaap_NetCashProvidedByUsedInOperatingActivities', 40867000), c('us-gaap_PaymentsToAcquirePropertyPlantAndEquipment', 8776000)])] };
const porId = (items: { id: string }[], id: string) => items.find(i => i.id === id);
const ok = (r: ReturnType<typeof itemsDesdeFinnhub>) => { if (!r.ok) throw new Error(r.errores.join('|')); return r; };

describe('itemsDesdeFinnhub: reporte anual', () => {
  it('balance y flujo de caja con fuente, formulario, fecha de cierre y unidad USD', () => {
    const r = ok(itemsDesdeFinnhub({ reportado: anual() }, { generado_en: GEN }));
    expect(porId(r.items, 'efectivo_fy2025')).toEqual({
      id: 'efectivo_fy2025', campo: 'efectivo_fy2025', valor: 90813000, unidad: 'USD',
      fuente: 'Finnhub financials-reported (estados presentados ante la SEC): formulario 10-K presentado 2026-02-23; balance', fecha_dato: '2025-12-31',
    });
    expect(porId(r.items, 'patrimonio_fy2025')).toMatchObject({ valor: 656155000 });
    expect(porId(r.items, 'pasivo_arrendamiento_financiero_no_corriente_fy2025')).toMatchObject({ valor: 68109000 });
    expect(porId(r.items, 'flujo_operativo_fy2025')).toMatchObject({ valor: -14800000, fecha_dato: '2025-12-31' });
    expect(porId(r.items, 'flujo_operativo_fy2025')!).toMatchObject({ fuente: 'Finnhub financials-reported (estados presentados ante la SEC): formulario 10-K presentado 2026-02-23; flujo de caja' });
    expect(porId(r.items, 'compensacion_en_acciones_fy2025')).toMatchObject({ valor: 63218000 });
  });
  it('calcula en código la razón corriente y el flujo de caja libre, con fuente de cálculo', () => {
    const r = ok(itemsDesdeFinnhub({ reportado: anual() }, { generado_en: GEN }));
    expect(porId(r.items, 'razon_corriente_fy2025')).toMatchObject({ valor: 4.69, unidad: 'ratio', fecha_dato: '2025-12-31', fuente: 'Calculado por código: activos corrientes entre pasivos corrientes (Finnhub financials-reported)' });
    expect(porId(r.items, 'flujo_caja_libre_fy2025')).toMatchObject({ valor: -22466000, unidad: 'USD', fuente: 'Calculado por código: flujo operativo menos pagos por propiedad, planta y equipo (Finnhub financials-reported)' });
  });
  it('la razón corriente se redondea a 4 decimales', () => {
    const r = ok(itemsDesdeFinnhub({ reportado: { data: [rep(2025, 0, '10-K', '2025-12-31', '2026-02-23', [c('us-gaap_AssetsCurrent', 1), c('us-gaap_LiabilitiesCurrent', 3)], cf2025)] } }, { generado_en: GEN }));
    expect(porId(r.items, 'razon_corriente_fy2025')!).toMatchObject({ valor: 0.3333 });
  });
  it('un concepto ausente se omite con aviso: no se asume cero (deuda) ni se infiere', () => {
    const r = ok(itemsDesdeFinnhub({ reportado: anual() }, { generado_en: GEN }));
    expect(porId(r.items, 'deuda_largo_plazo_fy2025')).toBeUndefined();
    expect(porId(r.items, 'deuda_corriente_fy2025')).toBeUndefined();
    expect(r.avisos).toContain('fy2025: sin concepto para deuda_largo_plazo (se omite; no se asume cero)');
    expect(r.avisos).toContain('fy2025: sin concepto para deuda_corriente (se omite; no se asume cero)');
    expect(r.avisos).not.toContain('fy2025: sin concepto para efectivo (se omite; no se asume cero)');
  });
  it('no calcula razón corriente con pasivos corrientes en cero o ausentes, ni flujo libre sin ambos conceptos', () => {
    const base = (bs: unknown[], cf: unknown[]) => ok(itemsDesdeFinnhub({ reportado: { data: [rep(2025, 0, '10-K', '2025-12-31', '2026-02-23', bs, cf)] } }, { generado_en: GEN }));
    const a = base([c('us-gaap_AssetsCurrent', 10), c('us-gaap_LiabilitiesCurrent', 0)], cf2025);
    expect(porId(a.items, 'razon_corriente_fy2025')).toBeUndefined();
    const b = base([c('us-gaap_AssetsCurrent', 10)], cf2025);
    expect(porId(b.items, 'razon_corriente_fy2025')).toBeUndefined();
    const d = base(bs2025, [c('us-gaap_NetCashProvidedByUsedInOperatingActivities', 5)]);
    expect(porId(d.items, 'flujo_caja_libre_fy2025')).toBeUndefined();
    expect(porId(d.items, 'flujo_operativo_fy2025')).toBeDefined();
    const f = base([c('us-gaap_LiabilitiesCurrent', 4)], cf2025);
    expect(porId(f.items, 'razon_corriente_fy2025')).toBeUndefined();
    const e = base(bs2025, [c('us-gaap_PaymentsToAcquirePropertyPlantAndEquipment', 5)]);
    expect(porId(e.items, 'flujo_caja_libre_fy2025')).toBeUndefined();
  });
  it('unidad distinta de USD o valor no numérico: se omite (con aviso en el primer caso)', () => {
    const r = ok(itemsDesdeFinnhub({ reportado: { data: [rep(2025, 0, '10-K', '2025-12-31', '2026-02-23', [c('us-gaap_Assets', 5, 'u_shares'), c('us-gaap_Liabilities', 'mucho'), c('us-gaap_AssetsCurrent', NaN)], cf2025)] } }, { generado_en: GEN }));
    expect(porId(r.items, 'activos_totales_fy2025')).toBeUndefined();
    expect(porId(r.items, 'pasivos_totales_fy2025')).toBeUndefined();
    expect(porId(r.items, 'activos_corrientes_fy2025')).toBeUndefined();
    expect(r.avisos).toContain('fy2025: us-gaap_Assets con unidad inesperada, se omite');
  });
  it('usa el siguiente concepto candidato si el primero falta o tiene otra unidad', () => {
    const r = ok(itemsDesdeFinnhub({ reportado: { data: [rep(2025, 0, '10-K', '2025-12-31', '2026-02-23', [c('us-gaap_LongTermDebtNoncurrent', 1, 'u_shares'), c('us-gaap_LongTermDebt', 77), c('us-gaap_MarketableSecuritiesCurrent', 9)], cf2025)] } }, { generado_en: GEN }));
    expect(porId(r.items, 'deuda_largo_plazo_fy2025')).toMatchObject({ valor: 77 });
    expect(porId(r.items, 'inversiones_corto_plazo_fy2025')).toMatchObject({ valor: 9 });
  });
  it('toma los últimos 3 años por omisión, ordenados por cierre, y respeta la opción anios', () => {
    const anios = [2021, 2022, 2023, 2024, 2025].map(y => rep(y, 0, '10-K', `${y}-12-31`, `${y + 1}-02-20`, bs2025, cf2025));
    const desorden = { data: [anios[1]!, anios[4]!, anios[0]!, anios[3]!, anios[2]!] };
    const r = ok(itemsDesdeFinnhub({ reportado: desorden }, { generado_en: GEN }));
    expect(porId(r.items, 'efectivo_fy2025')).toBeDefined();
    expect(porId(r.items, 'efectivo_fy2024')).toBeDefined();
    expect(porId(r.items, 'efectivo_fy2023')).toBeDefined();
    expect(porId(r.items, 'efectivo_fy2022')).toBeUndefined();
    const r1 = ok(itemsDesdeFinnhub({ reportado: desorden }, { generado_en: GEN, anios: 1 }));
    expect(porId(r1.items, 'efectivo_fy2025')).toBeDefined();
    expect(porId(r1.items, 'efectivo_fy2024')).toBeUndefined();
  });
  it('reportes repetidos para el mismo cierre: se conserva el más reciente presentado y se avisa', () => {
    const a = rep(2025, 0, '10-K', '2025-12-31', '2026-02-23', [c('us-gaap_Assets', 1)], cf2025);
    const b = rep(2025, 0, '10-K/A', '2025-12-31', '2026-04-01', [c('us-gaap_Assets', 2)], cf2025);
    const r = ok(itemsDesdeFinnhub({ reportado: { data: [a, b] } }, { generado_en: GEN }));
    expect(porId(r.items, 'activos_totales_fy2025')).toMatchObject({ valor: 2, fuente: expect.stringContaining('10-K/A presentado 2026-04-01') });
    expect(r.avisos).toContain('fy2025: reporte repetido para el cierre 2025-12-31, se conserva el más reciente presentado');
  });
  it('ignora trimestrales en la lista anual; reportes inválidos o sin fecha se omiten con aviso', () => {
    const r = ok(itemsDesdeFinnhub({ reportado: anual([rep(2026, 3, '10-Q', '2026-09-30', '2026-10-28', bs2025, cf2025), 'x', { year: 'a' }, { ...rep(2024, 0, '10-K', 'no-es-fecha', '2025-02-01', bs2025, cf2025), endDate: 'no es fecha' }]) }, { generado_en: GEN }));
    expect(porId(r.items, 'efectivo_t3_2026')).toBeUndefined();
    expect(r.avisos).toContain('finnhub financials-reported anual: reporte 2 inválido, se omite');
    expect(r.avisos).toContain('finnhub financials-reported anual: reporte 3 inválido, se omite');
    expect(r.avisos).toContain('finnhub financials-reported anual: reporte 4 con endDate ilegible, se omite (no se inventa la fecha)');
    expect(porId(r.items, 'efectivo_fy2024')).toBeUndefined();
  });
  it('cada campo inválido de un reporte lo descarta por separado, y un elemento nulo no rompe', () => {
    const buenoBs = { bs: bs2025, cf: cf2025 };
    const casos: unknown[] = [
      null,
      { year: 'a', quarter: 0, endDate: '2025-12-31', report: buenoBs },
      { quarter: 0, endDate: '2025-12-31', report: buenoBs },
      { year: 2025, quarter: 'x', endDate: '2025-12-31', report: buenoBs },
      { year: 2025, endDate: '2025-12-31', report: buenoBs },
      { year: 2025, quarter: 0, endDate: '2025-12-31', report: 5 },
      { year: 2025, quarter: 0, endDate: '2025-12-31' },
    ];
    for (const caso of casos) {
      const r = ok(itemsDesdeFinnhub({ reportado: { data: [caso, rep(2024, 0, '10-K', '2024-12-31', '2025-02-20', bs2025, cf2025)] } }, { generado_en: GEN }));
      expect(porId(r.items, 'efectivo_fy2025')).toBeUndefined();
      expect(porId(r.items, 'efectivo_fy2024')).toBeDefined();
      expect(r.avisos).toContain('finnhub financials-reported anual: reporte 0 inválido, se omite');
    }
  });
  it('formulario o fecha de presentación ausentes se dicen en la fuente sin inventarlos', () => {
    const sinForm = { year: 2025, quarter: 0, endDate: '2025-12-31', report: { bs: bs2025, cf: cf2025 } };
    const r = ok(itemsDesdeFinnhub({ reportado: { data: [sinForm] } }, { generado_en: GEN }));
    expect(porId(r.items, 'efectivo_fy2025')).toMatchObject({ fuente: 'Finnhub financials-reported (estados presentados ante la SEC): formulario sin dato; balance' });
  });
  it('solo el balance vacío avisa del balance; solo el flujo vacío avisa del flujo; sin formulario lo dice', () => {
    const a = ok(itemsDesdeFinnhub({ reportado: { data: [rep(2025, 0, '10-K', '2025-12-31', '2026-02-23', [], cf2025)] } }, { generado_en: GEN }));
    expect(a.avisos).toContain('fy2025: balance sin datos en la fuente (formulario 10-K, cierre 2025-12-31)');
    expect(a.avisos.some(x => x.includes('flujo de caja sin datos'))).toBe(false);
    const b = ok(itemsDesdeFinnhub({ reportado: { data: [rep(2025, 0, '10-K', '2025-12-31', '2026-02-23', bs2025, [])] } }, { generado_en: GEN }));
    expect(b.avisos).toContain('fy2025: flujo de caja sin datos en la fuente (formulario 10-K, cierre 2025-12-31)');
    expect(b.avisos.some(x => x.includes('balance sin datos'))).toBe(false);
    const sinForm = { year: 2025, quarter: 0, endDate: '2025-12-31', report: { bs: [], cf: cf2025 } };
    const d = ok(itemsDesdeFinnhub({ reportado: { data: [sinForm] } }, { generado_en: GEN }));
    expect(d.avisos).toContain('fy2025: balance sin datos en la fuente (formulario sin dato, cierre 2025-12-31)');
  });
  it('un balance o un flujo vacío en un reporte anual se avisa', () => {
    const r = ok(itemsDesdeFinnhub({ reportado: { data: [rep(2025, 0, '10-K', '2025-12-31', '2026-02-23', [], [])] } }, { generado_en: GEN }));
    expect(r.items).toEqual([]);
    expect(r.avisos).toContain('fy2025: balance sin datos en la fuente (formulario 10-K, cierre 2025-12-31)');
    expect(r.avisos).toContain('fy2025: flujo de caja sin datos en la fuente (formulario 10-K, cierre 2025-12-31)');
  });
});

describe('itemsDesdeFinnhub: reporte trimestral', () => {
  it('flujo de caja acumulado del año con su fecha y aviso de que el balance del 10-Q no viene', () => {
    const r = ok(itemsDesdeFinnhub({ reportado: anual(), reportado_trimestral: trimestral }, { generado_en: GEN }));
    expect(porId(r.items, 'flujo_operativo_acum_t3_2026')).toEqual({
      id: 'flujo_operativo_acum_t3_2026', campo: 'flujo_operativo_acum_t3_2026', valor: 40867000, unidad: 'USD', fecha_dato: '2026-09-30',
      fuente: 'Finnhub financials-reported (estados presentados ante la SEC): formulario 10-Q presentado 2026-10-28; flujo de caja; flujo de caja acumulado del año fiscal hasta el cierre del trimestre',
    });
    expect(porId(r.items, 'flujo_caja_libre_acum_t3_2026')).toMatchObject({ valor: 32091000, fecha_dato: '2026-09-30' });
    expect(porId(r.items, 'efectivo_t3_2026')).toBeUndefined();
    expect(r.avisos).toContain('t3_2026: el balance de este reporte no viene en la fuente (formulario 10-Q, cierre 2026-09-30); el balance más reciente disponible es el anual');
  });
  it('si el trimestral trae balance, también se incluye (con la etiqueta del trimestre)', () => {
    const conBs = { data: [rep(2026, 3, '10-Q', '2026-09-30', '2026-10-28', [c('us-gaap_Assets', 900), c('us-gaap_AssetsCurrent', 8), c('us-gaap_LiabilitiesCurrent', 4)], [c('us-gaap_NetCashProvidedByUsedInOperatingActivities', 1)])] };
    const r = ok(itemsDesdeFinnhub({ reportado: anual(), reportado_trimestral: conBs }, { generado_en: GEN }));
    expect(porId(r.items, 'activos_totales_t3_2026')).toMatchObject({ valor: 900, fecha_dato: '2026-09-30' });
    expect(porId(r.items, 'razon_corriente_t3_2026')).toMatchObject({ valor: 2 });
    expect(r.avisos).not.toContain('t3_2026: el balance de este reporte no viene en la fuente (formulario 10-Q, cierre 2026-09-30); el balance más reciente disponible es el anual');
  });
  it('un trimestral no posterior al último anual no se usa y se avisa; sin anual se usa el más reciente', () => {
    const viejo = { data: [rep(2025, 3, '10-Q', '2025-09-30', '2025-10-28', [], [c('us-gaap_NetCashProvidedByUsedInOperatingActivities', 1)])] };
    const r = ok(itemsDesdeFinnhub({ reportado: anual(), reportado_trimestral: viejo }, { generado_en: GEN }));
    expect(porId(r.items, 'flujo_operativo_acum_t3_2025')).toBeUndefined();
    expect(r.avisos).toContain('finnhub financials-reported trimestral: no hay un reporte trimestral posterior al último anual');
    const solo = ok(itemsDesdeFinnhub({ reportado_trimestral: viejo }, { generado_en: GEN }));
    expect(porId(solo.items, 'flujo_operativo_acum_t3_2025')).toBeDefined();
  });
  it('un trimestral anterior al último anual (aunque posterior a un anual más viejo) o del mismo cierre no se usa', () => {
    const dosAnuales = { data: [rep(2024, 0, '10-K', '2024-12-31', '2025-02-20', bs2025, cf2025), rep(2025, 0, '10-K', '2025-12-31', '2026-02-23', bs2025, cf2025)] };
    const entre = { data: [rep(2025, 3, '10-Q', '2025-09-30', '2025-10-28', [], [c('us-gaap_NetCashProvidedByUsedInOperatingActivities', 1)])] };
    const r = ok(itemsDesdeFinnhub({ reportado: dosAnuales, reportado_trimestral: entre }, { generado_en: GEN }));
    expect(porId(r.items, 'flujo_operativo_acum_t3_2025')).toBeUndefined();
    const igual = { data: [rep(2025, 3, '10-Q', '2025-12-31', '2026-01-28', [], [c('us-gaap_NetCashProvidedByUsedInOperatingActivities', 1)])] };
    const r2 = ok(itemsDesdeFinnhub({ reportado: dosAnuales, reportado_trimestral: igual }, { generado_en: GEN }));
    expect(porId(r2.items, 'flujo_operativo_acum_t3_2025')).toBeUndefined();
  });
  it('elige el reporte parcial más reciente y descarta los anuales (trimestre 0) y el cuarto trimestre', () => {
    const q1 = rep(2026, 1, '10-Q', '2026-03-31', '2026-04-28', [], [c('us-gaap_NetCashProvidedByUsedInOperatingActivities', 1)]);
    const q2 = rep(2026, 2, '10-Q', '2026-06-30', '2026-07-28', [], [c('us-gaap_NetCashProvidedByUsedInOperatingActivities', 2)]);
    const q4 = rep(2026, 4, '10-K', '2026-12-31', '2027-02-20', [], [c('us-gaap_NetCashProvidedByUsedInOperatingActivities', 4)]);
    const r = ok(itemsDesdeFinnhub({ reportado: anual(), reportado_trimestral: { data: [q1, q4, q2] } }, { generado_en: GEN }));
    expect(porId(r.items, 'flujo_operativo_acum_t2_2026')).toMatchObject({ valor: 2 });
    expect(porId(r.items, 'flujo_operativo_acum_t1_2026')).toBeUndefined();
    expect(porId(r.items, 'flujo_operativo_acum_t4_2026')).toBeUndefined();
  });
});

describe('itemsDesdeFinnhub: stock/metric', () => {
  const metric = { metric: { currentRatioAnnual: 4.69, currentRatioQuarterly: 5.0404, quickRatioAnnual: 3.8249, 'totalDebt/totalEquityAnnual': 0.1059, 'totalDebt/totalEquityQuarterly': 0.0987, 'longTermDebt/equityAnnual': 0, 'longTermDebt/equityQuarterly': null, grossMarginAnnual: 77.97 } };
  it('incluye solo los ratios elegidos, con la fecha de consulta y la fuente que lo aclara; el cero es un valor real', () => {
    const r = ok(itemsDesdeFinnhub({ metric }, { generado_en: GEN }));
    expect(porId(r.items, 'razon_corriente_trimestral_proveedor_a_fecha_de_consulta')).toEqual({
      id: 'razon_corriente_trimestral_proveedor_a_fecha_de_consulta', campo: 'razon_corriente_trimestral_proveedor_a_fecha_de_consulta', valor: 5.0404, unidad: 'ratio',
      fuente: 'Finnhub stock/metric (ratio calculado por el proveedor; la fecha es la de consulta, no la del balance)', fecha_dato: '2026-10-31',
    });
    expect(porId(r.items, 'deuda_total_sobre_patrimonio_anual_proveedor_a_fecha_de_consulta')).toMatchObject({ valor: 0.1059 });
    expect(porId(r.items, 'deuda_largo_plazo_sobre_patrimonio_anual_proveedor_a_fecha_de_consulta')).toMatchObject({ valor: 0 });
    expect(r.items.some(i => i.id.includes('margen') || i.id.includes('gross'))).toBe(false);
    expect(porId(r.items, 'deuda_largo_plazo_sobre_patrimonio_trimestral_proveedor_a_fecha_de_consulta')).toBeUndefined();
    expect(r.avisos).toContain('finnhub metric: longTermDebt/equityQuarterly sin dato (se omite, no se rellena)');
    expect(r.avisos).toContain('finnhub metric: quickRatioQuarterly sin dato (se omite, no se rellena)');
  });
  it('sin fecha de consulta legible se omiten los ratios y se avisa; sin `metric` es error', () => {
    const r = ok(itemsDesdeFinnhub({ metric }, { generado_en: 'ayer' }));
    expect(r.items).toEqual([]);
    expect(r.avisos).toContain('finnhub metric: generado_en ilegible, se omiten los ratios del proveedor');
    for (const m of [null, {}, { metric: 5 }, { metric: null }, []]) expect(itemsDesdeFinnhub({ metric: m }, { generado_en: GEN })).toEqual({ ok: false, errores: ['finnhub metric: falta `metric`'] });
  });
});

describe('itemsDesdeFinnhub: errores y combinación', () => {
  it('respuestas sin la lista `data` o sin ningún reporte anual legible son errores', () => {
    for (const x of [null, {}, { data: 'x' }, []]) {
      expect(itemsDesdeFinnhub({ reportado: x }, { generado_en: GEN })).toEqual({ ok: false, errores: ['finnhub financials-reported anual: falta la lista `data`'] });
      expect(itemsDesdeFinnhub({ reportado_trimestral: x }, { generado_en: GEN })).toEqual({ ok: false, errores: ['finnhub financials-reported trimestral: falta la lista `data`'] });
    }
    expect(itemsDesdeFinnhub({ reportado: { data: [] } }, { generado_en: GEN })).toEqual({ ok: false, errores: ['finnhub financials-reported anual: no hay ningún reporte anual con fecha legible'] });
    expect(itemsDesdeFinnhub({ reportado: { data: [rep(2026, 3, '10-Q', '2026-09-30', '2026-10-28', [], [])] } }, { generado_en: GEN }).ok).toBe(false);
  });
  it('sin ninguna entrada devuelve una lista vacía', () => {
    expect(itemsDesdeFinnhub({}, { generado_en: GEN })).toEqual({ ok: true, items: [], avisos: [] });
  });
  it('los items generados (anual + trimestral + metric) pasan el validador del sobre, con ids únicos', () => {
    const r = ok(itemsDesdeFinnhub({ reportado: anual(), reportado_trimestral: trimestral, metric: { metric: { currentRatioAnnual: 4.69 } } }, { generado_en: GEN }));
    const ids = r.items.map(i => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    const s = armarSobreFundamental({ run_id: RUN_ID, snapshot_id: SNAP_ID, generado_en: GEN, ticker: 'GKOS', mercado: 'US', items: r.items, tesis_vigente: null });
    expect(validarSobreFundamental(s).ok).toBe(true);
  });
});
