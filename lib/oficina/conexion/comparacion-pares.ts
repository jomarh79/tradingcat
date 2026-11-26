// Comparación del ticker analizado contra sus competidores de la watchlist (v0.92). Todo por código: los datos son los ratios de Finnhub (stock/metric) de cada
// empresa; el ranking y la sugerencia no los decide ningún modelo. Un dato que el proveedor no trae queda «sin dato» (no se rellena ni se estima) y esa
// métrica no entra al ranking de esa empresa. Solo lectura y solo informativo: no cambia ninguna decisión ni compra nada.
import { FINNHUB_CABECERA_CLAVE, FINNHUB_URL_BASE } from '../agentes-ia/constantes';
import { leer } from '../agentes-ia/datos-reales';
import type { DepsDatosReales } from '../agentes-ia/datos-reales';
import { obtenerCotizacionVivo } from './cotizacion-vivo';
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

export type FuenteMetrica = 'webull' | 'finnhub';
export interface EmpresaComparada { ticker: string; metricas: MetricasEmpresa; /** De dónde salió cada métrica (opcional; null = sin dato). */ fuentes?: Record<IdMetrica, FuenteMetrica | null> }
export interface PuntajeEmpresa { ticker: string; puntaje: number | null; metricas_con_dato: number; rank_promedio: number | null }
export interface ComparacionPares {
  principal: string;
  tickers: string[];
  metricas: Array<{ id: IdMetrica; etiqueta: string; unidad: 'x' | '%'; mejor: 'menor' | 'mayor'; valores: Record<string, number | null>; fuentes: Record<string, FuenteMetrica | null>; mejor_ticker: string | null }>;
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
    const fuentes: Record<string, FuenteMetrica | null> = {};
    for (const e of empresas) { valores[e.ticker] = e.metricas[d.id]; fuentes[e.ticker] = e.metricas[d.id] === null ? null : (e.fuentes?.[d.id] ?? null); }
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
    filasMetricas.push({ id: d.id, etiqueta: d.etiqueta, unidad: d.unidad, mejor: d.mejor, valores, fuentes, mejor_ticker: n >= 2 ? con[0]!.t : null });
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

// ---- Webull primero (decisión de Jaime, 25-nov): P/E, Forward P/E, márgenes y crecimiento salen de las rutas internas de Webull cuando traen el dato;
// Finnhub solo completa lo que Webull no trae (ROE, deuda/capital y EV/EBITDA necesitan balance, que Webull no tiene) o lo que le falte.
const numW = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Métricas que se pueden sacar de Webull: income-statement ({ttm, annual[], forwardEps}) y /api/fundamentals ({pe}). `precio` solo hace falta para el Forward P/E (y el P/E si Webull no trae `pe`). */
export function extraerMetricasWebull(income: unknown, fundamentals: unknown, precio: number | null): Partial<MetricasEmpresa> {
  const out: Partial<MetricasEmpresa> = {};
  const ij = esObj(income) ? income : {};
  const ttm = esObj(ij['ttm']) ? ij['ttm'] : {};
  const rev = numW(ttm['revenue']);
  const op = numW(ttm['opIncome']);
  const neto = numW(ttm['netIncome']);
  if (rev !== null && rev > 0 && op !== null) out.margen_operativo = (op / rev) * 100;
  if (rev !== null && rev > 0 && neto !== null) out.margen_neto = (neto / rev) * 100;
  const anual = (Array.isArray(ij['annual']) ? ij['annual'] : []).filter(esObj).filter(a => numW(a['revenue']) !== null && typeof a['endDate'] === 'string')
    .sort((a, b) => String(a['endDate']).localeCompare(String(b['endDate'])));
  if (anual.length >= 2) {
    const nuevo = numW(anual[anual.length - 1]!['revenue']) as number;
    const viejo = numW(anual[anual.length - 2]!['revenue']) as number;
    if (viejo > 0) out.crecimiento_ventas = ((nuevo - viejo) / viejo) * 100;
  }
  const fj = esObj(fundamentals) ? fundamentals : {};
  const pe = numW(fj['pe']);
  const epsTtm = numW(ttm['dilutedEps']);
  if (pe !== null && pe > 0) out.pe = pe;
  else if (precio !== null && epsTtm !== null && epsTtm > 0) out.pe = precio / epsTtm;
  const fwd = esObj(ij['forwardEps']) ? numW(ij['forwardEps']['eps']) : null;
  if (precio !== null && fwd !== null && fwd > 0) out.pe_forward = precio / fwd;
  return out;
}

/** Une las dos fuentes: Webull manda cuando trae el dato; Finnhub completa el resto. Nunca se rellena con estimaciones. */
export function unirFuentes(webull: Partial<MetricasEmpresa>, finnhub: MetricasEmpresa | null): { metricas: MetricasEmpresa; fuentes: Record<IdMetrica, FuenteMetrica | null> } {
  const metricas = {} as MetricasEmpresa;
  const fuentes = {} as Record<IdMetrica, FuenteMetrica | null>;
  for (const d of METRICAS_PARES) {
    const w = webull[d.id];
    const wOk = typeof w === 'number' && Number.isFinite(w) && !(d.solo_positivo && w <= 0);
    if (wOk) { metricas[d.id] = w; fuentes[d.id] = 'webull'; }
    else if (finnhub !== null && finnhub[d.id] !== null) { metricas[d.id] = finnhub[d.id]; fuentes[d.id] = 'finnhub'; }
    else { metricas[d.id] = null; fuentes[d.id] = null; }
  }
  return { metricas, fuentes };
}

async function leerEmpresa(deps: DepsDatosReales, t: string, avisos: string[]): Promise<EmpresaComparada | null> {
  const s = encodeURIComponent(t);
  const web = { Accept: 'application/json', Authorization: deps.authorization };
  const fin = { Accept: 'application/json', [FINNHUB_CABECERA_CLAVE]: deps.finnhub_key };
  const [inc, fun, met] = await Promise.all([
    leer(deps, `${deps.origen}/api/webull/income-statement?symbol=${s}`, web),
    leer(deps, `${deps.origen}/api/fundamentals?symbol=${s}`, web),
    leer(deps, `${FINNHUB_URL_BASE}/stock/metric?symbol=${s}&metric=all`, fin),
  ]);
  if (!inc.ok) avisos.push(`${t}: Webull income-statement ${inc.motivo}`);
  if (!fun.ok) avisos.push(`${t}: Webull fundamentals ${fun.motivo}`);
  if (!met.ok) avisos.push(`${t}: Finnhub stock/metric ${met.motivo}`);
  if (!inc.ok && !fun.ok && !met.ok) { avisos.push(`${t}: sin datos de ninguna fuente; queda fuera de la comparación`); return null; }
  // El precio solo se pide si hace falta (Forward P/E, o P/E cuando Webull no trae `pe`)
  const incJ = inc.ok ? inc.json : null;
  const funJ = fun.ok ? fun.json : null;
  const necesitaPrecio = (esObj(incJ) && esObj(incJ['forwardEps'])) || !(esObj(funJ) && numW(funJ['pe']) !== null);
  const q = necesitaPrecio ? await obtenerCotizacionVivo(deps, t) : null;
  const w = extraerMetricasWebull(incJ, funJ, q === null ? null : Number(q.precio));
  const u = unirFuentes(w, met.ok ? extraerMetricas(met.json) : null);
  return { ticker: t, metricas: u.metricas, fuentes: u.fuentes };
}

export async function obtenerComparacionPares(deps: DepsDatosReales, principal: string, competidores: string | null | undefined): Promise<ComparacionPares | null> {
  const pares = parsearCompetidores(competidores, principal);
  if (pares.length === 0) return null;
  const empresas: EmpresaComparada[] = [];
  const avisos: string[] = [];
  for (const t of [principal, ...pares]) {
    const e = await leerEmpresa(deps, t, avisos);
    if (e !== null) empresas.push(e);
  }
  if (!empresas.some(e => e.ticker === principal) || empresas.length < 2) return { ...compararPares(principal, empresas), avisos: [...avisos, 'No hay suficientes empresas con datos para comparar'] };
  const c = compararPares(principal, empresas);
  const sinDato = METRICAS_PARES.filter(d => empresas.every(e => e.metricas[d.id] === null)).map(d => d.etiqueta);
  if (sinDato.length > 0) avisos.push(`Ninguna fuente (Webull ni Finnhub) trae para ninguna empresa: ${sinDato.join(', ')}`);
  return { ...c, avisos: [...avisos, ...c.avisos] };
}
