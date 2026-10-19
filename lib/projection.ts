// Proyección a corto plazo para el gráfico (todas las temporalidades).
// Tendencia (regresión ponderada) + cono de volatilidad + filtro de régimen (ADX).
// Es una extrapolación estadística, NO una predicción.

import { adxSeries, type Candle } from './indicators'

export type ProjectionInterval = '45min' | '1day' | '1week' | '1month'

export const PROJECTION_BARS = 5      // velas hacia adelante
export const PROJECTION_SAMPLE = 30   // cierres reales usados en la regresión
export const HALF_LIFE = 10           // velas: el peso de una vela se reduce a la mitad cada 10 velas atrás
export const ADX_FLAT = 18            // ADX <= 18  → sin tendencia: pendiente = 0
export const EWMA_LAMBDA = 0.94       // volatilidad condicional (RiskMetrics): reacciona rápido a rachas de volatilidad
export const ATR_PERIOD = 14
export const ATR_TO_SIGMA = 1.6       // en un movimiento browniano el rango esperado de una vela ≈ 1.6σ
export const SKEW_BLEND = 0.5         // qué tanto se confía en la asimetría medida (0 = simétrico, 1 = completa)
export const SKEW_MIN = 0.8           // límites del sesgo para no distorsionar el cono con muestras chicas
export const SKEW_MAX = 1.25
export const LEVEL_PASS = 0.35        // de lo que la mecha se pasaría de un soporte/resistencia, solo se conserva el 35 %
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

export interface Volatility {
  sigma: number      // σ por vela que se usa en el cono = el mayor entre EWMA y ATR equivalente
  ewma: number       // σ condicional (EWMA) de los cambios de cierre
  atrSigma: number   // ATR(14) convertido a σ; incluye gaps y mechas reales
  upMul: number      // multiplicador de la mecha superior (asimetría)
  downMul: number    // multiplicador de la mecha inferior (asimetría)
}

// Volatilidad por vela a partir de las últimas velas.
//  · EWMA de los cambios de cierre (pondera más lo reciente → reacciona a cambios de volatilidad).
//  · ATR de Wilder (rango verdadero: incluye gaps y mechas) / 1.6.
//  · σ final = el mayor de los dos, para que las mechas no subestimen el rango real.
//  · Asimetría: semidesviaciones de los cambios SIN la tendencia (media removida), mezcladas
//    con 1 y acotadas, porque con ~30 datos la medición es ruidosa.
export function volatility(candles: Candle[], sample = PROJECTION_SAMPLE): Volatility | null {
  const recent = candles.slice(-sample).filter(c => Number.isFinite(c.close))
  if (recent.length < 6) return null

  const d: number[] = []
  for (let i = 1; i < recent.length; i++) d.push(recent[i].close - recent[i - 1].close)

  // EWMA
  const seedN = Math.min(10, d.length)
  let v = d.slice(0, seedN).reduce((a, x) => a + x * x, 0) / seedN
  for (let i = 0; i < d.length; i++) v = EWMA_LAMBDA * v + (1 - EWMA_LAMBDA) * d[i] * d[i]
  const ewma = Math.sqrt(v)

  // ATR de Wilder sobre las últimas 100 velas
  const tail = candles.slice(-100)
  const tr: number[] = []
  for (let i = 1; i < tail.length; i++) {
    const c = tail[i], pc = tail[i - 1].close
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc)))
  }
  let atr = 0
  if (tr.length >= ATR_PERIOD) {
    atr = tr.slice(0, ATR_PERIOD).reduce((a, x) => a + x, 0) / ATR_PERIOD
    for (let i = ATR_PERIOD; i < tr.length; i++) atr = (atr * (ATR_PERIOD - 1) + tr[i]) / ATR_PERIOD
  }
  const atrSigma = atr / ATR_TO_SIGMA

  const sigma = Math.max(ewma, atrSigma)
  if (!(sigma > 0)) return null

  // Asimetría
  const mean = d.reduce((a, x) => a + x, 0) / d.length
  let up2 = 0, dn2 = 0
  for (const x of d) { const e = x - mean; if (e > 0) up2 += e * e; else dn2 += e * e }
  const avg = Math.sqrt((up2 + dn2) / (2 * d.length))
  const raw = (x: number) => (avg > 0 ? Math.sqrt(x / d.length) / avg : 1)
  const mix = (r: number) => Math.min(SKEW_MAX, Math.max(SKEW_MIN, 1 + SKEW_BLEND * (r - 1)))

  return { sigma, ewma, atrSigma, upMul: mix(raw(up2)), downMul: mix(raw(dn2)) }
}

// Acota una mecha contra los niveles clave: lo que se pase de un nivel se comprime (no es un muro duro,
// porque los soportes/resistencias se rompen; solo se "desacelera" el cruce).
function softClamp(value: number, anchor: number, levels: number[], dir: 1 | -1): number {
  const level = dir === 1
    ? levels.filter(l => l > anchor).sort((a, b) => a - b)[0]
    : levels.filter(l => l < anchor).sort((a, b) => b - a)[0]
  if (level === undefined) return value
  const past = dir === 1 ? value - level : level - value
  if (past <= 0) return value
  return level + dir * past * LEVEL_PASS
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

export const PROJECTION_Z = 1   // alto/bajo de cada vela = tendencia ± Z desviaciones (1 ≈ 68 % de probabilidad)

export type ProjCandle = { time: number; open: number; high: number; low: number; close: number }
export interface Projection {
  candles: ProjCandle[]   // 5 velas proyectadas
  info: { adx: number | null; factor: number; slope: number } & Volatility
}

// Arma las velas proyectadas.
//  · Cuerpo: de la tendencia (atenuada por el régimen ADX) de la vela anterior a la de esta vela.
//  · Mecha superior = escenario optimista, mecha inferior = escenario pesimista:
//    tendencia ± Z·σ·√k, con σ = max(EWMA, ATR) y un sesgo según la asimetría de los cambios.
//  · Si se pasan `levels` (soportes/resistencias), las mechas se comprimen al cruzarlos.
// La primera vela abre en el último cierre real, así no hay hueco con las velas reales.
export function buildProjection(
  candles: Candle[],
  interval: ProjectionInterval,
  bars = PROJECTION_BARS,
  sample = PROJECTION_SAMPLE,
  z = PROJECTION_Z,
  levels: number[] = [],     // soportes/resistencias (opcional) para acotar las mechas
): Projection | null {
  if (candles.length < 10) return null
  const closes = candles.map(c => c.close)
  const slope = trendSlope(closes, sample)
  const vol = volatility(candles, sample)
  if (slope === null || vol === null) return null

  const times = nextTimes(candles, interval, bars)
  if (times.length < bars) return null

  // ADX sobre las últimas 300 velas (suficiente para que el suavizado de Wilder converja)
  const adxLast = adxSeries(candles.slice(-300)).at(-1)?.adx ?? null
  const factor = regimeFactor(adxLast)
  const effSlope = slope * factor

  const base = candles[candles.length - 1].close
  const out: ProjCandle[] = times.map((time, i) => {
    const k = i + 1
    const open = base + effSlope * (k - 1)
    const close = base + effSlope * k
    const reach = z * vol.sigma * Math.sqrt(k)
    const rawHigh = close + reach * vol.upMul
    const rawLow  = close - reach * vol.downMul
    return {
      time, open, close,
      high: Math.max(open, close, softClamp(rawHigh, close, levels, 1)),
      low:  Math.min(open, close, softClamp(rawLow,  close, levels, -1)),
    }
  })

  return { candles: out, info: { adx: adxLast, factor, slope, ...vol } }
}