// Obtiene los datos reales del Fundamental: estado de resultados de Webull (por la ruta interna de la app, con el token del dueño) y balance, flujo de caja y
// ratios de Finnhub. Solo lectura. Si Webull falla no hay análisis; si falla una llamada de Finnhub se omite esa parte y se avisa (nunca se inventa ni se rellena).
// Seguridad: la clave de Finnhub va en una cabecera (no en la URL); el token del dueño solo se envía a la ruta interna y NO se siguen redirecciones; los errores
// se reducen al estado HTTP y nunca incluyen cuerpos de respuesta, claves ni tokens.
import {
  ENV_BASE_URL_OFICINA, ENV_FINNHUB_API_KEY, FINNHUB_CABECERA_CLAVE, FINNHUB_FRECUENCIA_ANUAL, FINNHUB_FRECUENCIA_TRIMESTRAL, FINNHUB_METRIC_TODAS, FINNHUB_RUTA_METRIC,
  FINNHUB_RUTA_REPORTADO, FINNHUB_URL_BASE, FUENTE_OK, FUENTE_OMITIDA, RUTA_WEBULL_INCOME, TIMEOUT_DATOS_MS,
} from './constantes';
import { esObjeto } from './utilidades';

export type FetchDatos = (url: string, init: { headers: Record<string, string>; signal: AbortSignal; redirect: 'manual' | 'error' | 'follow'; cache?: 'no-store' }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface DepsDatosReales {
  fetchFn: FetchDatos; origen: string; authorization: string; finnhub_key: string;
  /** Señal de tiempo máximo por llamada (opcional; por omisión `AbortSignal.timeout`). Inyectable para poder probarla. */
  senalTiempo?: (ms: number) => AbortSignal;
}
export interface DatosReales {
  income_statement: unknown;
  finnhub_reportado?: unknown; finnhub_reportado_trimestral?: unknown; finnhub_metric?: unknown;
  avisos_obtencion: string[];
  fuentes: Record<string, string>;
}
export type ResultadoDatosReales = { ok: true; datos: DatosReales } | { ok: false; http: number; error: string };

export type ConfigDatos = { ok: true; finnhub_key: string; base_url: string | null } | { ok: false; faltan: string[] };
/** Lee la configuración del servidor. Errores: solo NOMBRES de variables. */
export function leerConfigDatos(env: Record<string, string | undefined>): ConfigDatos {
  const clave = env[ENV_FINNHUB_API_KEY];
  if (typeof clave !== 'string' || clave.trim() === '') return { ok: false, faltan: [ENV_FINNHUB_API_KEY] };
  const base = env[ENV_BASE_URL_OFICINA];
  return { ok: true, finnhub_key: clave.trim(), base_url: typeof base === 'string' && base.trim() !== '' ? base.trim().replace(/\/+$/, '') : null };
}

export type Leida = { ok: true; json: unknown } | { ok: false; motivo: string };

export async function leer(deps: DepsDatosReales, url: string, headers: Record<string, string>): Promise<Leida> {
  try {
    const r = await deps.fetchFn(url, { headers, signal: (deps.senalTiempo ?? AbortSignal.timeout.bind(AbortSignal))(TIMEOUT_DATOS_MS), redirect: 'manual', cache: 'no-store' });
    if (r.status >= 300 && r.status < 400) return { ok: false, motivo: `redirección HTTP ${String(r.status)} no seguida` };
    if (!r.ok) return { ok: false, motivo: `HTTP ${String(r.status)}` };
    return { ok: true, json: await r.json() };
  } catch (e) {
    // Solo el tipo de error: el mensaje podría contener la URL o datos de la petición.
    const nombre = e instanceof Error ? e.name : '';
    return { ok: false, motivo: nombre === 'TimeoutError' || nombre === 'AbortError' ? 'tiempo agotado' : 'error de red o respuesta ilegible' };
  }
}

export async function obtenerDatosFundamental(deps: DepsDatosReales, ticker: string): Promise<ResultadoDatosReales> {
  const simbolo = encodeURIComponent(ticker);
  const w = await leer(deps, `${deps.origen}${RUTA_WEBULL_INCOME}?symbol=${simbolo}`, { Accept: 'application/json', Authorization: deps.authorization });
  if (!w.ok) return { ok: false, http: 502, error: `Webull (ruta interna): ${w.motivo}${w.motivo.startsWith('redirección') ? `; define ${ENV_BASE_URL_OFICINA} con el origen público de la app` : ''}` };
  if (!esObjeto(w.json) || w.json['success'] !== true) return { ok: false, http: 502, error: 'Webull (ruta interna): respuesta sin success=true' };

  const cabecera = { Accept: 'application/json', [FINNHUB_CABECERA_CLAVE]: deps.finnhub_key };
  const base = FINNHUB_URL_BASE;
  const pedir = [
    { clave: 'finnhub_reportado', nombre: 'Finnhub financials-reported anual', url: `${base}${FINNHUB_RUTA_REPORTADO}?symbol=${simbolo}&freq=${FINNHUB_FRECUENCIA_ANUAL}` },
    { clave: 'finnhub_reportado_trimestral', nombre: 'Finnhub financials-reported trimestral', url: `${base}${FINNHUB_RUTA_REPORTADO}?symbol=${simbolo}&freq=${FINNHUB_FRECUENCIA_TRIMESTRAL}` },
    { clave: 'finnhub_metric', nombre: 'Finnhub stock/metric', url: `${base}${FINNHUB_RUTA_METRIC}?symbol=${simbolo}&metric=${FINNHUB_METRIC_TODAS}` },
  ] as const;
  const respuestas = await Promise.all(pedir.map(p => leer(deps, p.url, cabecera)));
  const datos: DatosReales = { income_statement: w.json, avisos_obtencion: [], fuentes: { webull_income_statement: FUENTE_OK } };
  pedir.forEach((p, i) => {
    const r = respuestas[i]!;
    if (r.ok) { datos[p.clave] = r.json; datos.fuentes[p.clave] = FUENTE_OK; }
    else { datos.fuentes[p.clave] = FUENTE_OMITIDA; datos.avisos_obtencion.push(`${p.nombre}: no se pudo obtener (${r.motivo}); se omite y no se rellena`); }
  });
  return { ok: true, datos };
}
