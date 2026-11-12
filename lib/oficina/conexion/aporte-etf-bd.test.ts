import { describe, expect, it } from 'vitest';
import { CATALOGO_FIXTURE } from '../auditor/catalogo-fixture';
import { armarDatosAporteEtf, correrAporteEtf, lunesDeLaSemana } from './index';
import type { ClienteCorridaEtf } from './index';

const PF = '11111111-1111-4111-8111-111111111111';
type Fila = Record<string, unknown>;
const SECTORIALES = ['XLK', 'XLF', 'XLV', 'XLE', 'XLI', 'XLP', 'XLY', 'XLU', 'XLB', 'XLRE', 'XLC'];
const AHORA = '2026-10-28T10:00:00-06:00'; // miércoles; semana desde el lunes 2026-10-26

interface Espia { orden: string[]; inserts: { tabla: string; fila: Fila }[]; rpc: { fn: string; args: Record<string, unknown> }[]; filtros: Record<string, [string, string][][]> }
function filasReglas(): Record<string, Fila[]> {
  return {
    oficina_reglas: CATALOGO_FIXTURE.map((r) => ({ id: `r-${r.codigo}`, codigo: r.codigo, caracter: r.caracter })),
    oficina_reglas_versiones: CATALOGO_FIXTURE.map((r) => ({ id: r.version_id, regla_id: `r-${r.codigo}`, version: 1, definicion: r.definicion, estado: 'vigente', vigente_desde: r.vigente_desde, vigente_hasta: null })),
    oficina_reglas_clasificacion: CATALOGO_FIXTURE.map((r) => ({ regla_id: `r-${r.codigo}`, clase: r.clase, componente_delegado: r.componente_delegado, aplica_a: r.aplica_a, vigente_desde: '2026-10-13', vigente_hasta: null })),
  };
}
function posiciones(tickers = [...SECTORIALES, 'IVV PESOS', 'GBTC', 'QQQ']): Fila[] {
  return tickers.map((t, i) => ({ trade_id: `t-${i}`, portfolio_id: PF, ticker: t, fecha_apertura: '2026-09-30' }));
}
const COMPRA_INICIAL: Fila = { id: 'e0', trade_id: 't-0', execution_type: 'buy', price: 200, quantity: 0.01, executed_at: '2026-09-30T14:30:00', total: 2 };
const capital = (efectivo: unknown): Fila[] => [{ portfolio_id: PF, efectivo, posiciones_abiertas: 14 }];
const PARAMS: Fila[] = [
  { clave: 'orquestador.margen_cierre_velas', valor: { valor: 30, unidad: 'minutos' }, version: 1, vigente_desde: '2026-10-22', aprobado_at: null },
  { clave: 'frescura.precio', valor: { dias_habiles: 1 }, version: 1, vigente_desde: '2026-10-14', aprobado_at: null },
];
function nuevaBd(extra: Record<string, Fila[]> = {}, errores: { tablas?: Record<string, string>; insert?: string; rpc?: string } = {}) {
  const tablas: Record<string, Fila[]> = {
    ...filasReglas(), oficina_portafolios_config: [{ portfolio_id: PF, codigo: 'ETF' }], oficina_v_posiciones: posiciones(), trade_executions: [COMPRA_INICIAL],
    oficina_v_capital: capital(30), oficina_expedientes: [], oficina_analisis: [], oficina_parametros: PARAMS, ...extra,
  };
  const e: Espia = { orden: [], inserts: [], rpc: [], filtros: {} };
  let n = 0;
  const cliente = {
    from(tabla: string) {
      return {
        select() {
          e.orden.push(`select:${tabla}`);
          const filtros: [string, string][] = [];
          (e.filtros[tabla] ??= []).push(filtros);
          const q = {
            eq(c: string, v: string) { filtros.push([c, v]); return q; },
            then(ok: (r: { data: unknown[] | null; error: { message: string } | null }) => unknown) {
              const err = errores.tablas?.[tabla];
              if (err) return Promise.resolve(ok({ data: null, error: { message: err } }));
              return Promise.resolve(ok({ data: (tablas[tabla] ?? []).filter((r) => filtros.every(([c, v]) => r[c] === v)), error: null }));
            },
          };
          return q;
        },
        insert(fila: Fila) {
          e.orden.push(`insert:${tabla}`);
          e.inserts.push({ tabla, fila });
          return {
            select() {
              return {
                single() {
                  if (errores.insert) return Promise.resolve({ data: null, error: { message: errores.insert } });
                  const id = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
                  (tablas[tabla] ??= []).push({ id, ...fila, ...(tabla === 'oficina_expedientes' ? { rol_posicion: null, ficha: {} } : {}) });
                  return Promise.resolve({ data: { id }, error: null });
                },
              };
            },
          };
        },
      };
    },
    rpc(fn: string, args: Record<string, unknown>) {
      e.orden.push(`rpc:${fn}`);
      e.rpc.push({ fn, args });
      return Promise.resolve({ error: errores.rpc ? { message: errores.rpc } : null });
    },
  } as unknown as ClienteCorridaEtf;
  return { cliente, tablas, e };
}
const dep = (n0 = 0) => { let n = n0; let t = 0; return { nuevoId: () => `00000000-0000-4000-9000-${String(++n).padStart(12, '0')}`, ahora: () => (t++ === 0 ? AHORA : AHORA) }; };

describe('lunesDeLaSemana', () => {
  it('lunes a domingo', () => {
    expect(lunesDeLaSemana('2026-10-26')).toBe('2026-10-26'); // lunes
    expect(lunesDeLaSemana('2026-10-28')).toBe('2026-10-26'); // miércoles
    expect(lunesDeLaSemana('2026-11-01')).toBe('2026-10-26'); // domingo
    expect(lunesDeLaSemana('2026-11-02')).toBe('2026-11-02');
    expect(lunesDeLaSemana('2026-01-01')).toBe('2025-12-29'); // cruza de año
  });
});

describe('armarDatosAporteEtf', () => {
  const armar = (b = nuevaBd(), ticker = 'XLK', ahora = AHORA) => armarDatosAporteEtf(b.cliente, { ticker, ahora, snapshot_id: 'snap-1' });
  it('arma los datos con efectivo, 11 sectoriales (sin IVV PESOS, GBTC ni QQQ) y sin duplicado', async () => {
    const b = nuevaBd();
    const r = await armar(b);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos).toMatchObject({
      snapshot_id: 'snap-1', snapshot_generado_en: AHORA, snapshot_fecha_datos: '2026-10-28', expediente_id: null, posicion_existe: true, reglas_versiones_ids: [],
      tesis_ref: null, velas: null, sobres: {}, sobre_auditor: null, motor: {}, aporte_semanal: { efectivo_disponible: '30', etfs_sectoriales: 11, duplicado: false },
    });
    expect(r.datos.parametros).toHaveLength(2);
    expect(r.resumen).toEqual({ etfs_sectoriales: 11, efectivo_disponible: '30', duplicado: false, semana_desde: '2026-10-26' });
    expect(b.e.filtros['oficina_v_posiciones']?.[0]).toEqual([['portfolio_id', PF]]);
    expect(b.e.filtros['trade_executions']?.[0]).toEqual([['trade_id', 't-0']]);
  });
  it('el ticker se normaliza (minúsculas y espacios)', async () => {
    expect((await armar(nuevaBd(), '  xlk ')).ok).toBe(true);
  });
  it('duplicado: una compra del mismo ETF en la semana en curso (lunes a hoy)', async () => {
    const compra = (f: string, tipo = 'buy', trade = 't-0') => ({ id: 'e1', trade_id: trade, execution_type: tipo, executed_at: f });
    const con = async (e: Fila[]) => { const r = await armar(nuevaBd({ trade_executions: e })); return r.ok ? r.datos.aporte_semanal?.duplicado : 'PROBLEMA'; };
    expect(await con([compra('2026-10-26T09:00:00')])).toBe(true);     // lunes
    expect(await con([compra('2026-10-28T09:00:00')])).toBe(true);     // hoy
    expect(await con([compra('2026-10-25T23:59:00')])).toBe(false);    // domingo anterior
    expect(await con([compra('2026-09-30T14:30:00')])).toBe(false);    // primera compra
    expect(await con([compra('2026-10-27T09:00:00', 'sell')])).toBe(false);
    expect(await con([compra('2026-10-27T09:00:00', 'close')])).toBe(false);
    expect(await con([compra('2026-10-29T09:00:00')])).toBe(false);    // futuro: no cuenta
    expect(await con([compra('2026-09-30T14:30:00'), compra('2026-10-27T09:00:00')])).toBe(true);
    expect(await con([compra('sin fecha')])).toBe('PROBLEMA');
    expect(await con([{ id: 'e2', trade_id: 't-0', execution_type: 'buy', executed_at: null }])).toBe('PROBLEMA');
  });
  it('la fecha de hoy es la de America/Mexico_City (20:00 del 28 en México ya es 29 en UTC)', async () => {
    const r = await armar(nuevaBd(), 'XLK', '2026-10-28T20:00:00-06:00');
    expect(r.ok && r.resumen.semana_desde).toBe('2026-10-26');
    expect(r.ok && r.datos.snapshot_fecha_datos).toBe('2026-10-28');
    const lun = await armar(nuevaBd({ trade_executions: [{ id: 'e', trade_id: 't-0', execution_type: 'buy', executed_at: '2026-11-02T01:00:00' }] }), 'XLK', '2026-11-01T20:00:00-06:00');
    expect(lun.ok && lun.datos.aporte_semanal?.duplicado).toBe(false); // domingo 1-nov en México; el 2-nov (lunes UTC) aún no llega
  });
  it('efectivo: numérico o texto; ausente, negativo o inválido es problema', async () => {
    const con = async (ef: unknown) => { const r = await armar(nuevaBd({ oficina_v_capital: [{ portfolio_id: PF, efectivo: ef }] })); return r.ok ? r.datos.aporte_semanal?.efectivo_disponible : r.problemas.join(); };
    expect(await con(10.5)).toBe('10.5');
    expect(await con('7.99')).toBe('7.99');
    expect(await con(0)).toBe('0');
    expect(await con(null)).toMatch(/efectivo ausente o inválido/);
    expect(await con(-1)).toMatch(/efectivo ausente o inválido/);
    expect(await con('abc')).toMatch(/efectivo ausente o inválido/);
    expect(await con(undefined)).toMatch(/efectivo ausente o inválido/);
    expect(await con({})).toMatch(/efectivo ausente o inválido/);
    const r0 = await armar(nuevaBd({ oficina_v_capital: [] }));
    expect(!r0.ok && r0.problemas.join()).toMatch(/se esperaba 1 fila del portafolio ETF y hay 0/);
    const r2 = await armar(nuevaBd({ oficina_v_capital: [{ portfolio_id: PF, efectivo: 1 }, { portfolio_id: PF, efectivo: 2 }] }));
    expect(!r2.ok && r2.problemas.join()).toMatch(/hay 2/);
  });
  it('no arma si no hay exactamente 11 sectoriales (ni más ni menos) ni cuenta los excluidos', async () => {
    const menos = await armar(nuevaBd({ oficina_v_posiciones: posiciones(SECTORIALES.slice(0, 10)) }));
    expect(!menos.ok && menos.problemas.join()).toMatch(/se esperaban 11 ETFs sectoriales con posición y hay 10/);
    const mas = await armar(nuevaBd({ oficina_v_posiciones: posiciones([...SECTORIALES, 'XLZ']) }));
    expect(!mas.ok && mas.problemas.join()).toMatch(/y hay 12/);
    const sinExcluidos = await armar(nuevaBd({ oficina_v_posiciones: posiciones(SECTORIALES) }));
    expect(sinExcluidos.ok).toBe(true); // los excluidos no suman ni restan
    const duplicados = await armar(nuevaBd({ oficina_v_posiciones: posiciones([...SECTORIALES, 'XLK']) }));
    expect(!duplicados.ok && duplicados.problemas.join()).toMatch(/más de una posición abierta/);
    const raro = await armar(nuevaBd({ oficina_v_posiciones: [...posiciones(), { trade_id: 'x', portfolio_id: PF, ticker: null }] }));
    expect(raro.ok).toBe(true); // una fila sin ticker no cuenta como sectorial
  });
  it('usa el trade_id de la posición del ETF evaluado (no el de otra)', async () => {
    const b = nuevaBd();
    const r = await armar(b, 'XLF');
    expect(r.ok).toBe(true);
    expect(b.e.filtros['trade_executions']?.[0]).toEqual([['trade_id', 't-1']]);
  });
  it('tickers de la base con espacios o minúsculas cuentan igual; trade_id vacío es problema', async () => {
    const raros = posiciones().map((p) => ({ ...p, ticker: ` ${String(p['ticker']).toLowerCase()} ` }));
    expect((await armar(nuevaBd({ oficina_v_posiciones: raros }))).ok).toBe(true);
    const vacio = await armar(nuevaBd({ oficina_v_posiciones: posiciones().map((p, i) => (i === 0 ? { ...p, trade_id: '' } : p)) }));
    expect(!vacio.ok && vacio.problemas.join()).toMatch(/no trae trade_id/);
  });
  it('el efectivo es el de la fila del portafolio ETF aunque haya filas de otros portafolios', async () => {
    const r = await armar(nuevaBd({ oficina_v_capital: [{ portfolio_id: 'otro', efectivo: 999 }, { portfolio_id: PF, efectivo: 12 }] }));
    expect(r.ok && r.datos.aporte_semanal?.efectivo_disponible).toBe('12');
  });
  it('el ETF debe ser sectorial con una posición; los excluidos y desconocidos no se evalúan', async () => {
    for (const t of ['QQQ', 'GBTC', 'IVV PESOS', 'AAPL']) {
      const r = await armar(nuevaBd(), t);
      expect(!r.ok && r.problemas.join()).toMatch(/no es un ETF sectorial con una sola posición abierta/);
    }
    const sinTrade = await armar(nuevaBd({ oficina_v_posiciones: posiciones().map((p, i) => (i === 0 ? { ...p, trade_id: null } : p)) }));
    expect(!sinTrade.ok && sinTrade.problemas.join()).toMatch(/no trae trade_id/);
  });
  it('errores de la base tal cual, por tabla, y portafolio ETF inexistente', async () => {
    for (const t of ['oficina_v_posiciones', 'oficina_v_capital', 'trade_executions', 'oficina_parametros']) {
      const r = await armar(nuevaBd({}, { tablas: { [t]: 'boom' } }));
      expect(r).toEqual({ ok: false, problemas: [`${t}: boom`] });
    }
    const sinPf = await armar(nuevaBd({ oficina_portafolios_config: [] }));
    expect(!sinPf.ok && sinPf.problemas.join()).toMatch(/oficina_portafolios_config/);
    const nulo = { from() { return { select() { const q = { eq() { return q; }, then(ok: (r: unknown) => unknown) { return Promise.resolve(ok({ data: null, error: null })); } }; return q; } }; } } as never;
    expect((await armarDatosAporteEtf(nulo, { ticker: 'XLK', ahora: AHORA, snapshot_id: 's' })).ok).toBe(false);
  });
  it('ahora inválido o una excepción del cliente son problemas, no lanzan', async () => {
    expect(await armar(nuevaBd(), 'XLK', 'ayer')).toEqual({ ok: false, problemas: ['ahora inválido'] });
    const lanza = (v: unknown) => ({ from() { throw v; } }) as never;
    expect(await armarDatosAporteEtf(lanza(new Error('red caída')), { ticker: 'XLK', ahora: AHORA, snapshot_id: 's' })).toEqual({ ok: false, problemas: ['oficina_portafolios_config: red caída'] });
    const b = nuevaBd();
    const lanzaPos = { from(t: string) { if (t === 'oficina_v_posiciones') throw 'texto'; return (b.cliente as never as { from(t: string): unknown }).from(t); } } as never;
    expect(await armarDatosAporteEtf(lanzaPos, { ticker: 'XLK', ahora: AHORA, snapshot_id: 's' })).toEqual({ ok: false, problemas: ['texto'] });
    const lanzaErr = { from(t: string) { if (t === 'oficina_v_posiciones') throw new Error('x1'); return (b.cliente as never as { from(t: string): unknown }).from(t); } } as never;
    expect(await armarDatosAporteEtf(lanzaErr, { ticker: 'XLK', ahora: AHORA, snapshot_id: 's' })).toEqual({ ok: false, problemas: ['x1'] });
  });
});

describe('correrAporteEtf', () => {
  it('corrida real de la ruta determinista: expediente, Auditor, decisión del Motor y registro atómico', async () => {
    const b = nuevaBd();
    const r = await correrAporteEtf(b.cliente, { ticker: 'xlk' }, dep());
    expect(r.http).toBe(200);
    expect(r.cuerpo).toMatchObject({ ok: true, ticker: 'XLK', resultado: 'corrida', persistencia: { estado: 'guardada', filas_corrida: 1 } });
    expect(r.cuerpo['aporte']).toEqual({ etfs_sectoriales: 11, efectivo_disponible: '30', duplicado: false, semana_desde: '2026-10-26' });
    expect(b.e.rpc).toHaveLength(1);
    expect(b.e.rpc[0]?.fn).toBe('oficina_registrar_corrida');
    const corrida = b.e.rpc[0]?.args['p_corrida'] as Fila;
    expect(corrida['mercado']).toBe('US');
    const ejecs = b.e.rpc[0]?.args['p_ejecuciones'] as Fila[];
    expect(corrida).toMatchObject({ ticker: 'XLK', portafolio_codigo: 'ETF', tipo_evaluacion: 'aporte_periodico', ruta: 'determinista', disparador: 'usuario' });
    expect(corrida['corrida_id']).toBe(r.cuerpo['corrida_id']);
    expect(ejecs.map((x) => x['agente'])).toEqual(['auditor']);
    // análisis del Auditor guardado con el expediente real y enlazado en la corrida
    const analisis = b.tablas['oficina_analisis']?.[0];
    expect(analisis).toBeDefined();
    expect(corrida['auditoria_analisis_id']).toBe(analisis?.['id']);
    expect(corrida['expediente_id']).toBe(b.tablas['oficina_expedientes']?.[0]?.['id']);
    expect(b.tablas['oficina_expedientes']?.[0]).toMatchObject({ ticker: 'XLK', portafolio_codigo: 'ETF', tesis_origen: 'reconstruida' });
    // solo analiza y registra: nada de operaciones ni de TradingCat
    expect(b.e.inserts.map((i) => i.tabla).sort()).toEqual(['oficina_analisis', 'oficina_expedientes']);
    expect(b.e.orden.filter((o) => o.startsWith('insert:trade') || o.startsWith('update:trade') || o.startsWith('delete:trade'))).toEqual([]);
    expect(b.e.orden.indexOf('rpc:oficina_registrar_corrida')).toBeGreaterThan(b.e.orden.indexOf('insert:oficina_analisis'));
  });
  it('la respuesta no contiene tokens, claves ni cabeceras', async () => {
    const b = nuevaBd();
    const r = await correrAporteEtf(b.cliente, { ticker: 'XLK' }, dep());
    expect(JSON.stringify(r)).not.toMatch(/bearer|authorization|apikey|anon|secret|token/i);
  });
  it('si el duplicado es verdadero la corrida lo refleja (no hay aporte)', async () => {
    const b = nuevaBd({ trade_executions: [COMPRA_INICIAL, { id: 'e1', trade_id: 't-0', execution_type: 'buy', price: 200, quantity: 0.01, executed_at: '2026-10-27T09:00:00', total: 2 }] });
    const r = await correrAporteEtf(b.cliente, { ticker: 'XLK' }, dep());
    expect(r.cuerpo['aporte']).toMatchObject({ duplicado: true });
    expect(r.cuerpo['decision']).not.toBe('COMPRAR');
  });
  it('efectivo insuficiente: ningún aporte (ni parcial)', async () => {
    const b = nuevaBd({ oficina_v_capital: capital(3.99) });
    const r = await correrAporteEtf(b.cliente, { ticker: 'XLK' }, dep());
    expect(r.cuerpo['decision']).toBe('NO_COMPRAR');
  });
  it('tres niveles de aporte según el efectivo (USD 2 por ETF, USD 1 por ETF, ninguno)', async () => {
    const con = async (e: number) => (await correrAporteEtf(nuevaBd({ oficina_v_capital: capital(e) }).cliente, { ticker: 'XLK' }, dep())).cuerpo;
    const completo = await con(22);
    expect(completo['referencias']).toMatchObject({ aporte_modo: 'completo' });
    const reducido = await con(21.99);
    expect(reducido['referencias']).toMatchObject({ aporte_modo: 'reducido' });
    const ninguno = await con(10.99);
    expect(ninguno['referencias']).toMatchObject({ aporte_modo: 'ninguno' });
  });
  it('body inválido: 400 sin tocar la base', async () => {
    for (const body of [null, [], Object.assign([], { ticker: 'XLK' }), 'XLK', {}, { ticker: '' }, { ticker: 5 }, { ticker: 'xlk;drop' }, { ticker: 'XLK', portafolio_codigo: 'PMP' }]) {
      const b = nuevaBd();
      const r = await correrAporteEtf(b.cliente, body, dep());
      expect(r.http).toBe(400);
      expect(r.cuerpo['ok']).toBe(false);
      expect(b.e.orden).toEqual([]);
    }
    const r = await correrAporteEtf(nuevaBd().cliente, { ticker: 'XLK', portafolio_codigo: 'PMP' }, dep());
    expect(r.cuerpo['error']).toBe('campos no admitidos: portafolio_codigo');
    expect((await correrAporteEtf(nuevaBd().cliente, { ticker: 'IVV PESOS' }, dep())).http).toBe(422);
  });
  it('si no se pueden armar los datos reales: 422, nada registrado', async () => {
    const b = nuevaBd({ oficina_v_posiciones: posiciones(SECTORIALES.slice(0, 5)) });
    const r = await correrAporteEtf(b.cliente, { ticker: 'XLK' }, dep());
    expect(r.http).toBe(422);
    expect(r.cuerpo).toMatchObject({ ok: false, registrada: false });
    expect(b.e.rpc).toEqual([]);
    expect(b.e.inserts).toEqual([]);
  });
  it('si el registro atómico falla: 500 con el error tal cual (y no se dice que se guardó)', async () => {
    const b = nuevaBd({}, { rpc: 'rls denegado' });
    const r = await correrAporteEtf(b.cliente, { ticker: 'XLK' }, dep());
    expect(r.http).toBe(500);
    expect(r.cuerpo).toMatchObject({ ok: false, persistencia: { estado: 'fallo', error: 'rls denegado' } });
  });
  it('si el expediente no se puede crear: el Auditor falla y la corrida no queda completada, sin análisis', async () => {
    const b = nuevaBd({}, { insert: 'rls' });
    const r = await correrAporteEtf(b.cliente, { ticker: 'XLK' }, dep());
    expect(r.cuerpo['preparacion_auditor']).toMatchObject({ ok: false, etapa: 'expediente' });
    expect(r.cuerpo['estado_final']).not.toBe('completada');
    expect(JSON.stringify(r.cuerpo['motivos'])).toMatch(/auditor \(expediente\)/);
    expect(b.tablas['oficina_analisis']).toEqual([]);
  });
  it('los puertos de IA no se usan en la ruta determinista', async () => {
    const b = nuevaBd();
    const r = await correrAporteEtf(b.cliente, { ticker: 'XLK' }, dep());
    expect(((b.e.rpc[0]?.args['p_ejecuciones'] as Fila[]) ?? []).every((x) => x['agente'] === 'auditor')).toBe(true);
    expect(r.cuerpo['resultado']).toBe('corrida');
  });
});
