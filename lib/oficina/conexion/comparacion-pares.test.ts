import { describe, expect, it } from 'vitest';
import { compararPares, extraerMetricas, extraerMetricasWebull, parsearCompetidores, obtenerComparacionPares, unirFilasCoherentes, unirFuentes } from './comparacion-pares';
import type { EmpresaComparada, MetricasEmpresa } from './comparacion-pares';

const m = (pe: number | null, fwd: number | null, ev: number | null, mo: number | null, mn: number | null, roe: number | null, cr: number | null, de: number | null): MetricasEmpresa =>
  ({ pe, pe_forward: fwd, ev_ebitda: ev, margen_operativo: mo, margen_neto: mn, roe, crecimiento_ventas: cr, deuda_capital: de });
// La tabla del ejemplo de Jaime (puntos medios de los rangos)
const TABLA: EmpresaComparada[] = [
  { ticker: 'CLS', metricas: m(18, 9.5, 12.7, 8.32, 6.83, 30.23, 82.5, 0.17) },
  { ticker: 'JBL', metricas: m(24, 13, 11.3, 5.09, 2.9, 66.37, 28.6, 1.78) },
  { ticker: 'FLEX', metricas: m(25, 15.5, 15.4, 4.95, 3.32, 18.38, 12.3, 0.95) },
  { ticker: 'SANM', metricas: m(22.5, 9, 10.5, 5.0, 2.6, 15.06, 84, 0.9) },
  { ticker: 'FN', metricas: m(21.5, 17.5, 15.4, 10.04, 9.35, 21, 50.7, 0.03) },
];

describe('v0.92: comparación con pares (ranking promedio)', () => {
  it('con la tabla del ejemplo, CLS ordena mejor que FLEX y que JBL; FLEX queda al final', () => {
    const c = compararPares('FLEX', TABLA);
    const p = Object.fromEntries(c.puntajes.map(x => [x.ticker, x.puntaje as number]));
    expect(p['FLEX']).toBeGreaterThan(p['CLS']!);
    expect(p['FLEX']).toBeGreaterThan(p['FN']!);
    expect(c.sugerencia?.ticker).toBeDefined();
    expect(c.sugerencia!.metricas_comparables).toBe(8);
    expect(c.sugerencia!.texto).toContain('FLEX');
  });
  it('el mejor en cada métrica se marca según su dirección (menor en múltiplos y deuda; mayor en márgenes, ROE y crecimiento)', () => {
    const c = compararPares('CLS', TABLA);
    const mejor = (id: string) => c.metricas.find(x => x.id === id)!.mejor_ticker;
    expect(mejor('pe')).toBe('CLS');
    expect(mejor('pe_forward')).toBe('SANM');
    expect(mejor('margen_operativo')).toBe('FN');
    expect(mejor('roe')).toBe('JBL');
    expect(mejor('crecimiento_ventas')).toBe('SANM');
    expect(mejor('deuda_capital')).toBe('FN');
  });
  it('si el ticker ya es el mejor no hay sugerencia', () => {
    const c = compararPares('CLS', TABLA.filter(e => e.ticker === 'CLS' || e.ticker === 'FLEX'));
    expect(c.sugerencia).toBeNull();
  });
  it('un par que no supera al ticker por el margen no se sugiere (empate)', () => {
    const igual = { ticker: 'A', metricas: m(10, 10, 10, 10, 10, 10, 10, 1) };
    expect(compararPares('A', [igual, { ...igual, ticker: 'B' }]).sugerencia).toBeNull();
  });
  it('lo que el proveedor no trae queda sin dato, no entra al ranking y con menos de 4 métricas no se ordena', () => {
    const c = compararPares('X', [{ ticker: 'X', metricas: m(null, null, null, null, 5, 10, null, null) }, { ticker: 'Y', metricas: m(10, 10, 10, 10, 10, 10, 10, 1) }]);
    expect(c.puntajes.find(p => p.ticker === 'X')).toMatchObject({ puntaje: null, metricas_con_dato: 2 });
    expect(c.sugerencia).toBeNull();
    expect(c.avisos.join()).toContain('menos de 4 métricas');
  });
  it('múltiplos con pérdidas (P/E ≤ 0) se tratan como sin dato', () => {
    const e = extraerMetricas({ metric: { peTTM: -5, forwardPE: 12, operatingMarginTTM: 8, 'totalDebt/totalEquityQuarterly': 0.5 } });
    expect(e.pe).toBeNull();
    expect(e.pe_forward).toBe(12);
    expect(e.margen_operativo).toBe(8);
    expect(e.deuda_capital).toBe(0.5);
    expect(e.roe).toBeNull();
  });
  it('parsea la casilla de competidores: sin repetidos, sin el propio ticker, máximo 4', () => {
    expect(parsearCompetidores('jbl, FLEX; SANM FN JBL CLS XYZ', 'CLS')).toEqual(['JBL', 'FLEX', 'SANM', 'FN']);
    expect(parsearCompetidores(null, 'CLS')).toEqual([]);
  });
  it('Webull manda: márgenes, crecimiento, P/E y Forward P/E salen de Webull; Finnhub solo completa (ROE, deuda/capital, EV/EBITDA)', () => {
    const inc = { success: true, ttm: { revenue: 1000, opIncome: 100, netIncome: 80, dilutedEps: 4 }, annual: [{ endDate: '2024-12-31', revenue: 800 }, { endDate: '2025-12-31', revenue: 1000 }], forwardEps: { eps: 5 } };
    const w = extraerMetricasWebull(inc, { pe: 22 }, 50);
    expect(w).toMatchObject({ margen_operativo: 10, margen_neto: 8, crecimiento_ventas: 25, pe: 22, pe_forward: 10 });
    expect(w.roe).toBeUndefined();
    const fin = extraerMetricas({ metric: { peTTM: 99, operatingMarginTTM: 1, roeTTM: 30, 'totalDebt/totalEquityQuarterly': 0.4, 'currentEv/ebitdaTTM': 12 } });
    const u = unirFuentes(w, fin);
    expect(u.metricas).toMatchObject({ pe: 22, margen_operativo: 10, roe: 30, deuda_capital: 0.4, ev_ebitda: 12 });
    expect(u.fuentes).toMatchObject({ pe: 'webull', margen_operativo: 'webull', roe: 'finnhub', deuda_capital: 'finnhub', ev_ebitda: 'finnhub' });
  });
  it('sin P/E de Webull se calcula con el precio y el EPS TTM; sin precio no se inventa', () => {
    const inc = { ttm: { revenue: 100, dilutedEps: 4 }, annual: [] };
    expect(extraerMetricasWebull(inc, {}, 40).pe).toBe(10);
    expect(extraerMetricasWebull(inc, {}, null).pe).toBeUndefined();
    expect(extraerMetricasWebull({ ttm: { dilutedEps: -1 } }, {}, 40).pe).toBeUndefined();
  });
  it('sin competidores no consulta nada; con ellos lee Webull y Finnhub de cada empresa y declara a la que falla', async () => {
    const pedidos: string[] = [];
    const ok = (j: unknown) => ({ ok: true, status: 200, json: async () => j });
    const fetchFn = (async (url: string) => {
      pedidos.push(url);
      if (url.includes('symbol=BAD')) return { ok: false, status: 500, json: async () => ({}) };
      const n = url.includes('symbol=AAA') ? 20 : 10;
      if (url.includes('/api/webull/income-statement')) return ok({ success: true, ttm: { revenue: 1000, opIncome: (100 - n) * 10, netIncome: (100 - n) * 10, dilutedEps: 5 }, annual: [{ endDate: '2024-12-31', revenue: 1000 - (100 - n) * 5 }, { endDate: '2025-12-31', revenue: 1000 }], forwardEps: { eps: 5 } });
      if (url.includes('/api/fundamentals')) return ok({ pe: n });
      if (url.includes('/quote')) return ok({ c: n * 5, pc: n * 5 });
      return ok({ metric: { roeTTM: 100 - n, 'totalDebt/totalEquityQuarterly': n / 10, 'currentEv/ebitdaTTM': n } });
    }) as never;
    const deps = { fetchFn, origen: 'http://x', authorization: 'Bearer x', finnhub_key: 'k' };
    expect(await obtenerComparacionPares(deps, 'AAA', null)).toBeNull();
    expect(pedidos).toHaveLength(0);
    const c = await obtenerComparacionPares(deps, 'AAA', 'BBB, BAD');
    expect(c?.tickers).toEqual(['AAA', 'BBB']);
    expect(c?.sugerencia?.ticker).toBe('BBB');
    expect(c?.metricas.find(x => x.id === 'margen_operativo')?.fuentes['AAA']).toBe('webull');
    expect(c?.metricas.find(x => x.id === 'roe')?.fuentes['AAA']).toBe('finnhub');
    expect(c?.avisos.join()).toContain('BAD');
    expect(pedidos.some(u => u.includes('/api/webull/income-statement?symbol=AAA'))).toBe(true);
  });
  it('v0.94: una fila usa la misma fuente en todas las empresas (Webull si todas; si no, Finnhub si todas; si no, mezcla con aviso)', () => {
    const fin = (mo: number | null): MetricasEmpresa => m(10, 10, null, mo, 10, 10, 10, 1);
    const w = (mo?: number): Partial<MetricasEmpresa> => (mo === undefined ? { pe: 10 } : { pe: 10, margen_operativo: mo });
    // GS y MS tienen margen operativo en Webull; BAC no → toda la fila sale de Finnhub
    const r = unirFilasCoherentes([{ ticker: 'GS', webull: w(19), finnhub: fin(20) }, { ticker: 'MS', webull: w(20), finnhub: fin(21) }, { ticker: 'BAC', webull: w(), finnhub: fin(32) }]);
    expect(r.empresas.map(e => e.metricas.margen_operativo)).toEqual([20, 21, 32]);
    expect(r.empresas.every(e => e.fuentes!.margen_operativo === 'finnhub')).toBe(true);
    expect(r.empresas.every(e => e.fuentes!.pe === 'webull')).toBe(true);
    // si Finnhub tampoco cubre a todas: Webull primero y mezcla con aviso
    const r2 = unirFilasCoherentes([{ ticker: 'A', webull: w(5), finnhub: fin(null) }, { ticker: 'B', webull: w(), finnhub: fin(7) }, { ticker: 'C', webull: w(), finnhub: fin(null) }]);
    expect(r2.empresas.map(e => e.fuentes!.margen_operativo)).toEqual(['webull', 'finnhub', null]);
    expect(r2.avisos.join()).toContain('Margen operativo');
  });
  it('v0.94: en una financiera, EV/EBITDA, deuda/capital y margen operativo se muestran pero no entran al ranking', () => {
    const e = (t: string, de: number, mo: number, roe: number): EmpresaComparada => ({ ticker: t, metricas: m(10, 10, 20, mo, 10, roe, 5, de) });
    // BAC gana solo en deuda y margen operativo; GS gana en ROE
    const empresas = [e('GS', 11, 20, 18), e('BAC', 2, 33, 10)];
    const normal = compararPares('GS', empresas);
    const fin = compararPares('GS', empresas, { financiera: true });
    expect(normal.sugerencia?.ticker).toBe('BAC');
    expect(fin.metricas.find(x => x.id === 'deuda_capital')).toMatchObject({ en_ranking: false, mejor_ticker: null });
    expect(fin.metricas.find(x => x.id === 'roe')?.en_ranking).toBe(true);
    expect(fin.puntajes.find(p => p.ticker === 'GS')!.metricas_con_dato).toBeLessThan(normal.puntajes.find(p => p.ticker === 'GS')!.metricas_con_dato);
    expect(fin.sugerencia).toBeNull();
  });
  it('v0.95: si varios pares superan al ticker, la sugerencia los lista a todos (empate incluido)', () => {
    const e = (t: string, roe: number, mn: number): EmpresaComparada => ({ ticker: t, metricas: m(10, 10, null, null, mn, roe, 5, null) });
    const c = compararPares('GS', [e('GS', 1, 1), e('BAC', 9, 9), e('JPM', 9, 9), e('MS', 0.5, 0.5)]);
    expect(c.sugerencia?.pares.map(p => p.ticker).sort()).toEqual(['BAC', 'JPM']);
    expect(c.sugerencia?.texto).toContain('BAC');
    expect(c.sugerencia?.texto).toContain('JPM');
    expect(c.sugerencia?.texto).toContain('Ordenan mejor que GS');
  });
  it('v0.95: deuda/capital exactamente 0 se toma como sin dato (emisores extranjeros como PDD o SAN); 0.03 sí cuenta', () => {
    expect(extraerMetricas({ metric: { 'totalDebt/totalEquityQuarterly': 0 } }).deuda_capital).toBeNull();
    expect(extraerMetricas({ metric: { 'totalDebt/totalEquityQuarterly': 0.03 } }).deuda_capital).toBe(0.03);
  });
});
