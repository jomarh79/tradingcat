import { describe, expect, it } from 'vitest';
import { CATALOGO_FIXTURE } from '../auditor/catalogo-fixture';
import type { ReglaEntrada } from '../auditor';
import type { DatosCongelados, Puertos, RespuestaAgente } from '../orquestador';
import { puertoAuditor } from '../auditor';
import { ejecutarCorridaConAuditoria, prepararAuditoria, puertoAuditorBd, resolverPortfolioId } from './index';
import type { ClienteOficina, FilasReglas } from './index';

const PF = '11111111-1111-4111-8111-111111111111';
const US = '44444444-4444-4444-8444-444444444444';
const EXP_EXISTENTE = '33333333-3333-4333-8333-333333333333';

function filasDe(reglas: ReglaEntrada[]): FilasReglas {
  return {
    reglas: reglas.map((r) => ({ id: `r-${r.codigo}`, codigo: r.codigo, caracter: r.caracter })),
    versiones: reglas.map((r) => ({ id: r.version_id, regla_id: `r-${r.codigo}`, version: 1, definicion: r.definicion, estado: 'vigente', vigente_desde: r.vigente_desde, vigente_hasta: null })),
    clasificaciones: reglas.map((r) => ({ regla_id: `r-${r.codigo}`, clase: r.clase, componente_delegado: r.componente_delegado, aplica_a: r.aplica_a, vigente_desde: '2026-10-13', vigente_hasta: null })),
  };
}

// ---------------------------------------------------------------- base en memoria (solo para probar orden y errores; no es la base real)
type Fila = Record<string, unknown>;
interface BD {
  cliente: ClienteOficina;
  tablas: Record<string, Fila[]>;
  inserts: { tabla: string; fila: Fila }[];
  orden: string[];
  filtros: Record<string, [string, string][][]>;
  errores: Record<string, string>;
  erroresInsert: Record<string, { message: string; code?: string }>;
}
function nuevaBd(extra: Record<string, Fila[]> = {}): BD {
  const f = filasDe(CATALOGO_FIXTURE);
  const tablas: Record<string, Fila[]> = {
    oficina_reglas: f.reglas as unknown as Fila[], oficina_reglas_versiones: f.versiones as unknown as Fila[], oficina_reglas_clasificacion: f.clasificaciones as unknown as Fila[],
    oficina_portafolios_config: [{ portfolio_id: PF, codigo: 'PMP' }], oficina_v_posiciones: [], trade_executions: [],
    oficina_v_capital: [{ portfolio_id: PF, posiciones_abiertas: 3 }], oficina_expedientes: [], oficina_analisis: [], ...extra,
  };
  const bd: BD = { tablas, inserts: [], orden: [], filtros: {}, errores: {}, erroresInsert: {}, cliente: null as unknown as ClienteOficina };
  let n = 0;
  bd.cliente = {
    from(tabla) {
      return {
        select(cols) {
          bd.orden.push(`select:${tabla}`);
          const filtros: [string, string][] = [];
          (bd.filtros[tabla] ??= []).push(filtros);
          void cols;
          const q = {
            eq(c: string, v: string) { filtros.push([c, v]); return q; },
            then(ok: (r: { data: unknown[] | null; error: { message: string } | null }) => unknown) {
              const err = bd.errores[tabla];
              if (err) return Promise.resolve(ok({ data: null, error: { message: err } }));
              return Promise.resolve(ok({ data: (tablas[tabla] ?? []).filter((r) => filtros.every(([c, v]) => r[c] === v)), error: null }));
            },
          };
          return q as never;
        },
        insert(fila) {
          bd.orden.push(`insert:${tabla}`);
          bd.inserts.push({ tabla, fila });
          return {
            select() {
              return {
                single() {
                  const e = bd.erroresInsert[tabla];
                  if (e) return Promise.resolve({ data: null, error: e });
                  const id = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
                  const guardada: Fila = { id, ...fila };
                  if (tabla === 'oficina_expedientes') Object.assign(guardada, { rol_posicion: null, ficha: {} });
                  (tablas[tabla] ??= []).push(guardada);
                  return Promise.resolve({ data: { id }, error: null });
                },
              };
            },
          };
        },
      };
    },
  };
  return bd;
}

const sol = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  contrato: 'solicitud.v1', disparador: 'usuario', ticker: 'GKOS', mercado: 'US', portafolio_codigo: 'PMP', tipo_evaluacion: 'nueva_posicion',
  origen: { watchlist_id: null, alerta_id: null }, solicitado_en: '2026-10-27T10:00:00-06:00', ...extra,
});
const datos = (extra: Partial<DatosCongelados> = {}): DatosCongelados => ({
  snapshot_id: 'snap-1', snapshot_generado_en: '2026-10-27T09:00:00-06:00', snapshot_fecha_datos: '2026-10-27', expediente_id: null, posicion_existe: false,
  reglas_versiones_ids: [], tesis_ref: null, parametros: [], sobres: { fundamental: { f: 1 }, valuacion: { v: 1 }, tecnico: { t: 1 }, riesgo_capital: { r: 1 } },
  sobre_auditor: null, ...extra,
});
const aceptada = (extra: Record<string, unknown> = {}) => ({
  ticker: 'GKOS', mercado: 'US', portafolio: 'PMP', tipo_evaluacion: 'nueva_posicion', ruta: 'analitica', disparador: 'manual',
  origen: { watchlist_id: null, alerta_id: null }, solicitado_en: '2026-10-27T10:00:00-06:00', ...extra,
}) as never;

function base(): { p: Omit<Puertos, 'auditor'>; ids: string[]; llamadas: string[] } {
  const ids: string[] = [];
  const llamadas: string[] = [];
  let n = 0;
  let reloj = 0;
  return {
    ids, llamadas,
    p: {
      nuevoId: () => { const id = `run-${++n}`; ids.push(id); return id; },
      ahora: () => new Date(Date.parse('2026-10-27T16:00:00Z') + (reloj++) * 1000).toISOString().replace('.000Z', 'Z'),
      analista: async (a): Promise<RespuestaAgente> => { llamadas.push(a); return { estado: 'ok', analisis_id: `an-${a}`, veredicto: 'X', salida: { de: a } }; },
      director: async (): Promise<RespuestaAgente> => { llamadas.push('director'); return { estado: 'ok', analisis_id: 'di-1' }; },
    },
  };
}

describe('resolverPortfolioId', () => {
  it('traduce el código a portfolio_id con una sola fila', async () => {
    const bd = nuevaBd();
    expect(await resolverPortfolioId(bd.cliente, 'PMP')).toEqual({ ok: true, portfolio_id: PF });
    expect(bd.filtros['oficina_portafolios_config']?.[0]).toEqual([['codigo', 'PMP']]);
  });
  it('con user_id lo filtra', async () => {
    const bd = nuevaBd();
    await resolverPortfolioId(bd.cliente, 'PMP', US);
    expect(bd.filtros['oficina_portafolios_config']?.[0]).toEqual([['user_id', US], ['codigo', 'PMP']]);
  });
  it('errores: sin fila, filas duplicadas, id inválido, error de la base tal cual, excepción', async () => {
    expect((await resolverPortfolioId(nuevaBd({ oficina_portafolios_config: [] }).cliente, 'PMP'))).toMatchObject({ ok: false, problemas: ['oficina_portafolios_config: se esperaba 1 fila del portafolio PMP y hay 0'] });
    const dup = nuevaBd({ oficina_portafolios_config: [{ portfolio_id: PF, codigo: 'PMP' }, { portfolio_id: PF, codigo: 'PMP' }] });
    expect((await resolverPortfolioId(dup.cliente, 'PMP')).ok).toBe(false);
    const malo = await resolverPortfolioId(nuevaBd({ oficina_portafolios_config: [{ portfolio_id: 'x', codigo: 'PMP' }] }).cliente, 'PMP');
    expect(!malo.ok && malo.problemas.join()).toMatch(/portfolio_id válido/);
    const bd = nuevaBd();
    bd.errores['oficina_portafolios_config'] = 'boom';
    expect(await resolverPortfolioId(bd.cliente, 'PMP')).toEqual({ ok: false, problemas: ['oficina_portafolios_config: boom'], error_bd: 'boom' });
    const nulo = { from() { return { select() { const q = { eq() { return q; }, then(ok: (r: unknown) => unknown) { return Promise.resolve(ok({ data: null, error: null })); } }; return q; } }; } } as unknown as ClienteOficina;
    expect(await resolverPortfolioId(nulo, 'PMP')).toEqual({ ok: false, problemas: ['oficina_portafolios_config: la consulta no devolvió filas'] });
    const lanza = { from() { throw new Error('red caída'); } } as unknown as ClienteOficina;
    expect(await resolverPortfolioId(lanza, 'PMP')).toEqual({ ok: false, problemas: ['oficina_portafolios_config: red caída'], error_bd: 'red caída' });
    const lanzaTexto = { from() { throw 'texto'; } } as unknown as ClienteOficina;
    expect(await resolverPortfolioId(lanzaTexto, 'PMP')).toEqual({ ok: false, problemas: ['oficina_portafolios_config: texto'], error_bd: 'texto' });
  });
});

describe('prepararAuditoria', () => {
  it('crea el expediente, carga reglas y hechos y deja la entrada del Auditor en los datos (orden fijo)', async () => {
    const bd = nuevaBd();
    const r = await prepararAuditoria(bd.cliente, { run_id: 'run-1', solicitud: aceptada(), datos: datos() });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.expediente_creado).toBe(true);
    expect(r.portfolio_id).toBe(PF);
    expect(r.datos.expediente_id).toBe(r.expediente_id);
    expect(r.datos.reglas_versiones_ids).toHaveLength(50);
    expect(r.datos.sobre_auditor).toMatchObject({ contrato: 'auditoria_entrada.v1', run_id: 'run-1', ticker: 'GKOS', portafolio_codigo: 'PMP', fecha_evaluacion: '2026-10-27' });
    expect(bd.orden.slice(0, 3)).toEqual(['select:oficina_portafolios_config', 'select:oficina_expedientes', 'insert:oficina_expedientes']);
    expect(bd.orden.indexOf('select:oficina_reglas')).toBeGreaterThan(bd.orden.indexOf('insert:oficina_expedientes'));
    expect(bd.orden.indexOf('select:oficina_v_posiciones')).toBeGreaterThan(bd.orden.indexOf('select:oficina_reglas_clasificacion'));
    expect(bd.inserts).toHaveLength(1);
    expect(bd.inserts[0]?.fila).toMatchObject({ ticker: 'GKOS', mercado: 'US', portfolio_id: PF, portafolio_codigo: 'PMP', tesis_origen: 'al_entrar' });
    expect(Object.keys(bd.inserts[0]?.fila ?? {})).not.toContain('user_id');
  });
  it('si el expediente ya existe lo recupera sin insertar', async () => {
    const bd = nuevaBd({ oficina_expedientes: [{ id: EXP_EXISTENTE, user_id: US, ticker: 'GKOS', mercado: 'US', portfolio_id: PF, rol_posicion: null, ficha: {} }] });
    const r = await prepararAuditoria(bd.cliente, { run_id: 'run-1', solicitud: aceptada(), datos: datos() });
    expect(r.ok && r.expediente_id).toBe(EXP_EXISTENTE);
    expect(r.ok && r.expediente_creado).toBe(false);
    expect(bd.inserts).toEqual([]);
  });
  it('con user_id explícito lo usa en el portafolio, el expediente y los filtros', async () => {
    const bd = nuevaBd({ oficina_portafolios_config: [{ portfolio_id: PF, codigo: 'PMP', user_id: US }] });
    const r = await prepararAuditoria(bd.cliente, { run_id: 'run-1', solicitud: aceptada(), datos: datos(), user_id: US });
    expect(r.ok).toBe(true);
    expect(bd.inserts[0]?.fila['user_id']).toBe(US);
    expect(bd.filtros['oficina_portafolios_config']?.[0]).toContainEqual(['user_id', US]);
  });
  it('posicion_existe sin confirmar: no toca la base', async () => {
    const bd = nuevaBd();
    const r = await prepararAuditoria(bd.cliente, { run_id: 'r', solicitud: aceptada(), datos: datos({ posicion_existe: null }) });
    expect(r).toMatchObject({ ok: false, etapa: 'posicion' });
    expect(bd.orden).toEqual([]);
  });
  it('portafolio sin configuración: se detiene antes de crear el expediente', async () => {
    const bd = nuevaBd({ oficina_portafolios_config: [] });
    const r = await prepararAuditoria(bd.cliente, { run_id: 'r', solicitud: aceptada(), datos: datos() });
    expect(r).toMatchObject({ ok: false, etapa: 'portafolio' });
    expect(bd.inserts).toEqual([]);
    expect(bd.orden).toEqual(['select:oficina_portafolios_config']);
  });
  it('falla la creación del expediente: error de la base tal cual y no se leen reglas', async () => {
    const bd = nuevaBd();
    bd.erroresInsert['oficina_expedientes'] = { message: 'rls', code: '42501' };
    const r = await prepararAuditoria(bd.cliente, { run_id: 'r', solicitud: aceptada(), datos: datos() });
    expect(r).toEqual({ ok: false, etapa: 'expediente', problemas: ['oficina_expedientes: rls'] });
    expect(bd.orden).not.toContain('select:oficina_reglas');
  });
  it('el expediente de los datos congelados debe ser el de la base', async () => {
    const bd = nuevaBd({ oficina_expedientes: [{ id: EXP_EXISTENTE, ticker: 'GKOS', mercado: 'US', portfolio_id: PF, rol_posicion: null, ficha: {} }] });
    const r = await prepararAuditoria(bd.cliente, { run_id: 'r', solicitud: aceptada(), datos: datos({ expediente_id: 'otro' }) });
    expect(r).toMatchObject({ ok: false, etapa: 'expediente' });
    const ok = await prepararAuditoria(bd.cliente, { run_id: 'r', solicitud: aceptada(), datos: datos({ expediente_id: EXP_EXISTENTE }) });
    expect(ok.ok).toBe(true);
  });
  it('error al leer reglas o versiones congeladas inexistentes: etapa reglas y no se leen hechos', async () => {
    const bd = nuevaBd();
    bd.errores['oficina_reglas_versiones'] = 'boom';
    expect(await prepararAuditoria(bd.cliente, { run_id: 'r', solicitud: aceptada(), datos: datos() })).toMatchObject({ ok: false, etapa: 'reglas', problemas: ['oficina_reglas_versiones: boom'] });
    expect(bd.orden).not.toContain('select:oficina_v_posiciones');
    const c = nuevaBd();
    const r = await prepararAuditoria(c.cliente, { run_id: 'r', solicitud: aceptada(), datos: datos({ reglas_versiones_ids: ['no-existe'] }) });
    expect(r).toMatchObject({ ok: false, etapa: 'reglas' });
  });
  it('rige la versión congelada: con ids congelados usa exactamente esas versiones', async () => {
    const bd = nuevaBd();
    const ids = CATALOGO_FIXTURE.slice(0, 5).map((x) => x.version_id);
    const r = await prepararAuditoria(bd.cliente, { run_id: 'r', solicitud: aceptada(), datos: datos({ reglas_versiones_ids: ids }) });
    expect(r.ok && r.datos.reglas_versiones_ids).toEqual(ids);
  });
  it('hechos inconsistentes (posición declarada existente pero la base no la tiene): etapa hechos', async () => {
    const bd = nuevaBd();
    const r = await prepararAuditoria(bd.cliente, { run_id: 'r', solicitud: aceptada(), datos: datos({ posicion_existe: true }) });
    expect(r).toMatchObject({ ok: false, etapa: 'hechos' });
    expect(!r.ok && r.problemas.join()).toMatch(/no la tiene abierta/);
  });
  it('entrada inválida: etapa entrada (acción desconocida)', async () => {
    const bd = nuevaBd();
    const r = await prepararAuditoria(bd.cliente, { run_id: 'r', solicitud: aceptada({ tipo_evaluacion: 'raro' }), datos: datos() });
    expect(r).toMatchObject({ ok: false, etapa: 'entrada' });
  });
  it('una excepción del cliente fuera de los lectores se devuelve como problema (Error o texto)', async () => {
    const bd = nuevaBd();
    const lanzaEn = (valor: unknown): ClienteOficina => ({ from(t: string) { if (t === 'oficina_reglas') throw valor; return bd.cliente.from(t); } });
    expect(await prepararAuditoria(lanzaEn(new Error('red caída')), { run_id: 'r', solicitud: aceptada(), datos: datos() })).toEqual({ ok: false, etapa: 'excepcion', problemas: ['red caída'] });
    expect(await prepararAuditoria(lanzaEn('texto'), { run_id: 'r', solicitud: aceptada(), datos: datos() })).toEqual({ ok: false, etapa: 'excepcion', problemas: ['texto'] });
  });
  it('el portafolio del expediente es el de la solicitud (PCP), no uno fijo', async () => {
    const bd = nuevaBd({ oficina_portafolios_config: [{ portfolio_id: PF, codigo: 'PCP' }] });
    await prepararAuditoria(bd.cliente, { run_id: 'r', solicitud: aceptada({ portafolio: 'PCP' }), datos: datos() });
    expect(bd.inserts[0]?.fila['portafolio_codigo']).toBe('PCP');
  });
  it('las reglas se resuelven con la fecha de America/Mexico_City, no la UTC', async () => {
    // 20:00 en México del 27-oct ya es 28-oct en UTC; una segunda versión de PMP-01 vigente desde el 28 no debe entrar
    const f = filasDe(CATALOGO_FIXTURE);
    const v = f.versiones.find((x) => x.regla_id === 'r-PMP-01')!;
    const bd = nuevaBd({ oficina_reglas_versiones: [...(f.versiones as unknown as Fila[]), { ...v, id: 'v-futura', version: 2, vigente_desde: '2026-10-28' }] });
    const r = await prepararAuditoria(bd.cliente, { run_id: 'r', solicitud: aceptada({ solicitado_en: '2026-10-27T20:00:00-06:00' }), datos: datos() });
    expect(r.ok).toBe(true);
  });
  it('posición existente: la entrada lleva las compras, ventas y costo promedio leídos de la base', async () => {
    const TR = '22222222-2222-4222-8222-222222222222';
    const bd = nuevaBd({
      oficina_v_posiciones: [{ trade_id: TR, portfolio_id: PF, ticker: 'GKOS', fecha_apertura: '2026-10-06' }],
      trade_executions: [{ id: 'e1', trade_id: TR, execution_type: 'buy', price: 100, quantity: 0.5, executed_at: '2026-10-06T14:30:00', total: 50 }],
    });
    const r = await prepararAuditoria(bd.cliente, { run_id: 'r', solicitud: aceptada({ tipo_evaluacion: 'recompra' }), datos: datos({ posicion_existe: true }) });
    expect(r.ok).toBe(true);
    const e = r.ok ? (r.datos.sobre_auditor as { posicion: Record<string, unknown>; contexto_portafolio: Record<string, unknown> }) : null;
    expect(e?.posicion).toMatchObject({ existe: true, fecha_apertura: '2026-10-06', compras: [{ fecha: '2026-10-06', monto: '50' }], ventas_previas: 0, costo_promedio_ponderado: '100' });
    expect(e?.contexto_portafolio['posiciones_abiertas']).toBe(3);
  });
});

describe('puertoAuditorBd', () => {
  async function entradaValida(bd: BD) {
    const r = await prepararAuditoria(bd.cliente, { run_id: 'run-1', solicitud: aceptada(), datos: datos() });
    if (!r.ok) throw new Error(r.problemas.join());
    return r;
  }
  it('corre el Auditor y guarda su salida en oficina_analisis con el expediente real', async () => {
    const bd = nuevaBd();
    const prep = await entradaValida(bd);
    const puerto = puertoAuditorBd(bd.cliente, { expediente_id: prep.expediente_id });
    const r = await puerto(prep.datos.sobre_auditor);
    expect(r.estado).toBe('ok');
    const guardado = bd.inserts.filter((i) => i.tabla === 'oficina_analisis');
    expect(guardado).toHaveLength(1);
    expect(guardado[0]?.fila).toMatchObject({ expediente_id: prep.expediente_id, agente: 'auditor_reglas', ejecucion_id: null, puntaje: null, confianza: null });
    expect(guardado[0]?.fila['veredicto']).toBe(r.veredicto);
    expect(r.analisis_id).toBe(bd.tablas['oficina_analisis']?.[0]?.['id']);
    expect(Array.isArray(r.reglas_revisadas)).toBe(true);
    expect(Object.keys(r)).not.toContain('salida');
  });
  it('si el Auditor falla (sobre inválido) no guarda nada y devuelve error', async () => {
    const bd = nuevaBd();
    const r = await puertoAuditorBd(bd.cliente, { expediente_id: EXP_EXISTENTE })(null);
    expect(r).toEqual({ estado: 'error', error: (await puertoAuditor(null)).error });
    expect(bd.inserts).toEqual([]);
  });
  it('si no se puede guardar, es error (no se finge un análisis)', async () => {
    const bd = nuevaBd();
    const prep = await entradaValida(bd);
    bd.erroresInsert['oficina_analisis'] = { message: 'fk violada' };
    const r = await puertoAuditorBd(bd.cliente, { expediente_id: prep.expediente_id })(prep.datos.sobre_auditor);
    expect(r).toEqual({ estado: 'error', error: 'no se pudo guardar el análisis del Auditor: oficina_analisis: fk violada' });
  });
  it('sin expediente real no guarda (expediente_id inválido)', async () => {
    const bd = nuevaBd();
    const prep = await entradaValida(bd);
    const r = await puertoAuditorBd(bd.cliente, { expediente_id: 'no-uuid' })(prep.datos.sobre_auditor);
    expect(r.estado).toBe('error');
    expect(bd.inserts.filter((i) => i.tabla === 'oficina_analisis')).toEqual([]);
  });
  it('con user_id explícito lo lleva en la fila', async () => {
    const bd = nuevaBd();
    const prep = await entradaValida(bd);
    await puertoAuditorBd(bd.cliente, { expediente_id: prep.expediente_id, user_id: US })(prep.datos.sobre_auditor);
    expect(bd.inserts.find((i) => i.tabla === 'oficina_analisis')?.fila['user_id']).toBe(US);
  });
});

describe('ejecutarCorridaConAuditoria', () => {
  it('flujo completo: expediente creado, Auditor guardado, y la fila de la corrida enlaza ambos', async () => {
    const bd = nuevaBd();
    const b = base();
    const r = await ejecutarCorridaConAuditoria(bd.cliente, sol(), datos(), b.p);
    expect(r.preparacion?.ok).toBe(true);
    expect(r.corrida.resultado).toBe('corrida');
    if (r.corrida.resultado !== 'corrida' || !r.preparacion?.ok) return;
    const analisis = bd.tablas['oficina_analisis']?.[0];
    expect(analisis).toBeDefined();
    expect(r.corrida.fila_historial.expediente_id).toBe(r.preparacion.expediente_id);
    expect(r.corrida.fila_historial.auditoria_analisis_id).toBe(analisis?.['id']);
    expect(r.corrida.fila_historial.auditoria_veredicto).toBe(analisis?.['veredicto']);
    // el run_id del Auditor es el corrida_id (primer id que pidió el Orquestador)
    expect((analisis?.['salida'] as { run_id: string }).run_id).toBe(r.corrida.corrida_id);
    expect(r.corrida.corrida_id).toBe(b.ids[0]);
    expect(b.ids).toHaveLength(1);
    expect(r.corrida.fila_historial.reglas_versiones_ids).toHaveLength(50);
    expect(bd.orden.indexOf('insert:oficina_expedientes')).toBeLessThan(bd.orden.indexOf('insert:oficina_analisis'));
  });
  it('si la preparación falla: sin análisis guardado, el motivo queda en datos faltantes y la corrida no queda completada', async () => {
    const bd = nuevaBd({ oficina_portafolios_config: [] });
    const b = base();
    const r = await ejecutarCorridaConAuditoria(bd.cliente, sol(), datos(), b.p);
    expect(r.preparacion).toMatchObject({ ok: false, etapa: 'portafolio' });
    expect(bd.inserts).toEqual([]);
    expect(r.corrida.resultado).toBe('corrida');
    if (r.corrida.resultado !== 'corrida') return;
    expect(r.corrida.fila_historial.estado_final).not.toBe('completada');
    expect(r.corrida.fila_historial.auditoria_analisis_id).toBeNull();
    expect(JSON.stringify(r.corrida.fila_historial)).toMatch(/auditor \(portafolio\)/);
  });
  it('si el expediente no se puede crear: no se guarda ningún análisis', async () => {
    const bd = nuevaBd();
    bd.erroresInsert['oficina_expedientes'] = { message: 'rls' };
    const r = await ejecutarCorridaConAuditoria(bd.cliente, sol(), datos(), base().p);
    expect(r.preparacion).toMatchObject({ ok: false, etapa: 'expediente' });
    expect(bd.inserts.filter((i) => i.tabla === 'oficina_analisis')).toEqual([]);
    expect(r.corrida.resultado === 'corrida' && r.corrida.fila_historial.estado_final).not.toBe('completada');
  });
  it('solicitud inválida, sin datos o portafolio sin reglas: no se toca la base y no hay preparación', async () => {
    const bd = nuevaBd();
    const inv = await ejecutarCorridaConAuditoria(bd.cliente, { contrato: 'x' }, datos(), base().p);
    expect(inv.corrida.resultado).toBe('solicitud_invalida');
    const sin = await ejecutarCorridaConAuditoria(bd.cliente, sol(), null, base().p);
    expect(sin.corrida.resultado).toBe('pendiente_informacion');
    const esp = await ejecutarCorridaConAuditoria(bd.cliente, sol({ portafolio_codigo: 'ESPECULATIVO' }), datos(), base().p);
    expect(esp.corrida.resultado).toBe('sin_corrida');
    expect([inv.preparacion, sin.preparacion, esp.preparacion]).toEqual([null, null, null]);
    expect(bd.orden).toEqual([]);
  });
  it('con user_id explícito se usa en todo el flujo', async () => {
    const bd = nuevaBd({ oficina_portafolios_config: [{ portfolio_id: PF, codigo: 'PMP', user_id: US }] });
    const r = await ejecutarCorridaConAuditoria(bd.cliente, sol(), datos(), base().p, {}, { user_id: US });
    expect(r.preparacion?.ok).toBe(true);
    expect(bd.inserts.every((i) => i.fila['user_id'] === US)).toBe(true);
  });
  it('no se pide un id extra: el Orquestador recibe el primero que se generó', async () => {
    const bd = nuevaBd();
    const b = base();
    await ejecutarCorridaConAuditoria(bd.cliente, sol(), datos(), b.p);
    expect(b.ids).toEqual(['run-1']);
  });
});
