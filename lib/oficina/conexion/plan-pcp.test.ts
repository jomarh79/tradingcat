import { describe, expect, it } from 'vitest';
import { deducirPlanPcp } from './plan-pcp';

describe('deducirPlanPcp', () => {
  it('una compra = una_compra; con recompras = escalonado', () => {
    expect(deducirPlanPcp(1, 'posicion_abierta')).toBe('una_compra');
    expect(deducirPlanPcp(2, 'posicion_abierta')).toBe('escalonado');
    expect(deducirPlanPcp(3, 'posicion_abierta')).toBe('escalonado');
  });
  it('una evaluación de recompra implica escalonado aunque solo haya una compra', () => {
    expect(deducirPlanPcp(1, 'recompra')).toBe('escalonado');
  });
  it('sin compras o con un conteo inválido no se supone nada', () => {
    expect(deducirPlanPcp(0, 'posicion_abierta')).toBeNull();
    expect(deducirPlanPcp(-1, 'posicion_abierta')).toBeNull();
    expect(deducirPlanPcp(1.5, 'posicion_abierta')).toBeNull();
  });
});
