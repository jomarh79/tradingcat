import { describe, expect, it } from 'vitest';
import {
  DECISIONES, ErrorMotor, TIPOS_EVALUACION, VOCABULARIO_POR_TIPO, calcularVencimiento, decidir,
  evaluarExpiracion, evaluarSalidaPCP, transicionAutorizacion, validarDecision,
} from './index';
import type { CalendarioHabil, EntradaMotor } from './index';

// ------------------------------------------------------------------ Datos de prueba

const ok = (veredicto: string) => ({ estado: 'ok' as const, veredicto, analisis_id: `a-${veredicto}` });

function nuevaPosicion(extra: Partial<EntradaMotor> = {}): EntradaMotor {
  return {
    corrida_id: 'c1', ticker: 'GKOS', portafolio_codigo: 'PMP', tipo_evaluacion: 'nueva_posicion', ruta: 'analitica',
    fecha_evaluacion: '2026-10-15', reglas_versiones_ids: ['r1'], parametros_versiones: [{ clave: 'frescura.precio', version: 1 }],
    snapshot_id: 's1', agentes_requeridos: ['fundamental', 'valuacion', 'tecnico', 'riesgo_capital'],
    resultados_agentes: {
      fundamental: ok('SOLIDO'), valuacion: ok('RAZONABLE'), tecnico: ok('FAVORABLE'), riesgo_capital: ok('VIABLE'),
    },
    auditoria: { veredicto: 'CUMPLE', reglas_revisadas: ['PMP-01', 'PMP-02'], analisis_id: 'aud1' },
    director: { estado: 'ok' }, datos_vencidos: [], datos_faltantes: [], posicion_confirmada: true,
    capital: { efectivo_disponible: '100', monto_requerido: '50', veredicto_riesgo: 'VIABLE' },
    tesis_estado: 'intacta', momento: { detonante_confirmado: true }, monto_operacion: '50',
    ...extra,
  };
}

function posicion(portafolio: EntradaMotor['portafolio_codigo'], extra: Partial<EntradaMotor> = {}): EntradaMotor {
  return {
    ...nuevaPosicion(), portafolio_codigo: portafolio, tipo_evaluacion: 'posicion_abierta', ruta: 'posicion_abierta',
    agentes_requeridos: ['tecnico'], resultados_agentes: { tecnico: ok('ESPERAR') },
    capital: undefined, momento: undefined, monto_operacion: undefined,
    ...extra,
  };
}

function aporteETF(extra: Partial<EntradaMotor> = {}): EntradaMotor {
  return {
    ...nuevaPosicion(), portafolio_codigo: 'ETF', tipo_evaluacion: 'aporte_periodico', ruta: 'determinista',
    agentes_requeridos: [], resultados_agentes: {}, capital: undefined, momento: undefined, monto_operacion: undefined,
    director: { estado: 'no_aplica' },
    aporte: { monto: '2', monto_requerido: '8', monto_reducido: null, efectivo_disponible: '10', duplicado: false, elegibilidad_verificable: true },
    ...extra,
  };
}

function revisionETF(r: NonNullable<EntradaMotor['revision_etf']>): EntradaMotor {
  return { ...aporteETF(), tipo_evaluacion: 'revision_anual_etf', aporte: undefined, revision_etf: r };
}

// ------------------------------------------------------------------ Camino normal

describe('camino normal', () => {
  it('apertura favorable: COMPRAR pendiente de autorización, completada', () => {
    const s = decidir(nuevaPosicion());
    expect(s.decision).toBe('COMPRAR');
    expect(s.requiere_autorizacion).toBe(true);
    expect(s.estado_usuario).toBe('pendiente');
    expect(s.estado_final).toBe('completada');
    expect(s.detalle_portafolio.monto).toBe('50');
    expect(s.analisis_ids).toContain('aud1');
  });
  it('recompra favorable: RECOMPRAR', () => {
    const s = decidir(nuevaPosicion({ tipo_evaluacion: 'recompra' }));
    expect(s.decision).toBe('RECOMPRAR');
  });
  it('datos vencidos: NO_EVALUABLE y pendiente_informacion, nunca COMPRAR', () => {
    const s = decidir(nuevaPosicion({ datos_vencidos: ['precio'] }));
    expect(s.decision).toBe('NO_EVALUABLE');
    expect(s.estado_final).toBe('pendiente_informacion');
    expect(s.motivos_estado.map((m) => m.codigo)).toContain('snapshot_vencido');
  });
  it('datos faltantes impiden COMPRAR (la base los rechaza)', () => {
    const s = decidir(nuevaPosicion({ datos_faltantes: ['guia_2027'] }));
    expect(s.decision).toBe('NO_EVALUABLE');
  });
  it('posición no confirmada: NO_EVALUABLE y pendiente_informacion', () => {
    const s = decidir(nuevaPosicion({ posicion_confirmada: false }));
    expect(s.decision).toBe('NO_EVALUABLE');
    expect(s.motivos_estado.map((m) => m.codigo)).toContain('posicion_no_confirmada');
  });
  it('Fundamental DEBIL no abre en PMP, pero el umbral no aplica a PCP', () => {
    const debil = { fundamental: ok('DEBIL'), valuacion: ok('RAZONABLE'), tecnico: ok('FAVORABLE'), riesgo_capital: ok('VIABLE') };
    expect(decidir(nuevaPosicion({ resultados_agentes: debil })).decision).toBe('NO_COMPRAR');
    expect(decidir(nuevaPosicion({ portafolio_codigo: 'PCP', resultados_agentes: debil })).decision).toBe('COMPRAR');
  });
  it('valuación CARA espera; tesis rota en recompra: NO_RECOMPRAR con revisión formal', () => {
    const cara = { fundamental: ok('SOLIDO'), valuacion: ok('CARA'), tecnico: ok('FAVORABLE'), riesgo_capital: ok('VIABLE') };
    expect(decidir(nuevaPosicion({ resultados_agentes: cara })).decision).toBe('ESPERAR');
    const s = decidir(nuevaPosicion({ tipo_evaluacion: 'recompra', tesis_estado: 'rota' }));
    expect(s.decision).toBe('NO_RECOMPRAR');
    expect(s.requiere_revision_formal).toBe(true);
  });
  it('el Técnico DESFAVORABLE pospone pero no rechaza', () => {
    const s = decidir(nuevaPosicion({
      resultados_agentes: { fundamental: ok('SOLIDO'), valuacion: ok('RAZONABLE'), tecnico: ok('DESFAVORABLE'), riesgo_capital: ok('VIABLE') },
    }));
    expect(s.decision).toBe('ESPERAR');
    expect(s.nivel_decisivo).toBe('tecnico');
  });
  it('la ruta debe corresponder al tipo', () => {
    expect(() => decidir(nuevaPosicion({ ruta: 'determinista' }))).toThrow(ErrorMotor);
  });
});

// ------------------------------------------------------------------ M-01 a M-16

describe('M-01 a M-04: auditoría y datos', () => {
  it('M-01 Auditor BLOQUEO_REGLA: BLOQUEADO y corrida bloqueada', () => {
    const s = decidir(nuevaPosicion({ auditoria: { veredicto: 'BLOQUEO_REGLA', reglas_revisadas: ['PCP-03'] } }));
    expect(s.decision).toBe('BLOQUEADO');
    expect(s.estado_final).toBe('bloqueada');
    expect(s.requiere_autorizacion).toBe(false);
    expect(s.estado_usuario).toBe('no_requerida');
  });
  it('M-02 NO_ELEGIBLE (filtro): NO_COMPRAR, no BLOQUEADO', () => {
    const s = decidir(nuevaPosicion({ auditoria: { veredicto: 'NO_ELEGIBLE', reglas_revisadas: ['PMP-01'] } }));
    expect(s.decision).toBe('NO_COMPRAR');
    expect(s.estado_final).toBe('completada');
    const r = decidir(nuevaPosicion({ tipo_evaluacion: 'recompra', auditoria: { veredicto: 'NO_ELEGIBLE', reglas_revisadas: [] } }));
    expect(r.decision).toBe('NO_RECOMPRAR');
  });
  it('M-03 falta un analista requerido: NO_EVALUABLE y corrida incompleta', () => {
    const s = decidir(nuevaPosicion({
      resultados_agentes: { fundamental: ok('SOLIDO'), valuacion: ok('RAZONABLE'), tecnico: { estado: 'error' }, riesgo_capital: ok('VIABLE') },
    }));
    expect(s.decision).toBe('NO_EVALUABLE');
    expect(s.estado_final).toBe('incompleta');
    expect(s.motivos_estado.map((m) => m.codigo)).toContain('agente_requerido_fallo');
  });
  it('M-04 falta un analista y hay una infracción: BLOQUEADO; la falla queda en los motivos', () => {
    const s = decidir(nuevaPosicion({
      auditoria: { veredicto: 'BLOQUEO_REGLA', reglas_revisadas: ['PCP-03'] },
      resultados_agentes: { fundamental: ok('SOLIDO'), valuacion: ok('RAZONABLE'), riesgo_capital: ok('VIABLE') },
    }));
    expect(s.decision).toBe('BLOQUEADO');
    expect(s.estado_final).toBe('bloqueada');
    const codigos = s.motivos_estado.map((m) => m.codigo);
    expect(codigos).toContain('agente_requerido_fallo');
    expect(codigos).toContain('auditor_bloqueo');
  });
  it('un NO_ELEGIBLE con datos vencidos no se confía: NO_EVALUABLE', () => {
    const s = decidir(nuevaPosicion({ auditoria: { veredicto: 'NO_ELEGIBLE', reglas_revisadas: [] }, datos_vencidos: ['precio'] }));
    expect(s.decision).toBe('NO_EVALUABLE');
  });
});

describe('M-05 a M-09: capital, momento y posiciones', () => {
  it('M-05 sin efectivo: ESPERAR por capital con el monto necesario', () => {
    const s = decidir(nuevaPosicion({ capital: { efectivo_disponible: '20', monto_requerido: '50' } }));
    expect(s.decision).toBe('ESPERAR');
    expect(s.nivel_decisivo).toBe('riesgo_capital');
    expect(s.condicion_ejecucion).toContain('30');
    expect(s.detalle_portafolio.motivo_codigo).toBe('capital_insuficiente');
  });
  it('M-06 sin detonante: ESPERAR con condición de ejecución', () => {
    const s = decidir(nuevaPosicion({ momento: { detonante_confirmado: false, condicion_ejecucion: 'Cierre diario sobre 12.40' } }));
    expect(s.decision).toBe('ESPERAR');
    expect(s.condicion_ejecucion).toBe('Cierre diario sobre 12.40');
    expect(s.siguiente_paso).toContain('12.40');
  });
  it('M-07 señal solo discrecional: ESPERAR con confirmación del usuario, no vender', () => {
    const s = decidir(posicion('PCP', {
      salida: { discrecionales_pendientes: [{ senal: 'MACD', tipo: 'visual', estado: 'pendiente' }] },
    }));
    expect(s.decision).toBe('ESPERAR');
    expect(s.detalle_portafolio.confirmaciones_usuario).toHaveLength(1);
    expect(s.requiere_autorizacion).toBe(false);
  });
  it('apertura con solo señales discrecionales: ESPERAR con confirmación, no COMPRAR', () => {
    const s = decidir(nuevaPosicion({
      momento: { detonante_confirmado: false, confirmaciones_usuario: [{ senal: 'Koncorde', tipo: 'visual', estado: 'pendiente' }] },
    }));
    expect(s.decision).toBe('ESPERAR');
    expect(s.detalle_portafolio.confirmaciones_usuario[0]?.senal).toBe('Koncorde');
  });
  it('M-08 PMP toca el stop de referencia: no vende; MANTENER_BAJO_VIGILANCIA con revisión formal', () => {
    const s = decidir(posicion('PMP', { salida: { stop_tocado: true, stop_efecto: 'solo_referencia' } }));
    expect(s.decision).toBe('MANTENER_BAJO_VIGILANCIA');
    expect(s.requiere_revision_formal).toBe(true);
  });
  it('PCP escalonado toca el stop: zona de recompra, sin revisión formal ni venta', () => {
    const s = decidir(posicion('PCP', { salida: { stop_tocado: true, stop_efecto: 'zona_recompra' } }));
    expect(s.decision).toBe('MANTENER_BAJO_VIGILANCIA');
    expect(s.requiere_revision_formal).toBe(false);
  });
  it('M-09 PCP con dos compras y precio sobre el costo promedio ponderado: REDUCIR 50%', () => {
    const compras = [{ cantidad: '1', precio: '10' }, { cantidad: '1', precio: '8' }];   // promedio 9
    const base = { plan: 'escalonado' as const, compras, senal_salida: false, primera_salida_realizada: false };
    expect(evaluarSalidaPCP({ ...base, precio_actual: '9.00' })).toBeNull();            // igual al promedio: no
    const exigida = evaluarSalidaPCP({ ...base, precio_actual: '9.01' });
    expect(exigida).toMatchObject({ decision: 'REDUCIR', porcentaje: 50 });
    const s = decidir(posicion('PCP', { salida: { exigida } }));
    expect(s.decision).toBe('REDUCIR');
    expect(s.detalle_portafolio.porcentaje).toBe(50);
    expect(s.requiere_autorizacion).toBe(true);
  });
  it('PCP: una compra con señal de salida vende 100%; el plan de una compra vende al tocar el stop', () => {
    const una = { plan: 'una_compra' as const, compras: [{ cantidad: '2', precio: '5' }], primera_salida_realizada: false };
    expect(evaluarSalidaPCP({ ...una, precio_actual: '6', senal_salida: true })).toMatchObject({ decision: 'VENDER', porcentaje: 100 });
    expect(evaluarSalidaPCP({ ...una, precio_actual: '4.5', stop: '4.5', senal_salida: false })).toMatchObject({ regla: 'PCP-07' });
    expect(evaluarSalidaPCP({ ...una, plan: 'escalonado', precio_actual: '4', stop: '4.5', senal_salida: false })).toBeNull();
    const dos = { plan: 'escalonado' as const, compras: [{ cantidad: '1', precio: '10' }, { cantidad: '1', precio: '8' }], precio_actual: '8', stop: null };
    expect(evaluarSalidaPCP({ ...dos, senal_salida: true, primera_salida_realizada: true })).toMatchObject({ decision: 'VENDER' });
  });
  it('una regla que exige salir prevalece sobre datos faltantes de un analista, pero no sobre datos vencidos', () => {
    const exigida = { decision: 'VENDER' as const, porcentaje: 100, regla: 'PCP-07' };
    const falla = { tecnico: { estado: 'error' as const } };
    const a = decidir(posicion('PCP', { resultados_agentes: falla, salida: { exigida } }));
    expect(a.decision).toBe('VENDER');
    expect(a.estado_final).toBe('incompleta');
    const b = decidir(posicion('PCP', { resultados_agentes: falla, datos_vencidos: ['precio'], salida: { exigida } }));
    expect(b.decision).toBe('NO_EVALUABLE');
  });
  it('posición abierta con datos incompletos y sin motivo de salida: MANTENER_BAJO_VIGILANCIA', () => {
    const s = decidir(posicion('PMP', { resultados_agentes: { tecnico: { estado: 'error' } } }));
    expect(s.decision).toBe('MANTENER_BAJO_VIGILANCIA');
    expect(s.estado_final).toBe('incompleta');
  });
  it('tesis rota con posición abierta: MANTENER_BAJO_VIGILANCIA con revisión formal; sin venta automática', () => {
    const s = decidir(posicion('PLP', { tesis_estado: 'rota' }));
    expect(s.decision).toBe('MANTENER_BAJO_VIGILANCIA');
    expect(s.requiere_revision_formal).toBe(true);
  });
  it('posición abierta sin novedades: MANTENER', () => {
    expect(decidir(posicion('PMP')).decision).toBe('MANTENER');
  });
});

describe('M-10 a M-12: ruta determinista', () => {
  it('M-10 aporte de ETFs sin efectivo para el total: NO_COMPRAR por capital, nunca aporte reducido', () => {
    const s = decidir(aporteETF({
      aporte: { monto: '2', monto_requerido: '8', monto_reducido: null, efectivo_disponible: '3', duplicado: false, elegibilidad_verificable: true },
    }));
    expect(s.decision).toBe('NO_COMPRAR');
    expect(s.detalle_portafolio.motivo_codigo).toBe('capital');
    expect(s.director_estado).toBe('no_aplica');
    expect(decidir(aporteETF()).decision).toBe('COMPRAR');
    expect(decidir(aporteETF()).detalle_portafolio.monto).toBe('2');
  });
  it('un aporte con monto reducido permitido por la regla compra el reducido', () => {
    const s = decidir(aporteETF({
      aporte: { monto: '25', monto_requerido: '25', monto_reducido: '10', efectivo_disponible: '12', duplicado: false, elegibilidad_verificable: true },
    }));
    expect(s.decision).toBe('COMPRAR');
    expect(s.detalle_portafolio.monto).toBe('10');
  });
  it('M-11 transferencia ya registrada: NO_COMPRAR por duplicado', () => {
    const s = decidir(aporteETF({
      aporte: { monto: '2', monto_requerido: '8', monto_reducido: null, efectivo_disponible: '100', duplicado: true, elegibilidad_verificable: true },
    }));
    expect(s.decision).toBe('NO_COMPRAR');
    expect(s.detalle_portafolio.motivo_codigo).toBe('duplicado');
  });
  it('un aporte con elegibilidad no verificable es NO_EVALUABLE, no NO_COMPRAR', () => {
    const s = decidir(aporteETF({
      aporte: { monto: '2', monto_requerido: '8', monto_reducido: null, efectivo_disponible: null, elegibilidad_verificable: false, duplicado: false },
    }));
    expect(s.decision).toBe('NO_EVALUABLE');
  });
  it('aporte de un instrumento fuera del universo (BLOQUEO_REGLA): BLOQUEADO', () => {
    const s = decidir(aporteETF({ auditoria: { veredicto: 'BLOQUEO_REGLA', reglas_revisadas: ['ETF-02'] } }));
    expect(s.decision).toBe('BLOQUEADO');
  });
  it('M-12 revisión anual de ETFs: supera, primera falla y falla consecutiva', () => {
    expect(decidir(revisionETF({ comparable: true, supera_spy: true, fallo_anterior: true })).decision).toBe('MANTENER');
    const primera = decidir(revisionETF({ comparable: true, supera_spy: false, fallo_anterior: false }));
    expect(primera.decision).toBe('REDUCIR');
    expect(primera.detalle_portafolio.porcentaje).toBe(50);
    const segunda = decidir(revisionETF({ comparable: true, supera_spy: false, fallo_anterior: true }));
    expect(segunda.decision).toBe('VENDER');
    expect(decidir(revisionETF({ comparable: false, supera_spy: false, fallo_anterior: false })).decision).toBe('NO_EVALUABLE');
  });
  it('retiro quinquenal: REDUCIR 50%, o NO_EVALUABLE si faltan datos', () => {
    const base = { ...aporteETF(), tipo_evaluacion: 'retiro_quinquenal' as const, aporte: undefined };
    const s = decidir({ ...base, retiro: { datos_completos: true, porcentaje: 50 } });
    expect(s.decision).toBe('REDUCIR');
    expect(s.detalle_portafolio.porcentaje).toBe(50);
    expect(decidir({ ...base, retiro: { datos_completos: false, porcentaje: 50 } }).decision).toBe('NO_EVALUABLE');
  });
  it('la ruta determinista rechaza un Director distinto de no_aplica', () => {
    expect(() => decidir(aporteETF({ director: { estado: 'ok' } }))).toThrow(ErrorMotor);
  });
});

describe('M-13: el Director no es punto único de falla', () => {
  it('el Director falla: se conserva la decisión del Motor y la corrida queda incompleta', () => {
    const s = decidir(nuevaPosicion({ director: { estado: 'error' } }));
    expect(s.decision).toBe('COMPRAR');
    expect(s.estado_final).toBe('incompleta');
    expect(s.motivos_estado.map((m) => m.codigo)).toContain('director_fallo');
    expect(s.director_estado).toBe('error');
  });
  it('Auditor BLOQUEO y Director falla: bloqueada; la falla queda en los motivos', () => {
    const s = decidir(nuevaPosicion({ auditoria: { veredicto: 'BLOQUEO_REGLA', reglas_revisadas: [] }, director: { estado: 'error' } }));
    expect(s.estado_final).toBe('bloqueada');
    expect(s.motivos_estado.map((m) => m.codigo)).toEqual(expect.arrayContaining(['director_fallo', 'auditor_bloqueo']));
  });
  it('la decisión no depende de la recomendación del Director: con Director ok o error, la decisión es la misma', () => {
    expect(decidir(nuevaPosicion({ director: { estado: 'ok' } })).decision)
      .toBe(decidir(nuevaPosicion({ director: { estado: 'pendiente' } })).decision);
  });
});

describe('M-14: vocabulario', () => {
  it('rechaza COMPRAR en posición abierta y VENDER en nueva posición', () => {
    expect(() => validarDecision('posicion_abierta', 'COMPRAR')).toThrow(ErrorMotor);
    expect(() => validarDecision('nueva_posicion', 'VENDER')).toThrow(ErrorMotor);
    expect(() => validarDecision('recompra', 'COMPRAR')).toThrow(ErrorMotor);
    expect(() => validarDecision('recompra', 'VIGILAR')).toThrow(ErrorMotor);
    expect(() => validarDecision('aporte_periodico', 'APORTAR')).toThrow(ErrorMotor);
  });
  it('cada tipo solo usa decisiones del vocabulario único, y todos los tipos tienen lista', () => {
    for (const tipo of TIPOS_EVALUACION) {
      expect(VOCABULARIO_POR_TIPO[tipo].length).toBeGreaterThan(0);
      for (const d of VOCABULARIO_POR_TIPO[tipo]) expect(DECISIONES).toContain(d);
    }
  });
  it('el Auditor no puede bloquear una revisión anual de ETFs: error de contrato, no una decisión inventada', () => {
    const e = revisionETF({ comparable: true, supera_spy: true, fallo_anterior: false });
    e.auditoria = { veredicto: 'BLOQUEO_REGLA', reglas_revisadas: [] };
    expect(() => decidir(e)).toThrow(ErrorMotor);
  });
});

describe('M-15: expiración de decisiones pendientes', () => {
  const entreSemana: CalendarioHabil = {
    esDiaHabil: (f) => {
      const dia = new Date(`${f}T12:00:00Z`).getUTCDay();
      return dia !== 0 && dia !== 6;
    },
  };
  // Miércoles 2026-10-14, 15:00 en Ciudad de México (UTC-6) = 21:00Z
  const emision = new Date('2026-10-14T21:00:00Z');

  it('vence el siguiente día hábil a la misma hora de Ciudad de México', () => {
    const v = calcularVencimiento({ fecha_emision: emision, calendario: entreSemana });
    expect(v.toISOString()).toBe('2026-10-15T21:00:00.000Z');
  });
  it('una emisión en viernes vence el lunes; una en sábado, también el lunes', () => {
    const viernes = new Date('2026-10-16T21:00:00Z');
    expect(calcularVencimiento({ fecha_emision: viernes, calendario: entreSemana }).toISOString()).toBe('2026-10-19T21:00:00.000Z');
    const sabado = new Date('2026-10-17T21:00:00Z');
    expect(calcularVencimiento({ fecha_emision: sabado, calendario: entreSemana }).toISOString()).toBe('2026-10-19T21:00:00.000Z');
  });
  it('un feriado entre medias corre el vencimiento', () => {
    const conFeriado: CalendarioHabil = { esDiaHabil: (f) => f !== '2026-10-15' && entreSemana.esDiaHabil(f) };
    expect(calcularVencimiento({ fecha_emision: emision, calendario: conFeriado }).toISOString()).toBe('2026-10-16T21:00:00.000Z');
  });
  it('expira solo si requiere autorización, está pendiente y se cumplió el plazo', () => {
    const base = { estado_usuario: 'pendiente' as const, requiere_autorizacion: true, fecha_emision: emision, calendario: entreSemana, plazo_dias_habiles: 1 };
    expect(evaluarExpiracion({ ...base, ahora: new Date('2026-10-15T20:59:59Z') })).toMatchObject({ expira: false, motivo: 'vigente' });
    expect(evaluarExpiracion({ ...base, ahora: new Date('2026-10-15T21:00:00Z') })).toMatchObject({ expira: true, motivo: 'vencida' });
    const tarde = new Date('2026-12-01T00:00:00Z');
    expect(evaluarExpiracion({ ...base, requiere_autorizacion: false, estado_usuario: 'no_requerida', ahora: tarde }).expira).toBe(false);
    expect(evaluarExpiracion({ ...base, estado_usuario: 'autorizada', ahora: tarde }).expira).toBe(false);
  });
  it('sin calendario o sin plazo definido no se declara ninguna expiración', () => {
    const base = { estado_usuario: 'pendiente' as const, requiere_autorizacion: true, fecha_emision: emision, ahora: new Date('2027-01-01T00:00:00Z') };
    expect(evaluarExpiracion({ ...base, calendario: null, plazo_dias_habiles: 1 })).toMatchObject({ expira: false, motivo: 'calendario_no_definido' });
    expect(evaluarExpiracion({ ...base, calendario: entreSemana, plazo_dias_habiles: null })).toMatchObject({ expira: false, motivo: 'plazo_no_definido' });
  });
  it('con el horario de verano de Nueva York, la hora de reloj de Ciudad de México se conserva (julio)', () => {
    const julio = new Date('2026-07-15T21:00:00Z');   // 15:00 en Ciudad de México (UTC-6, sin horario de verano)
    expect(calcularVencimiento({ fecha_emision: julio, calendario: entreSemana }).toISOString()).toBe('2026-07-16T21:00:00.000Z');
  });
});

describe('M-16: solo el usuario autoriza', () => {
  const pendiente = { actual: 'pendiente' as const, requiere_autorizacion: true };
  it('el sistema, el Motor, un agente, el Director o el Auditor no pueden autorizar ni rechazar', () => {
    for (const tipo of ['sistema', 'motor', 'orquestador', 'agente', 'director', 'auditor'] as const) {
      for (const solicitado of ['autorizada', 'rechazada'] as const) {
        const r = transicionAutorizacion({ ...pendiente, solicitado, actor: { tipo } });
        expect(r.ok).toBe(false);
      }
    }
  });
  it('el usuario sí puede autorizar o rechazar, y autorizar registra autorizada_at', () => {
    const a = transicionAutorizacion({ ...pendiente, solicitado: 'autorizada', actor: { tipo: 'usuario', user_id: 'u1' } });
    expect(a).toEqual({ ok: true, nuevo: 'autorizada', registrar_autorizada_at: true });
    const r = transicionAutorizacion({ ...pendiente, solicitado: 'rechazada', actor: { tipo: 'usuario', user_id: 'u1' } });
    expect(r).toEqual({ ok: true, nuevo: 'rechazada', registrar_autorizada_at: false });
  });
  it('el sistema puede expirar; el usuario no "expira"', () => {
    expect(transicionAutorizacion({ ...pendiente, solicitado: 'expirada', actor: { tipo: 'sistema' } }).ok).toBe(true);
    expect(transicionAutorizacion({ ...pendiente, solicitado: 'expirada', actor: { tipo: 'usuario', user_id: 'u1' } }).ok).toBe(false);
  });
  it('los estados finales no cambian y una decisión sin autorización requerida no transita', () => {
    for (const actual of ['autorizada', 'rechazada', 'expirada', 'no_requerida'] as const) {
      expect(transicionAutorizacion({ actual, requiere_autorizacion: true, solicitado: 'autorizada', actor: { tipo: 'usuario', user_id: 'u1' } }).ok).toBe(false);
    }
    expect(transicionAutorizacion({ actual: 'no_requerida', requiere_autorizacion: false, solicitado: 'autorizada', actor: { tipo: 'usuario', user_id: 'u1' } }).ok).toBe(false);
  });
  it('el Motor nunca emite una decisión ya autorizada: toda decisión operativa nace pendiente', () => {
    const s = decidir(nuevaPosicion());
    expect(s.estado_usuario).toBe('pendiente');
    expect(['autorizada', 'rechazada', 'expirada']).not.toContain(s.estado_usuario);
  });
});

// ------------------------------------------------------------------ Invariantes de la base, por barrido

describe('barrido: la salida siempre respeta las restricciones de la base', () => {
  it('ninguna combinación produce una salida que la base rechazaría', () => {
    const auditores = ['CUMPLE', 'BLOQUEO_REGLA', 'NO_ELEGIBLE', 'NO_EVALUABLE'] as const;
    const directores = ['ok', 'pendiente', 'error', 'no_aplica'] as const;
    let evaluadas = 0;
    for (const tipo of TIPOS_EVALUACION) {
      for (const veredicto of auditores) {
        for (const director of directores) {
          for (const falla of [false, true]) {
            for (const vencidos of [[], ['precio']]) {
              for (const faltantes of [[], ['dato']]) {
                for (const confirmada of [true, false]) {
                  for (const tesis of ['intacta', 'debilitada', 'rota'] as const) {
                    let e: EntradaMotor;
                    switch (tipo) {
                      case 'nueva_posicion': e = nuevaPosicion(); break;
                      case 'recompra': e = nuevaPosicion({ tipo_evaluacion: 'recompra' }); break;
                      case 'revision_tesis': e = nuevaPosicion({ tipo_evaluacion: 'revision_tesis', salida: {} }); break;
                      case 'posicion_abierta': e = posicion('PMP'); break;
                      case 'aporte_periodico': e = aporteETF(); break;
                      case 'revision_anual_etf': e = revisionETF({ comparable: true, supera_spy: false, fallo_anterior: true }); break;
                      case 'retiro_quinquenal': e = { ...aporteETF(), tipo_evaluacion: 'retiro_quinquenal', aporte: undefined, retiro: { datos_completos: true, porcentaje: 50 } }; break;
                    }
                    e.auditoria = { veredicto, reglas_revisadas: [] };
                    e.director = { estado: e.ruta === 'determinista' ? 'no_aplica' : director };
                    if (falla && e.agentes_requeridos[0]) {
                      e.resultados_agentes = { ...e.resultados_agentes, [e.agentes_requeridos[0]]: { estado: 'error' } };
                    }
                    e.datos_vencidos = vencidos;
                    e.datos_faltantes = faltantes;
                    e.posicion_confirmada = confirmada;
                    e.tesis_estado = tesis;
                    try {
                      const s = decidir(e);
                      expect(VOCABULARIO_POR_TIPO[tipo]).toContain(s.decision);
                      evaluadas++;
                    } catch (err) {
                      // Solo se admiten errores de contrato previstos (veredicto que no aplica al tipo, vocabulario),
                      // nunca una salida inválida.
                      expect(err).toBeInstanceOf(ErrorMotor);
                      expect((err as Error).message).not.toContain('Salida del Motor inválida');
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    expect(evaluadas).toBeGreaterThan(1000);
  });
});
