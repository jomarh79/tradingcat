// Portafolios que se marcan en la watchlist: solo PMP y PCP (casillas; pueden ir los dos y la corrida se hace para ambos).
// Los otros códigos (PLP, ETF, SEMILLA) que un ticker ya tuviera guardados se CONSERVAN al marcar o desmarcar: esta pantalla no los toca.

export const PORTAFOLIOS_WATCHLIST = ['PMP', 'PCP'] as const;
export type PortafolioWatchlist = (typeof PORTAFOLIOS_WATCHLIST)[number];

export const esPortafolioWatchlist = (p: string): p is PortafolioWatchlist => (PORTAFOLIOS_WATCHLIST as readonly string[]).includes(p);

/** Marca o desmarca `codigo`. Devuelve la lista guardada: primero PMP y PCP (en ese orden, si están marcados) y después, sin tocar, los demás códigos que ya tenía. */
export function alternarPortafolio(actuales: readonly string[] | null | undefined, codigo: PortafolioWatchlist, marcado: boolean): string[] {
  const base = (actuales ?? []).filter(p => typeof p === 'string' && p !== '');
  const plazos = PORTAFOLIOS_WATCHLIST.filter(p => (p === codigo ? marcado : base.includes(p)));
  const otros = Array.from(new Set(base.filter(p => !esPortafolioWatchlist(p))));
  return [...plazos, ...otros];
}

/** Códigos que esta pantalla no maneja (PLP, ETF, SEMILLA) y el ticker ya tenía guardados. */
export const portafoliosAjenos = (actuales: readonly string[] | null | undefined): string[] => (actuales ?? []).filter(p => p !== '' && !esPortafolioWatchlist(p));

/** Con PMP y/o PCP marcados (y nada más) la corrida va directa, una por portafolio y en este orden. Con otra mezcla no se decide sola: se abre el selector. */
export function portafoliosParaCorrida(marcados: readonly string[] | null | undefined): PortafolioWatchlist[] | null {
  const m = marcados ?? [];
  if (m.length === 0 || m.some(p => !esPortafolioWatchlist(p))) return null;
  return PORTAFOLIOS_WATCHLIST.filter(p => m.includes(p));
}
