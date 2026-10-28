// Auditor de Reglas (contrato v0.2 + clasificación v0.1, 13-oct-2026). Código determinista, sin IA.
// Verifica reglas, no analiza: lee cifras ya calculadas (datos_fuente) y solo calcula la fórmula de PMP-01.
// Marcas [PROPUESTA]: campos y criterios que propongo y necesitan tu revisión (ver README).

export const CONTRATO_ENTRADA = 'auditoria_entrada.v1';
export const CONTRATO_SALIDA = 'auditoria.v1';
export const AGENTE_AUDITOR = 'auditor_reglas';
/** Máximo de caracteres del resumen (contrato, sección 5). */
export const MAX_CARACTERES_RESUMEN = 400;

export const PORTAFOLIOS_AUDITOR = ['PMP', 'PCP', 'PLP', 'ETF', 'SEMILLA'] as const;
export type PortafolioAuditor = (typeof PORTAFOLIOS_AUDITOR)[number];
export const TIPOS_EVALUACION_AUDITOR = [
  'nueva_posicion', 'posicion_abierta', 'recompra', 'revision_tesis', 'aporte_periodico', 'revision_anual_etf', 'retiro_quinquenal',
] as const;
export type TipoEvaluacionAuditor = (typeof TIPOS_EVALUACION_AUDITOR)[number];

export const CLASES_REGLA = [
  'estructura_limite', 'filtro_elegibilidad', 'referencial', 'delegada', 'calendario_tarea', 'transversal', 'declarativa',
] as const;
export type ClaseRegla = (typeof CLASES_REGLA)[number];
export const RESULTADOS_REGLA = ['cumple', 'incumple', 'no_evaluable', 'no_aplica', 'anterior_a_regla', 'delegada'] as const;
export type ResultadoRegla = (typeof RESULTADOS_REGLA)[number];
export type VeredictoAuditorV1 = 'CUMPLE' | 'BLOQUEO_REGLA' | 'NO_ELEGIBLE' | 'NO_EVALUABLE';

export const ACCIONES = ['abrir', 'recomprar', 'vender', 'reducir', 'aporte', 'mover_dinero', 'mantener'] as const;
export type Accion = (typeof ACCIONES)[number];
export type PlanPCP = 'una_compra' | 'escalonado';
export type CategoriaDato =
  'precio' | 'estado_financiero' | 'estimacion' | 'indicador_tecnico' | 'documento_regulatorio' | 'parametro_usuario' | 'noticia' | 'otro';
export const CATEGORIAS_DATO: readonly CategoriaDato[] = [
  'precio', 'estado_financiero', 'estimacion', 'indicador_tecnico', 'documento_regulatorio', 'parametro_usuario', 'noticia', 'otro',
];

export interface AplicaA { portafolios: string[]; tipos_evaluacion: string[] }

export interface ReglaEntrada {
  codigo: string;
  version_id: string;
  caracter: 'obligatoria' | 'referencial';
  vigente_desde: string;
  /** Definición congelada de la versión (jsonb). Los umbrales salen de aquí. */
  definicion: Record<string, unknown>;
  /** De oficina_reglas_clasificacion. */
  clase: ClaseRegla;
  aplica_a: AplicaA;
  /** Agentes delegados, separados por coma (p. ej. "tecnico,valuacion,fundamental"). */
  componente_delegado: string | null;
}

export interface DatoFuente {
  id: string;
  campo: string;
  categoria: CategoriaDato;
  valor: string | number | boolean | null;
  unidad: string | null;
  fuente: string;
  fecha_dato: string;
}

export interface CompraPosicion { fecha: string; monto: string }

export interface EntradaAuditor {
  contrato: typeof CONTRATO_ENTRADA;
  run_id: string;
  snapshot_id: string;
  ticker: string;
  mercado: string;
  portafolio_codigo: string | null;
  tipo_evaluacion: string;
  /** Fecha de la evaluación (America/Mexico_City), AAAA-MM-DD. */
  fecha_evaluacion: string;
  operacion: {
    accion: Accion;
    monto: string | null;
    precio: string | null;
    porcentaje_venta: string | null;
    instrumento_destino: string | null;
    origen_dinero: 'dinero_nuevo' | 'dividendo' | null;
    dividendo_misma_empresa: boolean | null;
    motivo_venta: string | null;
  };
  posicion: {
    existe: boolean;
    fecha_apertura: string | null;
    /** Todas las compras reales de la posición (el costo promedio las usa todas; los máximos solo las posteriores a la vigencia). */
    compras: CompraPosicion[] | null;
    ventas_previas: number | null;
    costo_promedio_ponderado: string | null;
    plan_pcp: PlanPCP | null;
    rol: string | null;
  };
  contexto_portafolio: {
    posiciones_abiertas: number | null;
    movimiento_ya_registrado: boolean | null;
    sustitucion_autorizada: { regla: string; autorizacion_id: string } | null;
  };
  datos: {
    analisis_presentes: string[];
    ficha_pmp: Record<string, boolean> | null;
    candidata_semilla: {
      empresa_operativa: boolean | null; spac: boolean | null; tesis_escrita: boolean | null; invalidacion_escrita: boolean | null; fecha_ipo: string | null;
    } | null;
    recompra_con_analisis_propios: boolean | null;
    stop_tocado: boolean | null;
    aumenta_peso_sectorial: boolean | null;
    dividendo_recibido: boolean | null;
    neto_mensual_pcp: string | null;
    traspaso_identificable: boolean | null;
    historial_meses_etf: number | null;
    aporte_etf: { modo: 'completo' | 'reducido' | 'ninguno'; monto_por_etf: string | null } | null;
    /** Ids de datos_fuente que sostienen la operación (GLB-03). */
    fundamentos: string[] | null;
  };
  datos_fuente: DatoFuente[];
  analisis_ids: string[];
  reglas_vigentes: ReglaEntrada[];
}

export interface Tarea { tipo: string; regla: string; detalle: string; [k: string]: unknown }
export interface Umbral { operador: string; valor: string }

export interface ResultadoReglaSalida {
  codigo: string;
  version_id: string;
  caracter: 'obligatoria' | 'referencial';
  clase: ClaseRegla;
  resultado: ResultadoRegla;
  valor_observado: string | null;
  umbral: Umbral | null;
  detalle: string;
  evidencia: string[];
  /** Motivo de un no_evaluable (p. ej. plan_no_declarado). */
  motivo: string | null;
  /** Un no_evaluable crítico decide el veredicto (EL, FE y transversales obligatorias); el resto solo se lista. */
  critico: boolean;
}

export interface Infraccion { codigo: string; version_id: string; detalle: string; condicion_para_levantar: string }
export interface FiltroFallido { codigo: string; version_id: string; detalle: string }
export interface AdvertenciaReferencial { codigo: string; version_id: string; detalle: string }
export interface ReglaDelegada { codigo: string; agente: string }
export interface DatoFaltante { codigo_regla: string; motivo: string; detalle: string; critico: boolean }

export interface SalidaAuditor {
  contrato: typeof CONTRATO_SALIDA;
  agente: typeof AGENTE_AUDITOR;
  run_id: string;
  snapshot_id: string;
  hash_entrada: string;
  ticker: string;
  portafolio_codigo: string | null;
  tipo_evaluacion: string;
  veredicto: VeredictoAuditorV1;
  resumen: string;
  resultados_reglas: ResultadoReglaSalida[];
  infracciones: Infraccion[];
  filtros_fallidos: FiltroFallido[];
  advertencias_referenciales: AdvertenciaReferencial[];
  reglas_delegadas: ReglaDelegada[];
  tareas_sugeridas: Tarea[];
  datos_faltantes: DatoFaltante[];
  datos_fuente: DatoFuente[];
}

export class ErrorAuditor extends Error {
  constructor(mensaje: string) { super(mensaje); this.name = 'ErrorAuditor'; }
}
