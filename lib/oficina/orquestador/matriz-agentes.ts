// Matriz de agentes por portafolio y acción (contrato Orquestador/Director v0.4, tabla 1.4, aprobada el 14-oct-2026).
// Es configuración versionada, no lógica: `MATRIZ_AGENTES_VERSION` es la etiqueta que se guarda en `matriz_agentes_version` del registro de corridas
// (decidido el 14-oct, hasta que cierres la matriz v2 definitiva).
// R = requerido (se ejecuta siempre). O = opcional (solo por petición expresa tuya; no hay activadores automáticos autorizados). '-' = no interviene.
// El Auditor interviene siempre y no aparece aquí.
//
// [PROPUESTA] La tabla 1.4 habla de «acciones» (abrir, recomprar, mantener o vender...) y la solicitud de «tipos de evaluación»; la correspondencia
// de `accionDeMatriz` es mía y sale de las tablas 1.3 y 1.3b. Las combinaciones sin fila en la tabla (por ejemplo PLP abrir, que el contrato
// describe solo como «sustitución autorizada», o Semilla recomprar) devuelven null: no se inventa una fila.

import type { Agente, PortafolioCodigo, TipoEvaluacion } from '../motor';

export const MATRIZ_AGENTES_VERSION = 'matriz_v2_tabla_1_4_14oct2026';

export type Requisito = 'R' | 'O' | '-';
export type AccionMatriz = 'abrir' | 'recomprar' | 'mantener_o_vender' | 'vender' | 'aporte' | 'solo_codigo';

export const AGENTES_ORDEN: readonly Agente[] = ['fundamental', 'valuacion', 'tecnico', 'riesgo_capital'];

type Fila = Readonly<Record<Agente, Requisito>>;
const fila = (fundamental: Requisito, valuacion: Requisito, tecnico: Requisito, riesgo_capital: Requisito): Fila =>
  ({ fundamental, valuacion, tecnico, riesgo_capital });

export const MATRIZ_AGENTES: Readonly<Record<string, Fila>> = {
  'PMP:abrir': fila('R', 'R', 'R', 'R'),
  'PMP:recomprar': fila('R', 'R', 'R', 'R'),
  'PMP:mantener_o_vender': fila('R', 'O', 'O', 'O'),
  'PCP:abrir': fila('O', '-', 'R', 'R'),
  'PCP:recomprar': fila('-', '-', 'R', 'R'),
  'PCP:mantener_o_vender': fila('O', '-', 'R', 'O'),
  'PLP:recomprar': fila('R', 'R', 'O', 'R'),
  'PLP:mantener_o_vender': fila('R', 'O', 'O', 'O'),
  'SEMILLA:abrir': fila('R', 'O', '-', 'R'),
  'SEMILLA:vender': fila('R', '-', 'R', '-'),        // el Técnico de Semilla es la banana, calculada por código
  'ETF:aporte': fila('-', '-', '-', 'R'),
  'ETF:solo_codigo': fila('-', '-', '-', '-'),        // revisión anual y retiro quinquenal: solo código
};

/** null si la combinación portafolio + tipo no tiene fila en la tabla 1.4. */
export function accionDeMatriz(portafolio: PortafolioCodigo, tipo: TipoEvaluacion): AccionMatriz | null {
  switch (tipo) {
    case 'nueva_posicion':
      return portafolio === 'PMP' || portafolio === 'PCP' || portafolio === 'SEMILLA' ? 'abrir' : null;
    case 'recompra':
      return portafolio === 'PMP' || portafolio === 'PCP' || portafolio === 'PLP' ? 'recomprar' : null;
    case 'posicion_abierta':
      if (portafolio === 'SEMILLA') return 'vender';
      return portafolio === 'PMP' || portafolio === 'PCP' || portafolio === 'PLP' ? 'mantener_o_vender' : null;
    case 'revision_tesis':
      return portafolio === 'PMP' || portafolio === 'PCP' || portafolio === 'PLP' ? 'mantener_o_vender' : null;
    case 'aporte_periodico':
      return portafolio === 'ETF' ? 'aporte' : null;
    case 'revision_anual_etf':
    case 'retiro_quinquenal':
      return portafolio === 'ETF' ? 'solo_codigo' : null;
  }
}

export interface AgentesDeCorrida {
  accion: AccionMatriz;
  requeridos: Agente[];
  opcionales: Agente[];
}

export function agentesDeCorrida(portafolio: PortafolioCodigo, tipo: TipoEvaluacion): AgentesDeCorrida | null {
  const accion = accionDeMatriz(portafolio, tipo);
  if (accion === null) return null;
  const f = MATRIZ_AGENTES[`${portafolio}:${accion}`];
  if (f === undefined) return null;
  return {
    accion,
    requeridos: AGENTES_ORDEN.filter(a => f[a] === 'R'),
    opcionales: AGENTES_ORDEN.filter(a => f[a] === 'O'),
  };
}

// ---------------------------------------------------------------------------------------------- reglas estructurales (23-oct)
// Dos combinaciones no tienen fila en la tabla 1.4 pero SÍ tienen respuesta en la matriz v2 (tu mensaje del 23-oct):
//   PLP + nueva_posicion  -> BLOQUEADO por PLP-02 (universo cerrado), o COMPRAR solo como sustitución autorizada (origen PLP-09, con tu autorización).
//   SEMILLA + recompra    -> BLOQUEADO por SEM-04 si es con dinero nuevo (sección 10, regla 7 de la matriz v2).
// Los códigos de regla salen del catálogo vigente (consulta del 26-oct): PLP-02 `abrir_nuevas:false` con `sustitucion.origen = PLP-09`; SEM-04 `recompras_con_dinero_nuevo:false`.
// [PROPUESTA] El Motor solo produce BLOQUEADO a partir de un veredicto BLOQUEO_REGLA del Auditor (el registro exige bloqueada <=> BLOQUEADO). Por eso
// el Orquestador entrega al Motor, para estos casos, un BLOQUEO_REGLA generado por código con la regla citada, sin llamar a ningún agente.
// Si hay sustitución autorizada (PLP) la matriz de agentes sigue sin fila: queda pendiente_informacion, no se inventa una.
export type ClaseReglaEstructural = 'bloqueo_salvo_sustitucion' | 'bloqueo_con_dinero_nuevo';
export interface ReglaEstructural {
  clase: ClaseReglaEstructural;
  /** Código que se registra en `reglas_revisadas` del Auditor sintético. */
  regla: string;
  /** Solo en `bloqueo_salvo_sustitucion`: regla que debe citar la autorización para levantar el bloqueo. */
  regla_sustitucion?: string;
  fuente: string;
}

export const REGLA_PLP_ABRIR = 'PLP-02';
/** Regla de origen de la sustitución autorizada en PLP-02. */
export const REGLA_PLP_SUSTITUCION = 'PLP-09';
export const REGLA_SEMILLA_RECOMPRA = 'SEM-04';

export function reglaEstructural(portafolio: PortafolioCodigo, tipo: TipoEvaluacion): ReglaEstructural | null {
  if (portafolio === 'PLP' && tipo === 'nueva_posicion') {
    return { clase: 'bloqueo_salvo_sustitucion', regla: REGLA_PLP_ABRIR, regla_sustitucion: REGLA_PLP_SUSTITUCION, fuente: 'PLP-02: universo cerrado de 10 posiciones; solo se abre por sustitución autorizada (PLP-09)' };
  }
  if (portafolio === 'SEMILLA' && tipo === 'recompra') {
    return { clase: 'bloqueo_con_dinero_nuevo', regla: REGLA_SEMILLA_RECOMPRA, fuente: 'SEM-04: sin recompras con dinero nuevo (matriz v2, sección 10, regla 7)' };
  }
  return null;
}
