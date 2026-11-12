import { describe, expect, it } from 'vitest';
import { compraDeApertura } from './apertura-trade';

describe('compraDeApertura', () => {
  it('META real: 615.755 × 0.08099 = 49.87 USD (redondeado al centavo)', () => {
    const r = compraDeApertura({ entry_price: 615.755, initial_quantity: 0.08099 }, []);
    expect(r).not.toBeNull();
    expect(r!.total).toBe(BigInt(4987000000));   // 49.87 en escala 1e8
  });
  it('acepta números en texto (numeric de Postgres)', () => {
    expect(compraDeApertura({ entry_price: '10.5', initial_quantity: '2' }, [])!.total).toBe(BigInt(2100000000));
  });
  it('redondea half-up al centavo', () => {
    // 3.335 × 1 = 3.335 -> 3.34
    expect(compraDeApertura({ entry_price: '3.335', initial_quantity: '1' }, [])!.total).toBe(BigInt(334000000));
    // 3.334 × 1 -> 3.33
    expect(compraDeApertura({ entry_price: '3.334', initial_quantity: '1' }, [])!.total).toBe(BigInt(333000000));
  });
  it('datos ausentes, cero, negativos o no numéricos: null (no se estima)', () => {
    for (const t of [null, [], 'x', {}, { entry_price: 10 }, { initial_quantity: 1 }, { entry_price: 0, initial_quantity: 1 }, { entry_price: 10, initial_quantity: -1 }, { entry_price: 'abc', initial_quantity: 1 }]) {
      expect(compraDeApertura(t, [])).toBeNull();
    }
  });
  it('si una compra ya tiene la cantidad inicial, es la misma apertura y no se suma otra', () => {
    expect(compraDeApertura({ entry_price: 10, initial_quantity: 2 }, [{ quantity: 2 }])).toBeNull();
    expect(compraDeApertura({ entry_price: 10, initial_quantity: 2 }, [{ quantity: '2.0' }])).toBeNull();
    expect(compraDeApertura({ entry_price: 10, initial_quantity: 2 }, [{ quantity: 1 }])).not.toBeNull();
  });
});
