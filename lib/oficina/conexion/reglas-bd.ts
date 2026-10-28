// Reglas desde la base: une oficina_reglas, oficina_reglas_versiones y oficina_reglas_clasificacion en la lista que consume el Auditor.
// Esquema usado (consulta del 26-oct): solo columnas conocidas. Función pura (`resolverReglas`) + lector (`cargarFilasReglas`).
import { CLASES_REGLA } from '../auditor';
import type { ClaseRegla, ReglaEntrada } from '../auditor';

export const TABLA_REGLAS = 'oficina_reglas';
export const TABLA_VERSIONES = 'oficina_reglas_versiones';
export const TABLA_CLASIFICACION = 'oficina_reglas_clasificacion';
export const COLUMNAS_REGLAS = 'id,codigo,caracter';
export const COLUMNAS_VERSIONES = 'id,regla_id,version,definicion,estado,vigente_desde,vigente_hasta';
export const COLUMNAS_CLASIFICACION = 'regla_id,clase,componente_delegado,aplica_a,vigente_desde,vigente_hasta';
export const ESTADO_VIGENTE = 'vigente';
const REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/;

export interface FilaRegla { id: string; codigo: string; caracter: string }
export interface FilaVersion {
  id: string; regla_id: string; version: number; definicion: unknown; estado: string; vigente_desde: string | null; vigente_hasta: string | null;
}
export interface FilaClasificacion {
  regla_id: string; clase: string; componente_delegado: string | null; aplica_a: unknown; vigente_desde: string; vigente_hasta: string | null;
}
export interface FilasReglas { reglas: FilaRegla[]; versiones: FilaVersion[]; clasificaciones: FilaClasificacion[] }

export interface OpcionesReglas {
  /** Fecha de la evaluación (AAAA-MM-DD, America/Mexico_City). */
  fecha: string;
  /** Versiones congeladas del snapshot. Si se dan, ESAS versiones definen el conjunto (rige la versión congelada, contrato §0.6). */
  versiones_ids?: string[];
}
export interface ResultadoReglas {
  /** Ordenadas por código (mismo conjunto → mismo orden → mismo hash). */
  reglas: ReglaEntrada[];
  versiones_ids: string[];
  /** Si no está vacío, el llamador NO debe auditar. */
  problemas: string[];
}

const vigenteEn = (desde: string | null, hasta: string | null, fecha: string): boolean =>
  desde !== null && desde <= fecha && (hasta === null || fecha <= hasta);

const esObjeto = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const esListaTexto = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

export function resolverReglas(filas: FilasReglas, o: OpcionesReglas): ResultadoReglas {
  const problemas: string[] = [];
  if (!REGEX_FECHA.test(o.fecha)) return { reglas: [], versiones_ids: [], problemas: ['fecha inválida'] };
  const reglaPorId = new Map(filas.reglas.map((r) => [r.id, r]));
  let versiones: FilaVersion[];
  if (o.versiones_ids) {
    versiones = [];
    for (const id of o.versiones_ids) {
      const v = filas.versiones.find((x) => x.id === id);
      if (!v) problemas.push(`la versión congelada ${id} no existe`);
      else versiones.push(v);
    }
  } else {
    versiones = filas.versiones.filter((v) => v.estado === ESTADO_VIGENTE && vigenteEn(v.vigente_desde, v.vigente_hasta, o.fecha));
  }
  const vistas = new Set<string>();
  const reglas: ReglaEntrada[] = [];
  for (const v of versiones) {
    const regla = reglaPorId.get(v.regla_id);
    if (!regla) { problemas.push(`la versión ${v.id} apunta a una regla inexistente`); continue; }
    if (vistas.has(regla.id)) { problemas.push(`${regla.codigo}: más de una versión en el conjunto`); continue; }
    vistas.add(regla.id);
    if (v.vigente_desde === null || !REGEX_FECHA.test(v.vigente_desde)) { problemas.push(`${regla.codigo}: la versión no tiene vigente_desde`); continue; }
    if (!esObjeto(v.definicion)) { problemas.push(`${regla.codigo}: definicion inválida`); continue; }
    if (regla.caracter !== 'obligatoria' && regla.caracter !== 'referencial') { problemas.push(`${regla.codigo}: carácter desconocido ${regla.caracter}`); continue; }
    const cls = filas.clasificaciones.filter((c) => c.regla_id === regla.id && vigenteEn(c.vigente_desde, c.vigente_hasta, o.fecha));
    if (cls.length === 0) { problemas.push(`${regla.codigo}: sin clasificación vigente`); continue; }
    if (cls.length > 1) { problemas.push(`${regla.codigo}: clasificación ambigua (${cls.length} filas vigentes)`); continue; }
    const c = cls[0]!;
    if (!(CLASES_REGLA as readonly string[]).includes(c.clase)) { problemas.push(`${regla.codigo}: clase desconocida ${c.clase}`); continue; }
    if (regla.caracter === 'referencial' && c.clase !== 'referencial') { problemas.push(`${regla.codigo}: carácter referencial exige clase referencial`); continue; }
    if (!esObjeto(c.aplica_a) || !esListaTexto(c.aplica_a['portafolios']) || !esListaTexto(c.aplica_a['tipos_evaluacion'])) {
      problemas.push(`${regla.codigo}: aplica_a inválido`); continue;
    }
    reglas.push({
      codigo: regla.codigo, version_id: v.id, caracter: regla.caracter, vigente_desde: v.vigente_desde, definicion: v.definicion,
      clase: c.clase as ClaseRegla, aplica_a: { portafolios: c.aplica_a['portafolios'] as string[], tipos_evaluacion: c.aplica_a['tipos_evaluacion'] as string[] },
      componente_delegado: c.componente_delegado,
    });
  }
  const codigos = new Set<string>();
  for (const r of reglas) { if (codigos.has(r.codigo)) problemas.push(`${r.codigo}: código repetido en el conjunto`); codigos.add(r.codigo); }
  reglas.sort((a, b) => (a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0));
  return { reglas, versiones_ids: reglas.map((r) => r.version_id), problemas };
}

/** Lo mínimo que se usa de supabase-js: `from(tabla).select(columnas)` (el resultado es esperable). */
export interface ClienteConsulta {
  from(tabla: string): { select(columnas: string): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> };
}
export type ResultadoCarga = { ok: true; filas: FilasReglas } | { ok: false; error: string };

/** Lee las tres tablas. El error de la base se devuelve tal cual (sin reintentos). */
export async function cargarFilasReglas(cliente: ClienteConsulta): Promise<ResultadoCarga> {
  const leer = async (tabla: string, columnas: string): Promise<{ filas: unknown[] } | { error: string }> => {
    const r = await cliente.from(tabla).select(columnas);
    if (r.error) return { error: `${tabla}: ${r.error.message}` };
    if (!Array.isArray(r.data)) return { error: `${tabla}: la consulta no devolvió filas` };
    return { filas: r.data };
  };
  const a = await leer(TABLA_REGLAS, COLUMNAS_REGLAS);
  if ('error' in a) return { ok: false, error: a.error };
  const b = await leer(TABLA_VERSIONES, COLUMNAS_VERSIONES);
  if ('error' in b) return { ok: false, error: b.error };
  const c = await leer(TABLA_CLASIFICACION, COLUMNAS_CLASIFICACION);
  if ('error' in c) return { ok: false, error: c.error };
  return { ok: true, filas: { reglas: a.filas as FilaRegla[], versiones: b.filas as FilaVersion[], clasificaciones: c.filas as FilaClasificacion[] } };
}
