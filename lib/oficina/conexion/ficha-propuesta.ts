// Borrador de la ficha de PMP-09 con lo que se puede calcular de los datos de la corrida (velas diarias y watchlist). SOLO PROPONE: ningún apartado cuenta
// como completo hasta que el usuario lo apruebe (estado 'aprobado' en ficha.ficha_pmp del expediente). Todo apartado que dependa de su criterio o de datos
// que no tenemos (dividendos, correlación) NO se propone y se declara en `no_propuestos`; nunca se inventa.
// plan_ejecucion y decision_final se proponen con las reglas de PMP que el usuario ya aprobó (10-nov); él las aprueba o las corrige.
import type { Candle } from '../tecnico';
import type { DatosWatchlist } from './watchlist-datos';

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

export function proponerFichaPmp(e: { ticker: string; hoy: string; velas: readonly Candle[] | null; watchlist: DatosWatchlist | null }): FichaPropuesta {
  const propuesta: Record<string, ApartadoPropuesto> = {};
  const no_propuestos: string[] = [
    'dividendos_fundamentales: no hay datos de dividendos en la corrida; lo llenas tú',
    'correlacion: faltan las velas de los índices de referencia; lo llenas tú',
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
