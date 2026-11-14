// Velas del Técnico: se piden a la ruta interna /api/chart-data (TwelveData), una vez en diario y otra en semanal. NO se llama a TwelveData directo y no se
// toca `fetchTimeSeries` de la gráfica. Solo lectura. La ruta devuelve `{ symbol, interval, priceName, candles, mas }` con `candles` de la más antigua a la más reciente
// y `{ error }` con estado 400, 429, 500 o 502 cuando falla. La ruta NO marca la vela del día en curso: la descarta el Orquestador (`prepararTecnico`), no esta capa.
// Esta capa solo comprueba la FORMA (lista de objetos con los 6 campos); los valores (números finitos, precios coherentes, orden) los valida `validarVelas` del Técnico.
// Si falla la serie diaria no hay velas (null): el Técnico queda sin calcular y se declara. Si falla solo la semanal se sigue con semanales vacías y queda dicho.
import { FUENTE_VELAS, INTERVALO_VELAS_DIARIAS, INTERVALO_VELAS_SEMANALES, RUTA_CHART_DATA } from './constantes';
import { leer } from './datos-reales';
import type { DepsDatosReales } from './datos-reales';
import { esObjeto } from './utilidades';
import type { Candle } from '../tecnico';

export const CAMPOS_VELA = ['time', 'open', 'high', 'low', 'close', 'volume'] as const;

export interface VelasObtenidas { diarias: Candle[]; semanales: Candle[]; fuente: string }
export type ResultadoVelas = { ok: true; velas: VelasObtenidas; avisos: string[] } | { ok: false; error: string };

type SerieVelas = { ok: true; velas: Candle[] } | { ok: false; error: string };

/** Comprueba la forma de la respuesta de chart-data y copia solo los 6 campos de cada vela (el resto de la respuesta, como las medias, se ignora). */
export function extraerVelas(json: unknown): SerieVelas {
  if (!esObjeto(json)) return { ok: false, error: 'la respuesta no es un objeto' };
  const c = json['candles'];
  if (!Array.isArray(c)) return { ok: false, error: 'la respuesta no trae la lista candles' };
  if (c.length === 0) return { ok: false, error: 'candles viene vacía' };
  const velas: Candle[] = [];
  for (let i = 0; i < c.length; i++) {
    const v: unknown = c[i];
    if (!esObjeto(v)) return { ok: false, error: `candles[${String(i)}] no es un objeto` };
    const falta = CAMPOS_VELA.filter(k => !(k in v));
    if (falta.length > 0) return { ok: false, error: `candles[${String(i)}] sin ${falta.join(', ')}` };
    velas.push({ time: v['time'], open: v['open'], high: v['high'], low: v['low'], close: v['close'], volume: v['volume'] } as Candle);
  }
  return { ok: true, velas };
}

async function pedir(deps: DepsDatosReales, simbolo: string, intervalo: string): Promise<SerieVelas> {
  const url = `${deps.origen}${RUTA_CHART_DATA}?symbol=${simbolo}&interval=${intervalo}`;
  const r = await leer(deps, url, { Accept: 'application/json', Authorization: deps.authorization });
  if (!r.ok) return { ok: false, error: r.motivo };
  return extraerVelas(r.json);
}

export async function obtenerVelas(deps: DepsDatosReales, ticker: string): Promise<ResultadoVelas> {
  const simbolo = encodeURIComponent(ticker);
  const [dia, sem] = await Promise.all([pedir(deps, simbolo, INTERVALO_VELAS_DIARIAS), pedir(deps, simbolo, INTERVALO_VELAS_SEMANALES)]);
  if (!dia.ok) return { ok: false, error: `velas diarias (chart-data): ${dia.error}; el Técnico no se calcula y no se rellena` };
  if (!sem.ok) {
    return { ok: true, velas: { diarias: dia.velas, semanales: [], fuente: FUENTE_VELAS }, avisos: [`velas semanales (chart-data): ${sem.error}; se sigue solo con las diarias`] };
  }
  return { ok: true, velas: { diarias: dia.velas, semanales: sem.velas, fuente: FUENTE_VELAS }, avisos: [] };
}

/** Solo las velas diarias de un símbolo (para los índices de referencia de la ficha). Si falla devuelve el motivo; nunca se rellena. */
export async function obtenerVelasDiariasDe(deps: DepsDatosReales, simbolo: string): Promise<{ ok: true; velas: Candle[] } | { ok: false; error: string }> {
  return pedir(deps, encodeURIComponent(simbolo), INTERVALO_VELAS_DIARIAS);
}
