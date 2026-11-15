import { describe, expect, it } from 'vitest';
import { ejecutarRevisionPmp, valuacionVigente } from './revision-pmp-bd';
import { datosFundamentalesDeItems } from './revision-pmp-datos';
import type { FetchDatos } from '../agentes-ia';
import { DIARIAS_PRUEBA, respuestaChart } from '../agentes-ia/velas.test-util';

const it0 = (campo: string, valor: number) => ({ id: campo, campo, valor, unidad: 'USD', fuente: 'x', fecha_dato: '2026-01-01' });
const entrada = (fy: number, ingresos: number) => ({
  fiscalYear: fy, fiscalPeriod: 0, endDate: `${fy}-12-31`, currency: 'USD', revenue: ingresos, costOfRevenue: null, grossProfit: ingresos * 0.8, opex: null, sgaExp: null, rndExp: null,
  opIncome: ingresos * 0.2, otherNetIncome: null, ebt: null, incomeTax: null, netIncome: ingresos * 0.1, dilutedAvgShares: 1000, dilutedEps: 0.1, interestNet: null,
});
const RESP: Record<string, unknown> = {
  '/api/webull/income-statement': { success: true, symbol: 'META', annual: [entrada(2024, 1200), entrada(2025, 1500)], ttm: null, forwardEps: null },
  'freq=annual': { data: [] }, 'freq=quarterly': { data: [] }, '/stock/metric': { metric: {} },
  'interval=1day': respuestaChart('META', '1day', DIARIAS_PRUEBA()),
};
const fetchFn: FetchDatos = async url => {
  const k = Object.keys(RESP).find(x => url.includes(x));
  if (k === undefined) throw new Error('URL no prevista');
  return { ok: true, status: 200, json: async () => RESP[k] };
};
const deps = { fetchFn, origen: 'https://x.test', authorization: 'Bearer T', finnhub_key: 'K' };
const clienteCon = (filas: unknown[]) => ({ from: () => ({ select: () => ({ eq: () => ({ eq: async () => ({ data: filas, error: null }) }) }) }) });
const ficha = (valor: unknown) => ({ valuacion_base: { estado: 'declarado', valor_estimado_base: valor, fuente: 'mi análisis', fecha: '2026-11-01', horizonte_meses: 36 } });
const AHORA = '2026-11-10T15:00:00.000Z';

describe('valuacionVigente', () => {
  it('lee la valuación declarada y rechaza lo inválido', () => {
    expect(valuacionVigente(ficha(300))).toMatchObject({ valor: 300, horizonte_meses: 36 });
    expect(valuacionVigente(ficha('250.5'))?.valor).toBe(250.5);
    expect(valuacionVigente(ficha(-1))).toBeNull();
    expect(valuacionVigente({})).toBeNull();
    expect(valuacionVigente({ valuacion_base: { estado: 'borrador', valor_estimado_base: 5, horizonte_meses: 36 } })).toBeNull();
  });
});

describe('datosFundamentalesDeItems', () => {
  it('compara los dos últimos años fiscales consecutivos y suma deuda larga + corriente', () => {
    const r = datosFundamentalesDeItems([
      it0('ingresos_fy2024', 100), it0('ingresos_fy2025', 120), it0('margen_operativo_fy2024', 0.2), it0('margen_operativo_fy2025', 0.18),
      it0('deuda_largo_plazo_fy2024', 50), it0('deuda_corriente_fy2024', 10), it0('deuda_largo_plazo_fy2025', 60), it0('deuda_corriente_fy2025', 15),
      it0('flujo_caja_libre_fy2024', -5), it0('flujo_caja_libre_fy2025', -8), it0('activos_totales_fy2025', 900),
    ]);
    expect(r.periodo).toBe('FY2025 vs FY2024');
    expect(r.datos).toMatchObject({ ingresos_actual: 120, ingresos_previo: 100, deuda_total: 75, deuda_total_previa: 60, fcf_anuales: [-5, -8], activos_totales: 900, fcf_trimestres: null, deterioro_activos: null });
  });
  it('sin años consecutivos o con deuda a medias: null, nunca cero', () => {
    const r = datosFundamentalesDeItems([it0('ingresos_fy2025', 120), it0('deuda_largo_plazo_fy2025', 60)]);
    expect(r.periodo).toBeNull();
    expect(r.datos.ingresos_previo).toBeNull();
    expect(r.datos.deuda_total).toBeNull();
  });
});

describe('ejecutarRevisionPmp', () => {
  it('valor estimado muy bajo frente al cierre → revisar venta del 100% (no automática)', async () => {
    const r = await ejecutarRevisionPmp(deps, clienteCon([{ id: 'e1', ficha: ficha(50) }]), 'meta', AHORA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos.resultado).toBe('revisar_venta_100');
    expect(r.datos.venta_automatica).toBe(false);
    expect(r.datos.ticker).toBe('META');
    expect(r.datos.cierre).not.toBeNull();
    expect(r.datos.periodo_fundamentales).toBe('FY2025 vs FY2024');
  });
  it('sin valuacion_base declarada: no evaluable y lo avisa', async () => {
    const r = await ejecutarRevisionPmp(deps, clienteCon([{ id: 'e1', ficha: {} }]), 'META', AHORA);
    expect(r.ok && r.datos.resultado).toBe('no_evaluable');
    expect(r.ok && r.datos.avisos.some(a => a.includes('valuacion_base'))).toBe(true);
  });
  it('ticker inválido y expedientes duplicados', async () => {
    const a = await ejecutarRevisionPmp(deps, clienteCon([]), '', AHORA);
    expect(a.ok).toBe(false);
    const b = await ejecutarRevisionPmp(deps, clienteCon([{ id: '1', ficha: {} }, { id: '2', ficha: {} }]), 'META', AHORA);
    expect(!b.ok && b.http).toBe(409);
  });
});
