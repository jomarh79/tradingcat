// Aprobación de la ficha de PMP-09 desde la pantalla Watchlist. Lógica pura (sin base de datos): valida qué se aprueba y arma lo que se guarda.
// Un apartado solo cuenta para PMP-09 si queda estado 'aprobado' con texto (`fichaPmpAprobada`). Aquí NUNCA se aprueba nada sin que el usuario lo pida explícitamente.

/** Los 11 apartados de PMP-09. */
export const APARTADOS_FICHA_PMP = [
  'identidad', 'rol', 'negocio', 'rendimiento', 'volatilidad_riesgo', 'dividendos_fundamentales', 'correlacion', 'plan_ejecucion', 'decision_final', 'indices_referencia', 'competidores',
] as const;
/** Los que puede proponer la corrida (y que el usuario aprueba tal cual). */
export const APARTADOS_PROPUESTOS = ['identidad', 'rendimiento', 'volatilidad_riesgo', 'dividendos_fundamentales', 'correlacion', 'plan_ejecucion', 'decision_final', 'indices_referencia'] as const;
/** Los que escribe el usuario. */
/** Ninguno: con la v0.40 la corrida propone los 8; se deja la lista por si algún día hay un apartado que solo escribes tú. */
export const APARTADOS_PROPIOS = [] as readonly string[];
/** Los que salen de la página Watchlist (rol, negocio = Notas, competidores). */
export const APARTADOS_DE_WATCHLIST = ['rol', 'negocio', 'competidores'] as const;
export const MAX_TEXTO_APARTADO = 4000;

const esObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface ApartadoAprobado { estado: 'aprobado'; texto: string; aprobado_at: string; origen: 'propuesta_oficina' | 'usuario' }

/** Texto aprobado de cada apartado de `ficha.ficha_pmp` (solo los que están 'aprobado' con texto). */
export function textosAprobados(ficha: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const f = esObj(ficha) ? ficha['ficha_pmp'] : null;
  if (!esObj(f)) return out;
  for (const [k, v] of Object.entries(f)) {
    if (esObj(v) && v['estado'] === 'aprobado' && typeof v['texto'] === 'string' && v['texto'].trim() !== '') out[k] = v['texto'];
  }
  return out;
}

export type ResultadoAprobacion = { ok: true; nuevos: Record<string, ApartadoAprobado> } | { ok: false; error: string };

export function construirAprobacion(e: {
  propuesta: Record<string, { texto: string }>;
  aprobar: unknown;
  textos: unknown;
  ahora: string;
}): ResultadoAprobacion {
  const nuevos: Record<string, ApartadoAprobado> = {};
  const aprobar = e.aprobar === undefined ? [] : e.aprobar;
  if (!Array.isArray(aprobar)) return { ok: false, error: 'aprobar debe ser una lista de apartados' };
  for (const a of aprobar) {
    if (typeof a !== 'string' || !(APARTADOS_PROPUESTOS as readonly string[]).includes(a)) return { ok: false, error: `«${String(a)}» no es un apartado que la corrida proponga (${APARTADOS_PROPUESTOS.join(', ')})` };
    const t = e.propuesta[a]?.texto;
    if (typeof t !== 'string' || t.trim() === '') return { ok: false, error: `la última corrida no trae propuesta para «${a}»` };
    nuevos[a] = { estado: 'aprobado', texto: t, aprobado_at: e.ahora, origen: 'propuesta_oficina' };
  }
  const textos = e.textos === undefined ? {} : e.textos;
  if (!esObj(textos)) return { ok: false, error: 'textos debe ser un objeto apartado → texto' };
  for (const [k, v] of Object.entries(textos)) {
    if (!APARTADOS_PROPIOS.includes(k)) return { ok: false, error: `«${k}» no es un apartado que escribas tú (${APARTADOS_PROPIOS.join(', ')})` };
    if (typeof v !== 'string') return { ok: false, error: `el texto de «${k}» debe ser texto` };
    const t = v.trim();
    if (t === '') continue;   // vacío: no se aprueba ni se borra nada
    if (t.length > MAX_TEXTO_APARTADO) return { ok: false, error: `el texto de «${k}» pasa de ${MAX_TEXTO_APARTADO} caracteres` };
    nuevos[k] = { estado: 'aprobado', texto: t, aprobado_at: e.ahora, origen: 'usuario' };
  }
  if (Object.keys(nuevos).length === 0) return { ok: false, error: 'no hay nada que aprobar: marca algún apartado o escribe algún texto' };
  return { ok: true, nuevos };
}

/** Devuelve la ficha con los apartados nuevos mezclados en `ficha_pmp`; el resto de la ficha y de los apartados queda igual. */
export function mezclarFicha(ficha: unknown, nuevos: Record<string, ApartadoAprobado>): Record<string, unknown> {
  const base = esObj(ficha) ? { ...ficha } : {};
  const previo = esObj(base['ficha_pmp']) ? (base['ficha_pmp'] as Record<string, unknown>) : {};
  return { ...base, ficha_pmp: { ...previo, ...nuevos } };
}
