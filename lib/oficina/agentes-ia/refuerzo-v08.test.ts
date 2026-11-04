// Pruebas de la v0.8: tope de confianza del Fundamental cuando hay datos faltantes.
import { describe, expect, it } from 'vitest';
import { PROMPT_FUNDAMENTAL, TOPE_CONFIANZA_CON_FALTANTES, VERSION_PROMPT_FUNDAMENTAL, validarSalidaFundamental } from './index';
import { salidaBase, sobreBase } from './fixtures.test-util';

const err = (mut: (s: Record<string, unknown>) => void): string => {
  const s = JSON.parse(JSON.stringify(salidaBase())) as Record<string, unknown>;
  mut(s);
  const r = validarSalidaFundamental(s, sobreBase());
  return r.ok ? '' : r.errores.join(' | ');
};
const faltante = [{ campo: 'deuda_largo_plazo', critico: false }];
const noEvaluable = (s: Record<string, unknown>, confianza: number): void => {
  s['veredicto'] = 'NO_EVALUABLE'; s['puntaje'] = null; s['tesis_propuesta'] = null; s['confianza'] = confianza;
  s['subpuntajes'] = { crecimiento: null, rentabilidad: null, balance: null, flujo_caja: null, ventaja_competitiva: null };
  s['datos_faltantes'] = [{ campo: 'balance', critico: true }];
};

describe('v0.8: confianza del Fundamental con datos faltantes', () => {
  it('acepta exactamente el tope con datos faltantes', () => {
    expect(TOPE_CONFIANZA_CON_FALTANTES).toBe(0.6);
    expect(err(s => { s['confianza'] = 0.6; s['datos_faltantes'] = faltante; })).toBe('');
  });
  it('rechaza una confianza por encima del tope, con el valor y el tope en el mensaje', () => {
    expect(err(s => { s['confianza'] = 0.61; s['datos_faltantes'] = faltante; })).toContain('confianza (0.61) no puede superar 0.6 cuando hay datos_faltantes');
    expect(err(s => { s['confianza'] = 0.8; s['datos_faltantes'] = faltante; })).toContain('confianza (0.8) no puede superar 0.6');
  });
  it('sin datos faltantes no hay tope', () => {
    expect(err(s => { s['confianza'] = 0.95; s['datos_faltantes'] = []; })).toBe('');
  });
  it('aplica también a NO_EVALUABLE', () => {
    expect(err(s => noEvaluable(s, 0.9))).toContain('confianza (0.9) no puede superar 0.6');
    expect(err(s => noEvaluable(s, 0.3))).toBe('');
  });
  it('una confianza fuera de rango o no numérica da solo el error de rango', () => {
    for (const valor of [1.5, -0.1, 'alta', null]) {
      const e = err(s => { s['confianza'] = valor; s['datos_faltantes'] = faltante; });
      expect(e).toContain('confianza debe estar entre 0 y 1');
      expect(e).not.toContain('no puede superar');
    }
  });
  it('si datos_faltantes no es lista da su error y no el del tope', () => {
    const e = err(s => { s['confianza'] = 0.9; s['datos_faltantes'] = 'x'; });
    expect(e).toContain('datos_faltantes debe ser una lista');
    expect(e).not.toContain('no puede superar');
  });
  it('versión y prompt del Fundamental explican la regla', () => {
    expect(VERSION_PROMPT_FUNDAMENTAL).toBe('fundamental.p5');
    expect(PROMPT_FUNDAMENTAL).toContain('Si `datos_faltantes` no está vacío, `confianza` no puede ser mayor que 0.6; el código rechaza lo contrario.');
  });
});
