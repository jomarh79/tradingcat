import type { Candle } from '../../indicators';

export type { Candle };

export const VEREDICTOS_TECNICO = ['FAVORABLE', 'ESPERAR', 'DESFAVORABLE', 'NO_EVALUABLE'] as const;
export type VeredictoTecnico = (typeof VEREDICTOS_TECNICO)[number];

/** Velas en el formato de TradingCat: { time (unix s, hora del exchange leída como UTC), open, high, low, close, volume }.
 *  Orden: la más antigua primero. */
export interface EntradaTecnico {
  ticker: string;
  fecha_evaluacion: string;               // YYYY-MM-DD
  fuente: string;                         // por ejemplo "TwelveData"
  velas_diarias: Candle[];
  velas_semanales: Candle[];
  /** [PROPUESTA] La capa de datos dice si la última vela ya cerró. Si no cerró, el Técnico la descarta:
   *  no calcula señales con una vela en formación. */
  ultima_vela_diaria_cerrada: boolean;
  ultima_vela_semanal_cerrada: boolean;
}

export type IdSenal =
  | 'RSI_SOBREVENTA'
  | 'KONCORDE_BAJO_CERO'
  | 'EMA8_SOBRE_EMA21'
  | 'MOGALEF_BANDA_INFERIOR'
  | 'NIVEL_PASADO'          // reemplaza a SOPORTE_PASADO (19-oct): pivotes de mínimo y de máximo
  | 'RSI_SOBRECOMPRA'       // salida del PCP
  | 'MOGALEF_BANDA_SUPERIOR' // salida del PCP
  | 'RESISTENCIA_PASADA';   // salida del PCP: solo pivotes de máximo

export interface Senal {
  id: IdSenal;
  /** true / false, o null si no hay datos suficientes para evaluarla (nunca se rellena con false). */
  cumplida: boolean | null;
  detalle: string;
}

export interface Banana {
  cumplida: boolean | null;
  detalle: string;
  pico_fecha?: string;
  pico_maximo?: string;
  minimo_previo?: string;
  multiplo?: string;
}

export type TipoNivel =
  | 'pivote_soporte'
  | 'pivote_resistencia'
  | 'ema8_diaria'
  | 'ema21_diaria'
  | 'ema200_diaria'
  | 'sma200_semanal'
  | 'maximo_52_semanas'
  | 'minimo_52_semanas';

export interface NivelCalculado {
  id: string;                             // n1, n2, ... (ordenados de mayor a menor precio)
  tipo: TipoNivel;
  precio: string;                         // cadena decimal, hasta 4 decimales
  fecha_origen: string | null;            // fecha de la vela de origen (pivotes y extremos); null en medias
}

export type Valor = number | null;

export interface Indicadores {
  ema8: Valor;
  ema21: Valor;
  ema200_diaria: Valor;
  sma200_semanal: Valor;
  rsi14: Valor;
  adx14: Valor;
  mas_di14: Valor;
  menos_di14: Valor;
  macd: Valor;
  macd_senal: Valor;
  macd_hist: Valor;
  /** ATR(14) de Wilder como % del cierre. [PROPUESTA]: TradingCat no calcula volatilidad. */
  volatilidad_atr14_pct: Valor;
  koncorde_verde: Valor;
  koncorde_marron: Valor;
  koncorde_azul: Valor;
  koncorde_media: Valor;
  mogalef_superior: Valor;
  mogalef_inferior: Valor;
  mogalef_centro: Valor;
}

/** Registro por indicador (contrato Técnico, sección 9). */
export interface TrazaIndicador {
  indicador: string;
  temporalidad: 'diaria' | 'semanal';
  parametros: Record<string, number>;
  velas_disponibles: number;
  velas_requeridas: number | null;
  estado: 'calculado' | 'NO_EVALUABLE';
  /** null si se calculó; si no, la causa del NO_EVALUABLE. */
  causa: string | null;
  fecha_calculo: string;
  ultima_vela: string | null;
}

/** Banana siempre experimental: el factor 2x espera Backtesting y nunca genera una venta automática. */
export type BananaExperimental = Banana & { experimental: true; genera_venta_automatica: false };

export interface SnapshotTecnico {
  estado: 'completo' | 'parcial' | 'NO_EVALUABLE';
  /** Si es NO_EVALUABLE: la causa. Si es parcial: lo que no se pudo calcular. */
  motivos: string[];
  ticker: string;
  fecha_evaluacion: string;
  fuente: string;
  ultima_vela_diaria: { fecha: string; cierre: string } | null;
  ultima_vela_semanal: { fecha: string; cierre: string } | null;
  velas_usadas: { diarias: number; semanales: number };
  indicadores: Indicadores;
  cierre_sobre_ema200_diaria: boolean | null;
  cierre_sobre_sma200_semanal: boolean | null;
  senales: Senal[];
  banana: BananaExperimental;
  niveles_calculados: NivelCalculado[];
  /** Parámetros usados, para trazabilidad. */
  parametros: Record<string, number>;
  trazabilidad: TrazaIndicador[];
  /** Las señales técnicas no son recomendaciones del agente ni decisiones del Motor. */
  aviso: string;
}

/** Salida del agente (modelo): los precios solo pueden ser niveles de `niveles_calculados`. */
export interface SalidaTecnicoModelo {
  veredicto: VeredictoTecnico;
  tendencia: { corto: Tendencia; medio: Tendencia; largo: Tendencia };
  zona_entrada?: { min: number | string; max: number | string; nivel_ids: string[] } | null;
  soporte_clave?: { precio: number | string; nivel_id: string } | null;
  resistencia_clave?: { precio: number | string; nivel_id: string } | null;
  nivel_invalidacion?: { precio: number | string; nivel_id: string } | null;
}
export type Tendencia = 'alcista' | 'lateral' | 'bajista';
