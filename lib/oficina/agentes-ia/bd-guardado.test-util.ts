// Base en memoria para probar el guardado (solo pruebas): imita lo mínimo de supabase-js (select con eq, insert().select().single(), rpc).
import { CATALOGO_FIXTURE } from '../auditor/catalogo-fixture';
import type { ClienteGuardado } from './index';

export const PF = '11111111-1111-4111-8111-111111111111';
export type Fila = Record<string, unknown>;
export interface Espia { orden: string[]; inserts: { tabla: string; fila: Fila }[]; rpc: { fn: string; args: Record<string, unknown> }[]; filtros: Record<string, [string, string][][]> }
export interface ErroresBd { tablas?: Record<string, string>; insert?: Record<string, string>; rpc?: string; si?: (tabla: string, filtros: [string, string][]) => string | undefined; vacio?: (tabla: string, filtros: [string, string][]) => boolean }

function filasReglas(): Record<string, Fila[]> {
  return {
    oficina_reglas: CATALOGO_FIXTURE.map(r => ({ id: `r-${r.codigo}`, codigo: r.codigo, caracter: r.caracter })),
    oficina_reglas_versiones: CATALOGO_FIXTURE.map(r => ({ id: r.version_id, regla_id: `r-${r.codigo}`, version: 1, definicion: r.definicion, estado: 'vigente', vigente_desde: r.vigente_desde, vigente_hasta: null })),
    oficina_reglas_clasificacion: CATALOGO_FIXTURE.map(r => ({ regla_id: `r-${r.codigo}`, clase: r.clase, componente_delegado: r.componente_delegado, aplica_a: r.aplica_a, vigente_desde: '2026-10-13', vigente_hasta: null })),
  };
}
export const PARAMS: Fila[] = [
  { clave: 'orquestador.margen_cierre_velas', valor: { valor: 30, unidad: 'minutos' }, version: 1, vigente_desde: '2026-10-22', aprobado_at: null },
  { clave: 'frescura.precio', valor: { dias_habiles: 1 }, version: 1, vigente_desde: '2026-10-14', aprobado_at: null },
];

export function nuevaBdGuardado(extra: Record<string, Fila[]> = {}, errores: ErroresBd = {}, portafolio = 'PMP') {
  const tablas: Record<string, Fila[]> = {
    ...filasReglas(), oficina_portafolios_config: [{ portfolio_id: PF, codigo: portafolio }], oficina_v_posiciones: [], trade_executions: [], trades: [{ id: 't-1', take_profit_1: null, take_profit_2: null, take_profit_3: null, tp1_hit: false, tp2_hit: false, tp3_hit: false }],
    oficina_v_capital: [{ portfolio_id: PF, efectivo: 100, posiciones_abiertas: 3 }], oficina_expedientes: [], oficina_analisis: [], oficina_parametros: PARAMS, ...extra,
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
              const err = errores.tablas?.[tabla] ?? errores.si?.(tabla, filtros);
              if (err) return Promise.resolve(ok({ data: null, error: { message: err } }));
              if (errores.vacio?.(tabla, filtros) === true) return Promise.resolve(ok({ data: [], error: null }));
              return Promise.resolve(ok({ data: (tablas[tabla] ?? []).filter(r => filtros.every(([c, v]) => r[c] === v)), error: null }));
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
                  const err = errores.insert?.[tabla];
                  if (err) return Promise.resolve({ data: null, error: { message: err } });
                  const id = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
                  (tablas[tabla] ??= []).push({ id, ...fila, ...(tabla === 'oficina_expedientes' ? { rol_posicion: null, ficha: {}, tesis_vigente: null, tesis_version: 1 } : {}) });
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
  } as unknown as ClienteGuardado;
  return { cliente, tablas, e };
}
