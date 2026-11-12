// Pruebas de la v0.31: plan de salidas de PMP en la corrida guardada (posición abierta).
import { describe, expect, it } from 'vitest';
import { ejecutarAnalisisGuardado } from './index';
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


const TRADE = (extra: Fila = {}): Fila => ({ id: 't-1', take_profit_1: 0.01, take_profit_2: 99999, take_profit_3: null, tp1_hit: false, tp2_hit: false, tp3_hit: false, ...extra });
const bdAbierta = (trade: Fila[] = [TRADE()], ej: Fila[] = [COMPRA]) => ({ oficina_v_posiciones: [POSICION], trade_executions: ej, oficina_expedientes: [EXPEDIENTE], trades: trade });
const corridaRpc = (m: ReturnType<typeof montar>) => {
  const a = m.b.e.rpc[0]?.args ?? {};
  const f = Object.values(a).find(v => typeof v === 'object' && v !== null && !Array.isArray(v) && 'referencias' in (v as object)) as Fila | undefined;
  return f;
};

describe('v0.31: plan de salidas de PMP en la corrida guardada', () => {
  it('posición PMP abierta con el precio sobre TP1: la corrida pide REDUCIR 25% y deja el plan en referencias', async () => {
    const m = montar({ bd: bdAbierta() });
    const r = await m.ejecutar();
    expect(r.cuerpo['tipo_evaluacion']).toBe('posicion_abierta');
    const f = corridaRpc(m);
    expect(f).toBeDefined();
    expect((f?.['referencias'] as Fila)['salida_pmp']).toMatchObject({ total_salidas: 2, hechas: 0, siguiente: 1, motivo: 'nivel_planeado' });
    expect(f?.['decision']).toBe('REDUCIR');
  });
  it('lee solo trades y trade_executions del trade de la posición (nunca escribe en ellas)', async () => {
    const m = montar({ bd: bdAbierta() });
    await m.ejecutar();
    expect(m.b.e.filtros['trades']?.[0]).toEqual([['id', 't-1']]);
    expect(m.b.e.inserts.some(i => i.tabla === 'trades' || i.tabla === 'trade_executions')).toBe(false);
  });
  it('con TP1 inalcanzable y sin confirmaciones: no hay salida', async () => {
    const m = montar({ bd: bdAbierta([TRADE({ take_profit_1: 999999 })]) });
    await m.ejecutar();
    const ref = (corridaRpc(m)?.['referencias'] as Fila)['salida_pmp'] as Fila | undefined;
    expect(ref).toBeDefined();
    expect(ref?.['exigida']).toBeNull();
  });
  it('si no se puede leer el trade: 422, no se llama a ningún modelo y no se escribe nada', async () => {
    const m = montar({ bd: bdAbierta([]) });
    const r = await m.ejecutar();
    expect(r.http).toBe(422);
    expect(JSON.stringify(r.cuerpo)).toContain('salida_pmp');
    expect(m.m.peticiones.length).toBe(0);
    expect(m.b.e.inserts).toHaveLength(0);
  });
  it('error de la base al leer trades: 422 con el mensaje de la base', async () => {
    const m = montar({ bd: bdAbierta(), errores: { tablas: { trades: 'sin permiso' } } });
    const r = await m.ejecutar();
    expect(r.http).toBe(422);
    expect(JSON.stringify(r.cuerpo)).toContain('sin permiso');
    expect(m.m.peticiones.length).toBe(0);
  });
  it('una entrada nueva (sin posición) no lee trades', async () => {
    const m = montar({ bd: { oficina_v_posiciones: [], trade_executions: [] } });
    await m.ejecutar();
    expect(m.b.e.filtros['trades']).toBeUndefined();
  });
});
