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
