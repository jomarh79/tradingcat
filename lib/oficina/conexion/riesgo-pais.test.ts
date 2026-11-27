import { describe, expect, it } from 'vitest';
import { avisoRiesgoPais, riesgoDePais } from './riesgo-pais';
import { compararPares } from './comparacion-pares';
import type { EmpresaComparada, MetricasEmpresa } from './comparacion-pares';

const base: MetricasEmpresa = { pe: 20, pe_forward: 18, ev_ebitda: 10, margen_operativo: 10, margen_neto: 8, roe: 15, crecimiento_ventas: 10, deuda_capital: 0.5, riesgo_pais: null };

describe('v0.96: riesgo país', () => {
  it('CN alto, US bajo, desconocido = sin dato', () => {
    expect(riesgoDePais('CN').nivel).toBe('alto');
    expect(riesgoDePais('US').nivel).toBe('bajo');
    expect(riesgoDePais(null).nivel).toBeNull();
    expect(riesgoDePais('ZZ').nivel).toBeNull();
  });
  it('aviso solo para medio/alto', () => {
    expect(avisoRiesgoPais('PDD', riesgoDePais('CN'))).toContain('PDD');
    expect(avisoRiesgoPais('MELI', riesgoDePais('US'))).toBeNull();
  });
  it('penaliza en el ranking: con todo igual, el de país alto queda peor', () => {
    const e: EmpresaComparada[] = [
      { ticker: 'AAA', metricas: { ...base, riesgo_pais: 0 }, pais: 'US' },
      { ticker: 'PDD', metricas: { ...base, riesgo_pais: 2 }, pais: 'CN' },
      { ticker: 'BBB', metricas: { ...base, riesgo_pais: 0 }, pais: 'US' },
    ];
    const c = compararPares('PDD', e);
    const p = Object.fromEntries(c.puntajes.map(x => [x.ticker, x.puntaje as number]));
    expect(p['PDD']).toBeGreaterThan(p['AAA']!);
    expect(c.paises['PDD']!.nivel).toBe('alto');
  });
});
