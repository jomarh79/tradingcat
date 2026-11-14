// Dividendos del ticker por la ruta interna de la app (/api/dividends, la misma que usan las gráficas de /chart). Solo lectura.
// La ruta devuelve `{ dividends: [{ date, amount }] }` o `{ error }`. Una lista vacía es un dato válido (la empresa no pagó); un error NO se convierte en «sin dividendos».
import { ANIOS_DIVIDENDOS, RUTA_DIVIDENDOS } from './constantes';
import { leer } from './datos-reales';
import type { DepsDatosReales } from './datos-reales';
import { esNumeroFinito, esObjeto } from './utilidades';

export interface Dividendo { date: string; amount: number }
export type ResultadoDividendos = { ok: true; dividendos: Dividendo[] } | { ok: false; error: string };

export function extraerDividendos(json: unknown): ResultadoDividendos {
  if (!esObjeto(json)) return { ok: false, error: 'la respuesta no es un objeto' };
  if (typeof json['error'] === 'string' && json['error'] !== '') return { ok: false, error: 'la ruta respondió con error' };
  const d = json['dividends'];
  if (!Array.isArray(d)) return { ok: false, error: 'la respuesta no trae la lista dividends' };
  const out: Dividendo[] = [];
  for (const x of d) {
    if (!esObjeto(x)) continue;
    const fecha = typeof x['date'] === 'string' ? x['date'].split('T')[0]!.split(' ')[0]! : '';
    const monto = Number(x['amount']);
    if (/^\d{4}-\d{2}-\d{2}$/.test(fecha) && esNumeroFinito(monto) && monto >= 0) out.push({ date: fecha, amount: monto });
  }
  return { ok: true, dividendos: out };
}

export async function obtenerDividendos(deps: DepsDatosReales, ticker: string, anios: number = ANIOS_DIVIDENDOS): Promise<ResultadoDividendos> {
  const r = await leer(deps, `${deps.origen}${RUTA_DIVIDENDOS}?symbol=${encodeURIComponent(ticker)}&years=${String(anios)}`, { Accept: 'application/json', Authorization: deps.authorization });
  if (!r.ok) return { ok: false, error: r.motivo };
  return extraerDividendos(r.json);
}
