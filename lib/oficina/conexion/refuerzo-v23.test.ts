import { describe, expect, it } from 'vitest';
import { resolverHechosPosicion } from './index';
import type { FilasPosicion } from './index';
import { ID_DATO_PRECIO_CIERRE, ID_DATO_SENAL_ENTRADA_PMP, datosPmp01 } from './flujo-auditoria';
import { ID_DATO_HORIZONTE, ID_DATO_VALOR_ESTIMADO } from './hechos-bd';

const PF = '11111111-1111-4111-8111-111111111111';
const EX = '33333333-3333-4333-8333-333333333333';
const Q = { portfolio_id: PF, ticker: 'GKOS', posicion_existe: false };
const filas = (ficha: unknown): FilasPosicion => ({ posiciones: [], ejecuciones: [], capital: [{ portfolio_id: PF, posiciones_abiertas: 1 }], expedientes: [{ id: EX, ticker: 'GKOS', portfolio_id: PF, rol_posicion: null, ficha }] });
const val = (x: Record<string, unknown> = {}) => ({ valuacion_base: { estado: 'declarado', valor_estimado_base: 300, fuente: 'DCF base', fecha: '2026-11-09', horizonte_meses: 36, ...x } });
const fuentes = (ficha: unknown) => { const r = resolverHechosPosicion(filas(ficha), Q); return r.ok ? (r.hechos.datos_fuente ?? []) : 'PROBLEMA'; };

describe('v0.23 valuacion_base de la ficha -> datos_fuente de PMP-01', () => {
  it('declarada y válida: publica valor estimado y horizonte con su fuente y fecha', () => {
    const d = fuentes(val());
    expect(d).toEqual([
      { id: ID_DATO_VALOR_ESTIMADO, campo: 'valor_estimado_base', categoria: 'estimacion', valor: '300', unidad: 'USD', fuente: 'DCF base', fecha_dato: '2026-11-09' },
      { id: ID_DATO_HORIZONTE, campo: 'horizonte_meses', categoria: 'parametro_usuario', valor: 36, unidad: 'meses', fuente: 'DCF base', fecha_dato: '2026-11-09' },
    ]);
  });
  it.each([
    ['sin ficha', {}],
    ['no declarada', val({ estado: 'propuesto' })],
    ['valor no positivo', val({ valor_estimado_base: 0 })],
    ['valor texto inválido', val({ valor_estimado_base: 'abc' })],
    ['fecha inválida', val({ fecha: '9-nov' })],
    ['fuente vacía', val({ fuente: '  ' })],
    ['horizonte no entero', val({ horizonte_meses: 36.5 })],
  ])('%s: no publica nada (PMP-01 queda NO_EVALUABLE)', (_n, ficha) => {
    expect(fuentes(ficha)).toEqual([]);
  });
});

// ---- velas: lunes 2026-10-26 cerrada; martes 27 en formación a las 10:00 (CDMX)
function velas(fin: string, n: number) {
  const out: { time: number; open: number; high: number; low: number; close: number; volume: number }[] = [];
  const d = new Date(`${fin}T00:00:00Z`);
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.unshift({ time: d.getTime() / 1000, open: 100, high: 110, low: 90, close: 100 + (out.length % 7) / 4, volume: 1000 });
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}
const sol = (solicitado_en: string) => ({ ticker: 'GKOS', mercado: 'US', portafolio: 'PMP', tipo_evaluacion: 'nueva_posicion', ruta: 'analitica', disparador: 'manual', origen: { watchlist_id: null, alerta_id: null }, solicitado_en }) as never;
const datos = (diarias: ReturnType<typeof velas>) => ({ velas: { diarias, semanales: [], fuente: 'TwelveData' } }) as never;

describe('v0.23 precio = cierre de la última vela cerrada', () => {
  it('con la vela del día en formación usa la del día anterior', () => {
    const d = velas('2026-10-27', 300);
    const p = datosPmp01(sol('2026-10-27T10:00:00-06:00'), datos(d)).find((x) => x.campo === 'precio_actual');
    const ayer = d[d.length - 2]!;
    expect(p).toBeDefined();
    expect(p).toMatchObject({ id: ID_DATO_PRECIO_CIERRE, campo: 'precio_actual', categoria: 'precio', fecha_dato: '2026-10-26' });
    expect(Number(p!.valor)).toBeCloseTo(ayer.close, 4);
  });
  it('sin velas congeladas no inventa precio', () => {
    expect(datosPmp01(sol('2026-10-27T10:00:00-06:00'), { velas: null } as never)).toEqual([]);
    expect(datosPmp01(sol('2026-10-27T10:00:00-06:00'), {} as never)).toEqual([]);
  });
  it('velas inválidas (serie vacía): sin precio', () => {
    expect(datosPmp01(sol('2026-10-27T10:00:00-06:00'), datos([]))).toEqual([]);
  });
});

describe('v0.24 señal de entrada de PMP como dato', () => {
  it('publica senal_entrada_pmp (booleano) con las señales mínimas en su fuente', () => {
    const s = datosPmp01(sol('2026-10-27T10:00:00-06:00'), datos(velas('2026-10-27', 300))).find((x) => x.id === ID_DATO_SENAL_ENTRADA_PMP);
    expect(s).toBeDefined();
    expect(typeof s!.valor).toBe('boolean');
    expect(s!.fuente).toContain('señales mínimas');
  });
});
