// Pruebas de la v0.21: monto de la operación declarado por el usuario en cada corrida.
import { describe, expect, it } from 'vitest';
import { validarCuerpoAnalisis, ejecutarAnalisisReal, ejecutarAnalisisGuardado, CLAVES_ANALISIS_REAL } from './index';
import type { FetchDatos } from './index';
import { modeloFalso } from './modelo-falso.test-util';
import { PF, nuevaBdGuardado } from './bd-guardado.test-util';
import { DIARIAS_PRUEBA, SEMANALES_PRUEBA, respuestaChart } from './velas.test-util';
import type { ErroresBd, Fila } from './bd-guardado.test-util';

const TOKEN = 'Bearer TOKEN-SECRETO-DEL-DUENO-456';
const CLAVE = 'CLAVE-SECRETA-FINNHUB-123';
const AHORA = '2026-11-04T15:00:00.000Z';
const EXP = '00000000-0000-4000-8000-0000000000aa';

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
function fetchFalso(fallaWebull = false) {
  const llamadas: string[] = [];
  const fetchFn: FetchDatos = async url => {
    llamadas.push(url);
    if (fallaWebull && url.includes('/api/webull/')) return { ok: false, status: 502, json: async () => ({}) };
    const k = Object.keys(RESP).find(x => url.includes(x));
    if (k === undefined) throw new Error('URL no prevista');
    return { ok: true, status: 200, json: async () => RESP[k] };
  };
  return { fetchFn, llamadas };
}

function montar(opc: { bd?: Record<string, Fila[]>; errores?: ErroresBd; modelo?: Parameters<typeof modeloFalso>[0]; fallaWebull?: boolean } = {}) {
  const b = nuevaBdGuardado(opc.bd ?? {}, opc.errores ?? {});
  const m = modeloFalso(opc.modelo ?? { directorPropone: true });
  const f = fetchFalso(opc.fallaWebull === true);
  let n = 0;
  const ids: string[] = [];
  const deps = { llamar: m.llamar, modelo_analista: 'ma', modelo_director: 'md', ahora: () => AHORA, nuevoId: () => { const id = `00000000-0000-4000-9000-${String(++n).padStart(12, '0')}`; ids.push(id); return id; } };
  const ejecutar = (body: unknown = { ticker: 'GKOS', guardar: true }) => ejecutarAnalisisGuardado(b.cliente, deps, { fetchFn: f.fetchFn, origen: 'https://x.test', authorization: TOKEN, finnhub_key: CLAVE }, body);
  return { b, m, f, ids, ejecutar };
}
const POSICION: Fila = { trade_id: 't-1', portfolio_id: PF, ticker: 'GKOS', fecha_apertura: '2026-10-01' };
const COMPRA: Fila = { id: 'e1', trade_id: 't-1', execution_type: 'buy', price: 10, quantity: 5, executed_at: '2026-10-10T10:00:00', total: 50 };
const EXPEDIENTE: Fila = { id: EXP, ticker: 'GKOS', mercado: 'US', portfolio_id: PF, portafolio_codigo: 'PMP', rol_posicion: null, ficha: {}, tesis_vigente: null, tesis_version: 1 };
const insertsDe = (b: ReturnType<typeof nuevaBdGuardado>, tabla: string) => b.e.inserts.filter(i => i.tabla === tabla).map(i => i.fila);

describe('v0.21: monto en el cuerpo de la ruta de análisis', () => {
  const v = (monto: unknown) => validarCuerpoAnalisis({ ticker: 'GKOS', guardar: true, monto });
  it('es una clave permitida', () => { expect(CLAVES_ANALISIS_REAL).toContain('monto'); });
  it('número o texto positivo con hasta 2 decimales se acepta y se normaliza a texto', () => {
    for (const [entra, sale] of [[50, '50'], [25, '25'], ['50', '50'], [' 25.5 ', '25.5'], [10.25, '10.25']] as const) {
      const r = v(entra);
      expect(r.ok && r.cuerpo.monto).toBe(sale);
    }
  });
  it('sin monto no hay monto (no se rellena)', () => {
    const r = validarCuerpoAnalisis({ ticker: 'GKOS', guardar: true });
    expect(r.ok && 'monto' in r.cuerpo).toBe(false);
  });
  it('cero, negativo, 3 decimales, vacío, texto, NaN, Infinity, nulo, objeto se rechazan', () => {
    for (const malo of [0, -5, 50.123, '', 'abc', NaN, Infinity, null, {}, [], '1e3', '50,5']) {
      const r = v(malo);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe('monto debe ser un número positivo en USD con hasta 2 decimales');
    }
  });
  it('sin guardar no hay Auditor: monto se rechaza en lugar de ignorarse en silencio', async () => {
    const r = await ejecutarAnalisisReal({} as never, {} as never, { ticker: 'GKOS', monto: 50 });
    expect(r.http).toBe(400);
    expect(r.cuerpo['error']).toBe('monto solo aplica con guardar: sin guardar no corre el Auditor');
  });
});

describe('v0.21: el monto llega al Auditor en una corrida guardada', () => {
  const pmp = (r: Awaited<ReturnType<ReturnType<typeof montar>['ejecutar']>>) => {
    const filas = r.cuerpo['persistencia'] as Record<string, unknown>;
    return filas;
  };
  const reglaPmp02 = (m: ReturnType<typeof montar>) => {
    const aud = insertsDe(m.b, 'oficina_analisis').find(f => f['agente'] === 'auditor_reglas');
    const salida = (aud?.['salida'] ?? {}) as { resultados_reglas?: { codigo: string; resultado: string; motivo: string | null }[] };
    return salida.resultados_reglas?.find(x => x.codigo === 'PMP-02');
  };
  it('con monto 50 en PMP, PMP-02 cumple y la respuesta lo declara', async () => {
    const m = montar({ bd: { oficina_v_posiciones: [], trade_executions: [] } });
    const r = await m.ejecutar({ ticker: 'GKOS', guardar: true, portafolio: 'PMP', monto: 50 });
    expect(r.cuerpo['monto_declarado']).toBe('50');
    expect(pmp(r)).toBeDefined();
    expect(reglaPmp02(m)?.resultado).toBe('cumple');
  });
  it('con monto 25 en PMP, PMP-02 incumple (el Auditor compara con USD 50)', async () => {
    const m = montar({ bd: { oficina_v_posiciones: [], trade_executions: [] } });
    await m.ejecutar({ ticker: 'GKOS', guardar: true, portafolio: 'PMP', monto: 25 });
    expect(reglaPmp02(m)?.resultado).toBe('incumple');
  });
  it('sin monto, PMP-02 queda NO_EVALUABLE por monto_no_declarado y monto_declarado es null', async () => {
    const m = montar({ bd: { oficina_v_posiciones: [], trade_executions: [] } });
    const r = await m.ejecutar({ ticker: 'GKOS', guardar: true, portafolio: 'PMP' });
    expect(r.cuerpo['monto_declarado']).toBeNull();
    expect(reglaPmp02(m)).toMatchObject({ resultado: 'no_evaluable', motivo: 'monto_no_declarado' });
  });
});

describe('v0.27: Riesgo y Capital por código en la corrida guardada', () => {
  const rc = (r: Awaited<ReturnType<ReturnType<typeof montar>['ejecutar']>>) => r.cuerpo['riesgo_capital'] as Record<string, unknown>;
  const motivos = (r: Awaited<ReturnType<ReturnType<typeof montar>['ejecutar']>>) => (r.cuerpo['motivos'] as { codigo: string; detalle: string }[]).map(x => `${x.codigo}:${x.detalle}`);
  it('con efectivo 100 (fixture) y monto 50: VIABLE, no llama a ningún modelo para ello y ya no falla como agente requerido', async () => {
    const m = montar({ bd: { oficina_v_posiciones: [], trade_executions: [] } });
    const r = await m.ejecutar({ ticker: 'GKOS', guardar: true, portafolio: 'PMP', monto: 50 });
    expect(rc(r)).toMatchObject({ estado: 'ok', origen: 'codigo', veredicto: 'VIABLE', efectivo_disponible: '100', monto_requerido: '50' });
    expect(motivos(r).join(' ')).not.toMatch(/riesgo_capital: error/);
  });
  it('con efectivo menor al monto: NO_VIABLE con el faltante', async () => {
    const m = montar({ bd: { oficina_v_posiciones: [], trade_executions: [], oficina_v_capital: [{ portfolio_id: PF, efectivo: 10, posiciones_abiertas: 3 }] } });
    const r = await m.ejecutar({ ticker: 'GKOS', guardar: true, portafolio: 'PMP', monto: 50 });
    expect(rc(r)).toMatchObject({ veredicto: 'NO_VIABLE', faltante: '40' });
  });
  it('sin monto: DATOS_INSUFICIENTES y no se supone ninguno', async () => {
    const m = montar({ bd: { oficina_v_posiciones: [], trade_executions: [] } });
    const r = await m.ejecutar({ ticker: 'GKOS', guardar: true, portafolio: 'PMP' });
    expect(rc(r)).toMatchObject({ veredicto: 'DATOS_INSUFICIENTES', monto_requerido: null });
  });
  it('si no se puede leer oficina_v_capital la corrida sigue y lo declara como aviso (no bloquea)', async () => {
    const m = montar({ bd: { oficina_v_posiciones: [], trade_executions: [] }, errores: { tablas: { oficina_v_capital: 'sin permiso' } } });
    const r = await m.ejecutar({ ticker: 'GKOS', guardar: true, portafolio: 'PMP', monto: 50 });
    expect(rc(r)).toMatchObject({ veredicto: 'DATOS_INSUFICIENTES' });
    expect(rc(r)['avisos']).toEqual(expect.arrayContaining([expect.stringContaining('sin permiso')]));
  });
});
