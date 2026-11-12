import { describe, expect, it } from 'vitest';
import { evaluarSalidaPMP, totalSalidasPMP } from './salida-pmp';
import type { EntradaSalidaPMP } from './salida-pmp';

const nv = (nivel: string | null, cumplido = false) => ({ nivel, cumplido });
function e(p: Partial<EntradaSalidaPMP> = {}): EntradaSalidaPMP {
  return {
    monto_invertido: '50', precio_actual: '100', niveles: [nv('120'), nv('140'), nv('160')],
    senales_hoy: [], senales_previas: null, ...p,
  };
}

describe('salidas de PMP: cuántas', () => {
  it('50 o menos: 2 salidas; más de 50: 3', () => {
    expect(totalSalidasPMP('50')).toBe(2);
    expect(totalSalidasPMP('49.99')).toBe(2);
    expect(totalSalidasPMP('50.00000001')).toBe(3);
    expect(totalSalidasPMP('60')).toBe(3);
  });
});

describe('salidas de PMP: nivel planeado', () => {
  it('sin llegar al nivel y sin confirmaciones: no exige nada', () => {
    const r = evaluarSalidaPMP(e());
    expect(r.exigida).toBeNull();
    expect(r.siguiente).toBe(1);
    expect(r.nivel_siguiente).toBe('120');
  });
  it('el nivel planeado basta solo (2 salidas: primera es REDUCIR 25)', () => {
    const r = evaluarSalidaPMP(e({ precio_actual: '120' }));
    expect(r.exigida).toMatchObject({ decision: 'REDUCIR', porcentaje: 25, regla: 'PMP-SALIDA' });
    expect(r.exigida?.detalle).toContain('posición original');
    expect(r.motivo).toBe('nivel_planeado');
  });
  it('con 2 salidas, la segunda es VENDER 100 en TP2 (TP3 no cuenta)', () => {
    const r = evaluarSalidaPMP(e({ precio_actual: '140', niveles: [nv('120', true), nv('140'), nv('160')] }));
    expect(r.exigida).toMatchObject({ decision: 'VENDER', porcentaje: 100 });
    expect(r.siguiente).toBe(2);
    expect(r.total_salidas).toBe(2);
  });
  it('con 3 salidas: 25, 25 y el resto', () => {
    const base = { monto_invertido: '75' };
    expect(evaluarSalidaPMP(e({ ...base, precio_actual: '121' })).exigida).toMatchObject({ decision: 'REDUCIR', porcentaje: 25 });
    expect(evaluarSalidaPMP(e({ ...base, precio_actual: '141', niveles: [nv('120', true), nv('140'), nv('160')] })).exigida).toMatchObject({ decision: 'REDUCIR', porcentaje: 25 });
    expect(evaluarSalidaPMP(e({ ...base, precio_actual: '161', niveles: [nv('120', true), nv('140', true), nv('160')] })).exigida).toMatchObject({ decision: 'VENDER', porcentaje: 100 });
  });
  it('un precio por debajo de la siguiente salida no dispara aunque supere un nivel ya cumplido', () => {
    const r = evaluarSalidaPMP(e({ precio_actual: '125', niveles: [nv('120', true), nv('140'), nv('160')] }));
    expect(r.exigida).toBeNull();
  });
  it('con todas las salidas cumplidas no exige nada', () => {
    const r = evaluarSalidaPMP(e({ precio_actual: '999', niveles: [nv('120', true), nv('140', true), nv('160')] }));
    expect(r).toMatchObject({ exigida: null, siguiente: null, hechas: 2 });
  });
  it('sin nivel planeado queda declarado y solo cuentan las confirmaciones', () => {
    const r = evaluarSalidaPMP(e({ niveles: [nv(null), nv('140'), nv('160')], precio_actual: '500' }));
    expect(r.exigida).toBeNull();
    expect(r.faltantes.join('|')).toContain('take_profit_1');
  });
});

describe('salidas de PMP: dos confirmaciones', () => {
  it('una sola confirmación no basta', () => {
    expect(evaluarSalidaPMP(e({ senales_hoy: ['RSI_SOBRECOMPRA'] })).exigida).toBeNull();
  });
  it('dos confirmaciones sin salida previa disparan la primera salida', () => {
    const r = evaluarSalidaPMP(e({ senales_hoy: ['RSI_SOBRECOMPRA', 'MOGALEF_BANDA_SUPERIOR'] }));
    expect(r.exigida).toMatchObject({ decision: 'REDUCIR', porcentaje: 25 });
    expect(r.motivo).toBe('confirmaciones');
    expect(r.confirmaciones_nuevas).toEqual(['RSI_SOBRECOMPRA', 'MOGALEF_BANDA_SUPERIOR']);
  });
  it('tras una salida, las señales que ya se cumplían en la vela anterior no cuentan', () => {
    const niveles: EntradaSalidaPMP['niveles'] = [nv('120', true), nv('140'), nv('160')];
    const r = evaluarSalidaPMP(e({ niveles, senales_hoy: ['RSI_SOBRECOMPRA', 'RESISTENCIA_PASADA'], senales_previas: ['RSI_SOBRECOMPRA'] }));
    expect(r.exigida).toBeNull();
    expect(r.confirmaciones_nuevas).toEqual(['RESISTENCIA_PASADA']);
  });
  it('tras una salida, dos señales nuevas sí disparan', () => {
    const niveles: EntradaSalidaPMP['niveles'] = [nv('120', true), nv('140'), nv('160')];
    const r = evaluarSalidaPMP(e({ niveles, senales_hoy: ['RSI_SOBRECOMPRA', 'RESISTENCIA_PASADA', 'MOGALEF_BANDA_SUPERIOR'], senales_previas: ['RSI_SOBRECOMPRA'] }));
    expect(r.exigida).toMatchObject({ decision: 'VENDER', porcentaje: 100 });
    expect(r.confirmaciones_nuevas).toEqual(['MOGALEF_BANDA_SUPERIOR', 'RESISTENCIA_PASADA']);
  });
  it('tras una salida sin poder reconstruir la vela anterior: no se evalúan confirmaciones y se declara', () => {
    const niveles: EntradaSalidaPMP['niveles'] = [nv('120', true), nv('140'), nv('160')];
    const r = evaluarSalidaPMP(e({ niveles, senales_hoy: ['RSI_SOBRECOMPRA', 'MOGALEF_BANDA_SUPERIOR'], senales_previas: null }));
    expect(r.exigida).toBeNull();
    expect(r.faltantes.join('|')).toContain('senales_previas_salida_pmp');
  });
  it('aun sin poder reconstruir la vela anterior, el nivel planeado sigue valiendo', () => {
    const niveles: EntradaSalidaPMP['niveles'] = [nv('120', true), nv('140'), nv('160')];
    const r = evaluarSalidaPMP(e({ niveles, precio_actual: '141', senales_previas: null }));
    expect(r.exigida).toMatchObject({ decision: 'VENDER' });
    expect(r.motivo).toBe('nivel_planeado');
  });
  it('si el nivel y las confirmaciones coinciden, el motivo es el nivel', () => {
    const r = evaluarSalidaPMP(e({ precio_actual: '130', senales_hoy: ['RSI_SOBRECOMPRA', 'MOGALEF_BANDA_SUPERIOR'] }));
    expect(r.motivo).toBe('nivel_planeado');
  });
  it('ignora señales que no son de salida', () => {
    expect(evaluarSalidaPMP(e({ senales_hoy: ['RSI_SOBREVENTA', 'KONCORDE_BAJO_CERO'] })).exigida).toBeNull();
  });
});
