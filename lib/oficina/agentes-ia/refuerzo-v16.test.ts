// Pruebas de la v0.16: prompt prompt del Técnico (versión vigente tecnico.p6) (solo prompt, sin reglas nuevas de código).
import { describe, expect, it } from 'vitest';
import { PROMPT_TECNICO, VERSION_PROMPT_TECNICO } from './index';

describe('v0.16: prompt del Técnico versión y reglas de p3 siguen en el prompt', () => {
  it('versión', () => {
    expect(VERSION_PROMPT_TECNICO).toBe('tecnico.p6');
  });
  it('una señal no cumplida es neutral, no negativa', () => {
    for (const t of ['una banda de Mogalef sin ruptura', 'NO perjudica', 'nunca \`negativo\`']) expect(PROMPT_TECNICO).toContain(t.replace(/\\`/g, '`'));
  });
  it('el modelo compara el cierre con la zona y no dice «alcanzar» donde ya está', () => {
    for (const t of ['no compares precios tú; usa los items', 'Solo escribe «dentro de la zona» si el cierre está dentro', 'No escribas que falta «alcanzar»']) expect(PROMPT_TECNICO).toContain(t);
  });
  it('el evento del resumen es concreto, sin frases vagas', () => {
    for (const t of ['por su nombre que pase a cumplida', 'por su id y su precio', 'una zona más definida']) expect(PROMPT_TECNICO).toContain(t);
  });
  it('negativos sigue sin poder ir vacío (regla común)', () => {
    expect(PROMPT_TECNICO).toContain('`negativos` dice qué revisaste');
  });
});
