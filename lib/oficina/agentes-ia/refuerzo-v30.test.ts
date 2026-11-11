import { describe, expect, it, vi } from 'vitest';
import { resolverProveedorIa } from './proveedor-ia';
import { conReintentoTransitorio, esErrorTemporalProveedor } from './cliente-gemini';
import type { LlamadaModelo, PeticionModelo, RespuestaModelo } from './cliente-openai';

const pet = {} as PeticionModelo;
const exito: RespuestaModelo = { ok: true, texto: '{}', json: {}, modelo: 'm' };
function secuencia(...rs: RespuestaModelo[]) {
  let n = 0; const esperas: number[] = [];
  const llamar: LlamadaModelo = async () => rs[Math.min(n++, rs.length - 1)]!;
  return { llamar, llamadas: () => n, esperas, dormir: async (ms: number) => { esperas.push(ms); } };
}

describe('v0.30 reintento con espera ante fallos temporales del proveedor', () => {
  it('qué errores son temporales', () => {
    for (const e of ['proveedor: HTTP 503 (UNAVAILABLE)', 'proveedor: HTTP 429 (RESOURCE_EXHAUSTED)', 'proveedor: HTTP 500', 'proveedor: HTTP 502', 'proveedor: HTTP 504', 'proveedor: error de red']) expect(esErrorTemporalProveedor(e)).toBe(true);
    for (const e of ['proveedor: HTTP 401 (revisar clave y permisos)', 'proveedor: HTTP 400 (INVALID_ARGUMENT)', 'proveedor: HTTP 5030', 'proveedor: solicitud bloqueada (SAFETY)', 'proveedor: respuesta truncada (límite de longitud)', 'proveedor: respuesta vacía', 'proveedor: tiempo de espera agotado', 'otro: HTTP 503']) expect(esErrorTemporalProveedor(e)).toBe(false);
  });
  it('un 503 y luego éxito: reintenta una vez tras 2 s y devuelve el éxito', async () => {
    const s = secuencia({ ok: false, error: 'proveedor: HTTP 503 (UNAVAILABLE)' }, exito);
    const r = await conReintentoTransitorio(s.llamar, [2000, 5000], s.dormir)(pet);
    expect(r).toEqual(exito); expect(s.llamadas()).toBe(2); expect(s.esperas).toEqual([2000]);
  });
  it('dos 503 y luego éxito: usa las dos esperas (2 s y 5 s)', async () => {
    const s = secuencia({ ok: false, error: 'proveedor: HTTP 503' }, { ok: false, error: 'proveedor: HTTP 503' }, exito);
    expect((await conReintentoTransitorio(s.llamar, [2000, 5000], s.dormir)(pet)).ok).toBe(true);
    expect(s.llamadas()).toBe(3); expect(s.esperas).toEqual([2000, 5000]);
  });
  it('siempre 503: se rinde tras 3 llamadas y devuelve el último error', async () => {
    const e: RespuestaModelo = { ok: false, error: 'proveedor: HTTP 503 (UNAVAILABLE)' };
    const s = secuencia(e);
    expect(await conReintentoTransitorio(s.llamar, [2000, 5000], s.dormir)(pet)).toEqual(e);
    expect(s.llamadas()).toBe(3);
  });
  it('un error NO temporal (clave, 400, bloqueo) no se reintenta ni espera', async () => {
    const s = secuencia({ ok: false, error: 'proveedor: HTTP 401 (revisar clave y permisos)' }, exito);
    expect((await conReintentoTransitorio(s.llamar, [2000, 5000], s.dormir)(pet)).ok).toBe(false);
    expect(s.llamadas()).toBe(1); expect(s.esperas).toEqual([]);
  });
  it('un éxito a la primera no espera', async () => {
    const s = secuencia(exito);
    await conReintentoTransitorio(s.llamar, [2000, 5000], s.dormir)(pet);
    expect(s.llamadas()).toBe(1); expect(s.esperas).toEqual([]);
  });
  it('sin esperas configuradas no reintenta', async () => {
    const s = secuencia({ ok: false, error: 'proveedor: HTTP 503' }, exito);
    await conReintentoTransitorio(s.llamar, [], s.dormir)(pet);
    expect(s.llamadas()).toBe(1);
  });
});

describe('v0.30 el proveedor Gemini del selector reintenta de verdad', () => {
  const env = { PROVEEDOR_IA: 'gemini', GEMINI_API_KEY: 'CLAVE-SECRETA', GEMINI_MODEL_ANALISTA: 'a', GEMINI_MODEL_DIRECTOR: 'd' };
  const peticion = { modelo: 'gemini-x', mensajes: [{ role: 'user', content: 'hola' }], esquema_nombre: 'e', esquema: { type: 'object' } } as unknown as PeticionModelo;
  const buena = { candidates: [{ content: { parts: [{ text: '{"a":1}' }] }, finishReason: 'STOP' }], usageMetadata: {}, modelVersion: 'gx' };
  it('503, 503 y luego éxito: devuelve el éxito tras esperar 2 s y 5 s (reloj falso)', async () => {
    vi.useFakeTimers();
    try {
      let n = 0;
      const fetchFn = async () => (++n < 3 ? { ok: false, status: 503, json: async () => ({ error: { status: 'UNAVAILABLE' } }) } : { ok: true, status: 200, json: async () => buena });
      const p = resolverProveedorIa(env, fetchFn as never);
      expect(p.ok).toBe(true);
      if (!p.ok) return;
      const prom = p.llamar(peticion);
      await vi.advanceTimersByTimeAsync(2000);
      expect(n).toBe(2);
      await vi.advanceTimersByTimeAsync(5000);
      expect((await prom).ok).toBe(true);
      expect(n).toBe(3);
    } finally { vi.useRealTimers(); }
  });
});
