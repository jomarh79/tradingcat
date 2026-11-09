// Pruebas de la v0.5: mensajes de error del Director, avisos de datos en el snapshot, prompts y versiones.
import { describe, expect, it } from 'vitest';
import {
  MAX_AVISOS_SNAPSHOT, MAX_REFS_EN_MENSAJE, PROMPT_DIRECTOR, PROMPT_FUNDAMENTAL, VERSION_PROMPT_DIRECTOR, VERSION_PROMPT_FUNDAMENTAL,
  armarSobreFundamental, limitarAvisos, validarContextoDirector, validarSalidaDirector, validarSobreFundamental,
} from './index';
import { ejecutarPruebaFundamental } from './prueba-fundamental';
import type { LlamadaModelo, PeticionModelo } from './index';
import { RUN_ID, SNAP_ID, contextoBase, salidaDirectorBase, sobreBase } from './fixtures.test-util';

const GEN = '2026-10-30T18:00:00.000Z';

function erroresDirector(mutarSalida: (s: Record<string, unknown>) => void, mutarCtx: (c: ReturnType<typeof contextoBase>) => void = () => undefined): string {
  const ctx = JSON.parse(JSON.stringify(contextoBase())) as ReturnType<typeof contextoBase>;
  mutarCtx(ctx);
  const s = JSON.parse(JSON.stringify(salidaDirectorBase())) as Record<string, unknown>;
  mutarSalida(s);
  const c = validarContextoDirector(ctx);
  if (!c.ok) return `CTX: ${c.errores.join(' | ')}`;
  const r = validarSalidaDirector(s, c.valor);
  return r.ok ? '' : r.errores.join(' | ');
}
const coincidencia = (s: Record<string, unknown>, evidencia: string[]): void => {
  ((s['integracion'] as Record<string, unknown>)['coincidencias'] as Record<string, unknown>[])[0]!['evidencia'] = evidencia;
};

describe('v0.5: el error del Director dice el formato y las referencias válidas', () => {
  it('una referencia sin agente (h1) se rechaza con formato, ejemplo y lista de válidas', () => {
    const e = erroresDirector(s => coincidencia(s, ['h1']));
    expect(e).toContain('coincidencias[0] cita una referencia inexistente: h1');
    expect(e).toContain('el formato es agente:id, por ejemplo fundamental:h1');
    expect(e).toContain('referencias válidas: fundamental:h1, fundamental:h2');
  });
  it('la lista de válidas se corta en el máximo del mensaje', () => {
    const hallazgos = Array.from({ length: MAX_REFS_EN_MENSAJE + 5 }, (_, i) => ({ id: `h${String(i + 1)}`, tipo: i === 1 ? 'negativo' : 'positivo', texto: `Hallazgo ${String(i + 1)}.`, evidencia: ['d2'] }));
    const e = erroresDirector(s => coincidencia(s, ['h1']), c => { (c.salidas_analistas.fundamental as unknown as Record<string, unknown>)['hallazgos'] = hallazgos; });
    const lista = e.split('referencias válidas: ')[1]!.replace(/\)$/, '').split(', ');
    expect(lista).toHaveLength(MAX_REFS_EN_MENSAJE);
    expect(lista[MAX_REFS_EN_MENSAJE - 1]).toBe(`fundamental:h${String(MAX_REFS_EN_MENSAJE)}`);
  });
  it('sin hallazgos disponibles dice «ninguna» y da un ejemplo de formato', () => {
    const e = erroresDirector(s => { coincidencia(s, ['h1']); s['hallazgos_negativos_ids'] = []; }, c => { (c.salidas_analistas.fundamental as unknown as Record<string, unknown>)['hallazgos'] = []; });
    expect(e).toContain('referencias válidas: ninguna');
    expect(e).toContain('por ejemplo fundamental:h1');
  });
  it('el ejemplo del formato es una referencia válida real, no una fija', () => {
    const e = erroresDirector(s => coincidencia(s, ['h7']), c => {
      (c.salidas_analistas.fundamental as unknown as Record<string, unknown>)['hallazgos'] = [{ id: 'h4', tipo: 'negativo', texto: 'Riesgo.', evidencia: ['d3'] }, { id: 'h9', tipo: 'positivo', texto: 'Margen.', evidencia: ['d2'] }];
    });
    expect(e).toContain('por ejemplo fundamental:h4;');
    expect(e).toContain('referencias válidas: fundamental:h4, fundamental:h9');
  });
  it('los topes del mensaje y del snapshot son 20 referencias y 40 avisos', () => {
    expect(MAX_REFS_EN_MENSAJE).toBe(20);
    expect(MAX_AVISOS_SNAPSHOT).toBe(40);
  });
  it('una referencia con formato correcto sigue aceptándose', () => {
    expect(erroresDirector(s => coincidencia(s, ['fundamental:h1']))).toBe('');
  });
});

describe('v0.5: avisos de datos en el snapshot', () => {
  const conAvisos = (avisos: unknown) => { const s = JSON.parse(JSON.stringify(sobreBase())) as Record<string, unknown>; ((s['snapshot'] as Record<string, unknown>)['datos'] as Record<string, unknown>)['avisos'] = avisos; return s; };
  it('el sobre valida con avisos de texto o sin avisos', () => {
    expect(validarSobreFundamental(sobreBase()).ok).toBe(true);
    expect(validarSobreFundamental(conAvisos(['fy2025: sin concepto para deuda_largo_plazo'])).ok).toBe(true);
    expect(validarSobreFundamental(conAvisos([])).ok).toBe(true);
  });
  it('el sobre rechaza avisos que no son lista o contienen textos vacíos o no texto', () => {
    expect(validarSobreFundamental(conAvisos('texto')).ok).toBe(false);
    expect(validarSobreFundamental(conAvisos([''])).ok).toBe(false);
    expect(validarSobreFundamental(conAvisos(['a', 5])).ok).toBe(false);
    expect(validarSobreFundamental(conAvisos(null)).ok).toBe(false);
  });
  it('limitarAvisos: igual o por debajo del máximo no toca nada; por encima resume el resto en una línea', () => {
    const cinco = ['a', 'b', 'c', 'd', 'e'];
    expect(limitarAvisos(cinco, 5)).toEqual(cinco);
    expect(limitarAvisos(cinco, 6)).toEqual(cinco);
    expect(limitarAvisos([], 3)).toEqual([]);
    expect(limitarAvisos(cinco, 4)).toEqual(['a', 'b', 'c', 'y 2 avisos más (omitidos del snapshot)']);
    expect(limitarAvisos(cinco, 3)).toEqual(['a', 'b', 'y 3 avisos más (omitidos del snapshot)']);
  });
  it('armarSobreFundamental incluye avisos solo si hay alguno', () => {
    const base = { run_id: RUN_ID, snapshot_id: SNAP_ID, generado_en: GEN, ticker: 'GKOS', mercado: 'US', items: [], tesis_vigente: null };
    const datos = (a: Parameters<typeof armarSobreFundamental>[0]) => (armarSobreFundamental(a) as { snapshot: { datos: unknown } }).snapshot.datos;
    expect(datos({ ...base, avisos: ['x'] })).toEqual({ items: [], avisos: ['x'] });
    expect(datos({ ...base, avisos: [] })).toEqual({ items: [] });
    expect(datos(base)).toEqual({ items: [] });
  });
});

describe('v0.5: la prueba entrega los avisos al modelo (acotados)', () => {
  const entrada = (fy: number) => ({ fiscalYear: fy, fiscalPeriod: 0, endDate: `${fy}-12-31`, currency: 'USD', revenue: 1000, costOfRevenue: null, grossProfit: 800, opex: null, sgaExp: null, rndExp: null, opIncome: 200, otherNetIncome: null, ebt: null, incomeTax: null, netIncome: 100, dilutedAvgShares: 1000, dilutedEps: 0.1, interestNet: null });
  const income = { success: true, symbol: 'GKOS', annual: [entrada(2023), entrada(2024)], ttm: null, forwardEps: null };
  function capturar() {
    const peticiones: PeticionModelo[] = [];
    const llamar: LlamadaModelo = async p => { peticiones.push(p); return { ok: true, texto: '{}', json: {}, modelo: 'm' }; };
    let n = 0;
    return { peticiones, deps: { llamar, modelo_analista: 'a', modelo_director: 'd', nuevoId: () => (n++ === 0 ? RUN_ID : SNAP_ID), ahora: () => GEN } };
  }
  const datosDe = (p: PeticionModelo) => ((JSON.parse(p.mensajes[1]!.content) as { snapshot: { datos: { avisos?: string[] } } }).snapshot.datos);
  it('los avisos del convertidor llegan al snapshot que ve el modelo', async () => {
    const c = capturar();
    await ejecutarPruebaFundamental(c.deps, { ticker: 'GKOS', income_statement: income, con_director: false });
    expect(datosDe(c.peticiones[0]!).avisos).toContain('ttm: sin datos en la respuesta');
  });
  it('si hay más avisos que el máximo, el modelo recibe el máximo con una línea de resumen y el cuerpo conserva todos', async () => {
    const c = capturar();
    const sinConceptos = (y: number) => ({ year: y, quarter: 0, form: '10-K', endDate: `${y}-12-31`, filedDate: `${y + 1}-02-20`, report: { bs: [{ concept: 'otro_concepto', unit: 'u_usd', value: 1 }], cf: [{ concept: 'otro_concepto', unit: 'u_usd', value: 1 }] } });
    const r = await ejecutarPruebaFundamental(c.deps, { ticker: 'GKOS', income_statement: income, finnhub_reportado: { data: [sinConceptos(2025), sinConceptos(2024), sinConceptos(2023)] }, con_director: false });
    const avisos = datosDe(c.peticiones[0]!).avisos!;
    expect(avisos).toHaveLength(MAX_AVISOS_SNAPSHOT);
    expect(avisos[MAX_AVISOS_SNAPSHOT - 1]).toMatch(/^y \d+ avisos más \(omitidos del snapshot\)$/);
    expect((r.cuerpo['avisos_datos'] as string[]).length).toBeGreaterThan(MAX_AVISOS_SNAPSHOT);
  });
});

describe('v0.5: prompts y versiones', () => {
  it('versiones vigentes', () => {
    expect(VERSION_PROMPT_FUNDAMENTAL).toBe('fundamental.p7');
    expect(VERSION_PROMPT_DIRECTOR).toBe('director.p7');
  });
  it('Fundamental: escala 0-100, evidencia directa, avisos y datos ausentes', () => {
    expect(PROMPT_FUNDAMENTAL).toContain('escala de 0 a 100');
    expect(PROMPT_FUNDAMENTAL).toContain('Nunca uses escala de 0 a 10');
    expect(PROMPT_FUNDAMENTAL).toContain('DIRECTAMENTE');
    expect(PROMPT_FUNDAMENTAL).toContain('«continuo»');
    expect(PROMPT_FUNDAMENTAL).toContain('crecimiento_*');
    expect(PROMPT_FUNDAMENTAL).toContain('snapshot.datos.avisos');
    expect(PROMPT_FUNDAMENTAL).toContain('datos_faltantes');
    expect(PROMPT_FUNDAMENTAL).toContain('reduce la `confianza`');
    expect(PROMPT_FUNDAMENTAL).toContain('Nunca afirmes nada sobre un tema cuyo dato un aviso dice que falta');
  });
  it('Director: referencias agente:id también en coincidencias y contradicciones', () => {
    expect(PROMPT_DIRECTOR).toContain('`agente:id`');
    expect(PROMPT_DIRECTOR).toContain('`integracion.coincidencias[].evidencia`');
    expect(PROMPT_DIRECTOR).toContain('`contradicciones[].evidencia`');
    expect(PROMPT_DIRECTOR).toContain('nunca solo `h3`');
  });
});
