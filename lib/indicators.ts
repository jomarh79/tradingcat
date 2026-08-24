export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number }

function emaArr(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = []
  let prev: number | null = null
  const k = 2 / (period + 1)
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { out.push(null); continue }
    if (prev === null) {
      prev = values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period
    } else {
      prev = values[i] * k + prev * (1 - k)
    }
    out.push(prev)
  }
  return out
}

// ── RSI (suavizado de Wilder) ────────────────────────────────────────────
export function rsiSeries(candles: Candle[], period = 14) {
  const closes = candles.map(c => c.close)
  const n = closes.length
  const out: (number | null)[] = new Array(n).fill(null)
  if (n <= period) return candles.map(c => ({ time: c.time, value: null as number | null }))

  let avgGain = 0, avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1]
    if (d > 0) avgGain += d; else avgLoss += Math.abs(d)
  }
  avgGain /= period; avgLoss /= period
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)

  for (let i = period + 1; i < n; i++) {
    const d = closes[i] - closes[i - 1]
    const gain = d > 0 ? d : 0
    const loss = d < 0 ? Math.abs(d) : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return candles.map((c, i) => ({ time: c.time, value: out[i] }))
}

// ── MACD (12/26/9) ────────────────────────────────────────────────────────
export function macdSeries(candles: Candle[], fast = 12, slow = 26, signalPeriod = 9) {
  const closes = candles.map(c => c.close)
  const fastEma = emaArr(closes, fast)
  const slowEma = emaArr(closes, slow)
  const macdLine = closes.map((_, i) => (fastEma[i] != null && slowEma[i] != null) ? (fastEma[i]! - slowEma[i]!) : null)
  const signalRaw = emaArr(macdLine.map(v => v ?? 0), signalPeriod)
  const signal = macdLine.map((v, i) => (v == null ? null : signalRaw[i]))
  const hist = macdLine.map((v, i) => (v != null && signal[i] != null) ? v - (signal[i] as number) : null)
  return candles.map((c, i) => ({ time: c.time, macd: macdLine[i], signal: signal[i], hist: hist[i] }))
}

// ── ADX / +DI / -DI (14, suavizado de Wilder) ───────────────────────────
export function adxSeries(candles: Candle[], period = 14) {
  const n = candles.length
  const plusDM = new Array(n).fill(0)
  const minusDM = new Array(n).fill(0)
  const tr = new Array(n).fill(0)

  for (let i = 1; i < n; i++) {
    const upMove = candles[i].high - candles[i - 1].high
    const downMove = candles[i - 1].low - candles[i].low
    plusDM[i] = (upMove > downMove && upMove > 0) ? upMove : 0
    minusDM[i] = (downMove > upMove && downMove > 0) ? downMove : 0
    tr[i] = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    )
  }

  const wilderSmooth = (arr: number[]) => {
    const out = new Array(n).fill(NaN)
    let sum = 0
    for (let i = 1; i <= period; i++) sum += arr[i] || 0
    out[period] = sum
    for (let i = period + 1; i < n; i++) out[i] = out[i - 1] - out[i - 1] / period + arr[i]
    return out
  }

  const trSm = wilderSmooth(tr)
  const plusDMSm = wilderSmooth(plusDM)
  const minusDMSm = wilderSmooth(minusDM)

  const plusDI: (number | null)[] = new Array(n).fill(null)
  const minusDI: (number | null)[] = new Array(n).fill(null)
  const dx: (number | null)[] = new Array(n).fill(null)

  for (let i = period; i < n; i++) {
    if (!trSm[i]) continue
    plusDI[i] = (plusDMSm[i] / trSm[i]) * 100
    minusDI[i] = (minusDMSm[i] / trSm[i]) * 100
    const sum = (plusDI[i] as number) + (minusDI[i] as number)
    dx[i] = sum > 0 ? Math.abs((plusDI[i] as number) - (minusDI[i] as number)) / sum * 100 : 0
  }

  const adx: (number | null)[] = new Array(n).fill(null)
  let seed = 0, count = 0
  for (let i = period; i < period * 2 && i < n; i++) {
    if (dx[i] != null) { seed += dx[i] as number; count++ }
  }
  if (count > 0 && period * 2 - 1 < n) adx[period * 2 - 1] = seed / count
  for (let i = period * 2; i < n; i++) {
    if (adx[i - 1] != null && dx[i] != null) {
      adx[i] = ((adx[i - 1] as number) * (period - 1) + (dx[i] as number)) / period
    }
  }

  return candles.map((c, i) => ({ time: c.time, adx: adx[i], plusDI: plusDI[i], minusDI: minusDI[i] }))
}

// ── Koncorde (PVI/NVI + MFI + Oscilador de Bollinger + RSI, combinados) ──
export function koncordeSeries(candles: Candle[]) {
  const n = candles.length
  const closes = candles.map(c => c.close)
  const volumes = candles.map(c => c.volume || 0)
  const hlc3 = candles.map(c => (c.high + c.low + c.close) / 3)
  const tprice = candles.map(c => (c.open + c.high + c.low + c.close) / 4)

  // PVI / NVI
  const pvi = new Array(n).fill(1000)
  const nvi = new Array(n).fill(1000)
  for (let i = 1; i < n; i++) {
    const chg = closes[i - 1] !== 0 ? (closes[i] - closes[i - 1]) / closes[i - 1] : 0
    if (volumes[i] > volumes[i - 1]) { pvi[i] = pvi[i - 1] * (1 + chg); nvi[i] = nvi[i - 1] }
    else { nvi[i] = nvi[i - 1] * (1 + chg); pvi[i] = pvi[i - 1] }
  }

  const m = 15
  const pvim = emaArr(pvi, m).map((v, i) => v ?? pvi[i])
  const nvim = emaArr(nvi, m).map((v, i) => v ?? nvi[i])

  const rollingMinMax = (arr: number[], win: number) => {
    const mins: number[] = [], maxs: number[] = []
    for (let i = 0; i < arr.length; i++) {
      const slice = arr.slice(Math.max(0, i - win + 1), i + 1)
      mins.push(Math.min(...slice)); maxs.push(Math.max(...slice))
    }
    return { mins, maxs }
  }
  const { mins: pvimMin, maxs: pvimMax } = rollingMinMax(pvim, 90)
  const { mins: nvimMin, maxs: nvimMax } = rollingMinMax(nvim, 90)

  const oscp = pvi.map((v, i) => (pvimMax[i] - pvimMin[i]) !== 0 ? (v - pvim[i]) * 100 / (pvimMax[i] - pvimMin[i]) : 0)
  const azul = nvi.map((v, i) => (nvimMax[i] - nvimMin[i]) !== 0 ? (v - nvim[i]) * 100 / (nvimMax[i] - nvimMin[i]) : 0)

  // MFI (14)
  const mfiPeriod = 14
  const xmf = new Array(n).fill(50)
  for (let i = mfiPeriod; i < n; i++) {
    let pos = 0, neg = 0
    for (let j = i - mfiPeriod + 1; j <= i; j++) {
      if (j === 0) continue
      const chg = hlc3[j] - hlc3[j - 1]
      const mf = volumes[j] * hlc3[j]
      if (chg > 0) pos += mf; else if (chg < 0) neg += mf
    }
    xmf[i] = neg === 0 ? 100 : 100 - 100 / (1 + pos / neg)
  }

  // Oscilador de Bollinger (25, 2 desviaciones) sobre precio OHLC4
  const bollPeriod = 25
  const bollOsc = new Array(n).fill(0)
  for (let i = bollPeriod - 1; i < n; i++) {
    const slice = tprice.slice(i - bollPeriod + 1, i + 1)
    const basis = slice.reduce((a, b) => a + b, 0) / bollPeriod
    const variance = slice.reduce((a, b) => a + (b - basis) ** 2, 0) / bollPeriod
    const dev = 2 * Math.sqrt(variance)
    const upper = basis + dev, lower = basis - dev
    bollOsc[i] = (upper - lower) !== 0 ? (tprice[i] - (upper + lower) / 2) / (upper - lower) * 100 : 0
  }

  // RSI(14) sobre OHLC4, como en el Koncorde original (no es el mismo RSI del panel aparte)
  const rsiOnTprice = new Array(n).fill(50)
  if (n > 14) {
    let avgGain = 0, avgLoss = 0
    for (let i = 1; i <= 14; i++) {
      const d = tprice[i] - tprice[i - 1]
      if (d > 0) avgGain += d; else avgLoss += Math.abs(d)
    }
    avgGain /= 14; avgLoss /= 14
    rsiOnTprice[14] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
    for (let i = 15; i < n; i++) {
      const d = tprice[i] - tprice[i - 1]
      const g = d > 0 ? d : 0, l = d < 0 ? Math.abs(d) : 0
      avgGain = (avgGain * 13 + g) / 14
      avgLoss = (avgLoss * 13 + l) / 14
      rsiOnTprice[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
    }
  }

  const marron = xmf.map((mf, i) => (rsiOnTprice[i] + mf + bollOsc[i]) / 2)
  const verde = marron.map((v, i) => v + oscp[i])
  const media = emaArr(marron, m).map((v, i) => v ?? marron[i])

  return candles.map((c, i) => ({ time: c.time, verde: verde[i], marron: marron[i], azul: azul[i], media: media[i] }))
}

export interface CandlePatternMarker {
  time: number
  position: 'aboveBar' | 'belowBar'
  color: string
  shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square'
  text: string
}

function bodySize(c: { open: number; close: number }) {
  return Math.abs(c.close - c.open)
}
function upperWick(c: { open: number; high: number; close: number }) {
  return c.high - Math.max(c.open, c.close)
}
function lowerWick(c: { open: number; low: number; close: number }) {
  return Math.min(c.open, c.close) - c.low
}
function range(c: { high: number; low: number }) {
  return c.high - c.low
}
function isBullish(c: { open: number; close: number }) {
  return c.close > c.open
}
function isBearish(c: { open: number; close: number }) {
  return c.close < c.open
}

// Estrella de la mañana / vespertina, envolventes, martillo y doji.
// Usa el tamaño promedio de cuerpo de las últimas 14 velas para calibrar
// qué cuenta como "vela grande" o "vela pequeña" (evita falsos positivos
// en valores con velas naturalmente chicas o naturalmente grandes).
export function detectCandlePatterns(
  candles: { time: number; open: number; high: number; low: number; close: number }[]
): CandlePatternMarker[] {
  const markers: CandlePatternMarker[] = []
  if (candles.length < 3) return markers

  const avgBody = (i: number, period = 14) => {
    const start = Math.max(0, i - period)
    const slice = candles.slice(start, i)
    if (!slice.length) return bodySize(candles[i])
    return slice.reduce((sum, c) => sum + bodySize(c), 0) / slice.length
  }


  // ── Envolventes (2 velas) — exige cuerpo dominante, mechas cortas ──
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1]
    const curr = candles[i]
    const wickTotal = upperWick(curr) + lowerWick(curr)
    const solidBody = bodySize(curr) > wickTotal // el cuerpo manda, no la mecha — descarta martillo/doji

    if (
      isBearish(prev) && isBullish(curr) &&
      curr.open <= prev.close && curr.close >= prev.open &&
      bodySize(curr) > bodySize(prev) &&
      solidBody
    ) {
      markers.push({ time: curr.time, position: 'belowBar', color: '#22c55e', shape: 'circle', text: '' })
    }

    if (
      isBullish(prev) && isBearish(curr) &&
      curr.open >= prev.close && curr.close <= prev.open &&
      bodySize(curr) > bodySize(prev) &&
      solidBody
    ) {
      markers.push({ time: curr.time, position: 'aboveBar', color: '#f43f5e', shape: 'circle', text: '' })
    }
  }

  // ── Martillo / martillo invertido (1 vela) ──
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]
    const body = bodySize(c)
    const upper = upperWick(c)
    const lower = lowerWick(c)
    if (body <= 0) continue

    // Martillo: mecha inferior larga, mecha superior corta, cuerpo chico arriba del rango
    if (lower >= body * 2 && upper <= body * 0.5) {
      markers.push({ time: c.time, position: 'belowBar', color: '#a3e635', shape: 'square', text: '' })
    }
    // Martillo invertido / estrella fugaz: mecha superior larga, mecha inferior corta
    if (upper >= body * 2 && lower <= body * 0.5) {
      markers.push({ time: c.time, position: 'aboveBar', color: '#fb923c', shape: 'square', text: '' })
    }
  }

  // ── Doji (1 vela) — cuerpo casi inexistente frente al rango total ──
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]
    const r = range(c)
    if (r <= 0) continue
    if (bodySize(c) <= r * 0.08) {
      markers.push({ time: c.time, position: 'aboveBar', color: '#eab308', shape: 'circle', text: '' })
    }
  }

  return markers.sort((a, b) => a.time - b.time)
}