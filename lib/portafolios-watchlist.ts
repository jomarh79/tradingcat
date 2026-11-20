// Portafolios de la watchlist según el ROL del ticker (19-nov): crecimiento → PCP, flujo → PMP, mixto → PMP y PCP. No se marcan a mano.
// Con los dos activos la corrida ▶ se hace para ambos. La columna `watchlist.portafolios` se guarda junto con el rol (cambiarRol) para que la Oficina y las alertas la lean igual.

export const PORTAFOLIOS_WATCHLIST = ['PMP', 'PCP'] as const;
export type PortafolioWatchlist = (typeof PORTAFOLIOS_WATCHLIST)[number];

export const esPortafolioWatchlist = (p: string): p is PortafolioWatchlist => (PORTAFOLIOS_WATCHLIST as readonly string[]).includes(p);

const POR_ROL: Readonly<Record<string, readonly PortafolioWatchlist[]>> = {
  crecimiento: ['PCP'],
  flujo: ['PMP'],
  mixto: ['PMP', 'PCP'],
};

/** Portafolios que activa un rol, siempre en el orden PMP, PCP. Sin rol (o un rol desconocido) no activa ninguno. */
export function portafoliosDeRol(rol: string | null | undefined): PortafolioWatchlist[] {
  return [...(POR_ROL[typeof rol === 'string' ? rol : ''] ?? [])];
}

/** Con PMP y/o PCP (y nada más) la corrida va directa, una por portafolio y en este orden. Con otra mezcla o ninguno no se decide sola: se abre el selector. */
export function portafoliosParaCorrida(marcados: readonly string[] | null | undefined): PortafolioWatchlist[] | null {
  const m = marcados ?? [];
  if (m.length === 0 || m.some(p => !esPortafolioWatchlist(p))) return null;
  return PORTAFOLIOS_WATCHLIST.filter(p => m.includes(p));
}
