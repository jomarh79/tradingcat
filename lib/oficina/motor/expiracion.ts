// Expiración de decisiones pendientes (contrato del Motor, sección 7).
// Plazo: 1 día hábil (plazo_expiracion_decision_pendiente). Días hábiles según el calendario del NYSE;
// horario en America/Mexico_City. La lista de feriados NO está en este módulo: la entrega una fuente
// verificable mediante CalendarioHabil. Sin calendario no se declara ninguna expiración.

import type { EstadoUsuario } from './tipos';

export interface CalendarioHabil {
  /** fecha ISO YYYY-MM-DD, tomada en la zona del calendario (America/New_York para el NYSE). */
  esDiaHabil(fechaISO: string): boolean;
}

export const ZONA_CALENDARIO = 'America/New_York';
export const ZONA_OFICINA = 'America/Mexico_City';

interface Partes { y: number; mo: number; d: number; h: number; mi: number; s: number }

function partesEnZona(instante: Date, zona: string): Partes {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(instante)) {
    if (x.type !== 'literal') p[x.type] = Number(x.value);
  }
  return { y: p.year!, mo: p.month!, d: p.day!, h: p.hour!, mi: p.minute!, s: p.second! };
}

function compensacionMs(instante: Date, zona: string): number {
  const p = partesEnZona(instante, zona);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(instante.getTime() / 1000) * 1000;
}

/** Fecha y hora civiles en una zona -> instante UTC. */
function civilAInstante(p: Partes, zona: string): Date {
  const aprox = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  let instante = new Date(aprox - compensacionMs(new Date(aprox), zona));
  instante = new Date(aprox - compensacionMs(instante, zona));
  return instante;
}

function iso(y: number, mo: number, d: number): string {
  return `${y.toString().padStart(4, '0')}-${mo.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
}

function sumarDias(fechaISO: string, dias: number): string {
  const [y, m, d] = fechaISO.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + dias));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Primer día hábil estrictamente posterior a la fecha dada (repetido `n` veces). */
export function siguienteDiaHabil(fechaISO: string, cal: CalendarioHabil, n = 1): string {
  let actual = fechaISO;
  for (let i = 0; i < n; i++) {
    let candidato = sumarDias(actual, 1);
    for (let guardia = 0; !cal.esDiaHabil(candidato); guardia++) {
      if (guardia > 15) throw new Error('El calendario no devuelve ningún día hábil en 15 días: revisa la fuente de feriados');
      candidato = sumarDias(candidato, 1);
    }
    actual = candidato;
  }
  return actual;
}

/** Vencimiento: misma hora de reloj (en la zona de la Oficina) del día hábil que corresponde.
 *  La fecha de emisión se toma en la zona del calendario para decidir qué día es hábil. */
export function calcularVencimiento(args: {
  fecha_emision: Date;
  calendario: CalendarioHabil;
  dias_habiles?: number;
  zona_oficina?: string;
  zona_calendario?: string;
}): Date {
  const zonaOf = args.zona_oficina ?? ZONA_OFICINA;
  const zonaCal = args.zona_calendario ?? ZONA_CALENDARIO;
  const emCal = partesEnZona(args.fecha_emision, zonaCal);
  const fechaEmisionCal = iso(emCal.y, emCal.mo, emCal.d);
  const objetivo = siguienteDiaHabil(fechaEmisionCal, args.calendario, args.dias_habiles ?? 1);
  const reloj = partesEnZona(args.fecha_emision, zonaOf);
  const [y, mo, d] = objetivo.split('-').map(Number) as [number, number, number];
  return civilAInstante({ y, mo, d, h: reloj.h, mi: reloj.mi, s: reloj.s }, zonaOf);
}

export type ResultadoExpiracion =
  | { expira: boolean; vence_en: Date; motivo: 'vencida' | 'vigente' }
  | { expira: false; vence_en: null; motivo: 'no_aplica' | 'calendario_no_definido' | 'plazo_no_definido' };

export function evaluarExpiracion(args: {
  estado_usuario: EstadoUsuario;
  requiere_autorizacion: boolean;
  fecha_emision: Date;
  ahora: Date;
  calendario?: CalendarioHabil | null;
  plazo_dias_habiles?: number | null;
}): ResultadoExpiracion {
  if (!args.requiere_autorizacion || args.estado_usuario !== 'pendiente') {
    return { expira: false, vence_en: null, motivo: 'no_aplica' };
  }
  if (args.plazo_dias_habiles == null) {
    return { expira: false, vence_en: null, motivo: 'plazo_no_definido' };
  }
  if (!args.calendario) {
    return { expira: false, vence_en: null, motivo: 'calendario_no_definido' };
  }
  const vence_en = calcularVencimiento({
    fecha_emision: args.fecha_emision, calendario: args.calendario, dias_habiles: args.plazo_dias_habiles,
  });
  const vencida = args.ahora.getTime() >= vence_en.getTime();
  return { expira: vencida, vence_en, motivo: vencida ? 'vencida' : 'vigente' };
}
