// v0.74 (decisión de Jaime, 22-nov): ¿la acción pertenece a alguno de los índices de referencia: S&P 500 (SPY), Nasdaq-100 (QQQ), Dow Jones (DIA) o MSCI USA Quality (QUAL)?
//  - PMP: es OBLIGATORIO para comprar. Si no pertenece (o no se puede comprobar), la corrida no inicia y se sugiere pasarla a PCP.
//  - PCP: solo informativo. Si pertenece, se nombra el índice; si no, es una alerta.
// Fuente: Finnhub (`index/constituents` de ^GSPC, ^NDX y ^DJI, y `etf/holdings` de QUAL). Lo que no se pueda leer queda como fallido: nunca se supone que pertenece ni que no.
import { leer } from '../agentes-ia/datos-reales';
import type { DepsDatosReales } from '../agentes-ia/datos-reales';
import { FINNHUB_CABECERA_CLAVE, FINNHUB_URL_BASE } from '../agentes-ia/constantes';

export interface IndiceReferencia { id: string; nombre: string; etf: string; ruta: string; simbolo: string; tipo: 'indice' | 'etf' }
export const INDICES_MEMBRESIA: readonly IndiceReferencia[] = [
  { id: 'SPY', nombre: 'S&P 500', etf: 'SPY', ruta: '/index/constituents', simbolo: '^GSPC', tipo: 'indice' },
  { id: 'QQQ', nombre: 'Nasdaq-100', etf: 'QQQ', ruta: '/index/constituents', simbolo: '^NDX', tipo: 'indice' },
  { id: 'DIA', nombre: 'Dow Jones', etf: 'DIA', ruta: '/index/constituents', simbolo: '^DJI', tipo: 'indice' },
  { id: 'QUAL', nombre: 'MSCI USA Quality (QUAL)', etf: 'QUAL', ruta: '/etf/holdings', simbolo: 'QUAL', tipo: 'etf' },
];

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

const esObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** BRK-B, brk.b y BRK.B son el mismo símbolo. */
const norm = (s: unknown): string => String(s ?? '').trim().toUpperCase().replace(/-/g, '.');

/** Símbolos de una respuesta de Finnhub; null si la forma no es la esperada o la lista está vacía (una lista vacía no demuestra nada). */
export function simbolosDeRespuesta(tipo: IndiceReferencia['tipo'], json: unknown): Set<string> | null {
  if (!esObj(json)) return null;
  const lista = tipo === 'indice' ? json['constituents'] : json['holdings'];
  if (!Array.isArray(lista) || lista.length === 0) return null;
  const out = new Set<string>();
  for (const x of lista) {
    const s = tipo === 'indice' ? norm(x) : esObj(x) ? norm(x['symbol'] ?? x['ticker']) : '';
    if (s !== '') out.add(s);
  }
  return out.size === 0 ? null : out;
}

/** Une los resultados de cada índice (true/false, o un motivo si falló). Puro. */
export function resolverPertenencia(resultados: readonly { indice: IndiceReferencia; pertenece: boolean | null; motivo?: string }[]): PertenenciaIndices {
  const indices = resultados.filter(r => r.pertenece === true).map(r => r.indice.id);
  const no_incluido_en = resultados.filter(r => r.pertenece === false).map(r => r.indice.id);
  const fallidos = resultados.filter(r => r.pertenece === null).map(r => ({ indice: r.indice.id, motivo: r.motivo ?? 'sin dato' }));
  const nombre = (id: string) => INDICES_MEMBRESIA.find(i => i.id === id)?.nombre ?? id;
  if (indices.length > 0) {
    return { estado: 'pertenece', indices, no_incluido_en, fallidos, texto: `Pertenece a: ${indices.map(i => `${nombre(i)} (${i})`).join(', ')}.${fallidos.length > 0 ? ` Sin consultar: ${fallidos.map(f => f.indice).join(', ')}.` : ''}` };
  }
  if (fallidos.length === 0) {
    return { estado: 'no_pertenece', indices, no_incluido_en, fallidos, texto: `No pertenece a ningún índice de referencia (${INDICES_MEMBRESIA.map(i => i.nombre).join(', ')}).` };
  }
  return {
    estado: 'sin_datos', indices, no_incluido_en, fallidos,
    texto: `No se pudo comprobar a qué índice pertenece: ${fallidos.map(f => `${f.indice} (${f.motivo})`).join(', ')}.${no_incluido_en.length > 0 ? ` No está en: ${no_incluido_en.join(', ')}.` : ''}`,
  };
}

export async function consultarPertenencia(deps: DepsDatosReales, ticker: string): Promise<PertenenciaIndices> {
  const buscado = norm(ticker);
  const cab = { Accept: 'application/json', [FINNHUB_CABECERA_CLAVE]: deps.finnhub_key };
  const resultados = await Promise.all(INDICES_MEMBRESIA.map(async indice => {
    const r = await leer(deps, `${FINNHUB_URL_BASE}${indice.ruta}?symbol=${encodeURIComponent(indice.simbolo)}`, cab);
    if (!r.ok) return { indice, pertenece: null, motivo: r.motivo };
    const set = simbolosDeRespuesta(indice.tipo, r.json);
    return set === null ? { indice, pertenece: null, motivo: 'respuesta vacía o con otra forma' } : { indice, pertenece: set.has(buscado) };
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
