import { describe, expect, it } from 'vitest';
import { evaluarRecompraPMP, MONTO_RECOMPRA_PLP } from './motor';
import { validarCuerpoAnalisis } from './agentes-ia/analisis-real';
import { SENALES_POR_USO } from './tecnico/detonantes';

describe('v0.88: recompra de PLP = 5 USD, stop O señal, sin tope', () => {
  const e = (x: Record<string, unknown> = {}) => evaluarRecompraPMP({ precio_actual: '100', stop: '90', senal_confirmada: false, senales_cumplidas: [], monto: MONTO_RECOMPRA_PLP, ...x } as never);
  it('monto de 5 USD', () => { expect(e().monto).toBe('5'); });
  it('stop tocado dispara', () => { expect(e({ precio_actual: '89' })).toMatchObject({ disparada: true, por_stop: true }); });
  it('una señal (dca_plp) dispara aunque el precio esté sobre el stop', () => { expect(e({ senal_confirmada: true, senales_cumplidas: ['NIVEL_PASADO'] })).toMatchObject({ disparada: true, por_senal: true, por_stop: false }); });
  it('ni stop ni señal: no dispara', () => { expect(e().disparada).toBe(false); });
  it('las señales de PLP son las de dca_plp: RSI, Mogalef inferior, EMA8>EMA21, nivel pasado y rebote SMA 100/200', () => {
    expect(SENALES_POR_USO.dca_plp).toEqual(['RSI_SOBREVENTA', 'MOGALEF_BANDA_INFERIOR', 'EMA8_SOBRE_EMA21', 'NIVEL_PASADO', 'REBOTE_SMA_100_200']);
  });
  it('la validación admite la recompra de PLP', () => {
    expect(validarCuerpoAnalisis({ ticker: 'KO', portafolio: 'PLP', guardar: true, monto: 5, evaluacion: 'recompra' })).toMatchObject({ ok: true });
  });
});
