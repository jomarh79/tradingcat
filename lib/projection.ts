// Proyección lineal a corto plazo para el gráfico (todas las temporalidades).
// Es una extrapolación de la tendencia reciente, NO una predicción.

export type ProjectionInterval = '45min' | '1day' | '1week' | '1month'

export const PROJECTION_BARS = 5      // velas hacia adelante
export const PROJECTION_SAMPLE = 30   // cierres reales usados en la regresión

const DAY = 86400

// Regresión lineal por mínimos cuadrados sobre los últimos `sample` cierres.
// Devuelve la pendiente (precio por vela) o null si no hay datos suficientes.
export function trendSlope(closes: number[], sample = PROJECTION_SAMPLE): number | null {
  const ys = closes.slice(-sample).filter(v => Number.isFinite(v))
  const n = ys.length
  if (n < Math.min(sample, 5)) return null

  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0
  for (let i = 0; i < n; i++) {
    sumX += i; sumY += ys[i]; sumXY += i * ys[i]; sumXX += i * i
  }
  const den = n * sumXX - sumX * sumX
  return den === 0 ? null : (n * sumXY - sumX * sumY) / den
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

// Puntos para una LineSeries: arranca en el último cierre real (sin hueco) y sigue la pendiente.
// Anclar al último cierre evita un salto artificial entre la última vela y el inicio de la línea.
export function projectionPoints(
  candles: { time: number; close: number }[],
  interval: ProjectionInterval,
  bars = PROJECTION_BARS,
  sample = PROJECTION_SAMPLE,
): { time: number; value: number }[] {
  if (!candles.length) return []
  const slope = trendSlope(candles.map(c => c.close), sample)
  if (slope === null) return []

  const last = candles[candles.length - 1]
  const times = nextTimes(candles, interval, bars)
  if (times.length < bars) return []
  return [
    { time: last.time, value: last.close },
    ...times.map((time, i) => ({ time, value: last.close + slope * (i + 1) })),
  ]
}