// v0.74 (decisión de Jaime, 22-nov): ¿la acción pertenece a alguno de los índices de referencia: S&P 500 (SPY), Nasdaq-100 (QQQ), Dow Jones (DIA) o MSCI USA Quality (QUAL)?
//  - PMP: es OBLIGATORIO para comprar. Si no pertenece (o no se puede comprobar), la corrida no inicia y se sugiere pasarla a PCP.
//  - PCP: solo informativo. Si pertenece, se nombra el índice; si no, es una alerta.
// Lo que no se pueda leer queda como fallido: nunca se supone que pertenece ni que no.
import type { DepsDatosReales } from '../agentes-ia/datos-reales';
import { TIMEOUT_DATOS_MS } from '../agentes-ia/constantes';

// Fuentes gratuitas (sin clave): Finnhub cobra los constituyentes (HTTP 403), así que se leen de Wikipedia (S&P 500, Nasdaq-100, Dow) y del CSV de tenencias de iShares (QUAL).
export interface IndiceReferencia { id: string; nombre: string; etf: string; fuente: 'wikipedia' | 'ishares_csv'; url: string }
const WIKI = (pagina: string) => `https://en.wikipedia.org/w/api.php?action=parse&page=${pagina}&prop=text&format=json&formatversion=2&redirects=1`;
export const INDICES_MEMBRESIA: readonly IndiceReferencia[] = [
  { id: 'SPY', nombre: 'S&P 500', etf: 'SPY', fuente: 'wikipedia', url: WIKI('List_of_S%26P_500_companies') },
  { id: 'QQQ', nombre: 'Nasdaq-100', etf: 'QQQ', fuente: 'wikipedia', url: WIKI('Nasdaq-100') },
  { id: 'DIA', nombre: 'Dow Jones', etf: 'DIA', fuente: 'wikipedia', url: WIKI('Dow_Jones_Industrial_Average') },
  { id: 'QUAL', nombre: 'MSCI USA Quality (QUAL)', etf: 'QUAL', fuente: 'ishares_csv', url: 'https://www.ishares.com/us/products/256101/ishares-msci-usa-quality-factor-etf/1467271812596.ajax?fileType=csv&fileName=QUAL_holdings&dataType=fund' },
];
/** Mínimo de símbolos para creer una lista (una tabla recortada o una página rota no demuestra nada). */
export const MINIMO_SIMBOLOS: Record<IndiceReferencia['id'], number> = { SPY: 400, QQQ: 80, DIA: 25, QUAL: 80 };
/** Las listas cambian poco: se guardan en memoria 24 h. */
export const TTL_CACHE_MS = 24 * 3600 * 1000;

export type EstadoPertenencia = 'pertenece' | 'no_pertenece' | 'sin_datos';
export interface PertenenciaIndices {
  estado: EstadoPertenencia;
  /** Índices a los que pertenece (id del ETF de referencia). */
  indices: string[];
  /** Índices que se consultaron bien y donde NO está. */
  no_incluido_en: string[];
  fallidos: { indice: string; motivo: string }[];
  texto: string;
}

/** BRK-B, brk.b y BRK.B son el mismo símbolo. */
const norm = (s: unknown): string => String(s ?? '').trim().toUpperCase().replace(/-/g, '.');
const esSimbolo = (s: string): boolean => /^[A-Z]{1,5}(\.[A-Z])?$/.test(s);
const limpiarCelda = (h: string): string => h.replace(/<sup[\s\S]*?<\/sup>/gi, '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;|&#160;/g, ' ').trim();

/** De una página de Wikipedia (HTML), la columna «Symbol/Ticker» de la tabla con más símbolos. Puro. Null si no hay ninguna. */
export function simbolosDeHtml(html: string): Set<string> | null {
  let mejor: Set<string> | null = null;
  for (const t of html.match(/<table[\s\S]*?<\/table>/gi) ?? []) {
    const filas = t.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
    let col = -1; let inicio = 0;
    for (let i = 0; i < Math.min(filas.length, 3) && col < 0; i++) {
      const celdas = (filas[i]!.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) ?? []).map(limpiarCelda);
      col = celdas.findIndex(c => /^(symbol|ticker)/i.test(c));
      inicio = i + 1;
    }
    if (col < 0) continue;
    const set = new Set<string>();
    for (const f of filas.slice(inicio)) {
      const celdas = (f.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) ?? []).map(limpiarCelda);
      // «NYSE: MMM» o «MMM»: vale el último token con forma de símbolo.
      const v = (celdas[col] ?? '').split(/[\s:]+/).map(norm).filter(esSimbolo).pop();
      if (v !== undefined) set.add(v);
    }
    if (mejor === null || set.size > mejor.size) mejor = set;
  }
  return mejor !== null && mejor.size > 0 ? mejor : null;
}

/** Del CSV de tenencias de iShares, la columna Ticker. Puro. Null si no hay encabezado o filas. */
export function simbolosDeCsvIshares(csv: string): Set<string> | null {
  const lineas = csv.split(/\r?\n/);
  const ini = lineas.findIndex(l => /^"?Ticker"?,/i.test(l.trim()));
  if (ini < 0) return null;
  const set = new Set<string>();
  for (const l of lineas.slice(ini + 1)) {
    const v = norm(l.trim().replace(/^"/, '').split(/"?,/)[0]);
    if (esSimbolo(v)) set.add(v);
  }
  return set.size > 0 ? set : null;
}

/** Une los resultados de cada índice (true/false, o un motivo si falló). Puro. */
export function resolverPertenencia(resultados: readonly { indice: IndiceReferencia; pertenece: boolean | null; motivo?: string }[]): PertenenciaIndices {
  const indices = resultados.filter(r => r.pertenece === true).map(r => r.indice.id);
  const no_incluido_en = resultados.filter(r => r.pertenece === false).map(r => r.indice.id);
  const fallidos = resultados.filter(r => r.pertenece === null).map(r => ({ indice: r.indice.id, motivo: r.motivo ?? 'sin dato' }));
  const nombre = (id: string) => INDICES_MEMBRESIA.find(i => i.id === id)?.nombre ?? id;
  if (indices.length > 0) {
    return { estado: 'pertenece', indices, no_incluido_en, fallidos, texto: `Pertenece a: ${indices.map(i => `${nombre(i)} (${i})`).join(', ')}.${fallidos.length > 0 ? ` Sin consultar: ${fallidos.map(f => `${f.indice} (${f.motivo})`).join(', ')}.` : ''}` };
  }
  if (fallidos.length === 0) {
    return { estado: 'no_pertenece', indices, no_incluido_en, fallidos, texto: `No pertenece a ningún índice de referencia (${INDICES_MEMBRESIA.map(i => i.nombre).join(', ')}).` };
  }
  return {
    estado: 'sin_datos', indices, no_incluido_en, fallidos,
    texto: `No se pudo comprobar a qué índice pertenece: ${fallidos.map(f => `${f.indice} (${f.motivo})`).join(', ')}.${no_incluido_en.length > 0 ? ` No está en: ${no_incluido_en.join(', ')}.` : ''}`,
  };
}

const cache = new Map<string, { en: number; simbolos: Set<string> }>();
export function limpiarCachePertenencia(): void { cache.clear(); }

async function listaDe(deps: DepsDatosReales, indice: IndiceReferencia, ahora: number): Promise<{ ok: true; simbolos: Set<string> } | { ok: false; motivo: string }> {
  const c = cache.get(indice.id);
  if (c !== undefined && ahora - c.en < TTL_CACHE_MS) return { ok: true, simbolos: c.simbolos };
  try {
    const r = await deps.fetchFn(indice.url, { headers: { Accept: indice.fuente === 'wikipedia' ? 'application/json' : 'text/csv,*/*', 'User-Agent': 'TradingCat/1.0 (oficina de inversiones)' }, signal: (deps.senalTiempo ?? AbortSignal.timeout.bind(AbortSignal))(TIMEOUT_DATOS_MS), redirect: 'follow', cache: 'no-store' });
    if (!r.ok) return { ok: false, motivo: `HTTP ${String(r.status)}` };
    let simbolos: Set<string> | null;
    if (indice.fuente === 'wikipedia') {
      const j = await r.json() as { parse?: { text?: unknown } } | null;
      const html = j?.parse?.text;
      simbolos = typeof html === 'string' ? simbolosDeHtml(html) : null;
    } else {
      simbolos = r.text === undefined ? null : simbolosDeCsvIshares(await r.text());
    }
    if (simbolos === null) return { ok: false, motivo: 'respuesta vacía o con otra forma' };
    if (simbolos.size < (MINIMO_SIMBOLOS[indice.id] ?? 1)) return { ok: false, motivo: `lista incompleta (${String(simbolos.size)} símbolos)` };
    cache.set(indice.id, { en: ahora, simbolos });
    return { ok: true, simbolos };
  } catch (e) {
    const nombre = e instanceof Error ? e.name : '';
    return { ok: false, motivo: nombre === 'TimeoutError' || nombre === 'AbortError' ? 'tiempo agotado' : 'error de red o respuesta ilegible' };
  }
}

export async function consultarPertenencia(deps: DepsDatosReales, ticker: string, ahora: number = Date.now()): Promise<PertenenciaIndices> {
  const buscado = norm(ticker);
  const resultados = await Promise.all(INDICES_MEMBRESIA.map(async indice => {
    const r = await listaDe(deps, indice, ahora);
    return r.ok ? { indice, pertenece: r.simbolos.has(buscado) } : { indice, pertenece: null, motivo: r.motivo };
  }));
  return resolverPertenencia(resultados);
}

/** PMP al abrir: el índice es obligatorio. Devuelve el motivo si la corrida NO debe iniciar; null si pertenece. */
export function bloqueoPmpPorIndice(p: PertenenciaIndices): string | null {
  if (p.estado === 'pertenece') return null;
  return p.estado === 'no_pertenece'
    ? `${p.texto} PMP exige pertenecer a un índice: no se inicia la corrida; se sugiere pasarla a PCP.`
    : `${p.texto} PMP exige pertenecer a un índice y no se puede comprobar: no se inicia la corrida (no se supone que pertenece).`;
}

/** PCP: solo alerta cuando NO pertenece (o no se pudo comprobar). Si pertenece, null. */
export function avisoPcpPorIndice(p: PertenenciaIndices): string | null {
  if (p.estado === 'pertenece') return null;
  return p.estado === 'no_pertenece' ? `PCP: ${p.texto} Es solo una alerta.` : `PCP: ${p.texto}`;
}
