// Confirmación del cierre de velas (Orquestador, 21-oct). Decide las banderas `ultima_vela_diaria_cerrada` y
// `ultima_vela_semanal_cerrada` que recibe el Técnico.
//
// Regla (aprobada el 21-oct): el calendario y la hora dicen CUÁNDO se espera el cierre, pero no prueban por sí solos que la fuente
// de datos ya entregó una vela definitiva. Una vela se confirma como cerrada solo si (1) el calendario oficial del NYSE dice que
// la sesión (la del día, o la última de la semana) ya terminó y (2) la fuente la declara cerrada. La bandera semanal se decide
// aparte de la diaria. Si el calendario no está disponible o la fuente no permite confirmar el cierre, NO se asume cerrada:
// la validación queda `pendiente`, la bandera es false y el Técnico descarta esa vela (nunca usa una vela en formación).
//
// Función pura: no lee el reloj (el instante de evaluación llega como dato) y no lanza errores por datos malos.

import { CALENDARIO_NYSE, ZONA_NYSE, ZONA_OFICINA, fechaEnZona, formatoEnZona } from './calendario';
import type { CalendarioNYSE, SesionNYSE } from './calendario';

export type Mercado = 'US' | 'BMV';
/** Lo que la fuente de datos declara de su última vela. `desconocida` = la fuente no lo informa. */
export type ConfirmacionFuente = 'cerrada' | 'en_formacion' | 'desconocida';
export type EstadoCierre = 'confirmada' | 'en_formacion' | 'pendiente';

export interface VelaFuente {
  /** Fecha (YYYY-MM-DD) de la última vela: el día de la sesión, o cualquier día de la semana en la vela semanal. */
  fecha: string;
  confirmacion_fuente: ConfirmacionFuente;
}

export interface EntradaCierreVelas {
  mercado: Mercado;
  /** Instante de la evaluación, ISO 8601 con zona (por ejemplo 2026-10-21T20:00:00Z). Sin zona se rechaza. */
  evaluado_en: string;
  diaria: VelaFuente | null;
  semanal: VelaFuente | null;
}

export interface MotivoCierre { codigo: string; detalle: string }

export interface CierreEsperado {
  /** Sesión cuyo cierre decide la bandera (en la vela semanal, la última sesión de la semana). */
  fecha_sesion: string;
  anticipado: boolean;
  utc: string;
  nueva_york: string;
  ciudad_de_mexico: string;
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

function describir(s: SesionNYSE): CierreEsperado {
  return {
    fecha_sesion: s.fecha,
    anticipado: s.cierre_anticipado,
    utc: s.cierre_utc.toISOString(),
    nueva_york: formatoEnZona(s.cierre_utc, ZONA_NYSE),
    ciudad_de_mexico: formatoEnZona(s.cierre_utc, ZONA_OFICINA),
  };
}

function resultado(estado: EstadoCierre, motivos: MotivoCierre[], cierre: CierreEsperado | null): ResultadoCierre {
  return { cerrada: estado === 'confirmada', estado, motivos, cierre_esperado: cierre };
}

function pendiente(codigo: string, detalle: string, cierre: CierreEsperado | null = null): ResultadoCierre {
  return resultado('pendiente', [{ codigo, detalle }], cierre);
}

function resolver(tipo: 'diaria' | 'semanal', vela: VelaFuente | null, ahora: Date, cal: CalendarioNYSE): ResultadoCierre {
  if (vela === null) return pendiente('sin_vela', `No hay vela ${tipo} para evaluar`);

  let sesion: SesionNYSE;
  let inicioPeriodo: string;
  if (tipo === 'diaria') {
    const c = cal.consultar(vela.fecha);
    if (c.estado === 'fecha_invalida') return pendiente('fecha_invalida', `La fecha de la vela diaria no es válida: ${vela.fecha}`);
    if (c.estado === 'no_cubierta') return pendiente('calendario_no_cubre_fecha', `El calendario del NYSE no cubre ${vela.fecha}: no se puede confirmar el cierre`);
    if (c.estado === 'no_es_sesion') {
      return pendiente('fecha_no_es_sesion', `${vela.fecha} no fue sesión del NYSE (${c.motivo === 'feriado' ? 'feriado' : 'fin de semana'}): la vela no es coherente con el calendario`);
    }
    sesion = c.sesion;
    inicioPeriodo = vela.fecha;
  } else {
    const c = cal.ultimaSesionDeSemana(vela.fecha);
    if (c.estado === 'fecha_invalida') return pendiente('fecha_invalida', `La fecha de la vela semanal no es válida: ${vela.fecha}`);
    if (c.estado === 'no_cubierta') return pendiente('calendario_no_cubre_fecha', `El calendario del NYSE no cubre la semana de ${vela.fecha}: no se puede confirmar el cierre`);
    if (c.estado === 'sin_sesiones') return pendiente('semana_sin_sesiones', `La semana ${c.lunes} a ${c.domingo} no tuvo sesiones según el calendario`);
    sesion = c.sesion;
    inicioPeriodo = c.lunes;
  }
  const cierre = describir(sesion);

  if (inicioPeriodo > fechaEnZona(ahora, ZONA_NYSE)) {
    return pendiente('vela_futura', `La vela ${tipo} (${inicioPeriodo}) es posterior a la fecha de evaluación en Nueva York`, cierre);
  }

  const terminada = ahora.getTime() >= sesion.cierre_utc.getTime();
  const f = vela.confirmacion_fuente;
  if (!terminada) {
    if (f === 'cerrada') {
      return pendiente('fuente_contradice_calendario', `La fuente declara cerrada la vela ${tipo}, pero según el calendario la sesión cierra el ${cierre.nueva_york} (Nueva York)`, cierre);
    }
    return resultado('en_formacion', [{ codigo: 'sesion_en_curso', detalle: `La sesión de cierre (${cierre.nueva_york}, Nueva York) aún no termina` }], cierre);
  }
  if (f === 'cerrada') return resultado('confirmada', [], cierre);
  if (f === 'en_formacion') {
    return resultado('en_formacion', [{ codigo: 'fuente_en_formacion', detalle: `La sesión ya terminó, pero la fuente aún entrega la vela ${tipo} como en formación` }], cierre);
  }
  return pendiente('fuente_sin_confirmacion', `La sesión ya terminó, pero la fuente no confirma que la vela ${tipo} esté cerrada: el calendario y la hora no bastan`, cierre);
}

export function confirmarCierreVelas(entrada: EntradaCierreVelas, calendario: CalendarioNYSE = CALENDARIO_NYSE): ResultadoCierreVelas {
  const ambas = (r: ResultadoCierre): ResultadoCierreVelas => ({
    ultima_vela_diaria_cerrada: r.cerrada,
    ultima_vela_semanal_cerrada: r.cerrada,
    diaria: r,
    semanal: { ...r, motivos: r.motivos.map(m => ({ ...m })) },
  });

  const ahora = typeof entrada.evaluado_en === 'string' && CON_ZONA.test(entrada.evaluado_en) ? new Date(entrada.evaluado_en) : null;
  if (ahora === null || isNaN(ahora.getTime())) {
    return ambas(pendiente('entrada_invalida', `evaluado_en debe ser un instante ISO 8601 con zona (por ejemplo ...Z): ${String(entrada.evaluado_en)}`));
  }
  if (entrada.mercado === 'BMV') {
    return ambas(pendiente('calendario_bmv_no_definido', 'No hay calendario verificable de la BMV: no se asume que la vela esté cerrada'));
  }
  if (entrada.mercado !== 'US') {
    return ambas(pendiente('mercado_no_soportado', `Mercado no soportado: ${String(entrada.mercado)}`));
  }

  const diaria = resolver('diaria', entrada.diaria, ahora, calendario);
  const semanal = resolver('semanal', entrada.semanal, ahora, calendario);
  return {
    ultima_vela_diaria_cerrada: diaria.cerrada,
    ultima_vela_semanal_cerrada: semanal.cerrada,
    diaria,
    semanal,
  };
}
