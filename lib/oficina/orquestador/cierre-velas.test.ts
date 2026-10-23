import { describe, expect, it } from 'vitest';
import { CALENDARIO_NYSE_DATOS, MARGEN_CIERRE_MINUTOS, confirmarCierreVelas, crearCalendarioNYSE } from './index';
import type { EntradaCierreVelas, Mercado, OpcionesCierreVelas, ResultadoCierre, VelaFuente } from './index';

// Regla (21-oct): sin marca de «cerrada» en la fuente. Cerrada si la sesión es anterior a hoy en America/Mexico_City, o si es de hoy
// y ya pasó el cierre del NYSE (16:00 ET o cierre anticipado) más MARGEN_CIERRE_MINUTOS.

const v = (fecha: string): VelaFuente => ({ fecha });
const entrada = (evaluado_en: string, diaria: VelaFuente | null, semanal: VelaFuente | null = null, mercado: Mercado = 'US'): EntradaCierreVelas =>
  ({ mercado, evaluado_en, diaria, semanal });
const codigos = (r: ResultadoCierre) => r.motivos.map(m => m.codigo);
const diaria = (ev: string, fecha: string, opc: OpcionesCierreVelas = {}) => confirmarCierreVelas(entrada(ev, v(fecha)), undefined, opc).diaria;
const semanal = (ev: string, fecha: string, opc: OpcionesCierreVelas = {}) => confirmarCierreVelas(entrada(ev, null, v(fecha)), undefined, opc).semanal;
const soloAnios = (anios: number[]) => CALENDARIO_NYSE_DATOS.cobertura.filter(c => anios.includes(c.anio));

describe('el margen es un parámetro nombrado', () => {
  it('MARGEN_CIERRE_MINUTOS vale 30 y es el valor por omisión', () => {
    expect(MARGEN_CIERRE_MINUTOS).toBe(30);
    expect(diaria('2026-10-21T20:30:00Z', '2026-10-21')).toEqual(diaria('2026-10-21T20:30:00Z', '2026-10-21', { margen_cierre_minutos: 30 }));
    expect(diaria('2026-10-21T20:29:59Z', '2026-10-21')).toEqual(diaria('2026-10-21T20:29:59Z', '2026-10-21', { margen_cierre_minutos: 30 }));
  });
  it('se puede ajustar: 0 minutos confirma en el cierre; 60 minutos espera una hora; admite fracciones', () => {
    expect(diaria('2026-10-21T20:00:00Z', '2026-10-21', { margen_cierre_minutos: 0 }).cerrada).toBe(true);
    expect(diaria('2026-10-21T19:59:59Z', '2026-10-21', { margen_cierre_minutos: 0 }).cerrada).toBe(false);
    expect(diaria('2026-10-21T20:59:59Z', '2026-10-21', { margen_cierre_minutos: 60 }).cerrada).toBe(false);
    const r = diaria('2026-10-21T21:00:00Z', '2026-10-21', { margen_cierre_minutos: 60 });
    expect(r.cerrada).toBe(true);
    expect(r.cierre_esperado).toMatchObject({ margen_minutos: 60, confirmable_desde_utc: '2026-10-21T21:00:00.000Z' });
    expect(diaria('2026-10-21T20:00:29Z', '2026-10-21', { margen_cierre_minutos: 0.5 }).cerrada).toBe(false);
    expect(diaria('2026-10-21T20:00:30Z', '2026-10-21', { margen_cierre_minutos: 0.5 }).cerrada).toBe(true);
  });
  it('un margen negativo, no numérico o infinito se rechaza como entrada inválida', () => {
    for (const malo of [-1, NaN, Infinity, '30', null]) {
      const r = confirmarCierreVelas(entrada('2026-10-21T22:00:00Z', v('2026-10-21'), v('2026-10-12')), undefined, { margen_cierre_minutos: malo as never });
      expect(r.ultima_vela_diaria_cerrada).toBe(false);
      expect(r.ultima_vela_semanal_cerrada).toBe(false);
      expect(codigos(r.diaria)).toEqual(['entrada_invalida']);
      expect(codigos(r.semanal)).toEqual(['entrada_invalida']);
      expect(r.diaria.estado).toBe('pendiente');
    }
  });
});

describe('vela diaria: cierre del NYSE más margen', () => {
  it('a las 16:00 de Nueva York (20:00 UTC en horario de verano) + 30 min queda confirmada, con el cierre esperado en tres zonas y el instante desde el que se confirma', () => {
    const r = confirmarCierreVelas(entrada('2026-10-21T20:30:00Z', v('2026-10-21')));
    expect(r.ultima_vela_diaria_cerrada).toBe(true);
    expect(r.diaria).toEqual({
      cerrada: true, estado: 'confirmada', motivos: [],
      cierre_esperado: {
        fecha_sesion: '2026-10-21', anticipado: false, utc: '2026-10-21T20:00:00.000Z', nueva_york: '2026-10-21 16:00', ciudad_de_mexico: '2026-10-21 14:00',
        margen_minutos: 30, confirmable_desde_utc: '2026-10-21T20:30:00.000Z',
      },
    });
  });
  it('un instante antes de cumplirse el margen no está cerrada: en formación con el motivo «margen_de_cierre»', () => {
    for (const ev of ['2026-10-21T20:00:00Z', '2026-10-21T20:15:00Z', '2026-10-21T20:29:59.999Z']) {
      const r = diaria(ev, '2026-10-21');
      expect(r.cerrada).toBe(false);
      expect(r.estado).toBe('en_formacion');
      expect(codigos(r)).toEqual(['margen_de_cierre']);
    }
  });
  it('antes del cierre del NYSE: en formación con el motivo «sesion_en_curso»', () => {
    const r = diaria('2026-10-21T19:59:59Z', '2026-10-21');
    expect(r.cerrada).toBe(false);
    expect(r.estado).toBe('en_formacion');
    expect(codigos(r)).toEqual(['sesion_en_curso']);
  });
  it('al día siguiente en Ciudad de México (o días después) la vela de la sesión anterior está cerrada', () => {
    expect(diaria('2026-10-22T14:00:00Z', '2026-10-21').cerrada).toBe(true);
    expect(diaria('2026-10-26T14:00:00Z', '2026-10-21').cerrada).toBe(true);
  });
  it('«anterior a hoy en Ciudad de México» cuenta por sí sola, aunque no se cumpla el margen (margen de 1000 min)', () => {
    const opc = { margen_cierre_minutos: 1000 };
    // 07:00 UTC del 22 = 01:00 del 22 en Ciudad de México: la sesión del 21 es anterior a hoy; el margen terminaría hasta las 12:40 UTC
    expect(diaria('2026-10-22T07:00:00Z', '2026-10-21', opc).cerrada).toBe(true);
    // a las 23:00 UTC del 21 todavía es 21 en Ciudad de México y el margen no se cumple
    const r = diaria('2026-10-21T23:00:00Z', '2026-10-21', opc);
    expect(r.cerrada).toBe(false);
    expect(codigos(r)).toEqual(['margen_de_cierre']);
  });
  it('la «fecha de hoy» se toma en Ciudad de México: a las 22:30 del 21 allá (04:30 UTC del 22) la sesión del 21 ya cumplió el margen; la del 22 apenas va a empezar', () => {
    expect(diaria('2026-10-22T04:30:00Z', '2026-10-21').cerrada).toBe(true);
    // con un margen enorme, a las 22:30 del 21 en Ciudad de México (ya es 22 en Nueva York y en UTC) la sesión del 21 NO es anterior a hoy allá
    expect(diaria('2026-10-22T04:30:00Z', '2026-10-21', { margen_cierre_minutos: 1000 }).cerrada).toBe(false);
    const r = diaria('2026-10-22T04:30:00Z', '2026-10-22');
    expect(r.cerrada).toBe(false);
    expect(codigos(r)).toEqual(['sesion_en_curso']);
  });
  it('acepta el instante con otra zona: 14:30 en Ciudad de México (UTC-6) es cierre + 30 min del 21-oct', () => {
    expect(diaria('2026-10-21T14:30:00-06:00', '2026-10-21').cerrada).toBe(true);
    expect(diaria('2026-10-21T14:29:59-06:00', '2026-10-21').cerrada).toBe(false);
  });
});

describe('cierre anticipado y horario de verano', () => {
  it('el viernes después de Thanksgiving el mercado cierra a la 1:00 p. m. (18:00 UTC; 12:00 en Ciudad de México): se confirma a las 18:30 UTC, no a las 20:30', () => {
    expect(diaria('2026-11-27T17:59:59Z', '2026-11-27').cerrada).toBe(false);
    expect(diaria('2026-11-27T18:29:59Z', '2026-11-27').cerrada).toBe(false);
    const r = diaria('2026-11-27T18:30:00Z', '2026-11-27');
    expect(r.cerrada).toBe(true);
    expect(r.cierre_esperado).toEqual({
      fecha_sesion: '2026-11-27', anticipado: true, utc: '2026-11-27T18:00:00.000Z', nueva_york: '2026-11-27 13:00', ciudad_de_mexico: '2026-11-27 12:00',
      margen_minutos: 30, confirmable_desde_utc: '2026-11-27T18:30:00.000Z',
    });
  });
  it('antes y después del cambio de horario de EE. UU. el cierre se mueve de hora UTC (20:00 el 30-oct, 21:00 el 2-nov) y en Ciudad de México de 14:00 a 15:00', () => {
    const a = diaria('2026-10-30T20:30:00Z', '2026-10-30');
    expect(a.cierre_esperado).toMatchObject({ utc: '2026-10-30T20:00:00.000Z', ciudad_de_mexico: '2026-10-30 14:00' });
    expect(a.cerrada).toBe(true);
    expect(diaria('2026-11-02T20:30:00Z', '2026-11-02').cerrada).toBe(false);   // con la hora de verano ya habría cerrado: aquí aún no
    const b = diaria('2026-11-02T21:00:00Z', '2026-11-02');
    expect(b.cierre_esperado).toMatchObject({ utc: '2026-11-02T21:00:00.000Z', ciudad_de_mexico: '2026-11-02 15:00', confirmable_desde_utc: '2026-11-02T21:30:00.000Z' });
    expect(b.cerrada).toBe(false);
    expect(diaria('2026-11-02T21:30:00Z', '2026-11-02').cerrada).toBe(true);
  });
});

describe('vela diaria incoherente con el calendario', () => {
  const pend = (fecha: string, ev = '2026-12-01T22:00:00Z') => diaria(ev, fecha);
  it('festivo, fin de semana y fecha inválida: pendiente, nunca cerrada', () => {
    expect(codigos(pend('2026-11-26'))).toEqual(['fecha_no_es_sesion']);      // Thanksgiving
    expect(pend('2026-11-26').motivos[0]!.detalle).toContain('feriado');
    expect(codigos(pend('2026-11-28'))).toEqual(['fecha_no_es_sesion']);      // sábado
    expect(pend('2026-11-28').motivos[0]!.detalle).toContain('fin de semana');
    expect(codigos(pend('2026-02-30'))).toEqual(['fecha_invalida']);
    for (const f of ['2026-11-26', '2026-11-28', '2026-02-30']) {
      expect(pend(f).cerrada).toBe(false);
      expect(pend(f).estado).toBe('pendiente');
    }
  });
  it('el calendario no cubre el año de la fecha: NO_EVALUABLE (no pendiente), sin cierre esperado', () => {
    const r = pend('2030-06-03', '2030-06-04T22:00:00Z');
    expect(codigos(r)).toEqual(['calendario_no_cubre_fecha']);
    expect(r.estado).toBe('no_evaluable');
    expect(r.cerrada).toBe(false);
    expect(r.cierre_esperado).toBeNull();
    expect(pend('2025-12-31', '2026-01-05T22:00:00Z').estado).toBe('no_evaluable');
  });
  it('una vela con fecha posterior a la evaluación (en Nueva York) es pendiente: a la 1:00 UTC del 22 todavía es 21 en Nueva York', () => {
    expect(codigos(pend('2026-10-23', '2026-10-21T15:00:00Z'))).toEqual(['vela_futura']);
    expect(codigos(pend('2026-10-22', '2026-10-22T01:00:00Z'))).toEqual(['vela_futura']);
  });
  it('sin vela: pendiente', () => {
    const r = confirmarCierreVelas(entrada('2026-10-21T21:00:00Z', null));
    expect(r.ultima_vela_diaria_cerrada).toBe(false);
    expect(codigos(r.diaria)).toEqual(['sin_vela']);
    expect(r.diaria.estado).toBe('pendiente');
  });
});

describe('vela semanal: se decide aparte y contra la última sesión de la semana', () => {
  it('semana normal: cierra el viernes 16:00 de Nueva York y se confirma 30 min después (20:30 UTC); da igual si la vela viene fechada el lunes o el viernes', () => {
    for (const f of ['2026-10-12', '2026-10-16']) {
      const antes = semanal('2026-10-16T20:29:59Z', f);
      expect(antes.cerrada).toBe(false);
      expect(antes.estado).toBe('en_formacion');
      expect(codigos(antes)).toEqual(['margen_de_cierre']);
      const despues = semanal('2026-10-16T20:30:00Z', f);
      expect(despues.cerrada).toBe(true);
      expect(despues.cierre_esperado).toMatchObject({ fecha_sesion: '2026-10-16', utc: '2026-10-16T20:00:00.000Z', confirmable_desde_utc: '2026-10-16T20:30:00.000Z' });
    }
  });
  it('a mitad de semana la vela semanal está en formación (el viernes aún no cierra)', () => {
    const r = semanal('2026-10-14T20:00:00Z', '2026-10-12');
    expect(r.estado).toBe('en_formacion');
    expect(codigos(r)).toEqual(['sesion_en_curso']);
    expect(r.cerrada).toBe(false);
  });
  it('el fin de semana y la semana siguiente la vela semanal ya está cerrada (la última sesión es anterior a hoy en Ciudad de México)', () => {
    expect(semanal('2026-10-17T15:00:00Z', '2026-10-12').cerrada).toBe(true);
    expect(semanal('2026-10-21T15:00:00Z', '2026-10-12').cerrada).toBe(true);
    expect(semanal('2026-10-17T07:00:00Z', '2026-10-12', { margen_cierre_minutos: 1000 }).cerrada).toBe(true);
  });
  it('semana con viernes festivo (Good Friday 3-abr-2026): cierra el jueves 2-abr a las 16:00 de Nueva York y se confirma a las 20:30 UTC', () => {
    for (const f of ['2026-03-30', '2026-04-03']) {
      expect(semanal('2026-04-02T20:29:59Z', f).cerrada).toBe(false);
      const despues = semanal('2026-04-02T20:30:00Z', f);
      expect(despues.cerrada).toBe(true);
      expect(despues.cierre_esperado).toMatchObject({ fecha_sesion: '2026-04-02', utc: '2026-04-02T20:00:00.000Z' });
    }
  });
  it('semana de Thanksgiving: cierra el viernes con cierre anticipado, 1:00 p. m. (18:00 UTC), y se confirma a las 18:30 UTC', () => {
    expect(semanal('2026-11-27T18:29:59Z', '2026-11-23').cerrada).toBe(false);
    const r = semanal('2026-11-27T18:30:00Z', '2026-11-23');
    expect(r.cerrada).toBe(true);
    expect(r.cierre_esperado).toMatchObject({ anticipado: true, nueva_york: '2026-11-27 13:00' });
  });
  it('la bandera semanal es independiente de la diaria, en los dos sentidos', () => {
    // viernes 15:00 UTC: la sesión del jueves ya cerró, pero la semana aún no
    const a = confirmarCierreVelas(entrada('2026-10-16T15:00:00Z', v('2026-10-15'), v('2026-10-12')));
    expect(a.ultima_vela_diaria_cerrada).toBe(true);
    expect(a.ultima_vela_semanal_cerrada).toBe(false);
    // lunes 19: la semana anterior ya cerró, pero la vela diaria del lunes está en formación
    const b = confirmarCierreVelas(entrada('2026-10-19T14:00:00Z', v('2026-10-19'), v('2026-10-12')));
    expect(b.ultima_vela_diaria_cerrada).toBe(false);
    expect(b.ultima_vela_semanal_cerrada).toBe(true);
  });
  it('una vela semanal fechada en sábado o domingo no dice a qué semana pertenece: pendiente, nunca cerrada (aunque esa semana ya haya pasado)', () => {
    for (const f of ['2026-10-10', '2026-10-11', '2026-10-17', '2026-10-18']) {
      const r = semanal('2026-10-26T15:00:00Z', f);
      expect(r.estado).toBe('pendiente');
      expect(r.cerrada).toBe(false);
      expect(codigos(r)).toEqual(['fecha_semanal_en_fin_de_semana']);
    }
    expect(semanal('2026-10-26T15:00:00Z', '2026-10-09').cerrada).toBe(true);   // viernes: sí es de su semana
  });
  it('semana futura, sin vela, año no cubierto y fecha inválida', () => {
    expect(codigos(semanal('2026-10-14T15:00:00Z', '2026-10-19'))).toEqual(['vela_futura']);
    expect(codigos(confirmarCierreVelas(entrada('2026-10-14T15:00:00Z', null, null)).semanal)).toEqual(['sin_vela']);
    const sinAnio = semanal('2026-10-14T15:00:00Z', '2026-01-01');      // su semana empieza en 2025, fuera del calendario
    expect(codigos(sinAnio)).toEqual(['calendario_no_cubre_fecha']);
    expect(sinAnio.estado).toBe('no_evaluable');
    expect(codigos(semanal('2026-10-14T15:00:00Z', '2026-13-01'))).toEqual(['fecha_invalida']);
  });
});

describe('calendario inyectado distinto del oficial', () => {
  it('un calendario sin el año de la vela no evalúa nada: NO_EVALUABLE en la diaria y la semanal', () => {
    const cal = crearCalendarioNYSE({
      ...CALENDARIO_NYSE_DATOS, cobertura: soloAnios([2027, 2028]),
      feriados: CALENDARIO_NYSE_DATOS.feriados.filter(f => !f.startsWith('2026')),
      cierres_anticipados: CALENDARIO_NYSE_DATOS.cierres_anticipados.filter(f => !f.startsWith('2026')),
    });
    const r = confirmarCierreVelas(entrada('2026-10-22T21:00:00Z', v('2026-10-21'), v('2026-10-12')), cal);
    expect(r.ultima_vela_diaria_cerrada).toBe(false);
    expect(r.ultima_vela_semanal_cerrada).toBe(false);
    expect(r.diaria.estado).toBe('no_evaluable');
    expect(r.semanal.estado).toBe('no_evaluable');
    expect(codigos(r.diaria)).toEqual(['calendario_no_cubre_fecha']);
  });
  it('una semana sin ninguna sesión según el calendario es pendiente', () => {
    const cal = crearCalendarioNYSE({
      ...CALENDARIO_NYSE_DATOS, cobertura: soloAnios([2026]), cierres_anticipados: [],
      feriados: ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'],
    });
    const r = confirmarCierreVelas(entrada('2026-10-21T21:00:00Z', null, v('2026-10-14')), cal);
    expect(codigos(r.semanal)).toEqual(['semana_sin_sesiones']);
    expect(r.semanal.estado).toBe('pendiente');
    expect(r.ultima_vela_semanal_cerrada).toBe(false);
  });
});

describe('mercado e instante de evaluación', () => {
  it('la BMV no tiene calendario verificable: NO_EVALUABLE', () => {
    const r = confirmarCierreVelas(entrada('2026-10-26T22:00:00Z', v('2026-10-21'), v('2026-10-12'), 'BMV'));
    expect(r.ultima_vela_diaria_cerrada).toBe(false);
    expect(r.ultima_vela_semanal_cerrada).toBe(false);
    expect(r.diaria.estado).toBe('no_evaluable');
    expect(r.semanal.estado).toBe('no_evaluable');
    expect(codigos(r.diaria)).toEqual(['calendario_bmv_no_definido']);
    expect(codigos(r.semanal)).toEqual(['calendario_bmv_no_definido']);
  });
  it('un mercado que no existe es pendiente', () => {
    const r = confirmarCierreVelas(entrada('2026-10-21T22:00:00Z', v('2026-10-21'), null, 'XX' as never));
    expect(codigos(r.diaria)).toEqual(['mercado_no_soportado']);
    expect(r.diaria.estado).toBe('pendiente');
    expect(r.ultima_vela_diaria_cerrada).toBe(false);
  });
  it('un instante sin zona, vacío o imposible se rechaza como entrada inválida (no se interpreta en la zona de la máquina)', () => {
    for (const malo of ['2026-10-21T20:00:00', 'ayer', '', '2026-10-21T25:00:00Z', '2026-10-21']) {
      const r = confirmarCierreVelas(entrada(malo, v('2026-10-21'), v('2026-10-12')));
      expect(r.ultima_vela_diaria_cerrada).toBe(false);
      expect(r.ultima_vela_semanal_cerrada).toBe(false);
      expect(codigos(r.diaria)).toEqual(['entrada_invalida']);
      expect(codigos(r.semanal)).toEqual(['entrada_invalida']);
    }
  });
});

describe('integridad del resultado', () => {
  it('es determinista, no modifica la entrada y se puede serializar sin perder nada', () => {
    const e = entrada('2026-10-16T21:00:00Z', v('2026-10-16'), v('2026-10-12'));
    const copia = JSON.parse(JSON.stringify(e));
    const a = confirmarCierreVelas(e), b = confirmarCierreVelas(e);
    expect(a).toEqual(b);
    expect(e).toEqual(copia);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });
  it('la bandera es true solo cuando el estado es «confirmada»; todo lo demás trae al menos un motivo', () => {
    const casos: EntradaCierreVelas[] = [
      entrada('2026-10-16T21:00:00Z', v('2026-10-16'), v('2026-10-12')),
      entrada('2026-10-16T20:10:00Z', v('2026-10-16'), v('2026-10-12')),
      entrada('2026-10-16T19:00:00Z', v('2026-10-16'), v('2026-10-12')),
      entrada('2026-10-16T19:00:00Z', null, null),
      entrada('2026-10-16T21:00:00Z', v('2026-11-26'), v('2026-10-12'), 'BMV'),
      entrada('2026-10-16T21:00:00Z', v('2031-11-26'), v('2031-10-12')),
      entrada('2026-10-16T21:00:00Z', v('2026-11-26'), v('2026-10-12')),
    ];
    for (const c of casos) {
      const r = confirmarCierreVelas(c);
      for (const x of [r.diaria, r.semanal]) {
        expect(x.cerrada).toBe(x.estado === 'confirmada');
        if (x.estado !== 'confirmada') expect(x.motivos.length).toBeGreaterThan(0);
        else expect(x.motivos).toEqual([]);
      }
      expect(r.ultima_vela_diaria_cerrada).toBe(r.diaria.cerrada);
      expect(r.ultima_vela_semanal_cerrada).toBe(r.semanal.cerrada);
    }
  });
});
