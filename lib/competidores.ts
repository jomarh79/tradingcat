// Competidores de la watchlist: hasta 4 tickers por empresa (tu decisión del 18-nov). Se guardan en la columna `competidores` como texto
// «AAA, BBB, CCC, DDD» (el mismo formato de texto que ya lee la Oficina; no hay migración). Funciones puras; el dibujo vive en
// app/watchlist/CompetidoresCeldas.tsx.

export const MAX_COMPETIDORES = 4;
/** Ticker válido: empieza con letra; letras, números, punto o guion (BRK.B, BF-B). */
export const REGEX_TICKER = /^[A-Z][A-Z0-9.-]{0,9}$/;

export type ClaseCompetidor = 'abierto' | 'watchlist' | 'ninguno';

/** Tickers de un texto guardado: separa por coma, punto y coma, diagonal o espacios; mayúsculas, sin repetidos, como máximo 4. */
export function parseCompetidores(texto: string | null | undefined): string[] {
  if (!texto) return [];
  const vistos = new Set<string>();
  for (const trozo of texto.split(/[,;/\s]+/)) {
    const t = trozo.trim().toUpperCase();
    if (t !== '' && !vistos.has(t)) vistos.add(t);
  }
  return [...vistos].slice(0, MAX_COMPETIDORES);
}

/** Texto que se guarda en la base. */
export const formatearCompetidores = (tickers: readonly string[]): string => tickers.join(', ');

/** ¿La fila tiene al menos un competidor? (la corrida de la Oficina lo exige). */
export const tieneCompetidor = (texto: string | null | undefined): boolean => parseCompetidores(texto).length > 0;

export type ResultadoCasillas = { ok: true; tickers: string[] } | { ok: false; error: string };

/** Valida las 4 casillas del editor: las vacías se ignoran; cada ticker debe ser válido, distinto de los demás y distinto del propio. */
export function validarCasillas(casillas: readonly string[], propio: string): ResultadoCasillas {
  const tickers: string[] = [];
  for (const c of casillas) {
    const t = c.trim().toUpperCase();
    if (t === '') continue;
    if (!REGEX_TICKER.test(t)) return { ok: false, error: `«${t}» no es un ticker válido (letras, números, punto o guion; máximo 10 caracteres)` };
    if (t === propio.trim().toUpperCase()) return { ok: false, error: `${t} no puede ser competidor de sí mismo` };
    if (tickers.includes(t)) return { ok: false, error: `${t} está repetido` };
    tickers.push(t);
  }
  if (tickers.length > MAX_COMPETIDORES) return { ok: false, error: `Máximo ${MAX_COMPETIDORES} competidores` };
  return { ok: true, tickers };
}

/** Color del competidor: amarillo si ya tienes una posición abierta de ese ticker (manda sobre el verde); verde si ya está en la watchlist. */
export function clasificarCompetidor(ticker: string, enWatchlist: ReadonlySet<string>, enAbiertos: ReadonlySet<string>): ClaseCompetidor {
  const t = ticker.trim().toUpperCase();
  if (enAbiertos.has(t)) return 'abierto';
  if (enWatchlist.has(t)) return 'watchlist';
  return 'ninguno';
}
