import { describe, expect, it } from 'vitest';
import { aprobarFicha, leerEstadoFicha } from './ficha-aprobacion-bd';
import { construirAprobacion, mezclarFicha, textosAprobados } from './ficha-aprobacion';
import { fichaPmpAprobada } from './hechos-bd';

const AHORA = '2026-11-13T14:00:00.000Z';
const PROP = { identidad: { texto: 'SE · US' }, rendimiento: { texto: '1 mes +2%' }, volatilidad_riesgo: { texto: '' } };

describe('construirAprobacion', () => {
  it('aprueba lo marcado de la corrida y los textos propios', () => {
    const r = construirAprobacion({ propuesta: PROP, aprobar: ['identidad'], textos: { plan_ejecucion: '  Entrada 50  ', decision_final: '   ' }, ahora: AHORA });
    expect(r).toEqual({ ok: true, nuevos: {
      identidad: { estado: 'aprobado', texto: 'SE · US', aprobado_at: AHORA, origen: 'propuesta_oficina' },
      plan_ejecucion: { estado: 'aprobado', texto: 'Entrada 50', aprobado_at: AHORA, origen: 'usuario' },
    } });
  });
  it('rechaza apartados que no se proponen, sin propuesta o con texto vacío', () => {
    for (const aprobar of [['plan_ejecucion'], ['rol'], ['xyz'], [5], ['indices_referencia'], ['volatilidad_riesgo']]) {
      expect(construirAprobacion({ propuesta: PROP, aprobar, textos: {}, ahora: AHORA }).ok).toBe(false);
    }
  });
  it('rechaza textos de apartados que no son tuyos, no-texto o demasiado largos; y no aprobar nada es error', () => {
    expect(construirAprobacion({ propuesta: PROP, aprobar: [], textos: { identidad: 'x' }, ahora: AHORA }).ok).toBe(false);
    expect(construirAprobacion({ propuesta: PROP, aprobar: [], textos: { plan_ejecucion: 5 }, ahora: AHORA }).ok).toBe(false);
    expect(construirAprobacion({ propuesta: PROP, aprobar: [], textos: { plan_ejecucion: 'x'.repeat(4001) }, ahora: AHORA }).ok).toBe(false);
    expect(construirAprobacion({ propuesta: PROP, aprobar: [], textos: { plan_ejecucion: ' ' }, ahora: AHORA })).toMatchObject({ ok: false, error: expect.stringContaining('nada que aprobar') });
    expect(construirAprobacion({ propuesta: PROP, aprobar: 'identidad', textos: {}, ahora: AHORA }).ok).toBe(false);
    expect(construirAprobacion({ propuesta: PROP, aprobar: ['identidad'], textos: [], ahora: AHORA }).ok).toBe(false);
  });
});

describe('mezclarFicha y lectura', () => {
  const nuevos = { identidad: { estado: 'aprobado' as const, texto: 'a', aprobado_at: AHORA, origen: 'usuario' as const } };
  it('conserva el resto de la ficha y de los apartados', () => {
    const ficha = { plan_pcp: { modalidad: 'escalonado' }, ficha_pmp: { negocio: { estado: 'aprobado', texto: 'n' } } };
    const m = mezclarFicha(ficha, nuevos);
    expect(m['plan_pcp']).toEqual({ modalidad: 'escalonado' });
    expect(Object.keys(m['ficha_pmp'] as object).sort()).toEqual(['identidad', 'negocio']);
    expect(mezclarFicha(null, nuevos)).toEqual({ ficha_pmp: nuevos });
  });
  it('lo aprobado cuenta para PMP-09 (fichaPmpAprobada) y un borrador o texto vacío no', () => {
    const m = mezclarFicha({ ficha_pmp: { rol: { estado: 'borrador', texto: 'x' }, negocio: { estado: 'aprobado', texto: ' ' } } }, nuevos);
    expect(fichaPmpAprobada(m)).toEqual({ rol: false, negocio: false, identidad: true });
    expect(textosAprobados(m)).toEqual({ identidad: 'a' });
  });
});

/** Cliente falso: select/eq/order/limit/update/select con filtros por igualdad; registra lo escrito. */
function falso(tablas: Record<string, Record<string, unknown>[]>, opc: { rls?: boolean; errorTabla?: string } = {}) {
  const updates: { tabla: string; valores: Record<string, unknown>; filtros: [string, unknown][] }[] = [];
  return {
    updates,
    from(tabla: string) {
      const filtros: [string, unknown][] = [];
      let upd: Record<string, unknown> | null = null;
      const q: Record<string, unknown> = {
        select: () => q, order: () => q, limit: () => q,
        eq: (c: string, v: unknown) => { filtros.push([c, v]); return q; },
        update: (v: Record<string, unknown>) => { upd = v; return q; },
        then: (ok: (v: unknown) => unknown) => {
          if (opc.errorTabla === tabla) return Promise.resolve({ data: null, error: { message: 'x' } }).then(ok);
          const filas = (tablas[tabla] ?? []).filter(r => filtros.every(([c, v]) => r[c] === v));
          if (upd !== null) {
            updates.push({ tabla, valores: upd, filtros });
            if (opc.rls) return Promise.resolve({ data: [], error: null }).then(ok);
            filas.forEach(f => Object.assign(f, upd));
            return Promise.resolve({ data: filas.map(f => ({ id: f['id'] })), error: null }).then(ok);
          }
          return Promise.resolve({ data: filas, error: null }).then(ok);
        },
      };
      return q;
    },
  };
}
const corridaFila = (iso: string, ficha_propuesta: unknown) => ({ ticker: 'SE', portafolio_codigo: 'PMP', corrida_id: `c-${iso}`, iniciada_at: iso, referencias: ficha_propuesta === undefined ? {} : { ficha_propuesta } });
const FP = { propuesta: { identidad: { texto: 'SE · US', fuente: 'w' }, rendimiento: { texto: '1 mes +2%', fuente: 'v' } }, no_propuestos: ['plan_ejecucion: tuyo'] };
const base = () => ({
  oficina_expedientes: [{ id: 'e1', ticker: 'SE', portafolio_codigo: 'PMP', ficha: { ficha_pmp: { negocio: { estado: 'aprobado', texto: 'n' } } } }, { id: 'e2', ticker: 'SE', portafolio_codigo: 'PCP', ficha: {} }],
  oficina_corridas_historial: [corridaFila('2026-11-12T21:00:00Z', FP)],
});

describe('leerEstadoFicha / aprobarFicha', () => {
  it('lee el borrador de la última corrida de PMP y lo ya aprobado', async () => {
    const r = await leerEstadoFicha(falso(base()), 'se');
    expect(r.ok && r.datos.propuesta.map(p => p.apartado)).toEqual(['identidad', 'rendimiento']);
    expect(r.ok && r.datos.propios.map(p => p.apartado)).toEqual(['dividendos_fundamentales', 'correlacion', 'plan_ejecucion', 'decision_final']);
    expect(r.ok && r.datos.aprobados).toEqual(['negocio']);
  });
  it('sin expediente: 404; ticker inválido: 400; sin corrida con borrador: sin propuesta', async () => {
    expect(await leerEstadoFicha(falso({ oficina_expedientes: [] }), 'SE')).toMatchObject({ ok: false, http: 404 });
    expect(await leerEstadoFicha(falso(base()), '%%')).toMatchObject({ ok: false, http: 400 });
    const sin = { ...base(), oficina_corridas_historial: [corridaFila('2026-11-12T21:00:00Z', undefined)] };
    const r = await leerEstadoFicha(falso(sin), 'SE');
    expect(r.ok && r.datos.propuesta).toEqual([]);
    expect(r.ok && r.datos.corrida).toBeNull();
  });
  it('aprueba, mezcla con lo que ya había y solo escribe oficina_expedientes del expediente PMP', async () => {
    const c = falso(base());
    const r = await aprobarFicha(c, { ticker: 'SE', aprobar: ['identidad'], textos: { plan_ejecucion: 'Entrada 50' } }, AHORA);
    expect(r).toEqual({ ok: true, datos: { aprobados: ['identidad', 'plan_ejecucion'] } });
    expect(c.updates).toHaveLength(1);
    expect(c.updates[0]).toMatchObject({ tabla: 'oficina_expedientes', filtros: [['id', 'e1']] });
    expect(Object.keys(c.updates[0]!.valores)).toEqual(['ficha']);
    const f = (c.updates[0]!.valores['ficha'] as { ficha_pmp: Record<string, unknown> }).ficha_pmp;
    expect(Object.keys(f).sort()).toEqual(['identidad', 'negocio', 'plan_ejecucion']);
  });
  it('no aprueba un apartado sin propuesta ni escribe nada si la validación falla', async () => {
    const c = falso({ ...base(), oficina_corridas_historial: [] });
    expect(await aprobarFicha(c, { ticker: 'SE', aprobar: ['identidad'] }, AHORA)).toMatchObject({ ok: false, http: 400 });
    expect(await aprobarFicha(c, 'x', AHORA)).toMatchObject({ ok: false, http: 400 });
    expect(c.updates).toHaveLength(0);
  });
  it('si el RLS no deja actualizar (0 filas) lo dice; si la base falla, mensaje fijo', async () => {
    expect(await aprobarFicha(falso(base(), { rls: true }), { ticker: 'SE', aprobar: ['identidad'] }, AHORA)).toMatchObject({ ok: false, http: 403 });
    expect(await aprobarFicha(falso(base(), { errorTabla: 'oficina_expedientes' }), { ticker: 'SE', aprobar: ['identidad'] }, AHORA)).toMatchObject({ ok: false, http: 500, error: 'No se pudo leer el expediente' });
  });
});
