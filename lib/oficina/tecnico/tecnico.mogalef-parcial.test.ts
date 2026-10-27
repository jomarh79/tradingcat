import { describe, expect, it, vi } from 'vitest';
import type { Candle } from '../../indicators';

// Con 35 velas o más Mogalef siempre tiene bandas, así que estas ramas no se alcanzan con datos normales.
// Aquí se simulan bandas ausentes o parciales para comprobar que nada se inventa: la señal queda en null y se declara.
const estado = vi.hoisted(() => ({ modo: 'vacio' as 'vacio' | 'solo_ultimas_dos' }));
vi.mock('../../indicators', async importOriginal => {
  const real = await importOriginal<typeof import('../../indicators')>();
  return {
    ...real,
    mogalefBandsSeries: (c: unknown[]) => c.map((_, i) => {
      if (estado.modo === 'solo_ultimas_dos' && i >= c.length - 2) return { sup: 100, inf: 90, center: 95 };
      return { sup: null, inf: null, center: null };
    }),
  };
});

import { calcularTecnico } from './index';
import type { EntradaTecnico } from './index';

const DIA = 86400;
const T0 = Date.UTC(2020, 0, 6) / 1000;
const velas = (n: number, cierreFinal?: number): Candle[] =>
  Array.from({ length: n }, (_, i) => {
    const c = i === n - 1 && cierreFinal !== undefined ? cierreFinal : 95 + Math.sin(i / 3) * 2;
    return { time: T0 + i * DIA, open: c, high: c + 0.5, low: c - 0.5, close: c, volume: 1000 };
  });
const entrada = (d: Candle[]): EntradaTecnico => ({
  ticker: 'TEST', fecha_evaluacion: '2026-10-14', fuente: 'prueba', velas_diarias: d, velas_semanales: [],
  ultima_vela_diaria_cerrada: true, ultima_vela_semanal_cerrada: true,
});

describe('sin bandas de Mogalef: nada se inventa', () => {
  const r = (() => { estado.modo = 'vacio'; return calcularTecnico(entrada(velas(80))); })();
  const sen = (id: string) => r.senales.find(s => s.id === id)!;

  it('las dos señales de Mogalef quedan sin evaluar (null), no false', () => {
    expect(sen('MOGALEF_BANDA_INFERIOR').cumplida).toBeNull();
    expect(sen('MOGALEF_BANDA_SUPERIOR').cumplida).toBeNull();
  });
  it('la señal superior no inventa una racha y lo dice', () => {
    expect(sen('MOGALEF_BANDA_SUPERIOR').racha).toBeUndefined();
    expect(sen('MOGALEF_BANDA_SUPERIOR').detalle).toContain('no disponible');
  });
  it('el resultado es parcial y declara por qué', () => {
    expect(r.estado).toBe('parcial');
    expect(r.motivos.join('|')).toContain('mogalef');
    expect(r.indicadores.mogalef_superior).toBeNull();
    expect(r.indicadores.mogalef_inferior).toBeNull();
  });
  it('las demás señales siguen evaluándose', () => {
    expect(sen('RSI_SOBREVENTA').cumplida).not.toBeNull();
    expect(sen('RSI_SOBRECOMPRA').cumplida).not.toBeNull();
    expect(sen('NIVEL_PASADO').cumplida).not.toBeNull();
    expect(sen('RESISTENCIA_PASADA').cumplida).not.toBeNull();
  });
});

describe('bandas solo en las dos últimas velas: la racha no es determinable', () => {
  it('hay ruptura hoy pero no se sabe si la vela anterior ya rompía: null, sin racha, y lo dice', () => {
    estado.modo = 'solo_ultimas_dos';
    const s = calcularTecnico(entrada(velas(80, 101))).senales.find(x => x.id === 'MOGALEF_BANDA_SUPERIOR')!;
    expect(s.cumplida).toBeNull();
    expect(s.racha).toBeUndefined();
    expect(s.detalle).toContain('no es determinable');
  });
  it('sin ruptura hoy sí se sabe: false con racha en 0', () => {
    estado.modo = 'solo_ultimas_dos';
    const s = calcularTecnico(entrada(velas(80, 99))).senales.find(x => x.id === 'MOGALEF_BANDA_SUPERIOR')!;
    expect(s.cumplida).toBe(false);
    expect(s.racha).toEqual({ en_curso: false, dias: 0, fecha_inicio: null });
  });
});
