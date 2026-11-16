import { describe, expect, it } from 'vitest';
import { validarSalidaFundamental } from './validar-fundamental';
import { salidaBase, sobreBase } from './fixtures.test-util';
import { PROMPT_FUNDAMENTAL } from './prompts';

const conFlujo = () => {
  const sobre = sobreBase();
  sobre.snapshot.datos.items.push({ id: 'd9', campo: 'flujo_caja_libre_fy2025', valor: 46109000000, unidad: 'USD', fuente: 'x', fecha_dato: '2026-06-30' });
  const x: any = salidaBase();
  x.datos_fuente = sobre.snapshot.datos.items.slice();
  return { sobre, x };
};

describe('v0.55 el veredicto cita flujo de caja y balance cuando existen', () => {
  it('rechaza puntuar flujo_caja sin citar ningún item de flujo', () => {
    const { sobre, x } = conFlujo();
    const r = validarSalidaFundamental(x, sobre);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores.join(' ')).toContain('subpuntajes.flujo_caja');
  });
  it('acepta si un hallazgo cita el item de flujo', () => {
    const { sobre, x } = conFlujo();
    x.hallazgos.push({ id: 'h3', tipo: 'positivo', texto: 'Flujo de caja libre positivo de 46109000000 USD.', evidencia: ['d9'] });
    expect(validarSalidaFundamental(x, sobre).ok).toBe(true);
  });
  it('exige citar balance cuando hay items de balance', () => {
    const sobre = sobreBase();
    sobre.snapshot.datos.items.push({ id: 'd8', campo: 'razon_corriente_fy2025', valor: 2.6, unidad: 'ratio', fuente: 'x', fecha_dato: '2026-06-30' });
    const x: any = salidaBase();
    x.datos_fuente = sobre.snapshot.datos.items.slice();
    const r = validarSalidaFundamental(x, sobre);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores.join(' ')).toContain('subpuntajes.balance');
    x.hallazgos.push({ id: 'h3', tipo: 'positivo', texto: 'Razón corriente de 2.6.', evidencia: ['d8'] });
    expect(validarSalidaFundamental(x, sobre).ok).toBe(true);
  });
  it('sin items de esa dimensión no exige nada, y NO_EVALUABLE queda exento', () => {
    expect(validarSalidaFundamental(salidaBase(), sobreBase()).ok).toBe(true);
  });
  it('el prompt documenta la regla', () => {
    expect(PROMPT_FUNDAMENTAL).toContain('al menos un hallazgo debe citar uno de ellos');
  });
});
