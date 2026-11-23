// Pruebas de la v0.74: pertenencia a los índices de referencia (S&P 500, Nasdaq-100, Dow, QUAL). PMP al abrir: obligatoria; PCP: solo alerta.
import { describe, expect, it } from 'vitest';
import { respuestaIndicesPrueba } from './indices.test-util';
import { limpiarCachePertenencia } from '../conexion/pertenencia-indices';
import { ejecutarAnalisisGuardado } from './index';
import type { FetchDatos } from './index';
import { modeloFalso } from './modelo-falso.test-util';
import { PF, nuevaBdGuardado } from './bd-guardado.test-util';
import { DIARIAS_PRUEBA, SEMANALES_PRUEBA, respuestaChart } from './velas.test-util';
import type { Fila } from './bd-guardado.test-util';

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
type Indices = { miembros: string[]; falla?: boolean };
function montar(portafolio: 'PMP' | 'PCP', ind: Indices, bd: Record<string, Fila[]> = {}) {
  limpiarCachePertenencia();
  const b = nuevaBdGuardado(bd, {}, portafolio);
  const m = modeloFalso({ directorPropone: true });
  const llamadas: string[] = [];
  const fetchFn: FetchDatos = async url => {
    llamadas.push(url);
    if (url.includes('wikipedia.org') || url.includes('ishares.com')) {
      if (ind.falla === true) return { ok: false, status: 403, json: async () => ({}) };
      const ix = respuestaIndicesPrueba(url, ind.miembros)!;
      return ix;
    }
    const k = Object.keys(RESP).find(x => url.includes(x));
    if (k === undefined) throw new Error('URL no prevista ' + url);
    return { ok: true, status: 200, json: async () => RESP[k] };
  };
  let n = 0;
  const deps = { llamar: m.llamar, modelo_analista: 'ma', modelo_director: 'md', ahora: () => AHORA, nuevoId: () => `00000000-0000-4000-9000-${String(++n).padStart(12, '0')}` };
  const ejecutar = () => ejecutarAnalisisGuardado(b.cliente, deps, { fetchFn, origen: 'https://x.test', authorization: TOKEN, finnhub_key: CLAVE }, { ticker: 'GKOS', guardar: true, portafolio });
  return { b, m, llamadas, ejecutar };
}

describe('v0.74: PMP exige pertenecer a un índice para abrir', () => {
  it('pertenece a uno: la corrida corre y guarda la pertenencia', async () => {
    const t = montar('PMP', { miembros: ['GKOS'] });
    const r = await t.ejecutar();
    expect(r.http).toBe(200);
    expect(JSON.stringify([t.b.e.inserts, t.b.e.rpc])).toContain('pertenencia_indices');
  });
  it('no pertenece a ninguno: 422, sin modelo ni escritura, sugiere PCP', async () => {
    const t = montar('PMP', { miembros: [] });
    const r = await t.ejecutar();
    expect(r.http).toBe(422);
    expect(JSON.stringify(r.cuerpo)).toContain('PCP');
    expect(t.m.peticiones).toHaveLength(0);
    expect(t.b.e.inserts).toHaveLength(0);
  });
  it('la fuente falla: 422, no se supone que pertenece', async () => {
    const t = montar('PMP', { miembros: [], falla: true });
    const r = await t.ejecutar();
    expect(r.http).toBe(422);
    expect(JSON.stringify(r.cuerpo)).toContain('no se puede comprobar');
    expect(t.m.peticiones).toHaveLength(0);
  });
});

describe('v0.74: PCP solo da alerta', () => {
  it('no pertenece: corre y deja un aviso', async () => {
    const t = montar('PCP', { miembros: [] });
    const r = await t.ejecutar();
    expect(r.http).toBe(200);
    expect(JSON.stringify([r.cuerpo, t.b.e.inserts, t.b.e.rpc])).toContain('No pertenece a ningún índice');
  });
  it('pertenece: solo lo nombra', async () => {
    const t = montar('PCP', { miembros: ['GKOS'] });
    const r = await t.ejecutar();
    expect(r.http).toBe(200);
    expect(JSON.stringify([t.b.e.inserts, t.b.e.rpc])).toContain('Nasdaq-100');
  });
});
