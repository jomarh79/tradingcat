// Pruebas de la v0.17: reglas de p4 (señales de entrada y de salida; tope de confianza con condición no verificable); la versión vigente del prompt es tecnico.p5. Solo prompt.
import { describe, expect, it } from 'vitest';
import { PROMPT_TECNICO } from './prompts';
import { SENALES_ENTRADA_TECNICO, SENALES_SALIDA_TECNICO, TOPE_CONFIANZA_CONDICION_NO_VERIFICABLE, VERSION_PROMPT_TECNICO } from './constantes';

describe('v0.17: prompt del Técnico (reglas de p4)', () => {
  it('versión y constantes', () => {
    expect(VERSION_PROMPT_TECNICO).toBe('tecnico.p5');
    expect(SENALES_ENTRADA_TECNICO).toEqual(['RSI_SOBREVENTA', 'KONCORDE_BAJO_CERO', 'EMA8_SOBRE_EMA21', 'MOGALEF_BANDA_INFERIOR', 'NIVEL_PASADO']);
    expect(SENALES_SALIDA_TECNICO).toEqual(['RSI_SOBRECOMPRA', 'MOGALEF_BANDA_SUPERIOR', 'RESISTENCIA_PASADA']);
    expect(TOPE_CONFIANZA_CONDICION_NO_VERIFICABLE).toBe(0.8);
  });
  it('ninguna señal está en las dos listas', () => {
    for (const s of SENALES_ENTRADA_TECNICO) expect(SENALES_SALIDA_TECNICO).not.toContain(s);
  });
  it('el prompt lista las señales y prohíbe usar una de salida como condición de FAVORABLE', () => {
    expect(PROMPT_TECNICO).toContain(`Señales de ENTRADA: ${SENALES_ENTRADA_TECNICO.join(', ')}.`);
    expect(PROMPT_TECNICO).toContain(`Señales de SALIDA: ${SENALES_SALIDA_TECNICO.join(', ')}.`);
    expect(PROMPT_TECNICO).toContain('NUNCA es la condición que vuelve FAVORABLE');
    expect(PROMPT_TECNICO).toContain('no hay un criterio de entrada definido en los datos; no inventes uno');
  });
  it('el prompt fija el tope de confianza con condición no verificable', () => {
    expect(PROMPT_TECNICO).toContain('no puede ser mayor que 0.8');
  });
  it('mantiene las reglas de p3', () => {
    for (const t of ['NO perjudica', 'ya está dentro de la zona', 'por su nombre que pase a cumplida']) expect(PROMPT_TECNICO).toContain(t);
  });
});
