import { describe, expect, it } from 'vitest';
import { evaluarSalidaPcpTicker } from './senal-salida-pcp';
import type { FetchDatos } from '../agentes-ia';
import { DIARIAS_PRUEBA, SEMANALES_PRUEBA, respuestaChart } from '../agentes-ia/velas.test-util';

const fetchOk: FetchDatos = async url => ({ ok: true, status: 200, json: async () => (url.includes('1week') ? respuestaChart('META', '1week', SEMANALES_PRUEBA()) : respuestaChart('META', '1day', DIARIAS_PRUEBA())) });
const deps = (fetchFn: FetchDatos) => ({ fetchFn, origen: 'https://x.test', authorization: 'Bearer T', finnhub_key: 'K', esperar: async () => undefined });
const AHORA = '2026-11-04T15:00:00.000Z';
const trade = (extra: Record<string, unknown> = {}) => ({ id: 'T1', entry_price: 100, initial_quantity: 0.25, take_profit_1: null, take_profit_2: null, take_profit_3: null, tp1_hit: false, tp2_hit: false, tp3_hit: false, stop_loss: null, ...extra });

describe('señal de salida de una posición PCP abierta (v0.69)', () => {
  it('con el TP1 muy por debajo del precio y una sola compra, el plan exige VENDER el 100%', async () => {
    const r = await evaluarSalidaPcpTicker(deps(fetchOk), { ticker: 'meta', trade: trade({ take_profit_1: 0.01 }), ejecuciones: [], ficha: null }, AHORA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos.ticker).toBe('META');
    expect(r.datos.decision).toBe('VENDER');
    expect(r.datos.porcentaje).toBe(100);
    expect(['senal_salida', 'nivel_planeado']).toContain(r.datos.motivo);
    expect(r.datos.cierre).toBeGreaterThan(0);
    expect(r.datos.fecha_vela).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.datos.costo_promedio).not.toBeNull();
    expect(r.datos.avisos.join(' ')).toContain('se deduce de tus trades');
  });
  it('un trade inválido o un ticker inválido dan error, nunca una salida inventada', async () => {
    const a = await evaluarSalidaPcpTicker(deps(fetchOk), { ticker: '', trade: trade(), ejecuciones: [], ficha: null }, AHORA);
    expect(!a.ok && a.http).toBe(400);
    const b = await evaluarSalidaPcpTicker(deps(fetchOk), { ticker: 'META', trade: null, ejecuciones: [], ficha: null }, AHORA);
    expect(!b.ok && b.http).toBe(400);
    const c = await evaluarSalidaPcpTicker(deps(fetchOk), { ticker: 'META', trade: trade({ entry_price: null }), ejecuciones: [], ficha: null }, AHORA);
    expect(!c.ok && c.http).toBe(422);
  });
  it('si las velas no se pueden leer: error 502', async () => {
    const mal: FetchDatos = async () => ({ ok: false, status: 500, json: async () => ({}) });
    const r = await evaluarSalidaPcpTicker(deps(mal), { ticker: 'META', trade: trade(), ejecuciones: [], ficha: null }, AHORA);
    expect(!r.ok && r.http).toBe(502);
  });
});
