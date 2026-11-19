import { describe, expect, it } from 'vitest';
import { alternarPortafolio, portafoliosAjenos, portafoliosParaCorrida } from './portafolios-watchlist';

describe('portafolios de la watchlist (casillas PMP y PCP)', () => {
  it('marca y desmarca, siempre en el orden PMP, PCP', () => {
    expect(alternarPortafolio(null, 'PCP', true)).toEqual(['PCP']);
    expect(alternarPortafolio(['PCP'], 'PMP', true)).toEqual(['PMP', 'PCP']);
    expect(alternarPortafolio(['PMP', 'PCP'], 'PMP', false)).toEqual(['PCP']);
    expect(alternarPortafolio(['PCP'], 'PCP', false)).toEqual([]);
  });
  it('marcar dos veces no duplica', () => {
    expect(alternarPortafolio(['PMP'], 'PMP', true)).toEqual(['PMP']);
  });
  it('conserva los códigos que esta pantalla no maneja (PLP, ETF, SEMILLA)', () => {
    expect(alternarPortafolio(['PLP'], 'PCP', true)).toEqual(['PCP', 'PLP']);
    expect(alternarPortafolio(['PMP', 'SEMILLA'], 'PMP', false)).toEqual(['SEMILLA']);
    expect(portafoliosAjenos(['PMP', 'PLP', 'ETF'])).toEqual(['PLP', 'ETF']);
    expect(portafoliosAjenos(null)).toEqual([]);
  });
  it('la corrida directa solo cuando hay PMP y/o PCP y nada más', () => {
    expect(portafoliosParaCorrida(['PCP', 'PMP'])).toEqual(['PMP', 'PCP']);
    expect(portafoliosParaCorrida(['PCP'])).toEqual(['PCP']);
    expect(portafoliosParaCorrida([])).toBeNull();
    expect(portafoliosParaCorrida(null)).toBeNull();
    expect(portafoliosParaCorrida(['PMP', 'PLP'])).toBeNull();
  });
});
