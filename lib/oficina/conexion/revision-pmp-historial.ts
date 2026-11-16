// Historial de la revisión semestral PMP-11. Se guarda en `oficina_expedientes.ficha.revisiones_pmp11` del expediente PMP del ticker (la misma fila y el mismo permiso
// «propias» que ya usa la ficha; no hace falta ninguna tabla nueva). Funciones puras: la lectura y escritura las hace revision-pmp-bd.ts.
export const CLAVE_HISTORIAL = 'revisiones_pmp11';
export const HISTORIAL_MAXIMO = 24;
export const MESES_ENTRE_REVISIONES = 6;

export interface EntradaRevision {
  fecha: string; // AAAA-MM-DD de la revisión
  resultado: 'revisar_venta_100' | 'mantener' | 'no_evaluable';
  anios: number | null;
  anualizada_pct: number | null;
  precio_objetivo: number | null;
  cierre: number | null;
  deterioros: number;
  sin_datos: number;
  motivos: string[];
}

const esObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Suma meses a una fecha AAAA-MM-DD (si el día no existe en el mes destino, queda el último día de ese mes). */
export function sumarMeses(fecha: string, meses: number): string {
  const [y, m, d] = fecha.split('-').map(Number) as [number, number, number];
  const total = (m - 1) + meses;
  const ny = y + Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  const ultimo = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`;
}

export function leerHistorial(ficha: unknown): EntradaRevision[] {
  if (!esObj(ficha) || !Array.isArray(ficha[CLAVE_HISTORIAL])) return [];
  return (ficha[CLAVE_HISTORIAL] as unknown[]).filter((x): x is EntradaRevision => esObj(x) && typeof x['fecha'] === 'string' && REGEX_FECHA.test(x['fecha'] as string) && typeof x['resultado'] === 'string');
}

/** Agrega la revisión. Si ya hay una del mismo día se reemplaza (no se duplica por pulsar dos veces). Conserva las últimas HISTORIAL_MAXIMO. No toca el resto de la ficha. */
export function agregarRevision(ficha: unknown, nueva: EntradaRevision): Record<string, unknown> {
  const base = esObj(ficha) ? { ...ficha } : {};
  const previas = leerHistorial(ficha).filter(e => e.fecha !== nueva.fecha);
  base[CLAVE_HISTORIAL] = [...previas, nueva].sort((a, b) => (a.fecha < b.fecha ? -1 : 1)).slice(-HISTORIAL_MAXIMO);
  return base;
}

export type EstadoRevision =
  | { estado: 'nunca'; ultima: null; proxima: null }
  | { estado: 'al_dia' | 'vencida'; ultima: EntradaRevision; proxima: string };

export function estadoRevision(ficha: unknown, hoy: string): EstadoRevision {
  const h = leerHistorial(ficha);
  const ultima = h[h.length - 1];
  if (ultima === undefined) return { estado: 'nunca', ultima: null, proxima: null };
  const proxima = sumarMeses(ultima.fecha, MESES_ENTRE_REVISIONES);
  return { estado: hoy >= proxima ? 'vencida' : 'al_dia', ultima, proxima };
}
