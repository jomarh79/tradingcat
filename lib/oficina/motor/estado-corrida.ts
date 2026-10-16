import type { CodigoMotivo, Decision, EstadoDirector, EstadoFinal, MotivoEstado } from './tipos';

const CAUSAS_DE_INFORMACION: readonly CodigoMotivo[] = [
  'datos_faltantes', 'posicion_no_confirmada', 'snapshot_vencido', 'portafolio_no_declarado',
];

/** Estado de la corrida (contrato v0.4, sección 1.6, y Motor, sección 6).
 *
 *  Precedencia: pendiente_informacion > incompleta por agente requerido > bloqueada >
 *  incompleta por falla del Director > completada.
 *
 *  EXCEPCIÓN impuesta por la base: decision = BLOQUEADO <=> estado_final = 'bloqueada'
 *  (oficina_corridas_historial_bloqueada_chk). Un bloqueo del Auditor prevalece también sobre
 *  datos faltantes y fallas de agentes (decidido el 13-oct); esas causas quedan en los motivos. */
export function calcularEstadoFinal(args: {
  decision: Decision;
  causas: MotivoEstado[];
  director: EstadoDirector;
}): { estado: EstadoFinal; motivos: MotivoEstado[] } {
  const motivos = [...args.causas];
  const directorFallo = args.director === 'error' || args.director === 'pendiente';
  if (directorFallo && !motivos.some((m) => m.codigo === 'director_fallo')) {
    motivos.push({ codigo: 'director_fallo', detalle: `Director IA en estado ${args.director}` });
  }

  if (args.decision === 'BLOQUEADO') {
    if (!motivos.some((m) => m.codigo === 'auditor_bloqueo')) {
      motivos.push({ codigo: 'auditor_bloqueo', detalle: 'El Auditor devolvió BLOQUEO_REGLA' });
    }
    return { estado: 'bloqueada', motivos };
  }

  if (motivos.some((m) => CAUSAS_DE_INFORMACION.includes(m.codigo))) {
    return { estado: 'pendiente_informacion', motivos };
  }
  if (motivos.some((m) => m.codigo === 'agente_requerido_fallo')) {
    return { estado: 'incompleta', motivos };
  }
  if (directorFallo) {
    return { estado: 'incompleta', motivos };
  }
  if (args.decision === 'NO_EVALUABLE') {
    // NO_EVALUABLE nunca es completada: debe haber un motivo.
    if (motivos.length === 0) {
      motivos.push({ codigo: 'datos_faltantes', detalle: 'La evaluación no pudo concluirse con la información disponible' });
    }
    return { estado: 'pendiente_informacion', motivos };
  }
  return { estado: 'completada', motivos };
}
