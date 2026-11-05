// Velas sintéticas en el formato de chart-data ({ time unix s (hora del exchange leída como UTC), open, high, low, close, volume }), de la más antigua a la más reciente.
export interface VelaPrueba { time: number; open: number; high: number; low: number; close: number; volume: number }
const t = (fecha: string): number => Date.parse(`${fecha}T00:00:00Z`) / 1000;
export const sumarDias = (fecha: string, dias: number): string => new Date((t(fecha) + dias * 86400) * 1000).toISOString().slice(0, 10);
const dow = (fecha: string): number => new Date(t(fecha) * 1000).getUTCDay();
const vela = (fecha: string, close: number): VelaPrueba => ({ time: t(fecha), open: close - 0.1, high: close + 0.2, low: close - 0.2, close, volume: 1000 });
export const ondulado = (i: number): number => 100 + 10 * Math.sin(i / 5) + i * 0.05;

/** `n` velas diarias en días entre semana, la última el `fin`. */
export function velasDiarias(fin: string, n: number, precio: (i: number) => number = ondulado): VelaPrueba[] {
  const fechas: string[] = [];
  for (let f = fin; fechas.length < n; f = sumarDias(f, -1)) if (dow(f) !== 0 && dow(f) !== 6) fechas.unshift(f);
  return fechas.map((f, i) => vela(f, precio(i)));
}
/** `n` velas semanales fechadas en lunes, la última el lunes `finLunes`. */
export function velasSemanales(finLunes: string, n: number, precio: (i: number) => number = ondulado): VelaPrueba[] {
  return Array.from({ length: n }, (_, i) => vela(sumarDias(finLunes, -7 * (n - 1 - i)), precio(i)));
}
/** Respuesta de chart-data para la serie dada (con medias de relleno que la capa de datos debe ignorar). */
export const respuestaChart = (symbol: string, interval: string, candles: VelaPrueba[]): Record<string, unknown> => ({ symbol, interval, priceName: symbol, candles, mas: { ema8: [] } });
// Evaluación del 2026-11-04 15:00 UTC (miércoles, sesión en curso): última diaria cerrada 2026-11-03; semana del 2026-11-02 en formación.
export const DIARIAS_PRUEBA = (): VelaPrueba[] => velasDiarias('2026-11-03', 300);
export const SEMANALES_PRUEBA = (): VelaPrueba[] => velasSemanales('2026-11-02', 120);
