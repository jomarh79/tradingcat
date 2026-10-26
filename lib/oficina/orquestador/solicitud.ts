// Paso 1 de una corrida: validar la solicitud (contrato v0.4, secciones 1.1 y 1.2). Función pura; no toca la base.
//
// Resultados posibles:
//   aceptada               -> la corrida sigue.
//   sin_corrida            -> Especulativo y Spin Off: no abren corrida; se deja constancia en `oficina_ejecuciones_agentes`
//                             (agente 'orquestador', estado 'ok', entradas {"resultado":"NO_EVALUABLE","motivo":"portafolio_sin_reglas"}; aprobado el 14-oct).
//   pendiente_informacion  -> sin portafolio, SIN_CLASIFICAR (GLB-04), portafolio desconocido, o un tipo sin fila en la tabla 1.4. Se registra y se te pide
//                             completar; no hay evaluación operativa.
//   invalida               -> la solicitud está mal formada (no es una decisión de negocio): no se registra como corrida.
// [PROPUESTA] Un portafolio desconocido (ni operativo, ni Especulativo/Spin Off, ni SIN_CLASIFICAR) se trata como no declarado, y una combinación
// portafolio + tipo sin fila en la tabla 1.4 usa el código de motivo `datos_faltantes` (no hay un código propio aprobado para eso).

import { RUTA_POR_TIPO, TIPOS_EVALUACION } from '../motor';
import type { MotivoEstado, PortafolioCodigo, Ruta, TipoEvaluacion } from '../motor';
import { instanteEvaluacion } from './cierre-velas';
import type { Mercado } from './cierre-velas';
import { agentesDeCorrida, reglaEstructural } from './matriz-agentes';

export const DISPARADORES = ['usuario', 'watchlist', 'alerta', 'programado', 'revision_posicion', 'backtesting_aprobado'] as const;
export type Disparador = (typeof DISPARADORES)[number];

export const MERCADOS: readonly Mercado[] = ['US', 'BMV'];
export const PORTAFOLIOS_OPERATIVOS: readonly PortafolioCodigo[] = ['PMP', 'PCP', 'PLP', 'ETF', 'SEMILLA'];
/** Portafolios sin reglas en la Oficina (decidido el 11-oct): no abren corrida. Se comparan normalizados (sin acentos, mayúsculas, `_`). */
export const PORTAFOLIOS_SIN_REGLAS: readonly string[] = ['ESPECULATIVO', 'SPIN_OFF'];
export const PORTAFOLIO_SIN_CLASIFICAR = 'SIN_CLASIFICAR';
export const MOTIVO_PORTAFOLIO_SIN_REGLAS = 'portafolio_sin_reglas';

export interface SolicitudV1 {
  contrato: 'solicitud.v1';
  disparador: string;
  ticker: string;
  mercado: string;
  portafolio_codigo: string | null;
  tipo_evaluacion: string;
  origen?: { watchlist_id: string | null; alerta_id: string | null } | null;
  solicitado_en: string;
}

export interface SolicitudNormalizada {
  disparador: Disparador;
  ticker: string;
  mercado: Mercado;
  /** null solo en `pendiente_informacion` por portafolio no declarado. */
  portafolio: PortafolioCodigo | null;
  tipo_evaluacion: TipoEvaluacion;
  ruta: Ruta;
  origen: { watchlist_id: string | null; alerta_id: string | null };
  solicitado_en: string;
}

export type ResultadoSolicitud =
  | { clase: 'aceptada'; solicitud: SolicitudNormalizada & { portafolio: PortafolioCodigo } }
  | { clase: 'sin_corrida'; portafolio_solicitado: string; ticker: string; disparador: Disparador; tipo_evaluacion: TipoEvaluacion; motivo: typeof MOTIVO_PORTAFOLIO_SIN_REGLAS }
  | { clase: 'pendiente_informacion'; solicitud: SolicitudNormalizada; motivos: MotivoEstado[] }
  | { clase: 'invalida'; errores: string[] };

export function normalizarCodigoPortafolio(codigo: string): string {
  return codigo.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[\s-]+/g, '_');
}

function esTexto(x: unknown): x is string {
  return typeof x === 'string' && x.trim() !== '';
}

export function validarSolicitud(entrada: unknown): ResultadoSolicitud {
  if (typeof entrada !== 'object' || entrada === null || Array.isArray(entrada)) return { clase: 'invalida', errores: ['la solicitud debe ser un objeto'] };
  const s = entrada as Record<string, unknown>;
  const errores: string[] = [];
  if (s.contrato !== 'solicitud.v1') errores.push(`contrato debe ser "solicitud.v1": ${String(s.contrato)}`);
  if (!(DISPARADORES as readonly unknown[]).includes(s.disparador)) errores.push(`disparador desconocido: ${String(s.disparador)}`);
  if (!esTexto(s.ticker)) errores.push('ticker obligatorio');
  if (!(MERCADOS as readonly unknown[]).includes(s.mercado)) errores.push(`mercado desconocido (se espera ${MERCADOS.join(' o ')}): ${String(s.mercado)}`);
  if (!(TIPOS_EVALUACION as readonly unknown[]).includes(s.tipo_evaluacion)) errores.push(`tipo_evaluacion desconocido: ${String(s.tipo_evaluacion)}`);
  if (instanteEvaluacion(s.solicitado_en as string) === null) errores.push(`solicitado_en debe ser un instante ISO 8601 con zona: ${String(s.solicitado_en)}`);
  if (s.portafolio_codigo !== null && s.portafolio_codigo !== undefined && typeof s.portafolio_codigo !== 'string') errores.push('portafolio_codigo debe ser texto o null');
  if (errores.length > 0) return { clase: 'invalida', errores };

  const origenCrudo = s.origen as { watchlist_id?: unknown; alerta_id?: unknown } | null | undefined;
  const base = {
    disparador: s.disparador as Disparador,
    ticker: (s.ticker as string).trim().toUpperCase(),
    mercado: s.mercado as Mercado,
    tipo_evaluacion: s.tipo_evaluacion as TipoEvaluacion,
    ruta: RUTA_POR_TIPO[s.tipo_evaluacion as TipoEvaluacion],
    origen: {
      watchlist_id: origenCrudo && typeof origenCrudo.watchlist_id === 'string' ? origenCrudo.watchlist_id : null,
      alerta_id: origenCrudo && typeof origenCrudo.alerta_id === 'string' ? origenCrudo.alerta_id : null,
    },
    solicitado_en: s.solicitado_en as string,
  };

  const bruto = typeof s.portafolio_codigo === 'string' ? s.portafolio_codigo : '';
  const codigo = normalizarCodigoPortafolio(bruto);
  if (PORTAFOLIOS_SIN_REGLAS.includes(codigo)) {
    return { clase: 'sin_corrida', portafolio_solicitado: bruto.trim(), ticker: base.ticker, disparador: base.disparador, tipo_evaluacion: base.tipo_evaluacion, motivo: MOTIVO_PORTAFOLIO_SIN_REGLAS };
  }
  if (!(PORTAFOLIOS_OPERATIVOS as readonly string[]).includes(codigo)) {
    const detalle = codigo === '' ? 'la solicitud no declara portafolio'
      : codigo === PORTAFOLIO_SIN_CLASIFICAR ? 'el portafolio es SIN_CLASIFICAR: no hay evaluación operativa (GLB-04); clasifica la posición'
      : `portafolio desconocido: ${bruto.trim()}`;
    return { clase: 'pendiente_informacion', solicitud: { ...base, portafolio: null }, motivos: [{ codigo: 'portafolio_no_declarado', detalle }] };
  }

  const portafolio = codigo as PortafolioCodigo;
  if (agentesDeCorrida(portafolio, base.tipo_evaluacion) === null && reglaEstructural(portafolio, base.tipo_evaluacion) === null) {
    return {
      clase: 'pendiente_informacion', solicitud: { ...base, portafolio },
      motivos: [{ codigo: 'datos_faltantes', detalle: `${portafolio} + ${base.tipo_evaluacion} no tiene fila en la tabla de agentes (tabla 1.4); no se asume una` }],
    };
  }
  return { clase: 'aceptada', solicitud: { ...base, portafolio } };
}
