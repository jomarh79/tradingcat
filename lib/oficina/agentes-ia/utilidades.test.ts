import { describe, expect, it } from 'vitest';
import { canonCifra, cifrasDe, cifrasEnTexto, contieneOrden, enRango, esFechaIso, esObjeto, recolectarTextos, resumirErrores, textoNoVacio, tieneCifra } from './utilidades';

describe('utilidades de validación', () => {
  it('esObjeto excluye arreglos, null y primitivos', () => {
    expect(esObjeto({})).toBe(true);
    for (const x of [[], null, undefined, 'x', 1, true]) expect(esObjeto(x)).toBe(false);
  });
  it('textoNoVacio exige texto con contenido', () => {
    expect(textoNoVacio('a')).toBe(true);
    for (const x of ['', '   ', null, 1, undefined]) expect(textoNoVacio(x)).toBe(false);
  });
  it('enRango incluye los extremos y rechaza no finitos y no números', () => {
    expect(enRango(0, 0, 1)).toBe(true);
    expect(enRango(1, 0, 1)).toBe(true);
    for (const x of [-0.01, 1.01, NaN, Infinity, '0.5', null]) expect(enRango(x, 0, 1)).toBe(false);
  });
  it('esFechaIso: solo fechas AAAA-MM-DD que existen', () => {
    expect(esFechaIso('2026-10-30')).toBe(true);
    expect(esFechaIso('2028-02-29')).toBe(true);
    for (const x of ['2026-02-30', '2026-13-45', '2026-1-1', '2026-10-30T00:00:00Z', '30-10-2026', 'abcdefghij', '', ' 2026-10-30', 20261030, null]) expect(esFechaIso(x)).toBe(false);
  });
  it('recolectarTextos recorre listas y objetos y respeta las claves omitidas', () => {
    expect(recolectarTextos({ a: 'x', b: ['y', { c: 'z', d: 'omitido' }], e: 5 }, ['d'])).toEqual(['x', 'y', 'z']);
    expect(recolectarTextos(['a', ['b']])).toEqual(['a', 'b']);
  });
  it('resumirErrores corta al máximo y cuenta los restantes', () => {
    expect(resumirErrores(['a', 'b'], 2)).toBe('a; b');
    expect(resumirErrores(['a', 'b', 'c'], 2)).toBe('a; b; (+1 más)');
    expect(resumirErrores([], 2)).toBe('');
  });
});

describe('cifras', () => {
  it('extrae cifras con separadores y quita la puntuación final', () => {
    expect(cifrasDe('Subió 35. Luego 1,234.5 y 0.82, también 12%.')).toEqual(['35', '1,234.5', '0.82', '12']);
  });
  it('ignora códigos de regla, formularios, ids de hallazgo y tokens pegados a letras', () => {
    expect(cifrasDe('Aplican PMP-01 y SEM-07, el 10-K, el 10-Q, fundamental:h12, d3, h4, Q3 y FY2025.')).toEqual([]);
    expect(cifrasDe('Ver fundamental:h12')).toEqual([]);
    expect(tieneCifra('Sin números aquí')).toBe(false);
    expect(tieneCifra('Hay 2 casos')).toBe(true);
  });
  it('conteo: entero de un dígito sin porcentaje; no lo son los decimales, los porcentajes ni los de dos dígitos', () => {
    expect(cifrasEnTexto('Solo 2 analistas, 5 de 9.')).toEqual([{ token: '2', conteo: true }, { token: '5', conteo: true }, { token: '9', conteo: true }]);
    expect(cifrasEnTexto('Hay 2.')).toEqual([{ token: '2', conteo: true }]);
    expect(cifrasEnTexto('Hay 2,')).toEqual([{ token: '2', conteo: true }]);
    expect(cifrasEnTexto('5%')).toEqual([{ token: '5', conteo: false }]);
    expect(cifrasEnTexto('5.5')).toEqual([{ token: '5.5', conteo: false }]);
    expect(cifrasEnTexto('5,5')).toEqual([{ token: '5,5', conteo: false }]);
    expect(cifrasEnTexto('0.5')).toEqual([{ token: '0.5', conteo: false }]);
    expect(cifrasEnTexto('10')).toEqual([{ token: '10', conteo: false }]);
    expect(cifrasEnTexto('15 y 5')).toEqual([{ token: '15', conteo: false }, { token: '5', conteo: true }]);
    expect(cifrasEnTexto('15% y 5%')).toEqual([{ token: '15', conteo: false }, { token: '5', conteo: false }]);
  });
  it('canonCifra compara solo dígitos y ceros a la izquierda no cuentan', () => {
    expect(canonCifra('1,234.5')).toBe('12345');
    expect(canonCifra('007')).toBe('7');
    expect(canonCifra('0')).toBe('0');
    expect(canonCifra('0.82')).toBe('82');
  });
});

describe('detector de órdenes: todas las formas', () => {
  it('imperativos en español con verbo distinto de «compra»', () => {
    for (const t of ['Recompra ya', 'Liquida todo', 'Venda ahora', 'Vende más', 'Compre tus acciones', 'Recompre esta posición', 'Compra la acción de GKOS', 'Vende las acciones', 'Vende el ETF']) expect(contieneOrden(t)).toBe(true);
  });
  it('tickers imperativos', () => {
    for (const t of ['Vende GKOS', 'Recompra AAPL', 'Liquida QQQ', 'Compre BRK.B']) expect(contieneOrden(t)).toBe(true);
    expect(contieneOrden('Compra de GKOS')).toBe(false);
  });
  it('inglés', () => {
    for (const t of ['I recommend buying GKOS', 'We recommend selling now', 'I suggest to sell', 'You should sell', 'Sell now', 'Sell the position', 'Buy your shares', 'Buy this', 'Sell AAPL', 'Buy more']) expect(contieneOrden(t)).toBe(true);
  });
  it('fórmulas con verbos de acción', () => {
    for (const t of ['Debes vender', 'Deberías acumular', 'Recomiendo cerrar la posición', 'Sugiero salir', 'Te recomiendo entrar', 'Hay que reducir', 'Conviene liquidar', 'Vale la pena comprar', 'Es hora de vender', 'Es momento de recomprar']) expect(contieneOrden(t)).toBe(true);
  });
});
