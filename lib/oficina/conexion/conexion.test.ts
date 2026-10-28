import { describe, expect, it } from 'vitest';
import { CATALOGO_FIXTURE } from '../auditor/catalogo-fixture';
import { auditar } from '../auditor';
import type { ReglaEntrada } from '../auditor';
import type { DatosCongelados, SolicitudNormalizada } from '../orquestador';
import { ACCION_POR_TIPO, cargarFilasReglas, conSobreAuditor, construirEntradaAuditor, resolverReglas } from './index';
import type { ClienteConsulta, FilasReglas } from './index';

// ---------------------------------------------------------------- filas de la base a partir del fixture del catálogo
function filasDe(reglas: ReglaEntrada[]): FilasReglas {
  return {
    reglas: reglas.map((r) => ({ id: `r-${r.codigo}`, codigo: r.codigo, caracter: r.caracter })),
    versiones: reglas.map((r) => ({ id: r.version_id, regla_id: `r-${r.codigo}`, version: 1, definicion: r.definicion, estado: 'vigente', vigente_desde: r.vigente_desde, vigente_hasta: null })),
    clasificaciones: reglas.map((r) => ({ regla_id: `r-${r.codigo}`, clase: r.clase, componente_delegado: r.componente_delegado, aplica_a: r.aplica_a, vigente_desde: '2026-10-13', vigente_hasta: null })),
  };
}
const FILAS = filasDe(CATALOGO_FIXTURE);
const FECHA = '2026-10-26';

describe('resolverReglas', () => {
  it('une las tres tablas y reproduce exactamente las reglas del Auditor (ida y vuelta), ordenadas por código', () => {
    const barajadas: FilasReglas = { reglas: [...FILAS.reglas].reverse(), versiones: [...FILAS.versiones].reverse(), clasificaciones: [...FILAS.clasificaciones].reverse() };
    const r = resolverReglas(barajadas, { fecha: FECHA });
    expect(r.problemas).toEqual([]);
    const esperadas = [...CATALOGO_FIXTURE].sort((a, b) => (a.codigo < b.codigo ? -1 : 1));
    expect(r.reglas).toEqual(esperadas);
    expect(r.versiones_ids).toEqual(esperadas.map((x) => x.version_id));
    expect(r.reglas).toHaveLength(50);
  });
  it('solo toma versiones en estado vigente dentro de su rango de fechas', () => {
    const f: FilasReglas = { ...FILAS, versiones: FILAS.versiones.map((v) => (v.regla_id === 'r-PMP-01' ? { ...v, estado: 'archivada' } : v)) };
    const r = resolverReglas(f, { fecha: FECHA });
    expect(r.reglas.find((x) => x.codigo === 'PMP-01')).toBeUndefined();
    const antes = resolverReglas(FILAS, { fecha: '2026-10-05' });
    expect(antes.reglas).toEqual([]); // ninguna vigente todavía
    const caducada: FilasReglas = { ...FILAS, versiones: FILAS.versiones.map((v) => (v.regla_id === 'r-PMP-01' ? { ...v, vigente_hasta: '2026-10-25' } : v)) };
    expect(resolverReglas(caducada, { fecha: FECHA }).reglas.find((x) => x.codigo === 'PMP-01')).toBeUndefined();
    expect(resolverReglas(caducada, { fecha: '2026-10-25' }).reglas.find((x) => x.codigo === 'PMP-01')).toBeDefined();
    expect(resolverReglas(FILAS, { fecha: '2026-10-13' }).reglas.find((x) => x.codigo === 'PMP-01')).toBeDefined(); // clasificación vigente desde el 13-oct
    expect(resolverReglas(FILAS, { fecha: '2026-10-12' }).problemas.join()).toMatch(/sin clasificación vigente/);
  });
  it('versiones congeladas: manda el snapshot aunque haya otra versión vigente hoy', () => {
    const v2 = { id: 'v-PMP-01-2', regla_id: 'r-PMP-01', version: 2, definicion: { umbral: 15 }, estado: 'vigente', vigente_desde: '2026-10-20', vigente_hasta: null };
    const vieja = { ...FILAS.versiones.find((v) => v.regla_id === 'r-PMP-01')!, estado: 'archivada', vigente_hasta: '2026-10-19' };
    const f: FilasReglas = { ...FILAS, versiones: [...FILAS.versiones.filter((v) => v.regla_id !== 'r-PMP-01'), vieja, v2] };
    const congeladas = CATALOGO_FIXTURE.map((r) => r.version_id);
    const r = resolverReglas(f, { fecha: FECHA, versiones_ids: congeladas });
    expect(r.problemas).toEqual([]);
    expect(r.reglas.find((x) => x.codigo === 'PMP-01')!.definicion).toEqual(CATALOGO_FIXTURE.find((x) => x.codigo === 'PMP-01')!.definicion);
    const hoy = resolverReglas(f, { fecha: FECHA });
    expect(hoy.reglas.find((x) => x.codigo === 'PMP-01')!.version_id).toBe('v-PMP-01-2');
  });
  it('problemas: versión congelada inexistente, dos versiones de una regla, regla inexistente, sin vigente_desde, definición inválida', () => {
    expect(resolverReglas(FILAS, { fecha: FECHA, versiones_ids: ['nope'] }).problemas).toContain('la versión congelada nope no existe');
    const dup = { ...FILAS.versiones[0]!, id: 'otra' };
    expect(resolverReglas({ ...FILAS, versiones: [...FILAS.versiones, dup] }, { fecha: FECHA }).problemas.join()).toMatch(/más de una versión/);
    expect(resolverReglas({ ...FILAS, reglas: FILAS.reglas.slice(1) }, { fecha: FECHA }).problemas.join()).toMatch(/regla inexistente/);
    const sinFecha = { ...FILAS, versiones: FILAS.versiones.map((v, i) => (i === 0 ? { ...v, vigente_desde: null } : v)) };
    expect(resolverReglas(sinFecha, { fecha: FECHA, versiones_ids: [FILAS.versiones[0]!.id] }).problemas.join()).toMatch(/no tiene vigente_desde/);
    const defMala = { ...FILAS, versiones: FILAS.versiones.map((v, i) => (i === 0 ? { ...v, definicion: [1] } : v)) };
    expect(resolverReglas(defMala, { fecha: FECHA }).problemas.join()).toMatch(/definicion inválida/);
    expect(resolverReglas(FILAS, { fecha: '26/10/2026' }).problemas).toEqual(['fecha inválida']);
  });
  it('problemas de clasificación: ausente, ambigua, clase desconocida, referencial incoherente, aplica_a inválido, vencida', () => {
    const sin = { ...FILAS, clasificaciones: FILAS.clasificaciones.slice(1) };
    expect(resolverReglas(sin, { fecha: FECHA }).problemas.join()).toMatch(/sin clasificación vigente/);
    const amb = { ...FILAS, clasificaciones: [...FILAS.clasificaciones, { ...FILAS.clasificaciones[0]! }] };
    expect(resolverReglas(amb, { fecha: FECHA }).problemas.join()).toMatch(/clasificación ambigua \(2 filas vigentes\)/);
    const cl = (f: (c: FilasReglas['clasificaciones'][number]) => FilasReglas['clasificaciones'][number]): FilasReglas => ({ ...FILAS, clasificaciones: FILAS.clasificaciones.map((c, i) => (i === 0 ? f(c) : c)) });
    expect(resolverReglas(cl((c) => ({ ...c, clase: 'rara' })), { fecha: FECHA }).problemas.join()).toMatch(/clase desconocida rara/);
    const ref = FILAS.reglas.findIndex((r) => r.caracter === 'referencial');
    const incoh: FilasReglas = { ...FILAS, clasificaciones: FILAS.clasificaciones.map((c) => (c.regla_id === FILAS.reglas[ref]!.id ? { ...c, clase: 'estructura_limite' } : c)) };
    expect(resolverReglas(incoh, { fecha: FECHA }).problemas.join()).toMatch(/referencial exige clase referencial/);
    expect(resolverReglas(cl((c) => ({ ...c, aplica_a: { portafolios: 'PMP', tipos_evaluacion: [] } })), { fecha: FECHA }).problemas.join()).toMatch(/aplica_a inválido/);
    expect(resolverReglas(cl((c) => ({ ...c, aplica_a: null })), { fecha: FECHA }).problemas.join()).toMatch(/aplica_a inválido/);
    expect(resolverReglas(cl((c) => ({ ...c, aplica_a: { portafolios: ['PMP'], tipos_evaluacion: 'todos' } })), { fecha: FECHA }).problemas.join()).toMatch(/aplica_a inválido/);
    expect(resolverReglas(cl((c) => ({ ...c, aplica_a: { portafolios: ['PMP'], tipos_evaluacion: [1] } })), { fecha: FECHA }).problemas.join()).toMatch(/aplica_a inválido/);
    expect(resolverReglas(cl((c) => ({ ...c, vigente_desde: '2026-11-01' })), { fecha: FECHA }).problemas.join()).toMatch(/sin clasificación vigente/);
    expect(resolverReglas(cl((c) => ({ ...c, vigente_hasta: '2026-10-25' })), { fecha: FECHA }).problemas.join()).toMatch(/sin clasificación vigente/);
    expect(resolverReglas(cl((c) => ({ ...c, vigente_hasta: '2026-10-26' })), { fecha: FECHA }).problemas).toEqual([]);
  });
  it('carácter desconocido y código repetido', () => {
    const car = { ...FILAS, reglas: FILAS.reglas.map((r, i) => (i === 0 ? { ...r, caracter: 'opcional' } : r)) };
    expect(resolverReglas(car, { fecha: FECHA }).problemas.join()).toMatch(/carácter desconocido opcional/);
    const rep = { ...FILAS, reglas: [...FILAS.reglas, { ...FILAS.reglas[0]!, id: 'otra' }], versiones: [...FILAS.versiones, { ...FILAS.versiones[0]!, id: 'vx', regla_id: 'otra' }],
      clasificaciones: [...FILAS.clasificaciones, { ...FILAS.clasificaciones[0]!, regla_id: 'otra' }] };
    expect(resolverReglas(rep, { fecha: FECHA }).problemas.join()).toMatch(/código repetido/);
  });
});

describe('cargarFilasReglas', () => {
  const cliente = (resp: Record<string, { data: unknown[] | null; error: { message: string } | null }>, pedidas: string[] = []): ClienteConsulta => ({
    from: (t) => ({ select: (c) => { pedidas.push(`${t}|${c}`); return Promise.resolve(resp[t]!); } }),
  });
  const bien = { oficina_reglas: { data: FILAS.reglas, error: null }, oficina_reglas_versiones: { data: FILAS.versiones, error: null }, oficina_reglas_clasificacion: { data: FILAS.clasificaciones, error: null } };
  it('lee las tres tablas con sus columnas', async () => {
    const pedidas: string[] = [];
    const r = await cargarFilasReglas(cliente(bien, pedidas));
    expect(r).toEqual({ ok: true, filas: FILAS });
    expect(pedidas).toEqual([
      'oficina_reglas|id,codigo,caracter',
      'oficina_reglas_versiones|id,regla_id,version,definicion,estado,vigente_desde,vigente_hasta',
      'oficina_reglas_clasificacion|regla_id,clase,componente_delegado,aplica_a,vigente_desde,vigente_hasta',
    ]);
  });
  it('el error de la base se devuelve tal cual y se detiene sin leer las demás', async () => {
    for (const t of Object.keys(bien)) {
      const pedidas: string[] = [];
      const r = await cargarFilasReglas(cliente({ ...bien, [t]: { data: null, error: { message: 'permission denied' } } }, pedidas));
      expect(r).toEqual({ ok: false, error: `${t}: permission denied` });
      expect(pedidas.at(-1)!.startsWith(t)).toBe(true);
    }
    const sin = await cargarFilasReglas(cliente({ ...bien, oficina_reglas: { data: null, error: null } }));
    expect(sin).toEqual({ ok: false, error: 'oficina_reglas: la consulta no devolvió filas' });
  });
});

// ---------------------------------------------------------------- entrada del Auditor
const REGLAS = resolverReglas(FILAS, { fecha: FECHA }).reglas;
const solicitud = (p: Partial<SolicitudNormalizada> & { portafolio?: string } = {}): SolicitudNormalizada & { portafolio: string } => ({
  disparador: 'manual', ticker: 'GKOS', mercado: 'US', portafolio: 'PMP', tipo_evaluacion: 'nueva_posicion', ruta: 'analitica',
  origen: { watchlist_id: null, alerta_id: null }, solicitado_en: '2026-10-26T21:30:00-06:00', ...p,
}) as SolicitudNormalizada & { portafolio: string };
const datos = (p: Partial<DatosCongelados> = {}): DatosCongelados => ({
  snapshot_id: 'snap-1', snapshot_generado_en: '2026-10-26T20:00:00-06:00', snapshot_fecha_datos: '2026-10-26', expediente_id: null,
  posicion_existe: false, reglas_versiones_ids: REGLAS.map((r) => r.version_id), tesis_ref: null, parametros: [], sobres: {}, sobre_auditor: null, ...p,
});
const armar = (o: { s?: ReturnType<typeof solicitud>; d?: DatosCongelados; h?: Parameters<typeof construirEntradaAuditor>[0]['hechos'] } = {}) =>
  construirEntradaAuditor({ run_id: 'run-1', solicitud: o.s ?? solicitud(), datos: o.d ?? datos(), reglas: REGLAS, hechos: o.h });

describe('construirEntradaAuditor', () => {
  it('arma una entrada válida: ids, portafolio, tipo, acción por tipo, reglas y fecha en America/Mexico_City', () => {
    const r = armar();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const e = r.entrada;
    expect(e).toMatchObject({ contrato: 'auditoria_entrada.v1', run_id: 'run-1', snapshot_id: 'snap-1', ticker: 'GKOS', mercado: 'US', portafolio_codigo: 'PMP', tipo_evaluacion: 'nueva_posicion' });
    expect(e.fecha_evaluacion).toBe('2026-10-26');
    expect(e.operacion.accion).toBe('abrir');
    expect(e.posicion.existe).toBe(false);
    expect(e.reglas_vigentes).toBe(REGLAS);
    expect(e.datos_fuente).toEqual([]);
    expect(e.analisis_ids).toEqual([]);
    expect(e.datos.fundamentos).toBeNull();
    expect(e.contexto_portafolio).toEqual({ posiciones_abiertas: null, movimiento_ya_registrado: null, sustitucion_autorizada: null });
  });
  it('la fecha sale de la zona de la oficina, no de UTC (21:30 del 26-oct en México = 27-oct en UTC)', () => {
    const r = armar({ s: solicitud({ solicitado_en: '2026-10-27T03:30:00Z' }) });
    expect(r.ok && r.entrada.fecha_evaluacion).toBe('2026-10-26');
    expect(armar({ s: solicitud({ solicitado_en: '2026-10-27T06:00:00Z' }) }).ok && (armar({ s: solicitud({ solicitado_en: '2026-10-27T06:00:00Z' }) }) as { entrada: { fecha_evaluacion: string } }).entrada.fecha_evaluacion).toBe('2026-10-27');
  });
  it('cada tipo de evaluación tiene su acción', () => {
    expect(ACCION_POR_TIPO).toEqual({ nueva_posicion: 'abrir', recompra: 'recomprar', posicion_abierta: 'mantener', revision_tesis: 'mantener', aporte_periodico: 'aporte', revision_anual_etf: 'mantener', retiro_quinquenal: 'reducir' });
    const r = armar({ s: solicitud({ tipo_evaluacion: 'recompra' }), d: datos({ posicion_existe: true }) });
    expect(r.ok && r.entrada.operacion.accion).toBe('recomprar');
  });
  it('los hechos de la capa de datos se copian y pueden fijar la acción', () => {
    const r = armar({
      s: solicitud({ tipo_evaluacion: 'posicion_abierta' }), d: datos({ posicion_existe: true }),
      h: {
        operacion: { accion: 'vender', porcentaje_venta: '50', motivo_venta: 'senal_salida', precio: '12' },
        posicion: { fecha_apertura: '2026-10-10', compras: [{ fecha: '2026-10-10', monto: '25' }], ventas_previas: 0, plan_pcp: 'escalonado', rol: 'flujo', costo_promedio_ponderado: '10' },
        posiciones_abiertas: 7, datos: { stop_tocado: true, analisis_presentes: ['radiografia'] }, datos_fuente: [{ id: 'a', campo: 'x', categoria: 'otro', valor: 1, unidad: null, fuente: 'f', fecha_dato: '2026-10-26' }], analisis_ids: ['an-1'],
      },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entrada.operacion).toMatchObject({ accion: 'vender', porcentaje_venta: '50', motivo_venta: 'senal_salida', precio: '12' });
    expect(r.entrada.posicion).toMatchObject({ existe: true, fecha_apertura: '2026-10-10', ventas_previas: 0, plan_pcp: 'escalonado', rol: 'flujo', costo_promedio_ponderado: '10' });
    expect(r.entrada.contexto_portafolio.posiciones_abiertas).toBe(7);
    expect(r.entrada.datos).toMatchObject({ stop_tocado: true, analisis_presentes: ['radiografia'], aporte_etf: null });
    expect(r.entrada.analisis_ids).toEqual(['an-1']);
    expect(r.entrada.datos_fuente).toHaveLength(1);
  });
  it('posición no confirmada o acción desconocida: no se arma', () => {
    expect(armar({ d: datos({ posicion_existe: null }) })).toEqual({ ok: false, problemas: [expect.stringMatching(/posicion_existe/)] });
    const r = armar({ s: solicitud({ tipo_evaluacion: 'raro' as never }) });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problemas.join()).toMatch(/no hay acción para el tipo raro/);
  });
  it('ETF aporte: el aporte lo calcula el Orquestador (modo y monto por ETF) y el duplicado pasa al contexto', () => {
    const etf = (efectivo: string, dup: boolean | null) => armar({ s: solicitud({ portafolio: 'ETF', ticker: 'XLK', tipo_evaluacion: 'aporte_periodico' }), d: datos({ aporte_semanal: { efectivo_disponible: efectivo, etfs_sectoriales: 4, duplicado: dup } }) });
    const a = etf('10', false);
    expect(a.ok && a.entrada.datos.aporte_etf).toEqual({ modo: 'completo', monto_por_etf: '2' });
    expect(a.ok && a.entrada.operacion.monto).toBe('2');
    expect(a.ok && a.entrada.contexto_portafolio.movimiento_ya_registrado).toBe(false);
    const b = etf('5', true);
    expect(b.ok && b.entrada.datos.aporte_etf).toEqual({ modo: 'reducido', monto_por_etf: '1' });
    expect(b.ok && b.entrada.operacion.monto).toBe('1');
    expect(b.ok && b.entrada.contexto_portafolio.movimiento_ya_registrado).toBe(true);
    const c = etf('3', false);
    expect(c.ok && c.entrada.datos.aporte_etf).toEqual({ modo: 'ninguno', monto_por_etf: null });
    expect(c.ok && c.entrada.operacion.monto).toBeNull();
    const n = etf('10', null); // duplicado no verificable: no se inventa un modo
    expect(n.ok && n.entrada.datos.aporte_etf).toBeNull();
    expect(n.ok && n.entrada.contexto_portafolio.movimiento_ya_registrado).toBeNull();
    const d = etf('x', false); // efectivo inválido: no verificable, no se inventa un modo
    expect(d.ok && d.entrada.datos.aporte_etf).toBeNull();
    expect(d.ok && d.entrada.operacion.monto).toBeNull();
  });
  it('ETF: un monto de los hechos no pisa el aporte calculado en el modo, y el Auditor lo advierte', () => {
    const r = armar({ s: solicitud({ portafolio: 'ETF', ticker: 'XLK', tipo_evaluacion: 'aporte_periodico' }), d: datos({ aporte_semanal: { efectivo_disponible: '10', etfs_sectoriales: 4, duplicado: false } }), h: { operacion: { monto: '1', instrumento_destino: 'XLK' } } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entrada.datos.aporte_etf).toEqual({ modo: 'completo', monto_por_etf: '2' });
    expect(r.entrada.operacion.monto).toBe('1');
    expect(auditar(r.entrada).resultados_reglas.find((x) => x.codigo === 'ETF-01')!.resultado).toBe('incumple');
  });
  it('el aporte solo se calcula para ETF aporte_periodico', () => {
    const r = armar({ d: datos({ aporte_semanal: { efectivo_disponible: '10', etfs_sectoriales: 4, duplicado: false } }) });
    expect(r.ok && r.entrada.datos.aporte_etf).toBeNull();
    expect(r.ok && r.entrada.contexto_portafolio.movimiento_ya_registrado).toBeNull();
    const pmp = armar({ s: solicitud({ portafolio: 'PMP', tipo_evaluacion: 'aporte_periodico' }), d: datos({ aporte_semanal: { efectivo_disponible: '10', etfs_sectoriales: 4, duplicado: false } }) });
    expect(pmp.ok && pmp.entrada.datos.aporte_etf).toBeNull();
    expect(pmp.ok && pmp.entrada.operacion.monto).toBeNull();
    const o = armar({ s: solicitud({ portafolio: 'ETF', tipo_evaluacion: 'nueva_posicion' }), d: datos({ aporte_semanal: { efectivo_disponible: '10', etfs_sectoriales: 4, duplicado: false } }) });
    expect(o.ok && o.entrada.datos.aporte_etf).toBeNull();
  });
  it('Semilla: dinero_nuevo=true fija el origen; contradicciones se rechazan', () => {
    const s = solicitud({ portafolio: 'SEMILLA', tipo_evaluacion: 'recompra' });
    const ok = armar({ s, d: datos({ posicion_existe: true, dinero_nuevo: true }) });
    expect(ok.ok && ok.entrada.operacion.origen_dinero).toBe('dinero_nuevo');
    expect(armar({ s, d: datos({ posicion_existe: true, dinero_nuevo: true }), h: { operacion: { origen_dinero: 'dividendo' } } }).ok).toBe(false);
    expect(armar({ s, d: datos({ posicion_existe: true, dinero_nuevo: false }), h: { operacion: { origen_dinero: 'dinero_nuevo' } } }).ok).toBe(false);
    const div = armar({ s, d: datos({ posicion_existe: true, dinero_nuevo: false }), h: { operacion: { origen_dinero: 'dividendo', dividendo_misma_empresa: true } } });
    expect(div.ok && div.entrada.operacion).toMatchObject({ origen_dinero: 'dividendo', dividendo_misma_empresa: true });
    const sin = armar({ s, d: datos({ posicion_existe: true, dinero_nuevo: false }) });
    expect(sin.ok && sin.entrada.operacion.origen_dinero).toBeNull(); // no se supone que sea dividendo
    const nulo = armar({ s, d: datos({ posicion_existe: true, dinero_nuevo: null }) });
    expect(nulo.ok && nulo.entrada.operacion.origen_dinero).toBeNull();
    const aud = auditar((ok as unknown as { entrada: never }).entrada);
    expect(aud.infracciones.map((i) => i.codigo)).toEqual(['SEM-04']);
  });
  it('PLP: la sustitución autorizada llega al contexto', () => {
    const r = armar({ s: solicitud({ portafolio: 'PLP', tipo_evaluacion: 'nueva_posicion' }), d: datos({ sustitucion_autorizada: { regla: 'PLP-09', autorizacion_id: 'aut-1' } }) });
    expect(r.ok && r.entrada.contexto_portafolio.sustitucion_autorizada).toEqual({ regla: 'PLP-09', autorizacion_id: 'aut-1' });
  });
  it('rige la versión congelada: reglas distintas de las del snapshot se rechazan; sin versiones congeladas se acepta', () => {
    const mal = armar({ d: datos({ reglas_versiones_ids: [...REGLAS.map((r) => r.version_id).slice(1), 'otra'] }) });
    expect(mal).toEqual({ ok: false, problemas: ['las reglas enviadas no coinciden con las versiones congeladas del snapshot'] });
    expect(armar({ d: datos({ reglas_versiones_ids: REGLAS.map((r) => r.version_id).slice(1) }) }).ok).toBe(false);
    expect(armar({ d: datos({ reglas_versiones_ids: [...REGLAS.map((r) => r.version_id), 'zzzz'] }) }).ok).toBe(false); // una versión congelada de más
    expect(armar({ d: datos({ reglas_versiones_ids: [] }) }).ok).toBe(true);
    const orden = armar({ d: datos({ reglas_versiones_ids: [...REGLAS.map((r) => r.version_id)].reverse() }) });
    expect(orden.ok).toBe(true);
  });
  it('una entrada que el Auditor rechazaría no sale: se devuelven sus problemas', () => {
    const r = armar({ h: { datos_fuente: [{ id: 'a', campo: 'x', categoria: 'otro', valor: 1, unidad: null, fuente: '', fecha_dato: '2026-10-26' }] } });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problemas.join()).toMatch(/sin fuente/);
  });
  it('de extremo a extremo: reglas desde la base + datos congelados → auditoría', () => {
    const r = armar({ s: solicitud({ portafolio: 'PLP', ticker: 'ZZZ' }), d: datos({ posicion_existe: false }) });
    expect(r.ok).toBe(true);
    const a = auditar((r as unknown as { entrada: never }).entrada);
    expect(a.veredicto).toBe('BLOQUEO_REGLA');
    expect(a.infracciones.map((i) => i.codigo)).toContain('PLP-02');
  });
  it('conSobreAuditor: pone la entrada y conserva las versiones congeladas; si no había, las toma de las reglas', () => {
    const r = armar() as unknown as { entrada: never; ok: true };
    const d1 = conSobreAuditor(datos(), r.entrada);
    expect(d1.sobre_auditor).toBe(r.entrada);
    expect(d1.reglas_versiones_ids).toEqual(REGLAS.map((x) => x.version_id));
    const d2 = conSobreAuditor(datos({ reglas_versiones_ids: [] }), r.entrada);
    expect(d2.reglas_versiones_ids).toEqual(REGLAS.map((x) => x.version_id));
    const d3 = conSobreAuditor(datos({ reglas_versiones_ids: ['x'] }), r.entrada);
    expect(d3.reglas_versiones_ids).toEqual(['x']);
  });
});
