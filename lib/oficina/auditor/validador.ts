// Validador de la salida (contrato v0.2, sección 7). Corre antes de guardar.
import { auditar } from './auditor';
import { hashSha256, jsonCanonico } from './canonico';
import { CLASES_REGLA, CONTRATO_SALIDA, AGENTE_AUDITOR, MAX_CARACTERES_RESUMEN, RESULTADOS_REGLA, PORTAFOLIOS_AUDITOR } from './tipos';
import type { EntradaAuditor, SalidaAuditor } from './tipos';

const VEREDICTOS = ['CUMPLE', 'BLOQUEO_REGLA', 'NO_ELEGIBLE', 'NO_EVALUABLE'];

export function validarSalida(e: EntradaAuditor, s: SalidaAuditor): string[] {
  const p: string[] = [];
  // 1. Esquema
  if (s.contrato !== CONTRATO_SALIDA) p.push('contrato inválido');
  if (s.agente !== AGENTE_AUDITOR) p.push('agente inválido');
  if (!VEREDICTOS.includes(s.veredicto)) p.push(`veredicto inválido: ${String(s.veredicto)}`);
  if (typeof s.resumen !== 'string' || s.resumen.length === 0 || s.resumen.length > MAX_CARACTERES_RESUMEN) p.push('resumen vacío o demasiado largo');
  for (const k of ['resultados_reglas', 'infracciones', 'filtros_fallidos', 'advertencias_referenciales', 'reglas_delegadas', 'tareas_sugeridas', 'datos_faltantes', 'datos_fuente'] as const) {
    if (!Array.isArray(s[k])) p.push(`${k} debe ser una lista`);
  }
  if (p.length > 0) return p;
  for (const r of s.resultados_reglas) {
    if (!(RESULTADOS_REGLA as readonly string[]).includes(r.resultado)) p.push(`${r.codigo}: resultado inválido`);
    if (!(CLASES_REGLA as readonly string[]).includes(r.clase)) p.push(`${r.codigo}: clase inválida`);
  }
  // 2. Completitud (hay portafolio operativo: toda regla de la entrada debe aparecer una vez)
  if (e.portafolio_codigo !== null && (PORTAFOLIOS_AUDITOR as readonly string[]).includes(e.portafolio_codigo)) {
    for (const r of e.reglas_vigentes) {
      const n = s.resultados_reglas.filter((x) => x.codigo === r.codigo).length;
      if (n !== 1) p.push(`${r.codigo}: aparece ${n} veces en resultados_reglas (debe ser 1)`);
    }
  }
  // 3. Versiones del snapshot
  for (const r of s.resultados_reglas) {
    const origen = e.reglas_vigentes.find((x) => x.codigo === r.codigo);
    if (!origen || origen.version_id !== r.version_id) p.push(`${r.codigo}: version_id no coincide con la del snapshot`);
  }
  // 4. Veredictos con su sustento
  if (s.veredicto === 'BLOQUEO_REGLA' && !(s.infracciones.length > 0 && s.infracciones.every((x) => x.codigo && x.version_id && x.condicion_para_levantar))) p.push('BLOQUEO_REGLA sin infracción completa (código, versión y condición para levantarla)');
  if (s.veredicto === 'NO_ELEGIBLE' && s.filtros_fallidos.length === 0) p.push('NO_ELEGIBLE sin filtro fallido');
  // 5. CUMPLE incoherente
  if (s.veredicto === 'CUMPLE') {
    const malo = s.resultados_reglas.find((r) => r.caracter === 'obligatoria' && (r.resultado === 'incumple' && r.clase !== 'referencial' || r.critico));
    if (malo) p.push(`CUMPLE con ${malo.codigo} en ${malo.resultado}`);
  }
  // 6. Evidencia: todo id citado existe y todo dato trae fuente y fecha
  const ids = new Set(s.datos_fuente.map((d) => d.id));
  for (const r of s.resultados_reglas) for (const id of r.evidencia) if (!ids.has(id)) p.push(`${r.codigo}: evidencia ${id} no está en datos_fuente`);
  for (const d of s.datos_fuente) if (!d.fuente || !d.fecha_dato) p.push(`datos_fuente ${d.id}: sin fuente o fecha_dato`);
  // 7. Reproducibilidad
  if (s.hash_entrada !== hashSha256(e)) p.push('hash_entrada no corresponde a la entrada');
  else if (jsonCanonico(auditar(e)) !== jsonCanonico(s)) p.push('la misma entrada produce un resultado distinto al guardado');
  return p;
}
