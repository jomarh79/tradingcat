// Pruebas de la v0.35: la Oficina lee rol, negocio (Notas), competidores y portafolios de la watchlist.
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
  '/api/dividends': { dividends: [{ date: '2026-03-31', amount: 0.5 }, { date: '2026-06-30', amount: 0.55 }] },
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


const WL = (x: Fila = {}): Fila => ({ id: 'w1', ticker: 'GKOS', rol: 'mixto', portafolios: ['PMP'], competidores: 'BLCO', notes: 'Oftalmología', ...x });
const avisosDe = (m: ReturnType<typeof montar>) => ((corridaRpc(m)?.['referencias'] as Fila)['avisos'] as string[] | undefined) ?? [];

describe('v0.35: watchlist en la corrida guardada', () => {
  it('la watchlist se consulta por ticker y el rol/ficha llegan al Auditor sin avisos si todo está marcado', async () => {
    const m = montar({ bd: { ...bdAbierta(), watchlist: [WL()] } });
    const r = await m.ejecutar();
    expect(r.http).toBe(200);
    expect(m.b.e.filtros['watchlist']).toEqual([[['ticker', 'GKOS']]]);
    expect(avisosDe(m).filter(a => a.startsWith('watchlist'))).toEqual([]);
  });
  it('portafolio no marcado: la corrida sigue (200) y queda el aviso', async () => {
    const m = montar({ bd: { ...bdAbierta(), watchlist: [WL({ portafolios: ['PCP'] })] } });
    const r = await m.ejecutar();
    expect(r.http).toBe(200);
    expect(avisosDe(m).join('|')).toMatch(/no tiene marcado PMP/);
  });
  it('ticker fuera de la watchlist: sigue y avisa', async () => {
    const m = montar({ bd: bdAbierta() });
    expect((await m.ejecutar()).http).toBe(200);
    expect(avisosDe(m).join('|')).toMatch(/no está en la watchlist/);
  });
  it('columnas aún no creadas (error de la base): la corrida sigue y lo declara', async () => {
    const m = montar({ bd: bdAbierta(), errores: { tablas: { watchlist: 'column watchlist.rol does not exist' } } });
    expect((await m.ejecutar()).http).toBe(200);
    expect(avisosDe(m).join('|')).toMatch(/watchlist.*no se usan rol, negocio ni competidores/);
  });
  it('solo lee la watchlist: nunca la escribe', async () => {
    const m = montar({ bd: { ...bdAbierta(), watchlist: [WL()] } });
    await m.ejecutar();
    expect(m.b.e.inserts.some(i => i.tabla === 'watchlist')).toBe(false);
  });
  it('v0.36: la corrida de PMP deja el borrador de la ficha en referencias (identidad con rol y negocio de la watchlist)', async () => {
    const m = montar({ bd: { ...bdAbierta(), watchlist: [WL()] } });
    await m.ejecutar();
    const f = (corridaRpc(m)?.['referencias'] as Fila)['ficha_propuesta'] as { propuesta: Record<string, { texto: string }>; no_propuestos: string[] };
    expect(f.propuesta['identidad']?.texto).toBe('GKOS · mercado US · portafolio PMP · rol mixto · negocio: Oftalmología');
    expect(f.propuesta['indices_referencia']).toBeDefined();
    expect(f.propuesta['plan_ejecucion']).toBeDefined();
    expect(f.propuesta['dividendos_fundamentales']?.texto).toMatch(/^2 pagos en los últimos 10 años.*último pago \$0\.550 el 2026-06-30.*Fundamentales: /);
    expect(f.propuesta['correlacion']?.texto).toMatch(/^Correlación de los retornos diarios con SPY .*QQQ .*DIA .*QUAL /);
    expect(f.no_propuestos).toEqual([]);
  });
});
