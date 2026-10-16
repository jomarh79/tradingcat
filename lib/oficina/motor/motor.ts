import { mayorOIgual, menorQue, restar } from './decimal';
import { calcularEstadoFinal } from './estado-corrida';
import { verificarInvariantes } from './invariantes';
import { ErrorMotor } from './tipos';
import type {
  Agente, ConfirmacionUsuario, Decision, EntradaMotor, MotivoDecision, MotivoEstado, NivelDecisivo,
  SalidaMotor, TipoEvaluacion, VeredictoNormalizado,
} from './tipos';
import { RUTA_POR_TIPO, requiereAutorizacion, validarDecision } from './vocabulario';

/** Motor de Decisión: código determinista, sin IA y sin acceso a la base.
 *  Recibe resultados ya calculados y aplica la precedencia de la matriz v2 (niveles 0 a 6).
 *  No autoriza, no ejecuta, no modifica reglas y no depende de la recomendación del Director. */

interface Resolucion {
  decision: Decision;
  nivel: NivelDecisivo;
  detalle: string;
  motivos: MotivoDecision[];
  condicion_ejecucion?: string;
  porcentaje?: number;
  monto?: string;
  confirmaciones?: ConfirmacionUsuario[];
  revision_formal?: boolean;
  motivo_codigo?: string;
}

const ES_POSICION: ReadonlySet<TipoEvaluacion> = new Set<TipoEvaluacion>(['posicion_abierta', 'revision_tesis']);
const CAUSAS_DURAS = new Set(['snapshot_vencido', 'posicion_no_confirmada', 'portafolio_no_declarado']);

// ------------------------------------------------------------------ Entrada

function verificarEntrada(e: EntradaMotor): void {
  if (RUTA_POR_TIPO[e.tipo_evaluacion] !== e.ruta) {
    throw new ErrorMotor(`La ruta ${e.ruta} no corresponde al tipo ${e.tipo_evaluacion}`);
  }
  if (e.ruta === 'determinista' && e.director.estado !== 'no_aplica') {
    throw new ErrorMotor('La ruta determinista no usa Director: su estado debe ser no_aplica');
  }
}

// ------------------------------------------------------------------ Nivel 0: integridad

interface Integridad {
  causas: MotivoEstado[];
  /** Causas que impiden confiar en cualquier cálculo (auditoría, vigencia, posición, portafolio). */
  duras: boolean;
}

function evaluarIntegridad(e: EntradaMotor): Integridad {
  const causas: MotivoEstado[] = [];
  let duras = false;

  if (e.portafolio_codigo === null) {
    causas.push({ codigo: 'portafolio_no_declarado', detalle: 'La solicitud no declara portafolio' });
    duras = true;
  }
  if (e.auditoria === null) {
    causas.push({ codigo: 'agente_requerido_fallo', detalle: 'auditor_reglas: no hay resultado de auditoría' });
    duras = true;
  } else if (e.auditoria.veredicto === 'NO_EVALUABLE') {
    causas.push({ codigo: 'datos_faltantes', detalle: 'El Auditor no pudo evaluar las reglas obligatorias' });
    duras = true;
  }
  if (e.datos_vencidos.length > 0) {
    causas.push({ codigo: 'snapshot_vencido', detalle: `Datos vencidos: ${e.datos_vencidos.join(', ')}` });
    duras = true;
  }
  if (!e.posicion_confirmada) {
    causas.push({ codigo: 'posicion_no_confirmada', detalle: 'No se puede confirmar si existe la posición (ticker + portafolio)' });
    duras = true;
  }
  if (e.datos_faltantes.length > 0) {
    causas.push({ codigo: 'datos_faltantes', detalle: `Datos faltantes: ${e.datos_faltantes.join(', ')}` });
  }
  for (const agente of e.agentes_requeridos) {
    const r = e.resultados_agentes[agente];
    if (!r || r.estado !== 'ok') {
      causas.push({ codigo: 'agente_requerido_fallo', detalle: `${agente}: ${r ? r.estado : 'sin resultado'}` });
    } else if (r.veredicto === 'NO_EVALUABLE') {
      causas.push({ codigo: 'datos_faltantes', detalle: `${agente} devolvió NO_EVALUABLE` });
    }
  }
  return { causas, duras };
}

// ------------------------------------------------------------------ Normalización (informativa)

export function normalizarVeredicto(agente: Agente, original: string): VeredictoNormalizado {
  const tabla: Record<Agente, Record<string, VeredictoNormalizado>> = {
    fundamental: { SOLIDO: 'FAVORABLE', ACEPTABLE: 'NEUTRAL', DEBIL: 'DESFAVORABLE', NO_EVALUABLE: 'SIN_DATOS' },
    valuacion: { BARATA: 'FAVORABLE', RAZONABLE: 'NEUTRAL', CARA: 'DESFAVORABLE', NO_EVALUABLE: 'SIN_DATOS' },
    tecnico: { FAVORABLE: 'FAVORABLE', ESPERAR: 'NEUTRAL', DESFAVORABLE: 'DESFAVORABLE', NO_EVALUABLE: 'SIN_DATOS' },
    riesgo_capital: { VIABLE: 'FAVORABLE', VIABLE_CON_AJUSTE: 'NEUTRAL', NO_VIABLE: 'DESFAVORABLE', DATOS_INSUFICIENTES: 'SIN_DATOS' },
  };
  return tabla[agente][original] ?? 'SIN_DATOS';
}

// ------------------------------------------------------------------ Resoluciones por tipo

function negativoPorTipo(tipo: TipoEvaluacion): Decision {
  if (tipo === 'nueva_posicion' || tipo === 'aporte_periodico') return 'NO_COMPRAR';
  if (tipo === 'recompra') return 'NO_RECOMPRAR';
  throw new ErrorMotor(`El veredicto NO_ELEGIBLE no aplica al tipo ${tipo}`);
}

function noEvaluable(integridad: Integridad, nivel: NivelDecisivo = 'datos'): Resolucion {
  return {
    decision: 'NO_EVALUABLE', nivel,
    detalle: `No se puede concluir con la información disponible: ${integridad.causas.map((c) => c.detalle).join('; ')}`,
    motivos: integridad.causas.map((c) => ({ nivel: 'datos', codigo: c.codigo, resultado: 'no_evaluable', detalle: c.detalle })),
  };
}

function decidirEntrada(e: EntradaMotor, recompra: boolean): Resolucion {
  const negativa: Decision = recompra ? 'NO_RECOMPRAR' : 'NO_COMPRAR';
  const positiva: Decision = recompra ? 'RECOMPRAR' : 'COMPRAR';
  const motivos: MotivoDecision[] = [
    { nivel: 'reglas', codigo: 'AUDITORIA', resultado: 'cumple', detalle: 'El Auditor no reporta infracciones ni filtros fallidos' },
  ];

  // Nivel 2: riesgo y capital
  const monto = e.capital?.monto_requerido ?? e.monto_operacion ?? null;
  const efectivo = e.capital?.efectivo_disponible ?? null;
  if (monto === null || efectivo === null) {
    const falta = monto === null ? 'monto de la operación' : 'efectivo disponible';
    return {
      decision: 'NO_EVALUABLE', nivel: 'datos', detalle: `Falta el ${falta}: no se puede evaluar capital`,
      motivos: [...motivos, { nivel: 'riesgo_capital', codigo: 'CAPITAL', resultado: 'no_evaluable', detalle: `Falta el ${falta}` }],
    };
  }
  if (menorQue(efectivo, monto)) {
    const necesario = restar(monto, efectivo);
    return {
      decision: 'ESPERAR', nivel: 'riesgo_capital', motivo_codigo: 'capital_insuficiente',
      detalle: `Efectivo insuficiente: faltan ${necesario} para el monto de ${monto}`,
      condicion_ejecucion: `Disponer de ${necesario} adicionales de efectivo en la billetera`,
      motivos: [...motivos, { nivel: 'riesgo_capital', codigo: 'CAPITAL', resultado: 'incumple', detalle: `Efectivo ${efectivo} < monto ${monto}` }],
    };
  }
  if (e.capital?.veredicto_riesgo === 'NO_VIABLE') {
    return {
      decision: 'ESPERAR', nivel: 'riesgo_capital', motivo_codigo: 'limite_riesgo',
      detalle: 'Un límite duro de riesgo o capital registrado no permite la operación',
      condicion_ejecucion: 'Que la operación vuelva a caber dentro de los límites registrados',
      motivos: [...motivos, { nivel: 'riesgo_capital', codigo: 'LIMITE', resultado: 'incumple', detalle: 'Riesgo y Capital: NO_VIABLE' }],
    };
  }
  motivos.push({
    nivel: 'riesgo_capital', codigo: 'CAPITAL',
    resultado: e.capital?.veredicto_riesgo === 'DATOS_INSUFICIENTES' ? 'informativo' : 'cumple',
    detalle: e.capital?.veredicto_riesgo === 'DATOS_INSUFICIENTES'
      ? 'Sin límites de riesgo registrados: se reporta como informativo, no bloquea' : 'Efectivo suficiente',
  });

  // Nivel 3: tesis
  if (e.tesis_estado === 'rota' || e.tesis_estado === 'debilitada') {
    return {
      decision: negativa, nivel: 'tesis', revision_formal: recompra, motivo_codigo: 'tesis_no_vigente',
      detalle: `La tesis está ${e.tesis_estado}`,
      motivos: [...motivos, { nivel: 'tesis', codigo: 'TESIS', resultado: 'incumple', detalle: `Tesis ${e.tesis_estado}` }],
    };
  }

  // Nivel 4: valuación
  const valuacion = e.resultados_agentes.valuacion?.veredicto;
  if (valuacion === 'CARA') {
    return {
      decision: 'ESPERAR', nivel: 'valuacion', motivo_codigo: 'valuacion_cara',
      detalle: 'La valuación es CARA al precio actual',
      condicion_ejecucion: 'Un precio que lleve la valuación a RAZONABLE o BARATA',
      motivos: [...motivos, { nivel: 'valuacion', codigo: 'VALUACION', resultado: 'incumple', detalle: 'Valuación CARA' }],
    };
  }

  // Nivel 5: fundamentales (el umbral solo aplica a PMP y PLP)
  const fundamental = e.resultados_agentes.fundamental?.veredicto;
  if (fundamental === 'DEBIL' && (e.portafolio_codigo === 'PMP' || e.portafolio_codigo === 'PLP')) {
    return {
      decision: negativa, nivel: 'fundamentales', motivo_codigo: 'fundamentales_debiles',
      detalle: 'Los fundamentales son DEBILES y el umbral de PMP y PLP no los admite',
      motivos: [...motivos, { nivel: 'fundamentales', codigo: 'FUNDAMENTAL', resultado: 'incumple', detalle: 'Fundamental DEBIL' }],
    };
  }

  // Nivel 6: técnico y momento de ejecución
  const tecnico = e.resultados_agentes.tecnico?.veredicto;
  const m = e.momento;
  if (!m || !m.detonante_confirmado) {
    const pendientes = m?.confirmaciones_usuario ?? [];
    return {
      decision: 'ESPERAR', nivel: 'tecnico', confirmaciones: pendientes,
      motivo_codigo: pendientes.length > 0 ? 'confirmacion_usuario' : 'sin_detonante',
      detalle: pendientes.length > 0
        ? `Solo hay señales discrecionales (${pendientes.map((p) => p.senal).join(', ')}) que esperan tu confirmación visual`
        : 'Falta el detonante de ejecución',
      condicion_ejecucion: m?.condicion_ejecucion ?? 'Que se confirme el detonante de ejecución',
      motivos: [...motivos, { nivel: 'tecnico', codigo: 'DETONANTE', resultado: 'incumple', detalle: 'Detonante no confirmado' }],
    };
  }
  if (tecnico === 'DESFAVORABLE') {
    return {
      decision: 'ESPERAR', nivel: 'tecnico', motivo_codigo: 'tecnico_desfavorable',
      detalle: 'El Técnico considera desfavorable el momento de ejecución',
      condicion_ejecucion: m.condicion_ejecucion ?? 'Que el momento técnico deje de ser desfavorable',
      motivos: [...motivos, { nivel: 'tecnico', codigo: 'TECNICO', resultado: 'incumple', detalle: 'Técnico DESFAVORABLE' }],
    };
  }

  const resolucion: Resolucion = {
    decision: positiva, nivel: 'tecnico', motivo_codigo: 'todo_cumple',
    detalle: 'Reglas, capital, tesis, valuación, fundamentales y detonante se cumplen',
    motivos: [...motivos, { nivel: 'tecnico', codigo: 'DETONANTE', resultado: 'cumple', detalle: 'Detonante confirmado' }],
  };
  if (e.monto_operacion !== undefined) resolucion.monto = e.monto_operacion;
  return resolucion;
}

function decidirPosicion(e: EntradaMotor, integridad: Integridad): Resolucion {
  const s = e.salida ?? {};
  const motivos: MotivoDecision[] = [
    { nivel: 'reglas', codigo: 'AUDITORIA', resultado: 'cumple', detalle: 'El Auditor no reporta infracciones' },
  ];

  const candidataDeSalida = !!s.exigida || (s.discrecionales_pendientes?.length ?? 0) > 0;
  if (integridad.causas.length > 0) {
    // Una regla independiente que exige actuar prevalece sobre datos faltantes de los analistas,
    // pero nunca sobre datos vencidos, auditoría ausente o posición sin confirmar.
    if (s.exigida && !integridad.duras) {
      return resolverSalida(s.exigida, motivos);
    }
    if (candidataDeSalida) return noEvaluable(integridad);
    return {
      decision: 'MANTENER_BAJO_VIGILANCIA', nivel: 'datos', motivo_codigo: 'datos_incompletos',
      detalle: `Datos incompletos sin deterioro confirmado: ${integridad.causas.map((c) => c.detalle).join('; ')}`,
      motivos: [...motivos, ...integridad.causas.map((c): MotivoDecision => ({ nivel: 'datos', codigo: c.codigo, resultado: 'no_evaluable', detalle: c.detalle }))],
    };
  }

  if (s.exigida) return resolverSalida(s.exigida, motivos);

  const pendientes = s.discrecionales_pendientes ?? [];
  if (pendientes.length > 0) {
    return {
      decision: 'ESPERAR', nivel: 'tecnico', confirmaciones: pendientes, motivo_codigo: 'confirmacion_usuario',
      detalle: `Solo hay señales discrecionales de salida (${pendientes.map((p) => p.senal).join(', ')}) que esperan tu confirmación visual`,
      condicion_ejecucion: 'Tu confirmación visual de la señal',
      motivos: [...motivos, { nivel: 'tecnico', codigo: 'SALIDA_DISCRECIONAL', resultado: 'informativo', detalle: 'Señal solo discrecional' }],
    };
  }
  if (e.tesis_estado === 'rota') {
    return {
      decision: 'MANTENER_BAJO_VIGILANCIA', nivel: 'tesis', revision_formal: true, motivo_codigo: 'tesis_rota',
      detalle: 'La tesis está invalidada: se abre una revisión formal; no hay venta automática',
      motivos: [...motivos, { nivel: 'tesis', codigo: 'TESIS', resultado: 'incumple', detalle: 'Tesis rota' }],
    };
  }
  if (s.stop_tocado) {
    const referencia = s.stop_efecto !== 'zona_recompra';
    return {
      decision: 'MANTENER_BAJO_VIGILANCIA', nivel: 'riesgo_capital', revision_formal: referencia, motivo_codigo: 'stop_tocado',
      detalle: referencia
        ? 'El precio tocó el stop de referencia: no vende por sí solo; se abre una revisión formal de la tesis'
        : 'El precio tocó el stop del plan escalonado: marca una zona de posible recompra',
      motivos: [...motivos, { nivel: 'riesgo_capital', codigo: 'STOP', resultado: 'informativo', detalle: 'Stop tocado' }],
    };
  }
  if (e.tesis_estado === 'debilitada') {
    return {
      decision: 'MANTENER_BAJO_VIGILANCIA', nivel: 'tesis', motivo_codigo: 'tesis_debilitada',
      detalle: 'La tesis está debilitada sin invalidación confirmada',
      motivos: [...motivos, { nivel: 'tesis', codigo: 'TESIS', resultado: 'informativo', detalle: 'Tesis debilitada' }],
    };
  }
  return {
    decision: 'MANTENER', nivel: 'tesis', motivo_codigo: 'tesis_vigente',
    detalle: 'Tesis vigente y riesgos aceptables',
    motivos: [...motivos, { nivel: 'tesis', codigo: 'TESIS', resultado: 'cumple', detalle: 'Tesis vigente' }],
  };
}

function resolverSalida(x: NonNullable<EntradaMotor['salida']>['exigida'] & object, motivos: MotivoDecision[]): Resolucion {
  const r: Resolucion = {
    decision: x.decision, nivel: 'reglas', motivo_codigo: x.regla,
    detalle: x.detalle ?? `La regla ${x.regla} exige la salida`,
    motivos: [...motivos, { nivel: 'reglas', codigo: x.regla, resultado: 'informativo', detalle: x.detalle ?? 'Salida exigida por regla' }],
  };
  if (x.porcentaje !== undefined) r.porcentaje = x.porcentaje;
  return r;
}

function decidirAporte(e: EntradaMotor): Resolucion {
  const a = e.aporte;
  if (!a) throw new ErrorMotor('aporte_periodico exige el contexto de aporte');
  const motivos: MotivoDecision[] = [];
  if (!a.elegibilidad_verificable || a.efectivo_disponible === null) {
    return {
      decision: 'NO_EVALUABLE', nivel: 'datos', motivo_codigo: 'no_verificable',
      detalle: 'No se puede verificar la elegibilidad o el efectivo: los datos faltantes no se disfrazan de NO_COMPRAR',
      motivos: [{ nivel: 'datos', codigo: 'APORTE', resultado: 'no_evaluable', detalle: 'Elegibilidad o efectivo no verificables' }],
    };
  }
  if (a.duplicado) {
    return {
      decision: 'NO_COMPRAR', nivel: 'datos', motivo_codigo: 'duplicado',
      detalle: 'La transferencia de este aporte ya se registró (duplicado)',
      motivos: [{ nivel: 'datos', codigo: 'DUPLICADO', resultado: 'incumple', detalle: 'Aporte ya registrado' }],
    };
  }
  if (mayorOIgual(a.efectivo_disponible, a.monto_requerido)) {
    return {
      decision: 'COMPRAR', nivel: 'riesgo_capital', monto: a.monto, motivo_codigo: 'aporte_completo',
      detalle: `Aporte periódico por el monto completo de ${a.monto}`,
      motivos: [{ nivel: 'riesgo_capital', codigo: 'CAPITAL', resultado: 'cumple', detalle: `Efectivo ${a.efectivo_disponible} >= ${a.monto_requerido}` }],
    };
  }
  if (a.monto_reducido != null && mayorOIgual(a.efectivo_disponible, a.monto_reducido)) {
    return {
      decision: 'COMPRAR', nivel: 'riesgo_capital', monto: a.monto_reducido, motivo_codigo: 'aporte_reducido',
      detalle: `Aporte periódico por el monto reducido de ${a.monto_reducido}, que la regla permite`,
      motivos: [{ nivel: 'riesgo_capital', codigo: 'CAPITAL', resultado: 'informativo', detalle: 'Efectivo solo alcanza el monto reducido' }],
    };
  }
  return {
    decision: 'NO_COMPRAR', nivel: 'riesgo_capital', motivo_codigo: 'capital',
    detalle: `Sin efectivo suficiente (${a.efectivo_disponible} < ${a.monto_requerido}): no se compra`,
    motivos: [{ nivel: 'riesgo_capital', codigo: 'CAPITAL', resultado: 'incumple', detalle: 'Efectivo insuficiente' }],
  };
}

function decidirRevisionETF(e: EntradaMotor): Resolucion {
  const r = e.revision_etf;
  if (!r) throw new ErrorMotor('revision_anual_etf exige el contexto de la revisión');
  if (!r.comparable) {
    return {
      decision: 'NO_EVALUABLE', nivel: 'datos', motivo_codigo: 'no_comparable',
      detalle: 'Los datos no son comparables con SPY (por ejemplo, menos de 12 meses de historial)',
      motivos: [{ nivel: 'datos', codigo: 'ETF-03', resultado: 'no_evaluable', detalle: 'Comparación no equivalente' }],
    };
  }
  if (r.supera_spy) {
    return {
      decision: 'MANTENER', nivel: 'reglas', motivo_codigo: 'supera_spy',
      detalle: 'El ETF supera a SPY: se mantiene y el conteo de fallas vuelve a cero',
      motivos: [{ nivel: 'reglas', codigo: 'ETF-03', resultado: 'cumple', detalle: 'Supera a SPY' }],
    };
  }
  if (!r.fallo_anterior) {
    return {
      decision: 'REDUCIR', nivel: 'reglas', porcentaje: 50, motivo_codigo: 'no_supera_primera_vez',
      detalle: 'No supera a SPY y no falló el año anterior: se reduce 50%; el dinero se reparte entre los demás sectoriales',
      motivos: [{ nivel: 'reglas', codigo: 'ETF-03', resultado: 'incumple', detalle: 'No supera a SPY (primera falla)' }],
    };
  }
  return {
    decision: 'VENDER', nivel: 'reglas', porcentaje: 100, motivo_codigo: 'no_supera_segunda_vez',
    detalle: 'No supera a SPY y falló el año anterior: se vende el resto; el dinero se reparte entre los demás sectoriales',
    motivos: [{ nivel: 'reglas', codigo: 'ETF-03', resultado: 'incumple', detalle: 'No supera a SPY (falla consecutiva)' }],
  };
}

function decidirRetiro(e: EntradaMotor): Resolucion {
  const r = e.retiro;
  if (!r) throw new ErrorMotor('retiro_quinquenal exige el contexto del retiro');
  if (!r.datos_completos) {
    return {
      decision: 'NO_EVALUABLE', nivel: 'datos', motivo_codigo: 'datos_incompletos',
      detalle: 'Faltan datos para calcular el retiro quinquenal sobre la cantidad remanente',
      motivos: [{ nivel: 'datos', codigo: 'ETF-04', resultado: 'no_evaluable', detalle: 'Datos incompletos' }],
    };
  }
  return {
    decision: 'REDUCIR', nivel: 'reglas', porcentaje: r.porcentaje, motivo_codigo: 'retiro_quinquenal',
    detalle: `Retiro quinquenal (ETF-04): se vende el ${r.porcentaje}% de la cantidad remanente`,
    motivos: [{ nivel: 'reglas', codigo: 'ETF-04', resultado: 'informativo', detalle: 'Retiro programado' }],
  };
}

// ------------------------------------------------------------------ Textos (plantillas, sin IA)

const SIGUIENTE_PASO: Record<Decision, string> = {
  COMPRAR: 'Revisa la decisión y, si la autorizas, opera en tu bróker y vincula la operación en TradingCat.',
  RECOMPRAR: 'Revisa la decisión y, si la autorizas, opera en tu bróker y vincula la operación en TradingCat.',
  REDUCIR: 'Revisa el porcentaje propuesto y, si lo autorizas, opera en tu bróker y vincula la operación en TradingCat.',
  VENDER: 'Revisa la venta propuesta y, si la autorizas, opera en tu bróker y vincula la operación en TradingCat.',
  ESPERAR: 'No operes todavía. Espera a que se cumpla la condición indicada y vuelve a evaluar.',
  NO_COMPRAR: 'No operes. Se vuelve a evaluar si cambia el dato que incumple el filtro.',
  NO_RECOMPRAR: 'No operes. Se vuelve a evaluar si cambia el dato que incumple el filtro.',
  MANTENER: 'Sin acción. La posición se revisa en la próxima evaluación.',
  MANTENER_BAJO_VIGILANCIA: 'Mantén la posición y atiende el seguimiento indicado; no se vende de forma automática.',
  VIGILAR: 'Observa la condición pendiente antes de volver a evaluar.',
  NO_EVALUABLE: 'Completa los datos o análisis faltantes indicados y vuelve a evaluar.',
  BLOQUEADO: 'No continúes con la operación hasta levantar la regla que la impide.',
};

const CONDICION_CAMBIO: Record<Decision, string> = {
  COMPRAR: 'Cambia si vencen los datos, ocurre un evento material o se modifica una regla aplicable.',
  RECOMPRAR: 'Cambia si vencen los datos, ocurre un evento material o se modifica una regla aplicable.',
  REDUCIR: 'Cambia si vencen los datos, ocurre un evento material o la regla de salida deja de cumplirse.',
  VENDER: 'Cambia si vencen los datos, ocurre un evento material o la regla de salida deja de cumplirse.',
  ESPERAR: 'Cambia cuando se cumpla la condición de ejecución indicada o se confirme la señal pendiente.',
  NO_COMPRAR: 'Cambia si el dato que incumple el filtro de entrada deja de incumplirlo.',
  NO_RECOMPRAR: 'Cambia si el dato que incumple el filtro de entrada deja de incumplirlo.',
  MANTENER: 'Cambia si la tesis se debilita, se activa una regla de salida o ocurre un evento material.',
  MANTENER_BAJO_VIGILANCIA: 'Cambia con la revisión formal, un evento material o la llegada de los datos faltantes.',
  VIGILAR: 'Cambia cuando se cumpla la condición observable pendiente.',
  NO_EVALUABLE: 'Cambia cuando estén disponibles los datos y análisis requeridos y vigentes.',
  BLOQUEADO: 'Cambia solo si se levanta la infracción de la regla obligatoria.',
};

// ------------------------------------------------------------------ Punto de entrada

export function decidir(e: EntradaMotor): SalidaMotor {
  verificarEntrada(e);
  const integridad = evaluarIntegridad(e);
  const auditoria = e.auditoria;

  let r: Resolucion;
  if (auditoria?.veredicto === 'BLOQUEO_REGLA') {
    // Nivel 1: una infracción confirmada prevalece sobre datos faltantes y sobre fallas de agentes.
    r = {
      decision: 'BLOQUEADO', nivel: 'reglas', motivo_codigo: 'bloqueo_regla',
      detalle: 'El Auditor reporta una infracción de una regla obligatoria (estructura o límite)',
      motivos: [{ nivel: 'reglas', codigo: 'AUDITORIA', resultado: 'incumple', detalle: 'BLOQUEO_REGLA' }],
    };
  } else if (auditoria?.veredicto === 'NO_ELEGIBLE' && e.datos_vencidos.length === 0) {
    // Un filtro de elegibilidad fallido es un resultado negativo conocido: no se oculta como NO_EVALUABLE.
    r = {
      decision: negativoPorTipo(e.tipo_evaluacion), nivel: 'reglas', motivo_codigo: 'no_elegible',
      detalle: 'No cumple un filtro de elegibilidad de entrada del portafolio',
      motivos: [{ nivel: 'reglas', codigo: 'AUDITORIA', resultado: 'incumple', detalle: 'NO_ELEGIBLE' }],
    };
  } else if (ES_POSICION.has(e.tipo_evaluacion)) {
    r = decidirPosicion(e, integridad);
  } else if (integridad.causas.length > 0) {
    r = noEvaluable(integridad);
  } else {
    switch (e.tipo_evaluacion) {
      case 'nueva_posicion': r = decidirEntrada(e, false); break;
      case 'recompra': r = decidirEntrada(e, true); break;
      case 'revision_tesis': r = decidirPosicion(e, integridad); break;
      case 'aporte_periodico': r = decidirAporte(e); break;
      case 'revision_anual_etf': r = decidirRevisionETF(e); break;
      case 'retiro_quinquenal': r = decidirRetiro(e); break;
      case 'posicion_abierta': r = decidirPosicion(e, integridad); break;
    }
  }

  validarDecision(e.tipo_evaluacion, r.decision);

  const { estado, motivos: motivosEstado } = calcularEstadoFinal({
    decision: r.decision, causas: integridad.causas, director: e.director.estado,
  });

  const requiere = requiereAutorizacion(r.decision);
  const analisisIds = [
    ...Object.values(e.resultados_agentes).flatMap((x) => (x?.analisis_id ? [x.analisis_id] : [])),
    ...(e.auditoria?.analisis_id ? [e.auditoria.analisis_id] : []),
  ];
  const veredictos = e.agentes_requeridos.flatMap((agente) => {
    const x = e.resultados_agentes[agente];
    if (!x || x.veredicto === undefined) return [];
    return [{
      agente, original: x.veredicto, normalizado: normalizarVeredicto(agente, x.veredicto),
      ...(x.analisis_id ? { analisis_id: x.analisis_id } : {}),
    }];
  });

  const salida: SalidaMotor = {
    corrida_id: e.corrida_id,
    ticker: e.ticker,
    portafolio_codigo: e.portafolio_codigo,
    tipo_evaluacion: e.tipo_evaluacion,
    decision: r.decision,
    nivel_decisivo: r.nivel,
    explicacion: r.detalle,
    siguiente_paso: r.decision === 'ESPERAR' && r.condicion_ejecucion
      ? `No operes todavía. Condición: ${r.condicion_ejecucion}. Después vuelve a evaluar.`
      : r.decision === 'MANTENER_BAJO_VIGILANCIA' && r.revision_formal
        ? 'Abre una revisión formal de la posición; no se vende de forma automática.'
        : SIGUIENTE_PASO[r.decision],
    condicion_cambio: CONDICION_CAMBIO[r.decision],
    condicion_ejecucion: r.condicion_ejecucion ?? null,
    motivos: r.motivos,
    datos_faltantes: [...e.datos_faltantes],
    reglas_versiones_ids: [...e.reglas_versiones_ids],
    analisis_ids: analisisIds,
    auditoria_veredicto: e.auditoria?.veredicto ?? null,
    tesis_estado: e.tesis_estado ?? null,
    requiere_autorizacion: requiere,
    estado_usuario: requiere ? 'pendiente' : 'no_requerida',
    requiere_revision_formal: r.revision_formal ?? false,
    detalle_portafolio: {
      ...(r.porcentaje !== undefined ? { porcentaje: r.porcentaje } : {}),
      ...(r.monto !== undefined ? { monto: r.monto } : {}),
      ...(r.motivo_codigo !== undefined ? { motivo_codigo: r.motivo_codigo } : {}),
      confirmaciones_usuario: r.confirmaciones ?? [],
      veredictos,
      ...(e.decision_previa_id ? { decision_previa_id: e.decision_previa_id } : {}),
    },
    estado_final: estado,
    motivos_estado: motivosEstado,
    director_estado: e.director.estado,
  };

  verificarInvariantes(salida, e.ruta === 'determinista');
  return salida;
}
