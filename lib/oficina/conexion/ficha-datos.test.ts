import { describe, expect, it } from 'vitest';
import { proponerFichaPmp, resumenFundamentalPmp, textoCorrelacion, textoDividendos } from './ficha-propuesta';
import type { DatosFichaExtra } from './ficha-propuesta';
import { extraerDividendos } from '../agentes-ia/datos-dividendos';
import type { Candle } from '../tecnico';

const DIA = 86400;
const T0 = Date.UTC(2025, 0, 1) / 1000;
const vela = (i: number, close: number): Candle => ({ time: T0 + i * DIA, open: close, high: close, low: close, close, volume: 1 });
/** precio con ruido determinista; k escala el ruido */
const ruido = (i: number) => Math.sin(i * 1.7) + Math.cos(i * 0.9);
const serie = (n: number, f: (i: number) => number): Candle[] => Array.from({ length: n }, (_, i) => vela(i, f(i)));
const pares = (v: Candle[]) => v.map(c => ({ fecha: new Date(c.time * 1000).toISOString().slice(0, 10), close: c.close }));

describe('resumenFundamentalPmp', () => {
  const income = { success: true, annual: [{ fiscalYear: 2024, revenue: 20e9, netIncome: 1e9 }, { fiscalYear: 2025, revenue: 22_938_469_000, netIncome: 1_578_149_000, currency: 'USD' }], ttm: { revenue: 30_319_420_000, opIncome: 2_477_000_000, netIncome: 1_756_615_000, currency: 'USD' } };
  it('arma ingresos, utilidad, márgenes y ratios con las cifras de la corrida', () => {
    expect(resumenFundamentalPmp(income, { metric: { currentRatioAnnual: 1.5837, quickRatioAnnual: 1.5564 } })).toBe(
      'ingresos TTM 30,319 M USD (FY2025: 22,938 M USD); utilidad neta TTM 1,757 M USD (FY2025: 1,578 M USD); margen operativo TTM 8.17%; margen neto TTM 5.79%; razón corriente 1.58; prueba ácida 1.56.');
  });
  it('sin TTM usa el último año; sin nada devuelve null; ignora valores no numéricos', () => {
    expect(resumenFundamentalPmp({ annual: [{ fiscalYear: 2025, revenue: 2e9, netIncome: 1e8 }], ttm: null }, null)).toBe('ingresos FY2025 2,000 M USD; utilidad neta FY2025 100 M USD; margen neto FY2025 5.00%.');
    expect(resumenFundamentalPmp(null, null)).toBeNull();
    expect(resumenFundamentalPmp({ annual: [], ttm: null }, { metric: {} })).toBeNull();
    expect(resumenFundamentalPmp({ ttm: { revenue: 'x' } }, { metric: { currentRatioAnnual: NaN } })).toBeNull();
  });
});

describe('textoDividendos', () => {
  const cierres = [{ fecha: '2026-01-02', close: 100 }, { fecha: '2026-04-02', close: 125 }, { fecha: '2026-07-02', close: 100 }];
  it('sin dividendos: lo dice; con dividendos: pagos, último, total y rendimiento sin anualizar', () => {
    expect(textoDividendos([], cierres)).toBe('Sin dividendos registrados en los últimos 10 años.');
    const t = textoDividendos([{ date: '2025-12-31', amount: 1 }, { date: '2026-03-31', amount: 1.25 }], cierres);
    expect(t).toContain('2 pagos en los últimos 10 años (desde 2025-12-31)');
    expect(t).toContain('último pago $1.250 el 2026-03-31; total acumulado $2.25 por acción');
    expect(t).toContain('hoy 1.25%, promedio 1.08%');   // (1/100, 1.25/125, 1.25/100) = 1, 1, 1.25 → hoy 1.25, promedio 1.083
  });
  it('los pagos del mismo día se suman y un dividendo posterior al último cierre no cuenta aún', () => {
    const t = textoDividendos([{ date: '2026-01-02', amount: 1 }, { date: '2026-01-02', amount: 1 }], cierres);
    expect(t).toContain('hoy 2.00%');
    expect(textoDividendos([{ date: '2027-01-01', amount: 1 }], cierres)).not.toContain('Rendimiento');
  });
});

describe('textoCorrelacion', () => {
  const base = serie(300, i => 100 + i * 0.1 + ruido(i));
  const idx = (f: (i: number) => number) => pares(serie(300, f));
  it('correlaciona retornos: misma serie = 1.00; serie independiente cerca de 0; faltantes se declaran', () => {
    const r = textoCorrelacion(pares(base), { SPY: pares(base), QQQ: idx(i => 100 + i * 0.1 + Math.sin(i * 3.1) * 2), DIA: null, QUAL: idx(() => 100) });
    expect(r.texto).toContain('SPY 1.00');
    expect(r.texto).toMatch(/QQQ -?0\.\d\d/);
    expect(r.texto).toContain('sin dato: DIA (sin velas), QUAL (sin variación)');
    expect(r.texto).toContain('hasta 252 días en común');
  });
  it('pocas fechas en común o ningún índice: no se propone', () => {
    const corta = pares(base).slice(0, 50);
    expect(textoCorrelacion(pares(base), { SPY: corta, QQQ: null, DIA: null, QUAL: null })).toMatchObject({ texto: null });
  });
});

describe('proponerFichaPmp con datos extra', () => {
  const velas = serie(300, i => 100 + i * 0.1 + ruido(i));
  const hoy = '2030-01-01';
  const extra = (o: Partial<DatosFichaExtra> = {}): DatosFichaExtra => ({
    dividendos: [], fundamentales: 'ingresos FY2025 1 M USD.', indices: { SPY: velas, QQQ: velas, DIA: velas, QUAL: velas }, ...o });
  it('con todo disponible propone los 8 apartados y no deja pendientes', () => {
    const r = proponerFichaPmp({ ticker: 'SE', hoy, velas, watchlist: null, extra: extra() });
    expect(Object.keys(r.propuesta).sort()).toEqual(['correlacion', 'decision_final', 'dividendos_fundamentales', 'identidad', 'indices_referencia', 'plan_ejecucion', 'rendimiento', 'volatilidad_riesgo']);
    expect(r.propuesta['dividendos_fundamentales']?.texto).toBe('Sin dividendos registrados en los últimos 10 años. Fundamentales: ingresos FY2025 1 M USD.');
    expect(r.no_propuestos).toEqual([]);
  });
  it('si no se pudieron consultar los dividendos NO se dice «sin dividendos»: se declara y no se propone', () => {
    const r = proponerFichaPmp({ ticker: 'SE', hoy, velas, watchlist: null, extra: extra({ dividendos: null, dividendos_error: 'HTTP 500' }) });
    expect(r.propuesta['dividendos_fundamentales']).toBeUndefined();
    expect(r.no_propuestos.join('|')).toContain('no se pudieron consultar los dividendos (HTTP 500)');
  });
  it('sin fundamentales o sin extra: no se propone y se declara', () => {
    expect(proponerFichaPmp({ ticker: 'SE', hoy, velas, watchlist: null, extra: extra({ fundamentales: null }) }).no_propuestos.join('|')).toContain('no hay datos de ingresos');
    const s = proponerFichaPmp({ ticker: 'SE', hoy, velas, watchlist: null });
    expect(s.propuesta['correlacion']).toBeUndefined();
    expect(s.no_propuestos.join('|')).toMatch(/dividendos_fundamentales:.*correlacion:/);
  });
});

describe('extraerDividendos', () => {
  it('acepta la forma de /api/dividends, normaliza fechas y descarta basura; lista vacía es válida', () => {
    expect(extraerDividendos({ dividends: [{ date: '2026-03-31T00:00:00Z', amount: '0.5' }, { date: 'x', amount: 1 }, { date: '2026-01-01', amount: -1 }, 7] })).toEqual({ ok: true, dividendos: [{ date: '2026-03-31', amount: 0.5 }] });
    expect(extraerDividendos({ dividends: [] })).toEqual({ ok: true, dividendos: [] });
  });
  it('un error o una respuesta rara NO es «sin dividendos»', () => {
    expect(extraerDividendos({ error: 'boom' }).ok).toBe(false);
    expect(extraerDividendos({}).ok).toBe(false);
    expect(extraerDividendos(null).ok).toBe(false);
  });
});
