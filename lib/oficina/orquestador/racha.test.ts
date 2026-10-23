import { describe, expect, it } from 'vitest';
import type { SnapshotTecnico } from '../tecnico';
import { rachaPreviaDeReferencias, registrarRachaMogalefSuperior } from './index';
import type { RachaRegistrada } from './index';

type SenalFalsa = { id: string; cumplida: boolean | null; detalle: string; racha?: { en_curso: boolean; dias: number; fecha_inicio: string | null } };
const snap = (senales: SenalFalsa[], estado: SnapshotTecnico['estado'] = 'completo'): SnapshotTecnico => ({ estado, senales } as unknown as SnapshotTecnico);
const sup = (cumplida: boolean | null, racha?: SenalFalsa['racha']): SenalFalsa => ({ id: 'MOGALEF_BANDA_SUPERIOR', cumplida, detalle: 'd', ...(racha ? { racha } : {}) });
const reg = (fecha_inicio: string, dias: number, activacion_registrada: boolean): RachaRegistrada => ({ fecha_inicio, dias, activacion_registrada });

describe('registrarRachaMogalefSuperior: solo la banda superior', () => {
  it('primera ruptura sin registro previo: activación nueva, se guarda la racha con la activación registrada', () => {
    const r = registrarRachaMogalefSuperior(snap([sup(true, { en_curso: true, dias: 1, fecha_inicio: '2026-10-21' })]), null);
    expect(r.estado).toBe('nueva_activacion');
    expect(r.registro).toEqual(reg('2026-10-21', 1, true));
  });
  it('la misma activación ya registrada (segunda corrida del mismo día): ya_registrada, no duplica', () => {
    const r = registrarRachaMogalefSuperior(snap([sup(true, { en_curso: true, dias: 1, fecha_inicio: '2026-10-21' })]), reg('2026-10-21', 1, true));
    expect(r.estado).toBe('ya_registrada');
    expect(r.registro).toEqual(reg('2026-10-21', 1, true));
  });
  it('una racha anterior distinta (otra fecha de inicio) no cuenta como la misma: nueva activación', () => {
    const r = registrarRachaMogalefSuperior(snap([sup(true, { en_curso: true, dias: 1, fecha_inicio: '2026-10-21' })]), reg('2026-10-05', 3, true));
    expect(r.estado).toBe('nueva_activacion');
  });
  it('una activación de la misma racha que quedó SIN registrar se registra ahora como nueva', () => {
    const r = registrarRachaMogalefSuperior(snap([sup(true, { en_curso: true, dias: 1, fecha_inicio: '2026-10-21' })]), reg('2026-10-21', 1, false));
    expect(r.estado).toBe('nueva_activacion');
    expect(r.registro!.activacion_registrada).toBe(true);
  });
  it('ruptura repetida con la activación registrada: racha_en_curso, la señal no se repite, se conserva la activación', () => {
    const r = registrarRachaMogalefSuperior(snap([sup(false, { en_curso: true, dias: 2, fecha_inicio: '2026-10-20' })]), reg('2026-10-20', 1, true));
    expect(r.estado).toBe('racha_en_curso');
    expect(r.registro).toEqual(reg('2026-10-20', 2, true));
    expect(r.detalle).toContain('no se repite');
  });
  it('ruptura repetida sin registro de la activación (no corriste ese día): se declara que la activación NO quedó registrada', () => {
    for (const previa of [null, reg('2026-10-05', 3, true), reg('2026-10-20', 1, false)]) {
      const r = registrarRachaMogalefSuperior(snap([sup(false, { en_curso: true, dias: 2, fecha_inicio: '2026-10-20' })]), previa);
      expect(r.estado).toBe('racha_en_curso');
      expect(r.registro).toEqual(reg('2026-10-20', 2, false));
      expect(r.detalle).toContain('NO quedó registrada');
    }
  });
  it('sin ruptura hoy: la racha termina, no queda registro (el rearme es automático)', () => {
    const r = registrarRachaMogalefSuperior(snap([sup(false, { en_curso: false, dias: 0, fecha_inicio: null })]), reg('2026-10-20', 2, true));
    expect(r.estado).toBe('sin_racha');
    expect(r.registro).toBeNull();
  });
  it('señal null (racha no determinable), señal ausente, sin racha en la señal o sin snapshot: no se registra nada', () => {
    expect(registrarRachaMogalefSuperior(snap([sup(null)]), null)).toMatchObject({ estado: 'no_determinable', registro: null });
    expect(registrarRachaMogalefSuperior(snap([sup(null)]), null).detalle).toBe('d');          // el detalle es el de la señal
    expect(registrarRachaMogalefSuperior(snap([]), null)).toMatchObject({ estado: 'no_determinable', registro: null });
    expect(registrarRachaMogalefSuperior(snap([sup(true)]), null)).toMatchObject({ estado: 'no_determinable', registro: null });
    expect(registrarRachaMogalefSuperior(null, null)).toMatchObject({ estado: 'no_evaluable', registro: null });
    expect(registrarRachaMogalefSuperior(snap([sup(true, { en_curso: true, dias: 1, fecha_inicio: 'x' })], 'NO_EVALUABLE'), null)).toMatchObject({ estado: 'no_evaluable' });
  });
  it('la banda inferior no interviene: aunque su señal sea true, no hay racha registrada', () => {
    const inf: SenalFalsa = { id: 'MOGALEF_BANDA_INFERIOR', cumplida: true, detalle: 'd' };
    expect(registrarRachaMogalefSuperior(snap([inf]), null).estado).toBe('no_determinable');
  });
});

describe('rachaPreviaDeReferencias: lee referencias.tecnico.racha_mogalef_superior de una corrida anterior', () => {
  const buena = { tecnico: { racha_mogalef_superior: { fecha_inicio: '2026-10-20', dias: 2, activacion_registrada: true } } };
  it('lee la racha bien formada', () => {
    expect(rachaPreviaDeReferencias(buena)).toEqual(reg('2026-10-20', 2, true));
  });
  it('cualquier forma inválida es null, sin lanzar errores', () => {
    for (const mala of [null, undefined, 5, 'x', [], {}, { tecnico: null }, { tecnico: {} }, { tecnico: { racha_mogalef_superior: null } },
      { tecnico: { racha_mogalef_superior: { fecha_inicio: '20-10-2026', dias: 2, activacion_registrada: true } } },
      { tecnico: { racha_mogalef_superior: { fecha_inicio: '2026-10-20', dias: 0, activacion_registrada: true } } },
      { tecnico: { racha_mogalef_superior: { fecha_inicio: '2026-10-20', dias: 1.5, activacion_registrada: true } } },
      { tecnico: { racha_mogalef_superior: { fecha_inicio: '2026-10-20', dias: 2, activacion_registrada: 'si' } } },
      { tecnico: { racha_mogalef_superior: { fecha_inicio: '2026-10-20', dias: 2 } } }]) {
      expect(rachaPreviaDeReferencias(mala)).toBeNull();
    }
  });
});
