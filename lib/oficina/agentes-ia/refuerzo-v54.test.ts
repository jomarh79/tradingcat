import { describe, expect, it } from 'vitest';
import { validarSalidaFundamental } from './validar-fundamental';
import { salidaBase, sobreBase } from './fixtures.test-util';
import { PROMPT_FUNDAMENTAL } from './prompts';

const conAvisos = (avisos: string[]): any => { const s = sobreBase(); s.snapshot.datos.avisos = avisos; return s; };

describe('v0.54 confianza estable del Fundamental', () => {
  it('con avisos de dato ausente, datos_faltantes vacío se rechaza (antes salía 0.9 o 0.5 según el modelo)', () => {
    const r = validarSalidaFundamental({ ...salidaBase(), datos_faltantes: [], confianza: 0.9 }, conAvisos(['fy2025: sin concepto para deuda_corriente (se omite; no se asume cero)']));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores.join(' ')).toContain('datos_faltantes');
  });
  it('con avisos y un faltante no crítico declarado, confianza dentro del tope: se acepta', () => {
    const x = { ...salidaBase(), datos_faltantes: [{ campo: 'deuda_corriente', critico: false }], confianza: 0.5 };
    expect(validarSalidaFundamental(x, conAvisos(['fy2025: sin concepto para deuda_corriente (se omite; no se asume cero)'])).ok).toBe(true);
  });
  it('con avisos y un faltante declarado, confianza sobre el tope sigue rechazada', () => {
    const x = { ...salidaBase(), datos_faltantes: [{ campo: 'deuda_corriente', critico: false }], confianza: 0.9 };
    expect(validarSalidaFundamental(x, conAvisos(['fy2025: sin concepto para deuda_corriente (se omite; no se asume cero)'])).ok).toBe(false);
  });
  it('sin avisos de dato ausente no se obliga a declarar faltantes', () => {
    expect(validarSalidaFundamental({ ...salidaBase(), datos_faltantes: [] }, conAvisos(['nota informativa'])).ok).toBe(true);
    expect(validarSalidaFundamental({ ...salidaBase(), datos_faltantes: [] }, sobreBase()).ok).toBe(true);
  });
  it('el prompt documenta la regla', () => {
    expect(PROMPT_FUNDAMENTAL).toContain('NO puede ir vacío');
  });
});
