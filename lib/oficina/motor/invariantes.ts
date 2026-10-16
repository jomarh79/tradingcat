import { ErrorMotor } from './tipos';
import type { SalidaMotor } from './tipos';
import { DECISIONES_OPERATIVAS, validarDecision } from './vocabulario';

/** Reproduce en código las restricciones de oficina_decisiones y oficina_corridas_historial.
 *  El Motor las comprueba antes de devolver su salida: si alguna falla, la corrida falla y se registra,
 *  en lugar de intentar un INSERT que la base rechazaría. */
export function verificarInvariantes(s: SalidaMotor, rutaDeterminista: boolean): void {
  const fallos: string[] = [];
  try { validarDecision(s.tipo_evaluacion, s.decision); } catch (e) { fallos.push((e as Error).message); }

  if ((s.estado_final === 'bloqueada') !== (s.decision === 'BLOQUEADO')) {
    fallos.push('bloqueada <=> BLOQUEADO');
  }
  if (s.decision === 'NO_EVALUABLE' && s.estado_final !== 'incompleta' && s.estado_final !== 'pendiente_informacion') {
    fallos.push('NO_EVALUABLE nunca es completada ni bloqueada');
  }
  if (s.estado_final !== 'completada' && s.motivos_estado.length === 0) {
    fallos.push('un estado distinto de completada exige motivos');
  }
  if (s.estado_final === 'completada' && s.director_estado !== 'ok' && s.director_estado !== 'no_aplica') {
    fallos.push('completada exige Director ok o no_aplica');
  }
  if (rutaDeterminista && s.director_estado !== 'no_aplica') {
    fallos.push('la ruta determinista no usa Director');
  }
  if ((s.decision === 'COMPRAR' || s.decision === 'RECOMPRAR') && s.datos_faltantes.length > 0) {
    fallos.push('COMPRAR y RECOMPRAR no admiten datos faltantes');
  }
  if (DECISIONES_OPERATIVAS.has(s.decision)) {
    if (!s.requiere_autorizacion) fallos.push('una decisión operativa exige requiere_autorizacion = true');
    if (s.portafolio_codigo === null) fallos.push('una decisión operativa exige portafolio_codigo');
  } else if (s.requiere_autorizacion) {
    fallos.push('una decisión no operativa no requiere autorización');
  }
  if (s.requiere_autorizacion !== (s.estado_usuario === 'pendiente')) {
    fallos.push('estado_usuario no corresponde a requiere_autorizacion');
  }
  for (const campo of ['explicacion', 'siguiente_paso', 'condicion_cambio'] as const) {
    if (s[campo].trim() === '') fallos.push(`${campo} vacío`);
  }
  if (fallos.length > 0) throw new ErrorMotor(`Salida del Motor inválida: ${fallos.join('; ')}`);
}
