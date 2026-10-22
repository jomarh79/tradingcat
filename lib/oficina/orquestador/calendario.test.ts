import { describe, expect, it } from 'vitest';
import {
  CALENDARIO_NYSE, CALENDARIO_NYSE_DATOS, ZONA_NYSE, ZONA_OFICINA, calendarioParaMotor, crearCalendarioNYSE, diaSemana,
  fechaEnZona, formatoEnZona, parseFecha, sumarDias, validarDatosCalendario,
} from './index';
import type { DatosCalendarioNYSE } from './index';

// ---------- Verificación independiente de los datos: festivos del NYSE recalculados por regla ----------
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const dow = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
/** n-ésimo día de la semana `semana` (0 = domingo) del mes. */
const nesimo = (y: number, m: number, semana: number, n: number) => iso(y, m, 1 + ((semana - dow(y, m, 1) + 7) % 7) + 7 * (n - 1));
const ultimoDe = (y: number, m: number, semana: number) => {
  const ult = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return iso(y, m, ult - ((dow(y, m, ult) - semana + 7) % 7));
};
/** Domingo de Pascua (algoritmo gregoriano anónimo). */
function pascua(y: number): { m: number; d: number } {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return { m: mes, d: dia };
}
/** Regla del NYSE: festivo en sábado se observa el viernes anterior; en domingo, el lunes siguiente. */
const observado = (y: number, m: number, d: number) => {
  const s = dow(y, m, d);
  return s === 6 ? sumarDias(iso(y, m, d), -1) : s === 0 ? sumarDias(iso(y, m, d), 1) : iso(y, m, d);
};
function feriadosPorRegla(y: number): string[] {
  const p = pascua(y);
  const out = [
    nesimo(y, 1, 1, 3),                         // Martin Luther King, Jr. (3.er lunes de enero)
    nesimo(y, 2, 1, 3),                         // Washington's Birthday (3.er lunes de febrero)
    sumarDias(iso(y, p.m, p.d), -2),            // Good Friday
    ultimoDe(y, 5, 1),                          // Memorial Day (último lunes de mayo)
    observado(y, 6, 19),                        // Juneteenth
    observado(y, 7, 4),                         // Independence Day
    nesimo(y, 9, 1, 1),                         // Labor Day (1.er lunes de septiembre)
    nesimo(y, 11, 4, 4),                        // Thanksgiving (4.º jueves de noviembre)
    observado(y, 12, 25),                       // Christmas
  ];
  if (dow(y, 1, 1) !== 6) out.push(observado(y, 1, 1)); // Año Nuevo en sábado: el NYSE no lo observa
  return out;
}

describe('datos del calendario NYSE (fuente oficial, consultada el 2026-10-21)', () => {
  it('pasan la validación: fechas reales, entre semana, sin repetidos y dentro de los años cubiertos', () => {
    expect(validarDatosCalendario(CALENDARIO_NYSE_DATOS)).toEqual([]);
  });
  it('los festivos de 2026 a 2028 coinciden con un recálculo independiente por regla (incluye Good Friday y festivos observados)', () => {
    const esperado = CALENDARIO_NYSE_DATOS.anios.flatMap(feriadosPorRegla).sort();
    expect([...CALENDARIO_NYSE_DATOS.feriados].sort()).toEqual(esperado);
  });
  it('cada año trae el día siguiente a Thanksgiving como cierre anticipado, y todo cierre anticipado es una sesión entre semana', () => {
    for (const y of CALENDARIO_NYSE_DATOS.anios) {
      expect(CALENDARIO_NYSE_DATOS.cierres_anticipados).toContain(sumarDias(nesimo(y, 11, 4, 4), 1));
    }
    for (const f of CALENDARIO_NYSE_DATOS.cierres_anticipados) expect(CALENDARIO_NYSE.consultar(f).estado).toBe('sesion');
  });
  it('trae la fuente y la fecha de consulta, y los horarios de cierre oficiales (16:00 y 13:00, hora de Nueva York)', () => {
    expect(CALENDARIO_NYSE_DATOS.url).toBe('https://www.nyse.com/trade/hours-calendars');
    expect(CALENDARIO_NYSE_DATOS.obtenido_el).toBe('2026-10-21');
    expect(CALENDARIO_NYSE_DATOS.hora_cierre_regular).toBe('16:00');
    expect(CALENDARIO_NYSE_DATOS.hora_cierre_anticipado).toBe('13:00');
  });
});

describe('validarDatosCalendario detecta datos malos', () => {
  const base = CALENDARIO_NYSE_DATOS;
  const con = (cambio: Partial<DatosCalendarioNYSE>): string[] => validarDatosCalendario({ ...base, ...cambio });
  it('festivo en fin de semana, repetido, inválido o fuera de los años cubiertos', () => {
    expect(con({ feriados: [...base.feriados, '2026-10-24'] }).join('|')).toContain('fin de semana');
    expect(con({ feriados: [...base.feriados, '2026-01-01'] }).join('|')).toContain('repetida');
    expect(con({ feriados: [...base.feriados, '2026-02-30'] }).join('|')).toContain('inválida');
    expect(con({ feriados: [...base.feriados, '2030-01-01'] }).join('|')).toContain('fuera de los años');
  });
  it('cierre anticipado en festivo o en fin de semana', () => {
    expect(con({ cierres_anticipados: [...base.cierres_anticipados, '2026-11-26'] }).join('|')).toContain('es feriado');
    expect(con({ cierres_anticipados: [...base.cierres_anticipados, '2026-11-28'] }).join('|')).toContain('fin de semana');
  });
  it('años vacíos o repetidos y horas mal escritas', () => {
    expect(con({ anios: [] }).join('|')).toContain('anios vacío');
    expect(con({ anios: [2026, 2026, 2027, 2028] }).join('|')).toContain('repetidos');
    expect(con({ hora_cierre_regular: '4pm' }).join('|')).toContain('hora_cierre_regular');
    expect(con({ hora_cierre_anticipado: '25:00' }).join('|')).toContain('hora_cierre_anticipado');
  });
  it('crearCalendarioNYSE se niega a construirse con datos malos', () => {
    expect(() => crearCalendarioNYSE({ ...base, feriados: [...base.feriados, '2026-10-24'] })).toThrow('inválidos');
  });
});

describe('fechas civiles', () => {
  it('parseFecha solo acepta fechas reales YYYY-MM-DD', () => {
    expect(parseFecha('2026-10-21')).toEqual({ y: 2026, m: 10, d: 21 });
    for (const mala of ['2026-02-30', '2026-13-01', '2026-1-1', 'ayer', '', '2026-10-21T10:00:00Z']) expect(parseFecha(mala)).toBeNull();
    expect(parseFecha('2028-02-29')).not.toBeNull();   // 2028 es bisiesto
    expect(parseFecha('2027-02-29')).toBeNull();
  });
  it('sumarDias cruza meses y años; diaSemana: 0 = domingo', () => {
    expect(sumarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(sumarDias('2026-03-01', -1)).toBe('2026-02-28');
    expect(diaSemana('2026-10-21')).toBe(3);   // miércoles
    expect(diaSemana('2026-10-25')).toBe(0);   // domingo
    expect(() => sumarDias('2026-02-30', 1)).toThrow();
    expect(() => diaSemana('x')).toThrow();
  });
});

describe('zonas horarias (sin diferencia fija)', () => {
  it('formatoEnZona y fechaEnZona respetan el horario de verano de Nueva York', () => {
    const verano = new Date('2026-10-21T20:00:00Z'), invierno = new Date('2026-11-02T21:00:00Z');
    expect(formatoEnZona(verano, ZONA_NYSE)).toBe('2026-10-21 16:00');
    expect(formatoEnZona(verano, ZONA_OFICINA)).toBe('2026-10-21 14:00');
    expect(formatoEnZona(invierno, ZONA_NYSE)).toBe('2026-11-02 16:00');
    expect(formatoEnZona(invierno, ZONA_OFICINA)).toBe('2026-11-02 15:00');
    // a la 1:00 UTC todavía es el día anterior en Nueva York
    expect(fechaEnZona(new Date('2026-10-22T01:00:00Z'), ZONA_NYSE)).toBe('2026-10-21');
  });
});

describe('sesiones y cierres', () => {
  const cierre = (f: string) => {
    const c = CALENDARIO_NYSE.consultar(f);
    if (c.estado !== 'sesion') throw new Error(`no es sesión: ${f}`);
    return c.sesion;
  };
  it('día normal en horario de verano: cierra a las 16:00 de Nueva York = 20:00 UTC', () => {
    expect(cierre('2026-10-21').cierre_utc.toISOString()).toBe('2026-10-21T20:00:00.000Z');
    expect(cierre('2026-10-21').cierre_anticipado).toBe(false);
  });
  it('día normal en horario de invierno: 16:00 de Nueva York = 21:00 UTC', () => {
    expect(cierre('2026-11-02').cierre_utc.toISOString()).toBe('2026-11-02T21:00:00.000Z');
  });
  it('el cambio de horario se resuelve por fecha: viernes 6-mar (invierno) y lunes 9-mar (verano, desde el domingo 8)', () => {
    expect(cierre('2026-03-06').cierre_utc.toISOString()).toBe('2026-03-06T21:00:00.000Z');
    expect(cierre('2026-03-09').cierre_utc.toISOString()).toBe('2026-03-09T20:00:00.000Z');
  });
  it('cierre anticipado a las 13:00 de Nueva York (viernes después de Thanksgiving, en horario de invierno = 18:00 UTC)', () => {
    const s = cierre('2026-11-27');
    expect(s.cierre_anticipado).toBe(true);
    expect(s.hora_cierre).toBe('13:00');
    expect(s.cierre_utc.toISOString()).toBe('2026-11-27T18:00:00.000Z');
  });
  it('fines de semana y festivos no son sesión, y se distingue el motivo', () => {
    expect(CALENDARIO_NYSE.consultar('2026-10-24')).toEqual({ estado: 'no_es_sesion', motivo: 'fin_de_semana' });
    expect(CALENDARIO_NYSE.consultar('2026-11-26')).toEqual({ estado: 'no_es_sesion', motivo: 'feriado' });
    expect(CALENDARIO_NYSE.consultar('2026-07-03')).toEqual({ estado: 'no_es_sesion', motivo: 'feriado' });   // Independence Day observado
    expect(CALENDARIO_NYSE.consultar('2027-12-31')).toEqual({ estado: 'sesion', sesion: expect.anything() });  // Año Nuevo 2028 no se observa
  });
  it('fecha inválida o fuera de los años cubiertos: el calendario no responde', () => {
    expect(CALENDARIO_NYSE.consultar('2026-02-30')).toEqual({ estado: 'fecha_invalida' });
    expect(CALENDARIO_NYSE.consultar('2029-03-05')).toEqual({ estado: 'no_cubierta' });
    expect(CALENDARIO_NYSE.consultar('2025-12-31')).toEqual({ estado: 'no_cubierta' });
  });
  it('esDiaHabil (interfaz del Motor): responde para fechas cubiertas y lanza error, sin adivinar, para las demás', () => {
    expect(CALENDARIO_NYSE.esDiaHabil('2026-10-21')).toBe(true);
    expect(CALENDARIO_NYSE.esDiaHabil('2026-11-27')).toBe(true);    // cierre anticipado: sigue siendo día hábil
    expect(CALENDARIO_NYSE.esDiaHabil('2026-11-26')).toBe(false);
    expect(CALENDARIO_NYSE.esDiaHabil('2026-10-24')).toBe(false);
    expect(() => CALENDARIO_NYSE.esDiaHabil('2029-03-05')).toThrow('no cubre');
    expect(() => CALENDARIO_NYSE.esDiaHabil('basura')).toThrow('inválida');
  });
});

describe('cobertura', () => {
  it('cubre y cubreRango exigen todos los años del rango', () => {
    expect(CALENDARIO_NYSE.cubre('2027-06-01')).toBe(true);
    expect(CALENDARIO_NYSE.cubre('2029-01-01')).toBe(false);
    expect(CALENDARIO_NYSE.cubre('x')).toBe(false);
    expect(CALENDARIO_NYSE.cubreRango('2026-12-20', '2027-01-10')).toBe(true);
    expect(CALENDARIO_NYSE.cubreRango('2028-12-20', '2029-01-10')).toBe(false);
    expect(CALENDARIO_NYSE.cubreRango('2027-01-10', '2026-12-20')).toBe(false);
    expect(CALENDARIO_NYSE.cubreRango('x', '2027-01-10')).toBe(false);
    const sinMedio = crearCalendarioNYSE({ ...CALENDARIO_NYSE_DATOS, anios: [2026, 2028], feriados: CALENDARIO_NYSE_DATOS.feriados.filter(f => !f.startsWith('2027')), cierres_anticipados: CALENDARIO_NYSE_DATOS.cierres_anticipados.filter(f => !f.startsWith('2027')) });
    expect(sinMedio.cubreRango('2026-12-01', '2028-01-31')).toBe(false);   // falta 2027 en medio
  });
});

describe('última sesión de la semana', () => {
  const ult = (f: string) => CALENDARIO_NYSE.ultimaSesionDeSemana(f);
  it('semana normal: el viernes, sin importar qué día de la semana se pregunte (lunes a domingo)', () => {
    for (const f of ['2026-10-12', '2026-10-14', '2026-10-16', '2026-10-17', '2026-10-18']) {
      const r = ult(f);
      expect(r).toMatchObject({ estado: 'sesion', lunes: '2026-10-12', domingo: '2026-10-18' });
      if (r.estado === 'sesion') expect(r.sesion.fecha).toBe('2026-10-16');
    }
  });
  it('el domingo pertenece a la semana que termina, no a la siguiente', () => {
    const r = ult('2026-10-18');
    expect(r).toMatchObject({ estado: 'sesion', lunes: '2026-10-12' });
  });
  it('semana con viernes festivo (Good Friday 2026): la última sesión es el jueves', () => {
    const r = ult('2026-03-30');
    expect(r.estado).toBe('sesion');
    if (r.estado === 'sesion') {
      expect(r.sesion.fecha).toBe('2026-04-02');
      expect(r.sesion.cierre_utc.toISOString()).toBe('2026-04-02T20:00:00.000Z');
    }
  });
  it('semana de Thanksgiving: el viernes con cierre anticipado', () => {
    const r = ult('2026-11-24');
    expect(r.estado).toBe('sesion');
    if (r.estado === 'sesion') {
      expect(r.sesion.fecha).toBe('2026-11-27');
      expect(r.sesion.cierre_anticipado).toBe(true);
    }
  });
  it('semana con festivo el lunes y el viernes (4 de julio de 2028 es martes): sigue habiendo sesiones', () => {
    const r = ult('2028-07-03');
    expect(r.estado).toBe('sesion');
    if (r.estado === 'sesion') expect(r.sesion.fecha).toBe('2028-07-07');
  });
  it('semana que toca un año no cubierto: no responde (primera semana de 2026 incluye diciembre de 2025; la semana del 1 de enero de 2029 está fuera de los datos)', () => {
    expect(ult('2026-01-01')).toEqual({ estado: 'no_cubierta' });
    expect(ult('2029-01-02')).toEqual({ estado: 'no_cubierta' });
    // la última semana de 2028 (lun 25-dic a dom 31-dic) está completa dentro de 2028: sí responde
    expect(ult('2028-12-28').estado).toBe('sesion');
  });
  it('semana que empieza en un año cubierto y termina en uno no cubierto: no responde (lun 2026-12-28 a dom 2027-01-03)', () => {
    const soloAnio2026 = crearCalendarioNYSE({ ...CALENDARIO_NYSE_DATOS, anios: [2026], feriados: CALENDARIO_NYSE_DATOS.feriados.filter(f => f.startsWith('2026')), cierres_anticipados: CALENDARIO_NYSE_DATOS.cierres_anticipados.filter(f => f.startsWith('2026')) });
    expect(soloAnio2026.ultimaSesionDeSemana('2026-12-30')).toEqual({ estado: 'no_cubierta' });
    expect(CALENDARIO_NYSE.ultimaSesionDeSemana('2026-12-30').estado).toBe('sesion');
  });
  it('fecha inválida y semana sin ninguna sesión', () => {
    expect(ult('2026-02-30')).toEqual({ estado: 'fecha_invalida' });
    const sinSesiones = crearCalendarioNYSE({
      ...CALENDARIO_NYSE_DATOS, anios: [2026], cierres_anticipados: [],
      feriados: ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'],
    });
    expect(sinSesiones.ultimaSesionDeSemana('2026-10-14')).toEqual({ estado: 'sin_sesiones', lunes: '2026-10-12', domingo: '2026-10-18' });
  });
});

describe('calendarioParaMotor', () => {
  it('con cobertura entrega el calendario; el Motor puede preguntar días hábiles', () => {
    const cal = calendarioParaMotor(CALENDARIO_NYSE, new Date('2026-10-21T20:41:00Z'));
    expect(cal).not.toBeNull();
    expect(cal!.esDiaHabil('2026-10-22')).toBe(true);
    expect(cal!.esDiaHabil('2026-11-26')).toBe(false);
  });
  it('si el plazo que puede recorrer el Motor sale de los años cubiertos devuelve null (así el Motor dice calendario_no_definido)', () => {
    expect(calendarioParaMotor(CALENDARIO_NYSE, new Date('2028-12-20T15:00:00Z'))).toBeNull();
    expect(calendarioParaMotor(CALENDARIO_NYSE, new Date('2025-06-01T15:00:00Z'))).toBeNull();
  });
  it('la fecha de emisión se toma en la zona del NYSE', () => {
    // 2029-01-01T03:00Z es todavía 31-dic-2028 en Nueva York; +20 días cae en 2029 (no cubierto) en ambos casos
    expect(calendarioParaMotor(CALENDARIO_NYSE, new Date('2029-01-01T03:00:00Z'))).toBeNull();
    // 2026-01-01T03:00Z es 31-dic-2025 en Nueva York: año no cubierto, aunque en UTC ya sea 2026
    expect(calendarioParaMotor(CALENDARIO_NYSE, new Date('2026-01-01T03:00:00Z'))).toBeNull();
  });
});
