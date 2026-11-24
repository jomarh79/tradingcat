// Pruebas de la v0.80: evaluación de recompra de PCP (cuerpo de la ruta y rechazo sin posición abierta). Base y modelo falsos: nunca se llama a la red.
import { describe, expect, it } from 'vitest';
import { ejecutarAnalisisGuardado, validarCuerpoAnalisis } from './index';
import type { FetchDatos } from './index';
import { modeloFalso } from './modelo-falso.test-util';
import { nuevaBdGuardado } from './bd-guardado.test-util';
import { DIARIAS_PRUEBA, SEMANALES_PRUEBA, respuestaChart } from './velas.test-util';

const TOKEN = 'Bearer TOKEN-SECRETO-DEL-DUENO-456';
const CLAVE = 'CLAVE-SECRETA-FINNHUB-123';
const AHORA = '2026-11-04T15:00:00.000Z';
const entrada = (fy: number, ingresos: number) => ({
  fiscalYear: fy, fiscalPeriod: 0, endDate: `${fy}-12-31`, currency: 'USD', revenue: ingresos, costOfRevenue: null, grossProfit: ingresos * 0.8, opex: null, sgaExp: null, rndExp: null,
  opIncome: ingresos * 0.2, otherNetIncome: null, ebt: null, incomeTax: null, netIncome: ingresos * 0.1, dilutedAvgShares: 1000, dilutedEps: 0.1, interestNet: null,
});
const RESP: Record<string, unknown> = {
  '/api/webull/income-statement': { success: true, symbol: 'GKOS', annual: [entrada(2023, 1200), entrada(2024, 1500)], ttm: null, forwardEps: null },
  'freq=annual': { data: [{ year: 2025, quarter: 0, form: '10-K', endDate: '2025-12-31', filedDate: '2026-02-23', report: { bs: [{ concept: 'us-gaap_Assets', unit: 'u_usd', value: 893487000 }], cf: [] } }] },
  'freq=quarterly': { data: [{ year: 2026, quarter: 3, form: '10-Q', endDate: '2026-09-30', filedDate: '2026-10-28', report: { bs: [], cf: [{ concept: 'us-gaap_NetCashProvidedByUsedInOperatingActivities', unit: 'u_usd', value: 40867000 }] } }] },
  '/stock/metric': { metric: { currentRatioAnnual: 4.69 } },
  'interval=1day': respuestaChart('GKOS', '1day', DIARIAS_PRUEBA()),
  'interval=1week': respuestaChart('GKOS', '1week', SEMANALES_PRUEBA()),
};

describe('v0.80: cuerpo de la evaluación de recompra', () => {
  const base = { ticker: 'gkos', portafolio: 'PCP', guardar: true, monto: 25, evaluacion: 'recompra' };
  it('acepta recompra de PCP con guardar y monto', () => {
    expect(validarCuerpoAnalisis(base)).toEqual({ ok: true, cuerpo: { ticker: 'GKOS', portafolio: 'PCP', guardar: true, monto: '25', evaluacion: 'recompra' } });
  });
  it('rechaza otros valores, otro portafolio, sin guardar o sin monto', () => {
    expect(validarCuerpoAnalisis({ ...base, evaluacion: 'venta' })).toMatchObject({ ok: false });
    expect(validarCuerpoAnalisis({ ...base, portafolio: 'PMP' })).toEqual({ ok: false, error: 'la recompra solo se evalúa en PCP' });
    expect(validarCuerpoAnalisis({ ...base, guardar: false })).toEqual({ ok: false, error: 'la recompra requiere guardar' });
    expect(validarCuerpoAnalisis({ ...base, monto: undefined })).toMatchObject({ ok: false, error: expect.stringContaining('monto') });
  });
});

describe('v0.80: recompra sin posición abierta', () => {
  it('422 sin llamar a ningún modelo ni escribir nada', async () => {
    const b = nuevaBdGuardado({}, {}, 'PCP');
    const m = modeloFalso({ directorPropone: true });
    const fetchFn: FetchDatos = async url => {
      const k = Object.keys(RESP).find(x => url.includes(x));
      if (k === undefined) throw new Error('URL no prevista');
      return { ok: true, status: 200, json: async () => RESP[k] };
    };
    let n = 0;
    const deps = { llamar: m.llamar, modelo_analista: 'ma', modelo_director: 'md', ahora: () => AHORA, nuevoId: () => `00000000-0000-4000-9000-${String(++n).padStart(12, '0')}` };
    const r = await ejecutarAnalisisGuardado(b.cliente, deps, { fetchFn, origen: 'https://x.test', authorization: TOKEN, finnhub_key: CLAVE }, { ticker: 'GKOS', portafolio: 'PCP', guardar: true, monto: 25, evaluacion: 'recompra' });
    expect(r.http).toBe(422);
    expect(r.cuerpo).toMatchObject({ etapa: 'recompra' });
    expect(m.peticiones).toHaveLength(0);
    expect(b.e.inserts).toHaveLength(0);
  });
});
