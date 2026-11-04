// Pruebas de la v0.12: convención de la primera propuesta de tesis (Director p6, sin cambio de contrato).
import { describe, expect, it } from 'vitest';
import { ESTADOS_TESIS_DIRECTOR, PROMPT_DIRECTOR, PROMPT_FUNDAMENTAL, VERSION_PROMPT_DIRECTOR, VERSION_PROMPT_FUNDAMENTAL } from './index';

describe('v0.12: primera propuesta de tesis', () => {
  it('sube el Director a p6 y deja el Fundamental en p6', () => {
    expect(VERSION_PROMPT_DIRECTOR).toBe('director.p6');
    expect(VERSION_PROMPT_FUNDAMENTAL).toBe('fundamental.p6');
  });
  it('el contrato no gana estados nuevos', () => {
    expect(Array.from(ESTADOS_TESIS_DIRECTOR)).toEqual(['vigente', 'propuesta_cambio', 'sin_cambio', 'sin_tesis']);
  });
  it('el prompt del Director explica la convención', () => {
    expect(PROMPT_DIRECTOR).toContain('Si no hay tesis vigente y propones la primera, usa también `propuesta_cambio`');
    expect(PROMPT_DIRECTOR).toContain('por convención equivale a una primera propuesta, nunca a un cambio');
    expect(PROMPT_DIRECTOR).toContain('no inventes un estado nuevo');
  });
  it('el prompt del Fundamental no cambia', () => {
    expect(PROMPT_FUNDAMENTAL).not.toContain('primera propuesta');
  });
});
