import { describe, expect, it } from 'vitest';
import { datosValuacionModelo, salidaValuacionComoAnalista, veredictoValuacion, HORIZONTE_PMP_MESES } from './valuacion-corrida';
import type { ValuacionCorrida } from './valuacion-corrida';
import { ID_DATO_HORIZONTE, ID_DATO_VALOR_ESTIMADO } from './hechos-bd';

const perDe = (rel: 'por_debajo' | 'por_encima' | null) => ({
  per_actual: rel === null ? null : rel === 'por_debajo' ? 18 : 26, origen_per_actual: rel === null ? null : 'fundamentals' as const, per_promedio: rel === null ? null : 22, puntos: rel === null ? 1 : 5,
  anios_pedidos: 5, relacion: rel, motivo: rel === null ? 'faltan años' : null,
});
const modelo = (g: number | null, objetivo: number | null = 120, rel: 'por_debajo' | 'por_encima' | null = 'por_debajo') => ({
  per: perDe(rel),
  anios: 3, pe_objetivo: 20, origen_pe: 'histórico' as const, crecimiento_eps: 0.08, eps: 6, origen_eps: 'proyectado (crecimiento histórico)' as const,
  precio_objetivo: objetivo, ganancia_total_pct: g === null ? null : 50, ganancia_anualizada_pct: g, motivo: objetivo === null ? 'EPS no positivo' : null,
});
const val = (g: number | null, objetivo: number | null = 120, rel: 'por_debajo' | 'por_encima' | null = 'por_debajo'): ValuacionCorrida => ({ modelo: modelo(g, objetivo, rel), cierre: 80, fecha: '2026-11-16', horizonte_meses: HORIZONTE_PMP_MESES, fuente: 'Modelo de valuación: prueba', avisos: [] });

describe('valuación por código de PMP (v0.56)', () => {
  it('v0.72 veredicto: P/E actual por debajo del promedio de 5 años = BARATA, por encima = CARA, sin comparación = NO_EVALUABLE (el 14% ya no cambia el veredicto)', () => {
    expect(veredictoValuacion(val(20, 120, 'por_debajo'))).toBe('BARATA');
    expect(veredictoValuacion(val(5, 120, 'por_debajo'))).toBe('BARATA');
    expect(veredictoValuacion(val(30, 120, 'por_encima'))).toBe('CARA');
    expect(veredictoValuacion(val(null, null, null))).toBe('NO_EVALUABLE');
  });
  it('datos de PMP-01: valor estimado y horizonte de 36 meses con los mismos ids que la ficha', () => {
    const d = datosValuacionModelo(val(20));
    expect(d.map(x => x.id)).toEqual([ID_DATO_VALOR_ESTIMADO, ID_DATO_HORIZONTE]);
    expect(d[0]).toMatchObject({ campo: 'valor_estimado_base', valor: '120', unidad: 'USD' });
    expect(d[1]).toMatchObject({ campo: 'horizonte_meses', valor: 36 });
  });
  it('sin modelo calculable no se inventa ningún dato', () => {
    expect(datosValuacionModelo(val(null, null))).toEqual([]);
    expect(datosValuacionModelo(null)).toEqual([]);
    expect(datosValuacionModelo(undefined)).toEqual([]);
  });
  it('salida como analista: agente valuacion, origen codigo, con hallazgo y evidencia', () => {
    const s = salidaValuacionComoAnalista(val(20));
    expect(s).toMatchObject({ agente: 'valuacion', origen: 'codigo', veredicto: 'BARATA', horizonte_meses: 36 });
    const h = (s['hallazgos'] as { evidencia: string[] }[])[0]!;
    expect(h.evidencia).toEqual(['va-d1', 'va-d4', 'va-d5', 'va-d2', 'va-d3']);
    expect((s['detalle'] as string)).toContain('barata, se puede comprar');
    const cara = salidaValuacionComoAnalista(val(20, 120, 'por_encima'));
    expect(cara['veredicto']).toBe('CARA');
    expect(cara['negativos']).toHaveLength(1);
    expect((cara['detalle'] as string)).toContain('cara, no se compra');
    const n = salidaValuacionComoAnalista(val(null, null, null));
    expect(n['veredicto']).toBe('NO_EVALUABLE');
    expect((n['datos_fuente'] as unknown[]).length).toBe(1); // solo el cierre
  });
});
