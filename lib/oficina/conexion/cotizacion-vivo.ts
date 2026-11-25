// Cotización en vivo (Finnhub /quote): precio actual `c` y cierre anterior `pc`. Solo lectura. Sirve para la salida PCP por salto de sesión (v0.86):
// no espera al cierre de la vela. Si falla o los números no son válidos NO se supone nada: devuelve null y la salida sigue como antes.
import { FINNHUB_CABECERA_CLAVE, FINNHUB_URL_BASE } from '../agentes-ia/constantes';
import { leer } from '../agentes-ia/datos-reales';
import type { DepsDatosReales } from '../agentes-ia/datos-reales';

export interface CotizacionVivo { precio: string; cierre_anterior: string }

const positivo = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

export async function obtenerCotizacionVivo(deps: DepsDatosReales, ticker: string): Promise<CotizacionVivo | null> {
  const r = await leer(deps, `${FINNHUB_URL_BASE}/quote?symbol=${encodeURIComponent(ticker)}`, { Accept: 'application/json', [FINNHUB_CABECERA_CLAVE]: deps.finnhub_key });
  if (!r.ok || typeof r.json !== 'object' || r.json === null) return null;
  const j = r.json as Record<string, unknown>;
  return positivo(j['c']) && positivo(j['pc']) ? { precio: String(j['c']), cierre_anterior: String(j['pc']) } : null;
}
