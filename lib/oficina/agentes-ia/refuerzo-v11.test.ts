// Pruebas de la v0.11: el Fundamental p6 no afirma sobre temas con datos faltantes y su resumen se apoya en hallazgos.
import { describe, expect, it } from 'vitest';
import { PROMPT_DIRECTOR, PROMPT_FUNDAMENTAL, VERSION_PROMPT_DIRECTOR, VERSION_PROMPT_FUNDAMENTAL } from './index';

describe('v0.11: prompt del Fundamental p6', () => {
  it('sube la versión del Fundamental y deja la del Director en p5', () => {
    expect(VERSION_PROMPT_FUNDAMENTAL).toBe('fundamental.p6');
    expect(VERSION_PROMPT_DIRECTOR).toBe('director.p5');
  });
  it('prohíbe afirmar sobre un tema con dato faltante, en resumen, hallazgos y tesis', () => {
    expect(PROMPT_FUNDAMENTAL).toContain('El `resumen`, los `hallazgos` y la `tesis_propuesta` no pueden afirmar nada sobre un tema cuyo dato esté en `datos_faltantes`');
    expect(PROMPT_FUNDAMENTAL).toContain('no digas «baja deuda» ni «endeudamiento controlado» si falta la deuda');
    expect(PROMPT_FUNDAMENTAL).toContain('sobre ese tema solo puedes decir que el dato falta');
  });
  it('exige que cada afirmación del resumen esté en un hallazgo con evidencia', () => {
    expect(PROMPT_FUNDAMENTAL).toContain('Cada afirmación del `resumen` debe estar cubierta por un hallazgo con evidencia citada');
    expect(PROMPT_FUNDAMENTAL).toContain('no añadas al `resumen` conclusiones que no estén en los hallazgos');
    expect(PROMPT_FUNDAMENTAL).toContain('no hables de crecimiento TTM sin citar un item de crecimiento TTM');
  });
  it('pide que la condición del invalidador describa exactamente lo que mide el umbral', () => {
    expect(PROMPT_FUNDAMENTAL).toContain('La `condicion` debe describir exactamente lo que mide el umbral');
    expect(PROMPT_FUNDAMENTAL).toContain('sin añadir calificativos que el umbral no mide, como «sostenida»');
    expect(PROMPT_FUNDAMENTAL).toContain('«la utilidad neta TTM es mayor que 0»');
  });
  it('el prompt del Director no cambia con esta regla', () => {
    expect(PROMPT_DIRECTOR).not.toContain('tesis_propuesta` no pueden afirmar');
  });
});
