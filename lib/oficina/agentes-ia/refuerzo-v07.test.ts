// Pruebas de la v0.7: tope de confianza del Director según los analistas y los datos faltantes.
import { describe, expect, it } from 'vitest';
import { PROMPT_DIRECTOR, TOPE_CONFIANZA_CON_FALTANTES, validarContextoDirector, validarSalidaDirector } from './index';
import { contextoBase, salidaDirectorBase } from './fixtures.test-util';

type Ctx = ReturnType<typeof contextoBase>;
function err(mutarSalida: (s: Record<string, unknown>) => void, mutarCtx: (c: Ctx) => void = () => undefined): string {
  const ctx = JSON.parse(JSON.stringify(contextoBase())) as Ctx;
  mutarCtx(ctx);
  const s = JSON.parse(JSON.stringify(salidaDirectorBase())) as Record<string, unknown>;
  mutarSalida(s);
  const c = validarContextoDirector(ctx);
  if (!c.ok) return `CTX: ${c.errores.join(' | ')}`;
  const r = validarSalidaDirector(s, c.valor);
  return r.ok ? '' : r.errores.join(' | ');
}
const confianzaAnalista = (c: Ctx, k: string, v: unknown): void => { (c.salidas_analistas as unknown as Record<string, Record<string, unknown>>)[k]!['confianza'] = v; };
const NEG2 = ['fundamental:h2', 'tecnico:h2'];
const tecnico = (c: Ctx, confianza: number): void => {
  const t = JSON.parse(JSON.stringify(c.salidas_analistas.fundamental)) as Record<string, unknown>;
  t['agente'] = 'tecnico'; t['confianza'] = confianza; t['veredicto'] = 'ACEPTABLE';
  (c.salidas_analistas as unknown as Record<string, unknown>)['tecnico'] = t;
};

describe('v0.7: confianza del Director', () => {
  it('el tope con datos faltantes es 0.6', () => {
    expect(TOPE_CONFIANZA_CON_FALTANTES).toBe(0.6);
  });
  it('acepta una confianza igual a la del analista y sin faltantes', () => {
    expect(err(s => { s['nivel_confianza'] = 0.6; }, c => confianzaAnalista(c, 'fundamental', 0.6))).toBe('');
  });
  it('rechaza una confianza mayor que la del analista, con el valor de cada una en el mensaje', () => {
    const e = err(s => { s['nivel_confianza'] = 0.8; }, c => confianzaAnalista(c, 'fundamental', 0.7));
    expect(e).toContain('nivel_confianza (0.8) no puede superar la confianza mínima de los analistas (0.7)');
  });
  it('usa la confianza MÍNIMA cuando hay varios analistas', () => {
    const e = err(s => { s['nivel_confianza'] = 0.7; s['hallazgos_negativos_ids'] = NEG2; }, c => { confianzaAnalista(c, 'fundamental', 0.9); tecnico(c, 0.5); });
    expect(e).toContain('(0.5)');
    expect(err(s => { s['nivel_confianza'] = 0.5; s['hallazgos_negativos_ids'] = NEG2; }, c => { confianzaAnalista(c, 'fundamental', 0.9); tecnico(c, 0.5); })).toBe('');
  });
  it('con datos_faltantes no puede superar el tope aunque los analistas tengan más', () => {
    const e = err(s => { s['nivel_confianza'] = 0.61; s['datos_faltantes'] = ['deuda_largo_plazo']; }, c => confianzaAnalista(c, 'fundamental', 0.95));
    expect(e).toContain('nivel_confianza (0.61) no puede superar 0.6 cuando hay datos_faltantes');
    expect(e).not.toContain('confianza mínima');
  });
  it('con datos_faltantes acepta exactamente el tope', () => {
    expect(err(s => { s['nivel_confianza'] = 0.6; s['datos_faltantes'] = ['deuda_largo_plazo']; }, c => confianzaAnalista(c, 'fundamental', 0.95))).toBe('');
  });
  it('sin datos_faltantes el tope no aplica, solo el de los analistas', () => {
    expect(err(s => { s['nivel_confianza'] = 0.9; s['datos_faltantes'] = []; }, c => confianzaAnalista(c, 'fundamental', 0.95))).toBe('');
  });
  it('un analista sin confianza numérica no entra en el mínimo', () => {
    expect(err(s => { s['nivel_confianza'] = 0.6; s['hallazgos_negativos_ids'] = NEG2; }, c => { confianzaAnalista(c, 'fundamental', 0.7); tecnico(c, 0.9); confianzaAnalista(c, 'tecnico', 'alta'); })).toBe('');
  });
  it('un analista con confianza no numérica no anula la regla de los demás', () => {
    const e = err(s => { s['nivel_confianza'] = 0.6; s['hallazgos_negativos_ids'] = NEG2; }, c => { confianzaAnalista(c, 'fundamental', 0.5); tecnico(c, 0.9); confianzaAnalista(c, 'tecnico', 'alta'); });
    expect(e).toContain('(0.6) no puede superar la confianza mínima de los analistas (0.5)');
  });
  it('si ningún analista trae confianza numérica no se aplica la regla de los analistas', () => {
    expect(err(s => { s['nivel_confianza'] = 0.9; }, c => confianzaAnalista(c, 'fundamental', 'alta'))).toBe('');
  });
  it('una confianza fuera de rango sigue dando solo el error de rango', () => {
    const e = err(s => { s['nivel_confianza'] = 1.5; s['datos_faltantes'] = ['x']; });
    expect(e).toContain('nivel_confianza debe estar entre 0 y 1');
    expect(e).not.toContain('no puede superar');
  });
  it('el prompt del Director explica la regla', () => {
    expect(PROMPT_DIRECTOR).toContain('Evalúalo tú');
    expect(PROMPT_DIRECTOR).toContain('no puede ser mayor que la `confianza` más baja de los analistas');
    expect(PROMPT_DIRECTOR).toContain('ni mayor que 0.6 si `datos_faltantes` no está vacío');
    expect(PROMPT_DIRECTOR).toContain('el código rechaza lo contrario');
  });
});
