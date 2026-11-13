// Datos que el usuario llena en la página Watchlist (rol, portafolios, competidores y las Notas como descripción del negocio) y que la Oficina lee.
// Solo lectura y sin inventar nada: un dato ausente o inválido no se rellena. Decisiones del 12-nov:
//   - el negocio es el texto de «Notas» de la watchlist;
//   - los portafolios marcados solo AVISAN (la corrida sigue);
//   - el rol de la watchlist MANDA sobre el del expediente de la Oficina (el expediente solo sirve si la watchlist no tiene rol).
// Que el usuario los escriba en la watchlist equivale a declararlos él mismo: cuentan como apartados completos (rol, negocio, competidores) de la ficha de PMP-09.

export const TABLA_WATCHLIST = 'watchlist';
export const COLUMNAS_WATCHLIST = 'id,ticker,rol,portafolios,competidores,notes';
export const ROLES_WATCHLIST = ['flujo', 'crecimiento', 'mixto'] as const;
export const PORTAFOLIOS_WATCHLIST = ['PMP', 'PCP', 'PLP', 'ETF', 'SEMILLA'] as const;

export interface DatosWatchlist {
  rol: string | null;
  /** Texto de Notas (descripción del negocio), recortado; null si está vacío. */
  negocio: string | null;
  competidores: string | null;
  portafolios: string[];
}

export interface ResultadoWatchlist { datos: DatosWatchlist | null; avisos: string[] }

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

export function interpretarWatchlist(filas: unknown[], ticker: string, portafolio: string): ResultadoWatchlist {
  const avisos: string[] = [];
  if (filas.length === 0) {
    return { datos: null, avisos: [`watchlist: ${ticker} no está en la watchlist; no se usan su rol, negocio ni competidores`] };
  }
  if (filas.length > 1) {
    return { datos: null, avisos: [`watchlist: ${ticker} aparece ${filas.length} veces (ambiguo); no se usan su rol, negocio ni competidores`] };
  }
  const f = filas[0];
  const r = typeof f === 'object' && f !== null && !Array.isArray(f) ? (f as Record<string, unknown>) : {};

  const rolCrudo = texto(r['rol']);
  let rol: string | null = null;
  if (rolCrudo !== null) {
    if ((ROLES_WATCHLIST as readonly string[]).includes(rolCrudo)) rol = rolCrudo;
    else avisos.push(`watchlist: el rol «${rolCrudo}» de ${ticker} no es válido (flujo, crecimiento o mixto); no se usa`);
  }

  const portafolios = Array.isArray(r['portafolios'])
    ? (r['portafolios'] as unknown[]).filter((p): p is string => typeof p === 'string' && (PORTAFOLIOS_WATCHLIST as readonly string[]).includes(p))
    : [];
  if (!portafolios.includes(portafolio)) {
    avisos.push(portafolios.length === 0
      ? `watchlist: ${ticker} no tiene portafolios marcados; se analiza en ${portafolio} de todos modos`
      : `watchlist: ${ticker} no tiene marcado ${portafolio} (marcados: ${portafolios.join(', ')}); se analiza de todos modos`);
  }
  return { datos: { rol, negocio: texto(r['notes']), competidores: texto(r['competidores']), portafolios }, avisos };
}

/** Apartados de la ficha de PMP-09 que la watchlist declara. Solo suma `true`: nunca marca un apartado como incompleto. */
export function apartadosDeclarados(w: DatosWatchlist): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (w.rol !== null) out['rol'] = true;
  if (w.negocio !== null) out['negocio'] = true;
  if (w.competidores !== null) out['competidores'] = true;
  return out;
}
