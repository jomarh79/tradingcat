import { describe, expect, it, vi } from 'vitest';
import { crearLlamadaGemini, leerConfigGemini, resolverProveedorIa } from './index';
import type { PeticionModelo } from './index';

const CLAVE = 'AIzaSy-SECRETO-123456';
const pet: PeticionModelo = {
  modelo: 'gemini-x-flash', esquema_nombre: 'esq', esquema: { type: 'object', additionalProperties: false },
  mensajes: [{ role: 'system', content: 'sis' }, { role: 'user', content: 'u1' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'u2' }],
};
type Init = { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal };
const resp = (status: number, cuerpo: unknown) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => cuerpo });
const ok = (texto: string, extra: Record<string, unknown> = {}) => ({
  candidates: [{ content: { parts: [{ text: texto }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7 }, modelVersion: 'gemini-x-flash-001', ...extra,
});

describe('configuración Gemini', () => {
  it('lee las tres variables; si faltan, devuelve solo sus nombres', () => {
    expect(leerConfigGemini({ GEMINI_API_KEY: ` ${CLAVE} `, GEMINI_MODEL_ANALISTA: ' a ', GEMINI_MODEL_DIRECTOR: ' d ' })).toEqual({ ok: true, api_key: CLAVE, modelo_analista: 'a', modelo_director: 'd' });
    const f = leerConfigGemini({ GEMINI_API_KEY: CLAVE, GEMINI_MODEL_ANALISTA: ' ' });
    expect(f).toEqual({ ok: false, faltan: ['GEMINI_MODEL_ANALISTA', 'GEMINI_MODEL_DIRECTOR'] });
    expect(JSON.stringify(f)).not.toContain(CLAVE);
    expect(leerConfigGemini({})).toEqual({ ok: false, faltan: ['GEMINI_API_KEY', 'GEMINI_MODEL_ANALISTA', 'GEMINI_MODEL_DIRECTOR'] });
  });
});

describe('cliente Gemini', () => {
  it('arma la petición: URL con el modelo, clave solo en cabecera, sistema aparte, roles user/model y esquema JSON', async () => {
    let visto: { url: string; init: Init } | null = null;
    const llamar = crearLlamadaGemini({ api_key: CLAVE, fetchFn: async (url, init) => { visto = { url, init }; return resp(200, ok('{"a":1}'))(); } });
    const r = await llamar(pet);
    expect(r).toEqual({ ok: true, texto: '{"a":1}', json: { a: 1 }, modelo: 'gemini-x-flash-001', tokens_in: 11, tokens_out: 7 });
    expect(visto!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-x-flash:generateContent');
    expect(visto!.url).not.toContain(CLAVE);
    expect(visto!.init.method).toBe('POST');
    expect(visto!.init.headers['x-goog-api-key']).toBe(CLAVE);
    expect(visto!.init.headers['Content-Type']).toBe('application/json');
    expect(visto!.init.headers['Authorization']).toBeUndefined();
    const body = JSON.parse(visto!.init.body) as Record<string, unknown>;
    expect(body['systemInstruction']).toEqual({ parts: [{ text: 'sis' }] });
    expect(body['contents']).toEqual([{ role: 'user', parts: [{ text: 'u1' }] }, { role: 'model', parts: [{ text: 'a1' }] }, { role: 'user', parts: [{ text: 'u2' }] }]);
    expect(body['generationConfig']).toEqual({ responseMimeType: 'application/json', responseJsonSchema: { type: 'object', additionalProperties: false } });
    expect(visto!.init.body).not.toContain(CLAVE);
    expect(visto!.init.signal).toBeDefined();
  });
  it('sin mensaje de sistema no manda systemInstruction; sin mensajes de usuario no llama al proveedor', async () => {
    let cuerpo = '';
    let llamadas = 0;
    const f = async (_u: string, init: Init) => { llamadas++; cuerpo = init.body; return resp(200, ok('{}'))(); };
    await crearLlamadaGemini({ api_key: CLAVE, fetchFn: f })({ ...pet, mensajes: [{ role: 'user', content: 'x' }] });
    expect(JSON.parse(cuerpo)).not.toHaveProperty('systemInstruction');
    const r = await crearLlamadaGemini({ api_key: CLAVE, fetchFn: f })({ ...pet, mensajes: [{ role: 'system', content: 's' }] });
    expect(r).toEqual({ ok: false, error: 'la petición no trae mensajes de usuario' });
    expect(llamadas).toBe(1);
  });
  it('varios mensajes de sistema se unen; usa la URL base indicada', async () => {
    let url = ''; let cuerpo = '';
    await crearLlamadaGemini({ api_key: CLAVE, url_base: 'http://local/v1', fetchFn: async (u, init) => { url = u; cuerpo = init.body; return resp(200, ok('{}'))(); } })({ ...pet, mensajes: [{ role: 'system', content: 'A' }, { role: 'system', content: 'B' }, { role: 'user', content: 'x' }] });
    expect(url).toBe('http://local/v1/models/gemini-x-flash:generateContent');
    expect(JSON.parse(cuerpo)['systemInstruction']).toEqual({ parts: [{ text: 'A\n\nB' }] });
  });
  it('un nombre de modelo que no sea un identificador no llega a la URL', async () => {
    let llamado = false;
    for (const m of ['a/b', 'a?x=1', 'a:b', '', ' m', 'm m', '../x']) {
      const r = await crearLlamadaGemini({ api_key: CLAVE, fetchFn: async () => { llamado = true; return resp(200, ok('{}'))(); } })({ ...pet, modelo: m });
      expect(r).toEqual({ ok: false, error: 'nombre de modelo inválido' });
    }
    expect(llamado).toBe(false);
  });
  it('nunca filtra la clave: 401/403 genéricos; 4xx/5xx se reducen a estado y códigos en mayúsculas', async () => {
    for (const st of [401, 403]) {
      const r = await crearLlamadaGemini({ api_key: CLAVE, fetchFn: resp(st, { error: { message: `bad ${CLAVE}`, status: 'UNAUTHENTICATED' } }) })(pet);
      expect(r).toEqual({ ok: false, error: `proveedor: HTTP ${st} (revisar clave y permisos)` });
    }
    const k = await crearLlamadaGemini({ api_key: CLAVE, fetchFn: resp(400, { error: { message: `API key not valid ${CLAVE}`, status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }, { reason: `minusculas ${CLAVE}` }, 'x'] } }) })(pet);
    expect(k).toEqual({ ok: false, error: 'proveedor: HTTP 400 (INVALID_ARGUMENT/API_KEY_INVALID)' });
    expect(JSON.stringify(k)).not.toContain(CLAVE);
    expect(await crearLlamadaGemini({ api_key: CLAVE, fetchFn: resp(429, { error: { status: 'RESOURCE_EXHAUSTED' } }) })(pet)).toEqual({ ok: false, error: 'proveedor: HTTP 429 (RESOURCE_EXHAUSTED)' });
    expect(await crearLlamadaGemini({ api_key: CLAVE, fetchFn: resp(500, {}) })(pet)).toEqual({ ok: false, error: 'proveedor: HTTP 500' });
    const largo = await crearLlamadaGemini({ api_key: CLAVE, fetchFn: resp(400, { error: { status: 'A'.repeat(200), details: [{ reason: `X ${CLAVE}` }] } }) })(pet);
    expect(largo).toEqual({ ok: false, error: 'proveedor: HTTP 400' });
    const rj = await crearLlamadaGemini({ api_key: CLAVE, fetchFn: async () => ({ ok: false, status: 502, json: async () => { throw new Error(`boom ${CLAVE}`); } }) })(pet);
    expect(rj).toEqual({ ok: false, error: 'proveedor: respuesta HTTP 502 sin JSON válido' });
  });
  it('errores de red no filtran el mensaje; el tiempo agotado se distingue', async () => {
    expect(await crearLlamadaGemini({ api_key: CLAVE, fetchFn: async () => { throw new Error(`fallo ${CLAVE}`); } })(pet)).toEqual({ ok: false, error: 'proveedor: error de red' });
    const lento = await crearLlamadaGemini({
      api_key: CLAVE, timeout_ms: 5,
      fetchFn: (_u, init) => new Promise((_res, rej) => { init.signal!.addEventListener('abort', () => { const e = new Error('abortado'); e.name = 'AbortError'; rej(e); }); }),
    })(pet);
    expect(lento).toEqual({ ok: false, error: 'proveedor: tiempo de espera agotado' });
  });
  it('bloqueo, truncado, fin anormal, sin candidatos, vacío y JSON inválido son errores', async () => {
    const c = (cuerpo: unknown) => crearLlamadaGemini({ api_key: CLAVE, fetchFn: resp(200, cuerpo) })(pet);
    expect(await c({ promptFeedback: { blockReason: 'SAFETY' } })).toEqual({ ok: false, error: 'proveedor: solicitud bloqueada (SAFETY)' });
    expect(await c({ promptFeedback: { blockReason: `x ${CLAVE}` }, ...ok('{}') })).toMatchObject({ ok: true });
    expect(await c({ candidates: [{ content: { parts: [{ text: '{"a"' }] }, finishReason: 'MAX_TOKENS' }] })).toEqual({ ok: false, error: 'proveedor: respuesta truncada (límite de longitud)' });
    expect(await c({ candidates: [{ content: { parts: [{ text: '{}' }] }, finishReason: 'SAFETY' }] })).toEqual({ ok: false, error: 'proveedor: respuesta no completada (SAFETY)' });
    expect(await c({ candidates: [{ content: { parts: [{ text: '{}' }] }, finishReason: 'raro' }] })).toEqual({ ok: false, error: 'proveedor: respuesta no completada' });
    expect(await c({ candidates: [] })).toEqual({ ok: false, error: 'proveedor: respuesta sin candidatos' });
    expect(await c({})).toEqual({ ok: false, error: 'proveedor: respuesta sin candidatos' });
    expect(await c({ candidates: [{ content: { parts: [{ text: '' }] }, finishReason: 'STOP' }] })).toEqual({ ok: false, error: 'proveedor: respuesta vacía' });
    expect(await c({ candidates: [{ finishReason: 'STOP' }] })).toEqual({ ok: false, error: 'proveedor: respuesta vacía' });
    expect(await c(ok('no es json'))).toEqual({ ok: false, error: 'proveedor: la respuesta no es JSON' });
  });
  it('une las partes de texto, ignora las de razonamiento y acepta la falta de finishReason', async () => {
    const r = await crearLlamadaGemini({ api_key: CLAVE, fetchFn: resp(200, { candidates: [{ content: { parts: [{ text: 'pensando', thought: true }, { text: '{"a":' }, { text: '2}' }, { inlineData: 'x' }] } }] }) })(pet);
    expect(r).toEqual({ ok: true, texto: '{"a":2}', json: { a: 2 }, modelo: 'gemini-x-flash' });
  });
  it('las partes cuyo text no es una cadena se ignoran', async () => {
    const r = await crearLlamadaGemini({ api_key: CLAVE, fetchFn: resp(200, { candidates: [{ content: { parts: [{ text: 5 }, { text: null }, { text: '{"a":1}' }] }, finishReason: 'STOP' }] }) })(pet);
    expect(r).toMatchObject({ ok: true, texto: '{"a":1}', json: { a: 1 } });
  });
  it('tokens: suma razonamiento a la salida; ignora valores no numéricos o negativos', async () => {
    const c = (uso: unknown) => crearLlamadaGemini({ api_key: CLAVE, fetchFn: resp(200, ok('{}', { usageMetadata: uso })) })(pet);
    expect(await c({ promptTokenCount: 5, candidatesTokenCount: 7, thoughtsTokenCount: 3 })).toMatchObject({ tokens_in: 5, tokens_out: 10 });
    expect(await c({ promptTokenCount: 5, thoughtsTokenCount: 3 })).toMatchObject({ tokens_in: 5, tokens_out: 3 });
    const sin = await c({ promptTokenCount: '5', candidatesTokenCount: -1, thoughtsTokenCount: NaN });
    const inf = await c({ promptTokenCount: Infinity, candidatesTokenCount: Infinity });
    expect(inf).not.toHaveProperty('tokens_in');
    expect(inf).not.toHaveProperty('tokens_out');
    expect(sin).not.toHaveProperty('tokens_in');
    expect(sin).not.toHaveProperty('tokens_out');
    expect(await c({ promptTokenCount: 0, candidatesTokenCount: 0 })).toMatchObject({ tokens_in: 0, tokens_out: 0 });
  });
  it('no usa como modelo un nombre que parezca una clave o no sea identificador', async () => {
    for (const m of ['AIzaSyABC', 'con espacio', 5]) {
      const r = await crearLlamadaGemini({ api_key: CLAVE, fetchFn: resp(200, ok('{}', { modelVersion: m })) })(pet);
      expect(r).toMatchObject({ ok: true, modelo: 'gemini-x-flash' });
    }
  });
  it('libera el temporizador al terminar (éxito o error)', async () => {
    vi.useFakeTimers();
    try {
      await crearLlamadaGemini({ api_key: CLAVE, fetchFn: resp(200, ok('{}')) })(pet);
      expect(vi.getTimerCount()).toBe(0);
      await crearLlamadaGemini({ api_key: CLAVE, fetchFn: async () => { throw new Error('x'); } })(pet);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('sin clave no llama al proveedor', async () => {
    let llamado = false;
    const r = await crearLlamadaGemini({ api_key: '  ', fetchFn: async () => { llamado = true; return resp(200, ok('{}'))(); } })(pet);
    expect(r).toEqual({ ok: false, error: 'falta la clave del proveedor' });
    expect(llamado).toBe(false);
  });
});

describe('selector de proveedor', () => {
  const gem = { PROVEEDOR_IA: 'gemini', GEMINI_API_KEY: CLAVE, GEMINI_MODEL_ANALISTA: 'ga', GEMINI_MODEL_DIRECTOR: 'gd' };
  const oai = { PROVEEDOR_IA: ' OpenAI ', OPENAI_API_KEY: 'sk-x', OPENAI_MODEL_ANALISTA: 'oa', OPENAI_MODEL_DIRECTOR: 'od' };
  it('sin PROVEEDOR_IA o con un valor desconocido falla nombrando solo la variable', () => {
    for (const env of [{}, { PROVEEDOR_IA: '' }, { ...gem, PROVEEDOR_IA: 'otro' }]) {
      const r = resolverProveedorIa(env);
      expect(r).toEqual({ ok: false, faltan: ['PROVEEDOR_IA (valores válidos: openai o gemini)'] });
    }
  });
  it('gemini: usa las variables de Gemini y su URL; faltantes solo por nombre', async () => {
    let url = '';
    const r = resolverProveedorIa(gem, async u => { url = u; return resp(200, ok('{}'))(); });
    expect(r).toMatchObject({ ok: true, proveedor: 'gemini', modelo_analista: 'ga', modelo_director: 'gd' });
    if (!r.ok) return;
    await r.llamar(pet);
    expect(url).toContain('generativelanguage.googleapis.com');
    const f = resolverProveedorIa({ PROVEEDOR_IA: 'gemini', GEMINI_API_KEY: CLAVE });
    expect(f).toEqual({ ok: false, faltan: ['GEMINI_MODEL_ANALISTA', 'GEMINI_MODEL_DIRECTOR'] });
    expect(resolverProveedorIa({ PROVEEDOR_IA: 'gemini', OPENAI_API_KEY: 'sk-x', OPENAI_MODEL_ANALISTA: 'a', OPENAI_MODEL_DIRECTOR: 'd' }).ok).toBe(false);
  });
  it('openai: ignora mayúsculas y espacios, usa las variables de OpenAI y su URL', async () => {
    let url = '';
    const r = resolverProveedorIa(oai, async u => { url = u; return resp(200, { choices: [{ message: { content: '{}' } }] })(); });
    expect(r).toMatchObject({ ok: true, proveedor: 'openai', modelo_analista: 'oa', modelo_director: 'od' });
    if (!r.ok) return;
    await r.llamar(pet);
    expect(url).toContain('api.openai.com');
    expect(resolverProveedorIa({ PROVEEDOR_IA: 'openai' })).toEqual({ ok: false, faltan: ['OPENAI_API_KEY', 'OPENAI_MODEL_ANALISTA', 'OPENAI_MODEL_DIRECTOR'] });
  });
});
