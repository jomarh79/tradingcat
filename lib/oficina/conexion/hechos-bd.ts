// Hechos de la posición para el Auditor, leídos de la base (esquema que pegaste el 28-oct).
//   oficina_v_posiciones(trade_id, portfolio_id, ticker, fecha_apertura, ...), trade_executions(trade_id, execution_type, price, quantity, executed_at, total),
//   oficina_v_capital(portfolio_id, posiciones_abiertas, ...), oficina_expedientes(id, ticker, portfolio_id, rol_posicion, ...).
// No inventa nada: si falta un dato, o la base se contradice con lo que declaró el Orquestador, devuelve `problemas` y no estima ni rellena.
// El error de la base se devuelve tal cual, sin reintentos. Funciones puras (`resolverHechosPosicion`) + lector (`cargarHechosPosicion`).
import { aDec, REGEX_FECHA, textoDec } from '../auditor/numeros';
import type { DatoFuente, PlanPCP } from '../auditor';
import type { HechosAuditor } from './entrada-auditor';
import { COLUMNAS_TRADE_APERTURA, compraDeApertura } from './apertura-trade';
import { apartadosDeclarados } from './watchlist-datos';
import type { DatosWatchlist } from './watchlist-datos';
export const TABLA_TRADES_APERTURA = 'trades';

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
  /** v0.33: filas de `trades` del trade de la posición (compra inicial: entry_price × initial_quantity). Ausente = comportamiento anterior. */
  trades?: unknown[];
}
export interface ConsultaPosicion {
  portfolio_id: string; ticker: string; posicion_existe: boolean;
  /** v0.35: lo que el usuario llenó en la watchlist (rol, negocio, competidores). El rol de la watchlist manda sobre el del expediente. */
  watchlist?: DatosWatchlist | null;
}
export type ResultadoHechosPosicion =
  | { ok: true; hechos: HechosAuditor; trade_id: string | null; expediente_id: string | null }
  | { ok: false; problemas: string[] };

const CERO = BigInt(0);

/** v0.23: `ficha.valuacion_base` declarada por el usuario ({estado:'declarado', valor_estimado_base, fuente, fecha, horizonte_meses}) -> datos_fuente de PMP-01.
 *  Solo cuenta si está declarada y es válida (valor positivo, fecha AAAA-MM-DD, fuente no vacía, horizonte entero positivo); si no, no se publica nada y PMP-01 queda NO_EVALUABLE. */
export const ID_DATO_VALOR_ESTIMADO = 'ficha:valuacion_base:valor_estimado_base';
export const ID_DATO_HORIZONTE = 'ficha:valuacion_base:horizonte_meses';
function valuacionDeclarada(ficha: unknown): DatoFuente[] | null {
  if (typeof ficha !== 'object' || ficha === null || Array.isArray(ficha)) return null;
  const v = (ficha as Record<string, unknown>)['valuacion_base'];
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (o['estado'] !== 'declarado') return null;
  const valor = aDec(typeof o['valor_estimado_base'] === 'number' || typeof o['valor_estimado_base'] === 'string' ? String(o['valor_estimado_base']) : null);
  const fecha = o['fecha'];
  const fuente = o['fuente'];
  const h = o['horizonte_meses'];
  if (valor === null || valor <= CERO || typeof fecha !== 'string' || !REGEX_FECHA.test(fecha)) return null;
  if (typeof fuente !== 'string' || fuente.trim().length === 0 || typeof h !== 'number' || !Number.isInteger(h) || h <= 0) return null;
  return [
    { id: ID_DATO_VALOR_ESTIMADO, campo: 'valor_estimado_base', categoria: 'estimacion', valor: textoDec(valor), unidad: 'USD', fuente: fuente.trim(), fecha_dato: fecha },
    { id: ID_DATO_HORIZONTE, campo: 'horizonte_meses', categoria: 'parametro_usuario', valor: h, unidad: 'meses', fuente: fuente.trim(), fecha_dato: fecha },
  ];
}

/** v0.29: `ficha.ficha_pmp` = { <apartado>: { estado: 'aprobado', texto } }. Un apartado cuenta como completo (PMP-09) solo si el usuario lo aprobó y trae texto;
 *  un borrador, un apartado vacío o cualquier otro estado NO cuenta. Sin `ficha_pmp` devuelve null y PMP-09 queda como antes (ficha sin apartados). */
export function fichaPmpAprobada(ficha: unknown): Record<string, boolean> | null {
  if (typeof ficha !== 'object' || ficha === null || Array.isArray(ficha)) return null;
  const f = (ficha as Record<string, unknown>)['ficha_pmp'];
  if (typeof f !== 'object' || f === null || Array.isArray(f)) return null;
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(f as Record<string, unknown>)) {
    const o = typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    out[k] = o !== null && o['estado'] === 'aprobado' && typeof o['texto'] === 'string' && o['texto'].trim().length > 0;
  }
  return out;
}

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
    // v0.33: la compra inicial vive en `trades` (no en trade_executions). Va primero; si una ejecución ya la contiene no se suma otra vez.
    const tradeFila = (filas.trades ?? []).find((t) => typeof t === 'object' && t !== null && (t as Record<string, unknown>)['id'] === p.trade_id);
    const apertura = tradeFila === undefined ? null : compraDeApertura(tradeFila, ej.filter((e) => e.execution_type === EJECUCION_COMPRA));
    if (apertura !== null && typeof p.fecha_apertura === 'string' && REGEX_FECHA.test(p.fecha_apertura)) {
      compras.unshift({ fecha: p.fecha_apertura, monto: textoDec(apertura.total) });
      sumaPQ += apertura.precio * apertura.cantidad;
      sumaQ += apertura.cantidad;
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
    const fp = fichaPmpAprobada(x0.ficha);
    if (fp !== null) hechos.datos = { ...hechos.datos, ficha_pmp: fp };
    const val = valuacionDeclarada(x0.ficha);
    if (val !== null) hechos.datos_fuente = [...(hechos.datos_fuente ?? []), ...val];
  }
  // v0.35: la watchlist declara rol, negocio y competidores. Solo suma apartados completos; el rol de la watchlist manda sobre el del expediente.
  const w = q.watchlist ?? null;
  if (w !== null) {
    if (w.rol !== null) hechos.posicion = { ...hechos.posicion, rol: w.rol };
    const decl = apartadosDeclarados(w);
    if (Object.keys(decl).length > 0) hechos.datos = { ...hechos.datos, ficha_pmp: { ...(hechos.datos?.ficha_pmp ?? {}), ...decl } };
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
  let trades: unknown[] = [];
  if (q.posicion_existe && posiciones.length === 1 && posiciones[0]?.trade_id) {
    const tr = await leer(TABLA_TRADES_APERTURA, COLUMNAS_TRADE_APERTURA, [['id', posiciones[0].trade_id]]);
    if ('error' in tr) return falla(tr.error);
    trades = tr.filas;
  }
  const c = await leer(TABLA_CAPITAL, COLUMNAS_CAPITAL, [['portfolio_id', q.portfolio_id]]);
  if ('error' in c) return falla(c.error);
  const d = await leer(TABLA_EXPEDIENTES, COLUMNAS_EXPEDIENTES, [['portfolio_id', q.portfolio_id], ['ticker', q.ticker]]);
  if ('error' in d) return falla(d.error);
  return resolverHechosPosicion({ posiciones, ejecuciones, trades, capital: c.filas as FilaCapital[], expedientes: d.filas as FilaExpediente[] }, q);
}
