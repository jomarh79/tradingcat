import { describe, expect, it } from 'vitest';
import { compararPares, extraerMetricas, parsearCompetidores, obtenerComparacionPares } from './comparacion-pares';
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
  it('sin competidores no consulta nada; con ellos lee los ratios de cada empresa y declara a la que falla', async () => {
    const pedidos: string[] = [];
    const fetchFn = (async (url: string) => {
      pedidos.push(url);
      if (url.includes('symbol=BAD')) return { ok: false, status: 500, json: async () => ({}) };
      const n = url.includes('symbol=AAA') ? 20 : 10;
      return { ok: true, status: 200, json: async () => ({ metric: { peTTM: n, forwardPE: n, 'currentEv/ebitdaTTM': n, operatingMarginTTM: 100 - n, netProfitMarginTTM: 100 - n, roeTTM: 100 - n, revenueGrowthTTMYoy: 100 - n, 'totalDebt/totalEquityQuarterly': n / 10 } }) };
    }) as never;
    const deps = { fetchFn, origen: 'http://x', authorization: 'Bearer x', finnhub_key: 'k' };
    expect(await obtenerComparacionPares(deps, 'AAA', null)).toBeNull();
    expect(pedidos).toHaveLength(0);
    const c = await obtenerComparacionPares(deps, 'AAA', 'BBB, BAD');
    expect(c?.tickers).toEqual(['AAA', 'BBB']);
    expect(c?.sugerencia?.ticker).toBe('BBB');
    expect(c?.avisos.join()).toContain('BAD');
  });
});
