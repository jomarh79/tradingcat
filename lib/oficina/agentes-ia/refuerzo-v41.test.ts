import { describe, expect, it } from 'vitest';
import { validarSalidaFundamental } from './validar-fundamental';
import { salidaBase, sobreBase } from './fixtures.test-util';
import { PROMPT_FUNDAMENTAL } from './prompts';

const parcial = (): any => {
  const s = salidaBase();
  return { ...s, confianza: 0.4, datos_faltantes: [{ campo: 'flujo_caja', critico: false }], subpuntajes: { ...s.subpuntajes, flujo_caja: null } };
};

describe('v0.41 evaluación parcial sin flujo de caja', () => {
  it('acepta flujo_caja null si no hay items flujo_* y se declara faltante no crítico', () => {
    const r = validarSalidaFundamental(parcial(), sobreBase());
    expect(r.ok).toBe(true);
  });
  it('rechaza flujo_caja null sin declarar el faltante', () => {
    const x = { ...parcial(), datos_faltantes: [] };
    const r = validarSalidaFundamental(x, sobreBase());
    expect(r.ok).toBe(false);
  });
  it('rechaza flujo_caja null si el faltante es crítico', () => {
    const x = { ...parcial(), datos_faltantes: [{ campo: 'flujo_caja', critico: true }] };
    expect(validarSalidaFundamental(x, sobreBase()).ok).toBe(false);
  });
  it('rechaza flujo_caja null si SÍ hay items de flujo de caja', () => {
    const sobre = sobreBase();
    sobre.snapshot.datos.items.push({ id: 'd9', campo: 'flujo_caja_libre_fy2025', valor: 100, unidad: 'USD', fuente: 'x', fecha_dato: '2026-06-30' });
    expect(validarSalidaFundamental(parcial(), sobre).ok).toBe(false);
  });
  it('otra dimensión en null sigue prohibida sin NO_EVALUABLE', () => {
    const x = parcial();
    x.subpuntajes = { ...x.subpuntajes, balance: null };
    expect(validarSalidaFundamental(x, sobreBase()).ok).toBe(false);
  });
  it('el prompt documenta la excepción del flujo de caja', () => {
    expect(PROMPT_FUNDAMENTAL).toContain('subpuntajes.flujo_caja');
  });
});
