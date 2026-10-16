import type { EstadoUsuario } from './tipos';

export type Actor =
  | { tipo: 'usuario'; user_id: string }
  | { tipo: 'sistema' | 'motor' | 'orquestador' | 'agente' | 'director' | 'auditor' };

export type ResultadoTransicion =
  | { ok: true; nuevo: EstadoUsuario; registrar_autorizada_at: boolean }
  | { ok: false; error: string };

/** Transiciones de autorización (contrato del Motor, secciones 6 y 8; refleja el disparador de la base).
 *  - Solo el usuario pasa una decisión de pendiente a autorizada o rechazada.
 *  - El sistema puede marcarla expirada (por tiempo), nunca autorizarla ni rechazarla.
 *  - autorizada, rechazada, expirada y no_requerida son estados finales. */
export function transicionAutorizacion(args: {
  actual: EstadoUsuario;
  solicitado: EstadoUsuario;
  actor: Actor;
  requiere_autorizacion: boolean;
}): ResultadoTransicion {
  const { actual, solicitado, actor, requiere_autorizacion } = args;

  if (!requiere_autorizacion) {
    return { ok: false, error: 'La decisión no requiere autorización: su estado es no_requerida y es final' };
  }
  if (actual !== 'pendiente') {
    return { ok: false, error: `El estado ${actual} es final; no puede pasar a ${solicitado}` };
  }
  if (solicitado === 'autorizada' || solicitado === 'rechazada') {
    if (actor.tipo !== 'usuario') {
      return { ok: false, error: `Solo el usuario puede pasar una decisión a ${solicitado}; actor: ${actor.tipo}` };
    }
    return { ok: true, nuevo: solicitado, registrar_autorizada_at: solicitado === 'autorizada' };
  }
  if (solicitado === 'expirada') {
    if (actor.tipo === 'usuario') {
      return { ok: false, error: 'La expiración es una transición por tiempo, no una acción del usuario' };
    }
    return { ok: true, nuevo: 'expirada', registrar_autorizada_at: false };
  }
  return { ok: false, error: `Transición no permitida: ${actual} -> ${solicitado}` };
}
