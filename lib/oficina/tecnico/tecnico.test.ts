import { describe, expect, it } from 'vitest';
import { adxSeries, macdSeries, rsiSeries, mogalefBandsSeries, koncordeSeries } from '../../indicators';
import type { Candle } from '../../indicators';
import {
  PARAMETROS_TECNICO, SENALES_POR_USO, atrSeries, calcularTecnico, detonantePara, evaluarBanana, pivotes, rachaRuptura, rsiSobrecompra, validarSalidaTecnico, validarVelas,
} from './index';
import type { EntradaTecnico, SalidaTecnicoModelo, SnapshotTecnico } from './index';

const DIA = 86400;
const T0 = Date.UTC(2020, 0, 6) / 1000;

/** Serie pseudoaleatoria determinista (LCG). */
function caminata(n: number, semilla = 7, inicio = 100, vol = 1000): Candle[] {
  let s = semilla;
  const r = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  const out: Candle[] = [];
  let px = inicio;
  for (let i = 0; i < n; i++) {
    const open = px;
    const close = Math.max(1, open + (r() - 0.5) * 2);
    const high = Math.max(open, close) + r() * 0.5;
    const low = Math.min(open, close) - r() * 0.5;
    out.push({ time: T0 + i * DIA, open, high, low, close, volume: vol + Math.floor(r() * 500) });
    px = close;
  }
  return out;
}
/** Vela a partir de un cierre: high/low a ±0.5. */
const vela = (i: number, close: number, open = close, volume = 1000, paso = DIA): Candle => ({
  time: T0 + i * paso, open, high: Math.max(open, close) + 0.5, low: Math.min(open, close) - 0.5, close, volume,
});
const entrada = (d: Candle[], s: Candle[] = [], extra: Partial<EntradaTecnico> = {}): EntradaTecnico => ({
  ticker: 'TEST', fecha_evaluacion: '2026-10-14', fuente: 'prueba', velas_diarias: d, velas_semanales: s,
  ultima_vela_diaria_cerrada: true, ultima_vela_semanal_cerrada: true, ...extra,
});
const sen = (s: SnapshotTecnico, id: string) => s.senales.find(x => x.id === id)!;

describe('datos de entrada', () => {
  it('con menos de 35 velas diarias es NO_EVALUABLE y no devuelve nada calculado', () => {
    const r = calcularTecnico(entrada(caminata(30)));
    expect(r.estado).toBe('NO_EVALUABLE');
    expect(r.senales).toEqual([]);
    expect(r.niveles_calculados).toEqual([]);
    expect(r.motivos[0]).toContain('historial_diario_insuficiente');
  });
  it('velas incoherentes, repetidas o fuera de orden son NO_EVALUABLE', () => {
    const base = caminata(60);
    const malaHL = base.map((c, i) => (i === 10 ? { ...c, high: c.low - 1 } : c));
    expect(calcularTecnico(entrada(malaHL)).estado).toBe('NO_EVALUABLE');
    const repetida = base.map((c, i) => (i === 10 ? { ...c, time: base[9]!.time } : c));
    expect(calcularTecnico(entrada(repetida)).motivos[0]).toContain('fuera de orden');
    const nan = base.map((c, i) => (i === 5 ? { ...c, close: NaN } : c));
    expect(calcularTecnico(entrada(nan)).estado).toBe('NO_EVALUABLE');
    expect(validarVelas(base)).toBeNull();
  });
  it('una vela en formación se descarta: no se calcula nada con ella', () => {
    const d = caminata(80);
    const cerrada = calcularTecnico(entrada(d.slice(0, 79)));
    const enFormacion = calcularTecnico(entrada(d, [], { ultima_vela_diaria_cerrada: false }));
    expect(enFormacion.ultima_vela_diaria).toEqual(cerrada.ultima_vela_diaria);
    expect(enFormacion.indicadores).toEqual(cerrada.indicadores);
    expect(enFormacion.velas_usadas.diarias).toBe(79);
  });
  it('no modifica las velas que recibe y es determinista', () => {
    const d = caminata(300), s = caminata(80);
    const copia = JSON.parse(JSON.stringify(d));
    const a = calcularTecnico(entrada(d, s)), b = calcularTecnico(entrada(d, s));
    expect(a).toEqual(b);
    expect(d).toEqual(copia);
  });
});

describe('reutiliza las funciones de TradingCat sin cambiarlas', () => {
  it('los indicadores salen idénticos a llamar a lib/indicators.ts', () => {
    const d = caminata(400);
    const r = calcularTecnico(entrada(d));
    const ult = <T,>(a: T[]) => a[a.length - 1]!;
    expect(r.indicadores.rsi14).toBe(ult(rsiSeries(d, 14)).value);
    expect(r.indicadores.macd_hist).toBe(ult(macdSeries(d)).hist);
    expect(r.indicadores.adx14).toBe(ult(adxSeries(d, 14)).adx);
    const k = ult(koncordeSeries(d));
    expect([r.indicadores.koncorde_verde, r.indicadores.koncorde_marron, r.indicadores.koncorde_azul]).toEqual([k.verde, k.marron, k.azul]);
    const m = ult(mogalefBandsSeries(d, 10, 30, 1.5));
    expect([r.indicadores.mogalef_superior, r.indicadores.mogalef_inferior]).toEqual([m.sup, m.inf]);
  });
  it('EMA 8/21/200 coinciden con la fórmula de la ruta (semilla SMA, k = 2/(n+1))', () => {
    const d = caminata(260);
    const ema = (p: number) => {
      const k = 2 / (p + 1);
      let e = d.slice(0, p).reduce((a, c) => a + c.close, 0) / p;
      for (let i = p; i < d.length; i++) e = d[i]!.close * k + e * (1 - k);
      return e;
    };
    const r = calcularTecnico(entrada(d));
    expect(r.indicadores.ema8).toBeCloseTo(ema(8), 10);
    expect(r.indicadores.ema21).toBeCloseTo(ema(21), 10);
    expect(r.indicadores.ema200_diaria).toBeCloseTo(ema(200), 10);
  });
  it('SMA 200 semanal = promedio simple de los últimos 200 cierres semanales', () => {
    const s = caminata(230, 3, 50);
    const r = calcularTecnico(entrada(caminata(60), s));
    const esperado = s.slice(-200).reduce((a, c) => a + c.close, 0) / 200;
    expect(r.indicadores.sma200_semanal).toBeCloseTo(esperado, 10);
  });
});

describe('faltantes: null y declarado, nunca rellenado', () => {
  it('con 150 velas la EMA200 y los extremos de 52 semanas no existen, y se dice por qué', () => {
    const r = calcularTecnico(entrada(caminata(150)));
    expect(r.estado).toBe('parcial');
    expect(r.indicadores.ema200_diaria).toBeNull();
    expect(r.cierre_sobre_ema200_diaria).toBeNull();
    expect(r.motivos.join('|')).toContain('ema200_diaria');
    expect(r.niveles_calculados.some(n => n.tipo === 'ema200_diaria')).toBe(false);
    expect(r.niveles_calculados.some(n => n.tipo === 'maximo_52_semanas')).toBe(false);
  });
  it('sin volumen (0) Koncorde no se calcula y la señal queda sin evaluar', () => {
    const d = caminata(200).map(c => ({ ...c, volume: 0 }));
    const r = calcularTecnico(entrada(d));
    expect(r.indicadores.koncorde_verde).toBeNull();
    expect(sen(r, 'KONCORDE_BAJO_CERO').cumplida).toBeNull();
    expect(r.motivos.join('|')).toContain('volumen');
  });
  it('con menos de 120 velas Koncorde no se calcula', () => {
    expect(calcularTecnico(entrada(caminata(100))).indicadores.koncorde_marron).toBeNull();
  });
  it('velas semanales inválidas se ignoran: parcial, sin banana ni SMA semanal', () => {
    const s = caminata(100).map((c, i) => (i === 3 ? { ...c, high: c.low - 1 } : c));
    const r = calcularTecnico(entrada(caminata(200), s));
    expect(r.estado).toBe('parcial');
    expect(r.banana.cumplida).toBeNull();
    expect(r.motivos.join('|')).toContain('velas_semanales_invalidas');
  });
});

describe('señales de PCP-10 / PCP-04', () => {
  it('RSI ≤ 30: cae sostenidamente → cumplida; sube → no', () => {
    const baja = Array.from({ length: 60 }, (_, i) => vela(i, 100 - i));
    const sube = Array.from({ length: 60 }, (_, i) => vela(i, 100 + i));
    expect(sen(calcularTecnico(entrada(baja)), 'RSI_SOBREVENTA').cumplida).toBe(true);
    expect(sen(calcularTecnico(entrada(sube)), 'RSI_SOBREVENTA').cumplida).toBe(false);
  });
  it('EMA 8 sobre EMA 21: estado, no cruce', () => {
    const baja = Array.from({ length: 60 }, (_, i) => vela(i, 100 - i));
    const sube = Array.from({ length: 60 }, (_, i) => vela(i, 100 + i));
    expect(sen(calcularTecnico(entrada(sube)), 'EMA8_SOBRE_EMA21').cumplida).toBe(true);
    expect(sen(calcularTecnico(entrada(baja)), 'EMA8_SOBRE_EMA21').cumplida).toBe(false);
  });
  it('Mogalef: el cierre rompe la banda inferior vigente de la vela anterior', () => {
    const plano = Array.from({ length: 60 }, (_, i) => vela(i, 100 + (i % 2 ? 0.1 : -0.1)));
    const cae = [...plano, { time: T0 + 60 * DIA, open: 100, high: 100.2, low: 79, close: 80, volume: 1000 }];
    const sigue = [...plano, vela(60, 100.05)];
    expect(sen(calcularTecnico(entrada(cae)), 'MOGALEF_BANDA_INFERIOR').cumplida).toBe(true);
    expect(sen(calcularTecnico(entrada(sigue)), 'MOGALEF_BANDA_INFERIOR').cumplida).toBe(false);
  });
  it('Mogalef: la banda se recentra en la vela que la rompe, por eso se compara con la banda de la vela anterior', () => {
    const plano = Array.from({ length: 60 }, (_, i) => vela(i, 100 + (i % 2 ? 0.1 : -0.1)));
    const v = [...plano, { time: T0 + 60 * DIA, open: 100, high: 100.2, low: 99.65, close: 99.85, volume: 1000 }];
    const r = calcularTecnico(entrada(v));
    // la banda nueva (recentrada) queda bajo el cierre, pero el cierre sí rompió la banda vigente antes de esa vela
    expect(r.indicadores.mogalef_inferior!).toBeLessThan(99.85);
    expect(sen(r, 'MOGALEF_BANDA_INFERIOR').cumplida).toBe(true);
  });
  it('Koncorde: cualquiera de verde/marrón/azul bajo cero cuenta; la media no', () => {
    const r = calcularTecnico(entrada(caminata(300, 11)));
    const i = r.indicadores;
    const bajo = [i.koncorde_verde, i.koncorde_marron, i.koncorde_azul].some(v => (v as number) < 0);
    expect(sen(r, 'KONCORDE_BAJO_CERO').cumplida).toBe(bajo);
  });
  it('Nivel pasado (soporte): el cierre vuelve a ±1.5% de un pivote de mínimo; a 5% no', () => {
    const tramo = (desde: number, hasta: number, pasos: number, i0: number) =>
      Array.from({ length: pasos }, (_, k) => vela(i0 + k, desde + ((hasta - desde) * k) / (pasos - 1)));
    const base = [...tramo(110, 90, 40, 0), ...tramo(90.5, 110, 40, 40)];           // suelo ~90 (low 89.5); techo ~110 (high 110.5)
    const cerca = [...base, ...tramo(108, 90.8, 20, 80)];
    const lejos = [...base, ...tramo(108, 95, 20, 80)];
    const rc = calcularTecnico(entrada(cerca)), rl = calcularTecnico(entrada(lejos));
    expect(sen(rc, 'NIVEL_PASADO').cumplida).toBe(true);
    expect(sen(rl, 'NIVEL_PASADO').cumplida).toBe(false);
    expect(sen(rc, 'NIVEL_PASADO').detalle).toContain('mínimo');
  });
  it('Nivel pasado (resistencia): el cierre a ±1.5% de un pivote de máximo también cuenta; a 5% no', () => {
    const tramo = (desde: number, hasta: number, pasos: number, i0: number) =>
      Array.from({ length: pasos }, (_, k) => vela(i0 + k, desde + ((hasta - desde) * k) / (pasos - 1)));
    const base = [...tramo(110, 90, 40, 0), ...tramo(90.5, 110, 40, 40)];           // techo en la vela 79 (high 110.5)
    const cerca = [...base, ...tramo(108, 109.5, 20, 80)];                          // cierre 109.5: a 0.9% del techo
    const lejos = [...base, ...tramo(108, 100, 20, 80)];                            // cierre 100: a 9.5% del techo y a 11% del suelo
    expect(sen(calcularTecnico(entrada(cerca)), 'NIVEL_PASADO').cumplida).toBe(true);
    expect(sen(calcularTecnico(entrada(cerca)), 'NIVEL_PASADO').detalle).toContain('máximo');
    expect(sen(calcularTecnico(entrada(lejos)), 'NIVEL_PASADO').cumplida).toBe(false);
  });
  it('las señales salen en un orden fijo: NIVEL_PASADO (recompra del PCP y DCA del PLP) es una sola señal', () => {
    const ids = calcularTecnico(entrada(caminata(300))).senales.map(s => s.id);
    expect(ids).toEqual([
      'RSI_SOBREVENTA', 'KONCORDE_BAJO_CERO', 'EMA8_SOBRE_EMA21', 'MOGALEF_BANDA_INFERIOR', 'NIVEL_PASADO',
      'RSI_SOBRECOMPRA', 'MOGALEF_BANDA_SUPERIOR', 'RESISTENCIA_PASADA',
    ]);
  });
  it('sin pivotes confirmados, NIVEL_PASADO y RESISTENCIA_PASADA quedan sin evaluar (null)', () => {
    const sube = Array.from({ length: 60 }, (_, i) => vela(i, 100 + i));
    const r = calcularTecnico(entrada(sube));
    expect(sen(r, 'NIVEL_PASADO').cumplida).toBeNull();
    expect(sen(r, 'RESISTENCIA_PASADA').cumplida).toBeNull();
  });
});

describe('nivel pasado y resistencia pasada: tolerancia ±1.5% y alcance', () => {
  /** 40 velas planas en `base` (todas con el mismo máximo y mínimo: los empates no son pivote) con un único pivote en la vela 20
   *  (un pico de máximo `alto` o un foso de mínimo `bajo`) y una vela final con el cierre dado. */
  const planas = (base: number) => Array.from({ length: 40 }, (_, i) => vela(i, base));
  const conPico = (base: number, alto: number, cierreFinal: number): Candle[] => {
    const v = planas(base);
    v[20] = { ...v[20]!, high: alto };
    v.push({ time: T0 + 40 * DIA, open: base, high: Math.max(cierreFinal, base) + 0.5, low: base - 0.5, close: cierreFinal, volume: 1000 });
    return v;
  };
  const conFoso = (base: number, bajo: number, cierreFinal: number): Candle[] => {
    const v = planas(base);
    v[20] = { ...v[20]!, low: bajo };
    v.push({ time: T0 + 40 * DIA, open: cierreFinal, high: cierreFinal + 0.5, low: cierreFinal - 0.5, close: cierreFinal, volume: 1000 });
    return v;
  };
  const nivel = (d: Candle[]) => sen(calcularTecnico(entrada(d)), 'NIVEL_PASADO').cumplida;
  const resistencia = (d: Candle[]) => sen(calcularTecnico(entrada(d)), 'RESISTENCIA_PASADA').cumplida;

  it('el borde del 1.5% cuenta (≤) por ambos lados del pivote de máximo y justo fuera no', () => {
    for (const [cierre, esperado] of [[203, true], [197, true], [203.01, false], [196.99, false]] as const) {
      expect(nivel(conPico(10, 200, cierre))).toBe(esperado);
      expect(resistencia(conPico(10, 200, cierre))).toBe(esperado);
    }
  });
  it('el borde cuenta también cuando la resta en coma flotante se pasa por un error mínimo (20 → 20.3 y 19.7)', () => {
    for (const [cierre, esperado] of [[20.3, true], [19.7, true], [20.31, false], [19.69, false]] as const) {
      expect(nivel(conPico(10, 20, cierre))).toBe(esperado);
      expect(resistencia(conPico(10, 20, cierre))).toBe(esperado);
    }
  });
  it('el borde del 1.5% cuenta también con un pivote de mínimo', () => {
    for (const [cierre, esperado] of [[50.75, true], [49.25, true], [50.76, false], [49.24, false]] as const) {
      expect(nivel(conFoso(100, 50, cierre))).toBe(esperado);
    }
  });
  it('con solo pivotes de mínimo, NIVEL_PASADO se evalúa y RESISTENCIA_PASADA queda sin evaluar (null), no false', () => {
    const d = conFoso(100, 50, 50.5);
    expect(nivel(d)).toBe(true);
    expect(resistencia(d)).toBeNull();
  });
  it('con solo pivotes de máximo, NIVEL_PASADO se evalúa con ellos', () => {
    expect(nivel(conPico(10, 200, 199))).toBe(true);
    expect(nivel(conPico(10, 200, 150))).toBe(false);
  });

  // --- PLP-03 (22-oct): el DCA del PLP usa NIVEL_PASADO (mínimos y máximos), no una señal aparte de soportes
  /** Un techo (pivote de máximo, 120) y un suelo (pivote de mínimo, 80); el cierre final lo elige cada prueba. */
  const conTechoYSuelo = (cierreFinal: number): Candle[] => {
    const v = planas(100);
    v[10] = { ...v[10]!, high: 120 };
    v[25] = { ...v[25]!, low: 80 };
    v.push({ time: T0 + 40 * DIA, open: cierreFinal, high: cierreFinal + 0.5, low: cierreFinal - 0.5, close: cierreFinal, volume: 1000 });
    return v;
  };
  it('no existe una señal SOPORTE_PASADO: el DCA del PLP usa la definición común NIVEL_PASADO', () => {
    const ids = calcularTecnico(entrada(conTechoYSuelo(80.6))).senales.map(s => s.id as string);
    expect(ids).not.toContain('SOPORTE_PASADO');
    expect(SENALES_POR_USO.dca_plp).toContain('NIVEL_PASADO');
  });
  it('el DCA del PLP se activa tanto cerca de un suelo como cerca de un techo (NIVEL_PASADO), igual que la recompra del PCP', () => {
    const techo = calcularTecnico(entrada(conTechoYSuelo(119.5)));
    const suelo = calcularTecnico(entrada(conTechoYSuelo(80.6)));
    for (const r of [techo, suelo]) {
      expect(detonantePara(r, 'dca_plp').senales_cumplidas).toContain('NIVEL_PASADO');
      expect(detonantePara(r, 'dca_plp').detonante_confirmado).toBe(true);
      expect(detonantePara(r, 'recompra_pcp').senales_cumplidas).toContain('NIVEL_PASADO');
    }
  });
  it('RESISTENCIA_PASADA no cuenta soportes: cerca de un pivote de mínimo es false, aunque NIVEL_PASADO sea true', () => {
    // techo (pivote de máximo, 120) y suelo (pivote de mínimo, 80); el cierre final (80.6) queda sobre el suelo, lejos del techo
    const v = planas(100);
    v[10] = { ...v[10]!, high: 120 };
    v[25] = { ...v[25]!, low: 80 };
    v.push({ time: T0 + 40 * DIA, open: 80.5, high: 81, low: 80.2, close: 80.6, volume: 1000 });
    const r = calcularTecnico(entrada(v));
    expect(sen(r, 'NIVEL_PASADO').cumplida).toBe(true);
    expect(sen(r, 'RESISTENCIA_PASADA').cumplida).toBe(false);
  });
  it('se evalúa contra todos los pivotes de la ventana, no solo contra los de la lista cerrada: una resistencia recién superada por 1% sigue contando', () => {
    // picos de máximo en 110, 120, 130 y 140; el cierre (141.4) quedó 1% sobre el último. La lista cerrada solo trae resistencias
    // por encima del cierre, así que el pico de 140 no está en ella.
    const v = planas(10);
    [110, 120, 130, 140].forEach((alto, k) => { v[5 + k * 7] = { ...v[5 + k * 7]!, high: alto }; });
    v.push({ time: T0 + 40 * DIA, open: 10, high: 142, low: 9.5, close: 141.4, volume: 1000 });
    const r = calcularTecnico(entrada(v));
    expect(r.niveles_calculados.some(n => n.tipo === 'pivote_resistencia')).toBe(false);
    expect(sen(r, 'RESISTENCIA_PASADA').cumplida).toBe(true);
    expect(sen(r, 'RESISTENCIA_PASADA').detalle).toContain('140');
    expect(sen(r, 'NIVEL_PASADO').cumplida).toBe(true);
  });
});

describe('señales de salida del PCP (19-oct)', () => {
  it('RSI_SOBRECOMPRA: sube sostenidamente → cumplida; cae → no', () => {
    const baja = Array.from({ length: 60 }, (_, i) => vela(i, 100 - i));
    const sube = Array.from({ length: 60 }, (_, i) => vela(i, 100 + i));
    expect(sen(calcularTecnico(entrada(sube)), 'RSI_SOBRECOMPRA').cumplida).toBe(true);
    expect(sen(calcularTecnico(entrada(baja)), 'RSI_SOBRECOMPRA').cumplida).toBe(false);
  });
  it('RSI_SOBRECOMPRA coincide con RSI(14) >= 70 en distintas series', () => {
    for (const semilla of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const r = calcularTecnico(entrada(caminata(200, semilla)));
      expect(sen(r, 'RSI_SOBRECOMPRA').cumplida).toBe(r.indicadores.rsi14! >= 70);
    }
  });
  it('parámetros aprobados: RSI de sobrecompra 70 y tolerancia de nivel pasado 1.5%', () => {
    expect(PARAMETROS_TECNICO.rsi_sobrecompra).toBe(70);
    expect(PARAMETROS_TECNICO.rsi_sobreventa).toBe(30);
    expect(PARAMETROS_TECNICO.nivel_tolerancia_pct).toBe(1.5);
  });
  it('rsiSobrecompra: el 70 cuenta (>=), 69.9999 no, y sin RSI es null', () => {
    expect(rsiSobrecompra(70, 70)).toBe(true);
    expect(rsiSobrecompra(70.0001, 70)).toBe(true);
    expect(rsiSobrecompra(69.9999, 70)).toBe(false);
    expect(rsiSobrecompra(null, 70)).toBeNull();
  });
  it('Mogalef superior: la ruptura es estricta; un cierre igual a la banda anterior no es ruptura, uno apenas encima sí', () => {
    const base = caminata(60);
    const supAyer = mogalefBandsSeries(base, 10, 30, 1.5)[base.length - 1]!.sup!;
    const con = (close: number) => {
      const ultima: Candle = { time: T0 + 60 * DIA, open: supAyer - 0.3, high: Math.max(close, supAyer) + 0.5, low: supAyer - 0.5, close, volume: 1000 };
      return sen(calcularTecnico(entrada([...base, ultima])), 'MOGALEF_BANDA_SUPERIOR').cumplida;
    };
    expect(con(supAyer)).toBe(false);
    expect(con(supAyer + 0.0001)).toBe(true);
  });
  // --- Mogalef superior: una señal por racha (21-oct)
  const plano60 = () => Array.from({ length: 60 }, (_, i) => vela(i, 100 + (i % 2 ? 0.1 : -0.1)));
  const rompeArriba: Candle = { time: T0 + 60 * DIA, open: 100, high: 121, low: 99.9, close: 120, volume: 1000 };
  const serieMog = (d: Candle[]) => mogalefBandsSeries(d, 10, 30, 1.5);
  const velaCierre = (i: number, close: number): Candle => ({ time: T0 + i * DIA, open: close, high: close + 0.5, low: close - 0.5, close, volume: 1000 });
  const fechaIdx = (i: number) => new Date((T0 + i * DIA) * 1000).toISOString().slice(0, 10);
  const supSenal = (d: Candle[]) => sen(calcularTecnico(entrada(d)), 'MOGALEF_BANDA_SUPERIOR');

  it('Mogalef superior: la banda salta en la vela de la ruptura; la vela siguiente se compara con la banda nueva y, si también rompe, es la misma racha y no repite la señal', () => {
    const plano = plano60();
    const supAntes = serieMog(plano)[59]!.sup!;
    const supNueva = serieMog([...plano, rompeArriba])[60]!.sup!;
    expect(supSenal([...plano, rompeArriba]).cumplida).toBe(true);
    expect(supNueva).toBeGreaterThan(supAntes);                                   // la banda saltó en la vela de la ruptura
    const dia2 = (close: number) => supSenal([...plano, rompeArriba, velaCierre(61, close)]);
    expect(dia2(supNueva - 1).cumplida).toBe(false);                              // no rompe la banda nueva: sin racha
    expect(dia2(supNueva - 1).racha).toEqual({ en_curso: false, dias: 0, fecha_inicio: null });
    expect(dia2(supNueva).cumplida).toBe(false);                                  // estricta
    const sigue = dia2(supNueva + 1);                                             // rompe la banda nueva: continúa la racha
    expect(sigue.cumplida).toBe(false);
    expect(sigue.racha).toEqual({ en_curso: true, dias: 2, fecha_inicio: fechaIdx(60) });
    expect(sigue.detalle).toContain('no se repite');
  });
  it('Mogalef superior: en tres días seguidos solo el primero es señal; la racha guarda la fecha de activación', () => {
    const d1 = [...plano60(), rompeArriba];
    const d2 = [...d1, velaCierre(61, serieMog(d1)[60]!.sup! + 1)];
    const d3 = [...d2, velaCierre(62, serieMog(d2)[61]!.sup! + 1)];
    const r = [d1, d2, d3].map(supSenal);
    expect(r.map(s => s.cumplida)).toEqual([true, false, false]);
    expect(r.map(s => s.racha!.dias)).toEqual([1, 2, 3]);
    expect(r.map(s => s.racha!.fecha_inicio)).toEqual([fechaIdx(60), fechaIdx(60), fechaIdx(60)]);
    expect(r[0]!.detalle).toContain('primera ruptura de la racha');
    expect(r[2]!.detalle).toContain(`racha iniciada el ${fechaIdx(60)}`);
  });
  it('Mogalef superior: una vela sin ruptura cierra la racha y la siguiente ruptura es una señal nueva (rearme)', () => {
    const d1 = [...plano60(), rompeArriba];
    const sup1 = serieMog(d1)[60]!.sup!;
    const d2 = [...d1, velaCierre(61, sup1 - 1)];                                 // no rompe: la racha termina
    expect(supSenal(d2).cumplida).toBe(false);
    const sup2 = serieMog(d2)[61]!.sup!;
    const d3 = [...d2, velaCierre(62, sup2 + 1)];                                 // vuelve a romper: racha nueva
    const s = supSenal(d3);
    expect(s.cumplida).toBe(true);
    expect(s.racha).toEqual({ en_curso: true, dias: 1, fecha_inicio: fechaIdx(62) });
  });
  it('Mogalef inferior no cambia: la regla de una señal por racha es solo de la banda superior (21-oct)', () => {
    const plano = plano60();
    const cae = (d: Candle[], i: number) => velaCierre(i, serieMog(d)[d.length - 1]!.inf! - 1);
    const d1 = [...plano, cae(plano, 60)];
    const d2 = [...d1, cae(d1, 61)];
    const inf = (d: Candle[]) => sen(calcularTecnico(entrada(d)), 'MOGALEF_BANDA_INFERIOR').cumplida;
    expect(inf(d1)).toBe(true);
    expect(inf(d2)).toBe(true);                                                   // segunda ruptura seguida: la inferior sigue señalando
  });
  it('las señales de salida no dependen de Koncorde: con volumen cero siguen evaluándose', () => {
    const d = caminata(200).map(c => ({ ...c, volume: 0 }));
    const r = calcularTecnico(entrada(d));
    expect(sen(r, 'KONCORDE_BAJO_CERO').cumplida).toBeNull();
    expect(sen(r, 'RSI_SOBRECOMPRA').cumplida).not.toBeNull();
    expect(sen(r, 'MOGALEF_BANDA_SUPERIOR').cumplida).not.toBeNull();
    expect(sen(r, 'RESISTENCIA_PASADA').cumplida).not.toBeNull();
  });
  it('cada señal de salida se reporta por separado, con su propio detalle', () => {
    const r = calcularTecnico(entrada(caminata(300, 3)));
    const detalles = ['RSI_SOBRECOMPRA', 'MOGALEF_BANDA_SUPERIOR', 'RESISTENCIA_PASADA'].map(id => sen(r, id).detalle);
    expect(new Set(detalles).size).toBe(3);
    expect(detalles.every(t => t.length > 0)).toBe(true);
  });
});

describe('volatilidad', () => {
  it('ATR(14) en % del cierre = ATR de Wilder / cierre x 100', () => {
    const d = caminata(120, 2);
    const atr = atrSeries(d, 14)[d.length - 1]!;
    const r = calcularTecnico(entrada(d));
    expect(r.indicadores.volatilidad_atr14_pct).toBeCloseTo((atr / d[d.length - 1]!.close) * 100, 10);
  });
});

describe('cálculos propios (verificados a mano)', () => {
  it('ATR de Wilder, periodo 3', () => {
    // rangos verdaderos: i1=2, i2=4, i3=3  => ATR[3]=3 ; i4=6 => (3*2+6)/3 = 4
    const v: Candle[] = [
      { time: 0, open: 10, high: 11, low: 9, close: 10, volume: 1 },
      { time: 1, open: 10, high: 12, low: 10, close: 11, volume: 1 },
      { time: 2, open: 11, high: 13, low: 9, close: 12, volume: 1 },
      { time: 3, open: 12, high: 14, low: 11, close: 13, volume: 1 },
      { time: 4, open: 13, high: 19, low: 13, close: 15, volume: 1 },
    ];
    const a = atrSeries(v, 3);
    expect(a.slice(0, 3)).toEqual([null, null, null]);
    expect(a[3]).toBeCloseTo(3, 12);
    expect(a[4]).toBeCloseTo(4, 12);
  });
  it('pivotes fractales: estrictos y confirmados con n velas posteriores', () => {
    const cierres = [5, 6, 7, 9, 7, 6, 5, 4, 3, 4, 5, 6, 7, 8, 9];
    const v = cierres.map((c, i) => ({ time: i, open: c, high: c, low: c, close: c, volume: 1 }));
    const p = pivotes(v, 2);
    expect(p.altos.map(x => x.precio)).toEqual([9]);
    expect(p.bajos.map(x => x.precio)).toEqual([3]);
    const plano = [1, 1, 1, 1, 1].map((c, i) => ({ time: i, open: c, high: c, low: c, close: c, volume: 1 }));
    expect(pivotes(plano, 1).altos).toEqual([]);                   // empates no son pivote
  });
});

describe('banana de Semilla (SEM-07)', () => {
  /** 70 semanas: base 10, subida hasta un pico de 25 (semana 40), caída, y las 3 últimas bajistas. */
  const semanas = (pico = 25, ultimaAlcista = false): Candle[] =>
    Array.from({ length: 70 }, (_, i) => {
      const precio = i < 30 ? 10 : i <= 40 ? 10 + ((pico - 10) * (i - 30)) / 10 : pico - (i - 40) * 0.5;
      const bajista = i >= 67 && !(ultimaAlcista && i === 69);
      const open = precio, close = bajista ? precio - 0.3 : precio + 0.1;
      return { time: T0 + i * 7 * DIA, open, close, high: Math.max(open, close) + (i === 40 ? 0 : 0.2), low: Math.min(open, close) - 0.2, volume: 1 };
    });
  it('pico ≥ 2x el mínimo previo y 3 velas bajistas → cumplida', () => {
    const b = evaluarBanana(semanas());
    expect(b.cumplida).toBe(true);
    expect(Number(b.multiplo)).toBeGreaterThanOrEqual(2);
    expect(b.pico_fecha).toBeDefined();
  });
  it('si el pico no llega a 2x → no cumplida', () => {
    expect(evaluarBanana(semanas(15)).cumplida).toBe(false);
  });
  it('si la última vela no es bajista → no cumplida', () => {
    expect(evaluarBanana(semanas(25, true)).cumplida).toBe(false);
  });
  it('con pocas semanas es null (no evaluable), no false', () => {
    expect(evaluarBanana(semanas().slice(-40)).cumplida).toBeNull();
  });
  it('el multiplo es un parámetro: con 3x la misma serie ya no cumple', () => {
    expect(evaluarBanana(semanas(), 3).cumplida).toBe(false);
  });
});

describe('niveles_calculados: lista cerrada', () => {
  const d = caminata(500, 5);
  const r = calcularTecnico(entrada(d, caminata(230, 9, 80)));
  it('ids únicos n1..nk, ordenados de mayor a menor precio', () => {
    const ids = r.niveles_calculados.map(n => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(ids.map((_, i) => `n${i + 1}`));
    const precios = r.niveles_calculados.map(n => Number(n.precio));
    expect(precios).toEqual([...precios].sort((a, b) => b - a));
  });
  it('máximo y mínimo de 52 semanas coinciden con un cálculo independiente', () => {
    const corte = d[d.length - 1]!.time - 364 * DIA;
    const ventana = d.filter(c => c.time >= corte);
    const max = Math.max(...ventana.map(c => c.high)), min = Math.min(...ventana.map(c => c.low));
    const nMax = r.niveles_calculados.find(n => n.tipo === 'maximo_52_semanas')!;
    const nMin = r.niveles_calculados.find(n => n.tipo === 'minimo_52_semanas')!;
    expect(Number(nMax.precio)).toBeCloseTo(max, 4);
    expect(Number(nMin.precio)).toBeCloseTo(min, 4);
  });
  it('soportes quedan bajo el cierre y resistencias sobre el cierre', () => {
    const cierre = Number(r.ultima_vela_diaria!.cierre);
    r.niveles_calculados.filter(n => n.tipo === 'pivote_soporte').forEach(n => expect(Number(n.precio)).toBeLessThan(cierre));
    r.niveles_calculados.filter(n => n.tipo === 'pivote_resistencia').forEach(n => expect(Number(n.precio)).toBeGreaterThan(cierre));
  });
  it('todo precio de la lista es una cadena decimal de hasta 4 decimales', () => {
    r.niveles_calculados.forEach(n => expect(n.precio).toMatch(/^\d+(\.\d{1,4})?$/));
  });
});

describe('detonantes por uso', () => {
  const sn = (cumplidas: Record<string, boolean | null>): SnapshotTecnico => {
    const base = calcularTecnico(entrada(caminata(300)));
    return { ...base, senales: base.senales.map(s => ({ ...s, cumplida: s.id in cumplidas ? cumplidas[s.id]! : false })) };
  };
  it('apertura PCP: basta una de RSI, Koncorde, EMA 8>21 o Mogalef; el nivel pasado no cuenta', () => {
    expect(detonantePara(sn({ EMA8_SOBRE_EMA21: true }), 'apertura_pcp').detonante_confirmado).toBe(true);
    expect(detonantePara(sn({ NIVEL_PASADO: true }), 'apertura_pcp').detonante_confirmado).toBe(false);
  });
  it('recompra PCP: el nivel pasado (soporte o resistencia) cuenta; EMA 8>21 y las señales de salida no', () => {
    expect(detonantePara(sn({ NIVEL_PASADO: true }), 'recompra_pcp').detonante_confirmado).toBe(true);
    expect(detonantePara(sn({ EMA8_SOBRE_EMA21: true }), 'recompra_pcp').detonante_confirmado).toBe(false);
    expect(SENALES_POR_USO.recompra_pcp).toEqual(['RSI_SOBREVENTA', 'KONCORDE_BAJO_CERO', 'MOGALEF_BANDA_INFERIOR', 'NIVEL_PASADO']);
    for (const id of ['RSI_SOBRECOMPRA', 'MOGALEF_BANDA_SUPERIOR', 'RESISTENCIA_PASADA']) {
      expect(detonantePara(sn({ [id]: true }), 'recompra_pcp').detonante_confirmado).toBe(false);
    }
  });
  it('DCA del PLP (22-oct): cuenta NIVEL_PASADO (mínimos y máximos); las señales de salida no', () => {
    expect(detonantePara(sn({ NIVEL_PASADO: true }), 'dca_plp').detonante_confirmado).toBe(true);
    for (const id of ['RSI_SOBRECOMPRA', 'MOGALEF_BANDA_SUPERIOR', 'RESISTENCIA_PASADA']) {
      expect(detonantePara(sn({ [id]: true }), 'dca_plp').detonante_confirmado).toBe(false);
    }
    expect(SENALES_POR_USO.dca_plp).toEqual(['RSI_SOBREVENTA', 'MOGALEF_BANDA_INFERIOR', 'EMA8_SOBRE_EMA21', 'NIVEL_PASADO']);
  });
  it('salida PCP: basta una de RSI_SOBRECOMPRA, MOGALEF_BANDA_SUPERIOR o RESISTENCIA_PASADA, cada una por separado', () => {
    for (const id of ['RSI_SOBRECOMPRA', 'MOGALEF_BANDA_SUPERIOR', 'RESISTENCIA_PASADA']) {
      const d = detonantePara(sn({ [id]: true }), 'salida_pcp');
      expect(d.detonante_confirmado).toBe(true);
      expect(d.senales_cumplidas).toEqual([id]);
    }
    expect(detonantePara(sn({}), 'salida_pcp').detonante_confirmado).toBe(false);
  });
  it('salida PCP: sin soporte ni señales de entrada; la sobreventa, Koncorde, la banda inferior y el nivel pasado no cuentan', () => {
    for (const id of ['NIVEL_PASADO', 'RSI_SOBREVENTA', 'KONCORDE_BAJO_CERO', 'MOGALEF_BANDA_INFERIOR', 'EMA8_SOBRE_EMA21']) {
      expect(detonantePara(sn({ [id]: true }), 'salida_pcp').detonante_confirmado).toBe(false);
    }
    expect(SENALES_POR_USO.salida_pcp).toEqual(['RSI_SOBRECOMPRA', 'MOGALEF_BANDA_SUPERIOR', 'RESISTENCIA_PASADA']);
  });
  it('salida PCP: MACD, Koncorde de salida y figura son visuales tuyos; el aviso dice que no autoriza una venta', () => {
    const d = detonantePara(sn({}), 'salida_pcp');
    expect(d.discrecionales_pendientes).toEqual(['MACD', 'Koncorde (visual)', 'figura chartista']);
    expect(d.aviso).toContain('no autoriza por sí sola una venta');
  });
  it('salida PCP: una señal sin evaluar no cuenta como cumplida y se reporta aparte', () => {
    const d = detonantePara(sn({ RESISTENCIA_PASADA: null, RSI_SOBRECOMPRA: false }), 'salida_pcp');
    expect(d.detonante_confirmado).toBe(false);
    expect(d.senales_no_evaluables).toEqual(['RESISTENCIA_PASADA']);
    expect(detonantePara(sn({ RESISTENCIA_PASADA: null, RSI_SOBRECOMPRA: true }), 'salida_pcp').detonante_confirmado).toBe(true);
  });
  it('una señal sin evaluar no cuenta como cumplida y se reporta aparte', () => {
    const d = detonantePara(sn({ RSI_SOBREVENTA: null }), 'apertura_pcp');
    expect(d.detonante_confirmado).toBe(false);
    expect(d.senales_no_evaluables).toEqual(['RSI_SOBREVENTA']);
  });
  it('MACD y figura chartista quedan como confirmaciones tuyas', () => {
    expect(detonantePara(sn({}), 'apertura_pcp').discrecionales_pendientes).toEqual(['MACD', 'figura chartista']);
  });
});

describe('validación de la salida del modelo', () => {
  const r = calcularTecnico(entrada(caminata(500, 5), caminata(230, 9, 80)));
  const n = r.niveles_calculados;
  const a = n[0]!, b = n[n.length - 1]!;
  const buena: SalidaTecnicoModelo = {
    veredicto: 'ESPERAR', tendencia: { corto: 'bajista', medio: 'lateral', largo: 'alcista' },
    soporte_clave: { precio: Number(b.precio), nivel_id: b.id },
    resistencia_clave: { precio: a.precio, nivel_id: a.id },
    zona_entrada: { min: b.precio, max: a.precio, nivel_ids: [b.id, a.id] },
    nivel_invalidacion: { precio: b.precio, nivel_id: b.id },
  };
  it('una salida con precios de la lista cerrada pasa', () => {
    expect(validarSalidaTecnico(buena, n)).toEqual({ ok: true, errores: [] });
  });
  it('un precio inventado se rechaza', () => {
    const v = validarSalidaTecnico({ ...buena, soporte_clave: { precio: Number(b.precio) + 0.37, nivel_id: b.id } }, n);
    expect(v.ok).toBe(false);
    expect(v.errores[0]).toContain('no coincide');
  });
  it('un nivel_id inexistente se rechaza', () => {
    expect(validarSalidaTecnico({ ...buena, nivel_invalidacion: { precio: 1, nivel_id: 'n999' } }, n).ok).toBe(false);
  });
  it('una zona de entrada con límites que no son niveles se rechaza', () => {
    const v = validarSalidaTecnico({ ...buena, zona_entrada: { min: 1.23, max: a.precio, nivel_ids: [b.id, a.id] } }, n);
    expect(v.ok).toBe(false);
  });
  it('veredicto o tendencia fuera de vocabulario se rechazan', () => {
    expect(validarSalidaTecnico({ ...buena, veredicto: 'COMPRAR' as never }, n).ok).toBe(false);
    expect(validarSalidaTecnico({ ...buena, tendencia: { corto: 'sube' as never, medio: 'lateral', largo: 'alcista' } }, n).ok).toBe(false);
  });
  it('sin niveles, cualquier precio propuesto se rechaza', () => {
    expect(validarSalidaTecnico(buena, []).ok).toBe(false);
  });
});

describe('especificación técnica de indicadores (17-oct)', () => {
  const traza = (r: SnapshotTecnico, id: string) => r.trazabilidad.find(t => t.indicador === id)!;

  it('Koncorde: un solo volumen cero dentro de las últimas 120 velas lo deja NO_EVALUABLE; RSI, ATR y demás siguen', () => {
    const d = caminata(300).map((c, i) => (i === 250 ? { ...c, volume: 0 } : c));
    const r = calcularTecnico(entrada(d));
    expect(r.indicadores.koncorde_verde).toBeNull();
    expect(sen(r, 'KONCORDE_BAJO_CERO').cumplida).toBeNull();
    expect(traza(r, 'KONCORDE').estado).toBe('NO_EVALUABLE');
    expect(traza(r, 'KONCORDE').causa).toContain('volumen cero');
    expect(r.indicadores.rsi14).not.toBeNull();
    expect(r.indicadores.volatilidad_atr14_pct).not.toBeNull();
    expect(traza(r, 'RSI14').estado).toBe('calculado');
  });
  it('Koncorde: un volumen cero anterior a las últimas 120 velas no lo invalida', () => {
    const d = caminata(300).map((c, i) => (i === 10 ? { ...c, volume: 0 } : c));
    expect(calcularTecnico(entrada(d)).indicadores.koncorde_verde).not.toBeNull();
  });

  it('Mogalef: la ruptura es estricta; un cierre igual a la banda anterior no es ruptura, uno apenas debajo sí', () => {
    const base = caminata(60);
    const infAyer = mogalefBandsSeries(base, 10, 30, 1.5)[base.length - 1]!.inf!;
    const con = (close: number) => {
      const ultima: Candle = { time: T0 + 60 * DIA, open: infAyer + 0.3, high: infAyer + 0.5, low: Math.min(close, infAyer) - 0.5, close, volume: 1000 };
      return sen(calcularTecnico(entrada([...base, ultima])), 'MOGALEF_BANDA_INFERIOR').cumplida;
    };
    expect(con(infAyer)).toBe(false);
    expect(con(infAyer - 0.0001)).toBe(true);
  });

  it('pivotes: con máximos iguales dentro de las 5 velas no hay pivote (empate = sin pivote)', () => {
    const v = Array.from({ length: 21 }, (_, i) => vela(i, 100));
    v[10] = { ...v[10]!, high: 110 };
    v[12] = { ...v[12]!, high: 110 };
    expect(pivotes(v, 5).altos.length).toBe(0);
    v[12] = { ...v[12]!, high: 105 };
    expect(pivotes(v, 5).altos.map(p => p.precio)).toEqual([110]);
  });

  it('trazabilidad: una fila por indicador con parámetros, temporalidad, fecha de cálculo, datos y estado', () => {
    const r = calcularTecnico(entrada(caminata(300), caminata(300)));
    expect(r.trazabilidad.map(t => t.indicador)).toEqual([
      'EMA8', 'EMA21', 'EMA200', 'SMA200_SEMANAL', 'RSI14', 'MACD', 'ADX14', 'ATR14', 'KONCORDE', 'MOGALEF', 'PIVOTES', 'EXTREMOS_52_SEMANAS', 'BANANA_SEM07',
    ]);
    const m = traza(r, 'MOGALEF');
    expect(m.parametros).toEqual({ regresion: 10, desviacion: 30, multiplicador: 1.5 });
    expect(m.temporalidad).toBe('diaria');
    expect(m.fecha_calculo).toBe('2026-10-14');
    expect(m.velas_disponibles).toBe(300);
    expect(m.causa).toBeNull();
    expect(traza(r, 'SMA200_SEMANAL').temporalidad).toBe('semanal');
    expect(traza(r, 'SMA200_SEMANAL').velas_disponibles).toBe(300);
  });
  it('trazabilidad: lo que no alcanza queda NO_EVALUABLE con su causa; el mínimo general de 35 velas aplica a lo diario', () => {
    const r = calcularTecnico(entrada(caminata(100), caminata(40)));
    expect(traza(r, 'EMA200').estado).toBe('NO_EVALUABLE');
    expect(traza(r, 'EMA200').causa).toContain('200');
    expect(traza(r, 'EMA8').velas_requeridas).toBe(35);
    expect(traza(r, 'SMA200_SEMANAL').estado).toBe('NO_EVALUABLE');
    expect(traza(r, 'BANANA_SEM07').estado).toBe('NO_EVALUABLE');
    expect(traza(r, 'RSI14').estado).toBe('calculado');
  });
  it('con menos de 35 velas diarias cada indicador queda NO_EVALUABLE con la causa global', () => {
    const r = calcularTecnico(entrada(caminata(20)));
    expect(r.trazabilidad.length).toBe(13);
    expect(r.trazabilidad.every(t => t.estado === 'NO_EVALUABLE' && (t.causa ?? '').includes('historial_diario_insuficiente'))).toBe(true);
  });

  it('banana: siempre experimental y sin venta automática, también cuando no se evalúa', () => {
    const a = calcularTecnico(entrada(caminata(100)));
    expect(a.banana.experimental).toBe(true);
    expect(a.banana.genera_venta_automatica).toBe(false);
    const b = calcularTecnico(entrada(caminata(10)));
    expect(b.banana.experimental).toBe(true);
    expect(b.banana.genera_venta_automatica).toBe(false);
  });
  it('banana: no entra en ningún detonante de decisión', () => {
    const r = calcularTecnico(entrada(caminata(300), caminata(80)));
    for (const uso of ['apertura_pcp', 'recompra_pcp', 'dca_plp', 'salida_pcp'] as const) {
      expect(JSON.stringify(detonantePara(r, uso))).not.toContain('BANANA');
    }
  });

  it('una vela semanal en formación se descarta igual que la diaria', () => {
    const s = caminata(60);
    const r = calcularTecnico(entrada(caminata(100), s, { ultima_vela_semanal_cerrada: false }));
    expect(r.velas_usadas.semanales).toBe(59);
    expect(traza(r, 'BANANA_SEM07').velas_disponibles).toBe(59);
  });

  it('la sobreventa del PLP se declara como condición técnica, no como orden de compra; toda señal lleva el aviso', () => {
    const r = calcularTecnico(entrada(caminata(300)));
    expect(detonantePara(r, 'dca_plp').aviso).toContain('no una orden de compra');
    expect(detonantePara(r, 'apertura_pcp').aviso).toContain('no autoriza');
    expect(r.aviso).toContain('no son una recomendación ni una decisión');
  });
});

describe('rachaRuptura: rupturas consecutivas de una banda de Mogalef (21-oct)', () => {
  const v = (closes: number[]): Candle[] => closes.map((c, i) => vela(i, c));
  const fechaIdx = (i: number) => new Date((T0 + i * DIA) * 1000).toISOString().slice(0, 10);

  it('sin ruptura hoy: 0 días y sin fecha de inicio', () => {
    expect(rachaRuptura(v([10, 11, 10.4]), [10.5, 10.5, 11.5], 'superior')).toEqual({ dias: 0, fecha_inicio: null, inicio_confirmado: true });
  });
  it('primera ruptura: 1 día, y la vela anterior se evaluó y no rompía', () => {
    expect(rachaRuptura(v([10, 10.2, 11]), [10.5, 10.5, 10.6], 'superior')).toEqual({ dias: 1, fecha_inicio: fechaIdx(2), inicio_confirmado: true });
  });
  it('tres rupturas seguidas: cuenta 3 y da la fecha de la primera', () => {
    expect(rachaRuptura(v([10, 10.2, 11, 12, 13]), [10.5, 10.5, 10.6, 11.5, 12.5], 'superior'))
      .toEqual({ dias: 3, fecha_inicio: fechaIdx(2), inicio_confirmado: true });
  });
  it('rearme: una vela sin ruptura corta la racha y la siguiente ruptura inicia otra de 1 día', () => {
    expect(rachaRuptura(v([10, 11, 10.2, 11.5]), [10.5, 10.5, 10.8, 10.8], 'superior'))
      .toEqual({ dias: 1, fecha_inicio: fechaIdx(3), inicio_confirmado: true });
  });
  it('la ruptura es estricta y contra la banda de la vela anterior: un cierre igual a la banda no rompe', () => {
    expect(rachaRuptura(v([10, 10.5]), [10.5, 10.5], 'superior')!.dias).toBe(0);
    // contra la banda de la misma vela (10.4) sí rompería; contra la de la vela anterior (10.6) no
    expect(rachaRuptura(v([10, 10.5]), [10.6, 10.4], 'superior')!.dias).toBe(0);
  });
  it('lado inferior: espejo con cierre < banda', () => {
    expect(rachaRuptura(v([10, 9.8, 9]), [9.5, 9.5, 9.4], 'inferior')).toEqual({ dias: 1, fecha_inicio: fechaIdx(2), inicio_confirmado: true });
    expect(rachaRuptura(v([10, 9.8, 9]), [9.5, 9.5, 9.4], 'superior')!.dias).toBe(0);
  });
  it('sin banda de la vela anterior no se puede evaluar: null, no 0', () => {
    expect(rachaRuptura(v([10, 11]), [null, 10.5], 'superior')).toBeNull();
    expect(rachaRuptura(v([10]), [10.5], 'superior')).toBeNull();
  });
  it('si la racha llega al principio de lo evaluable, el inicio no está confirmado', () => {
    expect(rachaRuptura(v([10, 11, 12]), [10.5, 10.6, 11.5], 'superior')).toEqual({ dias: 2, fecha_inicio: fechaIdx(1), inicio_confirmado: false });
  });
  it('no modifica las velas ni las bandas que recibe', () => {
    const velas = v([10, 10.2, 11]), bandas = [10.5, 10.5, 10.6];
    const copia = JSON.parse(JSON.stringify({ velas, bandas }));
    rachaRuptura(velas, bandas, 'superior');
    expect({ velas, bandas }).toEqual(copia);
  });
});
