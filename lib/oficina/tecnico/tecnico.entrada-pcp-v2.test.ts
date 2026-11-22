import { describe, expect, it } from 'vitest';
import type { Candle } from '../../indicators';
import { SENALES_POR_USO, calcularTecnico, detonantePara, fuerzaEntrada } from './index';
import type { EntradaTecnico, SnapshotTecnico } from './index';

const DIA = 86400;
const T0 = Date.UTC(2020, 0, 6) / 1000;
const v = (i: number, open: number, high: number, low: number, close: number): Candle => ({ time: T0 + i * DIA, open, high, low, close, volume: 1000 });
const entrada = (d: Candle[]): EntradaTecnico => ({
  ticker: 'TEST', fecha_evaluacion: '2026-11-20', fuente: 'prueba', velas_diarias: d, velas_semanales: [],
  ultima_vela_diaria_cerrada: true, ultima_vela_semanal_cerrada: true,
});
const sen = (s: SnapshotTecnico, id: string) => s.senales.find(x => x.id === id)!;
/** n velas planas alrededor de 100 (SMA 100 y SMA 200 ≈ 100). */
const planas = (n: number): Candle[] => Array.from({ length: n }, (_, i) => v(i, 100, 100.5, 99.5, 100));
/** Bajada de 1 por vela (cuerpo 1, mechas mínimas), para dar contexto de tendencia bajista a los patrones. */
const bajada = (desde: number, n: number, inicio = 140): Candle[] => Array.from({ length: n }, (_, k) => {
  const x = inicio - k;
  return v(desde + k, x, x + 0.1, x - 1.1, x - 1);
});

describe('v0.70: rebote en la SMA 100 / SMA 200 (apertura PCP)', () => {
  it('el mínimo toca la media y el cierre queda por encima: cumplida', () => {
    const d = [...planas(250), v(250, 100, 101, 99.5, 100.8)];
    const s = sen(calcularTecnico(entrada(d)), 'REBOTE_SMA_100_200');
    expect(s.cumplida).toBe(true);
    expect(s.detalle).toContain('SMA100');
    expect(s.detalle).toContain('SMA200');
  });
  it('mínimo lejos de la media (más de 1% arriba): no cumplida', () => {
    const d = [...planas(250), v(250, 106, 108, 105, 107)];
    expect(sen(calcularTecnico(entrada(d)), 'REBOTE_SMA_100_200').cumplida).toBe(false);
  });
  it('toca la media pero cierra por debajo: no cumplida', () => {
    const d = [...planas(250), v(250, 100, 100.2, 98, 99)];
    expect(sen(calcularTecnico(entrada(d)), 'REBOTE_SMA_100_200').cumplida).toBe(false);
  });
  it('con 100 a 199 velas evalúa solo la SMA 100; con menos de 100 queda sin datos (null)', () => {
    const corta = calcularTecnico(entrada([...planas(150), v(150, 100, 101, 99.5, 100.8)]));
    expect(sen(corta, 'REBOTE_SMA_100_200').cumplida).toBe(true);
    expect(sen(corta, 'REBOTE_SMA_100_200').detalle).not.toContain('SMA200');
    const muyCorta = calcularTecnico(entrada([...planas(60), v(60, 100, 101, 99.5, 100.8)]));
    expect(sen(muyCorta, 'REBOTE_SMA_100_200').cumplida).toBeNull();
  });
});

describe('v0.70: reversión alcista por velas (apertura PCP)', () => {
  it('martillo en la última vela tras una bajada: cumplida', () => {
    const d = [...bajada(0, 40), v(40, 99.6, 100, 98.4, 100)];
    // vela 40: abre 99.6 (el cierre anterior es 100 → sin importar), cuerpo 0.4, mecha inferior 1.2, sin mecha superior
    const s = sen(calcularTecnico(entrada(d)), 'REVERSION_ALCISTA_VELAS');
    expect(s.cumplida).toBe(true);
    expect(s.detalle).toContain('M.');
  });
  it('envolvente alcista en la última vela: cumplida', () => {
    const d = [...bajada(0, 40), v(40, 99, 99.1, 97.9, 98), v(41, 97.8, 99.6, 97.7, 99.5)];
    const s = sen(calcularTecnico(entrada(d)), 'REVERSION_ALCISTA_VELAS');
    expect(s.cumplida).toBe(true);
    expect(s.detalle).toContain('Env. A.');
  });
  it('estrella de la mañana que se completa en la última vela (el doji es la penúltima): cumplida', () => {
    const d = [...bajada(0, 40), v(40, 100, 100.1, 97.9, 98), v(41, 97.5, 98, 97, 97.52), v(42, 97.6, 99.6, 97.5, 99.5)];
    const s = sen(calcularTecnico(entrada(d)), 'REVERSION_ALCISTA_VELAS');
    expect(s.cumplida).toBe(true);
    expect(s.detalle).toContain('Est. M.');
  });
  it('un patrón de una vela anterior no cuenta, y velas planas no dan patrón', () => {
    const conPatronAntes = [...bajada(0, 40), v(40, 99.6, 100, 98.4, 100), v(41, 100, 100.6, 99.9, 100.5), v(42, 100.5, 101, 100.4, 100.9)];
    expect(sen(calcularTecnico(entrada(conPatronAntes)), 'REVERSION_ALCISTA_VELAS').cumplida).toBe(false);
    expect(sen(calcularTecnico(entrada(planas(60))), 'REVERSION_ALCISTA_VELAS').cumplida).toBe(false);
  });
  it('los patrones bajistas (rojos) no cuentan como reversión alcista', () => {
    const subida = Array.from({ length: 40 }, (_, k) => v(k, 100 + k, 101.1 + k, 99.9 + k, 101 + k));
    // martillo en tendencia alcista = hombre colgado (bajista)
    const d = [...subida, v(40, 140.6, 141, 139.4, 141)];
    expect(sen(calcularTecnico(entrada(d)), 'REVERSION_ALCISTA_VELAS').cumplida).toBe(false);
  });
});

describe('v0.70: detonante de apertura PCP con 6 señales posibles y fuerza', () => {
  const sn = (c: Record<string, boolean | null>) => ({ senales: Object.entries(c).map(([id, cumplida]) => ({ id, cumplida, detalle: '' })) }) as unknown as SnapshotTecnico;
  it('incluye las dos señales nuevas; el mínimo sigue siendo 2', () => {
    expect(SENALES_POR_USO.apertura_pcp).toHaveLength(6);
    expect(SENALES_POR_USO.apertura_pcp).toContain('REBOTE_SMA_100_200');
    expect(SENALES_POR_USO.apertura_pcp).toContain('REVERSION_ALCISTA_VELAS');
    const d = detonantePara(sn({ REBOTE_SMA_100_200: true }), 'apertura_pcp');
    expect(d.detonante_confirmado).toBe(false);
    expect(detonantePara(sn({ REBOTE_SMA_100_200: true, REVERSION_ALCISTA_VELAS: true }), 'apertura_pcp').detonante_confirmado).toBe(true);
  });
  it('la fuerza es informativa: 2 normal, 3 fuerte, 4 o más muy fuerte; con menos de 2 es null', () => {
    expect(fuerzaEntrada(0)).toBeNull();
    expect(fuerzaEntrada(1)).toBeNull();
    expect(fuerzaEntrada(2)).toBe('normal');
    expect(fuerzaEntrada(3)).toBe('fuerte');
    expect(fuerzaEntrada(4)).toBe('muy_fuerte');
    expect(fuerzaEntrada(6)).toBe('muy_fuerte');
    const d = detonantePara(sn({ RSI_SOBREVENTA: true, KONCORDE_BAJO_CERO: true, EMA8_SOBRE_EMA21: true }), 'apertura_pcp');
    expect(d.fuerza).toBe('fuerte');
    expect(d.detonante_confirmado).toBe(true);
  });
  it('el MACD ya no es una confirmación pendiente en apertura ni en recompra de PCP', () => {
    expect(detonantePara(sn({}), 'apertura_pcp').discrecionales_pendientes).not.toContain('MACD');
    expect(detonantePara(sn({}), 'recompra_pcp').discrecionales_pendientes).not.toContain('MACD');
  });
  it('las señales nuevas no cuentan para la recompra, ni para PMP', () => {
    expect(SENALES_POR_USO.recompra_pcp).not.toContain('REBOTE_SMA_100_200' as never);
    expect(SENALES_POR_USO.apertura_pmp).not.toContain('REVERSION_ALCISTA_VELAS' as never);
  });
});
