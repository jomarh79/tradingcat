import { describe, expect, it } from 'vitest';
import { valuacionDe } from './corridas-lectura';

const modelo = { anios: 3, pe_objetivo: 24.5, origen_pe: 'histórico', crecimiento_eps: 0.1, eps: 5.2, origen_eps: 'estimado real (analistas)', precio_objetivo: 127.4, ganancia_total_pct: 15.3, ganancia_anualizada_pct: 4.86, motivo: null };

describe('v0.63 valuacionDe (lectura de la valuación guardada en la corrida)', () => {
  it('lee P/E, EPS, precio objetivo y ganancia anualizada', () => {
    const v = valuacionDe({ valuacion_modelo: { modelo, cierre: 110.5, fecha: '2026-11-17', horizonte_meses: 36, fuente: 'x', avisos: ['aviso uno'] } });
    expect(v).toEqual({ anios: 3, pe_objetivo: 24.5, origen_pe: 'histórico', eps: 5.2, origen_eps: 'estimado real (analistas)', precio_objetivo: 127.4, cierre: 110.5, ganancia_total_pct: 15.3, ganancia_anualizada_pct: 4.86, fecha: '2026-11-17', motivo: null, avisos: ['aviso uno'] });
  });
  it('sin valuación en la corrida devuelve null', () => {
    expect(valuacionDe({})).toBeNull();
    expect(valuacionDe({ valuacion_modelo: 'x' })).toBeNull();
  });
  it('modelo no calculable: deja el motivo y todo lo demás en null', () => {
    const v = valuacionDe({ valuacion_modelo: { modelo: { anios: 3, precio_objetivo: null, motivo: 'sin EPS' }, cierre: null, fecha: '2026-11-17', avisos: [] } });
    expect(v?.precio_objetivo).toBeNull();
    expect(v?.motivo).toBe('sin EPS');
    expect(v?.eps).toBeNull();
  });
});
