import { describe, expect, it, vi } from 'vitest';
import { crearLlamadaOpenAi, leerConfigOpenAi } from './index';
import type { PeticionModelo } from './index';

const CLAVE = 'sk-test-SECRETO-123456';
const pet: PeticionModelo = { modelo: 'modelo-x', mensajes: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }], esquema_nombre: 'esq', esquema: { type: 'object' } };
type Init = { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal };
const resp = (status: number, cuerpo: unknown) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => cuerpo });
const ok = (contenido: string, extra: Record<string, unknown> = {}) => ({ choices: [{ message: { content: contenido }, finish_reason: 'stop' }], usage: { prompt_tokens: 11, completion_tokens: 7 }, model: 'modelo-x-2026', ...extra });

describe('configuración', () => {
  it('lee las tres variables; si faltan, devuelve solo sus nombres', () => {
    const r = leerConfigOpenAi({ OPENAI_API_KEY: ` ${CLAVE} `, OPENAI_MODEL_ANALISTA: ' a ', OPENAI_MODEL_DIRECTOR: ' d ' });
    expect(r).toEqual({ ok: true, api_key: CLAVE, modelo_analista: 'a', modelo_director: 'd' });
    const f = leerConfigOpenAi({ OPENAI_API_KEY: CLAVE, OPENAI_MODEL_ANALISTA: '  ' });
    expect(f).toEqual({ ok: false, faltan: ['OPENAI_MODEL_ANALISTA', 'OPENAI_MODEL_DIRECTOR'] });
    expect(JSON.stringify(f)).not.toContain(CLAVE);
    expect(leerConfigOpenAi({})).toEqual({ ok: false, faltan: ['OPENAI_API_KEY', 'OPENAI_MODEL_ANALISTA', 'OPENAI_MODEL_DIRECTOR'] });
  });
});

describe('cliente OpenAI', () => {
  it('envía la petición con salida JSON estricta y devuelve json, modelo y tokens', async () => {
    let visto: { url: string; init: Init } | null = null;
    const llamar = crearLlamadaOpenAi({ api_key: CLAVE, fetchFn: async (url, init) => { visto = { url, init }; return resp(200, ok('{"a":1}'))(); } });
    const r = await llamar(pet);
    expect(r).toEqual({ ok: true, texto: '{"a":1}', json: { a: 1 }, modelo: 'modelo-x-2026', tokens_in: 11, tokens_out: 7 });
    expect(visto!.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(visto!.init.method).toBe('POST');
    expect(visto!.init.headers['Authorization']).toBe(`Bearer ${CLAVE}`);
    expect(visto!.init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(visto!.init.body) as Record<string, unknown>;
    expect(body['model']).toBe('modelo-x');
    expect(body['messages']).toEqual(pet.mensajes);
    expect(body['response_format']).toEqual({ type: 'json_schema', json_schema: { name: 'esq', strict: true, schema: { type: 'object' } } });
    expect(visto!.init.body).not.toContain(CLAVE);
    expect(visto!.init.signal).toBeDefined();
  });
  it('usa la URL base indicada y el modelo pedido si la respuesta no trae uno', async () => {
    let url = '';
    const llamar = crearLlamadaOpenAi({ api_key: CLAVE, url_base: 'http://local/v1', fetchFn: async u => { url = u; return resp(200, { choices: [{ message: { content: '{}' } }] })(); } });
    const r = await llamar(pet);
    expect(url).toBe('http://local/v1/chat/completions');
    expect(r).toEqual({ ok: true, texto: '{}', json: {}, modelo: 'modelo-x' });
  });
  it('nunca filtra la clave: errores 401/403 y 4xx/5xx se reducen a estado y código', async () => {
    for (const st of [401, 403]) {
      const r = await crearLlamadaOpenAi({ api_key: CLAVE, fetchFn: resp(st, { error: { message: `Incorrect API key provided: ${CLAVE}`, type: 'invalid_request_error' } }) })(pet);
      expect(r).toEqual({ ok: false, error: `proveedor: HTTP ${st} (revisar clave y permisos)` });
    }
    const r429 = await crearLlamadaOpenAi({ api_key: CLAVE, fetchFn: resp(429, { error: { message: `límite para ${CLAVE}`, type: 'rate_limit_error', code: 'rate_limit_exceeded' } }) })(pet);
    expect(r429).toEqual({ ok: false, error: 'proveedor: HTTP 429 (rate_limit_error/rate_limit_exceeded)' });
    const r500 = await crearLlamadaOpenAi({ api_key: CLAVE, fetchFn: resp(500, {}) })(pet);
    expect(r500).toEqual({ ok: false, error: 'proveedor: HTTP 500' });
    const rx = await crearLlamadaOpenAi({ api_key: CLAVE, fetchFn: resp(400, { error: { type: `x ${CLAVE}`, code: 'a'.repeat(500) } }) })(pet);
    expect(JSON.stringify(rx)).not.toContain(CLAVE);
    expect(rx).toEqual({ ok: false, error: 'proveedor: HTTP 400' });
    const rj = await crearLlamadaOpenAi({ api_key: CLAVE, fetchFn: async () => ({ ok: false, status: 502, json: async () => { throw new Error(`boom ${CLAVE}`); } }) })(pet);
    expect(rj).toEqual({ ok: false, error: 'proveedor: respuesta HTTP 502 sin JSON válido' });
  });
  it('errores de red no filtran el mensaje original; el tiempo agotado se distingue', async () => {
    const red = await crearLlamadaOpenAi({ api_key: CLAVE, fetchFn: async () => { throw new Error(`fallo con ${CLAVE}`); } })(pet);
    expect(red).toEqual({ ok: false, error: 'proveedor: error de red' });
    const lento = await crearLlamadaOpenAi({
      api_key: CLAVE, timeout_ms: 5,
      fetchFn: (_u, init) => new Promise((_res, rej) => { init.signal!.addEventListener('abort', () => { const e = new Error('abortado'); e.name = 'AbortError'; rej(e); }); }),
    })(pet);
    expect(lento).toEqual({ ok: false, error: 'proveedor: tiempo de espera agotado' });
  });
  it('rechazo del modelo, truncado, vacío, sin mensaje y JSON inválido son errores', async () => {
    const c = (cuerpo: unknown) => crearLlamadaOpenAi({ api_key: CLAVE, fetchFn: resp(200, cuerpo) })(pet);
    expect(await c({ choices: [{ message: { content: null, refusal: 'no puedo' } }] })).toEqual({ ok: false, error: 'proveedor: el modelo rechazó la solicitud' });
    expect(await c({ choices: [{ message: { content: '{"a"' }, finish_reason: 'length' }] })).toEqual({ ok: false, error: 'proveedor: respuesta truncada (límite de longitud)' });
    expect(await c({ choices: [{ message: { content: '' } }] })).toEqual({ ok: false, error: 'proveedor: respuesta vacía' });
    expect(await c({ choices: [] })).toEqual({ ok: false, error: 'proveedor: respuesta sin mensaje' });
    expect(await c({})).toEqual({ ok: false, error: 'proveedor: respuesta sin mensaje' });
    expect(await c(ok('no es json'))).toEqual({ ok: false, error: 'proveedor: la respuesta no es JSON' });
  });
  it('no usa como modelo un nombre que parezca una clave', async () => {
    const r = await crearLlamadaOpenAi({ api_key: CLAVE, fetchFn: resp(200, ok('{}', { model: 'sk-proj-abc123' })) })(pet);
    expect(r).toMatchObject({ ok: true, modelo: 'modelo-x' });
    const r2 = await crearLlamadaOpenAi({ api_key: CLAVE, fetchFn: resp(200, ok('{}', { model: 'con espacio' })) })(pet);
    expect(r2).toMatchObject({ ok: true, modelo: 'modelo-x' });
  });
  it('libera el temporizador de tiempo de espera al terminar (éxito o error)', async () => {
    vi.useFakeTimers();
    try {
      await crearLlamadaOpenAi({ api_key: CLAVE, fetchFn: resp(200, ok('{}')) })(pet);
      expect(vi.getTimerCount()).toBe(0);
      await crearLlamadaOpenAi({ api_key: CLAVE, fetchFn: async () => { throw new Error('x'); } })(pet);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('sin clave no llama al proveedor', async () => {
    let llamado = false;
    const r = await crearLlamadaOpenAi({ api_key: '  ', fetchFn: async () => { llamado = true; return resp(200, ok('{}'))(); } })(pet);
    expect(r).toEqual({ ok: false, error: 'falta la clave del proveedor' });
    expect(llamado).toBe(false);
  });
});
