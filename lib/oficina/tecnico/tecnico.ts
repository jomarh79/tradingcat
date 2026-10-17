import { adxSeries, emaArr, koncordeSeries, macdSeries, mogalefBandsSeries, rsiSeries, smaArr } from '../../indicators';
import type { Candle } from '../../indicators';
import { atrSeries, evaluarBanana, fechaDeVela, finito, fmt, pivotes, validarVelas } from './calculos';
import type {
  EntradaTecnico, Indicadores, NivelCalculado, Senal, SnapshotTecnico, TipoNivel,
} from './tipos';

/** Parámetros fijos del Técnico. Los de PCP vienen del contrato (v0.4, sección 4.3); el resto son [PROPUESTA]. */
export const PARAMETROS_TECNICO = {
  rsi_periodo: 14,
  rsi_sobreventa: 30,               // PCP-10
  mogalef_reg: 10,                  // PCP-10: Mogalef (10, 30, 1.5), diaria
  mogalef_std: 30,
  mogalef_mult: 1.5,
  soporte_tolerancia_pct: 1.5,      // PCP-04
  minimo_velas_diarias: 35,         // [PROPUESTA] por debajo no se calcula nada
  minimo_velas_koncorde: 120,       // [PROPUESTA] ventanas de 90 + media de 15 + Bollinger de 25
  pivote_velas_por_lado: 5,         // [PROPUESTA]
  pivote_ventana_velas: 250,        // [PROPUESTA] ~1 año de velas diarias
  pivotes_por_lado_del_precio: 3,   // [PROPUESTA] soportes y resistencias más cercanos que entran a la lista cerrada
  dias_52_semanas: 364,
  banana_multiplo: 2,               // SEM-07; pendiente de Backtesting
  banana_ventana_semanas: 52,
  banana_velas_bajistas: 3,
} as const;

const P = PARAMETROS_TECNICO;
const VACIOS: Indicadores = {
  ema8: null, ema21: null, ema200_diaria: null, sma200_semanal: null, rsi14: null, adx14: null, mas_di14: null,
  menos_di14: null, macd: null, macd_senal: null, macd_hist: null, volatilidad_atr14_pct: null,
  koncorde_verde: null, koncorde_marron: null, koncorde_azul: null, koncorde_media: null,
  mogalef_superior: null, mogalef_inferior: null, mogalef_centro: null,
};

function ultimo<T>(a: T[]): T | undefined { return a[a.length - 1]; }

function noEvaluable(e: EntradaTecnico, motivo: string, dia: number, sem: number): SnapshotTecnico {
  return {
    estado: 'NO_EVALUABLE', motivos: [motivo], ticker: e.ticker, fecha_evaluacion: e.fecha_evaluacion, fuente: e.fuente,
    ultima_vela_diaria: null, ultima_vela_semanal: null, velas_usadas: { diarias: dia, semanales: sem },
    indicadores: { ...VACIOS }, cierre_sobre_ema200_diaria: null, cierre_sobre_sma200_semanal: null,
    senales: [], banana: { cumplida: null, detalle: 'No evaluable' }, niveles_calculados: [],
    parametros: { ...P },
  };
}

/** Calcula indicadores, señales, banana y la lista cerrada de niveles. Código determinista: no usa IA ni inventa datos.
 *  Cualquier cosa que no se pueda calcular queda en null y se declara en `motivos`; nunca se rellena. */
export function calcularTecnico(e: EntradaTecnico): SnapshotTecnico {
  let diarias = e.velas_diarias.slice();
  let semanales = e.velas_semanales.slice();
  if (!e.ultima_vela_diaria_cerrada) diarias = diarias.slice(0, -1);
  if (!e.ultima_vela_semanal_cerrada) semanales = semanales.slice(0, -1);

  const errDia = validarVelas(diarias);
  if (errDia) return noEvaluable(e, `velas_diarias_invalidas: ${errDia}`, diarias.length, semanales.length);
  if (diarias.length < P.minimo_velas_diarias) {
    return noEvaluable(e, `historial_diario_insuficiente: ${diarias.length} velas, mínimo ${P.minimo_velas_diarias}`, diarias.length, semanales.length);
  }

  const motivos: string[] = [];
  const errSem = validarVelas(semanales);
  if (errSem) {
    motivos.push(`velas_semanales_invalidas: ${errSem}`);
    semanales = [];
  }

  const n = diarias.length;
  const ult = diarias[n - 1]!;
  const cierre = ult.close;
  const ind: Indicadores = { ...VACIOS };
  const cierres = diarias.map(c => c.close);

  // --- Medias y osciladores: funciones de TradingCat (lib/indicators.ts), sin cambios
  const ema8 = emaArr(cierres, 8), ema21 = emaArr(cierres, 21), ema200 = emaArr(cierres, 200);
  ind.ema8 = finito(ema8[n - 1]); ind.ema21 = finito(ema21[n - 1]); ind.ema200_diaria = finito(ema200[n - 1]);
  if (ind.ema200_diaria === null) motivos.push(`ema200_diaria: se necesitan 200 velas diarias y hay ${n}`);

  if (semanales.length > 0) {
    const sma = smaArr(semanales.map(c => c.close), 200);
    ind.sma200_semanal = finito(sma[semanales.length - 1]);
  }
  if (ind.sma200_semanal === null) motivos.push(`sma200_semanal: se necesitan 200 velas semanales y hay ${semanales.length}`);

  ind.rsi14 = finito(ultimo(rsiSeries(diarias, P.rsi_periodo))?.value);
  const macd = ultimo(macdSeries(diarias));
  ind.macd = finito(macd?.macd); ind.macd_senal = finito(macd?.signal); ind.macd_hist = finito(macd?.hist);
  const adx = ultimo(adxSeries(diarias, 14));
  ind.adx14 = finito(adx?.adx); ind.mas_di14 = finito(adx?.plusDI); ind.menos_di14 = finito(adx?.minusDI);
  const atr = finito(atrSeries(diarias, 14)[n - 1]);
  ind.volatilidad_atr14_pct = atr !== null && cierre !== 0 ? (atr / cierre) * 100 : null;

  // Koncorde: necesita historial y volumen real (TradingCat guarda 0 si la fuente no manda volumen)
  const ventanaVol = diarias.slice(-P.minimo_velas_koncorde);
  const hayVolumen = n >= P.minimo_velas_koncorde && ventanaVol.some(c => c.volume > 0);
  if (hayVolumen) {
    const k = ultimo(koncordeSeries(diarias));
    ind.koncorde_verde = finito(k?.verde); ind.koncorde_marron = finito(k?.marron);
    ind.koncorde_azul = finito(k?.azul); ind.koncorde_media = finito(k?.media);
  } else {
    motivos.push(n < P.minimo_velas_koncorde
      ? `koncorde: se necesitan ${P.minimo_velas_koncorde} velas diarias y hay ${n}`
      : 'koncorde: la fuente no trae volumen en las últimas velas');
  }

  const mog = mogalefBandsSeries(diarias, P.mogalef_reg, P.mogalef_std, P.mogalef_mult);
  const mogHoy = mog[n - 1], mogAyer = mog[n - 2];
  ind.mogalef_superior = finito(mogHoy?.sup); ind.mogalef_inferior = finito(mogHoy?.inf); ind.mogalef_centro = finito(mogHoy?.center);
  if (ind.mogalef_inferior === null) motivos.push(`mogalef: se necesitan ${P.mogalef_std} velas diarias y hay ${n}`);

  // --- Pivotes y niveles
  const ventana = diarias.slice(-P.pivote_ventana_velas);
  const piv = pivotes(ventana, P.pivote_velas_por_lado);

  // --- Señales (PCP-10, PCP-04, PLP-03)
  const senales: Senal[] = [];
  senales.push(
    ind.rsi14 === null
      ? { id: 'RSI_SOBREVENTA', cumplida: null, detalle: 'RSI(14) no disponible' }
      : { id: 'RSI_SOBREVENTA', cumplida: ind.rsi14 <= P.rsi_sobreventa, detalle: `RSI(14) diario = ${fmt(ind.rsi14)} (umbral ≤ ${P.rsi_sobreventa})` },
  );

  const lineas = [ind.koncorde_verde, ind.koncorde_marron, ind.koncorde_azul];
  if (lineas.some(v => v === null)) {
    senales.push({ id: 'KONCORDE_BAJO_CERO', cumplida: null, detalle: 'Koncorde no disponible' });
  } else {
    const bajo = lineas.some(v => (v as number) < 0);
    senales.push({
      id: 'KONCORDE_BAJO_CERO', cumplida: bajo,
      detalle: `Koncorde verde ${fmt(ind.koncorde_verde!)}, marrón ${fmt(ind.koncorde_marron!)}, azul ${fmt(ind.koncorde_azul!)} (cualquiera < 0; la línea media no cuenta)`,
    });
  }

  senales.push(
    ind.ema8 === null || ind.ema21 === null
      ? { id: 'EMA8_SOBRE_EMA21', cumplida: null, detalle: 'EMA 8 o EMA 21 no disponible' }
      : { id: 'EMA8_SOBRE_EMA21', cumplida: ind.ema8 > ind.ema21, detalle: `EMA8 ${fmt(ind.ema8)} vs EMA21 ${fmt(ind.ema21)} (estado actual, no cruce)` },
  );

  // Mogalef: la banda salta en la misma vela en que el cierre la rompe, así que se compara con la banda vigente de la vela anterior
  if (mogAyer?.inf == null) {
    senales.push({ id: 'MOGALEF_BANDA_INFERIOR', cumplida: null, detalle: 'Mogalef no disponible' });
  } else {
    senales.push({
      id: 'MOGALEF_BANDA_INFERIOR', cumplida: cierre <= mogAyer.inf,
      detalle: `Cierre ${fmt(cierre)} vs banda inferior vigente de la vela anterior ${fmt(mogAyer.inf)} (Mogalef ${P.mogalef_reg}, ${P.mogalef_std}, ${P.mogalef_mult})`,
    });
  }

  const tol = P.soporte_tolerancia_pct / 100;
  const cercanos = piv.bajos.filter(s => Math.abs(cierre - s.precio) <= s.precio * tol);
  senales.push(
    piv.bajos.length === 0
      ? { id: 'SOPORTE_PASADO', cumplida: null, detalle: 'No hay pivotes de soporte confirmados en la ventana' }
      : {
          id: 'SOPORTE_PASADO', cumplida: cercanos.length > 0,
          detalle: cercanos.length > 0
            ? `Cierre ${fmt(cierre)} a ±${P.soporte_tolerancia_pct}% del soporte ${fmt(cercanos[0]!.precio)} (${cercanos[0]!.fecha})`
            : `Cierre ${fmt(cierre)} no está a ±${P.soporte_tolerancia_pct}% de ningún soporte pasado`,
        },
  );

  const banana = semanales.length > 0
    ? evaluarBanana(semanales, P.banana_multiplo, P.banana_ventana_semanas, P.banana_velas_bajistas)
    : { cumplida: null, detalle: 'No evaluable: sin velas semanales válidas' };

  // --- Lista cerrada de niveles
  const crudos: { tipo: TipoNivel; precio: number; fecha: string | null }[] = [];
  if (ind.ema8 !== null) crudos.push({ tipo: 'ema8_diaria', precio: ind.ema8, fecha: null });
  if (ind.ema21 !== null) crudos.push({ tipo: 'ema21_diaria', precio: ind.ema21, fecha: null });
  if (ind.ema200_diaria !== null) crudos.push({ tipo: 'ema200_diaria', precio: ind.ema200_diaria, fecha: null });
  if (ind.sma200_semanal !== null) crudos.push({ tipo: 'sma200_semanal', precio: ind.sma200_semanal, fecha: null });

  const corte = ult.time - P.dias_52_semanas * 86400;
  if (diarias[0]!.time <= corte) {
    let max: Candle | null = null, min: Candle | null = null;
    for (const c of diarias) {
      if (c.time < corte) continue;
      if (!max || c.high > max.high) max = c;
      if (!min || c.low < min.low) min = c;
    }
    if (max) crudos.push({ tipo: 'maximo_52_semanas', precio: max.high, fecha: fechaDeVela(max.time) });
    if (min) crudos.push({ tipo: 'minimo_52_semanas', precio: min.low, fecha: fechaDeVela(min.time) });
  } else {
    motivos.push('extremos_52_semanas: el historial diario no cubre 52 semanas');
  }

  const soportes = piv.bajos.filter(s => s.precio < cierre).sort((a, b) => b.precio - a.precio).slice(0, P.pivotes_por_lado_del_precio);
  const resistencias = piv.altos.filter(r => r.precio > cierre).sort((a, b) => a.precio - b.precio).slice(0, P.pivotes_por_lado_del_precio);
  soportes.forEach(s => crudos.push({ tipo: 'pivote_soporte', precio: s.precio, fecha: s.fecha }));
  resistencias.forEach(r => crudos.push({ tipo: 'pivote_resistencia', precio: r.precio, fecha: r.fecha }));

  crudos.sort((a, b) => b.precio - a.precio);
  const niveles: NivelCalculado[] = crudos.map((c, i) => ({ id: `n${i + 1}`, tipo: c.tipo, precio: fmt(c.precio), fecha_origen: c.fecha }));

  const ultSem = ultimo(semanales);
  return {
    estado: motivos.length === 0 ? 'completo' : 'parcial',
    motivos, ticker: e.ticker, fecha_evaluacion: e.fecha_evaluacion, fuente: e.fuente,
    ultima_vela_diaria: { fecha: fechaDeVela(ult.time), cierre: fmt(cierre) },
    ultima_vela_semanal: ultSem ? { fecha: fechaDeVela(ultSem.time), cierre: fmt(ultSem.close) } : null,
    velas_usadas: { diarias: n, semanales: semanales.length },
    indicadores: ind,
    cierre_sobre_ema200_diaria: ind.ema200_diaria === null ? null : cierre > ind.ema200_diaria,
    cierre_sobre_sma200_semanal: ind.sma200_semanal === null ? null : cierre > ind.sma200_semanal,
    senales, banana, niveles_calculados: niveles, parametros: { ...P },
  };
}
