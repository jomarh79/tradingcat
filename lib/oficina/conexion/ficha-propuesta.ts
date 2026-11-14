// Borrador de la ficha de PMP-09 con lo que se puede calcular de los datos de la corrida (velas diarias y watchlist). SOLO PROPONE: ningún apartado cuenta
// como completo hasta que el usuario lo apruebe (estado 'aprobado' en ficha.ficha_pmp del expediente). Todo apartado que dependa de su criterio o de datos
// que no tenemos (dividendos, correlación) NO se propone y se declara en `no_propuestos`; nunca se inventa.
// plan_ejecucion y decision_final se proponen con las reglas de PMP que el usuario ya aprobó (10-nov); él las aprueba o las corrige.
import type { Candle } from '../tecnico';
import type { DatosWatchlist } from './watchlist-datos';

/** Datos extra que reúne la corrida de PMP (v0.40). Todo es opcional: lo que falta se declara en `no_propuestos`, nunca se rellena. */
export interface DatosFichaExtra {
  /** null = no se pudo consultar (distinto de [] = no pagó dividendos). */
  dividendos: { date: string; amount: number }[] | null;
  dividendos_error?: string;
  /** Texto ya armado con `resumenFundamentalPmp`; null si no hay datos. */
  fundamentales: string | null;
  /** Velas diarias de cada índice de referencia; null = no se pudo leer. */
  indices: Record<string, readonly Candle[] | null>;
}

export interface ApartadoPropuesto { texto: string; fuente: string }
export interface FichaPropuesta { propuesta: Record<string, ApartadoPropuesto>; no_propuestos: string[] }

export const INDICES_REFERENCIA = ['SPY', 'QQQ', 'DIA', 'QUAL'] as const;
const VENTANAS: ReadonlyArray<readonly [number, string]> = [[21, '1 mes'], [63, '3 meses'], [126, '6 meses'], [252, '1 año'], [756, '3 años']];
const MIN_RETORNOS_VOLATILIDAD = 60;
const DIAS_ANIO = 252;
const MAX_NEGOCIO = 160;
const FUENTE_REGLAS = 'reglas de PMP aprobadas el 10-nov';
export const TEXTO_PLAN_EJECUCION_PMP =
  'Horizonte 36 meses. Entrada de 50 USD al cierre de la última vela cerrada cuando haya al menos 2 de las 5 señales técnicas de entrada, el Auditor esté en CUMPLE y el valor estimado a 36 meses rinda 14% anualizado o más; las recompras de 10 USD (DCA) las decido yo. '
  + 'Salidas: 2 si lo invertido es 50 USD o menos (25% y el resto), 3 si es más (25%, 25% y el resto), en los niveles TP1, TP2 y TP3 que fije al entrar; un nivel planeado basta solo y las demás señales de salida piden 2 confirmaciones.';
export const TEXTO_DECISION_FINAL_PMP =
  'La Oficina propone y yo autorizo cada operación: nada se compra ni se vende solo. Compro solo si se cumple el plan de ejecución. Si la revisión semestral deja el rendimiento anualizado por debajo de 14% o la empresa pierde fundamentales, la decisión es revisar la venta del 100%, y esa venta la decido yo.';

/** Fecha UTC (AAAA-MM-DD) de una vela diaria; `time` puede venir en segundos o en milisegundos. */
export function fechaDeVela(time: number): string {
  const ms = time > 1e11 ? time : time * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

const pct = (x: number): string => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`;

const miles = (n: number): string => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const objeto = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Resumen de fundamentales con lo que ya baja la corrida (estado de resultados de Webull y ratios de Finnhub). null si no hay nada que decir. */
export function resumenFundamentalPmp(income: unknown, metric: unknown): string | null {
  const inc = objeto(income);
  if (inc === null) return null;
  const ttm = objeto(inc['ttm']);
  const anuales = (Array.isArray(inc['annual']) ? inc['annual'] : []).map(objeto).filter((x): x is Record<string, unknown> => x !== null && num(x['fiscalYear']) !== null);
  const ultimo = anuales.sort((a, b) => (num(a['fiscalYear']) as number) - (num(b['fiscalYear']) as number)).at(-1) ?? null;
  const moneda = typeof ttm?.['currency'] === 'string' ? (ttm['currency'] as string) : typeof ultimo?.['currency'] === 'string' ? (ultimo['currency'] as string) : 'USD';
  const M = (v: number): string => `${miles(v / 1e6)} M ${moneda}`;
  const partes: string[] = [];
  const conAnterior = (clave: string, etq: string): void => {
    const t = ttm !== null ? num(ttm[clave]) : null;
    const a = ultimo !== null ? num(ultimo[clave]) : null;
    if (t !== null) partes.push(`${etq} TTM ${M(t)}${a !== null ? ` (FY${String(ultimo!['fiscalYear'])}: ${M(a)})` : ''}`);
    else if (a !== null) partes.push(`${etq} FY${String(ultimo!['fiscalYear'])} ${M(a)}`);
  };
  conAnterior('revenue', 'ingresos');
  conAnterior('netIncome', 'utilidad neta');
  const base = ttm ?? ultimo;
  const ingresos = base !== null ? num(base['revenue']) : null;
  if (base !== null && ingresos !== null && ingresos !== 0) {
    const etq = base === ttm ? 'TTM' : `FY${String(ultimo!['fiscalYear'])}`;
    const mo = num(base['opIncome']); const mn = num(base['netIncome']);
    if (mo !== null) partes.push(`margen operativo ${etq} ${((mo / ingresos) * 100).toFixed(2)}%`);
    if (mn !== null) partes.push(`margen neto ${etq} ${((mn / ingresos) * 100).toFixed(2)}%`);
  }
  const m = objeto(objeto(metric)?.['metric']);
  const rc = m !== null ? num(m['currentRatioAnnual']) : null;
  const pa = m !== null ? num(m['quickRatioAnnual']) : null;
  if (rc !== null) partes.push(`razón corriente ${rc.toFixed(2)}`);
  if (pa !== null) partes.push(`prueba ácida ${pa.toFixed(2)}`);
  return partes.length === 0 ? null : `${partes.join('; ')}.`;
}

/** Dividendos: pagos, último pago y rendimiento del último pago sobre el cierre (sin anualizar, igual que la gráfica «Dividendo vs precio» de /chart). */
export function textoDividendos(divs: readonly { date: string; amount: number }[], cierres: readonly { fecha: string; close: number }[]): string {
  if (divs.length === 0) return 'Sin dividendos registrados en los últimos 10 años.';
  const porDia = new Map<string, number>();
  for (const d of divs) porDia.set(d.date, (porDia.get(d.date) ?? 0) + d.amount);
  const orden = [...porDia.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const total = divs.reduce((a, d) => a + d.amount, 0);
  const [fecha, monto] = orden[orden.length - 1]!;
  let txt = `${divs.length} pagos en los últimos 10 años (desde ${orden[0]![0]}); último pago $${monto.toFixed(3)} el ${fecha}; total acumulado $${total.toFixed(2)} por acción.`;
  const ys: number[] = [];
  let i = -1;
  for (const c of cierres) {
    while (i + 1 < orden.length && orden[i + 1]![0] <= c.fecha) i++;
    if (i >= 0) ys.push((orden[i]![1] / c.close) * 100);
  }
  if (ys.length > 0) txt += ` Rendimiento del último pago sobre el cierre (sin anualizar): hoy ${ys[ys.length - 1]!.toFixed(2)}%, promedio ${(ys.reduce((a, b) => a + b, 0) / ys.length).toFixed(2)}%.`;
  return txt;
}

const MIN_RETORNOS_CORRELACION = 120;
function correlacion(a: readonly number[], b: readonly number[]): number | null {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y, 0) / n; const mb = b.reduce((x, y) => x + y, 0) / n;
  let sab = 0; let saa = 0; let sbb = 0;
  for (let i = 0; i < n; i++) { const da = a[i]! - ma; const db = b[i]! - mb; sab += da * db; saa += da * da; sbb += db * db; }
  return saa === 0 || sbb === 0 ? null : sab / Math.sqrt(saa * sbb);
}

/** Correlación de los retornos diarios del ticker con cada índice, sobre las fechas que tienen en común (últimas 253 cotizaciones). */
export function textoCorrelacion(cierres: readonly { fecha: string; close: number }[], indices: Record<string, readonly { fecha: string; close: number }[] | null>): { texto: string | null; motivo: string } {
  const propio = new Map(cierres.map(c => [c.fecha, c.close]));
  const ok: string[] = []; const sin: string[] = []; let usados = Infinity;
  for (const s of INDICES_REFERENCIA) {
    const serie = indices[s] ?? null;
    if (serie === null) { sin.push(`${s} (sin velas)`); continue; }
    const comunes = serie.filter(c => propio.has(c.fecha) && c.close > 0).map(c => ({ fecha: c.fecha, idx: c.close, own: propio.get(c.fecha)! })).sort((a, b) => (a.fecha < b.fecha ? -1 : 1)).slice(-(DIAS_ANIO + 1));
    const ra = comunes.slice(1).map((c, i) => c.own / comunes[i]!.own - 1);
    const rb = comunes.slice(1).map((c, i) => c.idx / comunes[i]!.idx - 1);
    if (ra.length < MIN_RETORNOS_CORRELACION) { sin.push(`${s} (solo ${ra.length} retornos en común)`); continue; }
    const r = correlacion(ra, rb);
    if (r === null) { sin.push(`${s} (sin variación)`); continue; }
    usados = Math.min(usados, ra.length);
    ok.push(`${s} ${r.toFixed(2)}`);
  }
  if (ok.length === 0) return { texto: null, motivo: `no se pudo calcular con ningún índice: ${sin.join(', ')}` };
  return { texto: `Correlación de los retornos diarios con ${ok.join(', ')} (hasta ${usados} días en común)${sin.length > 0 ? `; sin dato: ${sin.join(', ')}` : ''}.`, motivo: '' };
}

export function proponerFichaPmp(e: { ticker: string; hoy: string; velas: readonly Candle[] | null; watchlist: DatosWatchlist | null; extra?: DatosFichaExtra | null }): FichaPropuesta {
  const propuesta: Record<string, ApartadoPropuesto> = {};
  const no_propuestos: string[] = [
  ];

  // identidad: solo lo que ya está declarado (ticker, mercado de las corridas, portafolio, rol y negocio de la watchlist)
  const w = e.watchlist;
  const partes = [`${e.ticker}`, 'mercado US', 'portafolio PMP', w?.rol != null ? `rol ${w.rol}` : 'rol sin definir'];
  if (w?.negocio != null) partes.push(`negocio: ${w.negocio.length > MAX_NEGOCIO ? `${w.negocio.slice(0, MAX_NEGOCIO)}…` : w.negocio}`);
  propuesta['identidad'] = { texto: partes.join(' · '), fuente: 'ticker de la corrida y watchlist' };
  propuesta['plan_ejecucion'] = { texto: TEXTO_PLAN_EJECUCION_PMP, fuente: FUENTE_REGLAS };
  propuesta['decision_final'] = { texto: TEXTO_DECISION_FINAL_PMP, fuente: FUENTE_REGLAS };
  propuesta['indices_referencia'] = { texto: `${INDICES_REFERENCIA.join(', ')} (los índices de referencia que declaraste el 10-nov)`, fuente: 'declarado por el usuario' };

  // velas cerradas: se descarta la del día en curso (o posterior)
  const cerradas = (e.velas ?? []).filter(v => Number.isFinite(v.close) && v.close > 0 && fechaDeVela(v.time) < e.hoy);
  const n = cerradas.length;
  const last = cerradas[n - 1];
  const ex = e.extra ?? null;
  const cierresFecha = cerradas.map(v => ({ fecha: fechaDeVela(v.time), close: v.close }));
  // dividendos + fundamentales (los dos datos salen solos; si falta uno, el apartado no se propone)
  if (ex === null) no_propuestos.push('dividendos_fundamentales: la corrida no reunió dividendos ni fundamentales; no se propone');
  else if (ex.dividendos === null) no_propuestos.push(`dividendos_fundamentales: no se pudieron consultar los dividendos (${ex.dividendos_error ?? 'sin detalle'}); no se propone`);
  else if (ex.fundamentales === null) no_propuestos.push('dividendos_fundamentales: no hay datos de ingresos, utilidad ni ratios; no se propone');
  else propuesta['dividendos_fundamentales'] = { texto: `${textoDividendos(ex.dividendos, cierresFecha)} Fundamentales: ${ex.fundamentales}`, fuente: '/api/dividends, estado de resultados de Webull y ratios de Finnhub' };
  // correlación con los índices de referencia
  if (ex === null) no_propuestos.push('correlacion: la corrida no reunió las velas de los índices; no se propone');
  else {
    const idx = Object.fromEntries(Object.entries(ex.indices).map(([k, v]) => [k, v === null ? null : v.filter(c => Number.isFinite(c.close) && fechaDeVela(c.time) < e.hoy).map(c => ({ fecha: fechaDeVela(c.time), close: c.close }))]));
    const c = textoCorrelacion(cierresFecha, idx);
    if (c.texto === null) no_propuestos.push(`correlacion: ${c.motivo}`);
    else propuesta['correlacion'] = { texto: c.texto, fuente: `velas diarias de ${INDICES_REFERENCIA.join(', ')} y del ticker` };
  }
  if (last === undefined) {
    no_propuestos.push('rendimiento: sin velas diarias cerradas; no se calcula');
    no_propuestos.push('volatilidad_riesgo: sin velas diarias cerradas; no se calcula');
    return { propuesta, no_propuestos };
  }
  const fecha = fechaDeVela(last.time);
  const cierres = cerradas.map(v => v.close);

  const rend = VENTANAS.filter(([d]) => n > d).map(([d, etq]) => `${etq} ${pct(last.close / cierres[n - 1 - d]! - 1)}`);
  if (rend.length === 0) no_propuestos.push('rendimiento: hay muy pocas velas diarias para calcular rendimientos');
  else propuesta['rendimiento'] = { texto: `Al cierre del ${fecha} (${last.close.toFixed(2)}): ${rend.join('; ')}.`, fuente: `velas diarias (${n} cerradas)` };

  const ult = cierres.slice(-(DIAS_ANIO + 1));
  const ret = ult.slice(1).map((c, i) => c / ult[i]! - 1);
  if (ret.length < MIN_RETORNOS_VOLATILIDAD) no_propuestos.push(`volatilidad_riesgo: se necesitan al menos ${MIN_RETORNOS_VOLATILIDAD} retornos diarios y hay ${ret.length}`);
  else {
    const media = ret.reduce((a, b) => a + b, 0) / ret.length;
    const desv = Math.sqrt(ret.reduce((a, b) => a + (b - media) ** 2, 0) / (ret.length - 1));
    const vol = desv * Math.sqrt(DIAS_ANIO);
    const serie = cierres.slice(-(756 + 1));
    let pico = serie[0]!;
    let maxDD = 0;
    for (const c of serie) { if (c > pico) pico = c; maxDD = Math.min(maxDD, c / pico - 1); }
    const max252 = Math.max(...ult);
    propuesta['volatilidad_riesgo'] = {
      texto: `Volatilidad anualizada ${(vol * 100).toFixed(1)}% (${ret.length} retornos diarios); caída máxima desde un máximo ${pct(maxDD)} en las últimas ${serie.length} velas; el cierre está ${pct(last.close / max252 - 1)} respecto al máximo de ${ult.length} velas.`,
      fuente: `velas diarias cerradas al ${fecha}`,
    };
  }
  return { propuesta, no_propuestos };
}
