import { describe, expect, it } from 'vitest';
import type { Candle } from '../tecnico';
import { senalesDeSalidaAntesDe } from './senales-previas';

const t = (f: string): number => Date.parse(`${f}T00:00:00Z`) / 1000;
const mas = (f: string, d: number): string => new Date((t(f) + d * 86400) * 1000).toISOString().slice(0, 10);
const dow = (f: string): number => new Date(t(f) * 1000).getUTCDay();
const vela = (f: string, c: number): Candle => ({ time: t(f), open: c - 0.1, high: c + 0.2, low: c - 0.2, close: c, volume: 1000 });
function diarias(fin: string, n: number, p: (i: number) => number): Candle[] {
  const fs: string[] = [];
  for (let f = fin; fs.length < n; f = mas(f, -1)) if (dow(f) !== 0 && dow(f) !== 6) fs.unshift(f);
  return fs.map((f, i) => vela(f, p(i)));
}
const semanales = (lunes: string, n: number, p: (i: number) => number): Candle[] => Array.from({ length: n }, (_, i) => vela(mas(lunes, -7 * (n - 1 - i)), p(i)));

describe('senalesDeSalidaAntesDe', () => {
  const sube = (i: number) => 100 + i * 0.5;
  const v = { diarias: diarias('2026-10-21', 300, sube), semanales: semanales('2026-10-19', 120, sube) };

  it('en una racha alcista el RSI estaba sobrecomprado antes de la venta', () => {
    expect(senalesDeSalidaAntesDe(v, '2026-10-20', 'GKOS', 'TwelveData')).toContain('RSI_SOBRECOMPRA');
  });
  it('solo usa velas anteriores a la venta (no mira el futuro)', () => {
    // Serie plana hasta el día de la venta y un salto fuerte DESPUÉS: antes de la venta no hay sobrecompra.
    const plano = (i: number) => (i < 290 ? 100 + Math.sin(i / 3) : 100 + (i - 289) * 20);
    const w = { diarias: diarias('2026-10-21', 300, plano), semanales: semanales('2026-10-19', 120, () => 100) };
    const fecha = new Date(w.diarias[290]!.time * 1000).toISOString().slice(0, 10);
    expect(senalesDeSalidaAntesDe(w, fecha, 'GKOS', 'TwelveData')).not.toContain('RSI_SOBRECOMPRA');
    expect(senalesDeSalidaAntesDe(w, '2026-10-21', 'GKOS', 'TwelveData')).toContain('RSI_SOBRECOMPRA');
  });
  it('fecha inválida o sin historial suficiente: null (no se inventa)', () => {
    expect(senalesDeSalidaAntesDe(v, '20-10-2026', 'GKOS', 'TwelveData')).toBeNull();
    expect(senalesDeSalidaAntesDe(v, '2020-01-01', 'GKOS', 'TwelveData')).toBeNull();
    const corto = { diarias: diarias('2026-10-21', 10, sube), semanales: [] };
    expect(senalesDeSalidaAntesDe(corto, '2026-10-21', 'GKOS', 'TwelveData')).toBeNull();
  });
});
