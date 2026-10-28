import { describe, expect, it } from 'vitest';
import { CATALOGO_FIXTURE } from './catalogo-fixture';
import {
  auditar, gananciaAnualizada, hashSha256, jsonCanonico, puertoAuditor, validarEntrada, validarSalida,
} from './index';
import type { DatoFuente, EntradaAuditor, ReglaEntrada, SalidaAuditor } from './index';

// ---------------------------------------------------------------- constructor de entradas
type Parche = {
  portafolio_codigo?: string | null; tipo_evaluacion?: string; ticker?: string; fecha_evaluacion?: string;
  operacion?: Partial<EntradaAuditor['operacion']>; posicion?: Partial<EntradaAuditor['posicion']>;
  contexto_portafolio?: Partial<EntradaAuditor['contexto_portafolio']>; datos?: Partial<EntradaAuditor['datos']>;
  datos_fuente?: DatoFuente[]; reglas_vigentes?: ReglaEntrada[];
};
const ds = (id: string, campo: string, valor: DatoFuente['valor'], categoria: DatoFuente['categoria'] = 'estimacion'): DatoFuente =>
  ({ id, campo, categoria, valor, unidad: null, fuente: 'analisis-1', fecha_dato: '2026-10-26' });

function entrada(p: Parche = {}): EntradaAuditor {
  return {
    contrato: 'auditoria_entrada.v1', run_id: 'run-1', snapshot_id: 'snap-1', ticker: p.ticker ?? 'GKOS', mercado: 'US',
    portafolio_codigo: p.portafolio_codigo === undefined ? 'PMP' : p.portafolio_codigo,
    tipo_evaluacion: p.tipo_evaluacion ?? 'nueva_posicion', fecha_evaluacion: p.fecha_evaluacion ?? '2026-10-26',
    operacion: { accion: 'abrir', monto: null, precio: null, porcentaje_venta: null, instrumento_destino: null, origen_dinero: null, dividendo_misma_empresa: null, motivo_venta: null, ...p.operacion },
    posicion: { existe: false, fecha_apertura: null, compras: null, ventas_previas: null, costo_promedio_ponderado: null, plan_pcp: null, rol: null, ...p.posicion },
    contexto_portafolio: { posiciones_abiertas: null, movimiento_ya_registrado: null, sustitucion_autorizada: null, ...p.contexto_portafolio },
    datos: {
      analisis_presentes: [], ficha_pmp: null, candidata_semilla: null, recompra_con_analisis_propios: null, stop_tocado: null,
      aumenta_peso_sectorial: null, dividendo_recibido: null, neto_mensual_pcp: null, traspaso_identificable: null, historial_meses_etf: null,
      aporte_etf: null, fundamentos: ['d-f'], ...p.datos,
    },
    datos_fuente: [ds('d-f', 'fundamento', 'x', 'estado_financiero'), ...(p.datos_fuente ?? [])], analisis_ids: ['an-1'], reglas_vigentes: p.reglas_vigentes ?? CATALOGO_FIXTURE,
  };
}
const res = (s: SalidaAuditor, codigo: string) => s.resultados_reglas.find((r) => r.codigo === codigo)!;
const valoracion = (valor: string) => [ds('d-v', 'valor_estimado_base', valor), ds('d-p', 'precio_actual', '1000', 'precio'), ds('d-h', 'horizonte_meses', 36)];
const FICHA = Object.fromEntries(['identidad', 'rol', 'negocio', 'rendimiento', 'volatilidad_riesgo', 'dividendos_fundamentales', 'correlacion', 'plan_ejecucion', 'decision_final', 'indices_referencia', 'competidores'].map((k) => [k, true]));
const ANALISIS_PMP = ['radiografia', 'valuacion', 'ganancia_anualizada', 'grafico_riesgo_ejecucion'];
/** Apertura PMP completa y válida (14.01% con precio 1000). */
const pmpApertura = (p: Parche = {}): EntradaAuditor => entrada({
  datos_fuente: [...valoracion('1613.96'), ds('d-n', 'noticia_x', 'x', 'noticia')],
  operacion: { accion: 'abrir', monto: '50' }, posicion: { rol: 'flujo' },
  datos: { analisis_presentes: ANALISIS_PMP, ficha_pmp: FICHA, fundamentos: ['d-v'] },
  ...p,
});

describe('número exacto de PMP-01 (aritmética entera, half-up a 2 decimales)', () => {
  it('exactamente 14.00% no supera', () => { expect(gananciaAnualizada(BigInt('148154400000'), BigInt('100000000000'), 36, BigInt('1400000000'), 2)).toEqual({ porcentaje_redondeado: '14.00', supera: false }); });
  it('justo bajo y justo sobre el borde de redondeo 14.005', () => {
    expect(gananciaAnualizada(BigInt('148173894855'), BigInt('100000000000'), 36, BigInt('1400000000'), 2)).toEqual({ porcentaje_redondeado: '14.00', supera: false });
    expect(gananciaAnualizada(BigInt('148173894856'), BigInt('100000000000'), 36, BigInt('1400000000'), 2)).toEqual({ porcentaje_redondeado: '14.01', supera: true });
  });
  it('un 14.004% real se redondea a 14.00 (no cumple) y un 14.006% a 14.01 (cumple)', () => {
    expect(gananciaAnualizada(BigInt('148169995747'), BigInt('100000000000'), 36, BigInt('1400000000'), 2).supera).toBe(false);
    expect(gananciaAnualizada(BigInt('148177794031'), BigInt('100000000000'), 36, BigInt('1400000000'), 2)).toEqual({ porcentaje_redondeado: '14.01', supera: true });
  });
  it('rendimiento claramente mayor, y negativo', () => {
    expect(gananciaAnualizada(BigInt('161396471700'), BigInt('100000000000'), 36, BigInt('1400000000'), 2)).toEqual({ porcentaje_redondeado: '17.30', supera: true });
    expect(gananciaAnualizada(BigInt('50000000000'), BigInt('100000000000'), 36, BigInt('1400000000'), 2).supera).toBe(false);
    expect(gananciaAnualizada(BigInt('50000000000'), BigInt('100000000000'), 36, BigInt('1400000000'), 2).porcentaje_redondeado).toBe('-20.63');
  });
  it('coherencia: supera ⇔ porcentaje redondeado > umbral, en una malla de valores', () => {
    for (let v = 148100; v <= 148300; v += 7) {
      const r = gananciaAnualizada(BigInt(v) * BigInt(1000000), BigInt('100000000000'), 36, BigInt('1400000000'), 2);
      expect(r.supera).toBe(Number(r.porcentaje_redondeado) > 14);
    }
  });
  it('horizonte de 12 meses: exponente 1', () => {
    expect(gananciaAnualizada(BigInt('115000000000'), BigInt('100000000000'), 12, BigInt('1400000000'), 2)).toEqual({ porcentaje_redondeado: '15.00', supera: true });
  });
  it('borde exacto con horizonte de 12 meses: 14.005% es 14.01 (supera) y 14.00499999% no', () => {
    expect(gananciaAnualizada(BigInt('11400500000'), BigInt('10000000000'), 12, BigInt('1400000000'), 2)).toEqual({ porcentaje_redondeado: '14.01', supera: true });
    expect(gananciaAnualizada(BigInt('11400499999'), BigInt('10000000000'), 12, BigInt('1400000000'), 2)).toEqual({ porcentaje_redondeado: '14.00', supera: false });
    expect(gananciaAnualizada(BigInt('8999500000'), BigInt('10000000000'), 12, BigInt('1400000000'), 2).porcentaje_redondeado).toBe('-10.00');
    expect(gananciaAnualizada(BigInt('8999400000'), BigInt('10000000000'), 12, BigInt('1400000000'), 2).porcentaje_redondeado).toBe('-10.01');
    expect(gananciaAnualizada(BigInt('10000000000'), BigInt('10000000000'), 12, BigInt('1400000000'), 0)).toEqual({ porcentaje_redondeado: '0', supera: false });
  });
  it('entradas inválidas lanzan', () => {
    expect(() => gananciaAnualizada(BigInt(0), BigInt(1), 36, BigInt(0), 2)).toThrow();
    expect(() => gananciaAnualizada(BigInt(1), BigInt(1), 0, BigInt(0), 2)).toThrow();
    expect(() => gananciaAnualizada(BigInt(1), BigInt(0), 36, BigInt(0), 2)).toThrow();
    expect(() => gananciaAnualizada(BigInt(1), BigInt(1), 1.5, BigInt(0), 2)).toThrow(/horizonte inválido/);
    expect(() => gananciaAnualizada(BigInt(1), BigInt(1), 36, BigInt(0), 4)).toThrow();
  });
});

describe('transversales y estructura general', () => {
  it('T-03: sin portafolio → NO_EVALUABLE (portafolio_no_declarado) con GLB-04', () => {
    const s = auditar(entrada({ portafolio_codigo: null }));
    expect(s.veredicto).toBe('NO_EVALUABLE');
    expect(s.datos_faltantes[0]).toMatchObject({ codigo_regla: 'GLB-04', motivo: 'portafolio_no_declarado', critico: true });
    expect(s.resultados_reglas.map((r) => r.codigo)).toEqual(['GLB-04']);
  });
  it('T-04 y A15: Especulativo / Spin Off → NO_EVALUABLE (portafolio_sin_reglas)', () => {
    for (const p of ['ESPECULATIVO', 'SPIN_OFF', 'Spin Off']) {
      const s = auditar(entrada({ portafolio_codigo: p }));
      expect(s.veredicto).toBe('NO_EVALUABLE');
      expect(s.datos_faltantes[0]!.motivo).toBe('portafolio_sin_reglas');
      expect(s.resultados_reglas).toEqual([]);
    }
  });
  it('portafolio vacío o con espacios cuenta como no declarado', () => {
    expect(auditar(entrada({ portafolio_codigo: '  ' })).datos_faltantes[0]!.motivo).toBe('portafolio_no_declarado');
  });
  it('T-09: GLB-06 y GLB-07 → no_aplica "garantizada por diseño" y no cuentan como no_evaluable', () => {
    const s = auditar(pmpApertura());
    for (const c of ['GLB-06', 'GLB-07']) { expect(res(s, c).resultado).toBe('no_aplica'); expect(res(s, c).detalle).toMatch(/dise/); expect(res(s, c).critico).toBe(false); }
  });
  it('T-10 y A16: regla obligatoria EL sin evaluador → NO_EVALUABLE (evaluador_no_implementado)', () => {
    const rara: ReglaEntrada = { codigo: 'PMP-99', version_id: 'v99', caracter: 'obligatoria', vigente_desde: '2026-10-06', definicion: {}, clase: 'estructura_limite', aplica_a: { portafolios: ['PMP'], tipos_evaluacion: ['nueva_posicion'] }, componente_delegado: null };
    const s = auditar(pmpApertura({ reglas_vigentes: [...CATALOGO_FIXTURE, rara] }));
    expect(res(s, 'PMP-99')).toMatchObject({ resultado: 'no_evaluable', motivo: 'evaluador_no_implementado', critico: true });
    expect(s.veredicto).toBe('NO_EVALUABLE');
  });
  it('una regla de calendario o referencial sin evaluador solo se lista, no decide', () => {
    const rara: ReglaEntrada = { codigo: 'PMP-98', version_id: 'v98', caracter: 'obligatoria', vigente_desde: '2026-10-06', definicion: {}, clase: 'calendario_tarea', aplica_a: { portafolios: ['PMP'], tipos_evaluacion: ['nueva_posicion'] }, componente_delegado: null };
    const s = auditar(pmpApertura({ reglas_vigentes: [...CATALOGO_FIXTURE, rara] }));
    expect(res(s, 'PMP-98')).toMatchObject({ resultado: 'no_evaluable', critico: false });
    expect(s.veredicto).toBe('CUMPLE');
  });
  it('apertura PMP completa: CUMPLE sin infracciones, filtros ni críticos', () => {
    const s = auditar(pmpApertura());
    expect(s.veredicto).toBe('CUMPLE');
    expect(s.infracciones).toEqual([]);
    expect(s.filtros_fallidos).toEqual([]);
    expect(s.datos_faltantes.filter((d) => d.critico)).toEqual([]);
    expect(s.resultados_reglas).toHaveLength(50);
    expect(res(s, 'PMP-01')).toMatchObject({ resultado: 'cumple', valor_observado: '17.30', umbral: { operador: '>', valor: '14' } });
    expect(res(s, 'PMP-01').evidencia).toEqual(['d-v', 'd-p', 'd-h']);
    expect(s.datos_fuente.map((d) => d.id)).toEqual(['d-v', 'd-p', 'd-h']); // d-f y d-n existen pero ninguna regla los cita
  });
  it('T-01: PMP posición del 2026-09-15 en recompra de USD 10: PMP-03 aplica, PMP-01 no_aplica, CUMPLE', () => {
    const s = auditar(entrada({
      tipo_evaluacion: 'recompra', operacion: { accion: 'recomprar', monto: '10' }, posicion: { existe: true, fecha_apertura: '2026-09-15', rol: 'flujo' },
      datos: { analisis_presentes: ANALISIS_PMP, recompra_con_analisis_propios: true, fundamentos: ['d-v'] }, datos_fuente: valoracion('900'),
    }));
    expect(res(s, 'PMP-03').resultado).toBe('cumple');
    expect(res(s, 'PMP-01').resultado).toBe('no_aplica');
    expect(res(s, 'GLB-01').resultado).toBe('anterior_a_regla');
    expect(s.veredicto).toBe('CUMPLE');
  });
  it('T-02 y A14: mantener una posición PCP anterior al 6-oct: reglas de apertura anterior_a_regla, sin bloqueo', () => {
    const s = auditar(entrada({
      portafolio_codigo: 'PCP', tipo_evaluacion: 'posicion_abierta', operacion: { accion: 'mantener' },
      posicion: { existe: true, fecha_apertura: '2026-09-20', plan_pcp: 'escalonado', compras: [{ fecha: '2026-09-20', monto: '25' }], ventas_previas: 0 },
    }));
    for (const c of ['PCP-01', 'PCP-10']) expect(res(s, c).resultado).toBe('anterior_a_regla');
    for (const c of ['PCP-02', 'PCP-04', 'PMP-01', 'PLP-02', 'SEM-05']) expect(res(s, c).resultado).toBe('no_aplica');
    expect(res(s, 'GLB-01').resultado).toBe('anterior_a_regla');
    expect(s.veredicto).toBe('CUMPLE');
    expect(s.infracciones).toEqual([]);
  });
  it('la regla de apertura NO es anterior_a_regla si la posición es posterior a su vigencia o si no es posicion_abierta', () => {
    const base = { portafolio_codigo: 'PCP', operacion: { accion: 'mantener' as const }, posicion: { existe: true, plan_pcp: 'escalonado' as const, compras: [], ventas_previas: 0 } };
    expect(res(auditar(entrada({ ...base, tipo_evaluacion: 'posicion_abierta', posicion: { ...base.posicion, fecha_apertura: '2026-10-06' } })), 'PCP-01').resultado).toBe('no_aplica');
    expect(res(auditar(entrada({ ...base, tipo_evaluacion: 'recompra', posicion: { ...base.posicion, fecha_apertura: '2026-09-20' } })), 'PCP-01').resultado).toBe('no_aplica');
  });
  it('GLB-01: una posición abierta exactamente el día de la vigencia NO es anterior; un día antes sí', () => {
    const g = (f: string) => res(auditar(entrada({ tipo_evaluacion: 'recompra', posicion: { existe: true, fecha_apertura: f } })), 'GLB-01').resultado;
    expect(g('2026-10-06')).toBe('cumple');
    expect(g('2026-10-05')).toBe('anterior_a_regla');
  });
  it('GLB-01 sin fecha de apertura de una posición existente: no_evaluable crítico', () => {
    const s = auditar(entrada({ tipo_evaluacion: 'recompra', posicion: { existe: true } }));
    expect(res(s, 'GLB-01')).toMatchObject({ resultado: 'no_evaluable', motivo: 'fecha_apertura_no_declarada', critico: true });
  });
  it('GLB-02: posición sin rol es advertencia referencial, nunca bloquea', () => {
    const s = auditar(pmpApertura({ posicion: { rol: null } }));
    expect(res(s, 'GLB-02').resultado).toBe('incumple');
    expect(s.advertencias_referenciales.map((a) => a.codigo)).toContain('GLB-02');
  });
  it('T-07: infracción (PCP-03) y dato faltante en otra regla → BLOQUEO_REGLA y se listan los datos faltantes', () => {
    const s = auditar(entrada({
      portafolio_codigo: 'PCP', tipo_evaluacion: 'recompra', operacion: { accion: 'recomprar', monto: '25' },
      posicion: { existe: true, fecha_apertura: '2026-10-07', plan_pcp: null, compras: [{ fecha: '2026-10-07', monto: '25' }, { fecha: '2026-10-08', monto: '25' }, { fecha: '2026-10-09', monto: '50' }] },
    }));
    expect(s.veredicto).toBe('BLOQUEO_REGLA');
    expect(s.infracciones.map((i) => i.codigo)).toContain('PCP-03');
    expect(s.datos_faltantes.map((d) => d.codigo_regla)).toContain('PCP-07');
  });
  it('precedencia: BLOQUEO > NO_ELEGIBLE > NO_EVALUABLE > CUMPLE', () => {
    // NO_ELEGIBLE (14.00%) con una infracción de monto → BLOQUEO
    const noElegible = pmpApertura({ datos_fuente: valoracion('1481.544') });
    expect(auditar(noElegible).veredicto).toBe('NO_ELEGIBLE');
    expect(auditar({ ...noElegible, operacion: { ...noElegible.operacion, monto: '60' } }).veredicto).toBe('BLOQUEO_REGLA');
    // NO_ELEGIBLE con un dato faltante crítico en otra regla → NO_ELEGIBLE
    expect(auditar({ ...noElegible, datos: { ...noElegible.datos, ficha_pmp: null } }).veredicto).toBe('NO_ELEGIBLE');
    // solo dato faltante → NO_EVALUABLE
    expect(auditar(pmpApertura({ datos: { ficha_pmp: null, analisis_presentes: ANALISIS_PMP, fundamentos: ['d-v'] } })).veredicto).toBe('NO_EVALUABLE');
  });
  it('GLB-03 / T-06: único fundamento una noticia → BLOQUEO_REGLA; mezcla con otro dato → cumple', () => {
    const s = auditar(pmpApertura({ datos: { analisis_presentes: ANALISIS_PMP, ficha_pmp: FICHA, fundamentos: ['d-n'] } }));
    expect(res(s, 'GLB-03').resultado).toBe('incumple');
    expect(s.veredicto).toBe('BLOQUEO_REGLA');
    expect(auditar(pmpApertura({ datos: { analisis_presentes: ANALISIS_PMP, ficha_pmp: FICHA, fundamentos: ['d-n', 'd-v'] } })).veredicto).toBe('CUMPLE');
  });
  it('GLB-03: sin fundamentos, o con un id inexistente → no_evaluable', () => {
    expect(res(auditar(pmpApertura({ datos: { analisis_presentes: ANALISIS_PMP, ficha_pmp: FICHA, fundamentos: null } })), 'GLB-03').motivo).toBe('fundamento_no_declarado');
    expect(res(auditar(pmpApertura({ datos: { analisis_presentes: ANALISIS_PMP, ficha_pmp: FICHA, fundamentos: [] } })), 'GLB-03').motivo).toBe('fundamento_no_declarado');
    expect(res(auditar(pmpApertura({ datos: { analisis_presentes: ANALISIS_PMP, ficha_pmp: FICHA, fundamentos: ['zzz'] } })), 'GLB-03').motivo).toBe('fundamento_sin_dato');
  });
  it('T-08: GLB-05 reparto con traspaso no identificable → NO_EVALUABLE; identificable → cumple', () => {
    const base = { portafolio_codigo: 'PCP', tipo_evaluacion: 'aporte_periodico', operacion: { accion: 'mover_dinero' as const } };
    const s = auditar(entrada({ ...base, datos: { traspaso_identificable: false, neto_mensual_pcp: '10' } }));
    expect(res(s, 'GLB-05')).toMatchObject({ resultado: 'no_evaluable', motivo: 'traspaso_no_identificable', critico: true });
    expect(s.veredicto).toBe('NO_EVALUABLE');
    expect(res(auditar(entrada({ ...base, datos: { traspaso_identificable: true } })), 'GLB-05').resultado).toBe('cumple');
    expect(res(auditar(entrada({ ...base, operacion: { accion: 'aporte' } })), 'GLB-05').resultado).toBe('no_aplica');
  });
});

describe('PMP', () => {
  it('P-01/A1: rendimiento exacto 14.00% → NO_ELEGIBLE; P-02: 14.004% real → NO_ELEGIBLE', () => {
    const s = auditar(pmpApertura({ datos_fuente: valoracion('1481.544') }));
    expect(s.veredicto).toBe('NO_ELEGIBLE');
    expect(s.filtros_fallidos.map((f) => f.codigo)).toEqual(['PMP-01']);
    expect(res(s, 'PMP-01').valor_observado).toBe('14.00');
    expect(auditar(pmpApertura({ datos_fuente: valoracion('1481.73894855') })).veredicto).toBe('NO_ELEGIBLE');
  });
  it('P-03/A2: 14.006% real redondea a 14.01 → cumple; justo en el borde 14.005 cumple', () => {
    expect(auditar(pmpApertura({ datos_fuente: valoracion('1481.77794031') })).veredicto).toBe('CUMPLE');
    expect(auditar(pmpApertura({ datos_fuente: valoracion('1481.73894856') })).veredicto).toBe('CUMPLE');
  });
  it('P-04/A4: horizonte distinto de 36 → NO_EVALUABLE (horizonte_distinto); sin horizonte también', () => {
    const d = [ds('d-v', 'valor_estimado_base', '1613.96'), ds('d-p', 'precio_actual', '1000', 'precio'), ds('d-h', 'horizonte_meses', 24)];
    const s = auditar(pmpApertura({ datos_fuente: d }));
    expect(res(s, 'PMP-01')).toMatchObject({ resultado: 'no_evaluable', motivo: 'horizonte_distinto' });
    expect(s.veredicto).toBe('NO_EVALUABLE');
    expect(res(auditar(pmpApertura({ datos_fuente: d.slice(0, 2) })), 'PMP-01').motivo).toBe('horizonte_distinto');
  });
  it('PMP-01: faltan datos o son inválidos → no_evaluable', () => {
    expect(res(auditar(pmpApertura({ datos_fuente: [ds('d-p', 'precio_actual', '1000')] })), 'PMP-01').motivo).toBe('dato_faltante');
    expect(res(auditar(pmpApertura({ datos_fuente: [ds('d-v', 'valor_estimado_base', '1600'), ds('d-h', 'horizonte_meses', 36)] })), 'PMP-01').motivo).toBe('dato_faltante');
    expect(res(auditar(pmpApertura({ datos_fuente: valoracion('-5') })), 'PMP-01').motivo).toBe('dato_invalido');
    expect(res(auditar(pmpApertura({ datos_fuente: valoracion('abc') })), 'PMP-01').motivo).toBe('dato_invalido');
    expect(res(auditar(pmpApertura({ datos_fuente: [ds('d-v', 'valor_estimado_base', '1600'), ds('d-p', 'precio_actual', 0), ds('d-h', 'horizonte_meses', 36)] })), 'PMP-01').motivo).toBe('dato_invalido');
  });
  it('P-05: apertura de USD 60 → BLOQUEO_REGLA (PMP-02); USD 50 cumple; sin monto no_evaluable', () => {
    const s = auditar(pmpApertura({ operacion: { accion: 'abrir', monto: '60' } }));
    expect(s.veredicto).toBe('BLOQUEO_REGLA');
    expect(s.infracciones.map((i) => i.codigo)).toEqual(['PMP-02']);
    expect(s.infracciones[0]!.condicion_para_levantar).toMatch(/50/);
    expect(res(auditar(pmpApertura({ operacion: { accion: 'abrir', monto: '50.00' } })), 'PMP-02').resultado).toBe('cumple');
    expect(res(auditar(pmpApertura({ operacion: { accion: 'abrir', monto: null } })), 'PMP-02').motivo).toBe('monto_no_declarado');
  });
  it('P-06: apertura sin rol → BLOQUEO_REGLA (PMP-04); rol fuera de la lista también', () => {
    expect(auditar(pmpApertura({ posicion: { rol: null } })).infracciones.map((i) => i.codigo)).toEqual(['PMP-04']);
    expect(auditar(pmpApertura({ posicion: { rol: 'especulativo' } })).infracciones.map((i) => i.codigo)).toEqual(['PMP-04']);
    for (const rol of ['flujo', 'crecimiento', 'mixto']) expect(res(auditar(pmpApertura({ posicion: { rol } })), 'PMP-04').resultado).toBe('cumple');
  });
  const recompra = (p: Parche = {}) => entrada({
    tipo_evaluacion: 'recompra', operacion: { accion: 'recomprar', monto: '10' }, posicion: { existe: true, fecha_apertura: '2026-10-10', rol: 'flujo' },
    datos: { analisis_presentes: ['radiografia', 'valuacion', 'grafico_riesgo_ejecucion'], recompra_con_analisis_propios: true, fundamentos: ['d-v'] }, datos_fuente: valoracion('900'), ...p,
  });
  it('P-07: recompra de USD 10 con rendimiento 5% → CUMPLE (sin 14%); PMP-05 no exige ganancia anualizada', () => {
    const s = auditar(recompra());
    expect(s.veredicto).toBe('CUMPLE');
    expect(res(s, 'PMP-05').resultado).toBe('cumple');
  });
  it('P-08: recompra de USD 20 → BLOQUEO_REGLA (PMP-03)', () => {
    expect(auditar(recompra({ operacion: { accion: 'recomprar', monto: '20' } })).infracciones.map((i) => i.codigo)).toEqual(['PMP-03']);
  });
  it('P-09: recompra derivada de un MANTENER sin análisis propios → BLOQUEO_REGLA (PMP-10); null → no_evaluable', () => {
    expect(auditar(recompra({ datos: { analisis_presentes: ['radiografia', 'valuacion', 'grafico_riesgo_ejecucion'], recompra_con_analisis_propios: false, fundamentos: ['d-v'] } })).infracciones.map((i) => i.codigo)).toEqual(['PMP-10']);
    expect(res(auditar(recompra({ datos: { analisis_presentes: ['radiografia', 'valuacion', 'grafico_riesgo_ejecucion'], recompra_con_analisis_propios: null, fundamentos: ['d-v'] } })), 'PMP-10').motivo).toBe('dato_faltante');
  });
  it('PMP-05: en apertura falta ganancia_anualizada → no_evaluable (analisis_faltantes)', () => {
    const s = auditar(pmpApertura({ datos: { analisis_presentes: ['radiografia', 'valuacion', 'grafico_riesgo_ejecucion'], ficha_pmp: FICHA, fundamentos: ['d-v'] } }));
    expect(res(s, 'PMP-05')).toMatchObject({ resultado: 'no_evaluable', motivo: 'analisis_faltantes' });
    expect(res(s, 'PMP-05').detalle).toMatch(/ganancia_anualizada/);
  });
  it('P-10/P-11: ficha incompleta (o sin fuentes de índices) → NO_EVALUABLE', () => {
    const s = auditar(pmpApertura({ datos: { analisis_presentes: ANALISIS_PMP, ficha_pmp: { ...FICHA, plan_ejecucion: false }, fundamentos: ['d-v'] } }));
    expect(res(s, 'PMP-09').detalle).toMatch(/plan_ejecucion/);
    expect(s.veredicto).toBe('NO_EVALUABLE');
    const s2 = auditar(pmpApertura({ datos: { analisis_presentes: ANALISIS_PMP, ficha_pmp: { ...FICHA, indices_referencia: false, correlacion: false, competidores: false }, fundamentos: ['d-v'] } }));
    expect(res(s2, 'PMP-09').detalle).toMatch(/correlacion/);
    expect(s2.veredicto).toBe('NO_EVALUABLE');
  });
  it('P-12/P-13/P-14: dividendo → tarea; stop → advertencia; revisión semestral por fecha', () => {
    const div = auditar(entrada({ tipo_evaluacion: 'aporte_periodico', operacion: { accion: 'aporte' }, datos: { dividendo_recibido: true } }));
    expect(div.tareas_sugeridas.find((t) => t.regla === 'PMP-06')).toMatchObject({ tipo: 'destino_dividendo', destino: 'IVV PESOS', porcentaje: '100' });
    expect(res(auditar(entrada({ tipo_evaluacion: 'aporte_periodico', operacion: { accion: 'aporte' }, datos: { dividendo_recibido: false } })), 'PMP-06').resultado).toBe('no_aplica');
    expect(res(auditar(entrada({ tipo_evaluacion: 'aporte_periodico', operacion: { accion: 'aporte' } })), 'PMP-06')).toMatchObject({ resultado: 'no_evaluable', critico: false });
    const stop = auditar(entrada({ tipo_evaluacion: 'posicion_abierta', operacion: { accion: 'mantener' }, posicion: { existe: true, fecha_apertura: '2026-10-10' }, datos: { stop_tocado: true } }));
    expect(stop.advertencias_referenciales.map((a) => a.codigo)).toEqual(expect.arrayContaining(['PMP-08']));
    expect(stop.veredicto).not.toBe('BLOQUEO_REGLA');
    const sinStop = auditar(entrada({ tipo_evaluacion: 'posicion_abierta', operacion: { accion: 'mantener' }, posicion: { existe: true, fecha_apertura: '2026-10-10' } }));
    expect(res(sinStop, 'PMP-08').resultado).toBe('cumple');
    const antes = auditar(entrada({ tipo_evaluacion: 'revision_tesis', fecha_evaluacion: '2027-04-05', operacion: { accion: 'mantener' }, posicion: { existe: true, fecha_apertura: '2026-10-10' } }));
    const dia = auditar(entrada({ tipo_evaluacion: 'revision_tesis', fecha_evaluacion: '2027-04-06', operacion: { accion: 'mantener' }, posicion: { existe: true, fecha_apertura: '2026-10-10' } }));
    expect(res(antes, 'PMP-11').resultado).toBe('no_aplica');
    expect(dia.tareas_sugeridas.map((t) => t.regla)).toContain('PMP-11');
  });
  it('PMP-07 se delega al Motor', () => {
    const s = auditar(recompra());
    expect(res(s, 'PMP-07').resultado).toBe('delegada');
    expect(s.reglas_delegadas).toContainEqual({ codigo: 'PMP-07', agente: 'motor' });
  });
});

describe('PCP', () => {
  const pcp = (p: Parche = {}) => entrada({ portafolio_codigo: 'PCP', ...p });
  const comp = (n: number, monto = '25', fecha = '2026-10-10') => Array.from({ length: n }, (_, i) => ({ fecha: `2026-10-${10 + i}`, monto: i === 2 ? '50' : monto })).map((c) => ({ ...c, fecha: fecha > c.fecha ? fecha : c.fecha }));
  const reco = (compras: { fecha: string; monto: string }[], monto: string, plan: 'una_compra' | 'escalonado' | null = 'escalonado') =>
    pcp({ tipo_evaluacion: 'recompra', operacion: { accion: 'recomprar', monto }, posicion: { existe: true, fecha_apertura: '2026-10-10', compras, plan_pcp: plan, ventas_previas: 0 } });
  it('C-01/C-02/C-03/A7: historial de 5 años', () => {
    const apertura = (anios: string, completo: boolean | null) => pcp({
      operacion: { accion: 'abrir', monto: '25' }, posicion: { plan_pcp: 'escalonado' },
      datos_fuente: [ds('d-a', 'historial_grafico_anios', anios, 'otro'), ...(completo === null ? [] : [ds('d-c', 'historial_grafico_completo', completo, 'otro')])],
    });
    expect(res(auditar(apertura('5.2', null)), 'PCP-01').resultado).toBe('cumple');
    expect(res(auditar(apertura('5', null)), 'PCP-01').resultado).toBe('cumple');
    const c2 = auditar(apertura('4.5', true));
    expect(res(c2, 'PCP-01').resultado).toBe('incumple');
    expect(c2.veredicto).toBe('NO_ELEGIBLE');
    for (const comp of [false, null]) { const c3 = auditar(apertura('4.5', comp)); expect(res(c3, 'PCP-01').motivo).toBe('fuente_truncada'); expect(c3.veredicto).toBe('NO_EVALUABLE'); }
    expect(res(auditar(pcp({ operacion: { accion: 'abrir', monto: '25' } })), 'PCP-01').motivo).toBe('dato_faltante');
  });
  it('C-04: apertura de USD 30 → BLOQUEO (PCP-02)', () => {
    expect(auditar(pcp({ operacion: { accion: 'abrir', monto: '30' }, posicion: { plan_pcp: 'escalonado' } })).infracciones.map((i) => i.codigo)).toEqual(['PCP-02']);
    expect(res(auditar(pcp({ operacion: { accion: 'abrir', monto: '25' }, posicion: { plan_pcp: 'escalonado' } })), 'PCP-02').resultado).toBe('cumple');
  });
  it('C-05: tercera compra de USD 25 → BLOQUEO (debe ser 50); de 50 cumple', () => {
    const dos = comp(2);
    expect(auditar(reco(dos, '25')).infracciones.map((i) => i.codigo)).toEqual(['PCP-02']);
    expect(res(auditar(reco(dos, '50')), 'PCP-02').resultado).toBe('cumple');
    expect(res(auditar(reco(comp(1), '25')), 'PCP-02').resultado).toBe('cumple');
    expect(res(auditar(reco(comp(1), '50')), 'PCP-02').resultado).toBe('incumple');
  });
  it('C-06/A5: cuarta compra → BLOQUEO (PCP-03 y PCP-02)', () => {
    const s = auditar(reco(comp(3), '25'));
    expect(s.infracciones.map((i) => i.codigo)).toEqual(expect.arrayContaining(['PCP-03', 'PCP-02']));
    expect(s.veredicto).toBe('BLOQUEO_REGLA');
  });
  it('C-07: USD 100 acumulados y se propone USD 25 más → BLOQUEO por monto máximo', () => {
    const s = auditar(reco([{ fecha: '2026-10-10', monto: '60' }, { fecha: '2026-10-11', monto: '40' }], '25'));
    expect(res(s, 'PCP-03')).toMatchObject({ resultado: 'incumple', valor_observado: '125' });
    expect(res(auditar(reco([{ fecha: '2026-10-10', monto: '25' }, { fecha: '2026-10-11', monto: '25' }], '50')), 'PCP-03')).toMatchObject({ resultado: 'cumple', valor_observado: '100' });
  });
  it('C-08: 3 compras anteriores al 6-oct y 1 posterior: cuenta 1 → CUMPLE; numeración reinicia en 1', () => {
    const compras = [{ fecha: '2026-09-01', monto: '25' }, { fecha: '2026-09-10', monto: '25' }, { fecha: '2026-09-20', monto: '50' }, { fecha: '2026-10-08', monto: '25' }];
    const s = auditar(reco(compras, '25'));
    expect(res(s, 'PCP-03')).toMatchObject({ resultado: 'cumple', valor_observado: '50' });
    expect(res(s, 'PCP-03').detalle).toMatch(/3 compra\(s\) anteriores/);
    expect(res(s, 'PCP-02').resultado).toBe('cumple'); // segunda compra contada: USD 25
  });
  it('PCP-03: una compra el mismo día de la vigencia (6-oct) sí cuenta', () => {
    const s = auditar(reco([{ fecha: '2026-10-06', monto: '25' }, { fecha: '2026-10-07', monto: '25' }, { fecha: '2026-10-08', monto: '50' }], '25'));
    expect(res(s, 'PCP-03').resultado).toBe('incumple');
    const s2 = auditar(reco([{ fecha: '2026-10-05', monto: '25' }, { fecha: '2026-10-07', monto: '25' }, { fecha: '2026-10-08', monto: '50' }], '25'));
    expect(res(s2, 'PCP-03').resultado).toBe('cumple'); // la compra del 5-oct no cuenta: quedan 2
  });
  it('PCP-02/03: compras no declaradas o monto no declarado → no_evaluable', () => {
    const sinCompras = pcp({ tipo_evaluacion: 'recompra', operacion: { accion: 'recomprar', monto: '25' }, posicion: { existe: true, fecha_apertura: '2026-10-10', plan_pcp: 'escalonado' } });
    expect(res(auditar(sinCompras), 'PCP-02').motivo).toBe('compras_no_declaradas');
    expect(res(auditar(sinCompras), 'PCP-03').motivo).toBe('compras_no_declaradas');
    expect(res(auditar(reco(comp(1), null as unknown as string)), 'PCP-03').motivo).toBe('monto_no_declarado');
    expect(res(auditar(reco([{ fecha: '2026-10-10', monto: 'x' }], '25')), 'PCP-03').motivo).toBe('dato_invalido');
  });
  it('C-09/A6: plan de una compra y propuesta de recompra → BLOQUEO (PCP-07)', () => {
    const s = auditar(reco(comp(1), '25', 'una_compra'));
    expect(s.infracciones.map((i) => i.codigo)).toEqual(['PCP-07']);
  });
  it('C-10: posición anterior sin plan declarado → NO_EVALUABLE (plan_no_declarado) en recompra, venta y mantener', () => {
    for (const [tipo, accion] of [['recompra', 'recomprar'], ['posicion_abierta', 'vender'], ['posicion_abierta', 'mantener']] as const) {
      const s = auditar(pcp({ tipo_evaluacion: tipo, operacion: { accion, monto: '25', porcentaje_venta: '100', precio: '10', motivo_venta: 'senal_salida' }, posicion: { existe: true, fecha_apertura: '2026-09-20', compras: [{ fecha: '2026-09-20', monto: '25' }], ventas_previas: 0, plan_pcp: null } }));
      expect(res(s, 'PCP-07')).toMatchObject({ resultado: 'no_evaluable', motivo: 'plan_no_declarado', critico: true });
      expect(s.veredicto).toBe('NO_EVALUABLE');
    }
  });
  it('C-11: plan escalonado con stop tocado: vender por el stop es infracción; recomprar no se bloquea', () => {
    const vender = auditar(pcp({ tipo_evaluacion: 'posicion_abierta', operacion: { accion: 'vender', porcentaje_venta: '100', motivo_venta: 'stop' }, posicion: { existe: true, fecha_apertura: '2026-10-10', compras: comp(1), ventas_previas: 0, plan_pcp: 'escalonado' } }));
    expect(res(vender, 'PCP-07').resultado).toBe('incumple');
    const una = auditar(pcp({ tipo_evaluacion: 'posicion_abierta', operacion: { accion: 'vender', porcentaje_venta: '100', motivo_venta: 'stop' }, posicion: { existe: true, fecha_apertura: '2026-10-10', compras: comp(1), ventas_previas: 0, plan_pcp: 'una_compra' } }));
    expect(res(una, 'PCP-07').resultado).toBe('cumple');
    expect(res(auditar(reco(comp(1), '25')), 'PCP-07').resultado).toBe('cumple');
  });
  const venta = (n: number, ventas: number, pct: string, precio = '12', costo: string | null = '10') => auditar(pcp({
    tipo_evaluacion: 'posicion_abierta', operacion: { accion: ventas === 0 && n > 1 ? 'reducir' : 'vender', porcentaje_venta: pct, precio, motivo_venta: 'senal_salida' },
    posicion: { existe: true, fecha_apertura: '2026-10-10', compras: comp(n), ventas_previas: ventas, plan_pcp: 'escalonado', costo_promedio_ponderado: costo },
  }));
  it('C-12/C-13: porcentaje de salida según el número de compras', () => {
    expect(res(venta(2, 0, '100'), 'PCP-05').resultado).toBe('incumple');
    expect(res(venta(1, 0, '50'), 'PCP-05').resultado).toBe('incumple');
    expect(res(venta(1, 0, '100'), 'PCP-05').resultado).toBe('cumple');
    expect(res(venta(2, 0, '50'), 'PCP-05').resultado).toBe('cumple');
    expect(res(venta(2, 1, '50'), 'PCP-05').resultado).toBe('cumple');
    expect(res(venta(3, 1, '50'), 'PCP-05').resultado).toBe('cumple');
    expect(res(venta(2, 2, '50'), 'PCP-05').resultado).toBe('incumple');
  });
  it('PCP-05: sin venta propuesta cumple; faltan datos o no hay plan → no_evaluable', () => {
    const mant = auditar(pcp({ tipo_evaluacion: 'posicion_abierta', operacion: { accion: 'mantener' }, posicion: { existe: true, fecha_apertura: '2026-10-10', compras: comp(1), ventas_previas: 0, plan_pcp: 'escalonado' } }));
    expect(res(mant, 'PCP-05').resultado).toBe('cumple');
    expect(res(venta(4, 0, '50'), 'PCP-05').motivo).toBe('numero_de_compras_sin_plan');
    const p = (extra: Partial<EntradaAuditor['posicion']>, op: Partial<EntradaAuditor['operacion']> = {}) => auditar(pcp({ tipo_evaluacion: 'posicion_abierta', operacion: { accion: 'vender', porcentaje_venta: '100', ...op }, posicion: { existe: true, fecha_apertura: '2026-10-10', plan_pcp: 'escalonado', ...extra } }));
    expect(res(p({ compras: null, ventas_previas: 0 }), 'PCP-05').motivo).toBe('compras_no_declaradas');
    expect(res(p({ compras: comp(1), ventas_previas: null }), 'PCP-05').motivo).toBe('ventas_previas_no_declaradas');
    expect(res(p({ compras: comp(1), ventas_previas: 0 }, { porcentaje_venta: null }), 'PCP-05').motivo).toBe('porcentaje_no_declarado');
  });
  it('C-14/C-15: primer parcial solo si el precio supera el costo promedio ponderado', () => {
    expect(res(venta(2, 0, '50', '10', '10'), 'PCP-06').resultado).toBe('incumple');
    expect(res(venta(2, 0, '50', '9.99', '10'), 'PCP-06').resultado).toBe('incumple');
    const ok = venta(2, 0, '50', '10.01', '10');
    expect(res(ok, 'PCP-06').resultado).toBe('cumple');
    expect(ok.reglas_delegadas).toContainEqual({ codigo: 'PCP-06', agente: 'tecnico' });
    expect(res(venta(2, 1, '50', '1', '10'), 'PCP-06').resultado).toBe('cumple');
    expect(res(venta(1, 0, '100', '1', '10'), 'PCP-06').resultado).toBe('cumple');
    expect(res(venta(2, 0, '50', '12', null), 'PCP-06').motivo).toBe('dato_faltante');
  });
  it('C-16/C-17: reparto mensual en tercios; neto negativo lo absorbe PCP', () => {
    const r = (neto: string | null) => auditar(pcp({ tipo_evaluacion: 'aporte_periodico', operacion: { accion: 'aporte' }, datos: { neto_mensual_pcp: neto } }));
    expect(r('90').tareas_sugeridas.find((t) => t.regla === 'PCP-08')).toMatchObject({ tipo: 'reparto_mensual', PCP: '30.00', QQQ: '30.00', GBTC: '30.00' });
    expect(r('100').tareas_sugeridas.find((t) => t.regla === 'PCP-08')).toMatchObject({ PCP: '33.34', QQQ: '33.33', GBTC: '33.33' });
    expect(r('-20').tareas_sugeridas.filter((t) => t.regla === 'PCP-08')).toEqual([]);
    expect(res(r('-20'), 'PCP-08').detalle).toMatch(/absorbe PCP/);
    expect(res(r('0'), 'PCP-08').detalle).toMatch(/absorbe PCP/);
    expect(res(r(null), 'PCP-08')).toMatchObject({ resultado: 'no_evaluable', critico: false });
  });
  it('C-18: PCP-04 y PCP-10 se delegan al Técnico', () => {
    const rec = auditar(reco(comp(1), '25'));
    expect(rec.reglas_delegadas).toContainEqual({ codigo: 'PCP-04', agente: 'tecnico' });
    const ap = auditar(pcp({ operacion: { accion: 'abrir', monto: '25' }, posicion: { plan_pcp: 'escalonado' } }));
    expect(res(ap, 'PCP-10').resultado).toBe('delegada');
    expect(ap.reglas_delegadas).toContainEqual({ codigo: 'PCP-10', agente: 'tecnico' });
    expect(ap.reglas_delegadas.find((d) => d.codigo === 'PCP-04')).toBeUndefined();
  });
  it('apertura sin plan declarado → no_evaluable (plan_no_declarado)', () => {
    expect(res(auditar(pcp({ operacion: { accion: 'abrir', monto: '25' } })), 'PCP-07').motivo).toBe('plan_no_declarado');
  });
});

describe('PLP', () => {
  const plp = (p: Parche = {}) => entrada({ portafolio_codigo: 'PLP', ...p });
  const PLP01 = ['calidad_negocio', 'fundamentales', 'dividendos', 'valuacion', 'riesgo', 'diversificacion'];
  it('L-01/A8: apertura de ticker nuevo → BLOQUEO (PLP-02)', () => {
    const s = auditar(plp({ tipo_evaluacion: 'nueva_posicion', ticker: 'ZZZ', operacion: { accion: 'abrir', monto: '5' }, contexto_portafolio: { posiciones_abiertas: 10 } }));
    expect(s.veredicto).toBe('BLOQUEO_REGLA');
    expect(s.infracciones.map((i) => i.codigo)).toEqual(['PLP-02']);
    expect(s.infracciones[0]!.condicion_para_levantar).toMatch(/PLP-09/);
    expect(res(s, 'PLP-01').resultado).toBe('no_aplica');
  });
  const sustitucion = (extra: Parche = {}) => plp({
    tipo_evaluacion: 'nueva_posicion', ticker: 'ZZZ', operacion: { accion: 'abrir', monto: '5' },
    contexto_portafolio: { posiciones_abiertas: 9, sustitucion_autorizada: { regla: 'PLP-09', autorizacion_id: 'aut-1' } }, datos: { analisis_presentes: PLP01 }, ...extra,
  });
  it('L-02: sustitución con autorización y análisis completos → CUMPLE', () => {
    const s = auditar(sustitucion());
    expect(res(s, 'PLP-02').resultado).toBe('cumple');
    expect(res(s, 'PLP-01').resultado).toBe('cumple');
    expect(s.veredicto).toBe('CUMPLE');
  });
  it('L-03: sustitución sin autorización registrada (o de otra regla / id vacío) → BLOQUEO', () => {
    for (const sus of [null, { regla: 'PLP-09', autorizacion_id: '  ' }, { regla: 'PLP-03', autorizacion_id: 'a' }]) {
      expect(auditar(sustitucion({ contexto_portafolio: { posiciones_abiertas: 9, sustitucion_autorizada: sus } })).veredicto).toBe('BLOQUEO_REGLA');
    }
  });
  it('L-04: sustitución autorizada sin análisis completos → NO_EVALUABLE', () => {
    const s = auditar(sustitucion({ datos: { analisis_presentes: ['calidad_negocio'] } }));
    expect(res(s, 'PLP-01')).toMatchObject({ resultado: 'no_evaluable', motivo: 'analisis_faltantes' });
    expect(s.veredicto).toBe('NO_EVALUABLE');
  });
  it('PLP-02: la sustitución no puede pasar de 10 posiciones; sin conteo → no_evaluable', () => {
    expect(res(auditar(sustitucion({ contexto_portafolio: { posiciones_abiertas: 10, sustitucion_autorizada: { regla: 'PLP-09', autorizacion_id: 'a' } } })), 'PLP-02').resultado).toBe('incumple');
    expect(res(auditar(sustitucion({ contexto_portafolio: { posiciones_abiertas: null, sustitucion_autorizada: { regla: 'PLP-09', autorizacion_id: 'a' } } })), 'PLP-02').motivo).toBe('posiciones_abiertas_no_declaradas');
  });
  const dca = (monto: string | null, ticker = 'MSFT') => auditar(plp({ tipo_evaluacion: 'recompra', ticker, operacion: { accion: 'recomprar', monto }, posicion: { existe: true, fecha_apertura: '2026-10-10' } }));
  it('L-05/A9/L-06: recompra USD 5 de un ticker del universo cumple; USD 10 bloquea; ticker fuera bloquea', () => {
    expect(dca('5').veredicto).toBe('CUMPLE');
    expect(dca('5').reglas_delegadas).toContainEqual({ codigo: 'PLP-04', agente: 'tecnico' });
    expect(dca('5').reglas_delegadas.filter((d) => d.codigo === 'PLP-04').map((d) => d.agente)).toEqual(['tecnico', 'valuacion', 'fundamental']);
    expect(dca('10').infracciones.map((i) => i.codigo)).toEqual(['PLP-03']);
    expect(dca('5', 'ZZZ').infracciones.map((i) => i.codigo)).toEqual(['PLP-03']);
    expect(res(dca(null), 'PLP-03').motivo).toBe('monto_no_declarado');
  });
  it('PLP-03: sin la regla PLP-02 no hay universo → no_evaluable', () => {
    const s = auditar(plp({ tipo_evaluacion: 'recompra', operacion: { accion: 'recomprar', monto: '5' }, posicion: { existe: true, fecha_apertura: '2026-10-10' }, reglas_vigentes: CATALOGO_FIXTURE.filter((r) => r.codigo !== 'PLP-02') }));
    expect(res(s, 'PLP-03').motivo).toBe('universo_no_disponible');
  });
  it('L-07/L-08/L-09/L-10', () => {
    const div = auditar(plp({ tipo_evaluacion: 'aporte_periodico', ticker: 'MSFT', operacion: { accion: 'aporte', monto: '5' }, datos: { dividendo_recibido: true, aumenta_peso_sectorial: true } }));
    expect(div.tareas_sugeridas.find((t) => t.regla === 'PLP-05')).toMatchObject({ tipo: 'destino_dividendo', destino: 'IVV PESOS' });
    expect(div.advertencias_referenciales.map((a) => a.codigo)).toContain('PLP-07');
    expect(div.veredicto).not.toBe('BLOQUEO_REGLA');
    const stop = auditar(plp({ tipo_evaluacion: 'posicion_abierta', operacion: { accion: 'mantener' }, posicion: { existe: true, fecha_apertura: '2026-10-10' }, datos: { stop_tocado: true } }));
    expect(stop.advertencias_referenciales.map((a) => a.codigo)).toContain('PLP-06');
    const rev = (f: string) => auditar(plp({ tipo_evaluacion: 'revision_tesis', fecha_evaluacion: f, operacion: { accion: 'mantener' }, posicion: { existe: true, fecha_apertura: '2026-10-10' } }));
    expect(res(rev('2027-10-05'), 'PLP-09').resultado).toBe('no_aplica');
    expect(rev('2027-10-06').tareas_sugeridas.map((t) => t.regla)).toContain('PLP-09');
  });
});

describe('ETF', () => {
  const etf = (p: Parche = {}) => entrada({ portafolio_codigo: 'ETF', tipo_evaluacion: 'aporte_periodico', operacion: { accion: 'aporte', monto: '2', instrumento_destino: 'XLK' }, ticker: 'XLK', ...p });
  it('E-01/A12: instrumento fuera del universo → BLOQUEO (ETF-02); dentro cumple (sectorial y fondeado)', () => {
    expect(auditar(etf({ operacion: { accion: 'aporte', monto: '2', instrumento_destino: 'TSLA' }, ticker: 'TSLA' })).infracciones.map((i) => i.codigo)).toEqual(['ETF-02']);
    for (const t of ['XLK', 'XLRE', 'QQQ', 'GBTC', 'IVV PESOS']) expect(res(auditar(etf({ operacion: { accion: 'aporte', monto: '2', instrumento_destino: t }, ticker: t })), 'ETF-02').resultado).toBe('cumple');
    expect(res(auditar(etf({ operacion: { accion: 'aporte', monto: '2', instrumento_destino: null }, ticker: 'SPY' })), 'ETF-02').resultado).toBe('incumple');
  });
  it('ETF-02 también aplica a nueva_posicion', () => {
    expect(res(auditar(etf({ tipo_evaluacion: 'nueva_posicion', operacion: { accion: 'abrir', monto: '2', instrumento_destino: 'TSLA' } })), 'ETF-02').resultado).toBe('incumple');
  });
  it('E-02/E-03 (v3): USD 2 con modo completo y USD 1 con modo reducido cumplen; lo demás advierte', () => {
    const modo = (m: 'completo' | 'reducido' | 'ninguno', monto: string | null, extra: Parche = {}) => auditar(etf({ operacion: { accion: 'aporte', monto, instrumento_destino: 'XLK' }, datos: { aporte_etf: { modo: m, monto_por_etf: monto } }, ...extra }));
    expect(res(modo('completo', '2'), 'ETF-01').resultado).toBe('cumple');
    expect(res(modo('reducido', '1'), 'ETF-01').resultado).toBe('cumple');
    expect(res(modo('ninguno', null), 'ETF-01').resultado).toBe('cumple');
    expect(res(modo('ninguno', '0'), 'ETF-01').resultado).toBe('cumple');
    const m = modo('completo', '1');
    expect(res(m, 'ETF-01').resultado).toBe('incumple');
    expect(m.advertencias_referenciales.map((a) => a.codigo)).toContain('ETF-01');
    expect(m.veredicto).toBe('CUMPLE');
    expect(res(modo('reducido', '2'), 'ETF-01').resultado).toBe('incumple');
    expect(res(modo('ninguno', '1'), 'ETF-01').resultado).toBe('incumple');
  });
  it('ETF-01 en su versión 2 (sin aporte reducido): el modo reducido advierte', () => {
    const v2 = CATALOGO_FIXTURE.map((r) => (r.codigo === 'ETF-01' ? { ...r, definicion: { ...r.definicion, aporte_reducido: false, monto_reducido_usd: null } } : r));
    const s = auditar(etf({ reglas_vigentes: v2, datos: { aporte_etf: { modo: 'reducido', monto_por_etf: '1' } }, operacion: { accion: 'aporte', monto: '1', instrumento_destino: 'XLK' } }));
    expect(res(s, 'ETF-01').resultado).toBe('incumple');
    expect(res(s, 'ETF-01').detalle).toMatch(/no admite aporte reducido/);
  });
  it('E-04/A13: transferencia ya registrada → advertencia de duplicado (el Motor emite NO_COMPRAR); sin cálculo del aporte → no_evaluable no crítico', () => {
    const dup = auditar(etf({ contexto_portafolio: { movimiento_ya_registrado: true }, datos: { aporte_etf: { modo: 'completo', monto_por_etf: '2' } } }));
    expect(res(dup, 'ETF-01').detalle).toMatch(/duplicado/);
    expect(dup.veredicto).toBe('CUMPLE');
    const solo = auditar(etf({ contexto_portafolio: { movimiento_ya_registrado: true } }));
    expect(res(solo, 'ETF-01').resultado).toBe('incumple');
    const nada = auditar(etf());
    expect(res(nada, 'ETF-01')).toMatchObject({ resultado: 'no_evaluable', critico: false });
    expect(nada.veredicto).toBe('CUMPLE');
  });
  it('E-05/E-06: revisión anual con historial; retiro quinquenal por fecha', () => {
    const rev = (m: number | null) => auditar(entrada({ portafolio_codigo: 'ETF', tipo_evaluacion: 'revision_anual_etf', ticker: 'XLK', operacion: { accion: 'mantener' }, posicion: { existe: true, fecha_apertura: '2026-09-30' }, datos: { historial_meses_etf: m } }));
    expect(res(rev(3), 'ETF-03').resultado).toBe('no_aplica');
    expect(res(rev(11), 'ETF-03').resultado).toBe('no_aplica');
    expect(rev(12).tareas_sugeridas.map((t) => t.regla)).toContain('ETF-03');
    expect(res(rev(null), 'ETF-03')).toMatchObject({ resultado: 'no_evaluable', critico: false });
    const ret = (f: string) => auditar(entrada({ portafolio_codigo: 'ETF', tipo_evaluacion: 'retiro_quinquenal', fecha_evaluacion: f, ticker: 'XLK', operacion: { accion: 'reducir' }, posicion: { existe: true, fecha_apertura: '2026-09-30' } }));
    expect(res(ret('2031-09-29'), 'ETF-04').resultado).toBe('no_aplica');
    expect(ret('2031-09-30').tareas_sugeridas.find((t) => t.regla === 'ETF-04')).toMatchObject({ tipo: 'retiro_quinquenal' });
  });
});

describe('SEMILLA', () => {
  const sem = (p: Parche = {}) => entrada({ portafolio_codigo: 'SEMILLA', ...p });
  const cand = { empresa_operativa: true, spac: false, tesis_escrita: true, invalidacion_escrita: true, fecha_ipo: '2026-06-01' };
  const apertura = (n: number | null, monto = '5', c: EntradaAuditor['datos']['candidata_semilla'] = cand) => auditar(sem({ operacion: { accion: 'abrir', monto }, contexto_portafolio: { posiciones_abiertas: n }, datos: { candidata_semilla: c } }));
  it('S-01/S-02/A11: 51 posiciones cumple; 52 bloquea la 53; sin conteo no_evaluable', () => {
    expect(apertura(51).veredicto).toBe('CUMPLE');
    const s = apertura(52);
    expect(s.veredicto).toBe('BLOQUEO_REGLA');
    expect(s.infracciones.map((i) => i.codigo)).toEqual(['SEM-03']);
    expect(res(apertura(null), 'SEM-03').motivo).toBe('posiciones_abiertas_no_declaradas');
  });
  it('S-03: compra de USD 10 → BLOQUEO (SEM-02)', () => { expect(apertura(10, '10').infracciones.map((i) => i.codigo)).toEqual(['SEM-02']); });
  it('S-04/A10/S-05: recompra con dinero nuevo bloquea; dividendo de la misma empresa cumple', () => {
    const r = (origen: 'dinero_nuevo' | 'dividendo' | null, misma: boolean | null) => auditar(sem({ tipo_evaluacion: 'recompra', operacion: { accion: 'recomprar', monto: '5', origen_dinero: origen, dividendo_misma_empresa: misma }, posicion: { existe: true, fecha_apertura: '2026-10-10' } }));
    expect(r('dinero_nuevo', null).infracciones.map((i) => i.codigo)).toEqual(['SEM-04']);
    expect(r('dividendo', true).veredicto).toBe('CUMPLE');
    expect(r('dividendo', false).infracciones.map((i) => i.codigo)).toEqual(['SEM-04']);
    expect(res(r('dividendo', null), 'SEM-04').motivo).toBe('dato_faltante');
    expect(res(r(null, null), 'SEM-04').motivo).toBe('origen_dinero_no_declarado');
  });
  it('S-06/S-07/S-08: filtros de selección', () => {
    const s6 = apertura(10, '5', { ...cand, spac: true });
    expect(s6.veredicto).toBe('NO_ELEGIBLE');
    expect(s6.filtros_fallidos.map((f) => f.codigo)).toEqual(['SEM-05']);
    expect(apertura(10, '5', { ...cand, empresa_operativa: false }).veredicto).toBe('NO_ELEGIBLE');
    expect(apertura(10, '5', { ...cand, tesis_escrita: false }).veredicto).toBe('NO_ELEGIBLE');
    expect(apertura(10, '5', { ...cand, invalidacion_escrita: false }).veredicto).toBe('NO_ELEGIBLE');
    const s8 = apertura(10, '5', { ...cand, fecha_ipo: null });
    expect(res(s8, 'SEM-05').motivo).toBe('dato_faltante');
    expect(s8.veredicto).toBe('NO_EVALUABLE');
    expect(res(apertura(10, '5', { ...cand, spac: null }), 'SEM-05').resultado).toBe('no_evaluable');
    expect(res(apertura(10, '5', { ...cand, tesis_escrita: null }), 'SEM-05').resultado).toBe('no_evaluable');
    expect(res(apertura(10, '5', null), 'SEM-05').motivo).toBe('candidata_no_declarada');
    // un filtro incumplido prevalece sobre la fecha de IPO faltante dentro de la misma regla
    expect(res(apertura(10, '5', { ...cand, spac: true, fecha_ipo: null }), 'SEM-05').resultado).toBe('incumple');
  });
  const vende = (motivo: string | null, extra: Partial<EntradaAuditor['posicion']> = {}, n = 20, fecha = '2026-10-26') => auditar(sem({
    tipo_evaluacion: 'posicion_abierta', fecha_evaluacion: fecha, operacion: { accion: 'vender', motivo_venta: motivo }, posicion: { existe: true, fecha_apertura: '2026-10-10', ...extra }, contexto_portafolio: { posiciones_abiertas: n },
  }));
  it('S-09/S-10/S-11: causas de venta', () => {
    expect(vende('caida_ordinaria').infracciones.map((i) => i.codigo)).toEqual(['SEM-06']);
    expect(res(vende('caida_ordinaria'), 'SEM-06').detalle).toMatch(/caída ordinaria/);
    expect(vende('inventada').infracciones.map((i) => i.codigo)).toEqual(['SEM-06']);
    for (const c of ['quiebra', 'desliste', 'adquisicion_o_fusion', 'revision_final_de_tesis', 'situacion_extraordinaria', 'banana_senal_salida']) expect(res(vende(c), 'SEM-06').resultado).toBe('cumple');
    expect(vende('quiebra').tareas_sugeridas.find((t) => t.regla === 'SEM-09')).toMatchObject({ destino: 'reserva_para_futuras_ipos' });
    expect(res(vende(null), 'SEM-06').motivo).toBe('motivo_no_declarado');
    expect(res(vende('limite_de_vida_15_anios', { fecha_apertura: '2011-10-26' }, 20, '2026-10-26'), 'SEM-06').resultado).toBe('cumple');
    expect(res(vende('limite_de_vida_15_anios', { fecha_apertura: '2011-10-27' }, 20, '2026-10-26'), 'SEM-06').resultado).toBe('incumple');
    expect(res(vende('limite_de_vida_15_anios', { fecha_apertura: null }), 'SEM-06').motivo).toBe('fecha_apertura_no_declarada');
    expect(vende('limite_de_vida_15_anios', { fecha_apertura: '2011-10-26' }).tareas_sugeridas.find((t) => t.regla === 'SEM-09')).toMatchObject({ destino: 'cuenta_personal_del_usuario' });
  });
  it('SEM-09 banana: destino según las 52 posiciones; mantener no genera tarea', () => {
    expect(vende('banana_senal_salida', {}, 20).tareas_sugeridas.find((t) => t.regla === 'SEM-09')).toMatchObject({ destino: 'comprar_siguientes_ipos' });
    expect(vende('banana_senal_salida', {}, 52).tareas_sugeridas.find((t) => t.regla === 'SEM-09')).toMatchObject({ destino: 'portafolio_etf_sectorial' });
    const m = auditar(sem({ tipo_evaluacion: 'posicion_abierta', operacion: { accion: 'mantener' }, posicion: { existe: true, fecha_apertura: '2026-10-10' } }));
    expect(res(m, 'SEM-06').resultado).toBe('cumple');
    expect(res(m, 'SEM-09').resultado).toBe('no_aplica');
  });
  it('S-12/S-13: banana se delega al Técnico; sin candidata no hay incumplimiento', () => {
    expect(vende('banana_senal_salida').reglas_delegadas).toContainEqual({ codigo: 'SEM-07', agente: 'tecnico' });
    expect(res(vende('banana_senal_salida'), 'SEM-07').resultado).toBe('delegada');
    expect(res(apertura(10), 'SEM-01').resultado).toBe('cumple');
  });
  it('SEM-08: tarea de registro por compra', () => {
    expect(apertura(10).tareas_sugeridas.find((t) => t.regla === 'SEM-08')).toMatchObject({ tipo: 'registro_compra_semilla' });
  });
});

describe('validación de la entrada y del resultado', () => {
  it('entradas mal formadas lanzan ErrorAuditor', () => {
    const malas: Array<(e: EntradaAuditor) => void> = [
      (e) => { (e as { contrato: string }).contrato = 'otro'; },
      (e) => { e.run_id = ''; },
      (e) => { e.tipo_evaluacion = 'inventado'; },
      (e) => { e.fecha_evaluacion = '26/10/2026'; },
      (e) => { (e.operacion as { accion: string }).accion = 'volar'; },
      (e) => { e.posicion.fecha_apertura = 'ayer'; },
      (e) => { e.posicion.compras = [{ fecha: 'x', monto: '1' }]; },
      (e) => { e.reglas_vigentes = [...e.reglas_vigentes, e.reglas_vigentes[0]!]; },
      (e) => { e.reglas_vigentes = e.reglas_vigentes.map((r, i) => (i === 0 ? { ...r, version_id: '' } : r)); },
      (e) => { e.reglas_vigentes = e.reglas_vigentes.map((r, i) => (i === 0 ? { ...r, clase: 'x' as never } : r)); },
      (e) => { e.reglas_vigentes = e.reglas_vigentes.map((r) => (r.codigo === 'PMP-01' ? { ...r, caracter: 'referencial' as const } : r)); },
      (e) => { e.reglas_vigentes = e.reglas_vigentes.map((r, i) => (i === 0 ? { ...r, vigente_desde: 'x' } : r)); },
      (e) => { e.reglas_vigentes = e.reglas_vigentes.map((r, i) => (i === 0 ? { ...r, aplica_a: {} as never } : r)); },
      (e) => { e.datos_fuente = [ds('a', 'x', 1), ds('a', 'y', 2)]; },
      (e) => { e.datos_fuente = [{ ...ds('a', 'x', 1), fuente: '' }]; },
      (e) => { e.datos_fuente = [{ ...ds('a', 'x', 1), fecha_dato: '' }]; },
      (e) => { e.datos_fuente = [{ ...ds('a', 'x', 1), categoria: 'otra' as never }]; },
      (e) => { e.reglas_vigentes = 'x' as never; },
    ];
    malas.forEach((m, i) => { const e = pmpApertura(); m(e); expect(() => auditar(e), `caso ${i}`).toThrow(/Entrada inválida/); });
    expect(validarEntrada(pmpApertura())).toEqual([]);
  });
  it('definición inválida de una regla → no_evaluable (definicion_invalida), no se inventa un umbral', () => {
    const rotas = CATALOGO_FIXTURE.map((r) => (r.codigo === 'PMP-02' ? { ...r, definicion: {} } : r.codigo === 'PMP-01' ? { ...r, definicion: { umbral: 14 } } : r));
    const s = auditar(pmpApertura({ reglas_vigentes: rotas }));
    expect(res(s, 'PMP-02').motivo).toBe('definicion_invalida');
    expect(res(s, 'PMP-01').motivo).toBe('definicion_invalida');
    expect(s.veredicto).toBe('NO_EVALUABLE');
  });
  it('un umbral distinto en la versión congelada manda (rige la versión del snapshot)', () => {
    const otra = CATALOGO_FIXTURE.map((r) => (r.codigo === 'PMP-02' ? { ...r, definicion: { ...r.definicion, monto_usd: 75 } } : r));
    expect(res(auditar(pmpApertura({ reglas_vigentes: otra, operacion: { accion: 'abrir', monto: '75' } })), 'PMP-02').resultado).toBe('cumple');
    expect(res(auditar(pmpApertura({ reglas_vigentes: otra })), 'PMP-02').resultado).toBe('incumple');
  });
  it('un evaluador que devuelve incumple en una clase que no incumple es un error de código', () => {
    // Una regla CT con código de un evaluador que incumple no existe; se simula cambiando la clase de GLB-02 (referencial) a calendario_tarea.
    const raro = CATALOGO_FIXTURE.map((r) => (r.codigo === 'GLB-02' ? { ...r, caracter: 'obligatoria' as const, clase: 'calendario_tarea' as const } : r));
    expect(() => auditar(pmpApertura({ posicion: { rol: null }, reglas_vigentes: raro }))).toThrow(/incumple en la clase/);
  });
  it('determinismo: misma entrada → misma salida y mismo hash; cualquier cambio cambia el hash', () => {
    const a = pmpApertura();
    expect(jsonCanonico(auditar(a))).toBe(jsonCanonico(auditar(pmpApertura())));
    expect(auditar(a).hash_entrada).toBe(hashSha256(a));
    expect(auditar(a).hash_entrada).toMatch(/^[0-9a-f]{64}$/);
    expect(auditar(pmpApertura({ ticker: 'XYZ' })).hash_entrada).not.toBe(auditar(a).hash_entrada);
    expect(jsonCanonico({ b: 1, a: [2, { d: undefined, c: 3 }] })).toBe('{"a":[2,{"c":3}],"b":1}');
    expect(jsonCanonico(undefined)).toBe('null');
  });
  it('el resumen cabe en 400 caracteres y menciona el veredicto', () => {
    const s = auditar(pmpApertura({ operacion: { accion: 'abrir', monto: '60' } }));
    expect(s.resumen.startsWith('BLOQUEO_REGLA')).toBe(true);
    expect(s.resumen).toMatch(/PMP-02/);
    expect(s.resumen.length).toBeLessThanOrEqual(400);
    const muchas = CATALOGO_FIXTURE.flatMap((r) => [r, { ...r, codigo: r.codigo + '-X' }]);
    void muchas;
  });
  it('un resumen muy largo se recorta con puntos suspensivos', () => {
    const ids = Array.from({ length: 40 }, (_, i) => ({ codigo: `PMP-${100 + i}`, version_id: `v${i}`, caracter: 'obligatoria' as const, vigente_desde: '2026-10-06', definicion: { monto_usd: 1 }, clase: 'estructura_limite' as const, aplica_a: { portafolios: ['PMP'], tipos_evaluacion: ['nueva_posicion'] }, componente_delegado: null }));
    const s = auditar(pmpApertura({ reglas_vigentes: [...CATALOGO_FIXTURE, ...ids.map((r) => ({ ...r, definicion: {} }))] }));
    expect(s.resumen.length).toBe(400);
    expect(validarSalida(pmpApertura({ reglas_vigentes: [...CATALOGO_FIXTURE, ...ids.map((r) => ({ ...r, definicion: {} }))] }), s)).toEqual([]);
    expect(s.resumen.endsWith('…')).toBe(true);
  });
  it('validador: salida correcta pasa; cada defecto se detecta', () => {
    const e = pmpApertura({ operacion: { accion: 'abrir', monto: '60' } });
    const s = auditar(e);
    expect(validarSalida(e, s)).toEqual([]);
    const m = (f: (x: SalidaAuditor) => void): string[] => { const c = JSON.parse(JSON.stringify(s)) as SalidaAuditor; f(c); return validarSalida(e, c); };
    expect(m((x) => { (x as { contrato: string }).contrato = 'z'; })).toContain('contrato inválido');
    expect(m((x) => { (x as { agente: string }).agente = 'z'; })).toContain('agente inválido');
    expect(m((x) => { (x as { veredicto: string }).veredicto = 'X'; }).join()).toMatch(/veredicto inválido/);
    expect(m((x) => { x.resumen = ''; })).toContain('resumen vacío o demasiado largo');
    expect(m((x) => { x.resumen = 'a'.repeat(401); })).toContain('resumen vacío o demasiado largo');
    expect(m((x) => { (x as { infracciones: unknown }).infracciones = null; }).join()).toMatch(/infracciones debe ser una lista/);
    expect(m((x) => { x.resultados_reglas[0]!.resultado = 'raro' as never; }).join()).toMatch(/resultado inválido/);
    expect(m((x) => { x.resultados_reglas[0]!.clase = 'raro' as never; }).join()).toMatch(/clase inválida/);
    expect(m((x) => { x.resultados_reglas.pop(); }).join()).toMatch(/aparece 0 veces/);
    expect(m((x) => { x.resultados_reglas.push(x.resultados_reglas[0]!); }).join()).toMatch(/aparece 2 veces/);
    expect(m((x) => { x.resultados_reglas[0]!.version_id = 'otra'; }).join()).toMatch(/version_id no coincide/);
    expect(m((x) => { x.infracciones = []; }).join()).toMatch(/BLOQUEO_REGLA sin infracción completa/);
    expect(m((x) => { x.infracciones[0]!.condicion_para_levantar = ''; }).join()).toMatch(/BLOQUEO_REGLA sin infracción completa/);
    expect(m((x) => { x.veredicto = 'NO_ELEGIBLE'; x.filtros_fallidos = []; }).join()).toMatch(/NO_ELEGIBLE sin filtro fallido/);
    expect(m((x) => { x.veredicto = 'CUMPLE'; }).join()).toMatch(/CUMPLE con PMP-02 en incumple/);
    expect(m((x) => { x.resultados_reglas[0]!.evidencia = ['fantasma']; }).join()).toMatch(/evidencia fantasma no está/);
    expect(m((x) => { x.datos_fuente = [{ ...ds('d-x', 'c', 1), fuente: '' }]; }).join()).toMatch(/sin fuente o fecha_dato/);
    expect(m((x) => { x.hash_entrada = 'abc'; }).join()).toMatch(/hash_entrada no corresponde/);
    expect(m((x) => { x.resumen = 'otro texto'; }).join()).toMatch(/resultado distinto/);
  });
  it('validador: CUMPLE con un crítico no_evaluable o una EL incumplida se rechaza', () => {
    const e = pmpApertura({ datos: { ficha_pmp: null, analisis_presentes: ANALISIS_PMP, fundamentos: ['d-v'] } });
    const s = auditar(e);
    expect(s.veredicto).toBe('NO_EVALUABLE');
    const c = JSON.parse(JSON.stringify(s)) as SalidaAuditor;
    c.veredicto = 'CUMPLE';
    expect(validarSalida(e, c).join()).toMatch(/CUMPLE con PMP-09 en no_evaluable/);
  });
  it('validador con portafolio sin reglas no exige completitud', () => {
    const e = entrada({ portafolio_codigo: 'ESPECULATIVO' });
    expect(validarSalida(e, auditar(e))).toEqual([]);
  });
});

describe('adaptador al puerto del Orquestador', () => {
  it('devuelve ok con veredicto, reglas revisadas (sin no_aplica) y la salida', async () => {
    const r = await puertoAuditor(pmpApertura());
    expect(r.estado).toBe('ok');
    expect(r.veredicto).toBe('CUMPLE');
    expect(r.reglas_revisadas).toContain('PMP-01');
    expect(r.reglas_revisadas).not.toContain('GLB-06');
    expect(r.reglas_revisadas).not.toContain('PCP-01');
    expect(r.salida?.hash_entrada).toBeDefined();
  });
  it('anterior_a_regla y delegada cuentan como revisadas', async () => {
    const r = await puertoAuditor(entrada({ portafolio_codigo: 'PCP', tipo_evaluacion: 'posicion_abierta', operacion: { accion: 'mantener' }, posicion: { existe: true, fecha_apertura: '2026-09-20', plan_pcp: 'escalonado', compras: [], ventas_previas: 0 } }));
    expect(r.reglas_revisadas).toEqual(expect.arrayContaining(['GLB-01', 'PCP-01']));
  });
  it('una salida rechazada por el validador no pasa: estado error', async () => {
    const r = await puertoAuditor(pmpApertura(), () => ['defecto simulado']);
    expect(r.estado).toBe('error');
    expect(r.error).toMatch(/rechazada.*defecto simulado/);
    expect(r.veredicto).toBeUndefined();
  });
  it('una regla delegada cuenta como revisada', async () => {
    const r = await puertoAuditor(entrada({ portafolio_codigo: 'PLP', tipo_evaluacion: 'recompra', ticker: 'MSFT', operacion: { accion: 'recomprar', monto: '5' }, posicion: { existe: true, fecha_apertura: '2026-10-10' } }));
    expect(r.reglas_revisadas).toContain('PLP-04');
  });
  it('un bloqueo se refleja en el veredicto', async () => {
    expect((await puertoAuditor(pmpApertura({ operacion: { accion: 'abrir', monto: '60' } }))).veredicto).toBe('BLOQUEO_REGLA');
  });
  it('una entrada inválida devuelve estado error con el motivo, sin lanzar', async () => {
    const r = await puertoAuditor({ contrato: 'x' });
    expect(r.estado).toBe('error');
    expect(r.error).toMatch(/Entrada inválida/);
    expect((await puertoAuditor(null)).estado).toBe('error');
  });
});
