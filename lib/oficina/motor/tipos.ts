// Tipos y constantes del Motor de Decisión (contrato v0.2, 14-oct-2026).
// Los nombres coinciden con las restricciones de la base (oficina_decisiones y oficina_corridas_historial).

export const DECISIONES = [
  'COMPRAR', 'RECOMPRAR', 'MANTENER', 'MANTENER_BAJO_VIGILANCIA', 'ESPERAR',
  'NO_COMPRAR', 'NO_RECOMPRAR', 'REDUCIR', 'VENDER', 'VIGILAR', 'NO_EVALUABLE', 'BLOQUEADO',
] as const;
export type Decision = (typeof DECISIONES)[number];

export const TIPOS_EVALUACION = [
  'nueva_posicion', 'posicion_abierta', 'recompra', 'revision_tesis',
  'aporte_periodico', 'revision_anual_etf', 'retiro_quinquenal',
] as const;
export type TipoEvaluacion = (typeof TIPOS_EVALUACION)[number];

export type PortafolioCodigo = 'PMP' | 'PCP' | 'PLP' | 'ETF' | 'SEMILLA';
export type Ruta = 'analitica' | 'determinista' | 'posicion_abierta';
export type Agente = 'fundamental' | 'valuacion' | 'tecnico' | 'riesgo_capital';
export type VeredictoAuditor = 'CUMPLE' | 'BLOQUEO_REGLA' | 'NO_ELEGIBLE' | 'NO_EVALUABLE';
export type NivelDecisivo =
  'datos' | 'reglas' | 'riesgo_capital' | 'tesis' | 'valuacion' | 'fundamentales' | 'tecnico';
export type EstadoFinal = 'completada' | 'incompleta' | 'bloqueada' | 'pendiente_informacion';
export type EstadoDirector = 'ok' | 'pendiente' | 'error' | 'no_aplica';
export type EstadoUsuario = 'pendiente' | 'autorizada' | 'rechazada' | 'expirada' | 'no_requerida';
export type TesisEstado = 'intacta' | 'debilitada' | 'rota' | 'no_evaluable';

/** Códigos de motivo del estado de la corrida (aprobados el 14-oct). */
export type CodigoMotivo =
  | 'agente_requerido_fallo' | 'director_fallo' | 'auditor_bloqueo' | 'datos_faltantes'
  | 'posicion_no_confirmada' | 'snapshot_vencido' | 'portafolio_no_declarado';

export interface MotivoEstado { codigo: CodigoMotivo; detalle: string }

export interface MotivoDecision {
  nivel: NivelDecisivo;
  codigo: string;
  resultado: 'cumple' | 'incumple' | 'no_evaluable' | 'informativo';
  detalle: string;
}

export interface ConfirmacionUsuario {
  senal: string;                       // por ejemplo MACD, Koncorde, figura chartista
  tipo: 'visual';
  estado: 'pendiente';
}

// ---------------------------------------------------------------- Entrada

export interface ResultadoAgente {
  estado: 'ok' | 'error' | 'ausente';
  analisis_id?: string;
  /** Veredicto propio del agente: SOLIDO|ACEPTABLE|DEBIL|NO_EVALUABLE, BARATA|RAZONABLE|CARA|NO_EVALUABLE,
   *  FAVORABLE|ESPERAR|DESFAVORABLE|NO_EVALUABLE, VIABLE|VIABLE_CON_AJUSTE|NO_VIABLE|DATOS_INSUFICIENTES. */
  veredicto?: string;
}

export interface Auditoria {
  veredicto: VeredictoAuditor;
  analisis_id?: string;
  reglas_revisadas: string[];
}

/** Efectivo y límites. Los montos son cadenas decimales ("50", "12.5"): nunca números binarios. */
export interface Capital {
  efectivo_disponible: string | null;
  monto_requerido: string | null;
  /** NO_VIABLE solo si hay un límite duro definido que se incumple. DATOS_INSUFICIENTES es informativo. */
  veredicto_riesgo?: 'VIABLE' | 'VIABLE_CON_AJUSTE' | 'NO_VIABLE' | 'DATOS_INSUFICIENTES';
}

export interface Momento {
  detonante_confirmado: boolean;
  condicion_ejecucion?: string;
  /** Señales solo discrecionales que esperan tu confirmación visual. */
  confirmaciones_usuario?: ConfirmacionUsuario[];
}

export interface SalidaExigida {
  decision: 'REDUCIR' | 'VENDER';
  porcentaje?: number;                 // REDUCIR lleva porcentaje
  regla: string;                       // por ejemplo PCP-06
  detalle?: string;
}

export interface ContextoSalida {
  exigida?: SalidaExigida | null;
  discrecionales_pendientes?: ConfirmacionUsuario[];
  stop_tocado?: boolean;
  /** solo_referencia: PMP y PLP. zona_recompra: PCP escalonado. (Si el stop ordena vender, llega en `exigida`.) */
  stop_efecto?: 'solo_referencia' | 'zona_recompra';
}

export interface ContextoAporte {
  monto: string;                       // lo que se compra de este instrumento
  /** Lo que debe haber disponible para comprar. En ETFs sectoriales es el total de la semana (todo o nada). */
  monto_requerido: string;
  monto_reducido?: string | null;      // solo si la regla permite aporte reducido (ETFs sectoriales: nunca)
  efectivo_disponible: string | null;
  duplicado: boolean;
  elegibilidad_verificable: boolean;
}

export interface ContextoRevisionETF {
  comparable: boolean;
  supera_spy: boolean;
  fallo_anterior: boolean;
}

export interface ContextoRetiro {
  datos_completos: boolean;
  porcentaje: number;
}

export interface EntradaMotor {
  corrida_id: string;
  ticker: string;
  portafolio_codigo: PortafolioCodigo | null;
  tipo_evaluacion: TipoEvaluacion;
  ruta: Ruta;
  fecha_evaluacion: string;            // YYYY-MM-DD
  reglas_versiones_ids: string[];
  parametros_versiones: { clave: string; version: number }[];
  snapshot_id: string;
  agentes_requeridos: Agente[];
  resultados_agentes: Partial<Record<Agente, ResultadoAgente>>;
  auditoria: Auditoria | null;
  director: { estado: EstadoDirector };
  datos_vencidos: string[];
  datos_faltantes: string[];
  posicion_confirmada: boolean;
  capital?: Capital;
  tesis_estado?: TesisEstado;
  momento?: Momento;
  salida?: ContextoSalida;
  aporte?: ContextoAporte;
  revision_etf?: ContextoRevisionETF;
  retiro?: ContextoRetiro;
  /** Monto de la operación (apertura o recompra), cadena decimal. */
  monto_operacion?: string;
  decision_previa_id?: string;
}

// ---------------------------------------------------------------- Salida

export interface SalidaMotor {
  corrida_id: string;
  ticker: string;
  portafolio_codigo: PortafolioCodigo | null;
  tipo_evaluacion: TipoEvaluacion;
  decision: Decision;
  nivel_decisivo: NivelDecisivo;
  explicacion: string;
  siguiente_paso: string;
  condicion_cambio: string;
  condicion_ejecucion: string | null;
  motivos: MotivoDecision[];
  datos_faltantes: string[];
  reglas_versiones_ids: string[];
  analisis_ids: string[];
  auditoria_veredicto: VeredictoAuditor | null;
  tesis_estado: TesisEstado | null;
  requiere_autorizacion: boolean;
  estado_usuario: Extract<EstadoUsuario, 'pendiente' | 'no_requerida'>;
  requiere_revision_formal: boolean;
  /** Va en detalle_portafolio (jsonb) de oficina_decisiones. */
  detalle_portafolio: {
    porcentaje?: number;
    monto?: string;
    motivo_codigo?: string;
    confirmaciones_usuario: ConfirmacionUsuario[];
    veredictos: { agente: Agente; original: string; normalizado: VeredictoNormalizado; analisis_id?: string }[];
    decision_previa_id?: string;
  };
  estado_final: EstadoFinal;
  motivos_estado: MotivoEstado[];
  director_estado: EstadoDirector;
}

export type VeredictoNormalizado = 'FAVORABLE' | 'NEUTRAL' | 'DESFAVORABLE' | 'SIN_DATOS';

export class ErrorMotor extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErrorMotor';
  }
}
