// Persistencia de la salida del Auditor en `oficina_analisis` (columnas y restricciones pegadas el 28-oct):
//   id, user_id*, ejecucion_id, expediente_id*, agente*, veredicto, puntaje, confianza, salida*, datos_fuente*, supuestos, invalidadores, created_at   (* NOT NULL)
//   FK: ejecucion_id → oficina_ejecuciones_agentes(id); expediente_id → oficina_expedientes(id); user_id → auth.users. CHECK: confianza en [0,1] o null.
// Una sola fila por inserción (atómico). El Auditor no puntúa: puntaje y confianza van en null; supuestos e invalidadores también.
// El error de la base se devuelve tal cual, sin reintentos. No se inventa expediente: si no existe, no se persiste.
import { AGENTE_AUDITOR } from '../auditor';
import type { SalidaAuditor } from '../auditor';
import { esUuid } from '../orquestador/persistencia';

export const TABLA_ANALISIS = 'oficina_analisis';
export interface IdsAnalisis { user_id: string; expediente_id: string | null; ejecucion_id: string | null }
export type ResultadoFilaAnalisis = { ok: true; fila: Record<string, unknown> } | { ok: false; problemas: string[] };

export function filaAnalisisAuditor(salida: SalidaAuditor, ids: IdsAnalisis): ResultadoFilaAnalisis {
  const problemas: string[] = [];
  if (!esUuid(ids.user_id)) problemas.push('user_id inválido');
  if (!esUuid(ids.expediente_id)) problemas.push('expediente_id inválido o ausente: oficina_analisis lo exige y no se inventa');
  if (ids.ejecucion_id !== null && !esUuid(ids.ejecucion_id)) problemas.push('ejecucion_id inválido');
  if (salida.agente !== AGENTE_AUDITOR) problemas.push(`agente inesperado: ${String(salida.agente)}`);
  if (typeof salida.veredicto !== 'string' || (salida.veredicto as string) === '') problemas.push('la salida no trae veredicto');
  if (!Array.isArray(salida.datos_fuente)) problemas.push('la salida no trae datos_fuente');
  if (problemas.length > 0) return { ok: false, problemas };
  return {
    ok: true,
    fila: {
      user_id: ids.user_id, ejecucion_id: ids.ejecucion_id, expediente_id: ids.expediente_id, agente: AGENTE_AUDITOR,
      veredicto: salida.veredicto, puntaje: null, confianza: null, salida, datos_fuente: salida.datos_fuente, supuestos: null, invalidadores: null,
    },
  };
}

/** Lo mínimo de supabase-js: `from(t).insert(fila).select(cols).single()`. */
export interface ClienteInsercion {
  from(tabla: string): {
    insert(fila: Record<string, unknown>): { select(columnas: string): { single(): PromiseLike<{ data: unknown; error: { message: string } | null }> } };
  };
}
export type ResultadoGuardado = { ok: true; analisis_id: string } | { ok: false; problemas: string[]; error_bd?: string };

export async function guardarAnalisisAuditor(cliente: ClienteInsercion, salida: SalidaAuditor, ids: IdsAnalisis): Promise<ResultadoGuardado> {
  const f = filaAnalisisAuditor(salida, ids);
  if (!f.ok) return f;
  try {
    const r = await cliente.from(TABLA_ANALISIS).insert(f.fila).select('id').single();
    if (r.error) return { ok: false, problemas: [`${TABLA_ANALISIS}: ${r.error.message}`], error_bd: r.error.message };
    const id = (r.data as { id?: unknown } | null)?.id;
    if (!esUuid(id)) return { ok: false, problemas: [`${TABLA_ANALISIS}: la inserción no devolvió un id válido`] };
    return { ok: true, analisis_id: id };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return { ok: false, problemas: [`${TABLA_ANALISIS}: ${m}`], error_bd: m };
  }
}
