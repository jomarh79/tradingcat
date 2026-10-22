import { describe, expect, it } from 'vitest';
import { CALENDARIO_NYSE_DATOS, confirmarCierreVelas, crearCalendarioNYSE } from './index';
import type { ConfirmacionFuente, EntradaCierreVelas, Mercado, ResultadoCierre, VelaFuente } from './index';

const v = (fecha: string, confirmacion_fuente: ConfirmacionFuente): VelaFuente => ({ fecha, confirmacion_fuente });
const entrada = (evaluado_en: string, diaria: VelaFuente | null, semanal: VelaFuente | null = null, mercado: Mercado = 'US'): EntradaCierreVelas =>
  ({ mercado, evaluado_en, diaria, semanal });
const codigos = (r: ResultadoCierre) => r.motivos.map(m => m.codigo);

describe('vela diaria: el calendario dice cuándo se espera el cierre', () => {
  it('a las 16:00 de Nueva York (20:00 UTC en horario de verano) con la fuente en «cerrada» queda confirmada, con el cierre esperado en tres zonas', () => {
    const r = confirmarCierreVelas(entrada('2026-10-21T20:00:00Z', v('2026-10-21', 'cerrada')));
    expect(r.ultima_vela_diaria_cerrada).toBe(true);
    expect(r.diaria).toEqual({
      cerrada: true, estado: 'confirmada', motivos: [],
      cierre_esperado: { fecha_sesion: '2026-10-21', anticipado: false, utc: '2026-10-21T20:00:00.000Z', nueva_york: '2026-10-21 16:00', ciudad_de_mexico: '2026-10-21 14:00' },
    });
  });
  it('un segundo antes del cierre no está cerrada: en formación si la fuente no dice otra cosa', () => {
    for (const f of ['en_formacion', 'desconocida'] as const) {
      const r = confirmarCierreVelas(entrada('2026-10-21T19:59:59Z', v('2026-10-21', f)));
      expect(r.ultima_vela_diaria_cerrada).toBe(false);
      expect(r.diaria.estado).toBe('en_formacion');
      expect(codigos(r.diaria)).toEqual(['sesion_en_curso']);
    }
  });
  it('si la fuente dice «cerrada» antes de la hora de cierre, se contradice con el calendario: pendiente, no confirmada', () => {
    const r = confirmarCierreVelas(entrada('2026-10-21T19:59:59Z', v('2026-10-21', 'cerrada')));
    expect(r.ultima_vela_diaria_cerrada).toBe(false);
    expect(r.diaria.estado).toBe('pendiente');
    expect(codigos(r.diaria)).toEqual(['fuente_contradice_calendario']);
  });
  it('la hora por sí sola no basta: terminada la sesión, con la fuente «desconocida» queda pendiente y no se asume cerrada', () => {
    const r = confirmarCierreVelas(entrada('2026-10-21T21:00:00Z', v('2026-10-21', 'desconocida')));
    expect(r.ultima_vela_diaria_cerrada).toBe(false);
    expect(r.diaria.estado).toBe('pendiente');
    expect(codigos(r.diaria)).toEqual(['fuente_sin_confirmacion']);
    expect(r.diaria.cierre_esperado?.nueva_york).toBe('2026-10-21 16:00');
  });
  it('terminada la sesión pero con la fuente todavía «en formación»: no cerrada', () => {
    const r = confirmarCierreVelas(entrada('2026-10-21T21:00:00Z', v('2026-10-21', 'en_formacion')));
    expect(r.ultima_vela_diaria_cerrada).toBe(false);
    expect(r.diaria.estado).toBe('en_formacion');
    expect(codigos(r.diaria)).toEqual(['fuente_en_formacion']);
  });
  it('al día siguiente (o días después) con la fuente en «cerrada», sigue confirmada', () => {
    expect(confirmarCierreVelas(entrada('2026-10-22T14:00:00Z', v('2026-10-21', 'cerrada'))).ultima_vela_diaria_cerrada).toBe(true);
    expect(confirmarCierreVelas(entrada('2026-10-26T14:00:00Z', v('2026-10-21', 'cerrada'))).ultima_vela_diaria_cerrada).toBe(true);
  });
  it('acepta el instante con otra zona: 14:00 en Ciudad de México (UTC-6) es el cierre del 21-oct', () => {
    expect(confirmarCierreVelas(entrada('2026-10-21T14:00:00-06:00', v('2026-10-21', 'cerrada'))).ultima_vela_diaria_cerrada).toBe(true);
    expect(confirmarCierreVelas(entrada('2026-10-21T13:59:59-06:00', v('2026-10-21', 'en_formacion'))).ultima_vela_diaria_cerrada).toBe(false);
  });
});

describe('cierre anticipado y horario de verano', () => {
  it('el viernes después de Thanksgiving el mercado cierra a la 1:00 p. m. (18:00 UTC; 12:00 en Ciudad de México), no a las 4:00 p. m.', () => {
    const antes = confirmarCierreVelas(entrada('2026-11-27T17:59:59Z', v('2026-11-27', 'en_formacion')));
    expect(antes.ultima_vela_diaria_cerrada).toBe(false);
    const despues = confirmarCierreVelas(entrada('2026-11-27T18:00:00Z', v('2026-11-27', 'cerrada')));
    expect(despues.ultima_vela_diaria_cerrada).toBe(true);
    expect(despues.diaria.cierre_esperado).toEqual({
      fecha_sesion: '2026-11-27', anticipado: true, utc: '2026-11-27T18:00:00.000Z', nueva_york: '2026-11-27 13:00', ciudad_de_mexico: '2026-11-27 12:00',
    });
  });
  it('antes y después del cambio de horario el cierre se mueve de hora UTC (20:00 el 30-oct, 21:00 el 2-nov) y en Ciudad de México de 14:00 a 15:00', () => {
    const a = confirmarCierreVelas(entrada('2026-10-30T20:00:00Z', v('2026-10-30', 'cerrada')));
    expect(a.diaria.cierre_esperado).toMatchObject({ utc: '2026-10-30T20:00:00.000Z', ciudad_de_mexico: '2026-10-30 14:00' });
    expect(a.ultima_vela_diaria_cerrada).toBe(true);
    const b = confirmarCierreVelas(entrada('2026-11-02T20:30:00Z', v('2026-11-02', 'en_formacion')));
    expect(b.diaria.cierre_esperado).toMatchObject({ utc: '2026-11-02T21:00:00.000Z', ciudad_de_mexico: '2026-11-02 15:00' });
    expect(b.ultima_vela_diaria_cerrada).toBe(false);          // con la hora de verano ya habría cerrado: aquí aún no
    expect(confirmarCierreVelas(entrada('2026-11-02T21:00:00Z', v('2026-11-02', 'cerrada'))).ultima_vela_diaria_cerrada).toBe(true);
  });
});

describe('vela diaria incoherente con el calendario: pendiente, nunca cerrada', () => {
  const pend = (fecha: string, ev = '2026-12-01T22:00:00Z') => confirmarCierreVelas(entrada(ev, v(fecha, 'cerrada'))).diaria;
  it('festivo, fin de semana, fecha inválida, año no cubierto', () => {
    expect(codigos(pend('2026-11-26'))).toEqual(['fecha_no_es_sesion']);      // Thanksgiving
    expect(pend('2026-11-26').motivos[0]!.detalle).toContain('feriado');
    expect(codigos(pend('2026-11-28'))).toEqual(['fecha_no_es_sesion']);      // sábado
    expect(pend('2026-11-28').motivos[0]!.detalle).toContain('fin de semana');
    expect(codigos(pend('2026-02-30'))).toEqual(['fecha_invalida']);
    expect(codigos(pend('2030-06-03', '2030-06-04T22:00:00Z'))).toEqual(['calendario_no_cubre_fecha']);
    for (const f of ['2026-11-26', '2026-11-28', '2026-02-30']) expect(pend(f).cerrada).toBe(false);
  });
  it('una vela con fecha posterior a la evaluación (en Nueva York) es pendiente: a la 1:00 UTC del 22 todavía es 21 en Nueva York', () => {
    expect(codigos(pend('2026-10-23', '2026-10-21T15:00:00Z'))).toEqual(['vela_futura']);
    expect(codigos(pend('2026-10-22', '2026-10-22T01:00:00Z'))).toEqual(['vela_futura']);
  });
  it('sin vela: pendiente', () => {
    const r = confirmarCierreVelas(entrada('2026-10-21T21:00:00Z', null));
    expect(r.ultima_vela_diaria_cerrada).toBe(false);
    expect(codigos(r.diaria)).toEqual(['sin_vela']);
  });
});

describe('vela semanal: se decide aparte y contra la última sesión de la semana', () => {
  it('semana normal: cierra el viernes 16:00 de Nueva York (20:00 UTC); da igual si la vela viene fechada el lunes o el viernes', () => {
    for (const f of ['2026-10-12', '2026-10-16']) {
      const antes = confirmarCierreVelas(entrada('2026-10-16T19:59:59Z', null, v(f, 'en_formacion')));
      expect(antes.ultima_vela_semanal_cerrada).toBe(false);
      expect(antes.semanal.estado).toBe('en_formacion');
      const despues = confirmarCierreVelas(entrada('2026-10-16T20:00:00Z', null, v(f, 'cerrada')));
      expect(despues.ultima_vela_semanal_cerrada).toBe(true);
      expect(despues.semanal.cierre_esperado).toMatchObject({ fecha_sesion: '2026-10-16', utc: '2026-10-16T20:00:00.000Z' });
    }
  });
  it('a mitad de semana la vela semanal está en formación (el viernes aún no cierra), y si la fuente dice «cerrada» se contradice', () => {
    const f = confirmarCierreVelas(entrada('2026-10-14T20:00:00Z', null, v('2026-10-12', 'en_formacion')));
    expect(f.semanal.estado).toBe('en_formacion');
    const c = confirmarCierreVelas(entrada('2026-10-14T20:00:00Z', null, v('2026-10-12', 'cerrada')));
    expect(c.ultima_vela_semanal_cerrada).toBe(false);
    expect(codigos(c.semanal)).toEqual(['fuente_contradice_calendario']);
  });
  it('semana con viernes festivo (Good Friday 3-abr-2026): cierra el jueves 2-abr a las 16:00 de Nueva York', () => {
    const antes = confirmarCierreVelas(entrada('2026-04-02T19:59:59Z', null, v('2026-03-30', 'en_formacion')));
    expect(antes.ultima_vela_semanal_cerrada).toBe(false);
    const despues = confirmarCierreVelas(entrada('2026-04-02T20:00:00Z', null, v('2026-04-03', 'cerrada')));
    expect(despues.ultima_vela_semanal_cerrada).toBe(true);
    expect(despues.semanal.cierre_esperado).toMatchObject({ fecha_sesion: '2026-04-02', utc: '2026-04-02T20:00:00.000Z' });
  });
  it('semana de Thanksgiving: cierra el viernes con cierre anticipado, 1:00 p. m. (18:00 UTC)', () => {
    expect(confirmarCierreVelas(entrada('2026-11-27T17:59:59Z', null, v('2026-11-23', 'en_formacion'))).ultima_vela_semanal_cerrada).toBe(false);
    const r = confirmarCierreVelas(entrada('2026-11-27T18:00:00Z', null, v('2026-11-23', 'cerrada')));
    expect(r.ultima_vela_semanal_cerrada).toBe(true);
    expect(r.semanal.cierre_esperado).toMatchObject({ anticipado: true, nueva_york: '2026-11-27 13:00' });
  });
  it('que haya cerrado la sesión del viernes no basta si la fuente no confirma la vela semanal: la bandera semanal queda en false aunque la diaria sea true', () => {
    const r = confirmarCierreVelas(entrada('2026-10-16T21:00:00Z', v('2026-10-16', 'cerrada'), v('2026-10-12', 'desconocida')));
    expect(r.ultima_vela_diaria_cerrada).toBe(true);
    expect(r.ultima_vela_semanal_cerrada).toBe(false);
    expect(r.semanal.estado).toBe('pendiente');
    expect(codigos(r.semanal)).toEqual(['fuente_sin_confirmacion']);
  });
  it('y al revés: semanal confirmada con la diaria sin confirmar', () => {
    const r = confirmarCierreVelas(entrada('2026-10-16T21:00:00Z', v('2026-10-16', 'desconocida'), v('2026-10-12', 'cerrada')));
    expect(r.ultima_vela_diaria_cerrada).toBe(false);
    expect(r.ultima_vela_semanal_cerrada).toBe(true);
  });
  it('una semana ya pasada con la fuente en «cerrada» sigue confirmada', () => {
    expect(confirmarCierreVelas(entrada('2026-10-21T15:00:00Z', null, v('2026-10-12', 'cerrada'))).ultima_vela_semanal_cerrada).toBe(true);
  });
  it('semana futura, sin vela, año no cubierto y fecha inválida: pendiente', () => {
    expect(codigos(confirmarCierreVelas(entrada('2026-10-14T15:00:00Z', null, v('2026-10-19', 'cerrada'))).semanal)).toEqual(['vela_futura']);
    expect(codigos(confirmarCierreVelas(entrada('2026-10-14T15:00:00Z', null, null)).semanal)).toEqual(['sin_vela']);
    expect(codigos(confirmarCierreVelas(entrada('2026-10-14T15:00:00Z', null, v('2026-01-01', 'cerrada'))).semanal)).toEqual(['calendario_no_cubre_fecha']);
    expect(codigos(confirmarCierreVelas(entrada('2026-10-14T15:00:00Z', null, v('2026-13-01', 'cerrada'))).semanal)).toEqual(['fecha_invalida']);
  });
});

describe('calendario inyectado distinto del oficial', () => {
  it('un calendario sin el año de la vela no confirma nada', () => {
    const cal = crearCalendarioNYSE({
      ...CALENDARIO_NYSE_DATOS, anios: [2027, 2028],
      feriados: CALENDARIO_NYSE_DATOS.feriados.filter(f => !f.startsWith('2026')),
      cierres_anticipados: CALENDARIO_NYSE_DATOS.cierres_anticipados.filter(f => !f.startsWith('2026')),
    });
    const r = confirmarCierreVelas(entrada('2026-10-21T21:00:00Z', v('2026-10-21', 'cerrada'), v('2026-10-12', 'cerrada')), cal);
    expect(r.ultima_vela_diaria_cerrada).toBe(false);
    expect(r.ultima_vela_semanal_cerrada).toBe(false);
    expect(codigos(r.diaria)).toEqual(['calendario_no_cubre_fecha']);
  });
  it('una semana sin ninguna sesión según el calendario es pendiente', () => {
    const cal = crearCalendarioNYSE({
      ...CALENDARIO_NYSE_DATOS, anios: [2026], cierres_anticipados: [],
      feriados: ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'],
    });
    const r = confirmarCierreVelas(entrada('2026-10-21T21:00:00Z', null, v('2026-10-14', 'cerrada')), cal);
    expect(codigos(r.semanal)).toEqual(['semana_sin_sesiones']);
    expect(r.ultima_vela_semanal_cerrada).toBe(false);
  });
});

describe('mercado e instante de evaluación', () => {
  it('la BMV no tiene calendario verificable: ninguna vela se da por cerrada, ni con la fuente en «cerrada»', () => {
    const r = confirmarCierreVelas(entrada('2026-10-21T22:00:00Z', v('2026-10-21', 'cerrada'), v('2026-10-12', 'cerrada'), 'BMV'));
    expect(r.ultima_vela_diaria_cerrada).toBe(false);
    expect(r.ultima_vela_semanal_cerrada).toBe(false);
    expect(codigos(r.diaria)).toEqual(['calendario_bmv_no_definido']);
    expect(codigos(r.semanal)).toEqual(['calendario_bmv_no_definido']);
  });
  it('un mercado que no existe es pendiente', () => {
    const r = confirmarCierreVelas(entrada('2026-10-21T22:00:00Z', v('2026-10-21', 'cerrada'), null, 'XX' as never));
    expect(codigos(r.diaria)).toEqual(['mercado_no_soportado']);
    expect(r.ultima_vela_diaria_cerrada).toBe(false);
  });
  it('un instante sin zona, vacío o imposible se rechaza como entrada inválida (no se interpreta en la zona de la máquina)', () => {
    for (const malo of ['2026-10-21T20:00:00', 'ayer', '', '2026-10-21T25:00:00Z', '2026-10-21']) {
      const r = confirmarCierreVelas(entrada(malo, v('2026-10-21', 'cerrada'), v('2026-10-12', 'cerrada')));
      expect(r.ultima_vela_diaria_cerrada).toBe(false);
      expect(r.ultima_vela_semanal_cerrada).toBe(false);
      expect(codigos(r.diaria)).toEqual(['entrada_invalida']);
      expect(codigos(r.semanal)).toEqual(['entrada_invalida']);
    }
  });
});

describe('integridad del resultado', () => {
  it('es determinista, no modifica la entrada y se puede serializar sin perder nada', () => {
    const e = entrada('2026-10-16T21:00:00Z', v('2026-10-16', 'cerrada'), v('2026-10-12', 'cerrada'));
    const copia = JSON.parse(JSON.stringify(e));
    const a = confirmarCierreVelas(e), b = confirmarCierreVelas(e);
    expect(a).toEqual(b);
    expect(e).toEqual(copia);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });
  it('la bandera es true solo cuando el estado es «confirmada» y todo lo demás trae al menos un motivo', () => {
    const casos: EntradaCierreVelas[] = [
      entrada('2026-10-16T21:00:00Z', v('2026-10-16', 'cerrada'), v('2026-10-12', 'cerrada')),
      entrada('2026-10-16T21:00:00Z', v('2026-10-16', 'desconocida'), v('2026-10-12', 'en_formacion')),
      entrada('2026-10-16T19:00:00Z', v('2026-10-16', 'cerrada'), v('2026-10-12', 'cerrada')),
      entrada('2026-10-16T19:00:00Z', null, null),
      entrada('2026-10-16T21:00:00Z', v('2026-11-26', 'cerrada'), v('2026-10-12', 'cerrada'), 'BMV'),
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
