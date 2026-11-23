import { describe, expect, it } from 'vitest';
import { avisoPcpPorIndice, bloqueoPmpPorIndice, consultarPertenencia, resolverPertenencia, simbolosDeRespuesta, INDICES_MEMBRESIA } from './pertenencia-indices';
import type { FetchDatos } from '../agentes-ia/datos-reales';

const por = (id: string) => INDICES_MEMBRESIA.find(i => i.id === id)!;
type Resp = { status?: number; json?: unknown };
function deps(porSimbolo: Record<string, Resp>) {
  const llamadas: string[] = [];
  const fetchFn: FetchDatos = async url => {
    llamadas.push(url);
    const k = Object.keys(porSimbolo).find(s => decodeURIComponent(url).includes(`symbol=${s}`));
    const r: Resp = k === undefined ? { status: 404 } : porSimbolo[k]!;
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => r.json ?? {} };
  };
  return { d: { fetchFn, origen: 'https://x.test', authorization: 'Bearer t', finnhub_key: 'CLAVE' }, llamadas };
}
const idx = (...t: string[]) => ({ status: 200, json: { constituents: t } });
const etf = (...t: string[]) => ({ status: 200, json: { holdings: t.map(symbol => ({ symbol, percent: 1 })) } });
const todo = (spy: string[], qqq: string[], dia: string[], qual: string[]) => ({ '^GSPC': idx(...spy), '^NDX': idx(...qqq), '^DJI': idx(...dia), QUAL: etf(...qual) });

describe('pertenencia a índices (v0.74)', () => {
  it('JCI está en el S&P 500: pertenece y nombra el índice; usa la clave de Finnhub y las 4 consultas', async () => {
    const { d, llamadas } = deps(todo(['JCI', 'AAPL'], ['AAPL'], ['AAPL'], ['AAPL']));
    const r = await consultarPertenencia(d, 'jci');
    expect(r).toMatchObject({ estado: 'pertenece', indices: ['SPY'], no_incluido_en: ['QQQ', 'DIA', 'QUAL'], fallidos: [] });
    expect(r.texto).toContain('S&P 500 (SPY)');
    expect(llamadas).toHaveLength(4);
    expect(llamadas.every(u => u.startsWith('https://finnhub.io/api/v1/'))).toBe(true);
  });
  it('pertenece a varios (S&P 500, Dow y QUAL) y BRK.B coincide con BRK-B', async () => {
    const { d } = deps(todo(['BRK-B'], ['AAPL'], ['BRK.B'], ['brk.b']));
    expect((await consultarPertenencia(d, 'BRK.B')).indices).toEqual(['SPY', 'DIA', 'QUAL']);
  });
  it('en ningún índice con las 4 consultas bien: no_pertenece', async () => {
    const { d } = deps(todo(['AAPL'], ['AAPL'], ['AAPL'], ['AAPL']));
    const r = await consultarPertenencia(d, 'XYZ');
    expect(r.estado).toBe('no_pertenece');
    expect(r.texto).toContain('No pertenece a ningún índice');
  });
  it('una consulta falla (plan sin acceso, HTTP 403) y no está en las demás: sin_datos, nunca no_pertenece', async () => {
    const { d } = deps({ ...todo(['AAPL'], ['AAPL'], ['AAPL'], ['AAPL']), QUAL: { status: 403 } });
    const r = await consultarPertenencia(d, 'XYZ');
    expect(r.estado).toBe('sin_datos');
    expect(r.fallidos).toEqual([{ indice: 'QUAL', motivo: 'HTTP 403' }]);
    expect(r.no_incluido_en).toEqual(['SPY', 'QQQ', 'DIA']);
  });
  it('si pertenece a uno, una consulta fallida de otro no cambia el resultado (pertenece)', async () => {
    const { d } = deps({ ...todo(['JCI'], ['AAPL'], ['AAPL'], ['AAPL']), '^NDX': { status: 500 } });
    const r = await consultarPertenencia(d, 'JCI');
    expect(r.estado).toBe('pertenece');
    expect(r.texto).toContain('Sin consultar: QQQ');
  });
  it('una lista vacía o con otra forma no demuestra nada: cuenta como fallo', () => {
    expect(simbolosDeRespuesta('indice', { constituents: [] })).toBeNull();
    expect(simbolosDeRespuesta('indice', {})).toBeNull();
    expect(simbolosDeRespuesta('etf', { holdings: [{ nombre: 'x' }] })).toBeNull();
    expect(simbolosDeRespuesta('indice', 'x')).toBeNull();
    const r = resolverPertenencia(INDICES_MEMBRESIA.map(i => ({ indice: i, pertenece: null, motivo: 'respuesta vacía' })));
    expect(r.estado).toBe('sin_datos');
  });
  it('PMP: pertenecer no bloquea; no pertenecer o sin datos no inicia la corrida (sugiere PCP)', () => {
    const ok = resolverPertenencia([{ indice: por('SPY'), pertenece: true }]);
    expect(bloqueoPmpPorIndice(ok)).toBeNull();
    const no = resolverPertenencia(INDICES_MEMBRESIA.map(i => ({ indice: i, pertenece: false })));
    expect(bloqueoPmpPorIndice(no)).toContain('se sugiere pasarla a PCP');
    const sin = resolverPertenencia([{ indice: por('SPY'), pertenece: null, motivo: 'HTTP 403' }, { indice: por('QQQ'), pertenece: false }]);
    expect(bloqueoPmpPorIndice(sin)).toContain('no se puede comprobar');
  });
  it('PCP: solo hay alerta si no pertenece (o no se pudo comprobar); si pertenece, ninguna', () => {
    expect(avisoPcpPorIndice(resolverPertenencia([{ indice: por('QQQ'), pertenece: true }]))).toBeNull();
    expect(avisoPcpPorIndice(resolverPertenencia(INDICES_MEMBRESIA.map(i => ({ indice: i, pertenece: false }))))).toContain('Es solo una alerta');
    expect(avisoPcpPorIndice(resolverPertenencia([{ indice: por('SPY'), pertenece: null, motivo: 'tiempo agotado' }]))).toContain('PCP:');
  });
});
