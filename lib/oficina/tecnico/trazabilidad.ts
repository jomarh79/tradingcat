import type { TrazaIndicador } from './tipos';

interface DefIndicador {
  id: string;
  temporalidad: 'diaria' | 'semanal';
  parametros: Record<string, number>;
  /** Velas cerradas que el indicador necesita por sí mismo (null: depende de la cobertura en fechas). */
  velas_minimas: number | null;
}

/** Indicadores y señales que el Técnico calcula, con sus parámetros. Es la lista que se registra en `trazabilidad`. */
export const DEFINICION_INDICADORES: readonly DefIndicador[] = [
  { id: 'EMA8', temporalidad: 'diaria', parametros: { periodo: 8 }, velas_minimas: 8 },
  { id: 'EMA21', temporalidad: 'diaria', parametros: { periodo: 21 }, velas_minimas: 21 },
  { id: 'EMA200', temporalidad: 'diaria', parametros: { periodo: 200 }, velas_minimas: 200 },
  { id: 'SMA200_SEMANAL', temporalidad: 'semanal', parametros: { periodo: 200 }, velas_minimas: 200 },
  { id: 'RSI14', temporalidad: 'diaria', parametros: { periodo: 14 }, velas_minimas: 15 },
  { id: 'MACD', temporalidad: 'diaria', parametros: { rapida: 12, lenta: 26, senal: 9 }, velas_minimas: 35 },
  { id: 'ADX14', temporalidad: 'diaria', parametros: { periodo: 14 }, velas_minimas: 28 },
  { id: 'ATR14', temporalidad: 'diaria', parametros: { periodo: 14 }, velas_minimas: 15 },
  { id: 'KONCORDE', temporalidad: 'diaria', parametros: { velas_minimas: 120 }, velas_minimas: 120 },
  { id: 'MOGALEF', temporalidad: 'diaria', parametros: { regresion: 10, desviacion: 30, multiplicador: 1.5 }, velas_minimas: 31 },
  { id: 'PIVOTES', temporalidad: 'diaria', parametros: { velas_por_lado: 5, ventana: 250 }, velas_minimas: 11 },
  { id: 'EXTREMOS_52_SEMANAS', temporalidad: 'diaria', parametros: { dias: 364 }, velas_minimas: null },
  { id: 'BANANA_SEM07', temporalidad: 'semanal', parametros: { multiplo: 2, ventana_semanas: 52, velas_bajistas: 3 }, velas_minimas: 55 },
];

export interface ResultadoIndicador { ok: boolean; causa?: string }

/** Una fila por indicador: parámetros, temporalidad, fecha de cálculo, datos disponibles y estado (contrato Técnico, sección 9).
 *  `causa` explica todo NO_EVALUABLE; si el cálculo no dio una causa propia, se deriva de la cantidad de velas. */
export function construirTraza(a: {
  minimoGeneralDiarias: number;
  diarias: number;
  semanales: number;
  fecha_calculo: string;
  ultima_vela_diaria: string | null;
  ultima_vela_semanal: string | null;
  resultado: Record<string, ResultadoIndicador>;
  causaGlobal?: string;
}): TrazaIndicador[] {
  return DEFINICION_INDICADORES.map(d => {
    const disponibles = d.temporalidad === 'diaria' ? a.diarias : a.semanales;
    const requeridas = d.velas_minimas === null ? null
      : d.temporalidad === 'diaria' ? Math.max(d.velas_minimas, a.minimoGeneralDiarias) : d.velas_minimas;
    const r = a.resultado[d.id];
    const ok = r?.ok === true;
    let causa: string | null = null;
    if (!ok) {
      causa = r?.causa
        ?? a.causaGlobal
        ?? (requeridas !== null && disponibles < requeridas
          ? `se necesitan ${requeridas} velas ${d.temporalidad}s cerradas y hay ${disponibles}`
          : 'no se pudo calcular con los datos recibidos');
    }
    return {
      indicador: d.id,
      temporalidad: d.temporalidad,
      parametros: { ...d.parametros },
      velas_disponibles: disponibles,
      velas_requeridas: requeridas,
      estado: ok ? 'calculado' : 'NO_EVALUABLE',
      causa,
      fecha_calculo: a.fecha_calculo,
      ultima_vela: d.temporalidad === 'diaria' ? a.ultima_vela_diaria : a.ultima_vela_semanal,
    };
  });
}
