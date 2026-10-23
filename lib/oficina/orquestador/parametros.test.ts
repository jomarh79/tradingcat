import { describe, expect, it } from 'vitest';
import {
  CLAVE_FRESCURA_PRECIO, CLAVE_MARGEN_CIERRE, MARGEN_CIERRE_MINUTOS, UNIDAD_DIAS_HABILES, UNIDAD_MINUTOS, leerValorConUnidad,
  parametroVigente, resolverParametros,
} from './index';
import type { FilaParametro } from './index';

const fila = (clave: string, valor: unknown, version: number, vigente_desde: string): FilaParametro => ({ clave, valor, version, vigente_desde });
const margen = (valor: unknown, version = 1, desde = '2026-10-22') => fila(CLAVE_MARGEN_CIERRE, valor, version, desde);
const fresc = (valor: unknown, version = 1, desde = '2026-10-14') => fila(CLAVE_FRESCURA_PRECIO, valor, version, desde);

describe('claves y unidades', () => {
  it('las claves y unidades son las acordadas', () => {
    expect(CLAVE_MARGEN_CIERRE).toBe('orquestador.margen_cierre_velas');
    expect(CLAVE_FRESCURA_PRECIO).toBe('frescura.precio');
    expect(UNIDAD_MINUTOS).toBe('minutos');
    expect(UNIDAD_DIAS_HABILES).toBe('dias_habiles');
  });
});

describe('parametroVigente: mayor versión con vigente_desde <= la fecha', () => {
  const filas = [margen({ valor: 30, unidad: 'minutos' }, 1, '2026-10-22'), margen({ valor: 45, unidad: 'minutos' }, 2, '2026-12-01'), margen({ valor: 20, unidad: 'minutos' }, 3, '2027-01-01'),
    fresc({ valor: 1, unidad: 'dias_habiles' })];
  it('elige la versión que ya rige en la fecha de evaluación', () => {
    expect(parametroVigente(filas, CLAVE_MARGEN_CIERRE, '2026-10-22')!.version).toBe(1);
    expect(parametroVigente(filas, CLAVE_MARGEN_CIERRE, '2026-11-30')!.version).toBe(1);
    expect(parametroVigente(filas, CLAVE_MARGEN_CIERRE, '2026-12-01')!.version).toBe(2);
    expect(parametroVigente(filas, CLAVE_MARGEN_CIERRE, '2027-06-01')!.version).toBe(3);
  });
  it('antes de la primera vigencia, o con otra clave, no hay fila', () => {
    expect(parametroVigente(filas, CLAVE_MARGEN_CIERRE, '2026-10-21')).toBeNull();
    expect(parametroVigente(filas, 'otra.clave', '2026-12-01')).toBeNull();
    expect(parametroVigente([], CLAVE_MARGEN_CIERRE, '2026-12-01')).toBeNull();
  });
  it('el orden de las filas no importa y las filas con versión o fecha inválidas se ignoran', () => {
    const revueltas = [filas[2]!, filas[0]!, filas[1]!];
    expect(parametroVigente(revueltas, CLAVE_MARGEN_CIERRE, '2026-12-15')!.version).toBe(2);
    const malas = [margen({}, 7.5, '2026-10-22'), margen({}, 9, '0000-13-45'), margen({}, 2, '2026-10-22')];
    expect(parametroVigente(malas, CLAVE_MARGEN_CIERRE, '2026-12-15')!.version).toBe(2);
  });
});

describe('leerValorConUnidad', () => {
  it('acepta { valor, unidad } con la unidad esperada y valor finito >= 0', () => {
    expect(leerValorConUnidad({ valor: 30, unidad: 'minutos' }, 'minutos')).toBe(30);
    expect(leerValorConUnidad({ valor: 0, unidad: 'minutos' }, 'minutos')).toBe(0);
    expect(leerValorConUnidad({ valor: 0.5, unidad: 'minutos' }, 'minutos')).toBe(0.5);
  });
  it('rechaza unidad distinta, valor negativo, no finito, texto, o forma inválida', () => {
    for (const malo of [{ valor: 30, unidad: 'dias_habiles' }, { valor: -1, unidad: 'minutos' }, { valor: NaN, unidad: 'minutos' }, { valor: Infinity, unidad: 'minutos' },
      { valor: '30', unidad: 'minutos' }, { valor: 30 }, { unidad: 'minutos' }, 30, '30', null, undefined, []]) {
      expect(leerValorConUnidad(malo, 'minutos')).toBeNull();
    }
  });
});

describe('resolverParametros', () => {
  it('sin filas: el margen es la constante (origen «constante») y la frescura queda sin definir; no hay versiones ni problemas', () => {
    const p = resolverParametros([], '2026-10-22');
    expect(p).toEqual({ margen_cierre_minutos: MARGEN_CIERRE_MINUTOS, margen_origen: 'constante', frescura_precio_dias_habiles: null, parametros_versiones: [], problemas: [] });
  });
  it('con filas válidas lee margen y frescura y reporta sus versiones para parametros_versiones del Motor', () => {
    const p = resolverParametros([margen({ valor: 45, unidad: 'minutos' }, 2), fresc({ valor: 1, unidad: 'dias_habiles' })], '2026-10-22');
    expect(p.margen_cierre_minutos).toBe(45);
    expect(p.margen_origen).toBe('oficina_parametros');
    expect(p.frescura_precio_dias_habiles).toBe(1);
    expect(p.parametros_versiones).toEqual([{ clave: CLAVE_MARGEN_CIERRE, version: 2 }, { clave: CLAVE_FRESCURA_PRECIO, version: 1 }]);
    expect(p.problemas).toEqual([]);
  });
  it('una fila de margen inválida NO se sustituye por la constante: queda null y declarada en problemas', () => {
    const p = resolverParametros([margen({ valor: 'treinta', unidad: 'minutos' })], '2026-10-22');
    expect(p.margen_cierre_minutos).toBeNull();
    expect(p.margen_origen).toBe('oficina_parametros');
    expect(p.parametros_versiones).toEqual([]);
    expect(p.problemas).toHaveLength(1);
    expect(p.problemas[0]).toContain(CLAVE_MARGEN_CIERRE);
  });
  it('una fila de frescura inválida deja la frescura sin evaluar y queda declarada', () => {
    const p = resolverParametros([fresc({ valor: 1, unidad: 'horas' })], '2026-10-22');
    expect(p.frescura_precio_dias_habiles).toBeNull();
    expect(p.parametros_versiones).toEqual([]);
    expect(p.problemas).toHaveLength(1);
    expect(p.problemas[0]).toContain(CLAVE_FRESCURA_PRECIO);
  });
  it('respeta la vigencia: una versión futura no rige todavía', () => {
    const filas = [margen({ valor: 30, unidad: 'minutos' }, 1, '2026-10-22'), margen({ valor: 60, unidad: 'minutos' }, 2, '2026-11-01')];
    expect(resolverParametros(filas, '2026-10-31').margen_cierre_minutos).toBe(30);
    expect(resolverParametros(filas, '2026-11-01').margen_cierre_minutos).toBe(60);
  });
});
