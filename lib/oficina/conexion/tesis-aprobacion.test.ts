import { describe, expect, it } from 'vitest';
import { agregarTesis, leerHistorialTesis, propuestaDeDirector, textoDeTesisVigente, HISTORIAL_TESIS_MAXIMO } from './tesis-aprobacion';
import type { EntradaTesis } from './tesis-aprobacion';
import { aprobarTesis, leerEstadoTesis } from './tesis-aprobacion-bd';

const CORRIDA = '11111111-1111-4111-8111-111111111111';
const ANALISIS = '22222222-2222-4222-8222-222222222222';
const salidaDirector = (extra: Record<string, unknown> = {}) => ({
  tesis: { estado: 'propuesta_cambio', propuesta: '  Crecimiento sostenido con márgenes al alza.  ', pendiente_autorizacion: true },
  anotaciones_codigo: { clasificacion_tesis: 'primera_propuesta' }, ...extra,
});
const entrada = (version: number, corrida = CORRIDA): EntradaTesis => ({ version, texto: `t${version}`, aprobada_en: '2026-11-16T10:00:00Z', corrida_id: corrida, clasificacion: 'cambio_de_tesis', anterior: null });

describe('funciones puras de la tesis', () => {
  it('propuesta del Director: solo con estado propuesta_cambio y texto; lleva la clasificación del código', () => {
    expect(propuestaDeDirector(salidaDirector())).toEqual({ texto: 'Crecimiento sostenido con márgenes al alza.', clasificacion: 'primera_propuesta' });
    expect(propuestaDeDirector({ tesis: { estado: 'vigente', propuesta: null, pendiente_autorizacion: false } })).toBeNull();
    expect(propuestaDeDirector({ tesis: { estado: 'propuesta_cambio', propuesta: '   ' } })).toBeNull();
    expect(propuestaDeDirector(null)).toBeNull();
    expect(propuestaDeDirector(salidaDirector({ anotaciones_codigo: {} }))?.clasificacion).toBeNull();
  });
  it('tesis vigente como texto o como objeto con texto; otra forma = null', () => {
    expect(textoDeTesisVigente('Hola')).toBe('Hola');
    expect(textoDeTesisVigente({ texto: 'Hola' })).toBe('Hola');
    expect(textoDeTesisVigente({})).toBeNull();
    expect(textoDeTesisVigente(null)).toBeNull();
    expect(textoDeTesisVigente(['x'])).toBeNull();
  });
  it('historial: agrega sin tocar el resto de la ficha y conserva las últimas', () => {
    const f = agregarTesis({ rol: 'x', ficha_pmp: { a: 1 } }, entrada(2));
    expect(f['rol']).toBe('x');
    expect(leerHistorialTesis(f)).toHaveLength(1);
    let g: unknown = {};
    for (let i = 0; i < HISTORIAL_TESIS_MAXIMO + 3; i++) g = agregarTesis(g, entrada(i + 2));
    expect(leerHistorialTesis(g)).toHaveLength(HISTORIAL_TESIS_MAXIMO);
    expect(leerHistorialTesis(null)).toEqual([]);
  });
});

// ---------- cliente falso con el patrón de consultas que usa tesis-aprobacion-bd ----------
interface Opc { corrida?: unknown[]; analisis?: unknown[]; expedientes?: unknown[]; upd?: { filas: unknown[] | null; error?: boolean } }
function cliente(o: Opc) {
  const actualizaciones: { valores: Record<string, unknown>; filtros: [string, unknown][] }[] = [];
  const ok = (data: unknown[]) => ({ data, error: null });
  const c = {
    from: (t: string) => ({
      select: () => {
        const filtros: [string, unknown][] = [];
        const q: Record<string, unknown> = {
          eq: (k: string, v: unknown) => { filtros.push([k, v]); return q; },
          order: () => q, limit: async () => ok(o.corrida ?? []),
          then: (res: (x: unknown) => unknown) => Promise.resolve(ok(t === 'oficina_analisis' ? (o.analisis ?? []) : (o.expedientes ?? []))).then(res),
        };
        return q;
      },
      update: (valores: Record<string, unknown>) => {
        const filtros: [string, unknown][] = [];
        const q: Record<string, unknown> = {
          eq: (k: string, v: unknown) => { filtros.push([k, v]); return q; },
          select: async () => { actualizaciones.push({ valores, filtros }); return { data: o.upd?.filas ?? [{ id: 'e1' }], error: o.upd?.error ? { message: 'x' } : null }; },
        };
        return q;
      },
    }),
  };
  return { c, actualizaciones };
}
const base = (): Opc => ({
  corrida: [{ corrida_id: CORRIDA, ticker: 'GKOS', portafolio_codigo: 'PMP', director_analisis_id: ANALISIS, version: 1 }],
  analisis: [{ id: ANALISIS, salida: salidaDirector() }],
  expedientes: [{ id: 'e1', tesis_vigente: null, tesis_version: 1, ficha: { rol: 'x' } }],
});

describe('leer y aprobar la tesis propuesta (v0.58)', () => {
  it('lee la propuesta, sin tesis vigente y sin aprobar', async () => {
    const r = await leerEstadoTesis(cliente(base()).c, CORRIDA);
    expect(r.ok && r.datos).toMatchObject({ ticker: 'GKOS', propuesta: { clasificacion: 'primera_propuesta' }, vigente: null, aprobada: null });
  });
  it('aprobar la primera tesis: texto vigente, versión + 1, historial, condicionada a la versión leída', async () => {
    const { c, actualizaciones } = cliente(base());
    const r = await aprobarTesis(c, { corrida_id: CORRIDA }, '2026-11-16T12:00:00.000Z');
    expect(r).toEqual({ ok: true, datos: { version: 2, clasificacion: 'primera_propuesta' } });
    const u = actualizaciones[0]!;
    expect(u.valores['tesis_vigente']).toBe('Crecimiento sostenido con márgenes al alza.');
    expect(u.valores['tesis_version']).toBe(2);
    expect((u.valores['ficha'] as Record<string, unknown>)['rol']).toBe('x');
    expect(leerHistorialTesis(u.valores['ficha'])[0]).toMatchObject({ version: 2, corrida_id: CORRIDA, anterior: null });
    expect(u.filtros).toEqual([['id', 'e1'], ['tesis_version', 1]]);
  });
  it('con tesis vigente es un cambio y conserva el texto anterior en el historial', async () => {
    const o = base(); o.expedientes = [{ id: 'e1', tesis_vigente: 'Tesis vieja', tesis_version: 3, ficha: {} }];
    const { c, actualizaciones } = cliente(o);
    const r = await aprobarTesis(c, { corrida_id: CORRIDA }, '2026-11-16T12:00:00.000Z');
    expect(r.ok && r.datos).toEqual({ version: 4, clasificacion: 'cambio_de_tesis' });
    expect(leerHistorialTesis(actualizaciones[0]!.valores['ficha'])[0]).toMatchObject({ anterior: 'Tesis vieja', version: 4 });
  });
  it('no aprueba dos veces la misma propuesta', async () => {
    const o = base(); o.expedientes = [{ id: 'e1', tesis_vigente: 'x', tesis_version: 2, ficha: agregarTesis({}, entrada(2)) }];
    const { c, actualizaciones } = cliente(o);
    const r = await aprobarTesis(c, { corrida_id: CORRIDA }, 'ahora');
    expect(!r.ok && r.http).toBe(409);
    expect(actualizaciones).toHaveLength(0);
  });
  it('sin propuesta del Director no se escribe nada', async () => {
    const o = base(); o.analisis = [{ id: ANALISIS, salida: { tesis: { estado: 'vigente', propuesta: null, pendiente_autorizacion: false } } }];
    const { c, actualizaciones } = cliente(o);
    const r = await aprobarTesis(c, { corrida_id: CORRIDA }, 'ahora');
    expect(!r.ok && r.http).toBe(422);
    expect(actualizaciones).toHaveLength(0);
  });
  it('la base no actualiza 1 fila (permiso o versión cambiada): 409, no finge', async () => {
    const r = await aprobarTesis(cliente({ ...base(), upd: { filas: [] } }).c, { corrida_id: CORRIDA }, 'ahora');
    expect(!r.ok && r.http).toBe(409);
    const e = await aprobarTesis(cliente({ ...base(), upd: { filas: null, error: true } }).c, { corrida_id: CORRIDA }, 'ahora');
    expect(!e.ok && e.http).toBe(500);
  });
  it('corrida inválida, inexistente, sin expediente o expediente ambiguo', async () => {
    expect((await leerEstadoTesis(cliente(base()).c, 'abc')).ok).toBe(false);
    const sin = base(); sin.corrida = [];
    const a = await leerEstadoTesis(cliente(sin).c, CORRIDA); expect(!a.ok && a.http).toBe(404);
    const noExp = base(); noExp.expedientes = [];
    const b = await leerEstadoTesis(cliente(noExp).c, CORRIDA); expect(!b.ok && b.http).toBe(404);
    const dup = base(); dup.expedientes = [{ id: 'a', tesis_version: 1 }, { id: 'b', tesis_version: 1 }];
    const d = await leerEstadoTesis(cliente(dup).c, CORRIDA); expect(!d.ok && d.http).toBe(409);
  });
});
