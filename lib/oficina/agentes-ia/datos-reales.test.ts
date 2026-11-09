// Pruebas de la v0.9: datos reales (Webull por la ruta interna y Finnhub), con fetch falso. Nunca se llama a la red.
import { describe, expect, it } from 'vitest';
import {
  ENV_BASE_URL_OFICINA, ENV_FINNHUB_API_KEY, FINNHUB_CABECERA_CLAVE, FINNHUB_URL_BASE, MAX_AVISOS_OBTENCION, MAX_LARGO_AVISO, TIMEOUT_DATOS_MS,
  ejecutarAnalisisReal, ejecutarPruebaFundamental, leerConfigDatos, obtenerDatosFundamental,
} from './index';
import type { FetchDatos, LlamadaModelo, PeticionModelo } from './index';
import { RUN_ID, SNAP_ID } from './fixtures.test-util';
import { modeloFalso } from './modelo-falso.test-util';

const CLAVE = 'CLAVE-SECRETA-FINNHUB-123';
const TOKEN = 'Bearer TOKEN-SECRETO-DEL-DUENO-456';
const ORIGEN = 'https://app.ejemplo.test';
const GEN = '2026-10-30T18:00:00.000Z';

const entrada = (fy: number, ingresos: number) => ({
  fiscalYear: fy, fiscalPeriod: 0, endDate: `${fy}-12-31`, currency: 'USD', revenue: ingresos, costOfRevenue: null, grossProfit: ingresos * 0.8, opex: null, sgaExp: null, rndExp: null,
  opIncome: ingresos * 0.2, otherNetIncome: null, ebt: null, incomeTax: null, netIncome: ingresos * 0.1, dilutedAvgShares: 1000, dilutedEps: ingresos * 0.1 / 1000, interestNet: null,
});
const webull = { success: true, symbol: 'GKOS', annual: [entrada(2023, 1200), entrada(2024, 1500)], ttm: null, forwardEps: null };
const reportado = { data: [{ year: 2025, quarter: 0, form: '10-K', endDate: '2025-12-31', filedDate: '2026-02-23', report: { bs: [{ concept: 'us-gaap_Assets', unit: 'u_usd', value: 893487000 }], cf: [] } }] };
const trimestral = { data: [{ year: 2026, quarter: 3, form: '10-Q', endDate: '2026-09-30', filedDate: '2026-10-28', report: { bs: [], cf: [{ concept: 'us-gaap_NetCashProvidedByUsedInOperatingActivities', unit: 'u_usd', value: 40867000 }] } }] };
const metric = { metric: { currentRatioAnnual: 4.69 } };

interface Llamada { url: string; init: Parameters<FetchDatos>[1] }
type Respuesta = { status?: number; json?: unknown; lanza?: Error };
/** fetch falso: responde según un fragmento de la URL. */
function falso(resp: Record<string, Respuesta>) {
  const llamadas: Llamada[] = [];
  const fetchFn: FetchDatos = async (url, init) => {
    llamadas.push({ url, init });
    const clave = Object.keys(resp).find(k => url.includes(k));
    if (clave === undefined) throw new Error('URL no prevista en la prueba');
    const r = resp[clave]!;
    if (r.lanza) throw r.lanza;
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => r.json };
  };
  return { fetchFn, llamadas };
}
const todoBien = (): Record<string, Respuesta> => ({
  '/api/webull/income-statement': { json: webull },
  'freq=annual': { json: reportado }, 'freq=quarterly': { json: trimestral }, '/stock/metric': { json: metric },
});
const deps = (f: FetchDatos) => ({ fetchFn: f, origen: ORIGEN, authorization: TOKEN, finnhub_key: CLAVE });

describe('v0.9: configuración de datos', () => {
  it('exige la clave de Finnhub y dice solo el NOMBRE de la variable', () => {
    expect(ENV_FINNHUB_API_KEY).toBe('FINNHUB_API_KEY');
    expect(ENV_BASE_URL_OFICINA).toBe('OFICINA_BASE_URL');
    expect(leerConfigDatos({})).toEqual({ ok: false, faltan: ['FINNHUB_API_KEY'] });
    expect(leerConfigDatos({ FINNHUB_API_KEY: '   ' })).toEqual({ ok: false, faltan: ['FINNHUB_API_KEY'] });
    expect(JSON.stringify(leerConfigDatos({ FINNHUB_API_KEY: '' }))).not.toContain(CLAVE);
  });
  it('recorta espacios de la clave, y de la URL base quita la barra final; sin URL base es null', () => {
    expect(leerConfigDatos({ FINNHUB_API_KEY: ` ${CLAVE} ` })).toEqual({ ok: true, finnhub_key: CLAVE, base_url: null });
    expect(leerConfigDatos({ FINNHUB_API_KEY: CLAVE, OFICINA_BASE_URL: ' https://a.test/// ' })).toEqual({ ok: true, finnhub_key: CLAVE, base_url: 'https://a.test' });
    expect(leerConfigDatos({ FINNHUB_API_KEY: CLAVE, OFICINA_BASE_URL: '  ' })).toMatchObject({ base_url: null });
  });
});

describe('v0.9: obtener datos', () => {
  it('camino feliz: devuelve las cuatro fuentes sin avisos', async () => {
    const f = falso(todoBien());
    const r = await obtenerDatosFundamental(deps(f.fetchFn), 'GKOS');
    if (!r.ok) throw new Error('debía ser ok');
    expect(r.datos.income_statement).toEqual(webull);
    expect(r.datos.finnhub_reportado).toEqual(reportado);
    expect(r.datos.finnhub_reportado_trimestral).toEqual(trimestral);
    expect(r.datos.finnhub_metric).toEqual(metric);
    expect(r.datos.avisos_obtencion).toEqual([]);
    expect(r.datos.fuentes).toEqual({ webull_income_statement: 'ok', finnhub_reportado: 'ok', finnhub_reportado_trimestral: 'ok', finnhub_metric: 'ok' });
    expect(f.llamadas).toHaveLength(4);
  });
  it('Webull: ruta interna con el símbolo, el token reenviado, sin seguir redirecciones y con tiempo máximo', async () => {
    const f = falso(todoBien());
    await obtenerDatosFundamental(deps(f.fetchFn), 'BRK.B');
    const w = f.llamadas.find(l => l.url.includes('/api/webull/'))!;
    expect(w.url).toBe(`${ORIGEN}/api/webull/income-statement?symbol=BRK.B`);
    expect(w.init.headers['Authorization']).toBe(TOKEN);
    expect(w.init.redirect).toBe('manual');
    expect(w.init.signal).toBeInstanceOf(AbortSignal);
    expect(TIMEOUT_DATOS_MS).toBe(25_000);
  });
  it('Finnhub: URLs correctas, clave solo en la cabecera, nunca en la URL, y el token del dueño no se envía a Finnhub', async () => {
    const f = falso(todoBien());
    await obtenerDatosFundamental(deps(f.fetchFn), 'GKOS');
    const fin = f.llamadas.filter(l => l.url.startsWith(FINNHUB_URL_BASE));
    expect(fin.map(l => l.url).sort()).toEqual([
      `${FINNHUB_URL_BASE}/stock/financials-reported?symbol=GKOS&freq=annual`,
      `${FINNHUB_URL_BASE}/stock/financials-reported?symbol=GKOS&freq=quarterly`,
      `${FINNHUB_URL_BASE}/stock/metric?symbol=GKOS&metric=all`,
    ].sort());
    for (const l of fin) {
      expect(l.init.headers[FINNHUB_CABECERA_CLAVE]).toBe(CLAVE);
      expect(l.url).not.toContain(CLAVE);
      expect(l.init.headers['Authorization']).toBeUndefined();
      expect(l.init.redirect).toBe('manual');
    }
    expect(FINNHUB_CABECERA_CLAVE).toBe('X-Finnhub-Token');
    expect(FINNHUB_URL_BASE).toBe('https://finnhub.io/api/v1');
    const w = f.llamadas.find(l => !l.url.startsWith(FINNHUB_URL_BASE))!;
    expect(w.init.headers[FINNHUB_CABECERA_CLAVE]).toBeUndefined();
  });
  it('el símbolo se codifica en la URL', async () => {
    const f = falso(todoBien());
    await obtenerDatosFundamental(deps(f.fetchFn), 'A B&C');
    expect(f.llamadas.every(l => l.url.includes('symbol=A%20B%26C'))).toBe(true);
  });
  it('si Webull falla no hay análisis: error con solo el estado HTTP, sin token ni clave', async () => {
    for (const status of [401, 500, 502]) {
      const f = falso({ ...todoBien(), '/api/webull/income-statement': { status, json: { error: `detalle ${TOKEN} ${CLAVE}` } } });
      const r = await obtenerDatosFundamental(deps(f.fetchFn), 'GKOS');
      expect(r).toEqual({ ok: false, http: 502, error: `Webull (ruta interna): HTTP ${String(status)}` });
      expect(f.llamadas).toHaveLength(1);
    }
  });
  it('una redirección de Webull no se sigue y orienta a configurar OFICINA_BASE_URL', async () => {
    const f = falso({ ...todoBien(), '/api/webull/income-statement': { status: 308 } });
    const r = await obtenerDatosFundamental(deps(f.fetchFn), 'GKOS');
    expect(r).toMatchObject({ ok: false, http: 502 });
    expect(JSON.stringify(r)).toContain('redirección HTTP 308 no seguida');
    expect(JSON.stringify(r)).toContain('OFICINA_BASE_URL');
  });
  it('Webull con success distinto de true, o respuesta que no es objeto, es error', async () => {
    for (const json of [{ success: false, error: 'x' }, { symbol: 'GKOS' }, null, 'texto', [1]]) {
      const f = falso({ ...todoBien(), '/api/webull/income-statement': { json } });
      expect(await obtenerDatosFundamental(deps(f.fetchFn), 'GKOS')).toEqual({ ok: false, http: 502, error: 'Webull (ruta interna): respuesta sin success=true' });
    }
  });
  it('el tiempo máximo de cada llamada es TIMEOUT_DATOS_MS y se usa la señal entregada', async () => {
    const pedidos: number[] = []; const senales: AbortSignal[] = [];
    const senalTiempo = (ms: number): AbortSignal => { pedidos.push(ms); const s = new AbortController().signal; senales.push(s); return s; };
    const f = falso(todoBien());
    await obtenerDatosFundamental({ ...deps(f.fetchFn), senalTiempo }, 'GKOS');
    expect(pedidos).toEqual([25_000, 25_000, 25_000, 25_000]);
    expect(f.llamadas.map(l => l.init.signal)).toEqual(senales);
  });
  it('los bordes de redirección: 299 es éxito, 300 y 399 redirección, 400 error HTTP normal', async () => {
    const con = async (status: number) => obtenerDatosFundamental(deps(falso({ ...todoBien(), '/api/webull/income-statement': { status, json: webull } }).fetchFn), 'GKOS');
    expect((await con(299)).ok).toBe(true);
    expect(JSON.stringify(await con(300))).toContain('redirección HTTP 300 no seguida');
    expect(JSON.stringify(await con(399))).toContain('redirección HTTP 399 no seguida');
    const e400 = await con(400);
    expect(e400).toEqual({ ok: false, http: 502, error: 'Webull (ruta interna): HTTP 400' });
  });
  it('un fallo de red o de tiempo en Webull da error sin el mensaje original', async () => {
    const t = new Error(`mensaje con ${TOKEN}`); t.name = 'TimeoutError';
    const a = await obtenerDatosFundamental(deps(falso({ ...todoBien(), '/api/webull/income-statement': { lanza: t } }).fetchFn), 'GKOS');
    expect(a).toEqual({ ok: false, http: 502, error: 'Webull (ruta interna): tiempo agotado' });
    const b = await obtenerDatosFundamental(deps(falso({ ...todoBien(), '/api/webull/income-statement': { lanza: new Error(`x ${CLAVE}`) } }).fetchFn), 'GKOS');
    expect(b).toEqual({ ok: false, http: 502, error: 'Webull (ruta interna): error de red o respuesta ilegible' });
  });
  it('un fallo de Finnhub omite solo esa parte, avisa con el motivo y marca la fuente como omitida', async () => {
    const f = falso({ ...todoBien(), 'freq=quarterly': { status: 429 }, '/stock/metric': { status: 403, json: { error: CLAVE } } });
    const r = await obtenerDatosFundamental(deps(f.fetchFn), 'GKOS');
    if (!r.ok) throw new Error('debía ser ok');
    expect(r.datos.finnhub_reportado).toEqual(reportado);
    expect('finnhub_reportado_trimestral' in r.datos).toBe(false);
    expect('finnhub_metric' in r.datos).toBe(false);
    expect(r.datos.fuentes).toEqual({ webull_income_statement: 'ok', finnhub_reportado: 'ok', finnhub_reportado_trimestral: 'omitida', finnhub_metric: 'omitida' });
    expect(r.datos.avisos_obtencion).toEqual([
      'Finnhub financials-reported trimestral: no se pudo obtener (HTTP 429); se omite y no se rellena',
      'Finnhub stock/metric: no se pudo obtener (HTTP 403); se omite y no se rellena',
    ]);
    expect(JSON.stringify(r)).not.toContain(CLAVE);
  });
  it('si fallan las tres de Finnhub sigue habiendo análisis con Webull y tres avisos; un fallo de red de Finnhub no filtra el mensaje', async () => {
    const e = new Error(`url con ${CLAVE}`); e.name = 'TimeoutError';
    const abortado = new Error('x'); abortado.name = 'AbortError';
    const ab = await obtenerDatosFundamental(deps(falso({ ...todoBien(), '/api/webull/income-statement': { lanza: abortado } }).fetchFn), 'GKOS');
    expect(ab).toEqual({ ok: false, http: 502, error: 'Webull (ruta interna): tiempo agotado' });
    const f = falso({ '/api/webull/income-statement': { json: webull }, 'freq=annual': { lanza: e }, 'freq=quarterly': { lanza: new Error(CLAVE) }, '/stock/metric': { status: 500 } });
    const r = await obtenerDatosFundamental(deps(f.fetchFn), 'GKOS');
    if (!r.ok) throw new Error('debía ser ok');
    expect(r.datos.avisos_obtencion).toEqual([
      'Finnhub financials-reported anual: no se pudo obtener (tiempo agotado); se omite y no se rellena',
      'Finnhub financials-reported trimestral: no se pudo obtener (error de red o respuesta ilegible); se omite y no se rellena',
      'Finnhub stock/metric: no se pudo obtener (HTTP 500); se omite y no se rellena',
    ]);
    expect(JSON.stringify(r)).not.toContain(CLAVE);
  });
  it('una redirección de Finnhub se trata como fallo de esa parte', async () => {
    const f = falso({ ...todoBien(), '/stock/metric': { status: 301 } });
    const r = await obtenerDatosFundamental(deps(f.fetchFn), 'GKOS');
    if (!r.ok) throw new Error('debía ser ok');
    expect(r.datos.avisos_obtencion).toEqual(['Finnhub stock/metric: no se pudo obtener (redirección HTTP 301 no seguida); se omite y no se rellena']);
  });
});

/** Modelo que devuelve salida vacía: sirve para comprobar lo que RECIBE el modelo sin necesitar una respuesta válida. */
function modeloVacio() {
  const peticiones: PeticionModelo[] = [];
  const llamar: LlamadaModelo = async p => { peticiones.push(p); return { ok: true, texto: '{}', json: {}, modelo: 'm' }; };
  let n = 0;
  return { peticiones, base: { llamar, modelo_analista: 'a', modelo_director: 'd', nuevoId: () => (n++ === 0 ? RUN_ID : SNAP_ID), ahora: () => GEN } };
}
const snapshotDe = (p: PeticionModelo) => (JSON.parse(p.mensajes[1]!.content) as { snapshot: { datos: { items: { id: string }[]; avisos?: string[] } } }).snapshot.datos;

describe('v0.9: análisis con datos reales', () => {
  it('trae los datos y el modelo recibe items de Webull y de Finnhub; la respuesta incluye las fuentes', async () => {
    const m = modeloVacio(); const f = falso(todoBien());
    const r = await ejecutarAnalisisReal(m.base, deps(f.fetchFn), { ticker: ' gkos ', con_director: false });
    expect(r.http).toBe(200);
    expect(r.cuerpo['ticker']).toBe('GKOS');
    expect(r.cuerpo['guardado']).toBe(false);
    expect(r.cuerpo['fuentes']).toEqual({ webull_income_statement: 'ok', finnhub_reportado: 'ok', finnhub_reportado_trimestral: 'ok', finnhub_metric: 'ok' });
    expect(r.cuerpo['items_finnhub']).toBeGreaterThan(0);
    const ids = snapshotDe(m.peticiones[0]!).items.map(i => i.id);
    expect(ids).toContain('margen_bruto_fy2024');
    expect(ids).toContain('activos_totales_fy2025');
    expect(ids).toContain('razon_corriente_anual_proveedor_a_fecha_de_consulta');
    expect(f.llamadas.some(l => l.url.includes('symbol=GKOS'))).toBe(true);
  });
  it('los avisos de obtención llegan al modelo y a la respuesta', async () => {
    const m = modeloVacio(); const f = falso({ ...todoBien(), '/stock/metric': { status: 500 } });
    const r = await ejecutarAnalisisReal(m.base, deps(f.fetchFn), { ticker: 'GKOS', con_director: false });
    const aviso = 'Finnhub stock/metric: no se pudo obtener (HTTP 500); se omite y no se rellena';
    expect(r.cuerpo['avisos_datos']).toContain(aviso);
    expect(snapshotDe(m.peticiones[0]!).avisos).toContain(aviso);
    expect(r.cuerpo['fuentes']).toMatchObject({ finnhub_metric: 'omitida' });
  });
  it('si Webull falla devuelve su error y no llama al modelo', async () => {
    const m = modeloVacio(); const f = falso({ ...todoBien(), '/api/webull/income-statement': { status: 401 } });
    const r = await ejecutarAnalisisReal(m.base, deps(f.fetchFn), { ticker: 'GKOS' });
    expect(r).toEqual({ http: 502, cuerpo: { ok: false, error: 'Webull (ruta interna): HTTP 401' } });
    expect(m.peticiones).toHaveLength(0);
  });
  it('valida el cuerpo antes de llamar a nadie', async () => {
    for (const [body, error] of [
      [null, 'el cuerpo debe ser un objeto JSON'], ['x', 'el cuerpo debe ser un objeto JSON'], [{ ticker: '../x' }, 'ticker inválido'], [{}, 'ticker inválido'], [{ ticker: 5 }, 'ticker inválido'],
      [{ ticker: 'GKOS', income_statement: {} }, 'campos no permitidos: income_statement'], [{ ticker: 'GKOS', items_extra: [] }, 'campos no permitidos: items_extra'],
      [{ ticker: 'GKOS', finnhub_metric: {} }, 'campos no permitidos: finnhub_metric'], [{ ticker: 'GKOS', avisos_obtencion: [] }, 'campos no permitidos: avisos_obtencion'],
    ] as const) {
      const m = modeloVacio(); const f = falso(todoBien());
      expect(await ejecutarAnalisisReal(m.base, deps(f.fetchFn), body)).toEqual({ http: 400, cuerpo: { ok: false, error } });
      expect(f.llamadas).toHaveLength(0);
      expect(m.peticiones).toHaveLength(0);
    }
  });
  it('con_director y portafolio se validan igual que en la prueba', async () => {
    const m = modeloVacio();
    const f1 = falso(todoBien()); const f2 = falso(todoBien());
    expect((await ejecutarAnalisisReal(m.base, deps(f1.fetchFn), { ticker: 'GKOS', con_director: 'si' }))).toEqual({ http: 400, cuerpo: { ok: false, error: 'con_director debe ser booleano' } });
    expect((await ejecutarAnalisisReal(m.base, deps(f2.fetchFn), { ticker: 'GKOS', portafolio: 'XXX' }))).toEqual({ http: 400, cuerpo: { ok: false, error: 'portafolio debe ser PMP|PCP|PLP|ETF|SEMILLA' } });
    expect((await ejecutarAnalisisReal(m.base, deps(f2.fetchFn), { ticker: 'GKOS', portafolio: 5 })).http).toBe(400);
    expect(f1.llamadas).toHaveLength(0);
    expect(f2.llamadas).toHaveLength(0);
    expect(m.peticiones).toHaveLength(0);
  });
  it('con_director false no corre el Director y con true (o sin indicarlo) sí, con el portafolio indicado o PMP por omisión', async () => {
    const sin = modeloFalso();
    const r0 = await ejecutarAnalisisReal({ llamar: sin.llamar, modelo_analista: 'a', modelo_director: 'd', nuevoId: (() => { let n = 0; return () => (n++ === 0 ? RUN_ID : SNAP_ID); })(), ahora: () => GEN }, deps(falso(todoBien()).fetchFn), { ticker: 'GKOS', con_director: false });
    expect('director' in r0.cuerpo).toBe(false);
    expect(sin.peticiones).toHaveLength(1);

    const pcp = modeloFalso();
    const r1 = await ejecutarAnalisisReal({ llamar: pcp.llamar, modelo_analista: 'a', modelo_director: 'd', nuevoId: (() => { let n = 0; return () => (n++ === 0 ? RUN_ID : SNAP_ID); })(), ahora: () => GEN }, deps(falso(todoBien()).fetchFn), { ticker: 'GKOS', portafolio: 'PCP' });
    expect(r1.cuerpo['director']).toMatchObject({ estado: 'ok' });
    expect(pcp.peticiones).toHaveLength(2);
    expect(JSON.parse(pcp.peticiones[1]!.mensajes[1]!.content)).toMatchObject({ portafolio_codigo: 'PCP' });

    const pmp = modeloFalso();
    await ejecutarAnalisisReal({ llamar: pmp.llamar, modelo_analista: 'a', modelo_director: 'd', nuevoId: (() => { let n = 0; return () => (n++ === 0 ? RUN_ID : SNAP_ID); })(), ahora: () => GEN }, deps(falso(todoBien()).fetchFn), { ticker: 'GKOS', con_director: true });
    expect(JSON.parse(pmp.peticiones[1]!.mensajes[1]!.content)).toMatchObject({ portafolio_codigo: 'PMP' });
  });
  it('privacidad: el Director recibe solo el análisis, el ticker y el código de portafolio: ni posiciones ni datos del portafolio', async () => {
    const m = modeloFalso();
    let n = 0;
    await ejecutarAnalisisReal({ llamar: m.llamar, modelo_analista: 'a', modelo_director: 'd', nuevoId: () => (n++ === 0 ? RUN_ID : SNAP_ID), ahora: () => GEN }, deps(falso(todoBien()).fetchFn), { ticker: 'GKOS' });
    const ctx = JSON.parse(m.peticiones[1]!.mensajes[1]!.content) as Record<string, unknown>;
    expect(Object.keys(ctx).sort()).toEqual(['analistas_requeridos_sin_resultado', 'auditoria', 'contexto', 'mercado', 'portafolio_codigo', 'reglas_versiones_ids', 'run_id', 'salidas_analistas', 'snapshot_id', 'ticker', 'tipo_evaluacion']);
    expect(ctx['auditoria']).toBeNull();
    expect(ctx['contexto']).toBeNull();
    expect(ctx['reglas_versiones_ids']).toEqual([]);
    expect(Object.keys(ctx['salidas_analistas'] as object)).toEqual(['fundamental']);
  });
  it('privacidad: el modelo recibe solo datos públicos y no se filtran la clave ni el token', async () => {
    const m = modeloVacio(); const f = falso(todoBien());
    const r = await ejecutarAnalisisReal(m.base, deps(f.fetchFn), { ticker: 'GKOS', con_director: false });
    const enviado = JSON.stringify(m.peticiones);
    for (const secreto of [CLAVE, TOKEN, 'TOKEN-SECRETO']) { expect(enviado).not.toContain(secreto); expect(JSON.stringify(r)).not.toContain(secreto); }
    const sobre = JSON.parse(m.peticiones[0]!.mensajes[1]!.content) as Record<string, unknown>;
    expect(Object.keys(sobre).sort()).toEqual(['agente', 'contrato', 'mercado', 'run_id', 'snapshot', 'tesis_vigente', 'ticker']);
  });
});

describe('v0.9: avisos_obtencion en la prueba', () => {
  const income = webull;
  const base = (a: unknown) => ({ ticker: 'GKOS', income_statement: income, con_director: false, avisos_obtencion: a });
  it('acepta una lista válida y la suma a los avisos', async () => {
    const m = modeloVacio();
    const r = await ejecutarPruebaFundamental(m.base, base(['uno', 'dos']));
    expect(r.http).toBe(200);
    expect((r.cuerpo['avisos_datos'] as string[]).slice(-2)).toEqual(['uno', 'dos']);
    expect(snapshotDe(m.peticiones[0]!).avisos).toEqual(expect.arrayContaining(['uno', 'dos']));
  });
  it('rechaza lo que no sea una lista de textos no vacíos dentro de los límites', async () => {
    const largo = 'x'.repeat(MAX_LARGO_AVISO + 1);
    const demasiados = Array.from({ length: MAX_AVISOS_OBTENCION + 1 }, (_, i) => `a${String(i)}`);
    for (const a of ['texto', [''], ['  '], [5], [null], [largo], demasiados, {}]) {
      const m = modeloVacio();
      const r = await ejecutarPruebaFundamental(m.base, base(a));
      expect(r.http).toBe(400);
      expect(String(r.cuerpo['error'])).toContain(`avisos_obtencion debe ser una lista de máximo ${String(MAX_AVISOS_OBTENCION)} textos no vacíos de máximo ${String(MAX_LARGO_AVISO)} caracteres`);
      expect(m.peticiones).toHaveLength(0);
    }
  });
  it('acepta justo los límites', async () => {
    const m = modeloVacio();
    const justo = Array.from({ length: MAX_AVISOS_OBTENCION }, () => 'x'.repeat(MAX_LARGO_AVISO));
    expect((await ejecutarPruebaFundamental(m.base, base(justo))).http).toBe(200);
    expect(MAX_AVISOS_OBTENCION).toBe(20);
    expect(MAX_LARGO_AVISO).toBe(300);
  });
});
