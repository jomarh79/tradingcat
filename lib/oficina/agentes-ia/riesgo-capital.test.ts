import { describe, expect, it } from 'vitest';
import { calcularRiesgoCapital, salidaComoAnalista } from './riesgo-capital';
import { validarContextoDirector } from './validar-director';

describe('v0.27 Riesgo y Capital por código', () => {
  it('efectivo mayor o igual al monto: VIABLE (igual cuenta)', () => {
    expect(calcularRiesgoCapital({ efectivo: 100, monto: '50' })).toMatchObject({ veredicto: 'VIABLE', efectivo_disponible: '100', monto_requerido: '50', faltante: null });
    expect(calcularRiesgoCapital({ efectivo: '50', monto: '50' }).veredicto).toBe('VIABLE');
  });
  it('efectivo menor: NO_VIABLE con el faltante exacto (sin binarios)', () => {
    expect(calcularRiesgoCapital({ efectivo: '49.9', monto: '50' })).toMatchObject({ veredicto: 'NO_VIABLE', faltante: '0.1' });
    expect(calcularRiesgoCapital({ efectivo: '0.30', monto: '0.31' })).toMatchObject({ veredicto: 'NO_VIABLE', faltante: '0.01' });
    // un binario con decimales de más no se redondea en silencio: DATOS_INSUFICIENTES
    expect(calcularRiesgoCapital({ efectivo: 0.1 + 0.2, monto: '0.31' }).veredicto).toBe('DATOS_INSUFICIENTES');
  });
  it('sin monto, sin efectivo o con valores inválidos: DATOS_INSUFICIENTES, sin suponer nada', () => {
    for (const e of [{ efectivo: 100, monto: null }, { efectivo: null, monto: '50' }, { efectivo: 'abc', monto: '50' }, { efectivo: 100, monto: '0' }, { efectivo: 100, monto: '-5' }, { efectivo: undefined, monto: undefined }]) {
      expect(calcularRiesgoCapital(e).veredicto).toBe('DATOS_INSUFICIENTES');
    }
    expect(calcularRiesgoCapital({ efectivo: 100, monto: null }).detalle).toMatch(/monto/);
    expect(calcularRiesgoCapital({ efectivo: null, monto: '50' }).detalle).toMatch(/efectivo/);
  });
  it('la salida tiene la forma que exige el Director y el hallazgo negativo solo aparece si es NO_VIABLE', () => {
    const base = { run_id: '11111111-1111-4111-8111-111111111111', snapshot_id: '22222222-2222-4222-8222-222222222222', ticker: 'GKOS', mercado: 'US', portafolio_codigo: 'PMP', tipo_evaluacion: 'nueva_posicion', analistas_requeridos_sin_resultado: [], auditoria: null, reglas_versiones_ids: [], contexto: null };
    for (const [ef, tipo] of [['100', 'positivo'], ['10', 'negativo'], [null, 'neutral']] as const) {
      const s = salidaComoAnalista(calcularRiesgoCapital({ efectivo: ef, monto: ef === null ? null : '50' }), '2026-11-10');
      expect((s['hallazgos'] as { tipo: string }[])[0]!.tipo).toBe(tipo);
      expect(validarContextoDirector({ ...base, salidas_analistas: { riesgo_capital: s } }).ok).toBe(true);
    }
  });
});
