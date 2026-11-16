// «Modelos de valuación» de la página /position (ValuationModelsCard.tsx) llevados al servidor, con la MISMA fórmula, para que la revisión PMP-11 use el mismo
// número que ves en pantalla:
//   P/E objetivo = promedio de (cierre a la fecha de cada reporte anual ÷ EPS de ese año) [histórico]; si no hay, el P/E actual.
//   EPS a N años = con N = 1 y estimado de analistas (forwardEps de Webull): ese estimado; si no, EPS TTM × (1 + crecimiento histórico del EPS)^N,
//                  con el crecimiento = CAGR de ownHistory acotado entre 4% y 12% (4% si no se puede calcular).
//   Precio objetivo = EPS × P/E objetivo.   Ganancia anualizada = (objetivo ÷ precio)^(1/N) − 1.
// Fuentes (las mismas rutas internas de la tarjeta): /api/fundamentals, /api/webull/income-statement y POST /api/chart-data. Solo lectura.
import { leer, type DepsDatosReales } from '../agentes-ia/datos-reales';
import { TIMEOUT_DATOS_MS } from '../agentes-ia/constantes';

export const CRECIMIENTO_MINIMO = 0.04;
export const CRECIMIENTO_MAXIMO = 0.12;
export const ANIOS_POR_OMISION = 1;
export const ANIOS_MINIMO = 1;
export const ANIOS_MAXIMO = 10;

export interface EpsAnual { year: number; endDate: string; eps: number | null }
export interface CierreDiario { date: string; close: number }

const esObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const toMs = (d: string): number => Date.parse(`${String(d || '').split('T')[0]!.split(' ')[0]}T00:00:00Z`);
const cagr = (a: number, b: number, n: number): number | null => (a <= 0 || b <= 0 || n <= 0 ? null : Math.pow(b / a, 1 / n) - 1);
const acotar = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));

/** Cierre más cercano a la fecha (máx. 10 días de diferencia). `cierres` en orden cronológico. */
export function cierreCercano(cierres: readonly CierreDiario[], fecha: string): number | null {
  if (cierres.length === 0) return null;
  const objetivo = toMs(fecha);
  if (Number.isNaN(objetivo)) return null;
  let lo = 0; let hi = cierres.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (toMs(cierres[mid]!.date) < objetivo) lo = mid + 1; else hi = mid; }
  let mejor = cierres[lo]!;
  if (lo > 0 && Math.abs(toMs(cierres[lo - 1]!.date) - objetivo) <= Math.abs(toMs(mejor.date) - objetivo)) mejor = cierres[lo - 1]!;
  const dif = Math.abs(toMs(mejor.date) - objetivo);
  return Number.isNaN(dif) || dif > 10 * 86400000 ? null : mejor.close;
}

export interface EntradaValuacion {
  eps_ttm: number | null;
  eps_forward: number | null;
  pe_actual: number | null;
  historial: readonly EpsAnual[];
  cierres: readonly CierreDiario[];
  /** Precio contra el que se mide la ganancia (cierre actual). */
  precio: number | null;
  anios?: number;
}

export interface ResultadoValuacion {
  anios: number;
  pe_objetivo: number | null;
  origen_pe: 'histórico' | 'actual' | null;
  crecimiento_eps: number;
  eps: number | null;
  origen_eps: 'estimado real (analistas)' | 'proyectado (crecimiento histórico)' | null;
  precio_objetivo: number | null;
  ganancia_total_pct: number | null;
  ganancia_anualizada_pct: number | null;
  motivo: string | null;
}

export function calcularValuacion(e: EntradaValuacion): ResultadoValuacion {
  const anios = Number.isInteger(e.anios) && (e.anios as number) >= ANIOS_MINIMO && (e.anios as number) <= ANIOS_MAXIMO ? (e.anios as number) : ANIOS_POR_OMISION;
  const hist = e.historial.slice().sort((a, b) => a.year - b.year);
  const pes = hist.map(h => { const p = cierreCercano(e.cierres, h.endDate); return p && h.eps && h.eps > 0 ? p / h.eps : null; }).filter((v): v is number => v !== null);
  const peHist = pes.length > 0 ? pes.reduce((a, b) => a + b, 0) / pes.length : null;
  const peObjetivo = peHist || e.pe_actual || null;
  const origenPe = peHist ? 'histórico' : e.pe_actual ? 'actual' : null;

  const conEps = hist.filter(h => h.eps != null && h.eps > 0);
  const viejo = conEps[0]; const nuevo = conEps[conEps.length - 1];
  let crecimiento = CRECIMIENTO_MINIMO;
  if (viejo && nuevo && viejo !== nuevo) {
    const c = cagr(viejo.eps as number, nuevo.eps as number, nuevo.year - viejo.year);
    crecimiento = c != null ? acotar(c, CRECIMIENTO_MINIMO, CRECIMIENTO_MAXIMO) : CRECIMIENTO_MINIMO;
  }
  const usaForward = anios === 1 && e.eps_forward != null;
  const eps = usaForward ? e.eps_forward : e.eps_ttm != null ? e.eps_ttm * Math.pow(1 + crecimiento, anios) : null;
  const origenEps = eps == null ? null : usaForward ? 'estimado real (analistas)' : 'proyectado (crecimiento histórico)';
  const objetivo = eps != null && eps > 0 && peObjetivo ? eps * peObjetivo : null;
  const precio = e.precio != null && e.precio > 0 ? e.precio : null;
  const total = objetivo != null && precio != null ? ((objetivo - precio) / precio) * 100 : null;
  const anual = objetivo != null && precio != null ? (Math.pow(objetivo / precio, 1 / anios) - 1) * 100 : null;
  const motivo = objetivo != null && precio != null ? null
    : precio == null ? 'sin precio actual'
    : peObjetivo == null ? 'sin P/E (ni histórico ni actual)'
    : eps == null ? 'sin EPS (ni TTM ni estimado)'
    : 'el EPS proyectado no es positivo';
  return { anios, pe_objetivo: peObjetivo, origen_pe: origenPe, crecimiento_eps: crecimiento, eps, origen_eps: origenEps, precio_objetivo: objetivo, ganancia_total_pct: total, ganancia_anualizada_pct: anual, motivo };
}

/** Lee las tres fuentes de la tarjeta. Lo que no se pueda leer queda null (la valuación declara su motivo; nunca se rellena). */
export async function leerEntradaValuacion(deps: DepsDatosReales, ticker: string): Promise<{ entrada: Omit<EntradaValuacion, 'precio' | 'anios'>; avisos: string[] }> {
  const s = encodeURIComponent(ticker);
  const cab = { Accept: 'application/json', Authorization: deps.authorization };
  const avisos: string[] = [];
  const [f, inc, ch] = await Promise.all([
    leer(deps, `${deps.origen}/api/fundamentals?symbol=${s}`, cab),
    leer(deps, `${deps.origen}/api/webull/income-statement?symbol=${s}`, cab),
    postChart(deps, ticker),
  ]);
  if (!f.ok) avisos.push(`Valuación: /api/fundamentals ${f.motivo}`);
  if (!inc.ok) avisos.push(`Valuación: income-statement ${inc.motivo}`);
  if (!ch.ok) avisos.push(`Valuación: chart-data ${ch.motivo}`);
  const fj = f.ok && esObj(f.json) ? f.json : null;
  const ij = inc.ok && esObj(inc.json) ? inc.json : null;
  const cj = ch.ok && esObj(ch.json) ? ch.json : null;
  const historial: EpsAnual[] = [];
  for (const h of Array.isArray(fj?.['ownHistory']) ? (fj!['ownHistory'] as unknown[]) : []) {
    if (esObj(h) && num(h['year']) !== null && typeof h['endDate'] === 'string') historial.push({ year: h['year'] as number, endDate: h['endDate'], eps: num(h['eps']) });
  }
  const cierres: CierreDiario[] = [];
  for (const c of Array.isArray(cj?.['dailyCloses']) ? (cj!['dailyCloses'] as unknown[]) : []) {
    if (esObj(c) && typeof c['date'] === 'string' && num(c['close']) !== null) cierres.push({ date: c['date'], close: c['close'] as number });
  }
  const ttm = esObj(ij?.['ttm']) ? (ij!['ttm'] as Record<string, unknown>) : null;
  const fwd = esObj(ij?.['forwardEps']) ? (ij!['forwardEps'] as Record<string, unknown>) : null;
  return { entrada: { eps_ttm: num(ttm?.['dilutedEps']), eps_forward: num(fwd?.['eps']), pe_actual: num(fj?.['pe']), historial, cierres }, avisos };
}

async function postChart(deps: DepsDatosReales, ticker: string): Promise<{ ok: true; json: unknown } | { ok: false; motivo: string }> {
  try {
    const r = await deps.fetchFn(`${deps.origen}/api/chart-data`, {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: deps.authorization },
      body: JSON.stringify({ symbol: ticker }), signal: (deps.senalTiempo ?? AbortSignal.timeout.bind(AbortSignal))(TIMEOUT_DATOS_MS), redirect: 'manual', cache: 'no-store',
    });
    if (!r.ok) return { ok: false, motivo: `HTTP ${String(r.status)}` };
    return { ok: true, json: await r.json() };
  } catch (e) {
    const n = e instanceof Error ? e.name : '';
    return { ok: false, motivo: n === 'TimeoutError' || n === 'AbortError' ? 'tiempo agotado' : 'error de red o respuesta ilegible' };
  }
}
