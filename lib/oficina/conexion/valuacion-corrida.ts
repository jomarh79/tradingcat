// v0.56: Valuación por CÓDIGO para PMP (sin IA). Es el modelo de valuación de /position (P/E objetivo × EPS a N años), con N = horizonte de PMP (36 meses = 3 años).
// Alimenta dos cosas: el analista `valuacion` (lo exige PMP-05) y los datos de PMP-01 (valor estimado + horizonte para el 14%). Si el modelo no se puede calcular
// no se inventa nada: el analista queda NO_EVALUABLE y PMP-01 sigue pidiendo el valor en la ficha (valuacion_base).
import type { DepsDatosReales } from '../agentes-ia/datos-reales';
import type { DatoFuente } from '../auditor/tipos';
import { RENDIMIENTO_MINIMO_PCT } from '../motor/revision-pmp';
import { calcularValuacion, leerEntradaValuacion } from './valuacion-modelos';
import type { ResultadoValuacion } from './valuacion-modelos';
import { ID_DATO_HORIZONTE, ID_DATO_VALOR_ESTIMADO } from './hechos-bd';

export const ANIOS_HORIZONTE_PMP = 3;
export const HORIZONTE_PMP_MESES = ANIOS_HORIZONTE_PMP * 12;

export interface ValuacionCorrida {
  modelo: ResultadoValuacion;
  cierre: number | null;
  fecha: string; // AAAA-MM-DD de la corrida
  horizonte_meses: number;
  /** Texto de la fuente (qué P/E y qué EPS se usaron). */
  fuente: string;
  avisos: string[];
}

export async function calcularValuacionCorrida(deps: DepsDatosReales, ticker: string, cierre: number | null, fecha: string): Promise<ValuacionCorrida> {
  const ev = await leerEntradaValuacion(deps, ticker);
  const modelo = calcularValuacion({ ...ev.entrada, precio: cierre, anios: ANIOS_HORIZONTE_PMP });
  const fuente = modelo.precio_objetivo !== null
    ? `Modelo de valuación: P/E ${modelo.pe_objetivo?.toFixed(1)}x (${modelo.origen_pe}) × EPS a ${modelo.anios} años ${modelo.eps?.toFixed(2)} (${modelo.origen_eps})`
    : `Modelo de valuación no calculable: ${modelo.motivo ?? 'sin motivo'}`;
  return { modelo, cierre, fecha, horizonte_meses: HORIZONTE_PMP_MESES, fuente, avisos: ev.avisos };
}

const num = (x: number): string => String(Number(x.toFixed(4)));

/** Datos para PMP-01. Vacío si el modelo no se pudo calcular (entonces PMP-01 usa la ficha o queda NO_EVALUABLE). */
export function datosValuacionModelo(v: ValuacionCorrida | null | undefined): DatoFuente[] {
  if (v === null || v === undefined || v.modelo.precio_objetivo === null) return [];
  return [
    { id: ID_DATO_VALOR_ESTIMADO, campo: 'valor_estimado_base', categoria: 'estimacion', valor: num(v.modelo.precio_objetivo), unidad: 'USD', fuente: v.fuente, fecha_dato: v.fecha },
    { id: ID_DATO_HORIZONTE, campo: 'horizonte_meses', categoria: 'parametro_usuario', valor: v.horizonte_meses, unidad: 'meses', fuente: v.fuente, fecha_dato: v.fecha },
  ];
}

export type VeredictoValuacionCodigo = 'BARATA' | 'CARA' | 'NO_EVALUABLE';

/** v0.72 (decisión del 21-nov): P/E actual por debajo del promedio de 5 años = BARATA (se puede comprar); igual o por encima = CARA (no se compra: el Motor da ESPERAR);
 *  sin P/E o sin promedio = NO_EVALUABLE. El 14% anualizado lo sigue decidiendo PMP-01 (Auditor) aparte. */
export function veredictoValuacion(v: ValuacionCorrida): VeredictoValuacionCodigo {
  const r = v.modelo.per.relacion;
  return r === 'por_debajo' ? 'BARATA' : r === 'por_encima' ? 'CARA' : 'NO_EVALUABLE';
}

/** Forma que exige el contexto del Director (agente, veredicto, hallazgos, datos_fuente). */
export function salidaValuacionComoAnalista(v: ValuacionCorrida): Record<string, unknown> {
  const veredicto = veredictoValuacion(v);
  const m = v.modelo;
  const datos_fuente: Record<string, unknown>[] = [];
  const evidencia: string[] = [];
  const dato = (id: string, campo: string, valor: number, unidad: string): void => { datos_fuente.push({ id, campo, valor, unidad, fuente: v.fuente, fecha_dato: v.fecha }); evidencia.push(id); };
  if (m.precio_objetivo !== null) dato('va-d1', 'precio_objetivo', Number(num(m.precio_objetivo)), 'USD');
  if (m.per.per_actual !== null) dato('va-d4', 'per_actual', Number(num(m.per.per_actual)), 'x');
  if (m.per.per_promedio !== null) dato('va-d5', 'per_promedio_5_anios', Number(num(m.per.per_promedio)), 'x');
  if (m.ganancia_anualizada_pct !== null) dato('va-d2', 'ganancia_anualizada_pct', Number(num(m.ganancia_anualizada_pct)), '%');
  if (v.cierre !== null) dato('va-d3', 'cierre_ultima_vela', Number(num(v.cierre)), 'USD');
  const per = m.per;
  const detalle = veredicto === 'NO_EVALUABLE'
    ? `Comparación de P/E no calculable: ${per.motivo ?? 'faltan datos'}`
    : `P/E actual ${per.per_actual?.toFixed(1)}x ${veredicto === 'BARATA' ? 'por debajo' : 'igual o por encima'} del promedio de ${per.puntos} años ${per.per_promedio?.toFixed(1)}x: ${veredicto === 'BARATA' ? 'barata, se puede comprar' : 'cara, no se compra'}.${m.precio_objetivo !== null ? ` Precio objetivo ${m.precio_objetivo.toFixed(2)} a ${m.anios} años; ganancia anualizada ${m.ganancia_anualizada_pct?.toFixed(1)}% (el mínimo de ${RENDIMIENTO_MINIMO_PCT}% lo evalúa PMP-01).` : ''} ${v.fuente}`;
  return {
    agente: 'valuacion', origen: 'codigo', veredicto, detalle,
    precio_objetivo: m.precio_objetivo, ganancia_anualizada_pct: m.ganancia_anualizada_pct, horizonte_meses: v.horizonte_meses,
    hallazgos: [{ id: 'va-h1', tipo: veredicto === 'BARATA' ? 'positivo' : 'neutral', texto: detalle, evidencia }],
    negativos: veredicto === 'CARA' ? [detalle] : [],
    datos_fuente,
  };
}
