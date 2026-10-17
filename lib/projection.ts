// Proyección lineal a corto plazo para el gráfico (solo diario).
// Es una extrapolación de la tendencia reciente, NO una predicción.

export const PROJECTION_DAYS = 5      // días hábiles hacia adelante
export const PROJECTION_SAMPLE = 15   // cierres reales usados en la regresión

const DAY_SECONDS = 86400

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

// Siguientes `days` días hábiles (salta sábado y domingo) a partir de `lastTime`.
// `time` de la API siempre es Unix en segundos con la fecha del exchange tomada como UTC,
// por eso se usa getUTCDay y se suman 86400 s (sin depender de la zona horaria del navegador).
// No contempla feriados de bolsa.
export function nextBusinessDays(lastTime: number, days = PROJECTION_DAYS): number[] {
  const out: number[] = []
  let t = lastTime
  while (out.length < days) {
    t += DAY_SECONDS
    const dow = new Date(t * 1000).getUTCDay() // 0 = domingo, 6 = sábado
    if (dow !== 0 && dow !== 6) out.push(t)
  }
  return out
}

// Puntos para una LineSeries: arranca en el último cierre real (sin hueco) y sigue la pendiente.
// Anclar al último cierre evita un salto artificial entre la última vela y el inicio de la línea.
export function projectionPoints(
  candles: { time: number; close: number }[],
  days = PROJECTION_DAYS,
  sample = PROJECTION_SAMPLE,
): { time: number; value: number }[] {
  if (!candles.length) return []
  const slope = trendSlope(candles.map(c => c.close), sample)
  if (slope === null) return []

  const last = candles[candles.length - 1]
  const times = nextBusinessDays(last.time, days)
  return [
    { time: last.time, value: last.close },
    ...times.map((time, i) => ({ time, value: last.close + slope * (i + 1) })),
  ]
}