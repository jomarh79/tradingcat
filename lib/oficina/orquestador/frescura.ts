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

/** Motivo, estado y texto del umbral con que se declara un precio demasiado antiguo (decisión del 22-oct: llega al Motor como `datos_faltantes`). */
export const MOTIVO_PRECIO_DESACTUALIZADO = 'precio_desactualizado';
export const ESTADO_DATO_VENCIDO = 'vencido';

/** Dato que el Motor recibe como faltante, con la causa explícita: el dato EXISTE pero es demasiado antiguo para esta evaluación. */
export interface DatoFaltanteVencido {
  dato: 'precio_diario';
  motivo: typeof MOTIVO_PRECIO_DESACTUALIZADO;
  estado_dato: typeof ESTADO_DATO_VENCIDO;
  /** Texto del límite vigente, tomado del parámetro `frescura.precio` (p. ej. «1 día hábil»). */
  umbral_frescura: string;
  ultima_vela: string | null;
  fecha_evaluacion: string | null;
  /** null si pasaron más de MAX_DIAS_REVISION_FRESCURA días y no se contaron las sesiones. */
  dias_habiles_de_antiguedad: number | null;
  detalle: string;
}

/** «1 día hábil», «2 días hábiles»: el límite se toma del parámetro, no se escribe a mano. */
export function textoUmbralFrescura(limite_dias_habiles: number): string {
  return limite_dias_habiles === 1 ? '1 día hábil' : `${limite_dias_habiles} días hábiles`;
}

/** null si el precio no está vencido o no se pudo evaluar (en ese caso no se inventa un faltante). */
export function datoFaltantePorFrescura(f: ResultadoFrescura): DatoFaltanteVencido | null {
  if (f.vencida !== true || f.limite_dias_habiles === null) return null;
  return {
    dato: 'precio_diario', motivo: MOTIVO_PRECIO_DESACTUALIZADO, estado_dato: ESTADO_DATO_VENCIDO,
    umbral_frescura: textoUmbralFrescura(f.limite_dias_habiles),
    ultima_vela: f.ultima_vela, fecha_evaluacion: f.fecha_evaluacion, dias_habiles_de_antiguedad: f.dias_habiles_de_antiguedad,
    detalle: f.detalle,
  };
}

/** Texto para `datos_faltantes: string[]` de la entrada del Motor. */
export function textoDatoFaltante(d: DatoFaltanteVencido): string {
  return `${d.dato}: motivo ${d.motivo} (estado_dato: ${d.estado_dato}; umbral_frescura: ${d.umbral_frescura}; ${d.detalle})`;
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
