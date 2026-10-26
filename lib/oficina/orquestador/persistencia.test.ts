import { describe, expect, it } from 'vitest';
import {
  AGENTE_SIN_EXTRAS, FUNCION_REGISTRO, almacenSupabase, ejecutarCorrida, esUuid, filaCorridaParaBd, filaEjecucionParaBd, persistirResultado,
  verificarEjecucion, verificarFilaCorrida,
} from './index';
import type { Almacen, DatosCongelados, FilaCorrida, Puertos, ResultadoCorrida } from './index';
import type { EjecucionRegistrada } from './index';

const U = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const solicitud = (extra: Record<string, unknown> = {}) => ({
  contrato: 'solicitud.v1', disparador: 'usuario', ticker: 'xlk', mercado: 'US', portafolio_codigo: 'ETF', tipo_evaluacion: 'aporte_periodico',
  solicitado_en: '2026-10-22T14:00:00Z', ...extra,
});
const datos = (extra: Partial<DatosCongelados> = {}): DatosCongelados => ({
  snapshot_id: U(50), snapshot_generado_en: '2026-10-22T13:59:00Z', snapshot_fecha_datos: '2026-10-21', expediente_id: U(60), posicion_existe: true,
  reglas_versiones_ids: ['r1'], tesis_ref: null, parametros: [], sobres: {}, sobre_auditor: {},
  aporte_semanal: { efectivo_disponible: '10', etfs_sectoriales: 4, duplicado: false }, ...extra,
});
function puertos(): Puertos {
  let n = 0, t = 0;
  return {
    nuevoId: () => U(++n),
    ahora: () => new Date(Date.parse('2026-10-22T14:00:00Z') + (t++) * 1000).toISOString().replace('.000Z', 'Z'),
    analista: async () => ({ estado: 'ok' }),
    auditor: async () => ({ estado: 'ok', veredicto: 'CUMPLE', reglas_revisadas: ['ETF-01'] }),
    director: async () => ({ estado: 'ok' }),
  };
}
function almacenFalso(error: string | null = null) {
  const llamadas: { corrida: Record<string, unknown> | null; ejecuciones: Record<string, unknown>[] }[] = [];
  const a: Almacen = { registrar: async (corrida, ejecuciones) => { llamadas.push({ corrida, ejecuciones }); return { error }; } };
  return { a, llamadas };
}
const corridaDe = (r: ResultadoCorrida): FilaCorrida => { if (r.resultado !== 'corrida' && r.resultado !== 'pendiente_informacion') throw new Error(r.resultado); return r.fila_historial; };

describe('las filas reales de la corrida pasan todos los CHECK de la base', () => {
  const casos: [string, () => Promise<ResultadoCorrida>][] = [
    ['ETF aporte completo', () => ejecutarCorrida(solicitud(), datos(), puertos())],
    ['ETF aporte reducido', () => ejecutarCorrida(solicitud(), datos({ aporte_semanal: { efectivo_disponible: '5', etfs_sectoriales: 4, duplicado: false } }), puertos())],
    ['ETF sin efectivo suficiente', () => ejecutarCorrida(solicitud(), datos({ aporte_semanal: { efectivo_disponible: '1', etfs_sectoriales: 4, duplicado: false } }), puertos())],
    ['ETF sin datos del aporte (NO_EVALUABLE)', () => ejecutarCorrida(solicitud(), datos({ aporte_semanal: null }), puertos())],
    ['ETF revisión anual', () => ejecutarCorrida(solicitud({ tipo_evaluacion: 'revision_anual_etf' }), datos({ aporte_semanal: null, motor: { revision_etf: { comparable: true, supera_spy: true, fallo_anterior: false } } }), puertos())],
    ['PLP abrir BLOQUEADO', () => ejecutarCorrida(solicitud({ portafolio_codigo: 'PLP', tipo_evaluacion: 'nueva_posicion' }), datos({ posicion_existe: false }), puertos())],
    ['PLP abrir con sustitución', () => ejecutarCorrida(solicitud({ portafolio_codigo: 'PLP', tipo_evaluacion: 'nueva_posicion' }), datos({ sustitucion_autorizada: { regla: 'PLP-09', autorizacion_id: 'a' } }), puertos())],
    ['Semilla recompra con dinero nuevo', () => ejecutarCorrida(solicitud({ portafolio_codigo: 'SEMILLA', tipo_evaluacion: 'recompra' }), datos({ dinero_nuevo: true }), puertos())],
    ['sin portafolio', () => ejecutarCorrida(solicitud({ portafolio_codigo: null }), datos(), puertos())],
    ['sin datos congelados', () => ejecutarCorrida(solicitud(), null, puertos())],
    ['auditor con error', () => ejecutarCorrida(solicitud(), datos(), { ...puertos(), auditor: async () => ({ estado: 'error', error: 'x' }) })],
  ];
  for (const [nombre, f] of casos) {
    it(nombre, async () => {
      const r = await f();
      expect(['corrida', 'pendiente_informacion']).toContain(r.resultado);
      const fila = corridaDe(r);
      expect(verificarFilaCorrida(fila)).toEqual([]);
      if (r.resultado === 'corrida') for (const x of r.ejecuciones) expect(verificarEjecucion(x)).toEqual([]);
      expect(esUuid(fila.corrida_id)).toBe(true);
    });
  }
  it('la constancia de Especulativo / Spin Off lleva el código que exige la base (SPIN_OFF) y pasa el CHECK', async () => {
    const r = await ejecutarCorrida(solicitud({ portafolio_codigo: 'Spin Off' }), datos(), puertos());
    expect(r.resultado).toBe('sin_corrida');
    if (r.resultado !== 'sin_corrida') return;
    expect(r.constancia.portafolio_codigo).toBe('SPIN_OFF');
    expect(verificarEjecucion(r.constancia)).toEqual([]);
    const e = await ejecutarCorrida(solicitud({ portafolio_codigo: 'Especulativo' }), datos(), puertos());
    expect(e.resultado === 'sin_corrida' && e.constancia.portafolio_codigo).toBe('ESPECULATIVO');
  });
});

describe('esUuid', () => {
  it('exige el formato completo, sin texto antes ni después', () => {
    expect(esUuid(U(1))).toBe(true);
    expect(esUuid(`x${U(1)}`)).toBe(false);
    expect(esUuid(`${U(1)}x`)).toBe(false);
    expect(esUuid(` ${U(1)}`)).toBe(false);
    expect(esUuid(7)).toBe(false);
    expect(esUuid(null)).toBe(false);
  });
});

describe('verificarFilaCorrida replica cada CHECK', () => {
  const base = async (): Promise<FilaCorrida> => corridaDe(await ejecutarCorrida(solicitud(), datos(), puertos()));
  const con = async (cambios: Partial<FilaCorrida>) => verificarFilaCorrida({ ...(await base()), ...cambios });
  it('la base de comparación pasa', async () => expect(await con({})).toEqual([]));
  it('uuid: corrida_id, snapshot_id, expediente_id, corrida_previa_id, analisis ids', async () => {
    expect((await con({ corrida_id: 'run-1' }))[0]).toContain('corrida_id');
    expect((await con({ snapshot_id: 'snap-1' }))[0]).toContain('snapshot_id');
    expect((await con({ expediente_id: 'exp-1' }))[0]).toContain('expediente_id');
    expect((await con({ corrida_previa_id: 'x' }))[0]).toContain('corrida_previa_id');
    expect((await con({ auditoria_analisis_id: 'au-1' }))[0]).toContain('auditoria_analisis_id');
    expect((await con({ director_analisis_id: 'di-1' }))[0]).toContain('director_analisis_id');
    expect((await con({ decision_id: 'd' }))[0]).toContain('decision_id');
  });
  it('version_chk', async () => {
    expect((await con({ version: 0 }))[0]).toContain('version_chk');
    expect((await con({ version: 2, corrige_version: null }))[0]).toContain('version_chk');
    expect((await con({ version: 1, corrige_version: 1 }))[0]).toContain('version_chk');
    expect((await con({ version: 2, corrige_version: 2 }))[0]).toContain('version_chk');
    expect(await con({ version: 2, corrige_version: 1 })).toEqual([]);
  });
  it('listas de valores', async () => {
    expect((await con({ disparador: 'otro' }))[0]).toContain('disparador_chk');
    expect((await con({ estado_final: 'x' as never }))[0]).toContain('estado_chk');
    expect((await con({ ruta: 'x' as never }))[0]).toContain('ruta_chk');
    expect((await con({ portafolio_codigo: 'SPIN_OFF' as never }))[0]).toContain('portafolio_chk');
    expect((await con({ tipo_evaluacion: 'x' as never }))[0]).toContain('tipo_chk');
    expect((await con({ auditoria_veredicto: 'X' as never }))[0]).toContain('auditoria_chk');
    expect((await con({ decision: 'X' as never }))[0]).toContain('decision_chk');
    expect((await con({ director_estado: 'x' as never }))[0]).toContain('director_chk');
    expect(await con({ portafolio_codigo: null })).toEqual([]);
  });
  it('bloqueada_chk en ambos sentidos', async () => {
    expect((await con({ estado_final: 'bloqueada', decision: 'COMPRAR', motivos: [{ codigo: 'auditor_bloqueo', detalle: 'x' }] })).join()).toContain('bloqueada_chk');
    expect((await con({ estado_final: 'completada', decision: 'BLOQUEADO' })).join()).toContain('bloqueada_chk');
  });
  it('completada exige decisión; Director ok o no_aplica; ruta determinista exige no_aplica', async () => {
    expect((await con({ decision: null })).join()).toContain('completada_chk');
    expect((await con({ director_estado: 'error' })).join()).toContain('director_completada_chk');
    expect((await con({ director_estado: 'ok' })).join()).toContain('director_ruta_chk');
  });
  it('motivos obligatorios si no está completada', async () => {
    expect((await con({ estado_final: 'incompleta', decision: 'NO_EVALUABLE', motivos: [] })).join()).toContain('motivos_chk');
    expect(await con({ estado_final: 'incompleta', decision: 'NO_EVALUABLE', motivos: [{ codigo: 'datos_faltantes', detalle: 'x' }] })).toEqual([]);
  });
  it('NO_EVALUABLE solo con incompleta o pendiente_informacion', async () => {
    expect((await con({ decision: 'NO_EVALUABLE' })).join()).toContain('noevaluable_chk');
    expect((await con({ estado_final: 'pendiente_informacion', decision: 'NO_EVALUABLE', motivos: [{ codigo: 'datos_faltantes', detalle: 'x' }] })).join()).not.toContain('noevaluable_chk');
  });
  it('vocabulario por tipo: ESPERAR no es válida en un aporte; BLOQUEADO no existe en revisión anual', async () => {
    expect((await con({ decision: 'ESPERAR' })).join()).toContain('vocabulario_tipo_chk');
    expect((await con({ tipo_evaluacion: 'revision_anual_etf', decision: 'BLOQUEADO', estado_final: 'bloqueada', motivos: [{ codigo: 'auditor_bloqueo', detalle: 'x' }] })).join()).toContain('vocabulario_tipo_chk');
    expect((await con({ tipo_evaluacion: 'retiro_quinquenal', decision: 'VENDER' })).join()).toContain('vocabulario_tipo_chk');
    expect((await con({ tipo_evaluacion: 'recompra', decision: 'COMPRAR' })).join()).toContain('vocabulario_tipo_chk');
    expect((await con({ tipo_evaluacion: 'nueva_posicion', decision: 'RECOMPRAR' })).join()).toContain('vocabulario_tipo_chk');
    expect((await con({ tipo_evaluacion: 'posicion_abierta', decision: 'COMPRAR' })).join()).toContain('vocabulario_tipo_chk');
    expect((await con({ tipo_evaluacion: 'revision_tesis', decision: 'COMPRAR' })).join()).toContain('vocabulario_tipo_chk');
  });
  it('tiempos_chk', async () => {
    expect((await con({ finalizada_at: '2026-10-22T13:00:00Z' })).join()).toContain('tiempos_chk');
    expect(await con({ finalizada_at: null as never })).toEqual([]);
    expect(await con({ finalizada_at: '2026-10-22T14:00:00Z', iniciada_at: '2026-10-22T14:00:00Z' })).toEqual([]);
    expect((await con({ iniciada_at: 'ayer' })).join()).toContain('iniciada_at');
  });
});

describe('verificarEjecucion y mapeo de filas', () => {
  const ej = (c: Partial<EjecucionRegistrada> = {}): EjecucionRegistrada => ({
    run_id: U(1), agente: 'auditor', estado: 'ok', reintentos: 0, error: null, analisis_id: null, ticker: 'XLK', disparador: 'usuario', tipo_evaluacion: 'aporte_periodico',
    portafolio_codigo: 'ETF', expediente_id: null, proveedor: null, modelo: null, tokens_in: null, tokens_out: null, costo_usd: null, entradas: null,
    started_at: '2026-10-22T14:00:00Z', finished_at: '2026-10-22T14:00:01Z', ...c,
  });
  it('CHECK de la tabla de ejecuciones', () => {
    expect(verificarEjecucion(ej())).toEqual([]);
    expect(verificarEjecucion(ej({ run_id: 'run-1' }))[0]).toContain('run_id');
    expect(verificarEjecucion(ej({ expediente_id: 'e' }))[0]).toContain('expediente_id');
    expect(verificarEjecucion(ej({ estado: 'en_curso' as never }))).toEqual([]);
    expect(verificarEjecucion(ej({ estado: 'ausente' as never }))[0]).toContain('estado_check');
    expect(verificarEjecucion(ej({ disparador: 'x' }))[0]).toContain('disparador_check');
    expect(verificarEjecucion(ej({ portafolio_codigo: 'Spin Off' }))[0]).toContain('portafolio_codigo_check');
    expect(verificarEjecucion(ej({ portafolio_codigo: 'SPIN_OFF' }))).toEqual([]);
    expect(verificarEjecucion(ej({ portafolio_codigo: null }))).toEqual([]);
    expect(verificarEjecucion(ej({ agente: ' ' }))[0]).toContain('agente');
    expect(verificarEjecucion(ej({ started_at: 'x' }))[0]).toContain('started_at');
  });
  it('la fila de ejecución solo trae columnas que existen; reintentos y analisis_id van en entradas (salvo el orquestador)', () => {
    const f = filaEjecucionParaBd(ej({ reintentos: 1, analisis_id: U(9) }));
    expect(Object.keys(f).sort()).toEqual(['agente', 'costo_usd', 'disparador', 'entradas', 'error', 'estado', 'expediente_id', 'finished_at', 'modelo', 'portafolio_codigo', 'proveedor', 'run_id', 'started_at', 'ticker', 'tipo_evaluacion', 'tokens_in', 'tokens_out'].sort());
    expect(f.entradas).toEqual({ reintentos: 1, analisis_id: U(9) });
    expect(filaEjecucionParaBd(ej()).entradas).toEqual({ reintentos: 0 });
    expect(filaEjecucionParaBd(ej({ entradas: { a: 1 }, reintentos: 2 })).entradas).toEqual({ a: 1, reintentos: 2 });
    const o = filaEjecucionParaBd(ej({ agente: AGENTE_SIN_EXTRAS, entradas: { resultado: 'NO_EVALUABLE', motivo: 'portafolio_sin_reglas' }, reintentos: 0 }));
    expect(o.entradas).toEqual({ resultado: 'NO_EVALUABLE', motivo: 'portafolio_sin_reglas' });
    expect(filaEjecucionParaBd(ej({ agente: AGENTE_SIN_EXTRAS })).entradas).toBeNull();
  });
  it('user_id solo se envía si se entrega', async () => {
    expect('user_id' in filaEjecucionParaBd(ej())).toBe(false);
    expect(filaEjecucionParaBd(ej(), U(7)).user_id).toBe(U(7));
    const fila = corridaDe(await ejecutarCorrida(solicitud(), datos(), puertos()));
    expect('user_id' in filaCorridaParaBd(fila)).toBe(false);
    expect(filaCorridaParaBd(fila, U(7)).user_id).toBe(U(7));
  });
  it('la fila de corrida solo trae columnas que existen y no trae id ni created_at', async () => {
    const fila = corridaDe(await ejecutarCorrida(solicitud(), datos(), puertos()));
    const cols = Object.keys(filaCorridaParaBd(fila));
    expect(cols).not.toContain('id');
    expect(cols).not.toContain('created_at');
    expect(cols.sort()).toEqual(['agentes_requeridos', 'auditoria_analisis_id', 'auditoria_veredicto', 'corrida_id', 'corrida_previa_id', 'corrige_version', 'datos_vencidos', 'decision', 'decision_id',
      'director_analisis_id', 'director_estado', 'disparador', 'estado_final', 'expediente_id', 'finalizada_at', 'iniciada_at', 'matriz_agentes_version', 'mercado', 'motivos', 'portafolio_codigo',
      'referencias', 'reglas_versiones_ids', 'resultados_agentes', 'ruta', 'snapshot_fecha_datos', 'snapshot_generado_en', 'snapshot_id', 'tesis_ref', 'ticker', 'tipo_evaluacion', 'version'].sort());
  });
});

describe('persistirResultado: una sola escritura atómica', () => {
  it('corrida: UNA llamada con la corrida y todas sus ejecuciones', async () => {
    const x = almacenFalso();
    const r = await persistirResultado(await ejecutarCorrida(solicitud(), datos(), puertos()), x.a, { user_id: U(7) });
    expect(r).toEqual({ estado: 'guardada', corrida_id: U(1), filas_corrida: 1, filas_ejecuciones: 1 });
    expect(x.llamadas).toHaveLength(1);
    expect(x.llamadas[0]!.corrida).toMatchObject({ corrida_id: U(1), user_id: U(7) });
    expect(x.llamadas[0]!.ejecuciones).toHaveLength(1);
    expect(x.llamadas[0]!.ejecuciones[0]).toMatchObject({ run_id: U(1), agente: 'auditor', user_id: U(7) });
  });
  it('sin_corrida: corrida null y solo la constancia', async () => {
    const x = almacenFalso();
    const r = await persistirResultado(await ejecutarCorrida(solicitud({ portafolio_codigo: 'Especulativo' }), datos(), puertos()), x.a);
    expect(r).toEqual({ estado: 'guardada', corrida_id: null, filas_corrida: 0, filas_ejecuciones: 1 });
    expect(x.llamadas).toHaveLength(1);
    expect(x.llamadas[0]!.corrida).toBeNull();
    expect(x.llamadas[0]!.ejecuciones[0]).toMatchObject({ agente: 'orquestador', portafolio_codigo: 'ESPECULATIVO', entradas: { resultado: 'NO_EVALUABLE', motivo: 'portafolio_sin_reglas' } });
  });
  it('pendiente_informacion: la corrida con cero ejecuciones', async () => {
    const x = almacenFalso();
    const r = await persistirResultado(await ejecutarCorrida(solicitud({ portafolio_codigo: null }), datos(), puertos()), x.a);
    expect(r).toEqual({ estado: 'guardada', corrida_id: U(1), filas_corrida: 1, filas_ejecuciones: 0 });
    expect(x.llamadas[0]!.ejecuciones).toEqual([]);
  });
  it('solicitud inválida: nada que guardar y no se escribe', async () => {
    const x = almacenFalso();
    const r = await persistirResultado(await ejecutarCorrida({ contrato: 'x' }, datos(), puertos()), x.a);
    expect(r.estado).toBe('nada_que_guardar');
    expect(x.llamadas).toEqual([]);
  });
  it('si algo no pasa los CHECK no se llama a la base', async () => {
    const x = almacenFalso();
    const r = await persistirResultado(await ejecutarCorrida(solicitud(), datos(), { ...puertos(), nuevoId: () => 'no-uuid' }), x.a);
    expect(r.estado).toBe('rechazada_antes_de_escribir');
    if (r.estado === 'rechazada_antes_de_escribir') expect(r.errores.some(m => m.includes('corrida_id')) && r.errores.some(m => m.startsWith('auditor:'))).toBe(true);
    expect(x.llamadas).toEqual([]);
  });
  it('una constancia que no pasa los CHECK no se escribe', async () => {
    const x = almacenFalso();
    const r = await ejecutarCorrida(solicitud({ portafolio_codigo: 'Especulativo' }), datos(), { ...puertos(), nuevoId: () => 'no-uuid' });
    expect((await persistirResultado(r, x.a)).estado).toBe('rechazada_antes_de_escribir');
    expect(x.llamadas).toEqual([]);
  });
  it('el error de la base se devuelve tal cual y NO se reintenta (una sola llamada)', async () => {
    const x = almacenFalso('new row for relation "oficina_corridas_historial" violates check constraint "x"');
    const r = await persistirResultado(await ejecutarCorrida(solicitud(), datos(), puertos()), x.a);
    expect(r).toEqual({ estado: 'fallo', error: 'new row for relation "oficina_corridas_historial" violates check constraint "x"' });
    expect(x.llamadas).toHaveLength(1);
    const y = almacenFalso('boom');
    const c = await persistirResultado(await ejecutarCorrida(solicitud({ portafolio_codigo: 'Especulativo' }), datos(), puertos()), y.a);
    expect(c).toEqual({ estado: 'fallo', error: 'boom' });
    expect(y.llamadas).toHaveLength(1);
  });
});

describe('almacenSupabase', () => {
  it('llama a la función SQL con p_corrida y p_ejecuciones y devuelve el error tal cual, sin lanzar ni reintentar', async () => {
    const vistos: [string, unknown][] = [];
    const ok = almacenSupabase({ rpc: async (f, a) => { vistos.push([f, a]); return { error: null }; } });
    expect(await ok.registrar({ a: 1 }, [{ b: 2 }])).toEqual({ error: null });
    expect(vistos).toEqual([[FUNCION_REGISTRO, { p_corrida: { a: 1 }, p_ejecuciones: [{ b: 2 }] }]]);
    expect(FUNCION_REGISTRO).toBe('oficina_registrar_corrida');
    let n = 0;
    const mal = almacenSupabase({ rpc: async () => { n++; return { error: { message: 'viola check' } }; } });
    expect(await mal.registrar(null, [])).toEqual({ error: 'viola check' });
    expect(n).toBe(1);
    let m = 0;
    const lanza = almacenSupabase({ rpc: () => { m++; throw new Error('red caída'); } });
    expect(await lanza.registrar(null, [])).toEqual({ error: 'red caída' });
    expect(m).toBe(1);
  });
});
