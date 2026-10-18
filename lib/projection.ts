// Proyección a corto plazo para el gráfico (todas las temporalidades).
// Tendencia (regresión ponderada) + cono de volatilidad + filtro de régimen (ADX).
// Es una extrapolación estadística, NO una predicción.

import { adxSeries, type Candle } from './indicators'

export type ProjectionInterval = '45min' | '1day' | '1week' | '1month'

export const PROJECTION_BARS = 5      // velas hacia adelante
export const PROJECTION_SAMPLE = 30   // cierres reales usados en la regresión
export const HALF_LIFE = 10           // velas: el peso de una vela se reduce a la mitad cada 10 velas atrás
export const ADX_FLAT = 18            // ADX <= 18  → sin tendencia: pendiente = 0
export const ADX_FULL = 25            // ADX >= 25  → tendencia clara: pendiente completa (entre 18 y 25 se atenúa gradualmente)

const DAY = 86400

// Regresión lineal PONDERADA (WLS) sobre los últimos `sample` cierres: las velas recientes pesan más.
// Peso de la vela i = 0.5^(antigüedad / HALF_LIFE). Devuelve la pendiente (precio por vela) o null.
export function trendSlope(closes: number[], sample = PROJECTION_SAMPLE, halfLife = HALF_LIFE): number | null {
  const ys = closes.slice(-sample).filter(v => Number.isFinite(v))
  const n = ys.length
  if (n < Math.min(sample, 5)) return null

  let sw = 0, swx = 0, swy = 0, swxy = 0, swxx = 0
  for (let i = 0; i < n; i++) {
    const w = Math.pow(0.5, (n - 1 - i) / halfLife)
    sw += w; swx += w * i; swy += w * ys[i]; swxy += w * i * ys[i]; swxx += w * i * i
  }
  const den = sw * swxx - swx * swx
  return den === 0 ? null : (sw * swxy - swx * swy) / den
}

// Desviación estándar de los cambios de cierre a cierre (precio por vela) en la muestra.
export function stepSigma(closes: number[], sample = PROJECTION_SAMPLE): number | null {
  const ys = closes.slice(-sample).filter(v => Number.isFinite(v))
  if (ys.length < 6) return null
  const d: number[] = []
  for (let i = 1; i < ys.length; i++) d.push(ys[i] - ys[i - 1])
  const mean = d.reduce((a, b) => a + b, 0) / d.length
  const variance = d.reduce((a, b) => a + (b - mean) ** 2, 0) / (d.length - 1)
  return Math.sqrt(variance)
}

// Factor 0..1 según la fuerza de tendencia (ADX): rango lateral → 0, tendencia clara → 1.
export function regimeFactor(adx: number | null): number {
  if (adx == null || !Number.isFinite(adx)) return 1
  return Math.min(1, Math.max(0, (adx - ADX_FLAT) / (ADX_FULL - ADX_FLAT)))
}

// `time` de la API es Unix en segundos con la fecha/hora del exchange tomada como UTC,
// por eso todo se calcula con métodos UTC (no depende de la zona horaria del navegador).
const isWeekend = (t: number) => {
  const d = new Date(t * 1000).getUTCDay() // 0 = domingo, 6 = sábado
  return d === 0 || d === 6
}

// Diario: siguientes días hábiles (no contempla feriados de bolsa)
function nextDaily(last: number, n: number): number[] {
  const out: number[] = []
  let t = last
  while (out.length < n) {
    t += DAY
    if (!isWeekend(t)) out.push(t)
  }
  return out
}

// Semanal: +7 días por vela
function nextWeekly(last: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => last + (i + 1) * 7 * DAY)
}

// Mensual: mismo día del mes siguiente (ajustado si el mes es más corto)
function nextMonthly(last: number, n: number): number[] {
  const d = new Date(last * 1000)
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate()
  const sod = last % DAY // hora del día por si acaso
  return Array.from({ length: n }, (_, i) => {
    const daysInMonth = new Date(Date.UTC(y, m + i + 2, 0)).getUTCDate()
    return Date.UTC(y, m + i + 1, Math.min(day, daysInMonth)) / 1000 + sod
  })
}

// 45 min: se copia la "plantilla" de horarios de la sesión a partir de las propias velas
// (el día reciente con más velas) y se recorre hacia adelante saltando fines de semana.
function nextIntraday(candles: { time: number }[], n: number): number[] {
  const byDay = new Map<number, number[]>()
  for (const c of candles.slice(-400)) {
    const day = Math.floor(c.time / DAY) * DAY
    const arr = byDay.get(day) ?? []
    arr.push(c.time - day)
    byDay.set(day, arr)
  }
  const recent = Array.from(byDay.entries()).slice(-6)
  if (!recent.length) return []
  const template = recent.reduce((best, cur) => (cur[1].length > best[1].length ? cur : best))[1]
    .slice().sort((a, b) => a - b)

  const last = candles[candles.length - 1].time
  let day = Math.floor(last / DAY) * DAY
  const lastSod = last - day
  const out: number[] = []

  // resto de la sesión actual
  for (const sod of template) {
    if (sod > lastSod && out.length < n) out.push(day + sod)
  }
  // sesiones siguientes
  while (out.length < n) {
    day += DAY
    if (isWeekend(day)) continue
    for (const sod of template) if (out.length < n) out.push(day + sod)
  }
  return out
}

export function nextTimes(
  candles: { time: number }[],
  interval: ProjectionInterval,
  n = PROJECTION_BARS,
): number[] {
  if (!candles.length) return []
  const last = candles[candles.length - 1].time
  switch (interval) {
    case '45min':  return nextIntraday(candles, n)
    case '1week':  return nextWeekly(last, n)
    case '1month': return nextMonthly(last, n)
    default:       return nextDaily(last, n)
  }
}

export type ProjPoint = { time: number; value: number }
export interface Projection {
  center: ProjPoint[]   // línea central (tendencia atenuada por el régimen)
  upper1: ProjPoint[]   // +1σ
  lower1: ProjPoint[]   // -1σ
  upper2: ProjPoint[]   // +2σ
  lower2: ProjPoint[]   // -2σ
  info: { adx: number | null; factor: number; sigma: number; slope: number }
}

// Arma la proyección. Todas las líneas arrancan en el último cierre real (sin hueco ni salto).
// Cono: ±z·σ·√k  (σ = desviación de los cambios por vela; la incertidumbre crece con la raíz de k).
export function buildProjection(
  candles: Candle[],
  interval: ProjectionInterval,
  bars = PROJECTION_BARS,
  sample = PROJECTION_SAMPLE,
): Projection | null {
  if (candles.length < 10) return null
  const closes = candles.map(c => c.close)
  const slope = trendSlope(closes, sample)
  const sigma = stepSigma(closes, sample)
  if (slope === null || sigma === null) return null

  const times = nextTimes(candles, interval, bars)
  if (times.length < bars) return null

  // ADX sobre las últimas 300 velas (suficiente para que el suavizado de Wilder converja)
  const adxLast = adxSeries(candles.slice(-300)).at(-1)?.adx ?? null
  const factor = regimeFactor(adxLast)
  const effSlope = slope * factor

  const last = candles[candles.length - 1]
  const make = (f: (k: number) => number): ProjPoint[] => [
    { time: last.time, value: last.close },
    ...times.map((time, i) => ({ time, value: f(i + 1) })),
  ]

  return {
    center: make(k => last.close + effSlope * k),
    upper1: make(k => last.close + effSlope * k + sigma * Math.sqrt(k)),
    lower1: make(k => last.close + effSlope * k - sigma * Math.sqrt(k)),
    upper2: make(k => last.close + effSlope * k + 2 * sigma * Math.sqrt(k)),
    lower2: make(k => last.close + effSlope * k - 2 * sigma * Math.sqrt(k)),
    info: { adx: adxLast, factor, sigma, slope },
  }
}