// Calendario del NYSE para la Oficina: qué días hay sesión, a qué hora cierra cada una y conversión de zonas horarias.
// Funciones puras: no leen el reloj. Los horarios se interpretan en America/New_York (el cambio de horario de verano
// lo resuelve Intl, nunca una diferencia fija) y se muestran también en America/Mexico_City.
// Fuera de los años cubiertos por los datos el calendario NO responde: no supone que un día sea hábil ni que esté cerrado.

import { CALENDARIO_NYSE_DATOS } from './calendario-nyse';
import type { DatosCalendarioNYSE } from './calendario-nyse';

export const ZONA_NYSE = 'America/New_York';
export const ZONA_OFICINA = 'America/Mexico_City';

// ---------- Fechas civiles (YYYY-MM-DD) ----------

export function parseFecha(fechaISO: string): { y: number; m: number; d: number } | null {
  const r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaISO);
  if (!r) return null;
  const y = Number(r[1]), m = Number(r[2]), d = Number(r[3]);
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return { y, m, d };
}

function aISO(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Suma días a una fecha civil válida. */
export function sumarDias(fechaISO: string, dias: number): string {
  const p = parseFecha(fechaISO);
  if (!p) throw new Error(`fecha inválida: ${fechaISO}`);
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + dias));
  return aISO(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** 0 = domingo ... 6 = sábado. */
export function diaSemana(fechaISO: string): number {
  const p = parseFecha(fechaISO);
  if (!p) throw new Error(`fecha inválida: ${fechaISO}`);
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
}

// ---------- Zonas horarias ----------

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

/** Fecha y hora civiles en una zona -> instante UTC (dos pasadas para absorber el cambio de horario). */
function civilAInstante(p: Partes, zona: string): Date {
  const aprox = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  let instante = new Date(aprox - compensacionMs(new Date(aprox), zona));
  instante = new Date(aprox - compensacionMs(instante, zona));
  return instante;
}

/** Fecha civil (YYYY-MM-DD) de un instante en una zona. */
export function fechaEnZona(instante: Date, zona: string): string {
  const p = partesEnZona(instante, zona);
  return aISO(p.y, p.mo, p.d);
}

/** «YYYY-MM-DD HH:mm» de un instante en una zona. */
export function formatoEnZona(instante: Date, zona: string): string {
  const p = partesEnZona(instante, zona);
  return `${aISO(p.y, p.mo, p.d)} ${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`;
}

// ---------- Calendario ----------

export interface SesionNYSE {
  fecha: string;
  cierre_anticipado: boolean;
  /** HH:MM, hora de Nueva York. */
  hora_cierre: string;
  cierre_utc: Date;
}

export type ConsultaFecha =
  | { estado: 'sesion'; sesion: SesionNYSE }
  | { estado: 'no_es_sesion'; motivo: 'fin_de_semana' | 'feriado' }
  | { estado: 'no_cubierta' }
  | { estado: 'fecha_invalida' };

export type ConsultaSemana =
  | { estado: 'sesion'; sesion: SesionNYSE; lunes: string; domingo: string }
  | { estado: 'sin_sesiones'; lunes: string; domingo: string }
  | { estado: 'no_cubierta' }
  | { estado: 'fecha_invalida' };

export interface CalendarioNYSE {
  datos: DatosCalendarioNYSE;
  /** true si el año de la fecha está entre los años cubiertos. */
  cubre(fechaISO: string): boolean;
  /** true si todos los años entre las dos fechas (inclusive) están cubiertos. */
  cubreRango(desdeISO: string, hastaISO: string): boolean;
  consultar(fechaISO: string): ConsultaFecha;
  /** Compatible con `CalendarioHabil` del Motor. Lanza error si la fecha es inválida o no está cubierta: no adivina. */
  esDiaHabil(fechaISO: string): boolean;
  /** Última sesión de la semana (lunes a domingo) que contiene la fecha. Exige que la semana completa esté cubierta. */
  ultimaSesionDeSemana(fechaISO: string): ConsultaSemana;
}

const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Revisa los datos del calendario. Devuelve la lista de problemas (vacía si están bien). */
export function validarDatosCalendario(datos: DatosCalendarioNYSE): string[] {
  const err: string[] = [];
  const aniosLista = datos.cobertura.map(c => c.anio);
  if (aniosLista.length === 0) err.push('cobertura vacía');
  if (new Set(aniosLista).size !== aniosLista.length) err.push('cobertura con años repetidos');
  for (const c of datos.cobertura) {
    if (!Number.isInteger(c.anio)) err.push(`cobertura: año inválido ${String(c.anio)}`);
    if (typeof c.fuente !== 'string' || c.fuente.trim() === '') err.push(`cobertura ${String(c.anio)}: falta la fuente`);
    if (typeof c.url !== 'string' || !/^https:\/\//.test(c.url)) err.push(`cobertura ${String(c.anio)}: url inválida`);
    if (parseFecha(c.consultado_el) === null) err.push(`cobertura ${String(c.anio)}: consultado_el inválida: ${String(c.consultado_el)}`);
  }
  if (!HORA.test(datos.hora_cierre_regular)) err.push(`hora_cierre_regular inválida: ${datos.hora_cierre_regular}`);
  if (!HORA.test(datos.hora_cierre_anticipado)) err.push(`hora_cierre_anticipado inválida: ${datos.hora_cierre_anticipado}`);
  const anios = new Set(aniosLista);
  const feriados = new Set<string>();
  const revisar = (lista: string[], nombre: string, permiteFinde: boolean) => {
    const vistos = new Set<string>();
    for (const f of lista) {
      const p = parseFecha(f);
      if (!p) { err.push(`${nombre}: fecha inválida ${f}`); continue; }
      if (vistos.has(f)) err.push(`${nombre}: fecha repetida ${f}`);
      vistos.add(f);
      if (!anios.has(p.y)) err.push(`${nombre}: ${f} fuera de los años cubiertos`);
      const dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
      if (!permiteFinde && (dow === 0 || dow === 6)) err.push(`${nombre}: ${f} cae en fin de semana`);
    }
  };
  revisar(datos.feriados, 'feriados', false);
  datos.feriados.forEach(f => feriados.add(f));
  revisar(datos.cierres_anticipados, 'cierres_anticipados', false);
  for (const f of datos.cierres_anticipados) {
    if (feriados.has(f)) err.push(`cierres_anticipados: ${f} es feriado`);
  }
  return err;
}

export function crearCalendarioNYSE(datos: DatosCalendarioNYSE = CALENDARIO_NYSE_DATOS): CalendarioNYSE {
  const problemas = validarDatosCalendario(datos);
  if (problemas.length > 0) throw new Error(`Datos del calendario NYSE inválidos: ${problemas.join('; ')}`);
  const anios = new Set(datos.cobertura.map(c => c.anio));
  const feriados = new Set(datos.feriados);
  const anticipados = new Set(datos.cierres_anticipados);

  const cubre = (fechaISO: string): boolean => {
    const p = parseFecha(fechaISO);
    return p !== null && anios.has(p.y);
  };

  const consultar = (fechaISO: string): ConsultaFecha => {
    const p = parseFecha(fechaISO);
    if (!p) return { estado: 'fecha_invalida' };
    if (!anios.has(p.y)) return { estado: 'no_cubierta' };
    const dow = diaSemana(fechaISO);
    if (dow === 0 || dow === 6) return { estado: 'no_es_sesion', motivo: 'fin_de_semana' };
    if (feriados.has(fechaISO)) return { estado: 'no_es_sesion', motivo: 'feriado' };
    const anticipado = anticipados.has(fechaISO);
    const hora = anticipado ? datos.hora_cierre_anticipado : datos.hora_cierre_regular;
    const [h, mi] = hora.split(':').map(Number) as [number, number];
    const cierre_utc = civilAInstante({ y: p.y, mo: p.m, d: p.d, h, mi, s: 0 }, ZONA_NYSE);
    return { estado: 'sesion', sesion: { fecha: fechaISO, cierre_anticipado: anticipado, hora_cierre: hora, cierre_utc } };
  };

  return {
    datos,
    cubre,
    cubreRango(desdeISO, hastaISO) {
      const a = parseFecha(desdeISO), b = parseFecha(hastaISO);
      if (!a || !b || a.y > b.y) return false;
      for (let y = a.y; y <= b.y; y++) if (!anios.has(y)) return false;
      return true;
    },
    consultar,
    esDiaHabil(fechaISO) {
      const c = consultar(fechaISO);
      if (c.estado === 'fecha_invalida') throw new Error(`fecha inválida: ${fechaISO}`);
      if (c.estado === 'no_cubierta') throw new Error(`El calendario del NYSE no cubre la fecha ${fechaISO}: agrega el año a calendario-nyse.ts desde la fuente oficial`);
      return c.estado === 'sesion';
    },
    ultimaSesionDeSemana(fechaISO) {
      if (parseFecha(fechaISO) === null) return { estado: 'fecha_invalida' };
      const lunes = sumarDias(fechaISO, -((diaSemana(fechaISO) + 6) % 7));
      const domingo = sumarDias(lunes, 6);
      if (!cubre(lunes) || !cubre(domingo)) return { estado: 'no_cubierta' };
      for (let i = 6; i >= 0; i--) {
        const c = consultar(sumarDias(lunes, i));
        if (c.estado === 'sesion') return { estado: 'sesion', sesion: c.sesion, lunes, domingo };
      }
      return { estado: 'sin_sesiones', lunes, domingo };
    },
  };
}

/** Calendario con los datos oficiales vigentes. */
export const CALENDARIO_NYSE: CalendarioNYSE = crearCalendarioNYSE();

/** Adaptador para el Motor (`CalendarioHabil` de expiracion.ts). Devuelve null si el calendario no cubre el plazo que el Motor
 *  puede recorrer desde la emisión (así el Motor responde `calendario_no_definido` en vez de lanzar un error). */
export function calendarioParaMotor(
  cal: CalendarioNYSE, fecha_emision: Date, margen_dias = 20,
): { esDiaHabil(fechaISO: string): boolean } | null {
  const desde = fechaEnZona(fecha_emision, ZONA_NYSE);
  if (!cal.cubreRango(desde, sumarDias(desde, margen_dias))) return null;
  return { esDiaHabil: f => cal.esDiaHabil(f) };
}
