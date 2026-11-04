import { describe, expect, it } from 'vitest';
import { ejecutarPruebaFundamental } from './prueba-fundamental';
import type { DepsPrueba } from './prueba-fundamental';
import type { LlamadaModelo, PeticionModelo } from './index';
import { RUN_ID, SNAP_ID } from './fixtures.test-util';
import { modeloFalso } from './modelo-falso.test-util';

const entrada = (fy: number, ingresos: number) => ({
  fiscalYear: fy, fiscalPeriod: 0, endDate: `${fy}-12-31`, currency: 'USD', revenue: ingresos, costOfRevenue: null, grossProfit: ingresos * 0.8, opex: null, sgaExp: null, rndExp: null,
  opIncome: ingresos * 0.2, otherNetIncome: null, ebt: null, incomeTax: null, netIncome: ingresos * 0.1, dilutedAvgShares: 1000, dilutedEps: ingresos * 0.1 / 1000, interestNet: null,
});
const income = { success: true, symbol: 'GKOS', annual: [entrada(2023, 1200), entrada(2024, 1500)], ttm: null, forwardEps: null };

function deps(m: ReturnType<typeof modeloFalso>): DepsPrueba {
  let n = 0;
  return { llamar: m.llamar, modelo_analista: 'a', modelo_director: 'd', nuevoId: () => (n++ === 0 ? RUN_ID : SNAP_ID), ahora: () => '2026-10-30T18:00:00.000Z' };
}

describe('prueba de punta a punta del Fundamental y el Director (modelo falso)', () => {
  it('camino feliz: Fundamental y Director validados, sin guardar y sin exponer ids de relleno', async () => {
    const m = modeloFalso();
    const r = await ejecutarPruebaFundamental(deps(m), { ticker: 'gkos', income_statement: income });
    expect(r.http).toBe(200);
    expect(r.cuerpo['ok']).toBe(true);
    expect(r.cuerpo['ticker']).toBe('GKOS');
    expect(r.cuerpo['guardado']).toBe(false);
    expect(r.cuerpo['items']).toBeGreaterThan(10);
    expect(r.cuerpo['fundamental']).toMatchObject({ estado: 'ok', veredicto: 'NO_EVALUABLE', proveedor: 'openai', modelo: 'modelo-f', tokens_in: 100, tokens_out: 50 });
    expect(r.cuerpo['director']).toMatchObject({ estado: 'ok', veredicto: 'completar_datos', modelo: 'modelo-d' });
    expect(JSON.stringify(r.cuerpo)).not.toContain('00000000-0000-4000-8000-000000000000');
    expect(JSON.stringify(r.cuerpo)).not.toContain('analisis_id');
    expect((r.cuerpo['fundamental'] as Record<string, unknown>)['salida']).toMatchObject({ contrato: 'salida.v1', agente: 'fundamental' });
    expect((r.cuerpo['director'] as Record<string, unknown>)['salida']).toMatchObject({ contrato: 'integracion.v1', agente: 'director_ia' });
    expect(r.cuerpo['avisos_datos']).toContain('ttm: sin datos en la respuesta');
    expect(m.peticiones).toHaveLength(2);
    expect(m.peticiones[0]!.modelo).toBe('a');
    expect(m.peticiones[1]!.modelo).toBe('d');
    const ctx = JSON.parse(m.peticiones[1]!.mensajes[1]!.content) as Record<string, unknown>;
    expect(ctx).toMatchObject({ run_id: RUN_ID, snapshot_id: SNAP_ID, ticker: 'GKOS', mercado: 'US', portafolio_codigo: 'PMP', tipo_evaluacion: 'nueva_posicion', auditoria: null, reglas_versiones_ids: [] });
  });
  it('el proveedor indicado en las dependencias aparece en el resumen de cada agente', async () => {
    const r = await ejecutarPruebaFundamental({ ...deps(modeloFalso()), proveedor: 'gemini' }, { ticker: 'GKOS', income_statement: income });
    expect(r.cuerpo['fundamental']).toMatchObject({ proveedor: 'gemini' });
    expect(r.cuerpo['director']).toMatchObject({ proveedor: 'gemini' });
  });
  it('con_director false: solo corre el Fundamental; portafolio configurable', async () => {
    const m = modeloFalso();
    const r = await ejecutarPruebaFundamental(deps(m), { ticker: 'GKOS', income_statement: income, con_director: false });
    expect(r.cuerpo['director']).toBeUndefined();
    expect(m.peticiones).toHaveLength(1);
    const m2 = modeloFalso();
    await ejecutarPruebaFundamental(deps(m2), { ticker: 'GKOS', income_statement: income, portafolio: 'PLP' });
    expect(JSON.parse(m2.peticiones[1]!.mensajes[1]!.content)).toMatchObject({ portafolio_codigo: 'PLP' });
  });
  it('si el Fundamental no produce salida válida, el Director se omite y no se simula nada', async () => {
    const m = modeloFalso({ fundamentalMalo: true });
    const r = await ejecutarPruebaFundamental(deps(m), { ticker: 'GKOS', income_statement: income });
    expect(r.http).toBe(200);
    expect(r.cuerpo['fundamental']).toMatchObject({ estado: 'error' });
    expect((r.cuerpo['fundamental'] as Record<string, unknown>)['salida']).toBeUndefined();
    expect(r.cuerpo['director']).toEqual({ estado: 'omitido', motivo: 'el Fundamental no produjo una salida validada' });
    expect(m.peticiones).toHaveLength(2); // los dos intentos del Fundamental, ninguno del Director
  });
  it('si el Director falla la validación, se informa el error del Director y se conserva el Fundamental', async () => {
    const m = modeloFalso({ directorMalo: true });
    const r = await ejecutarPruebaFundamental(deps(m), { ticker: 'GKOS', income_statement: income });
    expect(r.cuerpo['fundamental']).toMatchObject({ estado: 'ok' });
    expect(r.cuerpo['director']).toMatchObject({ estado: 'error' });
    expect(typeof (r.cuerpo['director'] as Record<string, unknown>)['error']).toBe('string');
  });
  it('los datos de Finnhub se suman a los de Webull, se cuentan aparte y el modelo los recibe en el snapshot', async () => {
    const m = modeloFalso();
    const finnhub = { data: [{ year: 2025, quarter: 0, form: '10-K', endDate: '2025-12-31 00:00:00', filedDate: '2026-02-23 00:00:00', report: { bs: [{ concept: 'us-gaap_Assets', unit: 'u_usd', value: 893487000 }], cf: [] } }] };
    const r = await ejecutarPruebaFundamental(deps(m), { ticker: 'GKOS', income_statement: income, finnhub_reportado: finnhub, finnhub_metric: { metric: { currentRatioAnnual: 4.69 } }, con_director: false });
    expect(r.http).toBe(200);
    expect(r.cuerpo['items_finnhub']).toBe(2);
    const sobre = JSON.parse(m.peticiones[0]!.mensajes[1]!.content) as { snapshot: { datos: { items: { id: string }[] } } };
    const ids = sobre.snapshot.datos.items.map(i => i.id);
    expect(ids).toContain('activos_totales_fy2025');
    expect(ids).toContain('razon_corriente_anual_proveedor_a_fecha_de_consulta');
    expect(ids).toContain('margen_bruto_fy2024');
    expect(r.cuerpo['avisos_datos']).toContain('fy2025: sin concepto para efectivo (se omite; no se asume cero)');
  });
  it('basta con una sola de las tres entradas de Finnhub: cada una se pasa al convertidor', async () => {
    const trimestral = { data: [{ year: 2026, quarter: 3, form: '10-Q', endDate: '2026-09-30', report: { bs: [], cf: [{ concept: 'us-gaap_NetCashProvidedByUsedInOperatingActivities', unit: 'u_usd', value: 5 }] } }] };
    const a = await ejecutarPruebaFundamental(deps(modeloFalso()), { ticker: 'GKOS', income_statement: income, finnhub_reportado_trimestral: trimestral, con_director: false });
    expect(a.cuerpo['items_finnhub']).toBe(1);
    const b = await ejecutarPruebaFundamental(deps(modeloFalso()), { ticker: 'GKOS', income_statement: income, finnhub_metric: { metric: { currentRatioAnnual: 4.69 } }, con_director: false });
    expect(b.cuerpo['items_finnhub']).toBe(1);
    const c = await ejecutarPruebaFundamental(deps(modeloFalso()), { ticker: 'GKOS', income_statement: income, finnhub_reportado: { data: [{ year: 2025, quarter: 0, form: '10-K', endDate: '2025-12-31', report: { bs: [{ concept: 'us-gaap_Assets', unit: 'u_usd', value: 1 }], cf: [] } }] }, con_director: false });
    expect(c.cuerpo['items_finnhub']).toBe(1);
  });
  it('sin datos de Finnhub, items_finnhub es 0; datos de Finnhub inválidos dan 422 sin llamar al modelo', async () => {
    const m = modeloFalso();
    const sin = await ejecutarPruebaFundamental(deps(m), { ticker: 'GKOS', income_statement: income, con_director: false });
    expect(sin.cuerpo['items_finnhub']).toBe(0);
    const m2 = modeloFalso();
    const mal = await ejecutarPruebaFundamental(deps(m2), { ticker: 'GKOS', income_statement: income, finnhub_reportado: { data: 'x' } });
    expect(mal.http).toBe(422);
    expect(String(mal.cuerpo['error'])).toContain('datos de Finnhub inválidos');
    expect(m2.peticiones).toHaveLength(0);
    const colision = await ejecutarPruebaFundamental(deps(modeloFalso()), { ticker: 'GKOS', income_statement: income, items_extra: [{ id: 'activos_totales_fy2025', campo: 'x', valor: 1, unidad: null, fuente: 'f', fecha_dato: '2025-12-31' }], finnhub_reportado: { data: [{ year: 2025, quarter: 0, form: '10-K', endDate: '2025-12-31', report: { bs: [{ concept: 'us-gaap_Assets', unit: 'u_usd', value: 1 }], cf: [] } }] } });
    expect(colision.http).toBe(422);
    expect(String(colision.cuerpo['error'])).toContain('repetido');
  });
  it('items_extra se suman a los datos y se validan como cualquier dato', async () => {
    const m = modeloFalso();
    const extra = { id: 'deuda_neta_2025', campo: 'deuda_neta', valor: 50, unidad: 'USD', fuente: 'Captura manual del 10-K', fecha_dato: '2025-12-31' };
    const r = await ejecutarPruebaFundamental(deps(m), { ticker: 'GKOS', income_statement: income, items_extra: [extra] });
    expect(r.http).toBe(200);
    const sobre = JSON.parse(m.peticiones[0]!.mensajes[1]!.content) as { snapshot: { datos: { items: { id: string }[] } } };
    expect(sobre.snapshot.datos.items.some(i => i.id === 'deuda_neta_2025')).toBe(true);
    const mala = await ejecutarPruebaFundamental(deps(modeloFalso()), { ticker: 'GKOS', income_statement: income, items_extra: [{ ...extra, fuente: '' }] });
    expect(mala.http).toBe(422);
    expect(String(mala.cuerpo['error'])).toContain('el sobre no es válido');
    const dup = await ejecutarPruebaFundamental(deps(modeloFalso()), { ticker: 'GKOS', income_statement: income, items_extra: [{ ...extra, id: 'ingresos_fy2024' }] });
    expect(dup.http).toBe(422);
    expect(String(dup.cuerpo['error'])).toContain('repetido');
  });
  it('validaciones de la petición: 400 sin llamar al modelo', async () => {
    const m = modeloFalso();
    const casos: unknown[] = [
      null, 'x', [], { income_statement: income }, { ticker: 'no valido!', income_statement: income }, { ticker: 'GKOS', income_statement: income, extra: 1 },
      { ticker: 'GKOS', income_statement: income, con_director: 'si' }, { ticker: 'GKOS', income_statement: income, portafolio: 'X' },
      { ticker: 'GKOS', income_statement: income, items_extra: 'x' }, { ticker: 'GKOS', income_statement: income, items_extra: new Array(101).fill({}) },
    ];
    for (const c of casos) expect((await ejecutarPruebaFundamental(deps(m), c)).http).toBe(400);
    expect(m.peticiones).toHaveLength(0);
    expect((await ejecutarPruebaFundamental(deps(m), { ticker: 'GKOS', income_statement: income, items_extra: new Array(100).fill({}) })).http).toBe(422);
  });
  it('datos insuficientes: 422 sin llamar al modelo', async () => {
    const m = modeloFalso();
    const r = await ejecutarPruebaFundamental(deps(m), { ticker: 'GKOS', income_statement: { success: false } });
    expect(r.http).toBe(422);
    expect(String(r.cuerpo['error'])).toContain('datos insuficientes');
    expect(m.peticiones).toHaveLength(0);
  });
});
