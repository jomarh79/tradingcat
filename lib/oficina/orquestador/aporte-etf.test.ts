import { describe, expect, it } from 'vitest';
import { MONTO_POR_ETF_SECTORIAL_USD, MONTO_REDUCIDO_POR_ETF_USD, calcularAporteSemanal } from './index';

const ok = { efectivo_disponible: '10', etfs_sectoriales: 4, duplicado: false };

describe('aporte semanal de ETFs (matriz v2, sección 7; 25-oct): USD 2 por ETF, o USD 1 por ETF, o ninguno', () => {
  it('los aportes por ETF sectorial son USD 2 y, reducido, USD 1', () => { expect(MONTO_POR_ETF_SECTORIAL_USD).toBe(2); expect(MONTO_REDUCIDO_POR_ETF_USD).toBe(1); });
  it('alcanza para USD 2 por ETF: modo completo', () => {
    const r = calcularAporteSemanal(ok);
    expect(r.problemas).toEqual([]);
    expect(r.modo).toBe('completo');
    expect(r.contexto).toEqual({ monto: '2', monto_requerido: '8', monto_reducido: null, efectivo_disponible: '10', duplicado: false, elegibilidad_verificable: true });
  });
  it('límites: exactamente USD 8 es completo; 7.99 es reducido (USD 1 por ETF); exactamente 4 es reducido; 3.99 es ninguno', () => {
    const c = (e: string) => calcularAporteSemanal({ ...ok, efectivo_disponible: e });
    expect(c('8').modo).toBe('completo');
    expect(c('7.99').modo).toBe('reducido');
    expect(c('7.99').contexto).toMatchObject({ monto: '1', monto_requerido: '4', efectivo_disponible: '7.99' });
    expect(c('4').modo).toBe('reducido');
    expect(c('3.99').modo).toBe('ninguno');
    expect(c('3.99').contexto).toMatchObject({ monto: '1', monto_requerido: '4' });
    expect(c('0').modo).toBe('ninguno');
  });
  it('el requerido escala con el número de ETFs', () => {
    expect(calcularAporteSemanal({ ...ok, efectivo_disponible: '100', etfs_sectoriales: 1 }).contexto!.monto_requerido).toBe('2');
    expect(calcularAporteSemanal({ ...ok, efectivo_disponible: '100', etfs_sectoriales: 7 }).contexto!.monto_requerido).toBe('14');
  });
  it('duplicado true se pasa tal cual', () => {
    expect(calcularAporteSemanal({ ...ok, duplicado: true }).contexto).toMatchObject({ duplicado: true, elegibilidad_verificable: true });
  });
  it('duplicado sin verificar: no verificable (no se supone false)', () => {
    const r = calcularAporteSemanal({ ...ok, duplicado: null });
    expect(r.contexto).toMatchObject({ elegibilidad_verificable: false });
    expect(r.modo).toBeNull();
    expect(r.problemas[0]).toContain('duplicado');
  });
  it('sin efectivo o con efectivo inválido: no verificable y efectivo null', () => {
    for (const e of [null, 'abc', '-1', '1,5', '']) {
      const r = calcularAporteSemanal({ ...ok, efectivo_disponible: e });
      expect(r.contexto).toMatchObject({ efectivo_disponible: null, elegibilidad_verificable: false });
      expect(r.modo).toBeNull();
      expect(r.problemas.length).toBe(1);
    }
  });
  it('el efectivo válido se recorta de espacios y admite hasta 8 decimales', () => {
    expect(calcularAporteSemanal({ ...ok, efectivo_disponible: ' 7.5 ' }).contexto!.efectivo_disponible).toBe('7.5');
    expect(calcularAporteSemanal({ ...ok, efectivo_disponible: '1.123456789' }).contexto!.efectivo_disponible).toBeNull();
  });
  it('número de ETFs inválido: no hay contexto', () => {
    for (const n of [0, -1, 1.5, NaN]) {
      const r = calcularAporteSemanal({ ...ok, etfs_sectoriales: n });
      expect(r.contexto).toBeNull();
      expect(r.modo).toBeNull();
      expect(r.problemas[0]).toContain('etfs_sectoriales');
    }
  });
  it('sin datos: no hay contexto', () => {
    expect(calcularAporteSemanal(null).contexto).toBeNull();
    expect(calcularAporteSemanal(undefined).problemas.length).toBe(1);
  });
});
