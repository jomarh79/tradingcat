import { describe, expect, it } from 'vitest';
import { obtenerVelas, obtenerVelasDiariasDe } from './datos-velas';
import type { FetchDatos } from './index';
import { DIARIAS_PRUEBA, respuestaChart } from './velas.test-util';
import { reunirDatosFicha } from './datos-ficha';

const base = { origen: 'https://app.test', authorization: 'Bearer T', finnhub_key: 'K' };

describe('v0.57 límite de consultas (429)', () => {
  it('un 429 se reintenta una vez, esperando antes, y si la segunda sale bien devuelve las velas', async () => {
    let n = 0; const esperas: number[] = [];
    const fetchFn: FetchDatos = async () => { n += 1; return n === 1 ? { ok: false, status: 429, json: async () => ({}) } : { ok: true, status: 200, json: async () => respuestaChart('DIA', '1day', DIARIAS_PRUEBA()) }; };
    const r = await obtenerVelasDiariasDe({ ...base, fetchFn, esperar: async ms => { esperas.push(ms); } }, 'DIA');
    expect(r.ok).toBe(true);
    expect(n).toBe(2);
    expect(esperas).toEqual([12000]);
  });
  it('si el segundo intento también da 429, falla con el motivo y no insiste más', async () => {
    let n = 0;
    const fetchFn: FetchDatos = async () => { n += 1; return { ok: false, status: 429, json: async () => ({}) }; };
    const r = await obtenerVelasDiariasDe({ ...base, fetchFn, esperar: async () => undefined }, 'DIA');
    expect(r).toEqual({ ok: false, error: 'HTTP 429' });
    expect(n).toBe(2);
  });
  it('otros errores (500) no se reintentan ni esperan', async () => {
    let n = 0; let esperó = false;
    const fetchFn: FetchDatos = async () => { n += 1; return { ok: false, status: 500, json: async () => ({}) }; };
    const r = await obtenerVelasDiariasDe({ ...base, fetchFn, esperar: async () => { esperó = true; } }, 'DIA');
    expect(r.ok).toBe(false);
    expect(n).toBe(1);
    expect(esperó).toBe(false);
  });
  it('las velas del ticker (diaria y semanal) también se reintentan', async () => {
    const vistos: Record<string, number> = {};
    const fetchFn: FetchDatos = async url => {
      const k = url.includes('1week') ? 'sem' : 'dia'; vistos[k] = (vistos[k] ?? 0) + 1;
      if (k === 'sem' && vistos[k] === 1) return { ok: false, status: 429, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => respuestaChart('GKOS', k === 'sem' ? '1week' : '1day', DIARIAS_PRUEBA()) };
    };
    const r = await obtenerVelas({ ...base, fetchFn, esperar: async () => undefined }, 'GKOS');
    expect(r.ok && r.avisos).toEqual([]);
    expect(vistos['sem']).toBe(2);
  });
  it('los 4 índices de la ficha se piden de uno en uno', async () => {
    let enCurso = 0; let maximo = 0;
    const fetchFn: FetchDatos = async url => {
      if (url.includes('/api/dividends')) return { ok: true, status: 200, json: async () => ({ dividends: [] }) };
      enCurso += 1; maximo = Math.max(maximo, enCurso);
      await new Promise(ok => setTimeout(ok, 2));
      enCurso -= 1;
      return { ok: true, status: 200, json: async () => respuestaChart('SPY', '1day', DIARIAS_PRUEBA()) };
    };
    const d = await reunirDatosFicha({ ...base, fetchFn, esperar: async () => undefined }, 'GKOS', {});
    expect(maximo).toBe(1);
    expect(Object.keys(d.indices ?? {}).sort()).toEqual(['DIA', 'QQQ', 'QUAL', 'SPY']);
  });
});
