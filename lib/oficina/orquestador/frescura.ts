// Frescura del precio (módulo 3). Aprobado el 14-oct: `frescura.precio` = 1 día hábil.
// [PROPUESTA] Medición: antigüedad = número de sesiones del NYSE posteriores a la fecha de la última vela cerrada y hasta la fecha de la
// evaluación en America/Mexico_City (inclusive). El precio está vencido si la antigüedad supera el límite.
// Ejemplos con límite 1: martes por la mañana con la última vela del lunes = 1 (vigente); miércoles con la del lunes = 2 (vencido);
// sábado con la del viernes = 0; martes tras un lunes festivo con la del viernes = 1 (vigente).
// Función pura. Si el calendario no cubre el tramo, no se evalúa (nunca se supone vigente ni vencido).

import { sumarDias } from './calendario';
import type { CalendarioNYSE } from './calendario';

/** Tope de días corridos que se revisan hacia atrás; más allá el precio se declara vencido sin contar sesiones. */
export const MAX_DIAS_REVISION_FRESCURA = 60;

export interface ResultadoFrescura {
  evaluada: boolean;
  /** null si no se pudo evaluar. */
  vencida: boolean | null;
  dias_habiles_de_antiguedad: number | null;
  limite_dias_habiles: number | null;
  ultima_vela: string | null;
  fecha_evaluacion: string | null;
  detalle: string;
}

function noEvaluada(detalle: string, ultima_vela: string | null, fecha_evaluacion: string | null, limite: number | null): ResultadoFrescura {
  return { evaluada: false, vencida: null, dias_habiles_de_antiguedad: null, limite_dias_habiles: limite, ultima_vela, fecha_evaluacion, detalle };
}

export function evaluarFrescuraPrecio(args: {
  ultima_vela_diaria: string | null;
  fecha_evaluacion: string | null;
  limite_dias_habiles: number | null;
  calendario: CalendarioNYSE;
}): ResultadoFrescura {
  const { ultima_vela_diaria: ult, fecha_evaluacion: hoy, limite_dias_habiles: limite, calendario: cal } = args;
  if (limite === null) return noEvaluada('frescura.precio sin definir o inválido: no se evalúa la frescura', ult, hoy, limite);
  if (ult === null || hoy === null) return noEvaluada('no hay última vela o fecha de evaluación', ult, hoy, limite);
  if (cal.consultar(ult).estado === 'fecha_invalida' || cal.consultar(hoy).estado === 'fecha_invalida') {
    return noEvaluada('fecha inválida', ult, hoy, limite);
  }
  if (ult > hoy) return noEvaluada(`la última vela (${ult}) es posterior a la fecha de evaluación (${hoy})`, ult, hoy, limite);

  let sesiones = 0;
  let dia = ult;
  for (let i = 0; i < MAX_DIAS_REVISION_FRESCURA && dia < hoy; i++) {
    dia = sumarDias(dia, 1);
    const c = cal.consultar(dia);
    if (c.estado === 'no_cubierta') return noEvaluada(`el calendario del NYSE no cubre ${dia}`, ult, hoy, limite);
    if (c.estado === 'sesion') sesiones++;
  }
  if (dia < hoy) {
    return { evaluada: true, vencida: true, dias_habiles_de_antiguedad: null, limite_dias_habiles: limite, ultima_vela: ult, fecha_evaluacion: hoy,
      detalle: `la última vela (${ult}) tiene más de ${MAX_DIAS_REVISION_FRESCURA} días: vencida` };
  }
  const vencida = sesiones > limite;
  return {
    evaluada: true, vencida, dias_habiles_de_antiguedad: sesiones, limite_dias_habiles: limite, ultima_vela: ult, fecha_evaluacion: hoy,
    detalle: `última vela ${ult}: ${sesiones} día(s) hábil(es) de antigüedad al ${hoy}; límite ${limite}${vencida ? ': VENCIDA' : ''}`,
  };
}
