import { describe, expect, it } from 'vitest';
import { evaluarSenalPmp } from './senal-pmp';
import type { FetchDatos } from '../agentes-ia';
import { DIARIAS_PRUEBA, SEMANALES_PRUEBA, respuestaChart } from '../agentes-ia/velas.test-util';

const fetchOk: FetchDatos = async url => ({ ok: true, status: 200, json: async () => (url.includes('1week') ? respuestaChart('META', '1week', SEMANALES_PRUEBA()) : respuestaChart('META', '1day', DIARIAS_PRUEBA())) });
const deps = (fetchFn: FetchDatos) => ({ fetchFn, origen: 'https://x.test', authorization: 'Bearer T', finnhub_key: 'K', esperar: async () => undefined });
const AHORA = '2026-11-04T15:00:00.000Z';

describe('señal de entrada de PMP de un ticker (v0.59)', () => {
  it('calcula con el Técnico de la Oficina: cierre de la última vela cerrada y señales', async () => {
    const r = await evaluarSenalPmp(deps(fetchOk), 'meta', AHORA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos.ticker).toBe('META');
    expect(r.datos.senales_minimas).toBe(2);
    expect(typeof r.datos.confirmada).toBe('boolean');
    expect(r.datos.confirmada).toBe(r.datos.senales_cumplidas.length >= 2);
    expect(r.datos.cierre).toBeGreaterThan(0);
    // v0.68: la misma consulta trae la señal de apertura de PCP (2 de 4)
    expect(r.datos.pcp).not.toBeNull();
    expect(r.datos.pcp!.senales_minimas).toBe(2);
    expect(r.datos.pcp!.confirmada).toBe(r.datos.pcp!.senales_cumplidas.length >= 2);
    expect(r.datos.fecha_vela).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('ticker inválido y velas que no se pueden leer: error, nunca una señal inventada', async () => {
    const a = await evaluarSenalPmp(deps(fetchOk), '', AHORA);
    expect(!a.ok && a.http).toBe(400);
    const mal: FetchDatos = async () => ({ ok: false, status: 500, json: async () => ({}) });
    const b = await evaluarSenalPmp(deps(mal), 'META', AHORA);
    expect(!b.ok && b.http).toBe(502);
  });
});
