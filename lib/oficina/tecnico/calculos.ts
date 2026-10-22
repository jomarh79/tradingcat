import type { Banana, Candle } from './tipos';

/** Número -> cadena decimal con hasta 4 decimales, sin ceros sobrantes. */
export function fmt(n: number): string {
  const s = n.toFixed(4);
  return s.indexOf('.') >= 0 ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/** Fecha civil del exchange (TradingCat guarda la hora del exchange como si fuera UTC). */
export function fechaDeVela(time: number): string {
  return new Date(time * 1000).toISOString().slice(0, 10);
}

export function finito(x: unknown): number | null {
  return typeof x === 'number' && isFinite(x) ? x : null;
}

/** Valida velas: números finitos, high >= low, open/close dentro del rango, tiempo estrictamente creciente. */
export function validarVelas(velas: Candle[]): string | null {
  for (let i = 0; i < velas.length; i++) {
    const c = velas[i]!;
    if (![c.time, c.open, c.high, c.low, c.close, c.volume].every(v => typeof v === 'number' && isFinite(v))) {
      return `vela ${i}: valor no numérico`;
    }
    if (c.high < c.low || c.open > c.high || c.open < c.low || c.close > c.high || c.close < c.low) {
      return `vela ${i} (${fechaDeVela(c.time)}): precios incoherentes (máximo/mínimo/apertura/cierre)`;
    }
    if (i > 0 && c.time <= velas[i - 1]!.time) {
      return `vela ${i} (${fechaDeVela(c.time)}): fechas repetidas o fuera de orden`;
    }
  }
  return null;
}

/** ATR de Wilder. null hasta que hay `period` rangos verdaderos (índice `period`). */
export function atrSeries(velas: Candle[], period = 14): (number | null)[] {
  const n = velas.length;
  const out: (number | null)[] = new Array(n).fill(null);
  if (n <= period) return out;
  const tr = (i: number) => {
    const c = velas[i]!, p = velas[i - 1]!;
    return Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
  };
  let atr = 0;
  for (let i = 1; i <= period; i++) atr += tr(i);
  atr /= period;
  out[period] = atr;
  for (let i = period + 1; i < n; i++) {
    atr = (atr * (period - 1) + tr(i)) / period;
    out[i] = atr;
  }
  return out;
}

export interface Pivote { indice: number; fecha: string; precio: number }

/** Pivotes fractales: un máximo (mínimo) es pivote si es estrictamente mayor (menor) que las `n` velas
 *  de cada lado. Solo se confirman con `n` velas posteriores: la última `n` velas nunca son pivote. [PROPUESTA] */
export function pivotes(velas: Candle[], n = 5): { altos: Pivote[]; bajos: Pivote[] } {
  const altos: Pivote[] = [], bajos: Pivote[] = [];
  for (let i = n; i < velas.length - n; i++) {
    const c = velas[i]!;
    let alto = true, bajo = true;
    for (let j = i - n; j <= i + n && (alto || bajo); j++) {
      if (j === i) continue;
      const v = velas[j]!;
      if (v.high >= c.high) alto = false;
      if (v.low <= c.low) bajo = false;
    }
    if (alto) altos.push({ indice: i, fecha: fechaDeVela(c.time), precio: c.high });
    if (bajo) bajos.push({ indice: i, fecha: fechaDeVela(c.time), precio: c.low });
  }
  return { altos, bajos };
}

export type LadoBanda = 'superior' | 'inferior';

export interface RachaRuptura {
  /** Cierres consecutivos, terminando en la última vela, que rompen la banda de la vela anterior. 0 = la última vela no rompe. */
  dias: number;
  /** Fecha de la vela de la primera ruptura de la racha; null si dias = 0. */
  fecha_inicio: string | null;
  /** true si la vela anterior al inicio de la racha se pudo evaluar y no rompía (la racha está completa);
   *  false si las bandas no alcanzan para saberlo (la racha pudo empezar antes). */
  inicio_confirmado: boolean;
}

/** Racha de rupturas de una banda de Mogalef. Ruptura en la vela i: cierre[i] > banda[i-1] (superior) o cierre[i] < banda[i-1] (inferior),
 *  estricta y contra la banda vigente de la vela anterior. La racha termina en la última vela: una vela que no rompe la cierra y la
 *  siguiente ruptura inicia otra (rearme). null si la última vela no se puede evaluar (no hay banda de la vela anterior). */
export function rachaRuptura(velas: Candle[], banda: (number | null)[], lado: LadoBanda): RachaRuptura | null {
  const n = velas.length;
  const rompe = (i: number): boolean | null => {
    if (i < 1) return null;
    const b = banda[i - 1];
    if (b === null || b === undefined) return null;
    const c = velas[i]!.close;
    return lado === 'superior' ? c > b : c < b;
  };
  const hoy = rompe(n - 1);
  if (hoy === null) return null;
  if (!hoy) return { dias: 0, fecha_inicio: null, inicio_confirmado: true };
  let inicio = n - 1;
  let previa = rompe(inicio - 1);
  while (previa === true) {
    inicio--;
    previa = rompe(inicio - 1);
  }
  return { dias: n - inicio, fecha_inicio: fechaDeVela(velas[inicio]!.time), inicio_confirmado: previa === false };
}

/** Sobrecompra técnica de la salida del PCP: RSI(14) diario >= umbral (el 70 cuenta). null si no hay RSI: nunca se rellena con false. */
export function rsiSobrecompra(rsi: number | null, umbral: number): boolean | null {
  return rsi === null ? null : rsi >= umbral;
}

/** Margen para el error de coma flotante al comparar contra el borde de la tolerancia (por ejemplo 20.3 - 20 = 0.3000000000000007).
 *  Es mucho menor que cualquier diferencia real entre precios; solo evita que un cierre exactamente en el 1.5% quede fuera. */
const EPS_BORDE = 1e-9;

/** Pivote más cercano al cierre dentro de ±tolerancia (fracción del precio del pivote, 0.015 = 1.5%; el borde cuenta: ≤). null si ninguno entra.
 *  Con dos a igual distancia gana el más antiguo. Se evalúa contra la lista completa que se le pasa, no solo contra los 3 de la lista cerrada. */
export function pivoteCercano(cierre: number, lista: Pivote[], tolerancia: number): Pivote | null {
  let mejor: Pivote | null = null;
  let mejorDist = Infinity;
  for (const p of lista) {
    const dif = Math.abs(cierre - p.precio);
    if (dif > p.precio * tolerancia + EPS_BORDE) continue;
    const dist = p.precio === 0 ? 0 : dif / p.precio;
    if (dist < mejorDist) { mejor = p; mejorDist = dist; }
  }
  return mejor;
}

/** Banana de Semilla (SEM-07). [PROPUESTA de lectura; el umbral 2x está pendiente de Backtesting.]
 *  Ventana = las 52 semanas anteriores a las 3 últimas velas semanales.
 *  Pico = máximo (high) de la ventana. Mínimo previo = mínimo (low) de la ventana ANTES del pico.
 *  Banana = pico >= multiplo x mínimo previo, y las 3 últimas velas semanales son bajistas (cierre < apertura). */
export function evaluarBanana(semanales: Candle[], multiplo = 2, ventana = 52, bajistas = 3): Banana {
  const n = semanales.length;
  const necesarias = ventana + bajistas;
  if (n < necesarias) {
    return { cumplida: null, detalle: `No evaluable: hay ${n} velas semanales y se necesitan ${necesarias} (${ventana} de ventana + ${bajistas} bajistas)` };
  }
  const ini = n - necesarias, fin = n - bajistas - 1;       // ventana = [ini, fin]
  let p = ini;
  for (let i = ini; i <= fin; i++) if (semanales[i]!.high > semanales[p]!.high) p = i;
  if (p === ini) {
    return { cumplida: null, detalle: 'No evaluable: el máximo cae en la primera semana de la ventana; no hay semanas previas para fijar el mínimo' };
  }
  let min = Infinity;
  for (let i = ini; i < p; i++) if (semanales[i]!.low < min) min = semanales[i]!.low;
  const pico = semanales[p]!.high;
  const veces = pico / min;
  const ultimas = semanales.slice(n - bajistas);
  const bajistasOk = ultimas.every(c => c.close < c.open);
  const cumple = pico >= multiplo * min && bajistasOk;
  return {
    cumplida: cumple,
    detalle: `Pico ${fmt(pico)} (${fechaDeVela(semanales[p]!.time)}) vs mínimo previo ${fmt(min)}: ${fmt(veces)}x (umbral ${multiplo}x); últimas ${bajistas} velas semanales ${bajistasOk ? 'todas bajistas' : 'no todas bajistas'}`,
    pico_fecha: fechaDeVela(semanales[p]!.time),
    pico_maximo: fmt(pico),
    minimo_previo: fmt(min),
    multiplo: fmt(veces),
  };
}
