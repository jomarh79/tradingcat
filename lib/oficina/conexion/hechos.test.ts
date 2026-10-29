import { describe, expect, it } from 'vitest';
import { AGENTE_AUDITOR } from '../auditor';
import type { SalidaAuditor } from '../auditor';
import { cargarHechosPosicion, filaAnalisisAuditor, guardarAnalisisAuditor, resolverHechosPosicion } from './index';
import type { ClienteInsercion, ClienteLectura, FilasPosicion } from './index';

const PF = '11111111-1111-4111-8111-111111111111';
const TR = '22222222-2222-4222-8222-222222222222';
const EX = '33333333-3333-4333-8333-333333333333';
const US = '44444444-4444-4444-8444-444444444444';
const EJ = '55555555-5555-4555-8555-555555555555';
const AN = '66666666-6666-4666-8666-666666666666';

const compra = (id: string, p: unknown, q: unknown, t: unknown, f: string | null = '2026-10-06T14:30:00') =>
  ({ id, trade_id: TR, execution_type: 'buy', price: p, quantity: q, executed_at: f, total: t });
function filas(o: Partial<FilasPosicion> = {}): FilasPosicion {
  return {
    posiciones: [{ trade_id: TR, portfolio_id: PF, ticker: 'MSFT', fecha_apertura: '2026-10-06' }],
    ejecuciones: [compra('e1', 100, 0.25, 25), compra('e2', 80, 0.5, 40, '2026-10-13T10:00:00')],
    capital: [{ portfolio_id: PF, posiciones_abiertas: 4 }],
    expedientes: [{ id: EX, ticker: 'MSFT', portfolio_id: PF, rol_posicion: 'core', ficha: {} }],
    ...o,
  };
}
const Q = { portfolio_id: PF, ticker: 'MSFT', posicion_existe: true };
const problemas = (f: FilasPosicion, q = Q) => { const r = resolverHechosPosicion(f, q); return r.ok ? [] : r.problemas.join(' | '); };

describe('resolverHechosPosicion', () => {
  it('arma fecha de apertura, compras (fecha de executed_at y monto = total), ventas, costo promedio exacto, capital y rol', () => {
    const r = resolverHechosPosicion(filas(), Q);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.trade_id).toBe(TR);
    expect(r.expediente_id).toBe(EX);
    expect(r.hechos.posicion).toEqual({
      fecha_apertura: '2026-10-06', compras: [{ fecha: '2026-10-06', monto: '25' }, { fecha: '2026-10-13', monto: '40' }],
      ventas_previas: 0, costo_promedio_ponderado: '86.66666667', rol: 'core',
    });
    expect(r.hechos.posiciones_abiertas).toBe(4);
  });
  it('cuenta ventas previas solo de tipo sell y no las suma al costo promedio', () => {
    const v = { id: 'v1', trade_id: TR, execution_type: 'sell', price: 120, quantity: 0.1, executed_at: '2026-10-20T10:00:00', total: 12 };
    const r = resolverHechosPosicion(filas({ ejecuciones: [compra('e1', 100, 1, 100), v, { ...v, id: 'v2' }] }), Q);
    expect(r.ok && r.hechos.posicion?.ventas_previas).toBe(2);
    expect(r.ok && r.hechos.posicion?.costo_promedio_ponderado).toBe('100');
    expect(r.ok && r.hechos.posicion?.compras).toHaveLength(1);
  });
  it('ignora ejecuciones de otras posiciones (otro trade_id)', () => {
    const otra = { ...compra('x', 5, 1, 5), trade_id: 'otro' };
    const r = resolverHechosPosicion(filas({ ejecuciones: [compra('e1', 100, 1, 100), otra] }), Q);
    expect(r.ok && r.hechos.posicion?.compras).toHaveLength(1);
    expect(r.ok && r.hechos.posicion?.costo_promedio_ponderado).toBe('100');
  });
  it('ignora posiciones de otro portafolio u otro ticker', () => {
    const f = filas({ posiciones: [{ trade_id: 'z', portfolio_id: 'otro', ticker: 'MSFT', fecha_apertura: '2026-10-01' }, { trade_id: 'y', portfolio_id: PF, ticker: 'AAPL', fecha_apertura: '2026-10-01' }, ...filas().posiciones] });
    expect(resolverHechosPosicion(f, Q).ok).toBe(true);
  });
  it('acepta montos y cantidades como texto numérico de la base', () => {
    const r = resolverHechosPosicion(filas({ ejecuciones: [compra('e1', '100.50', '0.5', '50.25')] }), Q);
    expect(r.ok && r.hechos.posicion?.compras).toEqual([{ fecha: '2026-10-06', monto: '50.25' }]);
    expect(r.ok && r.hechos.posicion?.costo_promedio_ponderado).toBe('100.5');
  });
  it('redondea half-up el costo promedio a 8 decimales', () => {
    // (1/3 + 1/3 ...) 100 / 3 = 33.33333333(3) → 33.33333333 ; 200 / 3 = 66.66666666(6) → 66.66666667
    const a = resolverHechosPosicion(filas({ ejecuciones: [compra('e1', 100, 1, 100), compra('e2', 100, 1, 100), compra('e3', 100, 1, 100)].map((e, i) => ({ ...e, price: i === 0 ? 100 : 100 })) }), Q);
    expect(a.ok && a.hechos.posicion?.costo_promedio_ponderado).toBe('100');
    const b = resolverHechosPosicion(filas({ ejecuciones: [compra('e1', '66.66666666', 3, 200)] }), Q);
    expect(b.ok && b.hechos.posicion?.costo_promedio_ponderado).toBe('66.66666666');
    const c = resolverHechosPosicion(filas({ ejecuciones: [compra('e1', 100, 3, 300), compra('e2', '0.00000001', 1, 1)] }), Q);
    // (300 + 0.00000001) / 4 = 75.0000000025 → half-up 8 decimales = 75.00000000 → "75"
    expect(c.ok && c.hechos.posicion?.costo_promedio_ponderado).toBe('75');
    const d = resolverHechosPosicion(filas({ ejecuciones: [compra('e1', 100, 3, 300), compra('e2', '0.00000003', 1, 1)] }), Q);
    // (300.00000003) / 4 = 75.0000000075 → 75.00000001
    expect(d.ok && d.hechos.posicion?.costo_promedio_ponderado).toBe('75.00000001');
  });

  it('problemas: la base contradice al Orquestador', () => {
    expect(problemas(filas({ posiciones: [] }))).toMatch(/no la tiene abierta/);
    expect(problemas(filas(), { ...Q, posicion_existe: false })).toMatch(/declaró que no hay posición/);
    expect(problemas(filas({ posiciones: [...filas().posiciones, ...filas().posiciones] }))).toMatch(/2 posiciones abiertas/);
  });
  it('el monto es el total de la base (incluye comisión), no precio por cantidad', () => {
    const r = resolverHechosPosicion(filas({ ejecuciones: [compra('e1', 100, 1, 101.5)] }), Q);
    expect(r.ok && r.hechos.posicion?.compras).toEqual([{ fecha: '2026-10-06', monto: '101.5' }]);
  });
  it('con existe=false y una fila abierta devuelve solo la contradicción, sin leer compras', () => {
    const r = resolverHechosPosicion(filas({ ejecuciones: [] }), { ...Q, posicion_existe: false });
    expect(r).toEqual({ ok: false, problemas: ['MSFT: el Orquestador declaró que no hay posición pero la base la tiene abierta'] });
  });
  it('sin posición (existe=false y la base coincide) no lee compras ni exige fecha, pero sí capital', () => {
    const r = resolverHechosPosicion(filas({ posiciones: [], ejecuciones: [] }), { ...Q, posicion_existe: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hechos.posicion?.compras).toBeUndefined();
    expect(r.trade_id).toBeNull();
    expect(r.hechos.posiciones_abiertas).toBe(4);
  });
  it('problemas: fecha de apertura, trade_id y compras faltantes o inválidas (sin estimar)', () => {
    expect(problemas(filas({ posiciones: [{ trade_id: TR, portfolio_id: PF, ticker: 'MSFT', fecha_apertura: null }] }))).toMatch(/fecha_apertura/);
    expect(problemas(filas({ posiciones: [{ trade_id: TR, portfolio_id: PF, ticker: 'MSFT', fecha_apertura: '06/10/2026' }] }))).toMatch(/fecha_apertura/);
    expect(problemas(filas({ posiciones: [{ trade_id: null, portfolio_id: PF, ticker: 'MSFT', fecha_apertura: '2026-10-06' }] }))).toMatch(/trade_id/);
    expect(problemas(filas({ ejecuciones: [] }))).toMatch(/no tiene compras/);
    expect(problemas(filas({ ejecuciones: [compra('e1', 100, 1, 100, null)] }))).toMatch(/sin fecha/);
    expect(problemas(filas({ ejecuciones: [compra('e1', 100, 1, 100, 'ayer')] }))).toMatch(/sin fecha/);
    expect(problemas(filas({ ejecuciones: [compra('e1', 100, 1, null)] }))).toMatch(/sin total/);
    expect(problemas(filas({ ejecuciones: [compra('e1', 100, 1, 0)] }))).toMatch(/sin total/);
    expect(problemas(filas({ ejecuciones: [compra('e1', 100, 1, -5)] }))).toMatch(/sin total/);
    expect(problemas(filas({ ejecuciones: [compra('e1', null, 1, 100)] }))).toMatch(/precio o cantidad/);
    expect(problemas(filas({ ejecuciones: [compra('e1', 100, 0, 100)] }))).toMatch(/precio o cantidad/);
    expect(problemas(filas({ ejecuciones: [compra('e1', 0, 1, 100)] }))).toMatch(/precio o cantidad/);
    expect(problemas(filas({ ejecuciones: [compra('e1', 100, null, 100)] }))).toMatch(/precio o cantidad/);
    expect(problemas(filas({ ejecuciones: [compra('e1', 100, -1, 100)] }))).toMatch(/precio o cantidad/);
  });
  it('problemas: ejecución de cierre en posición abierta y tipo desconocido', () => {
    expect(problemas(filas({ ejecuciones: [compra('e1', 100, 1, 100), { ...compra('c', 1, 1, 1), execution_type: 'close' }] }))).toMatch(/ejecución de cierre/);
    expect(problemas(filas({ ejecuciones: [compra('e1', 100, 1, 100), { ...compra('c', 1, 1, 1), execution_type: 'split' }] }))).toMatch(/desconocido "split"/);
  });
  it('problemas: capital y expediente', () => {
    expect(problemas(filas({ capital: [] }))).toMatch(/oficina_v_capital: se esperaba 1 fila/);
    expect(problemas(filas({ capital: [...filas().capital, ...filas().capital] }))).toMatch(/hay 2/);
    expect(problemas(filas({ capital: [{ portfolio_id: 'otro', posiciones_abiertas: 4 }] }))).toMatch(/hay 0/);
    expect(problemas(filas({ capital: [{ portfolio_id: PF, posiciones_abiertas: '4' }] }))).toMatch(/posiciones_abiertas inválido/);
    expect(problemas(filas({ capital: [{ portfolio_id: PF, posiciones_abiertas: -1 }] }))).toMatch(/posiciones_abiertas inválido/);
    expect(problemas(filas({ capital: [{ portfolio_id: PF, posiciones_abiertas: 1.5 }] }))).toMatch(/posiciones_abiertas inválido/);
    expect(problemas(filas({ expedientes: [...filas().expedientes, ...filas().expedientes] }))).toMatch(/2 expedientes/);
  });
  it('plan_pcp: solo cuenta si la ficha lo trae declarado; una propuesta pendiente es plan no declarado', () => {
    const conFicha = (ficha: unknown) => filas({ expedientes: [{ id: EX, ticker: 'MSFT', portfolio_id: PF, rol_posicion: 'core', ficha }] });
    const plan = (ficha: unknown, q = Q) => { const r = resolverHechosPosicion(conFicha(ficha), q); return r.ok ? r.hechos.posicion?.plan_pcp : 'PROBLEMA'; };
    expect(plan({ plan_pcp: { modalidad: 'escalonado', estado: 'declarado' } })).toBe('escalonado');
    expect(plan({ plan_pcp: { modalidad: 'una_compra', estado: 'declarado' } })).toBe('una_compra');
    expect(plan({ plan_pcp: { modalidad: 'escalonado', estado: 'pendiente_de_validacion' } })).toBeUndefined();
    expect(plan({ plan_pcp: { modalidad: 'escalonado' } })).toBeUndefined();
    expect(plan({ plan_pcp: { estado: 'declarado' } })).toBe('PROBLEMA');
    expect(plan({ plan_pcp: { modalidad: 'otro', estado: 'declarado' } })).toBe('PROBLEMA');
    expect(plan({})).toBeUndefined();
    expect(plan(null)).toBeUndefined();
    expect(plan('texto')).toBeUndefined();
    expect(plan([{ modalidad: 'escalonado', estado: 'declarado' }])).toBeUndefined();
    expect(plan({ plan_pcp: null })).toBeUndefined();
    expect(plan({ plan_pcp: 'escalonado' })).toBeUndefined();
    expect(plan({ plan_pcp: [{ modalidad: 'escalonado', estado: 'declarado' }] })).toBeUndefined();
    expect(plan(Object.assign([], { plan_pcp: { modalidad: 'escalonado', estado: 'declarado' } }))).toBeUndefined();
    expect(plan({ plan_pcp: Object.assign([], { modalidad: 'escalonado', estado: 'declarado' }) })).toBeUndefined();
    const conRol = resolverHechosPosicion(conFicha({ plan_pcp: { modalidad: 'escalonado', estado: 'declarado' } }), Q);
    expect(conRol.ok && conRol.hechos.posicion?.rol).toBe('core');
    expect(plan({ otra_clave: { modalidad: 'escalonado', estado: 'declarado' } })).toBeUndefined();
    const sin = resolverHechosPosicion(conFicha({ plan_pcp: { modalidad: 'escalonado', estado: 'declarado' } }), { ...Q, posicion_existe: false });
    expect(sin.ok).toBe(false); // la base tiene la posición abierta y se declaró que no
    const r = resolverHechosPosicion({ ...conFicha({ plan_pcp: { modalidad: 'escalonado', estado: 'declarado' } }), posiciones: [], ejecuciones: [] }, { ...Q, posicion_existe: false });
    expect(r.ok && r.hechos.posicion?.plan_pcp).toBeUndefined();
    const m = resolverHechosPosicion(conFicha({ plan_pcp: { modalidad: 'otro', estado: 'declarado' } }), Q);
    expect(!m.ok && m.problemas.join()).toMatch(/modalidad inválida \(otro\)/);
  });
  it('sin expediente: no inventa rol ni id (la persistencia lo exigirá)', () => {
    const r = resolverHechosPosicion(filas({ expedientes: [] }), Q);
    expect(r.ok && r.expediente_id).toBeNull();
    expect(r.ok && r.hechos.posicion?.rol).toBeUndefined();
    const s = resolverHechosPosicion(filas({ expedientes: [{ id: EX, ticker: 'MSFT', portfolio_id: PF, rol_posicion: null, ficha: {} }] }), Q);
    expect(s.ok && s.hechos.posicion?.rol).toBeUndefined();
    expect(s.ok && s.expediente_id).toBe(EX);
    const o = resolverHechosPosicion(filas({ expedientes: [{ id: 'z', ticker: 'AAPL', portfolio_id: PF, rol_posicion: 'x', ficha: {} }, { id: 'w', ticker: 'MSFT', portfolio_id: 'otro', rol_posicion: 'y', ficha: {} }] }), Q);
    expect(o.ok && o.expediente_id).toBeNull();
  });
});

// ---------------------------------------------------------------- lector
type Llamada = { tabla: string; cols: string; filtros: [string, string][] };
function clienteLectura(datos: Record<string, unknown[] | { error: string }>, llamadas: Llamada[] = []): ClienteLectura {
  return {
    from(tabla) {
      return {
        select(cols) {
          const l: Llamada = { tabla, cols, filtros: [] };
          llamadas.push(l);
          const q = {
            eq(c: string, v: string) { l.filtros.push([c, v]); return q; },
            then(ok: (r: { data: unknown[] | null; error: { message: string } | null }) => unknown) {
              const d = datos[tabla];
              return Promise.resolve(ok(d === undefined ? { data: null, error: null } : Array.isArray(d) ? { data: d, error: null } : { data: null, error: { message: d.error } }));
            },
          };
          return q as never;
        },
      };
    },
  };
}
const DATOS = () => { const f = filas(); return { oficina_v_posiciones: f.posiciones, trade_executions: f.ejecuciones, oficina_v_capital: f.capital, oficina_expedientes: f.expedientes }; };

describe('cargarHechosPosicion', () => {
  it('lee las 4 tablas con los filtros correctos y devuelve los mismos hechos que la función pura', async () => {
    const ll: Llamada[] = [];
    const r = await cargarHechosPosicion(clienteLectura(DATOS(), ll), Q);
    expect(r).toEqual(resolverHechosPosicion(filas(), Q));
    expect(ll).toEqual([
      { tabla: 'oficina_v_posiciones', cols: 'trade_id,portfolio_id,ticker,fecha_apertura', filtros: [['portfolio_id', PF], ['ticker', 'MSFT']] },
      { tabla: 'trade_executions', cols: 'id,trade_id,execution_type,price,quantity,executed_at,total', filtros: [['trade_id', TR]] },
      { tabla: 'oficina_v_capital', cols: 'portfolio_id,posiciones_abiertas', filtros: [['portfolio_id', PF]] },
      { tabla: 'oficina_expedientes', cols: 'id,ticker,portfolio_id,rol_posicion,ficha', filtros: [['portfolio_id', PF], ['ticker', 'MSFT']] },
    ]);
  });
  it('si no hay posición no consulta ejecuciones', async () => {
    const ll: Llamada[] = [];
    const d = { ...DATOS(), oficina_v_posiciones: [] };
    const r = await cargarHechosPosicion(clienteLectura(d, ll), { ...Q, posicion_existe: false });
    expect(r.ok).toBe(true);
    expect(ll.map((x) => x.tabla)).toEqual(['oficina_v_posiciones', 'oficina_v_capital', 'oficina_expedientes']);
  });
  it('si la posición no coincide con lo declarado no consulta ejecuciones y devuelve el problema', async () => {
    const ll: Llamada[] = [];
    const r = await cargarHechosPosicion(clienteLectura(DATOS(), ll), { ...Q, posicion_existe: false });
    expect(r.ok).toBe(false);
    expect(ll.map((x) => x.tabla)).not.toContain('trade_executions');
  });
  it('no consulta ejecuciones si hay más de una posición ni si falta trade_id', async () => {
    const ll: Llamada[] = [];
    await cargarHechosPosicion(clienteLectura({ ...DATOS(), oficina_v_posiciones: [...filas().posiciones, ...filas().posiciones] }, ll), Q);
    expect(ll.map((x) => x.tabla)).not.toContain('trade_executions');
    const l2: Llamada[] = [];
    const r = await cargarHechosPosicion(clienteLectura({ ...DATOS(), oficina_v_posiciones: [{ trade_id: null, portfolio_id: PF, ticker: 'MSFT', fecha_apertura: '2026-10-06' }] }, l2), Q);
    expect(l2.map((x) => x.tabla)).not.toContain('trade_executions');
    expect(r.ok).toBe(false);
  });
  for (const t of ['oficina_v_posiciones', 'trade_executions', 'oficina_v_capital', 'oficina_expedientes']) {
    it(`devuelve el error de la base de ${t} tal cual y se detiene`, async () => {
      const ll: Llamada[] = [];
      const r = await cargarHechosPosicion(clienteLectura({ ...DATOS(), [t]: { error: 'boom' } }, ll), Q);
      expect(r).toEqual({ ok: false, problemas: [`${t}: boom`], error_bd: `${t}: boom` });
      expect(ll[ll.length - 1]?.tabla).toBe(t);
    });
    it(`falla si ${t} no devuelve filas`, async () => {
      const d: Record<string, unknown[] | { error: string }> = { ...DATOS() };
      delete d[t];
      const r = await cargarHechosPosicion(clienteLectura(d), Q);
      expect(r).toEqual({ ok: false, problemas: [`${t}: la consulta no devolvió filas`], error_bd: `${t}: la consulta no devolvió filas` });
    });
  }
});

// ---------------------------------------------------------------- persistencia
const SALIDA = {
  contrato: 'auditoria.v1', agente: AGENTE_AUDITOR, run_id: 'r', snapshot_id: 's', hash_entrada: 'h', ticker: 'MSFT', portafolio_codigo: 'PMP',
  tipo_evaluacion: 'nueva_posicion', veredicto: 'CUMPLE', resumen: 'ok', resultados_reglas: [], infracciones: [], filtros_fallidos: [],
  advertencias_referenciales: [], reglas_delegadas: [], tareas_sugeridas: [], datos_faltantes: [], datos_fuente: [{ id: 'd1' }],
} as unknown as SalidaAuditor;
const IDS = { user_id: US, expediente_id: EX, ejecucion_id: EJ };

describe('filaAnalisisAuditor', () => {
  it('mapea la salida a las columnas de oficina_analisis (puntaje, confianza, supuestos e invalidadores en null)', () => {
    const r = filaAnalisisAuditor(SALIDA, IDS);
    const o = filaAnalisisAuditor({ ...SALIDA, veredicto: 'NO_ELEGIBLE' } as SalidaAuditor, IDS);
    expect(o.ok && o.fila['veredicto']).toBe('NO_ELEGIBLE');
    expect(r).toEqual({
      ok: true,
      fila: { user_id: US, ejecucion_id: EJ, expediente_id: EX, agente: 'auditor_reglas', veredicto: 'CUMPLE', puntaje: null, confianza: null, salida: SALIDA, datos_fuente: [{ id: 'd1' }], supuestos: null, invalidadores: null },
    });
  });
  it('user_id opcional: sin él la fila no lo lleva (lo pone la base)', () => {
    const { user_id: _u, ...sin } = IDS;
    const r = filaAnalisisAuditor(SALIDA, sin);
    expect(r.ok).toBe(true);
    expect(r.ok && 'user_id' in r.fila).toBe(false);
    const n = filaAnalisisAuditor(SALIDA, { ...IDS, user_id: null });
    expect(n.ok).toBe(true);
    expect(n.ok && 'user_id' in n.fila).toBe(false);
  });
  it('ejecucion_id puede ser null; expediente_id no', () => {
    expect(filaAnalisisAuditor(SALIDA, { ...IDS, ejecucion_id: null }).ok).toBe(true);
    const r = filaAnalisisAuditor(SALIDA, { ...IDS, expediente_id: null });
    expect(!r.ok && r.problemas.join()).toMatch(/expediente_id/);
  });
  it('rechaza ids inválidos, agente distinto, sin veredicto o sin datos_fuente', () => {
    const p = (s: unknown, i = IDS) => { const r = filaAnalisisAuditor(s as SalidaAuditor, i); return r.ok ? '' : r.problemas.join(' | '); };
    expect(p(SALIDA, { ...IDS, user_id: 'x' })).toMatch(/user_id/);
    expect(p(SALIDA, { ...IDS, expediente_id: 'x' })).toMatch(/expediente_id/);
    expect(p(SALIDA, { ...IDS, ejecucion_id: 'x' })).toMatch(/ejecucion_id/);
    expect(p({ ...SALIDA, agente: 'otro' })).toMatch(/agente inesperado/);
    expect(p({ ...SALIDA, veredicto: '' })).toMatch(/veredicto/);
    expect(p({ ...SALIDA, veredicto: undefined })).toMatch(/veredicto/);
    expect(p({ ...SALIDA, datos_fuente: null })).toMatch(/datos_fuente/);
  });
});

function clienteInsercion(r: { data: unknown; error: { message: string } | null } | 'lanza', log: { tabla?: string; fila?: unknown; cols?: string } = {}): ClienteInsercion {
  return {
    from(tabla) {
      log.tabla = tabla;
      return { insert(fila) { log.fila = fila; return { select(cols) { log.cols = cols; return { single() { if (r === 'lanza') throw new Error('red caída'); return Promise.resolve(r); } }; } }; } };
    },
  };
}
describe('guardarAnalisisAuditor', () => {
  it('inserta en oficina_analisis y devuelve el id', async () => {
    const log: { tabla?: string; fila?: unknown; cols?: string } = {};
    const r = await guardarAnalisisAuditor(clienteInsercion({ data: { id: AN }, error: null }, log), SALIDA, IDS);
    expect(r).toEqual({ ok: true, analisis_id: AN });
    expect(log.tabla).toBe('oficina_analisis');
    expect(log.cols).toBe('id');
    expect(log.fila).toEqual((filaAnalisisAuditor(SALIDA, IDS) as { fila: unknown }).fila);
  });
  it('no toca la base si la fila es inválida', async () => {
    const log: { tabla?: string } = {};
    const r = await guardarAnalisisAuditor(clienteInsercion({ data: { id: AN }, error: null }, log), SALIDA, { ...IDS, expediente_id: null });
    expect(r.ok).toBe(false);
    expect(log.tabla).toBeUndefined();
  });
  it('devuelve el error de la base tal cual', async () => {
    const r = await guardarAnalisisAuditor(clienteInsercion({ data: null, error: { message: 'fk violada' } }), SALIDA, IDS);
    expect(r).toEqual({ ok: false, problemas: ['oficina_analisis: fk violada'], error_bd: 'fk violada' });
  });
  it('falla si no vuelve un id válido o si el cliente lanza', async () => {
    expect((await guardarAnalisisAuditor(clienteInsercion({ data: { id: 'x' }, error: null }), SALIDA, IDS)).ok).toBe(false);
    expect((await guardarAnalisisAuditor(clienteInsercion({ data: null, error: null }), SALIDA, IDS)).ok).toBe(false);
    const r = await guardarAnalisisAuditor(clienteInsercion('lanza'), SALIDA, IDS);
    expect(r).toEqual({ ok: false, problemas: ['oficina_analisis: red caída'], error_bd: 'red caída' });
    const s = await guardarAnalisisAuditor({ from() { throw 'texto'; } } as unknown as ClienteInsercion, SALIDA, IDS);
    expect(s).toEqual({ ok: false, problemas: ['oficina_analisis: texto'], error_bd: 'texto' });
  });
});
