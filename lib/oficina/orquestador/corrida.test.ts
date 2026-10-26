import { describe, expect, it } from 'vitest';
import type { Candle } from '../tecnico';
import { MATRIZ_AGENTES_VERSION, coherenciaPosicion, ejecutarCorrida } from './index';
import type { DatosCongelados, Puertos, RespuestaAgente, RespuestaAuditor, ResultadoCorrida } from './index';
import type { Agente } from '../motor';

// ---------- velas (formato chart-data) ----------
const t = (f: string): number => Date.parse(`${f}T00:00:00Z`) / 1000;
const mas = (f: string, d: number): string => new Date((t(f) + d * 86400) * 1000).toISOString().slice(0, 10);
const dow = (f: string): number => new Date(t(f) * 1000).getUTCDay();
type Precio = (i: number) => number;
const vela = (f: string, c: number): Candle => ({ time: t(f), open: c - 0.1, high: c + 0.2, low: c - 0.2, close: c, volume: 1000 });
const ondulado: Precio = i => 100 + 10 * Math.sin(i / 5) + i * 0.05;
const sube: Precio = i => 100 + i * 0.5;
const baja: Precio = i => 400 - i * 0.5;
/** Onda lenta: al final cumple apertura_pcp y dca_plp pero NO recompra_pcp (verificado con prepararTecnico). */
const sinSenal: Precio = i => 100 + 10 * Math.sin(i / 20 + 3);
function diarias(fin: string, n: number, p: Precio = ondulado): Candle[] {
  const fs: string[] = [];
  for (let f = fin; fs.length < n; f = mas(f, -1)) if (dow(f) !== 0 && dow(f) !== 6) fs.unshift(f);
  return fs.map((f, i) => vela(f, p(i)));
}
const semanales = (lunes: string, n: number, p: Precio = ondulado): Candle[] => Array.from({ length: n }, (_, i) => vela(mas(lunes, -7 * (n - 1 - i)), p(i)));
const velas = (p: Precio = ondulado, fin = '2026-10-21') => ({ diarias: diarias(fin, 300, p), semanales: semanales('2026-10-19', 120, p), fuente: 'TwelveData' });

// ---------- solicitud, datos y puertos de prueba ----------
const sol = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  contrato: 'solicitud.v1', disparador: 'usuario', ticker: 'gkos', mercado: 'US', portafolio_codigo: 'PMP', tipo_evaluacion: 'nueva_posicion',
  origen: { watchlist_id: null, alerta_id: null }, solicitado_en: '2026-10-22T13:55:00Z', ...extra,
});
const PARAMS = [
  { clave: 'orquestador.margen_cierre_velas', valor: { valor: 30, unidad: 'minutos' }, version: 1, vigente_desde: '2026-10-22' },
  { clave: 'frescura.precio', valor: { valor: 1, unidad: 'dias_habiles' }, version: 1, vigente_desde: '2026-10-14' },
];
const datos = (extra: Partial<DatosCongelados> = {}): DatosCongelados => ({
  snapshot_id: 'snap-1', snapshot_generado_en: '2026-10-22T13:59:00Z', snapshot_fecha_datos: '2026-10-21', expediente_id: 'exp-1',
  posicion_existe: false, reglas_versiones_ids: ['r1', 'r2'], tesis_ref: { version: 2, origen: 'al_entrar' }, parametros: PARAMS,
  velas: velas(), sobres: { fundamental: { f: 1 }, valuacion: { v: 1 }, tecnico: { t: 1 }, riesgo_capital: { r: 1 } }, sobre_auditor: { aud: 1 },
  contexto_director: { watchlist: 'x' },
  motor: { capital: { efectivo_disponible: '100', monto_requerido: '50', veredicto_riesgo: 'VIABLE' }, tesis_estado: 'intacta', momento: { detonante_confirmado: true }, monto_operacion: '50' },
  ...extra,
});

const VEREDICTO: Record<Agente, string> = { fundamental: 'SOLIDO', valuacion: 'RAZONABLE', tecnico: 'FAVORABLE', riesgo_capital: 'VIABLE' };
interface Config {
  analista?: (a: Agente, sobre: unknown, intento: number) => Promise<RespuestaAgente> | RespuestaAgente;
  auditor?: () => Promise<RespuestaAuditor> | RespuestaAuditor;
  director?: () => Promise<RespuestaAgente> | RespuestaAgente;
}
function puertos(cfg: Config = {}, inicio = '2026-10-22T14:00:00Z') {
  const log: string[] = [];
  const sobres: Partial<Record<Agente, unknown>> = {};
  const intentos: Record<string, number> = {};
  let directorCtx: unknown = null;
  let n = 0, reloj = 0;
  const p: Puertos = {
    nuevoId: () => `run-${++n}`,
    ahora: () => new Date(Date.parse(inicio) + (reloj++) * 1000).toISOString().replace('.000Z', 'Z'),
    analista: async (a, sobre) => {
      log.push(`analista:${a}`); sobres[a] = sobre;
      intentos[a] = (intentos[a] ?? 0) + 1;
      return cfg.analista ? cfg.analista(a, sobre, intentos[a]!) : { estado: 'ok', analisis_id: `an-${a}`, veredicto: VEREDICTO[a], salida: { de: a } };
    },
    auditor: async () => { log.push('auditor'); return cfg.auditor ? cfg.auditor() : { estado: 'ok', veredicto: 'CUMPLE', analisis_id: 'au-1', reglas_revisadas: ['PMP-01'] }; },
    director: async (c) => { log.push('director'); directorCtx = c; return cfg.director ? cfg.director() : { estado: 'ok', analisis_id: 'di-1' }; },
  };
  return { p, log, sobres, intentos, directorCtx: () => directorCtx };
}
const corrida = (r: ResultadoCorrida) => { if (r.resultado !== 'corrida') throw new Error(`se esperaba corrida y fue ${r.resultado}`); return r; };

describe('camino normal: PMP nueva_posicion con los cuatro analistas, Auditor y Director', () => {
  it('termina COMPRAR, completada, pendiente de autorización; la fila lleva todo lo congelado', async () => {
    const x = puertos();
    const r = corrida(await ejecutarCorrida(sol(), datos(), x.p));
    expect(r.salida_motor).toMatchObject({ decision: 'COMPRAR', estado_final: 'completada', requiere_autorizacion: true, estado_usuario: 'pendiente' });
    expect(r.fila_historial).toMatchObject({
      corrida_id: 'run-1', version: 1, corrige_version: null, corrida_previa_id: null, expediente_id: 'exp-1', ticker: 'GKOS', mercado: 'US',
      portafolio_codigo: 'PMP', tipo_evaluacion: 'nueva_posicion', ruta: 'analitica', disparador: 'usuario',
      snapshot_id: 'snap-1', snapshot_generado_en: '2026-10-22T13:59:00Z', snapshot_fecha_datos: '2026-10-21', reglas_versiones_ids: ['r1', 'r2'],
      matriz_agentes_version: MATRIZ_AGENTES_VERSION, tesis_ref: { version: 2, origen: 'al_entrar' },
      agentes_requeridos: ['fundamental', 'valuacion', 'tecnico', 'riesgo_capital'],
      auditoria_veredicto: 'CUMPLE', auditoria_analisis_id: 'au-1', decision: 'COMPRAR', decision_id: null, director_estado: 'ok', director_analisis_id: 'di-1',
      estado_final: 'completada', motivos: [], datos_vencidos: [],
    });
    expect(r.fila_historial.referencias).toMatchObject({ posicion: 'GKOS:PMP', autorizacion_usuario: null });
    expect(r.fila_historial.resultados_agentes).toEqual([
      { agente: 'fundamental', estado: 'ok', analisis_id: 'an-fundamental', reintentos: 0 },
      { agente: 'valuacion', estado: 'ok', analisis_id: 'an-valuacion', reintentos: 0 },
      { agente: 'tecnico', estado: 'ok', analisis_id: 'an-tecnico', reintentos: 0 },
      { agente: 'riesgo_capital', estado: 'ok', analisis_id: 'an-riesgo_capital', reintentos: 0 },
    ]);
  });
  it('las versiones de parámetros que se usaron van al Motor y la fecha de evaluación es la de Ciudad de México', async () => {
    const r = corrida(await ejecutarCorrida(sol(), datos(), puertos().p));
    expect(r.entrada_motor.parametros_versiones).toEqual([{ clave: 'orquestador.margen_cierre_velas', version: 1 }, { clave: 'frescura.precio', version: 1 }]);
    expect(r.entrada_motor.fecha_evaluacion).toBe('2026-10-22');
    expect(r.entrada_motor.snapshot_id).toBe('snap-1');
    expect(r.entrada_motor.corrida_id).toBe('run-1');
  });
  it('orden: primero los analistas, luego el Auditor y al final el Director', async () => {
    const x = puertos();
    await ejecutarCorrida(sol(), datos(), x.p);
    expect(x.log.slice(0, 4).sort()).toEqual(['analista:fundamental', 'analista:riesgo_capital', 'analista:tecnico', 'analista:valuacion']);
    expect(x.log.slice(4)).toEqual(['auditor', 'director']);
  });
  it('independencia: cada analista recibe solo su sobre; el Técnico suma el resultado de código; ninguno ve las salidas de otros', async () => {
    const x = puertos();
    await ejecutarCorrida(sol(), datos(), x.p);
    expect(x.sobres.fundamental).toEqual({ f: 1 });
    expect(x.sobres.valuacion).toEqual({ v: 1 });
    expect(x.sobres.riesgo_capital).toEqual({ r: 1 });
    expect(x.sobres.tecnico).toMatchObject({ t: 1, tecnico_codigo: { estado: expect.stringMatching(/completo|parcial/) } });
    expect(Object.keys(x.sobres.tecnico as object).sort()).toEqual(['t', 'tecnico_codigo']);
  });
  it('el Director recibe las salidas de los analistas y el resultado del Auditor, nada más del Motor', async () => {
    const x = puertos();
    await ejecutarCorrida(sol(), datos(), x.p);
    expect(x.directorCtx()).toMatchObject({
      run_id: 'run-1', snapshot_id: 'snap-1', ticker: 'GKOS', portafolio_codigo: 'PMP', tipo_evaluacion: 'nueva_posicion',
      salidas_analistas: { fundamental: { de: 'fundamental' }, valuacion: { de: 'valuacion' }, tecnico: { de: 'tecnico' }, riesgo_capital: { de: 'riesgo_capital' } },
      auditoria: { veredicto: 'CUMPLE', reglas_revisadas: ['PMP-01'] }, reglas_versiones_ids: ['r1', 'r2'], contexto: { watchlist: 'x' },
    });
  });
  it('registro de ejecuciones: una fila por analista, Auditor y Director, con el run_id y el contexto de la corrida', async () => {
    const r = corrida(await ejecutarCorrida(sol(), datos(), puertos().p));
    expect(r.ejecuciones.map(x => x.agente)).toEqual(['fundamental', 'valuacion', 'tecnico', 'riesgo_capital', 'auditor', 'director']);
    for (const x of r.ejecuciones) {
      expect(x).toMatchObject({ run_id: 'run-1', estado: 'ok', reintentos: 0, ticker: 'GKOS', portafolio_codigo: 'PMP', tipo_evaluacion: 'nueva_posicion', disparador: 'usuario', expediente_id: 'exp-1' });
      expect(Date.parse(x.finished_at)).toBeGreaterThanOrEqual(Date.parse(x.started_at));
    }
  });
  it('los tiempos de la fila salen del reloj de los puertos: iniciada la primera lectura, finalizada la última', async () => {
    const r = corrida(await ejecutarCorrida(sol(), datos(), puertos().p));
    expect(r.fila_historial.iniciada_at).toBe('2026-10-22T14:00:00Z');
    expect(Date.parse(r.fila_historial.finalizada_at)).toBeGreaterThan(Date.parse(r.fila_historial.iniciada_at));
  });
  it('el resultado del Técnico de código queda en referencias.tecnico (incluye la racha de Mogalef para la corrida siguiente)', async () => {
    const r = corrida(await ejecutarCorrida(sol(), datos(), puertos().p));
    expect(r.fila_historial.referencias.tecnico).toMatchObject({ ultima_vela_diaria: '2026-10-21', margen_cierre_minutos: 30 });
  });
  it('un corrida_previa_id y el expediente nulo se conservan tal cual', async () => {
    const r = corrida(await ejecutarCorrida(sol(), datos({ corrida_previa_id: 'run-0', expediente_id: null }), puertos().p));
    expect(r.fila_historial).toMatchObject({ corrida_previa_id: 'run-0', expediente_id: null });
  });
});

describe('reintentos y fallas de analistas', () => {
  it('un analista que falla una vez y responde en el reintento queda ok con reintentos = 1', async () => {
    const x = puertos({ analista: (a, _s, i) => (a === 'valuacion' && i === 1 ? { estado: 'error', error: 'salida inválida' } : { estado: 'ok', analisis_id: `an-${a}`, veredicto: VEREDICTO[a] }) });
    const r = corrida(await ejecutarCorrida(sol(), datos(), x.p));
    expect(x.intentos.valuacion).toBe(2);
    expect(r.fila_historial.resultados_agentes.find(a => a.agente === 'valuacion')).toMatchObject({ estado: 'ok', reintentos: 1 });
    expect(r.salida_motor.decision).toBe('COMPRAR');
  });
  it('una excepción del puerto cuenta como error y se reintenta', async () => {
    const x = puertos({ analista: (a, _s, i) => { if (a === 'fundamental' && i === 1) throw new Error('timeout'); return { estado: 'ok', analisis_id: 'x', veredicto: VEREDICTO[a] }; } });
    const r = corrida(await ejecutarCorrida(sol(), datos(), x.p));
    expect(x.intentos.fundamental).toBe(2);
    expect(r.fila_historial.resultados_agentes[0]).toMatchObject({ estado: 'ok', reintentos: 1 });
  });
  it('tras el reintento sigue fallando: error registrado, NO_EVALUABLE, corrida incompleta con agente_requerido_fallo (no se inventa el análisis)', async () => {
    const x = puertos({ analista: (a) => (a === 'valuacion' ? { estado: 'error', error: 'sin respuesta' } : { estado: 'ok', analisis_id: `an-${a}`, veredicto: VEREDICTO[a] }) });
    const r = corrida(await ejecutarCorrida(sol(), datos(), x.p));
    expect(x.intentos.valuacion).toBe(2);                         // 1 intento + 1 reintento, no más
    expect(r.fila_historial.resultados_agentes.find(a => a.agente === 'valuacion')).toMatchObject({ estado: 'error', reintentos: 1, error: 'sin respuesta' });
    expect(r.salida_motor.decision).toBe('NO_EVALUABLE');
    expect(r.fila_historial).toMatchObject({ estado_final: 'incompleta', decision: 'NO_EVALUABLE' });
    expect(r.fila_historial.motivos.map(m => m.codigo)).toContain('agente_requerido_fallo');
    const ej = r.ejecuciones.find(e => e.agente === 'valuacion')!;
    expect(ej).toMatchObject({ estado: 'error', reintentos: 1, error: 'sin respuesta' });
  });
  it('un analista que falla no impide que los demás corran ni que el Motor reciba la entrega', async () => {
    const x = puertos({ analista: () => { throw new Error('caído'); } });
    const r = corrida(await ejecutarCorrida(sol(), datos(), x.p));
    expect(x.log.filter(l => l.startsWith('analista:'))).toHaveLength(8);       // 4 agentes x 2 intentos
    expect(x.log).toContain('auditor');
    expect(r.salida_motor.decision).toBe('NO_EVALUABLE');
  });
  it('un analista con veredicto NO_EVALUABLE llega al Motor como dato faltante', async () => {
    const x = puertos({ analista: (a) => ({ estado: 'ok', analisis_id: `an-${a}`, veredicto: a === 'fundamental' ? 'NO_EVALUABLE' : VEREDICTO[a] }) });
    const r = corrida(await ejecutarCorrida(sol(), datos(), x.p));
    expect(r.salida_motor.decision).toBe('NO_EVALUABLE');
    expect(r.fila_historial.estado_final).toBe('pendiente_informacion');
  });
});

describe('Auditor y Director', () => {
  it('BLOQUEO_REGLA: BLOQUEADO y corrida bloqueada', async () => {
    const x = puertos({ auditor: () => ({ estado: 'ok', veredicto: 'BLOQUEO_REGLA', analisis_id: 'au-2', reglas_revisadas: ['PMP-03'] }) });
    const r = corrida(await ejecutarCorrida(sol(), datos(), x.p));
    expect(r.fila_historial).toMatchObject({ decision: 'BLOQUEADO', estado_final: 'bloqueada', auditoria_veredicto: 'BLOQUEO_REGLA', auditoria_analisis_id: 'au-2' });
    expect(r.fila_historial.motivos.map(m => m.codigo)).toContain('auditor_bloqueo');
  });
  it('el Auditor falla: no hay auditoría, el Motor responde NO_EVALUABLE y la ejecución queda como error (sin reintento)', async () => {
    let llamadas = 0;
    const x = puertos({ auditor: () => { llamadas++; return { estado: 'error', error: 'reglas no disponibles' }; } });
    const r = corrida(await ejecutarCorrida(sol(), datos(), x.p));
    expect(llamadas).toBe(1);
    expect(r.entrada_motor.auditoria).toBeNull();
    expect(r.fila_historial).toMatchObject({ decision: 'NO_EVALUABLE', auditoria_veredicto: null, auditoria_analisis_id: null });
    expect(r.ejecuciones.find(e => e.agente === 'auditor')).toMatchObject({ estado: 'error', error: 'reglas no disponibles', reintentos: 0 });
  });
  it('un Auditor que lanza una excepción o devuelve un veredicto desconocido o ausente se trata como falla', async () => {
    for (const cfg of [
      { auditor: (): RespuestaAuditor => { throw new Error('boom'); } },
      { auditor: (): RespuestaAuditor => ({ estado: 'ok', veredicto: 'TAL_VEZ' as never }) },
      { auditor: (): RespuestaAuditor => ({ estado: 'ok' }) },
    ]) {
      const r = corrida(await ejecutarCorrida(sol(), datos(), puertos(cfg).p));
      expect(r.entrada_motor.auditoria).toBeNull();
      expect(r.salida_motor.decision).toBe('NO_EVALUABLE');
      expect(r.ejecuciones.find(e => e.agente === 'auditor')!.estado).toBe('error');
    }
  });
  it('NO_ELEGIBLE del Auditor llega al Motor tal cual', async () => {
    const x = puertos({ auditor: () => ({ estado: 'ok', veredicto: 'NO_ELEGIBLE', reglas_revisadas: ['PMP-01'] }) });
    const r = corrida(await ejecutarCorrida(sol(), datos(), x.p));
    expect(r.salida_motor.decision).toBe('NO_COMPRAR');
    expect(r.fila_historial.auditoria_veredicto).toBe('NO_ELEGIBLE');
  });
  it('el Director falla tras su reintento: la decisión del Motor se conserva y la corrida queda incompleta', async () => {
    const x = puertos({ director: () => ({ estado: 'error', error: 'fallo' }) });
    const r = corrida(await ejecutarCorrida(sol(), datos(), x.p));
    expect(x.log.filter(l => l === 'director')).toHaveLength(2);
    expect(r.fila_historial).toMatchObject({ decision: 'COMPRAR', estado_final: 'incompleta', director_estado: 'error' });
    expect(r.fila_historial.motivos.map(m => m.codigo)).toContain('director_fallo');
  });
  it('el Director falla una vez y responde en el reintento: ok', async () => {
    let n = 0;
    const x = puertos({ director: () => (++n === 1 ? { estado: 'error', error: 'x' } : { estado: 'ok', analisis_id: 'di-9' }) });
    const r = corrida(await ejecutarCorrida(sol(), datos(), x.p));
    expect(r.fila_historial).toMatchObject({ director_estado: 'ok', director_analisis_id: 'di-9', estado_final: 'completada' });
    expect(r.ejecuciones.find(e => e.agente === 'director')!.reintentos).toBe(1);
  });
  it('el Director no se llama si el Auditor ya bloqueó? Sí se llama (C1/C2): ve el resultado del Auditor y no puede anular el veto', async () => {
    const x = puertos({ auditor: () => ({ estado: 'ok', veredicto: 'BLOQUEO_REGLA', reglas_revisadas: [] }) });
    const r = corrida(await ejecutarCorrida(sol(), datos(), x.p));
    expect(x.log).toContain('director');
    expect(r.salida_motor.decision).toBe('BLOQUEADO');
  });
});

describe('agentes opcionales: solo por petición expresa', () => {
  const posAbierta = (extra: Record<string, unknown> = {}) => sol({ tipo_evaluacion: 'posicion_abierta', ...extra });
  const datosPos = (extra: Partial<DatosCongelados> = {}) => datos({ posicion_existe: true, ...extra });
  it('PMP posición abierta: solo Fundamental (R); los opcionales no corren', async () => {
    const x = puertos();
    const r = corrida(await ejecutarCorrida(posAbierta(), datosPos(), x.p));
    expect(x.log.filter(l => l.startsWith('analista:'))).toEqual(['analista:fundamental']);
    expect(r.fila_historial.agentes_requeridos).toEqual(['fundamental']);
  });
  it('pedido expreso: el opcional corre y queda en resultados_agentes, pero no es requerido', async () => {
    const x = puertos();
    const r = corrida(await ejecutarCorrida(posAbierta(), datosPos(), x.p, { agentes_opcionales: ['valuacion'] }));
    expect(x.log.filter(l => l.startsWith('analista:')).sort()).toEqual(['analista:fundamental', 'analista:valuacion']);
    expect(r.fila_historial.agentes_requeridos).toEqual(['fundamental']);
    expect(r.fila_historial.resultados_agentes.map(a => a.agente)).toEqual(['fundamental', 'valuacion']);
  });
  it('la falla de un opcional no vuelve incompleta la corrida', async () => {
    const x = puertos({ analista: (a) => (a === 'valuacion' ? { estado: 'error', error: 'x' } : { estado: 'ok', analisis_id: `an-${a}`, veredicto: VEREDICTO[a] }) });
    const r = corrida(await ejecutarCorrida(posAbierta(), datosPos(), x.p, { agentes_opcionales: ['valuacion'] }));
    expect(r.fila_historial.motivos.map(m => m.codigo)).not.toContain('agente_requerido_fallo');
  });
  it('pedir un agente que no es opcional para ese caso no lo activa y deja un aviso', async () => {
    const x = puertos();
    const r = corrida(await ejecutarCorrida(sol({ portafolio_codigo: 'PCP' }), datos(), x.p, { agentes_opcionales: ['valuacion', 'tecnico'] }));
    expect(x.log).not.toContain('analista:valuacion');                               // PCP abrir: valuación no interviene
    expect(r.avisos.join('|')).toContain('valuacion no es opcional');
    expect(r.avisos.join('|')).not.toContain('tecnico no es opcional');             // ya es requerido
  });
});

describe('coherencia con la posición real (tabla 1.3b)', () => {
  it('coherenciaPosicion: nueva con posición existente, recompra/posición abierta/revisión sin posición y sin confirmar', () => {
    expect(coherenciaPosicion('nueva_posicion', false).confirmada).toBe(true);
    expect(coherenciaPosicion('nueva_posicion', true).confirmada).toBe(false);
    for (const tp of ['recompra', 'posicion_abierta', 'revision_tesis'] as const) {
      expect(coherenciaPosicion(tp, true).confirmada).toBe(true);
      expect(coherenciaPosicion(tp, false).confirmada).toBe(false);
    }
    for (const tp of ['nueva_posicion', 'recompra', 'posicion_abierta', 'revision_tesis', 'aporte_periodico', 'revision_anual_etf', 'retiro_quinquenal'] as const) {
      const r = coherenciaPosicion(tp, null);
      expect(r.confirmada).toBe(false);
      expect(r.inconsistencia).toContain('no permite confirmar');
    }
    for (const tp of ['aporte_periodico', 'revision_anual_etf', 'retiro_quinquenal'] as const) {
      expect(coherenciaPosicion(tp, true).confirmada).toBe(true);
      expect(coherenciaPosicion(tp, false).confirmada).toBe(true);
    }
  });
  it('nueva_posicion con una posición ya existente: no se asume compra inicial; corrida pendiente_informacion con posicion_no_confirmada y la inconsistencia guardada', async () => {
    const r = corrida(await ejecutarCorrida(sol(), datos({ posicion_existe: true }), puertos().p));
    expect(r.salida_motor.decision).toBe('NO_EVALUABLE');
    expect(r.fila_historial.estado_final).toBe('pendiente_informacion');
    expect(r.fila_historial.motivos.map(m => m.codigo)).toContain('posicion_no_confirmada');
    expect(r.fila_historial.referencias.posicion_inconsistencia).toContain('ya existe una posición');
  });
  it('el registro no permite confirmar (null): pendiente_informacion y el Motor igual recibe la entrega', async () => {
    const r = corrida(await ejecutarCorrida(sol(), datos({ posicion_existe: null }), puertos().p));
    expect(r.entrada_motor.posicion_confirmada).toBe(false);
    expect(r.fila_historial.estado_final).toBe('pendiente_informacion');
    expect(r.fila_historial.referencias.posicion_inconsistencia).toContain('no permite confirmar');
  });
  it('recompra sin posición: inconsistente', async () => {
    const r = corrida(await ejecutarCorrida(sol({ tipo_evaluacion: 'recompra' }), datos({ posicion_existe: false }), puertos().p));
    expect(r.fila_historial.motivos.map(m => m.codigo)).toContain('posicion_no_confirmada');
  });
  it('sin inconsistencia no se escribe posicion_inconsistencia', async () => {
    const r = corrida(await ejecutarCorrida(sol(), datos(), puertos().p));
    expect('posicion_inconsistencia' in r.fila_historial.referencias).toBe(false);
  });
});

describe('Técnico en la corrida: momento, frescura y parámetros', () => {
  const pcp = (extra: Record<string, unknown> = {}) => sol({ portafolio_codigo: 'PCP', ...extra });
  const datosPcp = (extra: Partial<DatosCongelados> = {}) => datos({
    sobres: { tecnico: { t: 1 }, riesgo_capital: { r: 1 } }, ...extra,
  });
  it('PCP apertura: el detonante sale del Técnico (apertura_pcp). Precio en caída fuerte: RSI sobrevendido, detonante confirmado', async () => {
    const r = corrida(await ejecutarCorrida(pcp(), datosPcp({ velas: velas(baja), motor: { capital: { efectivo_disponible: '100', monto_requerido: '25', veredicto_riesgo: 'VIABLE' }, tesis_estado: 'intacta', monto_operacion: '25' } }), puertos().p));
    expect(r.entrada_motor.momento).toEqual({ detonante_confirmado: true });
    expect(r.salida_motor.decision).toBe('COMPRAR');
  });
  const dineroPcp = { capital: { efectivo_disponible: '100', monto_requerido: '25', veredicto_riesgo: 'VIABLE' as const }, tesis_estado: 'intacta' as const, monto_operacion: '25' };
  it('PCP recompra sin ninguna señal del Técnico: detonante false y el Motor responde ESPERAR (falta el detonante)', async () => {
    const r = corrida(await ejecutarCorrida(pcp({ tipo_evaluacion: 'recompra' }), datosPcp({ velas: velas(sinSenal), posicion_existe: true, motor: dineroPcp }), puertos().p));
    expect(r.entrada_motor.momento).toEqual({ detonante_confirmado: false });
    expect(r.salida_motor.decision).toBe('ESPERAR');
  });
  it('el momento de PCP lo manda el Técnico: un detonante entregado a mano en datos.motor se ignora', async () => {
    const r = corrida(await ejecutarCorrida(pcp({ tipo_evaluacion: 'recompra' }), datosPcp({ velas: velas(sinSenal), posicion_existe: true, motor: { ...dineroPcp, momento: { detonante_confirmado: true } } }), puertos().p));
    expect(r.entrada_motor.momento).toEqual({ detonante_confirmado: false });
    expect(r.salida_motor.decision).toBe('ESPERAR');
  });
  it('cada caso usa su propio uso del detonante: con una serie que cumple apertura_pcp y dca_plp pero no recompra_pcp', async () => {
    const a = corrida(await ejecutarCorrida(pcp(), datosPcp({ velas: velas(sinSenal), motor: dineroPcp }), puertos().p));
    expect(a.entrada_motor.momento).toEqual({ detonante_confirmado: true });          // PCP apertura -> apertura_pcp
    const b = corrida(await ejecutarCorrida(sol({ portafolio_codigo: 'PLP', tipo_evaluacion: 'recompra' }), datos({ velas: velas(sinSenal), posicion_existe: true, motor: dineroPcp }), puertos().p));
    expect(b.entrada_motor.momento).toEqual({ detonante_confirmado: true });          // PLP recompra -> dca_plp
    const c = corrida(await ejecutarCorrida(pcp({ tipo_evaluacion: 'recompra' }), datosPcp({ velas: velas(sinSenal), posicion_existe: true, motor: dineroPcp }), puertos().p));
    expect(c.entrada_motor.momento).toEqual({ detonante_confirmado: false });         // PCP recompra -> recompra_pcp
  });
  it('PCP recompra usa recompra_pcp y PLP recompra usa dca_plp', async () => {
    const base = { velas: velas(baja), posicion_existe: true, motor: { capital: { efectivo_disponible: '100', monto_requerido: '25', veredicto_riesgo: 'VIABLE' as const }, tesis_estado: 'intacta' as const, monto_operacion: '25' } };
    const a = corrida(await ejecutarCorrida(pcp({ tipo_evaluacion: 'recompra' }), datosPcp(base), puertos().p));
    expect(a.entrada_motor.momento).toEqual({ detonante_confirmado: true });
    const x = puertos();
    const b = corrida(await ejecutarCorrida(sol({ portafolio_codigo: 'PLP', tipo_evaluacion: 'recompra' }), datos(base), x.p));
    expect(b.entrada_motor.momento).toEqual({ detonante_confirmado: true });
    expect(x.log).not.toContain('analista:tecnico');          // el agente Técnico de PLP es opcional y no se pidió; el cálculo de código sí corre (C10)
    expect(b.tecnico).not.toBeNull();
  });
  it('PMP no tiene detonante del Técnico: se usa el momento que entrega el llamador; sin él, el Motor responde ESPERAR', async () => {
    const sinMomento = datos({ motor: { capital: { efectivo_disponible: '100', monto_requerido: '50', veredicto_riesgo: 'VIABLE' }, tesis_estado: 'intacta', monto_operacion: '50' } });
    const r = corrida(await ejecutarCorrida(sol(), sinMomento, puertos().p));
    expect(r.entrada_motor.momento).toBeUndefined();
    expect(r.salida_motor.decision).toBe('ESPERAR');
    const conMomento = corrida(await ejecutarCorrida(sol(), datos(), puertos().p));
    expect(conMomento.entrada_motor.momento).toEqual({ detonante_confirmado: true });
  });
  it('la condición de ejecución del llamador se conserva junto al detonante del Técnico', async () => {
    const r = corrida(await ejecutarCorrida(pcp(), datosPcp({ velas: velas(baja), motor: { condicion_ejecucion: 'cierre sobre 10', capital: { efectivo_disponible: '100', monto_requerido: '25', veredicto_riesgo: 'VIABLE' }, tesis_estado: 'intacta', monto_operacion: '25' } }), puertos().p));
    expect(r.entrada_motor.momento).toEqual({ detonante_confirmado: true, condicion_ejecucion: 'cierre sobre 10' });
  });
  it('precio vencido (22-oct): llega al Motor como datos_faltantes con su causa; la corrida queda pendiente_informacion y datos_vencidos sigue vacío', async () => {
    const r = corrida(await ejecutarCorrida(sol(), datos({ velas: velas(ondulado, '2026-10-19') }), puertos().p));
    expect(r.entrada_motor.datos_vencidos).toEqual([]);
    expect(r.entrada_motor.datos_faltantes.join('|')).toContain('precio_desactualizado');
    expect(r.salida_motor.decision).toBe('NO_EVALUABLE');
    expect(r.fila_historial.estado_final).toBe('pendiente_informacion');
    expect(r.fila_historial.datos_vencidos).toEqual([]);
    expect(r.fila_historial.referencias.datos_faltantes_detalle).toEqual([expect.objectContaining({ motivo: 'precio_desactualizado', estado_dato: 'vencido', umbral_frescura: '1 día hábil' })]);
  });
  it('sin velas congeladas: el Técnico no se calcula y se declara (no se supone nada)', async () => {
    const r = corrida(await ejecutarCorrida(sol(), datos({ velas: null }), puertos().p));
    expect(r.tecnico).toBeNull();
    expect(r.entrada_motor.datos_faltantes).toContain('tecnico: no hay velas congeladas en el snapshot');
    expect(r.salida_motor.decision).toBe('NO_EVALUABLE');
  });
  it('margen de cierre inválido en oficina_parametros: NO se sustituye por la constante; el Técnico no se calcula y se declara', async () => {
    const malos = [{ clave: 'orquestador.margen_cierre_velas', valor: { valor: 'x', unidad: 'minutos' }, version: 2, vigente_desde: '2026-10-22' }, PARAMS[1]!];
    const r = corrida(await ejecutarCorrida(sol(), datos({ parametros: malos }), puertos().p));
    expect(r.tecnico).toBeNull();
    expect(r.entrada_motor.datos_faltantes.join('|')).toContain('orquestador.margen_cierre_velas es inválido');
    expect(r.avisos.join('|')).toContain('parametro_invalido');
    expect(r.fila_historial.referencias.avisos).toBeDefined();
  });
  it('sin fila del margen se usa la constante (origen «constante») y la corrida sigue', async () => {
    const r = corrida(await ejecutarCorrida(sol(), datos({ parametros: [PARAMS[1]!] }), puertos().p));
    expect(r.tecnico).not.toBeNull();
    expect(r.salida_motor.decision).toBe('COMPRAR');
  });
  it('la racha previa del ticker se pasa al Técnico: la misma activación ya registrada no se vuelve a registrar', async () => {
    const salto: Precio = i => (i < 299 ? 100 + Math.sin(i / 3) : 140);               // la última vela rompe la banda superior de Mogalef
    const sin = corrida(await ejecutarCorrida(pcp(), datosPcp({ velas: velas(salto), motor: dineroPcp }), puertos().p));
    expect(sin.tecnico!.racha_mogalef_superior!.estado).toBe('nueva_activacion');
    const con = corrida(await ejecutarCorrida(pcp(), datosPcp({ velas: velas(salto), racha_previa: { fecha_inicio: '2026-10-21', dias: 1, activacion_registrada: true }, motor: dineroPcp }), puertos().p));
    expect(con.tecnico!.racha_mogalef_superior!.estado).toBe('ya_registrada');
  });
  it('la fecha de evaluación es la de Ciudad de México, no la de UTC (03:00Z del 23 es 21:00 del 22)', async () => {
    const r = corrida(await ejecutarCorrida(sol(), datos(), puertos({}, '2026-10-23T03:00:00Z').p));
    expect(r.entrada_motor.fecha_evaluacion).toBe('2026-10-22');
  });
  it('datos vencidos y faltantes que entrega el llamador (ratios, estados financieros...) llegan al Motor y a la fila', async () => {
    const r = corrida(await ejecutarCorrida(sol(), datos({ datos_vencidos: ['ratios: 2 trimestres'], datos_faltantes: ['estados_financieros: no disponible'] }), puertos().p));
    expect(r.entrada_motor.datos_vencidos).toEqual(['ratios: 2 trimestres']);
    expect(r.entrada_motor.datos_faltantes).toContain('estados_financieros: no disponible');
    expect(r.fila_historial.datos_vencidos).toEqual(['ratios: 2 trimestres']);
    expect(r.fila_historial.motivos.map(m => m.codigo)).toContain('snapshot_vencido');
    expect(r.salida_motor.decision).toBe('NO_EVALUABLE');
  });
});

describe('salida del PCP', () => {
  const posPcp = (extra: Partial<DatosCongelados> = {}) => datos({
    posicion_existe: true, sobres: { tecnico: { t: 1 } },
    salida_pcp: { plan: 'una_compra', compras: [{ cantidad: '1', precio: '50' }], precio_actual: '300', stop: null, primera_salida_realizada: false },
    motor: { tesis_estado: 'intacta' }, ...extra,
  });
  const solPcp = () => sol({ portafolio_codigo: 'PCP', tipo_evaluacion: 'posicion_abierta' });
  it('señal de salida del Técnico + una compra: VENDER 100% (PCP-06), pendiente de autorización', async () => {
    const r = corrida(await ejecutarCorrida(solPcp(), posPcp({ velas: velas(sube) }), puertos().p));
    expect(r.tecnico!.senal_salida).toBe(true);
    expect(r.entrada_motor.salida!.exigida).toMatchObject({ decision: 'VENDER', porcentaje: 100, regla: 'PCP-06' });
    expect(r.salida_motor).toMatchObject({ decision: 'VENDER', requiere_autorizacion: true });
    expect(r.fila_historial.ruta).toBe('posicion_abierta');
  });
  it('sin señal de salida y sin stop tocado: no hay salida exigida', async () => {
    const r = corrida(await ejecutarCorrida(solPcp(), posPcp({ velas: velas(baja), salida_pcp: { plan: 'una_compra', compras: [{ cantidad: '1', precio: '50' }], precio_actual: '300', stop: null, primera_salida_realizada: false } }), puertos().p));
    expect(r.tecnico!.senal_salida).toBe(false);
    expect(r.entrada_motor.salida!.exigida).toBeNull();
  });
  it('señal de salida no evaluable (null): no se evalúa la salida, no se supone false y se declara', async () => {
    const r = corrida(await ejecutarCorrida(solPcp(), posPcp({ velas: null }), puertos().p));
    expect(r.entrada_motor.salida).toBeUndefined();
    expect(r.entrada_motor.datos_faltantes.join('|')).toContain('senal_salida_pcp');
  });
  it('solo aplica a PCP posición abierta: en PMP no se evalúa la salida con el detonante del Técnico', async () => {
    const r = corrida(await ejecutarCorrida(sol({ tipo_evaluacion: 'posicion_abierta' }), posPcp({ velas: velas(sube) }), puertos().p, { agentes_opcionales: ['tecnico'] }));   // trae salida_pcp y Técnico, pero el portafolio es PMP
    expect(r.tecnico!.senal_salida).toBe(true);
    expect(r.entrada_motor.salida).toBeUndefined();
    expect(r.entrada_motor.datos_faltantes.join('|')).not.toContain('senal_salida_pcp');
  });
  it('el contexto de salida del llamador (stop tocado, solo referencia) se conserva y se completa con la salida exigida', async () => {
    const r = corrida(await ejecutarCorrida(solPcp(), posPcp({ velas: velas(sube), motor: { tesis_estado: 'intacta', salida: { stop_tocado: true, stop_efecto: 'zona_recompra' } } }), puertos().p));
    expect(r.entrada_motor.salida).toMatchObject({ stop_tocado: true, stop_efecto: 'zona_recompra', exigida: { decision: 'VENDER' } });
  });
});

describe('ruta determinista (ETF): sin analistas de IA ni Director; el aporte lo calcula el Orquestador', () => {
  const aporte_semanal = { efectivo_disponible: '10', etfs_sectoriales: 4, duplicado: false };
  const solEtf = (extra: Record<string, unknown> = {}) => sol({ portafolio_codigo: 'ETF', ticker: 'xlk', tipo_evaluacion: 'aporte_periodico', ...extra });
  const dEtf = (extra: Partial<DatosCongelados> = {}) => datos({ velas: null, posicion_existe: true, sobres: {}, aporte_semanal, motor: {}, ...extra });
  it('aporte: ningún analista ni el Director se llaman; solo el Auditor; Director no_aplica; COMPRAR USD 2', async () => {
    const x = puertos();
    const r = corrida(await ejecutarCorrida(solEtf(), dEtf(), x.p));
    expect(x.log).toEqual(['auditor']);
    expect(r.fila_historial).toMatchObject({ ruta: 'determinista', director_estado: 'no_aplica', director_analisis_id: null, decision: 'COMPRAR', estado_final: 'completada', agentes_requeridos: ['riesgo_capital'] });
    expect(r.fila_historial.resultados_agentes).toEqual([{ agente: 'riesgo_capital', estado: 'ok', analisis_id: null, reintentos: 0 }]);
    expect(r.ejecuciones.map(e => e.agente)).toEqual(['auditor']);
    expect(r.entrada_motor.aporte).toEqual({ monto: '2', monto_requerido: '8', monto_reducido: null, efectivo_disponible: '10', duplicado: false, elegibilidad_verificable: true });
    expect(r.salida_motor.detalle_portafolio.monto).toBe('2');
  });
  it('tres niveles: USD 2 por ETF si alcanza, USD 1 por ETF si no, ninguno si ni eso', async () => {
    const con = async (e: string) => corrida(await ejecutarCorrida(solEtf(), dEtf({ aporte_semanal: { ...aporte_semanal, efectivo_disponible: e } }), puertos().p));
    const c = await con('8');
    expect(c.salida_motor.decision).toBe('COMPRAR');
    expect(c.salida_motor.detalle_portafolio.monto).toBe('2');
    expect(c.fila_historial.referencias).toMatchObject({ aporte_modo: 'completo' });
    const r = await con('7.99');
    expect(r.salida_motor.decision).toBe('COMPRAR');
    expect(r.salida_motor.detalle_portafolio.monto).toBe('1');
    expect(r.fila_historial.referencias).toMatchObject({ aporte_modo: 'reducido' });
    const n = await con('3.99');
    expect(n.salida_motor.decision).toBe('NO_COMPRAR');
    expect(n.fila_historial.referencias).toMatchObject({ aporte_modo: 'ninguno' });
  });
  it('aporte duplicado: NO_COMPRAR', async () => {
    const r = corrida(await ejecutarCorrida(solEtf(), dEtf({ aporte_semanal: { ...aporte_semanal, duplicado: true } }), puertos().p));
    expect(r.salida_motor.decision).toBe('NO_COMPRAR');
  });
  it('sin datos del aporte, ETFs inválidos o duplicado sin verificar: NO_EVALUABLE, requerido ausente o aviso, sin inventar', async () => {
    const sin = corrida(await ejecutarCorrida(solEtf(), dEtf({ aporte_semanal: undefined }), puertos().p));
    expect(sin.fila_historial.resultados_agentes).toEqual([{ agente: 'riesgo_capital', estado: 'ausente', analisis_id: null, reintentos: 0 }]);
    expect(sin.salida_motor.decision).toBe('NO_EVALUABLE');
    expect(sin.avisos.join()).toContain('aporte_semanal');
    const dup = corrida(await ejecutarCorrida(solEtf(), dEtf({ aporte_semanal: { ...aporte_semanal, duplicado: null } }), puertos().p));
    expect(dup.salida_motor.decision).toBe('NO_EVALUABLE');
    const mal = corrida(await ejecutarCorrida(solEtf(), dEtf({ aporte_semanal: { ...aporte_semanal, etfs_sectoriales: 0 } }), puertos().p));
    expect(mal.salida_motor.decision).toBe('NO_EVALUABLE');
    expect(mal.entrada_motor.aporte).toBeUndefined();
  });
  it('un motor.aporte entregado por el llamador se ignora con aviso: manda el cálculo del Orquestador', async () => {
    const falso = { monto: '99', monto_requerido: '99', monto_reducido: null, efectivo_disponible: '1000', duplicado: false, elegibilidad_verificable: true };
    const r = corrida(await ejecutarCorrida(solEtf(), dEtf({ motor: { aporte: falso } }), puertos().p));
    expect(r.entrada_motor.aporte!.monto).toBe('2');
    expect(r.avisos.join()).toContain('motor.aporte ignorado');
  });
  it('revisión anual y retiro quinquenal: sin agentes requeridos', async () => {
    const x = puertos();
    const r = corrida(await ejecutarCorrida(solEtf({ tipo_evaluacion: 'revision_anual_etf' }), dEtf({ aporte_semanal: undefined, motor: { revision_etf: { comparable: true, supera_spy: true, fallo_anterior: false } } }), x.p));
    expect(x.log).toEqual(['auditor']);
    expect(r.fila_historial).toMatchObject({ agentes_requeridos: [], resultados_agentes: [], decision: 'MANTENER' });
    expect(r.avisos).toEqual([]);
    const q = corrida(await ejecutarCorrida(solEtf({ tipo_evaluacion: 'retiro_quinquenal' }), dEtf({ aporte_semanal: undefined, motor: { retiro: { datos_completos: true, porcentaje: 50 } } }), puertos().p));
    expect(q.salida_motor).toMatchObject({ decision: 'REDUCIR', requiere_autorizacion: true });
  });
  it('el Técnico de código no se calcula en la ruta determinista aunque haya velas', async () => {
    const r = corrida(await ejecutarCorrida(solEtf(), dEtf({ velas: velas() }), puertos().p));
    expect(r.tecnico).toBeNull();
  });
});

describe('reglas estructurales: PLP abrir y Semilla recompra (23-oct)', () => {
  const solPlp = () => sol({ portafolio_codigo: 'PLP', ticker: 'abc' });
  const solSem = () => sol({ portafolio_codigo: 'SEMILLA', tipo_evaluacion: 'recompra' });
  it('PLP nueva_posicion: BLOQUEADO sin llamar a ningún agente; bloqueo generado por código con la regla PLP-02', async () => {
    const x = puertos();
    const r = corrida(await ejecutarCorrida(solPlp(), datos(), x.p));
    expect(x.log).toEqual([]);
    expect(r.fila_historial).toMatchObject({
      decision: 'BLOQUEADO', estado_final: 'bloqueada', auditoria_veredicto: 'BLOQUEO_REGLA', auditoria_analisis_id: null, director_estado: 'no_aplica',
      agentes_requeridos: [], resultados_agentes: [], portafolio_codigo: 'PLP',
    });
    expect(r.fila_historial.referencias).toMatchObject({ bloqueo_estructural: { regla: 'PLP-02' }, autorizacion_usuario: null });
    expect(r.salida_motor.requiere_autorizacion).toBe(false);
    expect(r.entrada_motor.auditoria).toEqual({ veredicto: 'BLOQUEO_REGLA', reglas_revisadas: ['PLP-02'] });
    expect(r.ejecuciones).toHaveLength(1);
    expect(r.ejecuciones[0]).toMatchObject({ agente: 'orquestador', estado: 'ok', entradas: { resultado: 'BLOQUEADO', motivo: 'bloqueo_estructural', regla: 'PLP-02' } });
  });
  it('PLP con sustitución autorizada: no se bloquea, pero tampoco se inventa una fila de agentes: pendiente_informacion con la autorización registrada', async () => {
    const x = puertos();
    const r = await ejecutarCorrida(solPlp(), datos({ sustitucion_autorizada: { regla: 'PLP-09', autorizacion_id: 'aut-1' } }), x.p);
    expect(r.resultado).toBe('pendiente_informacion');
    expect(x.log).toEqual([]);
    if (r.resultado !== 'pendiente_informacion') return;
    expect(r.fila_historial).toMatchObject({ decision: null, estado_final: 'pendiente_informacion', referencias: { autorizacion_usuario: 'aut-1' } });
    expect(r.fila_historial.motivos[0]).toMatchObject({ codigo: 'datos_faltantes' });
  });
  it('una sustitución mal formada (otra regla, id vacío) no autoriza: sigue BLOQUEADO', async () => {
    for (const s of [{ regla: 'PLP-01', autorizacion_id: 'aut-1' }, { regla: 'PLP-02', autorizacion_id: 'aut-1' }, { regla: 'PLP-09', autorizacion_id: '  ' }, null]) {
      const r = corrida(await ejecutarCorrida(solPlp(), datos({ sustitucion_autorizada: s }), puertos().p));
      expect(r.fila_historial.decision).toBe('BLOQUEADO');
    }
  });
  it('Semilla recompra con dinero nuevo: BLOQUEADO (sección 10, regla 7), sin agentes', async () => {
    const x = puertos();
    const r = corrida(await ejecutarCorrida(solSem(), datos({ posicion_existe: true, dinero_nuevo: true }), x.p));
    expect(x.log).toEqual([]);
    expect(r.fila_historial).toMatchObject({ decision: 'BLOQUEADO', estado_final: 'bloqueada', portafolio_codigo: 'SEMILLA' });
    expect(r.fila_historial.referencias).toMatchObject({ bloqueo_estructural: { regla: 'SEM-04' } });
  });
  it('Semilla recompra sin confirmar que es dinero nuevo (false o sin dato): pendiente_informacion, no se supone', async () => {
    for (const d of [false, null, undefined]) {
      const x = puertos();
      const r = await ejecutarCorrida(solSem(), datos({ posicion_existe: true, dinero_nuevo: d }), x.p);
      expect(r.resultado).toBe('pendiente_informacion');
      expect(x.log).toEqual([]);
      if (r.resultado === 'pendiente_informacion') expect(r.fila_historial.motivos[0]).toMatchObject({ codigo: 'datos_faltantes' });
    }
  });
  it('la sustitución autorizada de PLP no afecta a Semilla ni el dinero nuevo a PLP', async () => {
    const a = await ejecutarCorrida(solSem(), datos({ posicion_existe: true, sustitucion_autorizada: { regla: 'PLP-09', autorizacion_id: 'aut-1' } }), puertos().p);
    expect(a.resultado).toBe('pendiente_informacion');
    const b = corrida(await ejecutarCorrida(solPlp(), datos({ dinero_nuevo: true }), puertos().p));
    expect(b.fila_historial.decision).toBe('BLOQUEADO');
  });
  it('sin datos congelados: pendiente_informacion antes de decidir nada', async () => {
    const r = await ejecutarCorrida(solPlp(), null, puertos().p);
    expect(r.resultado).toBe('pendiente_informacion');
  });
});

describe('solicitudes que no abren corrida o quedan pendientes', () => {
  it('Especulativo y Spin Off: no hay corrida, ningún puerto se llama y la constancia es la acordada el 14-oct', async () => {
    const x = puertos();
    const r = await ejecutarCorrida(sol({ portafolio_codigo: 'Spin Off', ticker: 'abc' }), datos(), x.p);
    expect(r.resultado).toBe('sin_corrida');
    expect(x.log).toEqual([]);
    if (r.resultado !== 'sin_corrida') return;
    expect(r.constancia).toMatchObject({
      agente: 'orquestador', estado: 'ok', portafolio_codigo: 'SPIN_OFF', ticker: 'ABC', entradas: { resultado: 'NO_EVALUABLE', motivo: 'portafolio_sin_reglas' },
    });
  });
  it('sin portafolio o SIN_CLASIFICAR: fila pendiente_informacion con portafolio_no_declarado, sin Motor ni agentes (GLB-04)', async () => {
    for (const p of [null, 'SIN_CLASIFICAR']) {
      const x = puertos();
      const r = await ejecutarCorrida(sol({ portafolio_codigo: p }), datos(), x.p);
      expect(r.resultado).toBe('pendiente_informacion');
      expect(x.log).toEqual([]);
      if (r.resultado !== 'pendiente_informacion') continue;
      expect(r.fila_historial).toMatchObject({
        portafolio_codigo: null, decision: null, estado_final: 'pendiente_informacion', director_estado: 'no_aplica', agentes_requeridos: [], resultados_agentes: [],
        matriz_agentes_version: MATRIZ_AGENTES_VERSION, version: 1, ticker: 'GKOS',
      });
      expect(r.fila_historial.motivos.map(m => m.codigo)).toEqual(['portafolio_no_declarado']);
    }
  });
  it('un tipo sin fila ni regla (SEMILLA revision_tesis): pendiente_informacion y no corre nada', async () => {
    const x = puertos();
    const r = await ejecutarCorrida(sol({ portafolio_codigo: 'SEMILLA', tipo_evaluacion: 'revision_tesis' }), datos(), x.p);
    expect(r.resultado).toBe('pendiente_informacion');
    expect(x.log).toEqual([]);
    if (r.resultado === 'pendiente_informacion') expect(r.fila_historial.motivos[0]).toMatchObject({ codigo: 'datos_faltantes' });
  });
  it('sin datos congelados: pendiente_informacion con datos_faltantes y snapshot nulo en la fila', async () => {
    const x = puertos();
    const r = await ejecutarCorrida(sol(), null, x.p);
    expect(r.resultado).toBe('pendiente_informacion');
    expect(x.log).toEqual([]);
    if (r.resultado === 'pendiente_informacion') {
      expect(r.fila_historial).toMatchObject({ snapshot_id: null, snapshot_generado_en: null, expediente_id: null, decision: null, portafolio_codigo: 'PMP' });
      expect(r.fila_historial.motivos[0]!.codigo).toBe('datos_faltantes');
    }
  });
  it('una solicitud mal formada no genera corrida ni toca puertos', async () => {
    const x = puertos();
    const r = await ejecutarCorrida({ foo: 1 }, datos(), x.p);
    expect(r.resultado).toBe('solicitud_invalida');
    expect(x.log).toEqual([]);
  });
  it('un reloj de los puertos con un instante inválido es un defecto de quien lo implementa: se lanza el error', async () => {
    const x = puertos();
    await expect(ejecutarCorrida(sol(), datos(), { ...x.p, ahora: () => 'hoy' })).rejects.toThrow(/ISO 8601/);
  });
});

describe('el Orquestador no decide: toda corrida válida llega al Motor', () => {
  it('con todo roto (sin velas, analistas caídos, Auditor caído, Director caído) el Motor igual recibe la entrega y responde NO_EVALUABLE', async () => {
    const x = puertos({ analista: () => { throw new Error('x'); }, auditor: () => { throw new Error('x'); }, director: () => { throw new Error('x'); } });
    const r = corrida(await ejecutarCorrida(sol(), datos({ velas: null }), x.p));
    expect(r.salida_motor.decision).toBe('NO_EVALUABLE');
    expect(r.fila_historial.decision).toBe('NO_EVALUABLE');
    expect(['incompleta', 'pendiente_informacion']).toContain(r.fila_historial.estado_final);
    expect(r.fila_historial.motivos.length).toBeGreaterThan(0);
  });
  it('la fila nunca trae decision_id ni user_id: son de quien inserta la decisión y el registro', async () => {
    const r = corrida(await ejecutarCorrida(sol(), datos(), puertos().p));
    expect(r.fila_historial.decision_id).toBeNull();
    expect('user_id' in r.fila_historial).toBe(false);
    expect('id' in r.fila_historial).toBe(false);
  });
  it('no modifica los datos congelados que recibe', async () => {
    const d = datos();
    const copia = JSON.stringify(d);
    await ejecutarCorrida(sol(), d, puertos().p);
    expect(JSON.stringify(d)).toBe(copia);
  });
});
