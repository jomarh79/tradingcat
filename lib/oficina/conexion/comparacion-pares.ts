// Comparación del ticker analizado contra sus competidores de la watchlist (v0.92). Todo por código: los datos son los ratios de Finnhub (stock/metric) de cada
// empresa; el ranking y la sugerencia no los decide ningún modelo. Un dato que el proveedor no trae queda «sin dato» (no se rellena ni se estima) y esa
// métrica no entra al ranking de esa empresa. Solo lectura y solo informativo: no cambia ninguna decisión ni compra nada.
import { FINNHUB_CABECERA_CLAVE, FINNHUB_URL_BASE } from '../agentes-ia/constantes';
import { leer } from '../agentes-ia/datos-reales';
import type { DepsDatosReales } from '../agentes-ia/datos-reales';
import { limpiarTicker } from './corridas-lectura';

export type IdMetrica = 'pe' | 'pe_forward' | 'ev_ebitda' | 'margen_operativo' | 'margen_neto' | 'roe' | 'crecimiento_ventas' | 'deuda_capital';

export interface DefMetrica {
  id: IdMetrica;
  etiqueta: string;
  /** Claves de `metric` de Finnhub, en orden de preferencia (se toma la primera con número). */
  claves: readonly string[];
  /** Mejor = menor (múltiplos y deuda) o mayor (márgenes, ROE, crecimiento). */
  mejor: 'menor' | 'mayor';
  unidad: 'x' | '%';
  /** Los múltiplos con valor cero o negativo (pérdidas) no tienen significado: se tratan como sin dato. */
  solo_positivo: boolean;
}

export const METRICAS_PARES: readonly DefMetrica[] = [
  { id: 'pe', etiqueta: 'P/E (Trailing)', claves: ['peTTM', 'peBasicExclExtraTTM', 'peExclExtraTTM'], mejor: 'menor', unidad: 'x', solo_positivo: true },
  { id: 'pe_forward', etiqueta: 'Forward P/E', claves: ['forwardPE'], mejor: 'menor', unidad: 'x', solo_positivo: true },
  { id: 'ev_ebitda', etiqueta: 'EV / EBITDA', claves: ['currentEv/ebitdaTTM', 'evEbitdaTTM', 'enterpriseValueOverEBITDATTM'], mejor: 'menor', unidad: 'x', solo_positivo: true },
  { id: 'margen_operativo', etiqueta: 'Margen operativo', claves: ['operatingMarginTTM', 'operatingMarginAnnual'], mejor: 'mayor', unidad: '%', solo_positivo: false },
  { id: 'margen_neto', etiqueta: 'Margen neto', claves: ['netProfitMarginTTM', 'netProfitMarginAnnual'], mejor: 'mayor', unidad: '%', solo_positivo: false },
  { id: 'roe', etiqueta: 'ROE (retorno sobre capital)', claves: ['roeTTM', 'roeRfy'], mejor: 'mayor', unidad: '%', solo_positivo: false },
  { id: 'crecimiento_ventas', etiqueta: 'Crecimiento de ventas (YoY)', claves: ['revenueGrowthTTMYoy', 'revenueGrowthQuarterlyYoy'], mejor: 'mayor', unidad: '%', solo_positivo: false },
  { id: 'deuda_capital', etiqueta: 'Deuda / Capital', claves: ['totalDebt/totalEquityQuarterly', 'totalDebt/totalEquityAnnual'], mejor: 'menor', unidad: 'x', solo_positivo: false },
];

/** Mínimo de métricas con dato para poder ordenar a una empresa. */
export const MINIMO_METRICAS_RANKING = 4;
/** Un par solo se sugiere si su puntaje supera al del ticker por al menos esto (0 = empate, 1 = diferencia total). */
export const MARGEN_SUGERENCIA = 0.05;
export const MAX_PARES = 4;

export type MetricasEmpresa = Record<IdMetrica, number | null>;

const esNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const esObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Saca de la respuesta de `stock/metric` las 8 métricas; las que no vienen quedan null. */
export function extraerMetricas(json: unknown): MetricasEmpresa {
  const m = esObj(json) && esObj(json['metric']) ? json['metric'] : {};
  const out = {} as MetricasEmpresa;
  for (const d of METRICAS_PARES) {
    let v: number | null = null;
    for (const k of d.claves) { const x = m[k]; if (esNum(x)) { v = x; break; } }
    out[d.id] = v !== null && d.solo_positivo && v <= 0 ? null : v;
  }
  return out;
}

export interface EmpresaComparada { ticker: string; metricas: MetricasEmpresa }
export interface PuntajeEmpresa { ticker: string; puntaje: number | null; metricas_con_dato: number; rank_promedio: number | null }
export interface ComparacionPares {
  principal: string;
  tickers: string[];
  metricas: Array<{ id: IdMetrica; etiqueta: string; unidad: 'x' | '%'; mejor: 'menor' | 'mayor'; valores: Record<string, number | null>; mejor_ticker: string | null }>;
  puntajes: PuntajeEmpresa[];
  /** Par que ordena mejor que el ticker analizado; null si ninguno lo supera con claridad. */
  sugerencia: { ticker: string; puntaje: number; puntaje_principal: number; metricas_mejores: number; metricas_comparables: number; texto: string } | null;
  avisos: string[];
}

/** Ranking promedio: en cada métrica se ordena a las empresas con dato (1 = mejor; empates comparten el promedio de sus posiciones) y el puntaje
 *  de cada empresa es el promedio de su posición normalizada ((rank-1)/(n-1); 0 = siempre la mejor, 1 = siempre la peor). */
export function compararPares(principal: string, empresas: readonly EmpresaComparada[]): ComparacionPares {
  const tickers = empresas.map(e => e.ticker);
  const avisos: string[] = [];
  const normas: Record<string, number[]> = Object.fromEntries(tickers.map(t => [t, []]));
  const filasMetricas: ComparacionPares['metricas'] = [];
  for (const d of METRICAS_PARES) {
    const valores: Record<string, number | null> = {};
    for (const e of empresas) valores[e.ticker] = e.metricas[d.id];
    const con = empresas.filter(e => e.metricas[d.id] !== null).map(e => ({ t: e.ticker, v: e.metricas[d.id] as number }));
    con.sort((a, b) => (d.mejor === 'menor' ? a.v - b.v : b.v - a.v));
    const n = con.length;
    if (n >= 2) {
      let i = 0;
      while (i < n) {
        let j = i;
        while (j + 1 < n && con[j + 1]!.v === con[i]!.v) j++;
        const rank = (i + j) / 2 + 1;   // promedio de las posiciones empatadas
        for (let k = i; k <= j; k++) normas[con[k]!.t]!.push((rank - 1) / (n - 1));
        i = j + 1;
      }
    }
    filasMetricas.push({ id: d.id, etiqueta: d.etiqueta, unidad: d.unidad, mejor: d.mejor, valores, mejor_ticker: n >= 2 ? con[0]!.t : null });
  }
  const puntajes: PuntajeEmpresa[] = tickers.map(t => {
    const a = normas[t]!;
    const ok = a.length >= MINIMO_METRICAS_RANKING;
    const p = ok ? a.reduce((x, y) => x + y, 0) / a.length : null;
    return { ticker: t, puntaje: p, metricas_con_dato: a.length, rank_promedio: p };
  });
  const yo = puntajes.find(p => p.ticker === principal);
  let sugerencia: ComparacionPares['sugerencia'] = null;
  if (yo === undefined || yo.puntaje === null) avisos.push(`${principal}: menos de ${MINIMO_METRICAS_RANKING} métricas con dato; no se puede ordenar frente a sus pares`);
  else {
    const mejor = puntajes.filter(p => p.ticker !== principal && p.puntaje !== null).sort((a, b) => (a.puntaje as number) - (b.puntaje as number))[0];
    if (mejor !== undefined && (mejor.puntaje as number) <= yo.puntaje - MARGEN_SUGERENCIA) {
      let mejores = 0;
      let comparables = 0;
      for (const f of filasMetricas) {
        const a = f.valores[mejor.ticker];
        const b = f.valores[principal];
        if (a === null || a === undefined || b === null || b === undefined) continue;
        comparables++;
        if (f.mejor === 'menor' ? a < b : a > b) mejores++;
      }
      sugerencia = {
        ticker: mejor.ticker, puntaje: mejor.puntaje as number, puntaje_principal: yo.puntaje, metricas_mejores: mejores, metricas_comparables: comparables,
        texto: `${mejor.ticker} ordena mejor que ${principal} frente a sus pares (mejor en ${mejores} de ${comparables} métricas comparables): vale la pena revisarlo antes de comprar ${principal}. Es solo una sugerencia por ranking de métricas; no cambia la decisión de la Oficina.`,
      };
    }
  }
  return { principal, tickers, metricas: filasMetricas, puntajes, sugerencia, avisos };
}

/** Tickers de la casilla de competidores de la watchlist («ALC, BLCO SGHT»): sin repetidos, sin el propio ticker, máximo MAX_PARES. */
export function parsearCompetidores(texto: string | null | undefined, principal: string): string[] {
  if (typeof texto !== 'string') return [];
  const out: string[] = [];
  for (const parte of texto.split(/[\s,;/]+/)) {
    const t = limpiarTicker(parte);
    if (t !== '' && t !== principal && !out.includes(t)) out.push(t);
    if (out.length >= MAX_PARES) break;
  }
  return out;
}

export async function obtenerComparacionPares(deps: DepsDatosReales, principal: string, competidores: string | null | undefined): Promise<ComparacionPares | null> {
  const pares = parsearCompetidores(competidores, principal);
  if (pares.length === 0) return null;
  const cab = { Accept: 'application/json', [FINNHUB_CABECERA_CLAVE]: deps.finnhub_key };
  const empresas: EmpresaComparada[] = [];
  const avisos: string[] = [];
  for (const t of [principal, ...pares]) {
    const r = await leer(deps, `${FINNHUB_URL_BASE}/stock/metric?symbol=${encodeURIComponent(t)}&metric=all`, cab);
    if (!r.ok) { avisos.push(`${t}: no se pudieron leer sus ratios en Finnhub (${r.motivo}); queda fuera de la comparación`); continue; }
    empresas.push({ ticker: t, metricas: extraerMetricas(r.json) });
  }
  if (!empresas.some(e => e.ticker === principal) || empresas.length < 2) return { ...compararPares(principal, empresas), avisos: [...avisos, 'No hay suficientes empresas con datos para comparar'] };
  const c = compararPares(principal, empresas);
  const sinDato = METRICAS_PARES.filter(d => empresas.every(e => e.metricas[d.id] === null)).map(d => d.etiqueta);
  if (sinDato.length > 0) avisos.push(`Finnhub no trae para ninguna empresa: ${sinDato.join(', ')}`);
  return { ...c, avisos: [...avisos, ...c.avisos] };
}
