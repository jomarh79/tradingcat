import { describe, expect, it } from 'vitest';
import { agregarRevision, estadoRevision, leerHistorial, sumarMeses, HISTORIAL_MAXIMO } from './revision-pmp-historial';
import type { EntradaRevision } from './revision-pmp-historial';

const e = (fecha: string, resultado: EntradaRevision['resultado'] = 'mantener'): EntradaRevision => ({ fecha, resultado, anios: 1, anualizada_pct: 21.7, precio_objetivo: 780, cierre: 641, deterioros: 0, sin_datos: 1, motivos: [] });

describe('historial PMP-11', () => {
  it('suma meses con fin de mes y cambio de año', () => {
    expect(sumarMeses('2026-10-31', 6)).toBe('2027-04-30');
    expect(sumarMeses('2026-11-15', 6)).toBe('2027-05-15');
    expect(sumarMeses('2026-08-31', 6)).toBe('2027-02-28');
  });
  it('agrega sin tocar el resto de la ficha, ordena y no duplica el mismo día', () => {
    const f = agregarRevision({ rol: 'x', valuacion_base: { a: 1 } }, e('2026-11-15'));
    expect(f['rol']).toBe('x');
    const g = agregarRevision(f, e('2026-11-15', 'no_evaluable'));
    expect(leerHistorial(g)).toHaveLength(1);
    expect(leerHistorial(g)[0]!.resultado).toBe('no_evaluable');
    const h = agregarRevision(g, e('2026-05-01'));
    expect(leerHistorial(h).map(x => x.fecha)).toEqual(['2026-05-01', '2026-11-15']);
  });
  it('ficha nula o basura: historial vacío y se crea', () => {
    expect(leerHistorial(null)).toEqual([]);
    expect(leerHistorial({ revisiones_pmp11: [1, { fecha: 'x', resultado: 'a' }] })).toEqual([]);
    expect(leerHistorial(agregarRevision(null, e('2026-11-15')))).toHaveLength(1);
  });
  it('conserva solo las últimas', () => {
    let f: unknown = {};
    for (let i = 0; i < HISTORIAL_MAXIMO + 5; i++) f = agregarRevision(f, e(`2020-01-${String((i % 28) + 1).padStart(2, '0')}`.replace(/^2020/, String(2000 + i))));
    expect(leerHistorial(f)).toHaveLength(HISTORIAL_MAXIMO);
  });
  it('estado: nunca / al día / vencida', () => {
    expect(estadoRevision({}, '2026-11-15').estado).toBe('nunca');
    const f = agregarRevision({}, e('2026-11-15'));
    expect(estadoRevision(f, '2027-05-14')).toMatchObject({ estado: 'al_dia', proxima: '2027-05-15' });
    expect(estadoRevision(f, '2027-05-15').estado).toBe('vencida');
  });
});
