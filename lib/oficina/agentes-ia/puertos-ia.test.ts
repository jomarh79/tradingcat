import { describe, expect, it } from 'vitest';
import { ESQUEMA_DIRECTOR, ESQUEMA_FUNDAMENTAL, PROMPT_DIRECTOR, PROMPT_FUNDAMENTAL, crearPuertoAnalista, crearPuertoDirector, filaAnalisisIa, guardarAnalisisIa } from './index';
import type { GuardarAnalisisIa, LlamadaModelo, PeticionModelo, RespuestaModelo, TrazabilidadIa } from './index';
import { ANALISIS_ID, RUN_ID, SNAP_ID, contextoBase, salidaBase, salidaDirectorBase, sobreBase } from './fixtures.test-util';

const EXP_ID = '44444444-4444-4444-8444-444444444444';
const AHORA = '2026-10-30T18:00:00Z';

function modeloGuion(respuestas: (unknown | RespuestaModelo)[]) {
  const peticiones: PeticionModelo[] = [];
  let i = 0;
  const llamar: LlamadaModelo = async p => {
    peticiones.push({ ...p, mensajes: p.mensajes.slice() });
    const r = respuestas[Math.min(i++, respuestas.length - 1)];
    if (typeof r === 'object' && r !== null && 'ok' in r && typeof (r as { ok: unknown }).ok === 'boolean') return r as RespuestaModelo;
    return { ok: true, texto: JSON.stringify(r), json: r, modelo: 'modelo-real', tokens_in: 10, tokens_out: 5 };
  };
  return { llamar, peticiones };
}
function armar(respuestas: (unknown | RespuestaModelo)[], guardarOk = true) {
  const m = modeloGuion(respuestas);
  const guardados: { salida: Record<string, unknown>; tra: TrazabilidadIa }[] = [];
  const guardadosA: typeof guardados = [];
  const guardadosD: typeof guardados = [];
  const resultado = (): { ok: true; analisis_id: string } | { ok: false; error: string } => (guardarOk ? { ok: true, analisis_id: ANALISIS_ID } : { ok: false, error: 'falla bd' });
  const guardarA: GuardarAnalisisIa = async (salida, tra) => { guardados.push({ salida, tra }); guardadosA.push({ salida, tra }); return resultado(); };
  const guardarD: GuardarAnalisisIa = async (salida, tra) => { guardados.push({ salida, tra }); guardadosD.push({ salida, tra }); return resultado(); };
  const opc = { llamar: m.llamar, modelo_analista: 'm-analista', modelo_director: 'm-director', ahora: () => AHORA, guardar_analista: guardarA, guardar_director: guardarD };
  return { ...m, guardados, guardadosA, guardadosD, analista: crearPuertoAnalista(opc), director: crearPuertoDirector(opc) };
}

describe('puerto del Analista Fundamental', () => {
  it('camino feliz: valida, guarda con trazabilidad y devuelve la salida validada', async () => {
    const t = armar([salidaBase()]);
    const r = await t.analista('fundamental', sobreBase());
    expect(r).toEqual({ estado: 'ok', analisis_id: ANALISIS_ID, veredicto: 'ACEPTABLE', salida: salidaBase(), proveedor: 'openai', modelo: 'modelo-real', tokens_in: 10, tokens_out: 5 });
    expect(t.peticiones).toHaveLength(1);
    expect(t.peticiones[0]!.modelo).toBe('m-analista');
    expect(t.peticiones[0]!.esquema_nombre).toBe('salida_fundamental_v1');
    expect(t.peticiones[0]!.mensajes[0]).toEqual({ role: 'system', content: PROMPT_FUNDAMENTAL });
    expect(t.peticiones[0]!.esquema).toBe(ESQUEMA_FUNDAMENTAL);
    expect(t.guardadosA).toHaveLength(1);
    expect(t.guardadosD).toHaveLength(0);
    expect(t.peticiones[0]!.mensajes[1]).toEqual({ role: 'user', content: JSON.stringify(sobreBase()) });
    expect(t.guardados).toHaveLength(1);
    expect(t.guardados[0]!.salida).toEqual(salidaBase());
    expect(t.guardados[0]!.tra).toEqual({ proveedor: 'openai', modelo: 'modelo-real', contrato: 'salida.v1', version_prompt: 'fundamental.p1', run_id: RUN_ID, snapshot_id: SNAP_ID, intentos: 1, generado_en: AHORA });
  });
  it('sobre sin datos obligatorios: error explícito y NO se llama al modelo ni se guarda', async () => {
    const t = armar([salidaBase()]);
    const sin = sobreBase(); sin.snapshot.datos.items = [];
    const r = await t.analista('fundamental', sin);
    expect(r.estado).toBe('error');
    expect(r.error).toContain('sobre del Fundamental inválido');
    expect(r.error).toContain('snapshot.datos.items');
    expect(t.peticiones).toHaveLength(0);
    expect(t.guardados).toHaveLength(0);
    expect((await t.analista('fundamental', null)).estado).toBe('error');
  });
  it('otro analista: error «no implementado», sin llamar al modelo', async () => {
    const t = armar([salidaBase()]);
    for (const a of ['tecnico', 'valuacion', 'riesgo_capital'] as const) {
      const r = await t.analista(a, sobreBase());
      expect(r).toEqual({ estado: 'error', error: `analista ${a}: no implementado todavía` });
    }
    expect(t.peticiones).toHaveLength(0);
  });
  it('reintenta UNA vez con el error del validador y acepta la corrección; intentos queda en 2 y los tokens se suman', async () => {
    const mala = { ...salidaBase(), negativos: [] };
    const t = armar([mala, salidaBase()]);
    const r = await t.analista('fundamental', sobreBase());
    expect(r.estado).toBe('ok');
    expect(r.tokens_in).toBe(20);
    expect(r.tokens_out).toBe(10);
    expect(t.peticiones).toHaveLength(2);
    const m2 = t.peticiones[1]!.mensajes;
    expect(m2).toHaveLength(4);
    expect(m2[2]).toEqual({ role: 'assistant', content: JSON.stringify(mala) });
    expect(m2[3]!.role).toBe('user');
    expect(m2[3]!.content).toContain('rechazada por el validador');
    expect(m2[3]!.content).toContain('negativos');
    expect(t.guardados).toHaveLength(1);
    expect(t.guardados[0]!.tra.intentos).toBe(2);
  });
  it('si falla la validación dos veces: error, nada guardado, sin análisis aprobado (D-06)', async () => {
    const mala = { ...salidaBase(), negativos: [] };
    const t = armar([mala, mala, salidaBase()]);
    const r = await t.analista('fundamental', sobreBase());
    expect(r.estado).toBe('error');
    expect(r.error).toContain('tras 2 intentos');
    expect(r.error).toContain('negativos');
    expect(r.salida).toBeUndefined();
    expect(r.analisis_id).toBeUndefined();
    expect(t.peticiones).toHaveLength(2);
    expect(t.guardados).toHaveLength(0);
  });
  it('un dato inventado (cifra que no está en el snapshot) nunca llega a guardarse', async () => {
    const inventada = salidaBase();
    inventada.datos_fuente[0]!.valor = 999;
    const t = armar([inventada, inventada]);
    const r = await t.analista('fundamental', sobreBase());
    expect(r.estado).toBe('error');
    expect(r.error).toContain('no coincide con el dato del snapshot');
    expect(t.guardados).toHaveLength(0);
  });
  it('error del proveedor: sin reintento interno (lo reintenta el Orquestador), sin guardar, y el error no incluye datos extra', async () => {
    const t = armar([{ ok: false, error: 'proveedor: HTTP 429 (rate_limit_error)' }, salidaBase()]);
    const r = await t.analista('fundamental', sobreBase());
    expect(r).toEqual({ estado: 'error', error: 'proveedor: HTTP 429 (rate_limit_error)', proveedor: 'openai', modelo: 'm-analista' });
    expect(t.peticiones).toHaveLength(1);
    expect(t.guardados).toHaveLength(0);
  });
  it('falla al guardar o excepción del modelo: estado error, sin salida', async () => {
    const t = armar([salidaBase()], false);
    const r = await t.analista('fundamental', sobreBase());
    expect(r).toEqual({ estado: 'error', error: 'no se pudo guardar el análisis: falla bd', proveedor: 'openai', modelo: 'modelo-real' });
    const roto = crearPuertoAnalista({
      llamar: async () => { throw new Error('boom'); }, modelo_analista: 'a', modelo_director: 'd', ahora: () => AHORA,
      guardar_analista: async () => ({ ok: true, analisis_id: ANALISIS_ID }), guardar_director: async () => ({ ok: true, analisis_id: ANALISIS_ID }),
    });
    expect(await roto('fundamental', sobreBase())).toEqual({ estado: 'error', error: 'boom', proveedor: 'openai', modelo: 'a' });
    const rotoG = crearPuertoAnalista({
      llamar: modeloGuion([salidaBase()]).llamar, modelo_analista: 'a', modelo_director: 'd', ahora: () => AHORA,
      guardar_analista: async () => { throw new Error('bd caída'); }, guardar_director: async () => ({ ok: true, analisis_id: ANALISIS_ID }),
    });
    expect((await rotoG('fundamental', sobreBase())).error).toBe('no se pudo guardar el análisis: bd caída');
  });
  it('NO_EVALUABLE válido se acepta y se guarda como tal', async () => {
    const ne = salidaBase();
    Object.assign(ne, { veredicto: 'NO_EVALUABLE', puntaje: null, tesis_propuesta: null, datos_faltantes: [{ campo: 'flujo_caja_libre', critico: true }],
      subpuntajes: { crecimiento: null, rentabilidad: null, balance: null, flujo_caja: null, ventaja_competitiva: null } });
    const t = armar([ne]);
    const r = await t.analista('fundamental', sobreBase());
    expect(r.estado).toBe('ok');
    expect(r.veredicto).toBe('NO_EVALUABLE');
  });
});

describe('puerto del Director IA', () => {
  it('camino feliz: valida contexto y salida, guarda con trazabilidad', async () => {
    const t = armar([salidaDirectorBase()]);
    const r = await t.director(contextoBase());
    expect(r).toEqual({ estado: 'ok', analisis_id: ANALISIS_ID, veredicto: 'continuar', salida: salidaDirectorBase(), proveedor: 'openai', modelo: 'modelo-real', tokens_in: 10, tokens_out: 5 });
    expect(t.peticiones[0]!.modelo).toBe('m-director');
    expect(t.peticiones[0]!.esquema_nombre).toBe('integracion_v1');
    expect(t.peticiones[0]!.esquema).toBe(ESQUEMA_DIRECTOR);
    expect(t.peticiones[0]!.mensajes[0]).toEqual({ role: 'system', content: PROMPT_DIRECTOR });
    expect(JSON.parse(t.peticiones[0]!.mensajes[1]!.content)).toEqual(JSON.parse(JSON.stringify(contextoBase())));
    expect(t.guardadosD).toHaveLength(1);
    expect(t.guardadosA).toHaveLength(0);
    expect(t.guardados[0]!.tra).toEqual({ proveedor: 'openai', modelo: 'modelo-real', contrato: 'integracion.v1', version_prompt: 'director.p1', run_id: RUN_ID, snapshot_id: SNAP_ID, intentos: 1, generado_en: AHORA });
  });
  it('sin analistas: error y no se llama al modelo', async () => {
    const t = armar([salidaDirectorBase()]);
    const r = await t.director({ ...contextoBase(), salidas_analistas: {} });
    expect(r.estado).toBe('error');
    expect(r.error).toContain('contexto del Director inválido');
    expect(t.peticiones).toHaveLength(0);
  });
  it('D-06: si falla tras el reintento, error sin simular síntesis y sin guardar', async () => {
    const mala = { ...salidaDirectorBase(), hallazgos_negativos_ids: [] };
    const t = armar([mala, mala]);
    const r = await t.director(contextoBase());
    expect(r.estado).toBe('error');
    expect(r.error).toContain('omite un hallazgo negativo');
    expect(r.salida).toBeUndefined();
    expect(t.guardados).toHaveLength(0);
    expect(t.peticiones).toHaveLength(2);
  });
  it('reintenta con el error y acepta la corrección', async () => {
    const mala = { ...salidaDirectorBase(), resumen: 'Compra GKOS ahora.' };
    const t = armar([mala, salidaDirectorBase()]);
    const r = await t.director(contextoBase());
    expect(r.estado).toBe('ok');
    expect(t.peticiones[1]!.mensajes[3]!.content).toContain('instrucción de compra');
    expect(t.guardados[0]!.tra.intentos).toBe(2);
  });
  it('excepción del modelo o del guardado: estado error con el mensaje, sin salida', async () => {
    const opc = {
      llamar: async (): Promise<RespuestaModelo> => { throw new Error('boom'); }, modelo_analista: 'a', modelo_director: 'd', ahora: () => AHORA,
      guardar_analista: async () => ({ ok: true as const, analisis_id: ANALISIS_ID }), guardar_director: async () => ({ ok: true as const, analisis_id: ANALISIS_ID }),
    };
    expect(await crearPuertoDirector(opc)(contextoBase())).toEqual({ estado: 'error', error: 'boom', proveedor: 'openai', modelo: 'd' });
    const g = crearPuertoDirector({ ...opc, llamar: modeloGuion([salidaDirectorBase()]).llamar, guardar_director: async () => { throw new Error('bd caída'); } });
    expect((await g(contextoBase())).error).toBe('no se pudo guardar el análisis: bd caída');
  });
  it('error del proveedor y falla al guardar', async () => {
    const t = armar([{ ok: false, error: 'proveedor: tiempo de espera agotado' }]);
    expect(await t.director(contextoBase())).toEqual({ estado: 'error', error: 'proveedor: tiempo de espera agotado', proveedor: 'openai', modelo: 'm-director' });
    const g = armar([salidaDirectorBase()], false);
    expect(await g.director(contextoBase())).toEqual({ estado: 'error', error: 'no se pudo guardar el análisis: falla bd', proveedor: 'openai', modelo: 'modelo-real' });
  });
  it('no omite negativos de varios analistas ni acepta referencias inventadas', async () => {
    const ctx = contextoBase();
    (ctx.salidas_analistas as Record<string, unknown>)['tecnico'] = { ...salidaBase(), agente: 'tecnico', veredicto: 'ESPERAR', hallazgos: [{ id: 'h1', tipo: 'negativo', texto: 'Sin señal.', evidencia: [] }] };
    const incompleta = salidaDirectorBase();
    const t = armar([incompleta, incompleta]);
    const r = await t.director(ctx);
    expect(r.estado).toBe('error');
    expect(r.error).toContain('tecnico:h1');
  });
});

describe('persistencia en oficina_analisis', () => {
  const tra: TrazabilidadIa = { proveedor: 'openai', modelo: 'm', contrato: 'salida.v1', version_prompt: 'fundamental.p1', run_id: RUN_ID, snapshot_id: SNAP_ID, intentos: 1, generado_en: AHORA };
  const ids = { expediente_id: EXP_ID, ejecucion_id: null };
  it('fila del Fundamental: veredicto, puntaje, confianza, datos_fuente y salida con trazabilidad; user_id se omite', () => {
    const f = filaAnalisisIa(salidaBase(), tra, ids);
    expect(f.ok).toBe(true);
    if (!f.ok) return;
    expect(Object.keys(f.fila).sort()).toEqual(['agente', 'confianza', 'datos_fuente', 'ejecucion_id', 'expediente_id', 'invalidadores', 'puntaje', 'salida', 'supuestos', 'veredicto']);
    expect(f.fila).toMatchObject({ agente: 'fundamental', veredicto: 'ACEPTABLE', puntaje: 66, confianza: 0.6, ejecucion_id: null, expediente_id: EXP_ID, supuestos: null, invalidadores: null });
    expect(f.fila['datos_fuente']).toEqual(salidaBase().datos_fuente);
    expect(f.fila['salida']).toEqual({ ...salidaBase(), trazabilidad: tra });
  });
  it('fila del Director: veredicto y puntaje null, confianza = nivel_confianza, datos_fuente vacío', () => {
    const f = filaAnalisisIa(salidaDirectorBase(), { ...tra, contrato: 'integracion.v1' }, { ...ids, user_id: RUN_ID });
    expect(f.ok).toBe(true);
    if (!f.ok) return;
    expect(f.fila).toMatchObject({ agente: 'director_ia', veredicto: null, puntaje: null, confianza: 0.6, datos_fuente: [], user_id: RUN_ID });
  });
  it('rechaza expediente inválido (no se inventa), ids mal formados y agentes no soportados', () => {
    expect(filaAnalisisIa(salidaBase(), tra, { expediente_id: null, ejecucion_id: null })).toEqual({ ok: false, problemas: ['expediente_id inválido o ausente: oficina_analisis lo exige y no se inventa'] });
    expect(filaAnalisisIa(salidaBase(), tra, { expediente_id: EXP_ID, ejecucion_id: 'x' })).toEqual({ ok: false, problemas: ['ejecucion_id inválido'] });
    expect(filaAnalisisIa(salidaBase(), tra, { expediente_id: EXP_ID, ejecucion_id: null, user_id: 'x' })).toEqual({ ok: false, problemas: ['user_id inválido'] });
    expect(filaAnalisisIa({ ...salidaBase(), agente: 'tecnico' }, tra, ids)).toEqual({ ok: false, problemas: ['agente no soportado: tecnico'] });
  });
  it('guardarAnalisisIa inserta una fila y devuelve el id; errores de la base tal cual', async () => {
    let tabla = ''; let fila: Record<string, unknown> = {};
    const cliente = (data: unknown, error: { message: string } | null) => ({ from: (t: string) => { tabla = t; return { insert: (f: Record<string, unknown>) => { fila = f; return { select: () => ({ single: async () => ({ data, error }) }) }; } }; } });
    const ok = await guardarAnalisisIa(cliente({ id: ANALISIS_ID }, null), salidaBase(), tra, ids);
    expect(ok).toEqual({ ok: true, analisis_id: ANALISIS_ID });
    expect(tabla).toBe('oficina_analisis');
    expect(fila['agente']).toBe('fundamental');
    expect(await guardarAnalisisIa(cliente(null, { message: 'viola RLS' }), salidaBase(), tra, ids)).toEqual({ ok: false, problemas: ['oficina_analisis: viola RLS'], error_bd: 'viola RLS' });
    expect(await guardarAnalisisIa(cliente({ id: 'x' }, null), salidaBase(), tra, ids)).toEqual({ ok: false, problemas: ['oficina_analisis: la inserción no devolvió un id válido'] });
    expect(await guardarAnalisisIa(cliente({ id: ANALISIS_ID }, null), salidaBase(), tra, { expediente_id: null, ejecucion_id: null })).toMatchObject({ ok: false });
    const roto = { from: () => { throw new Error('caída'); } } as unknown as Parameters<typeof guardarAnalisisIa>[0];
    expect(await guardarAnalisisIa(roto, salidaBase(), tra, ids)).toEqual({ ok: false, problemas: ['oficina_analisis: caída'], error_bd: 'caída' });
  });
});

describe('proveedor en la trazabilidad', () => {
  it('con la opción proveedor, éxitos y errores (modelo, validación, guardado) lo llevan; la trazabilidad guardada también', async () => {
    const guardados: TrazabilidadIa[] = [];
    const guardar = (ok: boolean): GuardarAnalisisIa => async (_s, tra) => { guardados.push(tra); return ok ? { ok: true, analisis_id: ANALISIS_ID } : { ok: false, error: 'falla bd' }; };
    const base = { modelo_analista: 'a', modelo_director: 'd', ahora: () => AHORA, proveedor: 'gemini' };
    const okA = await crearPuertoAnalista({ ...base, llamar: modeloGuion([salidaBase()]).llamar, guardar_analista: guardar(true), guardar_director: guardar(true) })('fundamental', sobreBase());
    expect(okA).toMatchObject({ estado: 'ok', proveedor: 'gemini' });
    const okD = await crearPuertoDirector({ ...base, llamar: modeloGuion([salidaDirectorBase()]).llamar, guardar_analista: guardar(true), guardar_director: guardar(true) })(contextoBase());
    expect(okD).toMatchObject({ estado: 'ok', proveedor: 'gemini' });
    expect(guardados.map(t => t.proveedor)).toEqual(['gemini', 'gemini']);
    const errM = await crearPuertoAnalista({ ...base, llamar: async () => ({ ok: false, error: 'proveedor: HTTP 500' }), guardar_analista: guardar(true), guardar_director: guardar(true) })('fundamental', sobreBase());
    expect(errM).toMatchObject({ estado: 'error', proveedor: 'gemini' });
    const errG = await crearPuertoAnalista({ ...base, llamar: modeloGuion([salidaBase()]).llamar, guardar_analista: guardar(false), guardar_director: guardar(true) })('fundamental', sobreBase());
    expect(errG).toMatchObject({ estado: 'error', proveedor: 'gemini' });
    const errMD = await crearPuertoDirector({ ...base, llamar: async () => ({ ok: false, error: 'x' }), guardar_analista: guardar(true), guardar_director: guardar(true) })(contextoBase());
    expect(errMD).toMatchObject({ estado: 'error', proveedor: 'gemini' });
    const errGD = await crearPuertoDirector({ ...base, llamar: modeloGuion([salidaDirectorBase()]).llamar, guardar_analista: guardar(true), guardar_director: guardar(false) })(contextoBase());
    expect(errGD).toMatchObject({ estado: 'error', proveedor: 'gemini' });
  });
});
