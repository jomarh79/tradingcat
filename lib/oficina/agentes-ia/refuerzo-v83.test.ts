// Pruebas de la v0.83: modelo de respaldo de Gemini ante errores temporales.
import { describe, expect, it } from 'vitest';
import { conRespaldoDeModelo } from './cliente-gemini';
import type { PeticionModelo, RespuestaModelo } from './cliente-openai';

const peticion = (modelo: string): PeticionModelo => ({ modelo, mensajes: [], esquema_nombre: 'x', esquema: {} });
const ok = (modelo: string): RespuestaModelo => ({ ok: true, texto: '{}', json: {}, modelo });
function falso(resp: (modelo: string, n: number) => RespuestaModelo) {
  const modelos: string[] = [];
  return { llamar: async (p: PeticionModelo) => { modelos.push(p.modelo); return resp(p.modelo, modelos.length); }, modelos };
}

describe('v0.83: modelo de respaldo', () => {
  it('503 persistente en el principal: una llamada más con el respaldo, y responde el respaldo', async () => {
    const f = falso(m => (m === 'principal' ? { ok: false, error: 'proveedor: HTTP 503 (UNAVAILABLE)' } : ok(m)));
    const r = await conRespaldoDeModelo(f.llamar, 'respaldo')(peticion('principal'));
    expect(r).toMatchObject({ ok: true, modelo: 'respaldo' });
    expect(f.modelos).toEqual(['principal', 'respaldo']);
  });
  it('si el principal responde bien, no se usa el respaldo', async () => {
    const f = falso(m => ok(m));
    await conRespaldoDeModelo(f.llamar, 'respaldo')(peticion('principal'));
    expect(f.modelos).toEqual(['principal']);
  });
  it('errores no temporales (clave, 400) no cambian de modelo', async () => {
    const f = falso(() => ({ ok: false, error: 'proveedor: HTTP 403 (PERMISSION_DENIED)' }));
    const r = await conRespaldoDeModelo(f.llamar, 'respaldo')(peticion('principal'));
    expect(r.ok).toBe(false);
    expect(f.modelos).toEqual(['principal']);
  });
  it('sin respaldo configurado, o igual al principal, o inválido: no cambia nada', async () => {
    for (const r of [undefined, 'principal', 'AIzaSECRETO', 'mal nombre!']) {
      const f = falso(() => ({ ok: false, error: 'proveedor: HTTP 503 (UNAVAILABLE)' }));
      await conRespaldoDeModelo(f.llamar, r)(peticion('principal'));
      expect(f.modelos).toEqual(['principal']);
    }
  });
  it('si el respaldo también falla, devuelve ese error (no se reintenta más)', async () => {
    const f = falso(() => ({ ok: false, error: 'proveedor: HTTP 503 (UNAVAILABLE)' }));
    const r = await conRespaldoDeModelo(f.llamar, 'respaldo')(peticion('principal'));
    expect(r).toEqual({ ok: false, error: 'proveedor: HTTP 503 (UNAVAILABLE)' });
    expect(f.modelos).toEqual(['principal', 'respaldo']);
  });
});
