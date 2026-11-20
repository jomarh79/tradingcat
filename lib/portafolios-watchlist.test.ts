import { describe, expect, it } from 'vitest';
import { portafoliosDeRol, portafoliosParaCorrida } from './portafolios-watchlist';

describe('portafolios de la watchlist según el rol', () => {
  it('crecimiento activa PCP, flujo activa PMP, mixto activa PMP y PCP (en ese orden)', () => {
    expect(portafoliosDeRol('crecimiento')).toEqual(['PCP']);
    expect(portafoliosDeRol('flujo')).toEqual(['PMP']);
    expect(portafoliosDeRol('mixto')).toEqual(['PMP', 'PCP']);
  });
  it('sin rol o con un rol desconocido no activa ninguno', () => {
    expect(portafoliosDeRol(null)).toEqual([]);
    expect(portafoliosDeRol(undefined)).toEqual([]);
    expect(portafoliosDeRol('')).toEqual([]);
    expect(portafoliosDeRol('otro')).toEqual([]);
  });
  it('devuelve una copia: modificarla no altera el mapa', () => {
    portafoliosDeRol('mixto').push('PCP');
    expect(portafoliosDeRol('mixto')).toEqual(['PMP', 'PCP']);
  });
  it('la corrida directa solo cuando hay PMP y/o PCP y nada más', () => {
    expect(portafoliosParaCorrida(['PCP', 'PMP'])).toEqual(['PMP', 'PCP']);
    expect(portafoliosParaCorrida(['PCP'])).toEqual(['PCP']);
    expect(portafoliosParaCorrida([])).toBeNull();
    expect(portafoliosParaCorrida(null)).toBeNull();
    expect(portafoliosParaCorrida(['PMP', 'PLP'])).toBeNull();
  });
});
