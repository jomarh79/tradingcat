// Pruebas de la v0.10: `completar_datos` exige un faltante crítico declarado por un analista; prompts p5.
import { describe, expect, it } from 'vitest';
import { PROMPT_DIRECTOR, PROMPT_FUNDAMENTAL, TOPE_CONFIANZA_CON_FALTANTES, VERSION_PROMPT_DIRECTOR, VERSION_PROMPT_FUNDAMENTAL, validarContextoDirector, validarSalidaDirector } from './index';
import { contextoBase, salidaDirectorBase } from './fixtures.test-util';

type Ctx = ReturnType<typeof contextoBase>;
const MSG = 'ningún analista declara un dato faltante crítico';
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
const analista = (c: Ctx, k: string): Record<string, unknown> => (c.salidas_analistas as unknown as Record<string, Record<string, unknown>>)[k]!;
const faltantes = (c: Ctx, valor: unknown, k = 'fundamental'): void => { analista(c, k)['datos_faltantes'] = valor; };
const tecnico = (c: Ctx): void => {
  const t = JSON.parse(JSON.stringify(c.salidas_analistas.fundamental)) as Record<string, unknown>;
  t['agente'] = 'tecnico'; t['veredicto'] = 'ACEPTABLE';
  (c.salidas_analistas as unknown as Record<string, unknown>)['tecnico'] = t;
};
const completar = (s: Record<string, unknown>): void => { s['recomendacion_para_motor'] = 'completar_datos'; };
const NEG2 = ['fundamental:h2', 'tecnico:h2'];

describe('v0.10: completar_datos exige un faltante crítico', () => {
  it('acepta completar_datos si el Fundamental declara un faltante crítico', () => {
    expect(err(completar, c => faltantes(c, [{ campo: 'balance', critico: true }]))).toBe('');
  });
  it('acepta si un faltante crítico viene en cualquiera de los analistas presentes', () => {
    expect(err(s => { completar(s); s['hallazgos_negativos_ids'] = NEG2; }, c => { tecnico(c); faltantes(c, [], 'fundamental'); faltantes(c, [{ campo: 'velas', critico: true }], 'tecnico'); })).toBe('');
  });
  it('acepta con un faltante crítico entre varios no críticos', () => {
    expect(err(completar, c => faltantes(c, [{ campo: 'a', critico: false }, { campo: 'b', critico: true }]))).toBe('');
  });
  it('rechaza completar_datos sin ningún faltante', () => {
    expect(err(completar, c => faltantes(c, []))).toContain(MSG);
  });
  it('rechaza completar_datos con faltantes no críticos y sugiere continuar', () => {
    const e = err(completar, c => faltantes(c, [{ campo: 'deuda_largo_plazo', critico: false }]));
    expect(e).toContain(MSG);
    expect(e).toContain('usa continuar');
  });
  it('solo cuenta critico estrictamente true', () => {
    for (const critico of ['true', 1, null, undefined]) {
      expect(err(completar, c => faltantes(c, [{ campo: 'x', critico }]))).toContain(MSG);
    }
  });
  it('datos_faltantes de un analista que no es lista o con elementos que no son objeto no cuentan', () => {
    expect(err(completar, c => faltantes(c, 'balance'))).toContain(MSG);
    expect(err(completar, c => faltantes(c, [true, 'x', null]))).toContain(MSG);
    expect(err(completar, c => { delete analista(c, 'fundamental')['datos_faltantes']; })).toContain(MSG);
  });
  it('los faltantes del propio Director no cuentan como críticos', () => {
    expect(err(s => { completar(s); s['datos_faltantes'] = ['balance']; s['nivel_confianza'] = 0.5; }, c => faltantes(c, []))).toContain(MSG);
  });
  it('no restringe las otras recomendaciones', () => {
    expect(err(s => { s['recomendacion_para_motor'] = 'continuar'; }, c => faltantes(c, [{ campo: 'balance', critico: true }]))).toBe('');
    expect(err(s => { s['recomendacion_para_motor'] = 'continuar'; s['datos_faltantes'] = ['deuda']; s['nivel_confianza'] = TOPE_CONFIANZA_CON_FALTANTES; }, c => faltantes(c, [{ campo: 'deuda', critico: false }]))).toBe('');
    expect(err(s => { s['recomendacion_para_motor'] = 'detener'; }, c => faltantes(c, []))).toBe('');
  });
  it('una recomendación inválida da solo el error de enumeración', () => {
    const e = err(s => { s['recomendacion_para_motor'] = 'comprar'; }, c => faltantes(c, []));
    expect(e).toContain('recomendacion_para_motor debe ser');
    expect(e).not.toContain(MSG);
  });
});

describe('v0.10: prompts p5', () => {
  it('las versiones suben a p5', () => {
    expect(VERSION_PROMPT_FUNDAMENTAL).toBe('fundamental.p6');
    expect(VERSION_PROMPT_DIRECTOR).toBe('director.p6');
  });
  it('el Fundamental pide invalidadores sobre periodos recientes y no sobre años cerrados', () => {
    expect(PROMPT_FUNDAMENTAL).toContain('Un invalidador vigila el FUTURO');
    expect(PROMPT_FUNDAMENTAL).toContain('los `_ttm` si existen');
    expect(PROMPT_FUNDAMENTAL).toContain('HOY todavía no se cumple');
    expect(PROMPT_FUNDAMENTAL).toContain('No uses como umbral un item de un año fiscal ya cerrado (por ejemplo `_fy2025`)');
    expect(PROMPT_FUNDAMENTAL).toContain('por ejemplo `utilidad_neta_ttm`, no `utilidad_neta`');
  });
  it('el Director usa completar_datos solo con faltante crítico y continuar con no críticos', () => {
    expect(PROMPT_DIRECTOR).toContain('Usa `completar_datos` ÚNICAMENTE si algún analista declara un dato faltante con `critico` true.');
    expect(PROMPT_DIRECTOR).toContain('usa `continuar` (con `nivel_confianza` no mayor que 0.6)');
    expect(PROMPT_DIRECTOR).toContain('El código rechaza `completar_datos` sin un faltante crítico.');
  });
});
