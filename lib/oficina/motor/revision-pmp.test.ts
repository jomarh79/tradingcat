import { describe, expect, it } from 'vitest';
import { perdidaDeFundamentales, rendimientoAnualizado, revisionSemestralPMP, type DatosFundamentalesPMP } from './revision-pmp';

const sano = (): DatosFundamentalesPMP => ({
  ingresos_ttm: 110, ingresos_ttm_previo: 100, margen_operativo_ttm: 0.2, margen_operativo_previo: 0.19,
  deuda_total: 105, deuda_total_previa: 100, fcf_trimestres: [5, 6, 7, 8], fcf_anuales: [20, 25], deterioro_activos: 0, activos_totales: 1000,
});

describe('rendimientoAnualizado (14%)', () => {
  it('(V/C)^(12/36) − 1', () => {
    const r = rendimientoAnualizado(100, 100 / 1.14 ** 3);
    expect(r.anualizado_pct).toBe(14);
    expect(r.por_debajo).toBe(false);
  });
  it('por debajo de 14%', () => {
    expect(rendimientoAnualizado(100, 80).por_debajo).toBe(true); // 1.25^(1/3)-1 = 7.7%
    expect(rendimientoAnualizado(100, 80).anualizado_pct).toBe(7.72);
  });
  it('sin datos o inválidos → no evaluable', () => {
    expect(rendimientoAnualizado(null, 10).estado).toBe('no_evaluable');
    expect(rendimientoAnualizado(10, 0).estado).toBe('no_evaluable');
    expect(rendimientoAnualizado(-5, 10).estado).toBe('no_evaluable');
  });
});

describe('perdidaDeFundamentales (2 de 4)', () => {
  it('sano: no pierde', () => expect(perdidaDeFundamentales(sano()).estado).toBe('no_pierde'));
  it('un deterioro: no pierde', () => {
    expect(perdidaDeFundamentales({ ...sano(), fcf_trimestres: [-1, -2, -3, -4] }).estado).toBe('no_pierde');
  });
  it('dos deterioros: pierde', () => {
    const r = perdidaDeFundamentales({ ...sano(), fcf_trimestres: [-1, -2, -3, -4], deterioro_activos: 60 });
    expect(r.estado).toBe('pierde');
    expect(r.deterioros).toBe(2);
  });
  it('deuda +25 pp sobre ingresos es deterioro (límite inclusivo)', () => {
    const r = perdidaDeFundamentales({ ...sano(), deuda_total: 135 }); // 35% vs 10% = 25 pp
    expect(r.criterios.find(c => c.codigo === 'deuda_vs_ingresos')?.estado).toBe('deterioro');
  });
  it('deterioro de activos exige MÁS de 5%', () => {
    expect(perdidaDeFundamentales({ ...sano(), deterioro_activos: 50 }).criterios[3]!.estado).toBe('sin_deterioro');
    expect(perdidaDeFundamentales({ ...sano(), deterioro_activos: 50.1 }).criterios[3]!.estado).toBe('deterioro');
  });
  it('FCF: 2 años negativos también cuenta; un hueco de datos no se supone', () => {
    expect(perdidaDeFundamentales({ ...sano(), fcf_trimestres: null, fcf_anuales: [-1, -2] }).criterios[2]!.estado).toBe('deterioro');
    expect(perdidaDeFundamentales({ ...sano(), fcf_trimestres: [-1, null, -3, -4], fcf_anuales: null }).criterios[2]!.estado).toBe('no_evaluable');
  });
  it('un deterioro y un criterio sin datos: NO_EVALUABLE (podría llegar a 2)', () => {
    const r = perdidaDeFundamentales({ ...sano(), fcf_trimestres: [-1, -2, -3, -4], deterioro_activos: null });
    expect(r.estado).toBe('no_evaluable');
  });
  it('ingresos caen más de 10%: deterioro; margen cae 5 pp: deterioro', () => {
    expect(perdidaDeFundamentales({ ...sano(), ingresos_ttm: 85 }).criterios[0]!.estado).toBe('deterioro');
    expect(perdidaDeFundamentales({ ...sano(), margen_operativo_ttm: 0.14 }).criterios[0]!.estado).toBe('deterioro');
  });
});

describe('revisionSemestralPMP', () => {
  it('rendimiento bajo → revisar venta del 100%, nunca automática', () => {
    const r = revisionSemestralPMP({ valor_estimado: 100, cierre: 80, fundamentales: sano() });
    expect(r.resultado).toBe('revisar_venta_100');
    expect(r.venta_automatica).toBe(false);
  });
  it('pierde fundamentales → revisar venta, aunque el 14% no se pueda calcular', () => {
    const f = { ...sano(), fcf_trimestres: [-1, -2, -3, -4], deterioro_activos: 60 };
    expect(revisionSemestralPMP({ valor_estimado: null, cierre: 80, fundamentales: f }).resultado).toBe('revisar_venta_100');
  });
  it('todo bien → mantener', () => {
    expect(revisionSemestralPMP({ valor_estimado: 200, cierre: 100, fundamentales: sano() }).resultado).toBe('mantener');
  });
  it('sin valor estimado y fundamentales sanos → no evaluable (no se asume cumple)', () => {
    const r = revisionSemestralPMP({ valor_estimado: null, cierre: 100, fundamentales: sano() });
    expect(r.resultado).toBe('no_evaluable');
    expect(r.motivos.length).toBeGreaterThan(0);
  });
});
