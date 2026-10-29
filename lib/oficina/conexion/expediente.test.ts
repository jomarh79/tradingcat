import { describe, expect, it } from 'vitest';
import { obtenerOCrearExpediente, verificarParametrosExpediente } from './index';
import type { ClienteExpediente, ParametrosExpediente } from './index';

const US = '44444444-4444-4444-8444-444444444444';
const PF = '11111111-1111-4111-8111-111111111111';
const EX = '33333333-3333-4333-8333-333333333333';
const EX2 = '77777777-7777-4777-8777-777777777777';
const P: ParametrosExpediente = { user_id: US, ticker: 'MSFT', mercado: 'US', portfolio_id: PF, portafolio_codigo: 'PCP', posicion_existe: true };

type Lectura = { data: unknown[] | null; error: { message: string } | null };
type Insercion = { data: unknown; error: { message: string; code?: string } | null };
interface Espia { lecturas: [string, string][][]; inserts: Record<string, unknown>[]; cols: string[] }
function cliente(lecturas: (Lectura | 'lanza')[], inserts: (Insercion | 'lanza')[], e: Espia = { lecturas: [], inserts: [], cols: [] }): ClienteExpediente {
  let nl = 0;
  let ni = 0;
  return {
    from(tabla) {
      if (tabla !== 'oficina_expedientes') throw new Error(`tabla inesperada ${tabla}`);
      return {
        select(cols) {
          e.cols.push(cols);
          const filtros: [string, string][] = [];
          e.lecturas.push(filtros);
          const q = {
            eq(c: string, v: string) { filtros.push([c, v]); return q; },
            then(ok: (r: Lectura) => unknown) {
              const r = lecturas[nl++];
              if (r === 'lanza') throw new Error('red caída');
              return Promise.resolve(ok(r ?? { data: null, error: null }));
            },
          };
          return q as never;
        },
        insert(fila) {
          e.inserts.push(fila);
          return { select(cols) { e.cols.push(cols); return { single() { const r = inserts[ni++]; if (r === 'lanza') throw new Error('red caída'); return Promise.resolve(r ?? { data: null, error: null }); } }; } };
        },
      };
    },
  };
}
const ok = (data: unknown[]): Lectura => ({ data, error: null });

describe('obtenerOCrearExpediente', () => {
  it('recupera el expediente existente sin insertar', async () => {
    const e: Espia = { lecturas: [], inserts: [], cols: [] };
    const r = await obtenerOCrearExpediente(cliente([ok([{ id: EX }])], [], e), P);
    expect(r).toEqual({ ok: true, expediente_id: EX, creado: false });
    expect(e.inserts).toEqual([]);
    expect(e.lecturas[0]).toEqual([['user_id', US], ['ticker', 'MSFT'], ['mercado', 'US'], ['portfolio_id', PF]]);
    expect(e.cols[0]).toBe('id,ticker,mercado,portfolio_id');
  });
  it('si no existe lo crea con el id que devuelve la base (posición existente = reconstruida)', async () => {
    const e: Espia = { lecturas: [], inserts: [], cols: [] };
    const r = await obtenerOCrearExpediente(cliente([ok([])], [{ data: { id: EX }, error: null }], e), P);
    expect(r).toEqual({ ok: true, expediente_id: EX, creado: true });
    expect(e.inserts).toEqual([{ user_id: US, ticker: 'MSFT', mercado: 'US', portfolio_id: PF, portafolio_codigo: 'PCP', tesis_origen: 'reconstruida' }]);
    expect(e.cols[1]).toBe('id');
  });
  it('posición nueva = tesis al_entrar; no envía tesis_vigente, ficha ni tesis_version (defaults de la base)', async () => {
    const e: Espia = { lecturas: [], inserts: [], cols: [] };
    await obtenerOCrearExpediente(cliente([ok([])], [{ data: { id: EX }, error: null }], e), { ...P, posicion_existe: false });
    expect(e.inserts[0]?.['tesis_origen']).toBe('al_entrar');
    expect(Object.keys(e.inserts[0] ?? {}).sort()).toEqual(['mercado', 'portafolio_codigo', 'portfolio_id', 'tesis_origen', 'ticker', 'user_id']);
  });
  it('sin user_id (sesión de usuario): no filtra ni envía user_id, lo pone la base', async () => {
    const e: Espia = { lecturas: [], inserts: [], cols: [] };
    const { user_id: _u, ...sinUsuario } = P;
    const r = await obtenerOCrearExpediente(cliente([ok([])], [{ data: { id: EX }, error: null }], e), sinUsuario);
    expect(r).toEqual({ ok: true, expediente_id: EX, creado: true });
    expect(e.lecturas[0]).toEqual([['ticker', 'MSFT'], ['mercado', 'US'], ['portfolio_id', PF]]);
    expect(Object.keys(e.inserts[0] ?? {})).not.toContain('user_id');
    const n = await obtenerOCrearExpediente(cliente([ok([{ id: EX }])], []), { ...P, user_id: null });
    expect(n.ok).toBe(true);
  });
  it('con user_id lo envía en la fila', async () => {
    const e: Espia = { lecturas: [], inserts: [], cols: [] };
    await obtenerOCrearExpediente(cliente([ok([])], [{ data: { id: EX }, error: null }], e), P);
    expect(e.inserts[0]?.['user_id']).toBe(US);
  });
  it('carrera: si el insert choca con el índice único relee una vez y usa el existente', async () => {
    const e: Espia = { lecturas: [], inserts: [], cols: [] };
    const r = await obtenerOCrearExpediente(cliente([ok([]), ok([{ id: EX2 }])], [{ data: null, error: { message: 'duplicate key', code: '23505' } }], e), P);
    expect(r).toEqual({ ok: true, expediente_id: EX2, creado: false });
    expect(e.lecturas).toHaveLength(2);
  });
  it('carrera: si tras el choque tampoco lo encuentra, devuelve el error de la base', async () => {
    const r = await obtenerOCrearExpediente(cliente([ok([]), ok([])], [{ data: null, error: { message: 'duplicate key', code: '23505' } }]), P);
    expect(r).toEqual({ ok: false, problemas: ['oficina_expedientes: duplicate key'], error_bd: 'duplicate key' });
  });
  it('carrera: error de lectura al releer se devuelve tal cual; ambigüedad al releer también', async () => {
    const dup = { data: null, error: { message: 'duplicate key', code: '23505' } };
    expect(await obtenerOCrearExpediente(cliente([ok([]), { data: null, error: { message: 'boom' } }], [dup]), P)).toEqual({ ok: false, problemas: ['oficina_expedientes: boom'], error_bd: 'boom' });
    const r = await obtenerOCrearExpediente(cliente([ok([]), ok([{ id: EX }, { id: EX2 }])], [dup]), P);
    expect(r).toEqual({ ok: false, problemas: ['MSFT: hay 2 expedientes del mismo portafolio (ambiguo)'] });
  });
  it('otro error del insert se devuelve tal cual, sin releer', async () => {
    const e: Espia = { lecturas: [], inserts: [], cols: [] };
    const r = await obtenerOCrearExpediente(cliente([ok([])], [{ data: null, error: { message: 'rls', code: '42501' } }], e), P);
    expect(r).toEqual({ ok: false, problemas: ['oficina_expedientes: rls'], error_bd: 'rls' });
    expect(e.lecturas).toHaveLength(1);
    const s = await obtenerOCrearExpediente(cliente([ok([])], [{ data: null, error: { message: 'sin código' } }]), P);
    expect(s.ok).toBe(false);
  });
  it('no inventa ids: la creación sin id válido falla', async () => {
    expect((await obtenerOCrearExpediente(cliente([ok([])], [{ data: { id: 'x' }, error: null }]), P)).ok).toBe(false);
    expect((await obtenerOCrearExpediente(cliente([ok([])], [{ data: null, error: null }]), P)).ok).toBe(false);
    expect((await obtenerOCrearExpediente(cliente([ok([])], [{ data: {}, error: null }]), P)).ok).toBe(false);
  });
  it('lectura: error de la base, sin filas, ambigüedad o id inválido', async () => {
    expect(await obtenerOCrearExpediente(cliente([{ data: null, error: { message: 'boom' } }], []), P)).toEqual({ ok: false, problemas: ['oficina_expedientes: boom'], error_bd: 'boom' });
    expect(await obtenerOCrearExpediente(cliente([{ data: null, error: null }], []), P)).toEqual({ ok: false, problemas: ['oficina_expedientes: la consulta no devolvió filas'], error_bd: 'la consulta no devolvió filas' });
    const amb = await obtenerOCrearExpediente(cliente([ok([{ id: EX }, { id: EX2 }])], []), P);
    expect(amb).toEqual({ ok: false, problemas: ['MSFT: hay 2 expedientes del mismo portafolio (ambiguo)'] });
    const malo = await obtenerOCrearExpediente(cliente([ok([{ id: 'x' }])], []), P);
    expect(!malo.ok && malo.problemas.join()).toMatch(/id válido/);
    expect((await obtenerOCrearExpediente(cliente([ok([{}])], []), P)).ok).toBe(false);
  });
  it('si el cliente lanza, devuelve el error sin reintentar', async () => {
    expect(await obtenerOCrearExpediente(cliente(['lanza'], []), P)).toEqual({ ok: false, problemas: ['oficina_expedientes: red caída'], error_bd: 'red caída' });
    expect(await obtenerOCrearExpediente(cliente([ok([])], ['lanza']), P)).toEqual({ ok: false, problemas: ['oficina_expedientes: red caída'], error_bd: 'red caída' });
    const c = { from() { throw 'texto'; } } as unknown as ClienteExpediente;
    expect(await obtenerOCrearExpediente(c, P)).toEqual({ ok: false, problemas: ['oficina_expedientes: texto'], error_bd: 'texto' });
  });
  it('parámetros inválidos: no toca la base', async () => {
    const e: Espia = { lecturas: [], inserts: [], cols: [] };
    const r = await obtenerOCrearExpediente(cliente([], [], e), { ...P, mercado: 'MX' });
    expect(r.ok).toBe(false);
    expect(e.lecturas).toEqual([]);
  });
});

describe('verificarParametrosExpediente', () => {
  const v = (o: Partial<ParametrosExpediente>) => verificarParametrosExpediente({ ...P, ...o }).join(' | ');
  it('acepta los válidos (US y BMV, 5 portafolios operativos)', () => {
    expect(verificarParametrosExpediente(P)).toEqual([]);
    expect(verificarParametrosExpediente({ ...P, mercado: 'BMV' })).toEqual([]);
    for (const c of ['PMP', 'PCP', 'PLP', 'ETF', 'SEMILLA']) expect(verificarParametrosExpediente({ ...P, portafolio_codigo: c })).toEqual([]);
  });
  it('user_id ausente o null es válido', () => {
    expect(verificarParametrosExpediente({ ...P, user_id: null })).toEqual([]);
    expect(verificarParametrosExpediente({ ...P, user_id: undefined })).toEqual([]);
  });
  it('rechaza user_id, ticker, mercado, portfolio_id y portafolios sin reglas (Especulativo, Spin Off)', () => {
    expect(v({ user_id: 'x' })).toMatch(/user_id/);
    expect(v({ ticker: '' })).toMatch(/ticker vacío/);
    expect(v({ ticker: '  ' })).toMatch(/ticker vacío/);
    expect(v({ ticker: undefined as unknown as string })).toMatch(/ticker vacío/);
    expect(v({ mercado: 'MX' })).toMatch(/mercado inválido: MX/);
    expect(v({ portfolio_id: 'x' })).toMatch(/portfolio_id/);
    expect(v({ portafolio_codigo: 'ESPECULATIVO' })).toMatch(/sin expediente en la Oficina: ESPECULATIVO/);
    expect(v({ portafolio_codigo: 'SPIN_OFF' })).toMatch(/SPIN_OFF/);
  });
});
