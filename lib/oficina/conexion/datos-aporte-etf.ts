// Datos congelados de la corrida determinista del aporte semanal de ETFs sectoriales, leídos de la base (RLS activo, cliente con la sesión del usuario).
// Nada se inventa: si falta o contradice un dato, devuelve `problemas` y NO se arma la corrida (la ruta responde sin registrar nada).
//
// [PROPUESTA] (confirma o corrige):
//   E1. Efectivo disponible = `efectivo` de `oficina_v_capital` del portafolio ETF (una sola fila).
//   E2. ETFs sectoriales que reciben aporte = tickers con posición en el portafolio ETF, SIN IVV PESOS, GBTC ni QQQ (reciben DCA mensual aparte).
//       Debe haber exactamente 11 (tu definición): con otro número no se arma la corrida (no se asume un aporte parcial ni se cambia la regla).
//   E3. El ETF evaluado debe ser uno de esos sectoriales con una sola posición abierta; si no, problema.
//   E4. Duplicado = ya existe una compra (`buy`) de ESE ETF con fecha de la semana en curso (lunes a domingo, America/Mexico_City). La fecha de
//       `executed_at` se toma tal cual la guarda la base (timestamp sin zona).
//   E5. snapshot_id = id nuevo de la corrida; snapshot_generado_en = ahora; snapshot_fecha_datos = hoy en America/Mexico_City.
import { ZONA_OFICINA, fechaEnZona } from '../orquestador/calendario';
import type { DatosCongelados, FilaParametro } from '../orquestador';
import { aDec, REGEX_FECHA } from '../auditor/numeros';
import type { ClienteOficina } from './flujo-auditoria';
import { resolverPortfolioId } from './flujo-auditoria';

export const PORTAFOLIO_ETF = 'ETF';
export const TIPO_APORTE_PERIODICO = 'aporte_periodico';
export const ETFS_EXCLUIDOS_DEL_APORTE_SEMANAL: readonly string[] = ['IVV PESOS', 'GBTC', 'QQQ'];
export const ETFS_SECTORIALES_ESPERADOS = 11;
export const TABLA_POSICIONES_ETF = 'oficina_v_posiciones';
export const TABLA_CAPITAL_ETF = 'oficina_v_capital';
export const TABLA_EJECUCIONES_ETF = 'trade_executions';
export const TABLA_PARAMETROS = 'oficina_parametros';
export const COLUMNAS_PARAMETROS = 'clave,valor,version,vigente_desde,aprobado_at';
export const EJECUCION_COMPRA_ETF = 'buy';

/** Lunes (AAAA-MM-DD) de la semana que contiene la fecha dada. */
export function lunesDeLaSemana(fecha: string): string {
  const [y, m, d] = fecha.split('-').map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d);
  const dias = (new Date(t).getUTCDay() + 6) % 7;
  return new Date(t - dias * 86_400_000).toISOString().slice(0, 10);
}

export interface ArgumentosDatosAporte { ticker: string; ahora: string; snapshot_id: string }
export type ResultadoDatosAporte =
  | { ok: true; datos: DatosCongelados; resumen: { etfs_sectoriales: number; efectivo_disponible: string; duplicado: boolean; semana_desde: string } }
  | { ok: false; problemas: string[] };

type Fila = Record<string, unknown>;
async function leer(cliente: ClienteOficina, tabla: string, cols: string, filtros: [string, string][]): Promise<{ filas: Fila[] } | { error: string }> {
  let q = cliente.from(tabla).select(cols);
  for (const [c, v] of filtros) q = q.eq(c, v);
  const r = await q;
  if (r.error) return { error: `${tabla}: ${r.error.message}` };
  if (!Array.isArray(r.data)) return { error: `${tabla}: la consulta no devolvió filas` };
  return { filas: r.data as Fila[] };
}

export async function armarDatosAporteEtf(cliente: ClienteOficina, a: ArgumentosDatosAporte): Promise<ResultadoDatosAporte> {
  const falla = (...problemas: string[]): ResultadoDatosAporte => ({ ok: false, problemas });
  try {
    const instante = new Date(a.ahora);
    if (Number.isNaN(instante.getTime())) return falla('ahora inválido');
    const hoy = fechaEnZona(instante, ZONA_OFICINA);
    const ticker = a.ticker.trim().toUpperCase();

    const pf = await resolverPortfolioId(cliente, PORTAFOLIO_ETF);
    if (!pf.ok) return falla(...pf.problemas);

    const pos = await leer(cliente, TABLA_POSICIONES_ETF, 'trade_id,portfolio_id,ticker', [['portfolio_id', pf.portfolio_id]]);
    if ('error' in pos) return falla(pos.error);
    const tickers = pos.filas.map((f) => (typeof f['ticker'] === 'string' ? f['ticker'].trim().toUpperCase() : ''));
    const sectoriales = tickers.filter((t) => t !== '' && !ETFS_EXCLUIDOS_DEL_APORTE_SEMANAL.includes(t));
    if (new Set(sectoriales).size !== sectoriales.length) return falla('hay ETFs sectoriales con más de una posición abierta (ambiguo)');
    if (sectoriales.length !== ETFS_SECTORIALES_ESPERADOS) {
      return falla(`se esperaban ${ETFS_SECTORIALES_ESPERADOS} ETFs sectoriales con posición y hay ${sectoriales.length}: no se arma el aporte`);
    }
    if (!sectoriales.includes(ticker)) return falla(`${ticker} no es un ETF sectorial con una sola posición abierta en el portafolio ETF`);
    const trade_id = pos.filas[tickers.indexOf(ticker)]?.['trade_id'];
    if (typeof trade_id !== 'string' || trade_id === '') return falla(`${ticker}: la posición no trae trade_id`);

    const cap = await leer(cliente, TABLA_CAPITAL_ETF, 'portfolio_id,efectivo', [['portfolio_id', pf.portfolio_id]]);
    if ('error' in cap) return falla(cap.error);
    if (cap.filas.length !== 1) return falla(`${TABLA_CAPITAL_ETF}: se esperaba 1 fila del portafolio ETF y hay ${cap.filas.length}`);
    const ef = cap.filas[0]?.['efectivo'];
    const efectivo = typeof ef === 'number' || typeof ef === 'string' ? String(ef).trim() : '';
    if (aDec(efectivo) === null || efectivo.startsWith('-')) return falla(`${TABLA_CAPITAL_ETF}: efectivo ausente o inválido`);

    const eje = await leer(cliente, TABLA_EJECUCIONES_ETF, 'id,trade_id,execution_type,executed_at', [['trade_id', trade_id]]);
    if ('error' in eje) return falla(eje.error);
    const semana_desde = lunesDeLaSemana(hoy);
    let duplicado = false;
    for (const e of eje.filas) {
      if (e['execution_type'] !== EJECUCION_COMPRA_ETF) continue;
      const f = typeof e['executed_at'] === 'string' ? e['executed_at'].slice(0, 10) : '';
      if (!REGEX_FECHA.test(f)) return falla(`${TABLA_EJECUCIONES_ETF}: una compra de ${ticker} no trae fecha válida (${String(e['id'])})`);
      if (f >= semana_desde && f <= hoy) duplicado = true;
    }

    const par = await leer(cliente, TABLA_PARAMETROS, COLUMNAS_PARAMETROS, []);
    if ('error' in par) return falla(par.error);

    const datos: DatosCongelados = {
      snapshot_id: a.snapshot_id, snapshot_generado_en: a.ahora, snapshot_fecha_datos: hoy, expediente_id: null, posicion_existe: true,
      reglas_versiones_ids: [], tesis_ref: null, parametros: par.filas as unknown as FilaParametro[], velas: null, sobres: {}, sobre_auditor: null,
      aporte_semanal: { efectivo_disponible: efectivo, etfs_sectoriales: sectoriales.length, duplicado }, motor: {},
    };
    return { ok: true, datos, resumen: { etfs_sectoriales: sectoriales.length, efectivo_disponible: efectivo, duplicado, semana_desde } };
  } catch (e) {
    return falla(e instanceof Error ? e.message : String(e));
  }
}
