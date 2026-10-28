// Hechos de la posición para el Auditor, leídos de la base (esquema que pegaste el 28-oct).
//   oficina_v_posiciones(trade_id, portfolio_id, ticker, fecha_apertura, ...), trade_executions(trade_id, execution_type, price, quantity, executed_at, total),
//   oficina_v_capital(portfolio_id, posiciones_abiertas, ...), oficina_expedientes(id, ticker, portfolio_id, rol_posicion, ...).
// No inventa nada: si falta un dato, o la base se contradice con lo que declaró el Orquestador, devuelve `problemas` y no estima ni rellena.
// El error de la base se devuelve tal cual, sin reintentos. Funciones puras (`resolverHechosPosicion`) + lector (`cargarHechosPosicion`).
import { aDec, REGEX_FECHA, textoDec } from '../auditor/numeros';
import type { PlanPCP } from '../auditor';
import type { HechosAuditor } from './entrada-auditor';

export const TABLA_POSICIONES = 'oficina_v_posiciones';
export const TABLA_EJECUCIONES = 'trade_executions';
export const TABLA_CAPITAL = 'oficina_v_capital';
export const TABLA_EXPEDIENTES = 'oficina_expedientes';
export const COLUMNAS_POSICIONES = 'trade_id,portfolio_id,ticker,fecha_apertura';
export const COLUMNAS_EJECUCIONES = 'id,trade_id,execution_type,price,quantity,executed_at,total';
export const COLUMNAS_CAPITAL = 'portfolio_id,posiciones_abiertas';
export const COLUMNAS_EXPEDIENTES = 'id,ticker,portfolio_id,rol_posicion,ficha';
/** Plan del PCP: vive en `oficina_expedientes.ficha.plan_pcp`; solo cuenta si el usuario lo declaró (estado 'declarado'). Una propuesta pendiente no es un plan. */
export const FICHA_CLAVE_PLAN = 'plan_pcp';
export const ESTADO_PLAN_DECLARADO = 'declarado';
export const MODALIDADES_PLAN: readonly PlanPCP[] = ['una_compra', 'escalonado'];
export const EJECUCION_COMPRA = 'buy';
export const EJECUCION_VENTA = 'sell';
export const EJECUCION_CIERRE = 'close';

export interface FilaPosicion { trade_id: string | null; portfolio_id: string | null; ticker: string | null; fecha_apertura: string | null }
export interface FilaEjecucion {
  id: string; trade_id: string | null; execution_type: string; price: unknown; quantity: unknown; executed_at: string | null; total: unknown;
}
export interface FilaCapital { portfolio_id: string | null; posiciones_abiertas: unknown }
export interface FilaExpediente { id: string; ticker: string; portfolio_id: string | null; rol_posicion: string | null; ficha: unknown }

export interface FilasPosicion {
  posiciones: FilaPosicion[]; ejecuciones: FilaEjecucion[]; capital: FilaCapital[]; expedientes: FilaExpediente[];
}
export interface ConsultaPosicion { portfolio_id: string; ticker: string; posicion_existe: boolean }
export type ResultadoHechosPosicion =
  | { ok: true; hechos: HechosAuditor; trade_id: string | null; expediente_id: string | null }
  | { ok: false; problemas: string[] };

const CERO = BigInt(0);

/** Plan declarado en la ficha: null si no hay plan o no está declarado; `problema` si está declarado con modalidad inválida (declarado con modalidad inválida). */
function planDeclarado(ficha: unknown): { plan: PlanPCP } | { problema: string } | null {
  if (typeof ficha !== 'object' || ficha === null || Array.isArray(ficha)) return null;
  const p = (ficha as Record<string, unknown>)[FICHA_CLAVE_PLAN];
  if (typeof p !== 'object' || p === null || Array.isArray(p)) return null;
  const o = p as Record<string, unknown>;
  if (o['estado'] !== ESTADO_PLAN_DECLARADO) return null;
  const m = MODALIDADES_PLAN.find((x) => x === o['modalidad']);
  return m !== undefined ? { plan: m } : { problema: `ficha.plan_pcp declarado con modalidad inválida (${String(o['modalidad'])})` };
}

/** Convierte las filas leídas en hechos para el Auditor. `filas` debe venir ya filtrada por portafolio y ticker (y por trade_id las ejecuciones). */
export function resolverHechosPosicion(filas: FilasPosicion, q: ConsultaPosicion): ResultadoHechosPosicion {
  const problemas: string[] = [];
  const hechos: HechosAuditor = {};
  let trade_id: string | null = null;

  const pos = filas.posiciones.filter((p) => p.portfolio_id === q.portfolio_id && p.ticker === q.ticker);
  if (pos.length > 1) problemas.push(`${q.ticker}: hay ${pos.length} posiciones abiertas en el mismo portafolio (ambiguo)`);
  if (pos.length === 0 && q.posicion_existe) problemas.push(`${q.ticker}: el Orquestador declaró posición existente pero la base no la tiene abierta`);
  if (pos.length > 0 && !q.posicion_existe) problemas.push(`${q.ticker}: el Orquestador declaró que no hay posición pero la base la tiene abierta`);

  const p = pos[0];
  if (pos.length === 1 && p !== undefined && q.posicion_existe) {
    trade_id = p.trade_id;
    if (!p.trade_id) problemas.push(`${q.ticker}: la posición no trae trade_id`);
    if (typeof p.fecha_apertura !== 'string' || !REGEX_FECHA.test(p.fecha_apertura)) problemas.push(`${q.ticker}: fecha_apertura ausente o inválida`);

    const ej = filas.ejecuciones.filter((e) => e.trade_id === p.trade_id);
    const compras: { fecha: string; monto: string }[] = [];
    let ventas = 0;
    let sumaPQ = CERO;
    let sumaQ = CERO;
    for (const e of ej) {
      if (e.execution_type === EJECUCION_VENTA) { ventas += 1; continue; }
      if (e.execution_type === EJECUCION_CIERRE) { problemas.push(`${q.ticker}: la posición figura abierta pero tiene una ejecución de cierre (${e.id})`); continue; }
      if (e.execution_type !== EJECUCION_COMPRA) { problemas.push(`${q.ticker}: tipo de ejecución desconocido "${e.execution_type}" (${e.id})`); continue; }
      const fecha = typeof e.executed_at === 'string' ? e.executed_at.slice(0, 10) : '';
      const total = aDec(e.total);
      const precio = aDec(e.price);
      const cant = aDec(e.quantity);
      if (!REGEX_FECHA.test(fecha)) { problemas.push(`${q.ticker}: compra ${e.id} sin fecha (executed_at)`); continue; }
      if (total === null || total <= CERO) { problemas.push(`${q.ticker}: compra ${e.id} sin total válido`); continue; }
      if (precio === null || precio <= CERO || cant === null || cant <= CERO) { problemas.push(`${q.ticker}: compra ${e.id} con precio o cantidad inválidos`); continue; }
      compras.push({ fecha, monto: textoDec(total) });
      sumaPQ += precio * cant;
      sumaQ += cant;
    }
    if (compras.length === 0) problemas.push(`${q.ticker}: la posición no tiene compras registradas`);
    let cpp: string | null = null;
    if (sumaQ > CERO) cpp = textoDec((BigInt(2) * sumaPQ + sumaQ) / (BigInt(2) * sumaQ)); // half-up a la escala interna
    hechos.posicion = { fecha_apertura: p.fecha_apertura, compras, ventas_previas: ventas, costo_promedio_ponderado: cpp };
  }

  const cap = filas.capital.filter((c) => c.portfolio_id === q.portfolio_id);
  const c0 = cap[0];
  if (cap.length !== 1 || c0 === undefined) problemas.push(`oficina_v_capital: se esperaba 1 fila del portafolio y hay ${cap.length}`);
  else {
    const n = c0.posiciones_abiertas;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) problemas.push('oficina_v_capital: posiciones_abiertas inválido');
    else hechos.posiciones_abiertas = n;
  }

  const exp = filas.expedientes.filter((x) => x.portfolio_id === q.portfolio_id && x.ticker === q.ticker);
  let expediente_id: string | null = null;
  if (exp.length > 1) problemas.push(`${q.ticker}: hay ${exp.length} expedientes del mismo portafolio (ambiguo)`);
  const x0 = exp[0];
  if (exp.length === 1 && x0 !== undefined) {
    expediente_id = x0.id;
    if (x0.rol_posicion !== null) hechos.posicion = { ...hechos.posicion, rol: x0.rol_posicion };
    const plan = planDeclarado(x0.ficha);
    if (plan !== null && 'problema' in plan) problemas.push(`${q.ticker}: ${plan.problema}`);
    else if (plan !== null && q.posicion_existe) hechos.posicion = { ...hechos.posicion, plan_pcp: plan.plan };
  }
  if (problemas.length > 0) return { ok: false, problemas };
  return { ok: true, hechos, trade_id, expediente_id };
}

// ---------------------------------------------------------------- lectura (cliente tipado estructuralmente: supabase-js lo cumple)
export interface ConsultaFiltrable extends PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> {
  eq(columna: string, valor: string): ConsultaFiltrable;
}
export interface ClienteLectura { from(tabla: string): { select(columnas: string): ConsultaFiltrable } }
export type ResultadoCargaHechos = ResultadoHechosPosicion | { ok: false; problemas: string[]; error_bd: string };

export async function cargarHechosPosicion(cliente: ClienteLectura, q: ConsultaPosicion): Promise<ResultadoCargaHechos> {
  const leer = async (tabla: string, cols: string, filtros: [string, string][]): Promise<{ filas: unknown[] } | { error: string }> => {
    let c = cliente.from(tabla).select(cols);
    for (const [k, v] of filtros) c = c.eq(k, v);
    const r = await c;
    if (r.error) return { error: `${tabla}: ${r.error.message}` };
    if (!Array.isArray(r.data)) return { error: `${tabla}: la consulta no devolvió filas` };
    return { filas: r.data };
  };
  const falla = (error: string): ResultadoCargaHechos => ({ ok: false, problemas: [error], error_bd: error });
  const a = await leer(TABLA_POSICIONES, COLUMNAS_POSICIONES, [['portfolio_id', q.portfolio_id], ['ticker', q.ticker]]);
  if ('error' in a) return falla(a.error);
  const posiciones = a.filas as FilaPosicion[];
  let ejecuciones: FilaEjecucion[] = [];
  if (q.posicion_existe && posiciones.length === 1 && posiciones[0]?.trade_id) {
    const b = await leer(TABLA_EJECUCIONES, COLUMNAS_EJECUCIONES, [['trade_id', posiciones[0].trade_id]]);
    if ('error' in b) return falla(b.error);
    ejecuciones = b.filas as FilaEjecucion[];
  }
  const c = await leer(TABLA_CAPITAL, COLUMNAS_CAPITAL, [['portfolio_id', q.portfolio_id]]);
  if ('error' in c) return falla(c.error);
  const d = await leer(TABLA_EXPEDIENTES, COLUMNAS_EXPEDIENTES, [['portfolio_id', q.portfolio_id], ['ticker', q.ticker]]);
  if ('error' in d) return falla(d.error);
  return resolverHechosPosicion({ posiciones, ejecuciones, capital: c.filas as FilaCapital[], expedientes: d.filas as FilaExpediente[] }, q);
}
