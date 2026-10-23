import { describe, expect, it } from 'vitest';
import { CALENDARIO_NYSE, MAX_DIAS_REVISION_FRESCURA, evaluarFrescuraPrecio } from './index';

const f = (ultima_vela_diaria: string | null, fecha_evaluacion: string | null, limite_dias_habiles: number | null = 1) =>
  evaluarFrescuraPrecio({ ultima_vela_diaria, fecha_evaluacion, limite_dias_habiles, calendario: CALENDARIO_NYSE });

describe('frescura del precio: sesiones del NYSE entre la última vela y hoy (Ciudad de México), límite en días hábiles', () => {
  it('el mismo día, o fin de semana tras el viernes: antigüedad 0, vigente', () => {
    for (const [u, h] of [['2026-10-21', '2026-10-21'], ['2026-10-16', '2026-10-17'], ['2026-10-16', '2026-10-18']] as const) {
      const r = f(u, h);
      expect(r).toMatchObject({ evaluada: true, vencida: false, dias_habiles_de_antiguedad: 0, limite_dias_habiles: 1 });
    }
  });
  it('un día hábil de antigüedad con límite 1: vigente; dos: vencida', () => {
    expect(f('2026-10-19', '2026-10-20')).toMatchObject({ vencida: false, dias_habiles_de_antiguedad: 1 });
    expect(f('2026-10-19', '2026-10-21')).toMatchObject({ vencida: true, dias_habiles_de_antiguedad: 2 });
    expect(f('2026-10-16', '2026-10-19')).toMatchObject({ vencida: false, dias_habiles_de_antiguedad: 1 });   // viernes -> lunes
    expect(f('2026-10-16', '2026-10-20')).toMatchObject({ vencida: true, dias_habiles_de_antiguedad: 2 });
  });
  it('los festivos no cuentan como días hábiles (Labor Day lunes 7-sep-2026; Thanksgiving jueves 26-nov-2026)', () => {
    expect(f('2026-09-04', '2026-09-08')).toMatchObject({ vencida: false, dias_habiles_de_antiguedad: 1 });
    expect(f('2026-09-04', '2026-09-09')).toMatchObject({ vencida: true, dias_habiles_de_antiguedad: 2 });
    expect(f('2026-11-25', '2026-11-27')).toMatchObject({ vencida: false, dias_habiles_de_antiguedad: 1 });
  });
  it('el límite es un parámetro: 0 exige la vela del día; 2 tolera dos días hábiles', () => {
    expect(f('2026-10-16', '2026-10-19', 0)).toMatchObject({ vencida: true, limite_dias_habiles: 0 });
    expect(f('2026-10-21', '2026-10-21', 0)).toMatchObject({ vencida: false });
    expect(f('2026-10-19', '2026-10-21', 2)).toMatchObject({ vencida: false, dias_habiles_de_antiguedad: 2 });
    expect(f('2026-10-19', '2026-10-22', 2)).toMatchObject({ vencida: true });
  });
  it('el detalle dice la antigüedad, el límite y si está vencida', () => {
    expect(f('2026-10-19', '2026-10-21').detalle).toContain('VENCIDA');
    expect(f('2026-10-19', '2026-10-20').detalle).not.toContain('VENCIDA');
    expect(f('2026-10-19', '2026-10-21').detalle).toContain('2 día(s) hábil(es)');
  });
});

describe('lo que no se puede evaluar no se supone', () => {
  it('límite sin definir, sin vela o sin fecha: no evaluada y vencida = null', () => {
    expect(f(null, '2026-10-21').detalle).toContain('no hay última vela');
    expect(f('2026-10-19', null).detalle).toContain('no hay última vela');
    expect(f('2026-10-19', '2026-10-21', null).detalle).toContain('sin definir');
    for (const r of [f('2026-10-19', '2026-10-21', null), f(null, '2026-10-21'), f('2026-10-19', null)]) {
      expect(r.evaluada).toBe(false);
      expect(r.vencida).toBeNull();
      expect(r.dias_habiles_de_antiguedad).toBeNull();
    }
  });
  it('fechas inválidas o vela posterior a la evaluación: no evaluada', () => {
    expect(f('2026-02-30', '2026-10-21').evaluada).toBe(false);
    expect(f('2026-10-19', '2026-13-01').evaluada).toBe(false);
    const r = f('2026-10-22', '2026-10-21');
    expect(r.evaluada).toBe(false);
    expect(r.detalle).toContain('posterior');
  });
  it('el calendario no cubre el tramo (año 2029): no evaluada', () => {
    const r = f('2028-12-29', '2029-01-03');
    expect(r.evaluada).toBe(false);
    expect(r.vencida).toBeNull();
    expect(r.detalle).toContain('no cubre');
  });
});

describe(`tope de revisión (MAX_DIAS_REVISION_FRESCURA)`, () => {
  it('el tope vale 60 días corridos', () => {
    expect(MAX_DIAS_REVISION_FRESCURA).toBe(60);
  });
  it('a exactamente 60 días todavía se cuentan las sesiones; a 61 se declara vencida sin contar', () => {
    const justo = f('2026-08-22', '2026-10-21');      // 60 días
    expect(justo.evaluada).toBe(true);
    expect(justo.dias_habiles_de_antiguedad).not.toBeNull();
    expect(justo.vencida).toBe(true);
    const pasado = f('2026-08-21', '2026-10-21');     // 61 días
    expect(pasado).toMatchObject({ evaluada: true, vencida: true, dias_habiles_de_antiguedad: null });
    expect(pasado.detalle).toContain('más de 60 días');
  });
});
