// Pruebas de la v0.20: (1) el Director recibe los analistas requeridos sin resultado y no los sustituye; (2) coherencia del veredicto del Técnico con las señales calculadas; (3) prompt director.p7.
import { describe, expect, it } from 'vitest';
import {
  PROMPT_DIRECTOR, SENALES_ENTRADA_TECNICO, SENALES_SALIDA_TECNICO, VERIFICAR_COHERENCIA_VEREDICTO_TECNICO, VERSION_PROMPT_DIRECTOR,
  validarContextoDirector, validarSalidaDirector, validarSalidaTecnicoIa, validarSobreTecnico,
} from './index';
import type { SobreTecnicoValido } from './index';
import { contextoBase, salidaDirectorBase } from './fixtures.test-util';
import { velasDiarias, velasSemanales } from './velas.test-util';
import { prepararTecnico } from '../orquestador/preparar-tecnico';
import type { Obj } from './utilidades';

describe('v0.20: contexto del Director con analistas requeridos sin resultado', () => {
  const conLista = (v: unknown): ReturnType<typeof validarContextoDirector> => validarContextoDirector({ ...contextoBase(), analistas_requeridos_sin_resultado: v });
  it('si falta el campo, se entiende vacío', () => {
    const r = validarContextoDirector(contextoBase());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valor.analistas_requeridos_sin_resultado).toEqual([]);
  });
  it('lista válida', () => {
    const r = conLista(['valuacion', 'riesgo_capital']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valor.analistas_requeridos_sin_resultado).toEqual(['valuacion', 'riesgo_capital']);
  });
  it('no es lista, analista desconocido o repetido, o figura también con salida: se rechaza', () => {
    for (const malo of ['valuacion', { a: 1 }, 5, null, ['valuacion', 'inventado'], [5]]) {
      const r = conLista(malo);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errores).toContain('analistas_requeridos_sin_resultado debe ser una lista de analistas conocidos');
    }
    const rep = conLista(['valuacion', 'valuacion']);
    expect(rep.ok === false && rep.errores).toContain('analistas_requeridos_sin_resultado tiene analistas repetidos');
    const solapa = conLista(['fundamental']);
    expect(solapa.ok === false && solapa.errores).toContain('fundamental figura a la vez con salida y sin resultado');
  });
});

describe('v0.20: salida del Director con analistas requeridos faltantes', () => {
  const ctxCon = (...sin: string[]) => { const r = conCtx(sin); return r; };
  function conCtx(sin: string[]) {
    const r = validarContextoDirector({ ...contextoBase(), analistas_requeridos_sin_resultado: sin });
    if (!r.ok) throw new Error(r.errores.join('; '));
    return r.valor;
  }
  const errs = (s: Obj, ...sin: string[]): string[] => { const r = validarSalidaDirector(s, ctxCon(...sin)); return r.ok ? [] : r.errores; };
  const salida = (c: Obj = {}): Obj => ({ ...salidaDirectorBase(), ...c });
  const EXITO = { recomendacion_para_motor: 'completar_datos', datos_faltantes: ['valuacion: sin análisis'] };
  it('sin faltantes: todo igual que antes (continuar vale; completar_datos sin faltante crítico se rechaza)', () => {
    expect(errs(salida())).toEqual([]);
    expect(errs(salida({ recomendacion_para_motor: 'completar_datos' })).some(e => e.includes('ningún analista declara un dato faltante crítico'))).toBe(true);
  });
  it('con un requerido faltante, continuar se rechaza y el mensaje nombra al analista', () => {
    const e = errs(salida({ datos_faltantes: ['valuacion'] }), 'valuacion');
    expect(e).toContain('faltan analistas requeridos (valuacion): recomendacion_para_motor no puede ser continuar; usa completar_datos o detener');
  });
  it('completar_datos o detener con el analista nombrado pasan', () => {
    expect(errs(salida(EXITO), 'valuacion')).toEqual([]);
    expect(errs(salida({ ...EXITO, recomendacion_para_motor: 'detener' }), 'valuacion')).toEqual([]);
  });
  it('el analista debe estar nombrado en datos_faltantes (sin importar mayúsculas ni el texto alrededor)', () => {
    const sin = errs(salida({ recomendacion_para_motor: 'completar_datos', datos_faltantes: ['balance'] }), 'valuacion');
    expect(sin).toContain('datos_faltantes debe nombrar al analista requerido sin resultado: valuacion');
    expect(errs(salida({ recomendacion_para_motor: 'completar_datos', datos_faltantes: ['Falta el análisis de VALUACION'] }), 'valuacion')).toEqual([]);
  });
  it('con dos faltantes se exige nombrar a los dos, cada uno con su error', () => {
    const e = errs(salida({ recomendacion_para_motor: 'completar_datos', datos_faltantes: ['valuacion'] }), 'valuacion', 'riesgo_capital');
    expect(e).toEqual(['datos_faltantes debe nombrar al analista requerido sin resultado: riesgo_capital']);
    expect(errs(salida({ recomendacion_para_motor: 'completar_datos', datos_faltantes: ['valuacion', 'riesgo_capital'] }), 'valuacion', 'riesgo_capital')).toEqual([]);
  });
  it('nombrarlo no basta si la recomendación sigue siendo continuar', () => {
    expect(errs(salida({ datos_faltantes: ['valuacion'] }), 'valuacion')).toHaveLength(1);
  });
  it('el tope de confianza con datos faltantes sigue aplicando', () => {
    const e = errs(salida({ ...EXITO, nivel_confianza: 0.9 }), 'valuacion');
    expect(e.some(x => x.includes('nivel_confianza'))).toBe(true);
  });
});

describe('v0.20: prompt director.p7', () => {
  it('versión y reglas', () => {
    expect(VERSION_PROMPT_DIRECTOR).toBe('director.p7');
    for (const t of ['analistas_requeridos_sin_resultado', '(puede venir vacío) lista los analistas REQUERIDOS que no entregaron un análisis válido', 'nómbralo por su id en `datos_faltantes`', 'no sustituyas ni estimes lo que aportaría', 'la recomendación es `completar_datos` o `detener`', 'El código rechaza lo contrario']) expect(PROMPT_DIRECTOR).toContain(t);
  });
  it('conserva la regla de completar_datos con faltante crítico de un analista', () => {
    expect(PROMPT_DIRECTOR).toContain('Usa `completar_datos` ÚNICAMENTE si algún analista declara un dato faltante con `critico` true. También vale si hay analistas requeridos sin resultado');
  });
});

describe('v0.20: coherencia del veredicto del Técnico con las señales calculadas', () => {
  const AHORA = '2026-11-04T15:00:00.000Z';
  const RUN = '11111111-1111-4111-8111-111111111111';
  const SNAP = '22222222-2222-4222-8222-222222222222';
  const tc = prepararTecnico({ ticker: 'GKOS', mercado: 'US', evaluado_en: AHORA, fuente: 'TwelveData', velas_diarias: velasDiarias('2026-11-03', 600), velas_semanales: velasSemanales('2026-11-02', 260) }) as unknown as Obj;
  const r0 = validarSobreTecnico({
    contrato: 'entrada.v1', run_id: RUN, agente: 'tecnico', ticker: 'GKOS', mercado: 'US', snapshot: { id: SNAP, generado_en: AHORA },
    tecnico_codigo: { estado: tc['estado'], snapshot: tc['snapshot'], detonantes: tc['detonantes'], descartes: tc['descartes'], motivos: tc['motivos'] },
  });
  if (!r0.ok) throw new Error(r0.errores.join('; '));
  const s0: SobreTecnicoValido = r0.valor;
  const con = (cumplidas: string[], ema200: boolean | null, noCumplidas: string[] = []): SobreTecnicoValido => ({
    ...s0, snapshot: { ...s0.snapshot, cierre_sobre_ema200_diaria: ema200, senales: [...cumplidas.map(id => ({ id, cumplida: true, detalle: 'x' })), ...noCumplidas.map(id => ({ id, cumplida: false, detalle: 'x' })), { id: 'NIVEL_PASADO', cumplida: null, detalle: 'sin datos' }] },
  }) as unknown as SobreTecnicoValido;
  const salida = (v: string): Obj => ({
    contrato: 'salida.v1', agente: 'tecnico', run_id: RUN, snapshot_id: SNAP, ticker: 'GKOS', veredicto: v, confianza: 0.7, resumen: 'Estado técnico descrito.',
    tendencia: { corto: 'lateral', medio: 'lateral', largo: 'alcista' },
    hallazgos: [{ id: 'h1', tipo: 'neutral', texto: 'El precio cerró en la última sesión confirmada.', evidencia: ['cierre_ultima_vela_diaria'] }],
    negativos: ['Sin novedades adversas.'], datos_fuente: [s0.items.find(i => i.id === 'cierre_ultima_vela_diaria')!],
    zona_entrada: null, soporte_clave: null, resistencia_clave: null, nivel_invalidacion: null, datos_faltantes: [],
  }) as Obj;
  const coh = (v: string, s: SobreTecnicoValido): string[] => { const r = validarSalidaTecnicoIa(salida(v), s); return (r.ok ? [] : r.errores).filter(e => e.includes('las señales calculadas no lo respaldan')); };
  it('constantes', () => {
    expect(VERIFICAR_COHERENCIA_VEREDICTO_TECNICO).toBe(true);
    expect(SENALES_ENTRADA_TECNICO.length + SENALES_SALIDA_TECNICO.length).toBe(8);
  });
  it('ESPERAR no tiene restricción, con o sin señales', () => {
    expect(coh('ESPERAR', con([], null))).toEqual([]);
    expect(coh('ESPERAR', con(['EMA8_SOBRE_EMA21'], true))).toEqual([]);
    expect(coh('ESPERAR', con(['RSI_SOBRECOMPRA'], false))).toEqual([]);
  });
  it('FAVORABLE exige una señal de entrada cumplida', () => {
    for (const id of SENALES_ENTRADA_TECNICO) expect(coh('FAVORABLE', con([id], null))).toEqual([]);
    const e = coh('FAVORABLE', con([], true, ['EMA8_SOBRE_EMA21']));
    expect(e).toHaveLength(1);
    expect(e[0]).toContain(`(${SENALES_ENTRADA_TECNICO.join(', ')})`);
  });
  it('FAVORABLE: una señal de salida cumplida no cuenta como de entrada, y una no cumplida o sin datos tampoco', () => {
    expect(coh('FAVORABLE', con(['RSI_SOBRECOMPRA', 'MOGALEF_BANDA_SUPERIOR', 'RESISTENCIA_PASADA'], true))).toHaveLength(1);
    expect(coh('FAVORABLE', con([], true, [...SENALES_ENTRADA_TECNICO]))).toHaveLength(1);
  });
  it('DESFAVORABLE exige una señal de salida cumplida o el cierre bajo la EMA200 diaria', () => {
    for (const id of SENALES_SALIDA_TECNICO) expect(coh('DESFAVORABLE', con([id], true))).toEqual([]);
    expect(coh('DESFAVORABLE', con([], false))).toEqual([]);
    const e = coh('DESFAVORABLE', con([], true));
    expect(e).toHaveLength(1);
    expect(e[0]).toContain(`(${SENALES_SALIDA_TECNICO.join(', ')})`);
  });
  it('DESFAVORABLE: bandera EMA200 sin datos (null) no cuenta; una señal de entrada cumplida tampoco', () => {
    expect(coh('DESFAVORABLE', con([], null))).toHaveLength(1);
    expect(coh('DESFAVORABLE', con(['EMA8_SOBRE_EMA21'], true))).toHaveLength(1);
  });
  it('NO_EVALUABLE no pasa por esta regla', () => {
    expect(coh('NO_EVALUABLE', con([], null))).toEqual([]);
  });
});
