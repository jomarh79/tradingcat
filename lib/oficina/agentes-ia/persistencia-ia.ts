// Persistencia de la salida de los agentes de IA en `oficina_analisis` (esquema pegado el 28-oct). Una inserción por análisis, error de la base tal cual.
// `user_id` opcional: en sesión de usuario lo pone la base (default auth.uid()). `expediente_id` es obligatorio y no se inventa.
// [PROPUESTA] `supuestos` e `invalidadores` van SOLO dentro de `salida` mientras no se confirme el tipo de esas dos columnas (null en columna, como el Auditor).
import { AGENTE_DIRECTOR_IA, AGENTE_FUNDAMENTAL, AGENTE_TECNICO } from './constantes';
import { esObjeto } from './utilidades';
import { esUuid } from '../orquestador/persistencia';
import { TABLA_ANALISIS } from '../conexion/persistencia-auditor';
import type { ClienteInsercion, IdsAnalisis, ResultadoGuardado } from '../conexion/persistencia-auditor';

export interface TrazabilidadIa {
  proveedor: string; modelo: string; contrato: string; version_prompt: string; run_id: string; snapshot_id: string; intentos: number; generado_en: string;
}
export type ResultadoFilaIa = { ok: true; fila: Record<string, unknown> } | { ok: false; problemas: string[] };

export function filaAnalisisIa(salida: Record<string, unknown>, tra: TrazabilidadIa, ids: IdsAnalisis): ResultadoFilaIa {
  const problemas: string[] = [];
  if (ids.user_id !== undefined && ids.user_id !== null && !esUuid(ids.user_id)) problemas.push('user_id inválido');
  if (!esUuid(ids.expediente_id)) problemas.push('expediente_id inválido o ausente: oficina_analisis lo exige y no se inventa');
  if (ids.ejecucion_id !== null && !esUuid(ids.ejecucion_id)) problemas.push('ejecucion_id inválido');
  const agente = salida['agente'];
  const esDirector = agente === AGENTE_DIRECTOR_IA;
  if (agente !== AGENTE_FUNDAMENTAL && agente !== AGENTE_TECNICO && !esDirector) problemas.push(`agente no soportado: ${String(agente)}`);
  if (problemas.length > 0) return { ok: false, problemas };
  const confianza = esDirector ? salida['nivel_confianza'] : salida['confianza'];
  const df = salida['datos_fuente'];
  return {
    ok: true,
    fila: {
      ...(ids.user_id !== undefined && ids.user_id !== null ? { user_id: ids.user_id } : {}),
      ejecucion_id: ids.ejecucion_id, expediente_id: ids.expediente_id, agente,
      veredicto: esDirector ? null : salida['veredicto'], puntaje: esDirector ? null : (salida['puntaje'] ?? null), confianza,
      salida: { ...salida, trazabilidad: tra },
      datos_fuente: Array.isArray(df) ? df : [], supuestos: null, invalidadores: null,
    },
  };
}

export async function guardarAnalisisIa(cliente: ClienteInsercion, salida: Record<string, unknown>, tra: TrazabilidadIa, ids: IdsAnalisis): Promise<ResultadoGuardado> {
  const f = filaAnalisisIa(salida, tra, ids);
  if (!f.ok) return f;
  try {
    const r = await cliente.from(TABLA_ANALISIS).insert(f.fila).select('id').single();
    if (r.error) return { ok: false, problemas: [`${TABLA_ANALISIS}: ${r.error.message}`], error_bd: r.error.message };
    const id = esObjeto(r.data) ? r.data['id'] : undefined;
    if (!esUuid(id)) return { ok: false, problemas: [`${TABLA_ANALISIS}: la inserción no devolvió un id válido`] };
    return { ok: true, analisis_id: id };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return { ok: false, problemas: [`${TABLA_ANALISIS}: ${m}`], error_bd: m };
  }
}
