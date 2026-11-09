// Pruebas de la v0.13: guardado del análisis (expediente, análisis, corrida) y clasificación de la tesis. Base y modelo falsos: nunca se llama a la red.
import { describe, expect, it } from 'vitest';
import {
  CLAVES_ANALISIS_REAL, DIRECTOR_VE_DATOS_PRIVADOS, TESIS_CAMBIO, TESIS_PRIMERA_PROPUESTA, TESIS_SIN_PROPUESTA,
  clasificarTesisPropuesta, ejecutarAnalisisGuardado, ejecutarAnalisisReal, hayTesisVigente, sanearContextoDirector, validarCuerpoAnalisis,
} from './index';
import type { ContextoDirector } from '../orquestador/corrida';
import type { FetchDatos } from './index';
import { modeloFalso } from './modelo-falso.test-util';
import { PF, nuevaBdGuardado } from './bd-guardado.test-util';
import { DIARIAS_PRUEBA, SEMANALES_PRUEBA, respuestaChart } from './velas.test-util';
import type { ErroresBd, Fila } from './bd-guardado.test-util';

const TOKEN = 'Bearer TOKEN-SECRETO-DEL-DUENO-456';
const CLAVE = 'CLAVE-SECRETA-FINNHUB-123';
const AHORA = '2026-11-04T15:00:00.000Z';
const EXP = '00000000-0000-4000-8000-0000000000aa';

const entrada = (fy: number, ingresos: number) => ({
  fiscalYear: fy, fiscalPeriod: 0, endDate: `${fy}-12-31`, currency: 'USD', revenue: ingresos, costOfRevenue: null, grossProfit: ingresos * 0.8, opex: null, sgaExp: null, rndExp: null,
  opIncome: ingresos * 0.2, otherNetIncome: null, ebt: null, incomeTax: null, netIncome: ingresos * 0.1, dilutedAvgShares: 1000, dilutedEps: 0.1, interestNet: null,
});
const RESP: Record<string, unknown> = {
  '/api/webull/income-statement': { success: true, symbol: 'GKOS', annual: [entrada(2023, 1200), entrada(2024, 1500)], ttm: null, forwardEps: null },
  'freq=annual': { data: [{ year: 2025, quarter: 0, form: '10-K', endDate: '2025-12-31', filedDate: '2026-02-23', report: { bs: [{ concept: 'us-gaap_Assets', unit: 'u_usd', value: 893487000 }], cf: [] } }] },
  'freq=quarterly': { data: [{ year: 2026, quarter: 3, form: '10-Q', endDate: '2026-09-30', filedDate: '2026-10-28', report: { bs: [], cf: [{ concept: 'us-gaap_NetCashProvidedByUsedInOperatingActivities', unit: 'u_usd', value: 40867000 }] } }] },
  '/stock/metric': { metric: { currentRatioAnnual: 4.69 } },
  'interval=1day': respuestaChart('GKOS', '1day', DIARIAS_PRUEBA()),
  'interval=1week': respuestaChart('GKOS', '1week', SEMANALES_PRUEBA()),
};
function fetchFalso(fallaWebull = false) {
  const llamadas: string[] = [];
  const fetchFn: FetchDatos = async url => {
    llamadas.push(url);
    if (fallaWebull && url.includes('/api/webull/')) return { ok: false, status: 502, json: async () => ({}) };
    const k = Object.keys(RESP).find(x => url.includes(x));
    if (k === undefined) throw new Error('URL no prevista');
    return { ok: true, status: 200, json: async () => RESP[k] };
  };
  return { fetchFn, llamadas };
}

function montar(opc: { bd?: Record<string, Fila[]>; errores?: ErroresBd; modelo?: Parameters<typeof modeloFalso>[0]; fallaWebull?: boolean } = {}) {
  const b = nuevaBdGuardado(opc.bd ?? {}, opc.errores ?? {});
  const m = modeloFalso(opc.modelo ?? { directorPropone: true });
  const f = fetchFalso(opc.fallaWebull === true);
  let n = 0;
  const ids: string[] = [];
  const deps = { llamar: m.llamar, modelo_analista: 'ma', modelo_director: 'md', ahora: () => AHORA, nuevoId: () => { const id = `00000000-0000-4000-9000-${String(++n).padStart(12, '0')}`; ids.push(id); return id; } };
  const ejecutar = (body: unknown = { ticker: 'GKOS', guardar: true }) => ejecutarAnalisisGuardado(b.cliente, deps, { fetchFn: f.fetchFn, origen: 'https://x.test', authorization: TOKEN, finnhub_key: CLAVE }, body);
  return { b, m, f, ids, ejecutar };
}
const POSICION: Fila = { trade_id: 't-1', portfolio_id: PF, ticker: 'GKOS', fecha_apertura: '2026-10-01' };
const COMPRA: Fila = { id: 'e1', trade_id: 't-1', execution_type: 'buy', price: 10, quantity: 5, executed_at: '2026-10-10T10:00:00', total: 50 };
const EXPEDIENTE: Fila = { id: EXP, ticker: 'GKOS', mercado: 'US', portfolio_id: PF, portafolio_codigo: 'PMP', rol_posicion: null, ficha: {}, tesis_vigente: null, tesis_version: 1 };
const insertsDe = (b: ReturnType<typeof nuevaBdGuardado>, tabla: string) => b.e.inserts.filter(i => i.tabla === tabla).map(i => i.fila);
const peticionDirector = (m: ReturnType<typeof modeloFalso>): Record<string, unknown> => {
  const p = m.peticiones.find(x => x.esquema_nombre !== 'salida_fundamental_v1')!;
  return JSON.parse(p.mensajes[1]!.content) as Record<string, unknown>;
};

describe('v0.13: clasificación de la tesis', () => {
  it('hayTesisVigente: null, vacíos y objetos o listas vacías no son tesis', () => {
    for (const v of [null, undefined, '', '   ', {}, []]) expect(hayTesisVigente(v)).toBe(false);
  });
  it('hayTesisVigente: texto, objeto o lista con contenido, y cualquier otro valor, sí', () => {
    for (const v of ['Tesis', { resumen: 'x' }, ['x'], 0, 1, true, false]) expect(hayTesisVigente(v)).toBe(true);
  });
  const dir = (tesis: unknown) => ({ tesis });
  it('propuesta_cambio con texto y sin tesis vigente es PRIMERA propuesta; con tesis vigente es CAMBIO', () => {
    expect(clasificarTesisPropuesta(dir({ estado: 'propuesta_cambio', propuesta: 'Texto' }), false)).toBe(TESIS_PRIMERA_PROPUESTA);
    expect(clasificarTesisPropuesta(dir({ estado: 'propuesta_cambio', propuesta: 'Texto' }), true)).toBe(TESIS_CAMBIO);
  });
  it('sin propuesta: otros estados, propuesta vacía o nula, y formas inválidas', () => {
    for (const estado of ['sin_tesis', 'sin_cambio', 'vigente']) expect(clasificarTesisPropuesta(dir({ estado, propuesta: 'Texto' }), true)).toBe(TESIS_SIN_PROPUESTA);
    for (const propuesta of [null, '', '  ', 5]) expect(clasificarTesisPropuesta(dir({ estado: 'propuesta_cambio', propuesta }), false)).toBe(TESIS_SIN_PROPUESTA);
    for (const x of [undefined, null, 'x', {}, dir(null), dir('x')]) expect(clasificarTesisPropuesta(x, false)).toBe(TESIS_SIN_PROPUESTA);
  });
  it('los valores son los esperados', () => {
    expect([TESIS_PRIMERA_PROPUESTA, TESIS_CAMBIO, TESIS_SIN_PROPUESTA]).toEqual(['primera_propuesta', 'cambio_de_tesis', 'sin_propuesta']);
  });
});

describe('v0.13: cuerpo de la ruta', () => {
  it('acepta guardar y lo normaliza', () => {
    expect(CLAVES_ANALISIS_REAL).toContain('guardar');
    expect(validarCuerpoAnalisis({ ticker: ' gkos ', guardar: true })).toEqual({ ok: true, cuerpo: { ticker: 'GKOS', guardar: true } });
    expect(validarCuerpoAnalisis({ ticker: 'GKOS' })).toEqual({ ok: true, cuerpo: { ticker: 'GKOS', guardar: false } });
    expect(validarCuerpoAnalisis({ ticker: 'GKOS', guardar: false, con_director: false, portafolio: 'PCP' })).toEqual({ ok: true, cuerpo: { ticker: 'GKOS', guardar: false, con_director: false, portafolio: 'PCP' } });
  });
  it('rechaza guardar no booleano, campos extra, ticker y portafolio inválidos', () => {
    expect(validarCuerpoAnalisis({ ticker: 'GKOS', guardar: 'si' })).toEqual({ ok: false, error: 'guardar debe ser booleano' });
    expect(validarCuerpoAnalisis({ ticker: 'GKOS', user_id: 'x' })).toEqual({ ok: false, error: 'campos no permitidos: user_id' });
    expect(validarCuerpoAnalisis({ ticker: '??' })).toEqual({ ok: false, error: 'ticker inválido' });
    expect(validarCuerpoAnalisis({ ticker: 'GKOS', portafolio: 'XX' })).toMatchObject({ ok: false });
    expect(validarCuerpoAnalisis({ ticker: 'GKOS', con_director: 'si' })).toEqual({ ok: false, error: 'con_director debe ser booleano' });
    expect(validarCuerpoAnalisis(null)).toEqual({ ok: false, error: 'el cuerpo debe ser un objeto JSON' });
  });
  it('el análisis sin base de datos rechaza guardar sin traer datos ni llamar al modelo', async () => {
    const m = modeloFalso(); const f = fetchFalso();
    const r = await ejecutarAnalisisReal({ llamar: m.llamar, modelo_analista: 'a', modelo_director: 'd', nuevoId: () => 'x', ahora: () => AHORA }, { fetchFn: f.fetchFn, origen: 'https://x.test', authorization: TOKEN, finnhub_key: CLAVE }, { ticker: 'GKOS', guardar: true });
    expect(r.http).toBe(400);
    expect(f.llamadas).toHaveLength(0);
    expect(m.peticiones).toHaveLength(0);
  });
});

describe('v0.13: guardado, camino feliz (posición nueva)', () => {
  it('crea el expediente, guarda los análisis y registra la corrida con el mismo run_id', async () => {
    const t = montar();
    const r = await t.ejecutar();
    expect(r.http).toBe(200);
    expect(r.cuerpo).toMatchObject({
      ok: true, guardado: true, ticker: 'GKOS', portafolio: 'PMP', tipo_evaluacion: 'nueva_posicion', posicion_existe: false, analisis_completo: true, resultado_corrida: 'corrida',
      expediente: { creado: true, tesis_vigente_previa: false }, persistencia: { estado: 'guardada', filas_corrida: 1 },
    });
    expect((r.cuerpo['director'] as Record<string, unknown>)['clasificacion_tesis']).toBe('primera_propuesta');
    // expediente: tesis_origen al_entrar (posición nueva), mercado US, sin user_id
    const exps = insertsDe(t.b, 'oficina_expedientes');
    expect(exps).toHaveLength(1);
    expect(exps[0]).toMatchObject({ ticker: 'GKOS', mercado: 'US', portfolio_id: PF, portafolio_codigo: 'PMP', tesis_origen: 'al_entrar' });
    // análisis: fundamental, técnico, director y auditor, todos con el expediente real y sin user_id
    const an = insertsDe(t.b, 'oficina_analisis');
    expect(an.map(f => f['agente']).sort()).toEqual(['auditor_reglas', 'director_ia', 'fundamental', 'tecnico'].sort());
    const idExp = (r.cuerpo['expediente'] as Record<string, unknown>)['id'];
    for (const f of an) { expect(f['expediente_id']).toBe(idExp); expect(f).not.toHaveProperty('user_id'); }
    // una sola corrida registrada, con el run_id y el expediente
    expect(t.b.e.rpc).toHaveLength(1);
    const corrida = t.b.e.rpc[0]!.args['p_corrida'] as Fila;
    expect(corrida).toMatchObject({ corrida_id: t.ids[0], expediente_id: idExp, tipo_evaluacion: 'nueva_posicion', portafolio_codigo: 'PMP', ticker: 'GKOS', disparador: 'usuario', mercado: 'US' });
    expect(r.cuerpo['run_id']).toBe(t.ids[0]);
    // el Fundamental recibió un sobre con ese run_id y un snapshot distinto
    const sobre = JSON.parse(t.m.peticiones[0]!.mensajes[1]!.content) as Record<string, unknown>;
    expect(sobre['run_id']).toBe(t.ids[0]);
    expect((sobre['snapshot'] as Record<string, unknown>)['id']).toBe(t.ids[1]);
    expect(t.ids).toHaveLength(2);
  });
  it('el orden: primero datos y lecturas, después el expediente, después los modelos y al final la corrida', async () => {
    const t = montar();
    await t.ejecutar();
    const o = t.b.e.orden;
    expect(o.indexOf('insert:oficina_expedientes')).toBeGreaterThan(o.indexOf('select:oficina_v_posiciones'));
    expect(o.indexOf('insert:oficina_analisis')).toBeGreaterThan(o.indexOf('insert:oficina_expedientes'));
    expect(o[o.length - 1]).toBe('rpc:oficina_registrar_corrida');
    expect(o.filter(x => x === 'rpc:oficina_registrar_corrida')).toHaveLength(1);
  });
  it('el análisis guardado del Fundamental lleva la trazabilidad y el del Director las anotaciones del código', async () => {
    const t = montar();
    await t.ejecutar();
    const an = insertsDe(t.b, 'oficina_analisis');
    const f = an.find(x => x['agente'] === 'fundamental')!;
    expect((f['salida'] as Record<string, unknown>)['trazabilidad']).toMatchObject({ contrato: 'salida.v1', version_prompt: 'fundamental.p7', run_id: t.ids[0] });
    expect((f['salida'] as Record<string, unknown>)).not.toHaveProperty('anotaciones_codigo');
    const d = an.find(x => x['agente'] === 'director_ia')!;
    expect((d['salida'] as Record<string, unknown>)['anotaciones_codigo']).toEqual({
      clasificacion_tesis: 'primera_propuesta', tesis_vigente_previa: false,
      contexto_enviado_al_director: { tipo_evaluacion: 'nueva_posicion', auditoria: null, reglas_versiones_ids: [] },
    });
  });
  it('no filtra tokens ni claves en la respuesta', async () => {
    const t = montar();
    const r = await t.ejecutar();
    const txt = JSON.stringify(r);
    expect(txt).not.toContain('TOKEN-SECRETO');
    expect(txt).not.toContain(CLAVE);
  });
});

describe('v0.13: guardado con posición abierta y tesis vigente', () => {
  const bd = (tesis: unknown): Record<string, Fila[]> => ({ oficina_v_posiciones: [POSICION], trade_executions: [COMPRA], oficina_expedientes: [{ ...EXPEDIENTE, tesis_vigente: tesis }] });
  it('con posición el tipo es posicion_abierta y se reutiliza el expediente existente', async () => {
    const t = montar({ bd: bd(null) });
    const r = await t.ejecutar();
    expect(r.http).toBe(200);
    expect(r.cuerpo).toMatchObject({ tipo_evaluacion: 'posicion_abierta', posicion_existe: true, expediente: { id: EXP, creado: false, tesis_vigente_previa: false } });
    expect(insertsDe(t.b, 'oficina_expedientes')).toHaveLength(0);
    expect((t.b.e.rpc[0]!.args['p_corrida'] as Fila)).toMatchObject({ tipo_evaluacion: 'posicion_abierta', expediente_id: EXP });
  });
  it('con tesis vigente en el expediente la propuesta del Director es un CAMBIO', async () => {
    const t = montar({ bd: bd({ resumen: 'Tesis aprobada' }) });
    const r = await t.ejecutar();
    expect(r.cuerpo['expediente']).toMatchObject({ tesis_vigente_previa: true });
    expect((r.cuerpo['director'] as Record<string, unknown>)['clasificacion_tesis']).toBe('cambio_de_tesis');
    const d = insertsDe(t.b, 'oficina_analisis').find(x => x['agente'] === 'director_ia')!;
    expect((d['salida'] as Record<string, unknown>)['anotaciones_codigo']).toMatchObject({ clasificacion_tesis: 'cambio_de_tesis', tesis_vigente_previa: true });
  });
  it('si el Director no propone nada, sin_propuesta', async () => {
    const t = montar({ modelo: {} });
    const r = await t.ejecutar();
    expect((r.cuerpo['director'] as Record<string, unknown>)['clasificacion_tesis']).toBe('sin_propuesta');
  });
});

describe('v0.13: privacidad del Director (capa gratuita)', () => {
  it('la constante de privacidad está activa', () => {
    expect(DIRECTOR_VE_DATOS_PRIVADOS).toBe(false);
  });
  it('el Director no recibe el tipo real, el Auditor, las reglas ni el contexto, aunque haya posición', async () => {
    const t = montar({ bd: { oficina_v_posiciones: [POSICION], trade_executions: [COMPRA], oficina_expedientes: [EXPEDIENTE] } });
    const r = await t.ejecutar();
    expect(r.cuerpo['tipo_evaluacion']).toBe('posicion_abierta');
    const ctx = peticionDirector(t.m);
    expect(ctx['tipo_evaluacion']).toBe('nueva_posicion');
    expect(ctx['auditoria']).toBeNull();
    expect(ctx['reglas_versiones_ids']).toEqual([]);
    expect(ctx['contexto']).toBeNull();
    expect(Object.keys(ctx).sort()).toEqual(['analistas_requeridos_sin_resultado', 'auditoria', 'contexto', 'mercado', 'portafolio_codigo', 'reglas_versiones_ids', 'run_id', 'salidas_analistas', 'snapshot_id', 'tipo_evaluacion', 'ticker'].sort());
    const texto = t.m.peticiones.map(p => p.mensajes[1]!.content).join('\n');
    expect(texto).not.toContain('posicion_abierta');
    expect(texto).not.toContain('BLOQUEO');
  });
});

describe('v0.13: fallos antes de escribir', () => {
  const sinEscritura = (t: ReturnType<typeof montar>): void => {
    expect(t.b.e.inserts).toHaveLength(0);
    expect(t.b.e.rpc).toHaveLength(0);
    expect(t.m.peticiones).toHaveLength(0);
  };
  it('cuerpo inválido, sin guardar o sin Director: 400 sin traer datos ni tocar la base', async () => {
    for (const [body, texto] of [
      [{ ticker: '??', guardar: true }, 'ticker inválido'],
      [{ ticker: 'GKOS' }, 'falta guardar true'],
      [{ ticker: 'GKOS', guardar: true, con_director: false }, 'con_director no puede ser false'],
    ] as [unknown, string][]) {
      const t = montar();
      const r = await t.ejecutar(body);
      expect(r.http).toBe(400);
      expect(r.cuerpo).toMatchObject({ ok: false, guardado: false });
      expect(String(r.cuerpo['error'])).toContain(texto);
      expect(t.f.llamadas).toHaveLength(0);
      expect(t.b.e.orden).toHaveLength(0);
      sinEscritura(t);
    }
  });
  it('si falla Webull: HTTP 502, la base no se toca y no se llama al modelo', async () => {
    const t = montar({ fallaWebull: true });
    const r = await t.ejecutar();
    expect(r.http).toBe(502);
    expect(r.cuerpo).toMatchObject({ ok: false, guardado: false });
    expect(t.b.e.orden).toHaveLength(0);
    sinEscritura(t);
  });
  it('portafolio sin configurar: 422 en la etapa portafolio', async () => {
    const t = montar({ bd: { oficina_portafolios_config: [] } });
    const r = await t.ejecutar();
    expect(r.http).toBe(422);
    expect(r.cuerpo).toMatchObject({ ok: false, guardado: false, etapa: 'portafolio' });
    sinEscritura(t);
  });
  it('posición ambigua (dos filas) o lectura con error: 422 en la etapa posicion', async () => {
    const a = montar({ bd: { oficina_v_posiciones: [POSICION, { ...POSICION, trade_id: 't-2' }] } });
    const ra = await a.ejecutar();
    expect(ra.cuerpo).toMatchObject({ etapa: 'posicion' });
    expect(JSON.stringify(ra.cuerpo['problemas'])).toContain('ambiguo');
    sinEscritura(a);
    const b = montar({ errores: { tablas: { oficina_v_posiciones: 'falla de lectura' } } });
    const rb = await b.ejecutar();
    expect(rb.http).toBe(422);
    expect(rb.cuerpo).toMatchObject({ etapa: 'posicion' });
    expect(JSON.stringify(rb.cuerpo['problemas'])).toContain('falla de lectura');
    sinEscritura(b);
  });
  it('parámetros ilegibles: 422 en la etapa parametros', async () => {
    const t = montar({ errores: { tablas: { oficina_parametros: 'sin permiso' } } });
    const r = await t.ejecutar();
    expect(r.cuerpo).toMatchObject({ etapa: 'parametros' });
    sinEscritura(t);
  });
  it('expediente que no se puede crear: 422 en la etapa expediente, sin análisis ni modelo', async () => {
    const t = montar({ errores: { insert: { oficina_expedientes: 'viola una restricción' } } });
    const r = await t.ejecutar();
    expect(r.http).toBe(422);
    expect(r.cuerpo).toMatchObject({ etapa: 'expediente' });
    expect(JSON.stringify(r.cuerpo['problemas'])).toContain('viola una restricción');
    expect(insertsDe(t.b, 'oficina_analisis')).toHaveLength(0);
    expect(t.b.e.rpc).toHaveLength(0);
    expect(t.m.peticiones).toHaveLength(0);
  });
  it('una consulta de tesis sin filas (el expediente no se ve): etapa tesis', async () => {
    const t = montar({ bd: { oficina_expedientes: [EXPEDIENTE] }, errores: { vacio: (tabla, filtros) => tabla === 'oficina_expedientes' && filtros.some(([c]) => c === 'id') } });
    const r = await t.ejecutar();
    expect(r.cuerpo).toMatchObject({ etapa: 'tesis' });
    expect(JSON.stringify(r.cuerpo['problemas'])).toContain('se esperaba 1 fila');
    expect(t.m.peticiones).toHaveLength(0);
  });
  it('la lectura de la tesis del expediente falla o no devuelve una fila: etapa tesis, sin modelo', async () => {
    const falla = montar({ bd: { oficina_expedientes: [EXPEDIENTE] }, errores: { si: (tabla, filtros) => (tabla === 'oficina_expedientes' && filtros.some(([c]) => c === 'id') ? 'no se pudo leer la tesis' : undefined) } });
    const r = await falla.ejecutar();
    expect(r.cuerpo).toMatchObject({ etapa: 'tesis' });
    expect(JSON.stringify(r.cuerpo['problemas'])).toContain('no se pudo leer la tesis');
    expect(falla.m.peticiones).toHaveLength(0);
    expect(falla.b.e.rpc).toHaveLength(0);
  });
});

describe('v0.13: sanear el contexto del Director', () => {
  const ctx = (): ContextoDirector => ({
    run_id: 'r', snapshot_id: 's', ticker: 'GKOS', mercado: 'US', portafolio_codigo: 'PMP', tipo_evaluacion: 'posicion_abierta',
    salidas_analistas: { fundamental: { agente: 'fundamental' } }, auditoria: { veredicto: 'BLOQUEO_REGLA', reglas_revisadas: ['PMP-01'] },
    reglas_versiones_ids: ['v1', 'v2'], contexto: { saldo: 123 },
  });
  it('quita auditoría, reglas y contexto, y pone el tipo neutro; conserva lo público', () => {
    const original = ctx();
    const r = sanearContextoDirector(original);
    expect(r).toEqual({
      run_id: 'r', snapshot_id: 's', ticker: 'GKOS', mercado: 'US', portafolio_codigo: 'PMP', tipo_evaluacion: 'nueva_posicion',
      salidas_analistas: { fundamental: { agente: 'fundamental' } }, auditoria: null, reglas_versiones_ids: [], contexto: null,
    });
    expect(original).toEqual(ctx());
  });
});

describe('v0.13: fallos durante el análisis', () => {
  it('si el registro de la corrida falla: HTTP 500, ok false y el error de la base tal cual', async () => {
    const t = montar({ errores: { rpc: 'la función falló' } });
    const r = await t.ejecutar();
    expect(r.http).toBe(500);
    expect(r.cuerpo).toMatchObject({ ok: false, guardado: true, persistencia: { estado: 'fallo', error: 'la función falló' } });
    expect(t.b.e.rpc).toHaveLength(1);
  });
  it('si la preparación del Auditor falla, la corrida se registra igual y conserva el expediente real', async () => {
    const t = montar({ errores: { tablas: { oficina_reglas: 'sin permiso' } } });
    const r = await t.ejecutar();
    expect(r.cuerpo).toMatchObject({ persistencia: { estado: 'guardada' } });
    const idExp = (r.cuerpo['expediente'] as Record<string, unknown>)['id'];
    expect((t.b.e.rpc[0]!.args['p_corrida'] as Fila)['expediente_id']).toBe(idExp);
    expect(insertsDe(t.b, 'oficina_analisis').filter(f => f['agente'] === 'auditor_reglas')).toHaveLength(0);
  });
  it('si el Fundamental no valida, la corrida se registra igual y analisis_completo es false', async () => {
    const t = montar({ modelo: { fundamentalMalo: true } });
    const r = await t.ejecutar();
    expect(r.cuerpo).toMatchObject({ analisis_completo: false, fundamental: { estado: 'error' }, persistencia: { estado: 'guardada' } });
    expect(insertsDe(t.b, 'oficina_analisis').filter(f => f['agente'] === 'fundamental')).toHaveLength(0);
    expect(t.b.e.rpc).toHaveLength(1);
  });
  it('si la base rechaza el análisis, el agente queda en error con el motivo y no se finge un id', async () => {
    const t = montar({ errores: { insert: { oficina_analisis: 'no se pudo insertar' } } });
    const r = await t.ejecutar();
    const f = r.cuerpo['fundamental'] as Record<string, unknown>;
    expect(f['estado']).toBe('error');
    expect(String(f['error'])).toContain('no se pudo insertar');
    expect(f).not.toHaveProperty('analisis_id');
    expect(r.cuerpo['analisis_completo']).toBe(false);
  });
  it('el Director malo queda en error y la clasificación no se informa', async () => {
    const t = montar({ modelo: { directorMalo: true } });
    const r = await t.ejecutar();
    const d = r.cuerpo['director'] as Record<string, unknown>;
    expect(d['estado']).toBe('error');
    expect(d).not.toHaveProperty('clasificacion_tesis');
    expect(r.cuerpo['analisis_completo']).toBe(false);
  });
});
