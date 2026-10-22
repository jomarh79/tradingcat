// Confirmación del cierre de velas (Orquestador). Decide las banderas `ultima_vela_diaria_cerrada` y
// `ultima_vela_semanal_cerrada` que recibe el Técnico.
//
// Regla vigente (21-oct, segunda versión): ni TwelveData ni la ruta chart-data de TradingCat traen una marca de «vela cerrada»,
// así que el cierre se decide solo con el calendario oficial del NYSE y el reloj:
//   una vela está cerrada si la fecha de su sesión (la del día; en la semanal, la última sesión de la semana lunes-domingo) es
//   anterior a hoy en America/Mexico_City, o si es de hoy y ya pasó el cierre del NYSE (16:00 ET, o el cierre anticipado del
//   calendario) más el margen MARGEN_CIERRE_MINUTOS.
// Si el calendario no cubre la fecha (o es la BMV, que no tiene calendario verificable) el resultado es NO_EVALUABLE.
// En cualquier otro caso dudoso (sin vela, fecha inválida, fecha que no fue sesión, vela futura, entrada inválida) queda `pendiente`.
// Nunca se usa una vela en formación: la bandera es true solo en el estado `confirmada`. La semanal se decide aparte de la diaria.
//
// Función pura: no lee el reloj (el instante de evaluación llega como dato) y no lanza errores por datos malos.

import { CALENDARIO_NYSE, ZONA_NYSE, ZONA_OFICINA, fechaEnZona, formatoEnZona } from './calendario';
import type { CalendarioNYSE, SesionNYSE } from './calendario';

/** Margen, en minutos, que se espera después del cierre del NYSE antes de dar por cerrada una vela del mismo día.
 *  [PROPUESTA] 30 minutos (confirmado por Jaime el 21-oct como valor inicial); no está contrastado con la demora real de TwelveData. */
export const MARGEN_CIERRE_MINUTOS = 30;

export type Mercado = 'US' | 'BMV';
/** `no_evaluable`: el calendario no puede responder (año no cubierto, BMV). `pendiente`: dato dudoso o incoherente. */
export type EstadoCierre = 'confirmada' | 'en_formacion' | 'pendiente' | 'no_evaluable';

export interface VelaFuente {
  /** Fecha (YYYY-MM-DD) de la última vela: el día de la sesión, o cualquier día de la semana en la vela semanal. */
  fecha: string;
}

export interface EntradaCierreVelas {
  mercado: Mercado;
  /** Instante de la evaluación, ISO 8601 con zona (por ejemplo 2026-10-21T20:00:00Z). Sin zona se rechaza. */
  evaluado_en: string;
  diaria: VelaFuente | null;
  semanal: VelaFuente | null;
}

export interface OpcionesCierreVelas {
  /** Minutos de espera después del cierre del NYSE. Por omisión MARGEN_CIERRE_MINUTOS. Debe ser un número finito mayor o igual a 0. */
  margen_cierre_minutos?: number;
}

export interface MotivoCierre { codigo: string; detalle: string }

export interface CierreEsperado {
  /** Sesión cuyo cierre decide la bandera (en la vela semanal, la última sesión de la semana). */
  fecha_sesion: string;
  anticipado: boolean;
  utc: string;
  nueva_york: string;
  ciudad_de_mexico: string;
  /** Margen aplicado y primer instante (UTC) desde el que una vela de ese mismo día se da por cerrada. */
  margen_minutos: number;
  confirmable_desde_utc: string;
}

export interface ResultadoCierre {
  /** La bandera para el Técnico: true solo si el estado es `confirmada`. */
  cerrada: boolean;
  estado: EstadoCierre;
  motivos: MotivoCierre[];
  cierre_esperado: CierreEsperado | null;
}

export interface ResultadoCierreVelas {
  ultima_vela_diaria_cerrada: boolean;
  ultima_vela_semanal_cerrada: boolean;
  diaria: ResultadoCierre;
  semanal: ResultadoCierre;
}

const CON_ZONA = /(Z|[+-]\d{2}:?\d{2})$/;
const MS_POR_MINUTO = 60000;

function describir(s: SesionNYSE, margen_minutos: number): CierreEsperado {
  return {
    fecha_sesion: s.fecha,
    anticipado: s.cierre_anticipado,
    utc: s.cierre_utc.toISOString(),
    nueva_york: formatoEnZona(s.cierre_utc, ZONA_NYSE),
    ciudad_de_mexico: formatoEnZona(s.cierre_utc, ZONA_OFICINA),
    margen_minutos,
    confirmable_desde_utc: new Date(s.cierre_utc.getTime() + margen_minutos * MS_POR_MINUTO).toISOString(),
  };
}

function resultado(estado: EstadoCierre, motivos: MotivoCierre[], cierre: CierreEsperado | null): ResultadoCierre {
  return { cerrada: estado === 'confirmada', estado, motivos, cierre_esperado: cierre };
}

function sinConfirmar(estado: 'pendiente' | 'no_evaluable', codigo: string, detalle: string, cierre: CierreEsperado | null = null): ResultadoCierre {
  return resultado(estado, [{ codigo, detalle }], cierre);
}

function resolver(
  tipo: 'diaria' | 'semanal', vela: VelaFuente | null, ahora: Date, cal: CalendarioNYSE, margen_minutos: number,
): ResultadoCierre {
  if (vela === null) return sinConfirmar('pendiente', 'sin_vela', `No hay vela ${tipo} para evaluar`);

  let sesion: SesionNYSE;
  let inicioPeriodo: string;
  if (tipo === 'diaria') {
    const c = cal.consultar(vela.fecha);
    if (c.estado === 'fecha_invalida') return sinConfirmar('pendiente', 'fecha_invalida', `La fecha de la vela diaria no es válida: ${vela.fecha}`);
    if (c.estado === 'no_cubierta') return sinConfirmar('no_evaluable', 'calendario_no_cubre_fecha', `El calendario del NYSE no cubre ${vela.fecha}: no se puede evaluar el cierre`);
    if (c.estado === 'no_es_sesion') {
      return sinConfirmar('pendiente', 'fecha_no_es_sesion', `${vela.fecha} no fue sesión del NYSE (${c.motivo === 'feriado' ? 'feriado' : 'fin de semana'}): la vela no es coherente con el calendario`);
    }
    sesion = c.sesion;
    inicioPeriodo = vela.fecha;
  } else {
    const c = cal.ultimaSesionDeSemana(vela.fecha);
    if (c.estado === 'fecha_invalida') return sinConfirmar('pendiente', 'fecha_invalida', `La fecha de la vela semanal no es válida: ${vela.fecha}`);
    if (c.estado === 'no_cubierta') return sinConfirmar('no_evaluable', 'calendario_no_cubre_fecha', `El calendario del NYSE no cubre la semana de ${vela.fecha}: no se puede evaluar el cierre`);
    if (c.estado === 'sin_sesiones') return sinConfirmar('pendiente', 'semana_sin_sesiones', `La semana ${c.lunes} a ${c.domingo} no tuvo sesiones según el calendario`);
    sesion = c.sesion;
    inicioPeriodo = c.lunes;
  }
  const cierre = describir(sesion, margen_minutos);

  if (inicioPeriodo > fechaEnZona(ahora, ZONA_NYSE)) {
    return sinConfirmar('pendiente', 'vela_futura', `La vela ${tipo} (${inicioPeriodo}) es posterior a la fecha de evaluación en Nueva York`, cierre);
  }

  const hoyOficina = fechaEnZona(ahora, ZONA_OFICINA);
  const confirmable = sesion.fecha < hoyOficina || ahora.getTime() >= new Date(cierre.confirmable_desde_utc).getTime();
  if (confirmable) return resultado('confirmada', [], cierre);

  if (ahora.getTime() >= sesion.cierre_utc.getTime()) {
    return resultado('en_formacion', [{ codigo: 'margen_de_cierre', detalle: `La sesión terminó (${cierre.nueva_york}, Nueva York) pero aún no pasan los ${margen_minutos} minutos de margen` }], cierre);
  }
  return resultado('en_formacion', [{ codigo: 'sesion_en_curso', detalle: `La sesión de cierre (${cierre.nueva_york}, Nueva York) aún no termina` }], cierre);
}

export function confirmarCierreVelas(
  entrada: EntradaCierreVelas, calendario: CalendarioNYSE = CALENDARIO_NYSE, opciones: OpcionesCierreVelas = {},
): ResultadoCierreVelas {
  const ambas = (r: ResultadoCierre): ResultadoCierreVelas => ({
    ultima_vela_diaria_cerrada: r.cerrada,
    ultima_vela_semanal_cerrada: r.cerrada,
    diaria: r,
    semanal: { ...r, motivos: r.motivos.map(m => ({ ...m })) },
  });

  const ahora = typeof entrada.evaluado_en === 'string' && CON_ZONA.test(entrada.evaluado_en) ? new Date(entrada.evaluado_en) : null;
  if (ahora === null || isNaN(ahora.getTime())) {
    return ambas(sinConfirmar('pendiente', 'entrada_invalida', `evaluado_en debe ser un instante ISO 8601 con zona (por ejemplo ...Z): ${String(entrada.evaluado_en)}`));
  }
  const margen = opciones.margen_cierre_minutos === undefined ? MARGEN_CIERRE_MINUTOS : opciones.margen_cierre_minutos;
  if (typeof margen !== 'number' || !isFinite(margen) || margen < 0) {
    return ambas(sinConfirmar('pendiente', 'entrada_invalida', `margen_cierre_minutos debe ser un número finito mayor o igual a 0: ${String(margen)}`));
  }
  if (entrada.mercado === 'BMV') {
    return ambas(sinConfirmar('no_evaluable', 'calendario_bmv_no_definido', 'No hay calendario verificable de la BMV: no se puede evaluar el cierre'));
  }
  if (entrada.mercado !== 'US') {
    return ambas(sinConfirmar('pendiente', 'mercado_no_soportado', `Mercado no soportado: ${String(entrada.mercado)}`));
  }

  const diaria = resolver('diaria', entrada.diaria, ahora, calendario, margen);
  const semanal = resolver('semanal', entrada.semanal, ahora, calendario, margen);
  return {
    ultima_vela_diaria_cerrada: diaria.cerrada,
    ultima_vela_semanal_cerrada: semanal.cerrada,
    diaria,
    semanal,
  };
}
