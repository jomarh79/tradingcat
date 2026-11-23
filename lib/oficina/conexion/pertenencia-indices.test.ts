import { beforeEach, describe, expect, it } from 'vitest';
import { avisoPcpPorIndice, bloqueoPmpPorIndice, consultarPertenencia, limpiarCachePertenencia, resolverPertenencia, simbolosDeCsvIshares, simbolosDeHtml, INDICES_MEMBRESIA, TTL_CACHE_MS } from './pertenencia-indices';
import type { FetchDatos } from '../agentes-ia/datos-reales';

const por = (id: string) => INDICES_MEMBRESIA.find(i => i.id === id)!;
/** n símbolos de relleno de 3 letras (AAA, AAB…) que no chocan con los tickers de prueba. */
const relleno = (n: number): string[] => Array.from({ length: n }, (_, i) => `Q${String.fromCharCode(65 + Math.floor(i / 26) % 26)}${String.fromCharCode(65 + i % 26)}`);
const html = (col: 'Symbol' | 'Ticker', t: string[]) =>
  `<table><tr><th>Otra</th></tr><tr><td>x</td></tr></table><table class="wikitable"><tbody><tr><th>Company</th><th>${col}</th></tr>${t.map(x => `<tr><td>Empresa</td><td><a class="external text">${x}</a></td></tr>`).join('')}</tbody></table>`;
const csv = (t: string[]) => `iShares MSCI USA Quality Factor ETF\nFund Holdings as of,"Nov 21, 2026"\n\nTicker,Name,Sector\n${t.map(x => `"${x}","Nombre","Tech"`).join('\n')}\n\n"Disclaimer text"`;
type Resp = { status?: number; cuerpo?: string };
function deps(p: { spy?: string[] | Resp; qqq?: string[] | Resp; dia?: string[] | Resp; qual?: string[] | Resp }) {
  const llamadas: string[] = [];
  const dest = (pagina: string): string[] | Resp | undefined => pagina.includes('S%26P_500') ? p.spy : pagina.includes('Nasdaq-100') ? p.qqq : pagina.includes('Dow_Jones') ? p.dia : pagina.includes('QUAL') ? p.qual : undefined;
  const fetchFn: FetchDatos = async url => {
    llamadas.push(url);
    const d = dest(url);
    const r: Resp = d === undefined ? { status: 404 } : Array.isArray(d) ? (url.includes('wikipedia') ? { cuerpo: html(url.includes('Nasdaq') ? 'Ticker' : 'Symbol', d) } : { cuerpo: csv(d) }) : d;
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => ({ parse: { text: r.cuerpo ?? '' } }), text: async () => r.cuerpo ?? '' };
  };
  return { d: { fetchFn, origen: 'https://x.test', authorization: 'Bearer t', finnhub_key: 'CLAVE' }, llamadas };
}
const SPY = (...t: string[]) => [...relleno(450), ...t];
const QQQ = (...t: string[]) => [...relleno(100), ...t];
const DIA = (...t: string[]) => [...relleno(30), ...t];
const QUAL = (...t: string[]) => [...relleno(125), ...t];
beforeEach(() => limpiarCachePertenencia());

describe('lectura de las listas (v0.75, fuentes gratuitas)', () => {
  it('Wikipedia: toma la columna Symbol/Ticker de la tabla con más símbolos y normaliza BRK.B', () => {
    const s = simbolosDeHtml(html('Symbol', ['JCI', 'BRK.B', 'brk-a']));
    expect([...s!].sort()).toEqual(['BRK.A', 'BRK.B', 'JCI']);
    expect([...simbolosDeHtml(html('Symbol', ['NYSE: MMM', 'NASDAQ: AAPL']))!].sort()).toEqual(['AAPL', 'MMM']);
    expect(simbolosDeHtml('<table><tr><th>Nada</th></tr></table>')).toBeNull();
    expect(simbolosDeHtml('')).toBeNull();
  });
  it('iShares CSV: encabezado Ticker, ignora texto previo y avisos finales', () => {
    expect([...simbolosDeCsvIshares(csv(['AAPL', 'MSFT']))!]).toEqual(['AAPL', 'MSFT']);
    expect(simbolosDeCsvIshares('nada')).toBeNull();
  });
});

describe('pertenencia a índices (v0.74/v0.75)', () => {
  it('JCI en el S&P 500: pertenece y nombra el índice; hace las 4 consultas sin clave de Finnhub', async () => {
    const { d, llamadas } = deps({ spy: SPY('JCI'), qqq: QQQ('AAPL'), dia: DIA('AAPL'), qual: QUAL('AAPL') });
    const r = await consultarPertenencia(d, 'jci');
    expect(r).toMatchObject({ estado: 'pertenece', indices: ['SPY'], no_incluido_en: ['QQQ', 'DIA', 'QUAL'], fallidos: [] });
    expect(r.texto).toContain('S&P 500 (SPY)');
    expect(llamadas).toHaveLength(4);
    expect(llamadas.some(u => u.includes('finnhub'))).toBe(false);
  });
  it('pertenece a varios (S&P 500, Dow y QUAL) y BRK.B coincide con BRK-B', async () => {
    const { d } = deps({ spy: SPY('BRK-B'), qqq: QQQ(), dia: DIA('BRK.B'), qual: QUAL('brk.b') });
    expect((await consultarPertenencia(d, 'BRK.B')).indices).toEqual(['SPY', 'DIA', 'QUAL']);
  });
  it('en ningún índice con las 4 consultas bien: no_pertenece', async () => {
    const { d } = deps({ spy: SPY(), qqq: QQQ(), dia: DIA(), qual: QUAL() });
    const r = await consultarPertenencia(d, 'XYZ');
    expect(r.estado).toBe('no_pertenece');
    expect(r.texto).toContain('No pertenece a ningún índice');
  });
  it('una fuente falla (HTTP 403) y no está en las demás: sin_datos, nunca no_pertenece', async () => {
    const { d } = deps({ spy: SPY(), qqq: QQQ(), dia: DIA(), qual: { status: 403 } });
    const r = await consultarPertenencia(d, 'XYZ');
    expect(r.estado).toBe('sin_datos');
    expect(r.fallidos).toEqual([{ indice: 'QUAL', motivo: 'HTTP 403' }]);
    expect(r.no_incluido_en).toEqual(['SPY', 'QQQ', 'DIA']);
  });
  it('si pertenece a uno, otra fuente caída no cambia el resultado (pertenece)', async () => {
    const { d } = deps({ spy: SPY('JCI'), qqq: { status: 500 }, dia: DIA(), qual: QUAL() });
    const r = await consultarPertenencia(d, 'JCI');
    expect(r.estado).toBe('pertenece');
    expect(r.texto).toContain('Sin consultar: QQQ (HTTP 500)');
  });
  it('una lista incompleta o con otra forma no demuestra nada: cuenta como fallo', async () => {
    const { d } = deps({ spy: ['JCI'], qqq: { cuerpo: '<p>sin tabla</p>' }, dia: DIA(), qual: QUAL() });
    const r = await consultarPertenencia(d, 'JCI');
    expect(r.estado).toBe('sin_datos');
    expect(r.fallidos.map(f => f.indice).sort()).toEqual(['QQQ', 'SPY']);
    expect(r.fallidos.find(f => f.indice === 'SPY')!.motivo).toContain('lista incompleta');
  });
  it('caché de 24 h: la segunda consulta no vuelve a la red; pasado el plazo sí', async () => {
    const { d, llamadas } = deps({ spy: SPY('JCI'), qqq: QQQ(), dia: DIA(), qual: QUAL() });
    await consultarPertenencia(d, 'JCI', 1000);
    await consultarPertenencia(d, 'AAPL', 2000);
    expect(llamadas).toHaveLength(4);
    await consultarPertenencia(d, 'JCI', 1000 + TTL_CACHE_MS + 1);
    expect(llamadas).toHaveLength(8);
  });
  it('un fallo no se guarda en caché', async () => {
    const { d, llamadas } = deps({ spy: { status: 503 }, qqq: QQQ(), dia: DIA(), qual: QUAL() });
    await consultarPertenencia(d, 'JCI', 1);
    await consultarPertenencia(d, 'JCI', 2);
    expect(llamadas.filter(u => u.includes('S%26P_500'))).toHaveLength(2);
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
