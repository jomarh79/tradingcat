import { describe, expect, it } from 'vitest';
import { AGENTES_ORDEN, MATRIZ_AGENTES, MATRIZ_AGENTES_VERSION, REGLA_PLP_ABRIR, REGLA_PLP_SUSTITUCION, REGLA_SEMILLA_RECOMPRA, accionDeMatriz, agentesDeCorrida, reglaEstructural } from './index';
import type { Agente, PortafolioCodigo, TipoEvaluacion } from '../motor';

const cas = (p: PortafolioCodigo, t: TipoEvaluacion) => agentesDeCorrida(p, t);

describe('matriz de agentes (tabla 1.4, aprobada el 14-oct)', () => {
  it('la etiqueta de versión es la que se guarda en el registro', () => {
    expect(MATRIZ_AGENTES_VERSION).toBe('matriz_v2_tabla_1_4_14oct2026');
    expect(AGENTES_ORDEN).toEqual(['fundamental', 'valuacion', 'tecnico', 'riesgo_capital']);
  });
  it('cada fila de la tabla: requeridos y opcionales', () => {
    const casos: [PortafolioCodigo, TipoEvaluacion, Agente[], Agente[]][] = [
      ['PMP', 'nueva_posicion', ['fundamental', 'valuacion', 'tecnico', 'riesgo_capital'], []],
      ['PMP', 'recompra', ['fundamental', 'valuacion', 'tecnico', 'riesgo_capital'], []],
      ['PMP', 'posicion_abierta', ['fundamental'], ['valuacion', 'tecnico', 'riesgo_capital']],
      ['PCP', 'nueva_posicion', ['tecnico', 'riesgo_capital'], ['fundamental']],
      ['PCP', 'recompra', ['tecnico', 'riesgo_capital'], []],
      ['PCP', 'posicion_abierta', ['tecnico'], ['fundamental', 'riesgo_capital']],
      ['PLP', 'recompra', ['fundamental', 'valuacion', 'riesgo_capital'], ['tecnico']],
      ['PLP', 'posicion_abierta', ['fundamental'], ['valuacion', 'tecnico', 'riesgo_capital']],
      ['SEMILLA', 'nueva_posicion', ['fundamental', 'riesgo_capital'], ['valuacion']],
      ['SEMILLA', 'posicion_abierta', ['fundamental', 'tecnico'], []],
      ['ETF', 'aporte_periodico', ['riesgo_capital'], []],
      ['ETF', 'revision_anual_etf', [], []],
      ['ETF', 'retiro_quinquenal', [], []],
    ];
    for (const [p, t, req, opc] of casos) {
      const r = cas(p, t);
      expect(r, `${p} ${t}`).not.toBeNull();
      expect(r!.requeridos, `${p} ${t} requeridos`).toEqual(req);
      expect(r!.opcionales, `${p} ${t} opcionales`).toEqual(opc);
    }
  });
  it('revision_tesis usa la fila de «mantener o vender» de PMP, PCP y PLP', () => {
    for (const p of ['PMP', 'PCP', 'PLP'] as const) {
      expect(accionDeMatriz(p, 'revision_tesis')).toBe('mantener_o_vender');
      expect(cas(p, 'revision_tesis')).toEqual(cas(p, 'posicion_abierta'));
    }
  });
  it('combinaciones sin fila en la tabla devuelven null (no se inventa una): PLP abrir, Semilla recomprar, ETF recompra, aporte fuera de ETF', () => {
    expect(cas('PLP', 'nueva_posicion')).toBeNull();
    expect(cas('SEMILLA', 'recompra')).toBeNull();
    expect(cas('SEMILLA', 'revision_tesis')).toBeNull();
    expect(cas('ETF', 'recompra')).toBeNull();
    expect(cas('ETF', 'nueva_posicion')).toBeNull();
    expect(cas('ETF', 'posicion_abierta')).toBeNull();
    expect(cas('PMP', 'aporte_periodico')).toBeNull();
    expect(cas('PCP', 'revision_anual_etf')).toBeNull();
    expect(cas('PLP', 'retiro_quinquenal')).toBeNull();
  });
  it('accionDeMatriz no asigna acción a las combinaciones sin fila (no basta con que la fila falte en la tabla)', () => {
    expect(accionDeMatriz('SEMILLA', 'revision_tesis')).toBeNull();
    expect(accionDeMatriz('PLP', 'nueva_posicion')).toBeNull();
    expect(accionDeMatriz('SEMILLA', 'recompra')).toBeNull();
    expect(accionDeMatriz('ETF', 'recompra')).toBeNull();
    expect(accionDeMatriz('ETF', 'revision_tesis')).toBeNull();
    expect(accionDeMatriz('PMP', 'retiro_quinquenal')).toBeNull();
  });
  it('la tabla tiene exactamente las 12 filas aprobadas y todas usan los cuatro agentes', () => {
    expect(Object.keys(MATRIZ_AGENTES).sort()).toEqual([
      'ETF:aporte', 'ETF:solo_codigo', 'PCP:abrir', 'PCP:mantener_o_vender', 'PCP:recomprar', 'PLP:mantener_o_vender', 'PLP:recomprar',
      'PMP:abrir', 'PMP:mantener_o_vender', 'PMP:recomprar', 'SEMILLA:abrir', 'SEMILLA:vender',
    ]);
    for (const f of Object.values(MATRIZ_AGENTES)) expect(Object.keys(f).sort()).toEqual([...AGENTES_ORDEN].sort());
  });
  it('un opcional nunca es requerido y un agente no aparece en ambas listas', () => {
    for (const p of ['PMP', 'PCP', 'PLP', 'SEMILLA', 'ETF'] as const) {
      for (const t of ['nueva_posicion', 'recompra', 'posicion_abierta', 'revision_tesis', 'aporte_periodico', 'revision_anual_etf', 'retiro_quinquenal'] as const) {
        const r = cas(p, t);
        if (r) for (const a of r.requeridos) expect(r.opcionales).not.toContain(a);
      }
    }
  });
});

describe('reglas estructurales (23-oct)', () => {
  it('PLP nueva_posicion: bloqueo por PLP-02 salvo sustitución autorizada (origen PLP-09)', () => {
    expect(REGLA_PLP_ABRIR).toBe('PLP-02');
    expect(REGLA_PLP_SUSTITUCION).toBe('PLP-09');
    expect(reglaEstructural('PLP', 'nueva_posicion')).toMatchObject({ clase: 'bloqueo_salvo_sustitucion', regla: 'PLP-02', regla_sustitucion: 'PLP-09' });
  });
  it('SEMILLA recompra: bloqueo por SEM-04 con dinero nuevo', () => {
    expect(REGLA_SEMILLA_RECOMPRA).toBe('SEM-04');
    const r = reglaEstructural('SEMILLA', 'recompra');
    expect(r).toMatchObject({ clase: 'bloqueo_con_dinero_nuevo', regla: 'SEM-04' });
    expect(r!.regla_sustitucion).toBeUndefined();
  });
  it('ninguna otra combinación tiene regla estructural', () => {
    const ps = ['PMP', 'PCP', 'PLP', 'SEMILLA', 'ETF'] as const;
    const ts = ['nueva_posicion', 'recompra', 'posicion_abierta', 'revision_tesis', 'aporte_periodico', 'revision_anual_etf', 'retiro_quinquenal'] as const;
    const con = ps.flatMap(p => ts.map(t => [p, t] as const)).filter(([p, t]) => reglaEstructural(p, t) !== null);
    expect(con).toEqual([['PLP', 'nueva_posicion'], ['SEMILLA', 'recompra']]);
  });
});
