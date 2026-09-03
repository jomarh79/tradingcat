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

// ... (Tus funciones matemáticas previas: rsiSeries, macdSeries, adxSeries, koncordeSeries quedan intactas)

export interface CandlePatternMarker {
  time: number
  position: 'aboveBar' | 'belowBar'
  color: string
  shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square'
  text: string
}

export interface MarketContext {
  // Fundamentales
  isUndervalued?: boolean

  // Tendencia
  isAboveEma200Day?: boolean
  isRecoveringEma200?: boolean

  // Ubicación
  isAtSupport?: boolean
  isAtResistance?: boolean

  // Momentum
  rsiBullish?: boolean
  rsiBearish?: boolean
  macdBullish?: boolean
  macdBearish?: boolean

  // Tendencia / fuerza
  trendBullish?: boolean
  trendBearish?: boolean

  // Flujo / Koncorde
  koncordeBullish?: boolean
  koncordeBearish?: boolean
}

interface SignalScore {
  score: number
  level: 'NONE' | 'AP' | 'AP_PLUS' | 'RC' | 'RC_STRONG'
}

function getBullishScore(
  context?: MarketContext,
  hasBullishPattern = false
): SignalScore {
  if (!context) {
    return {
      score: hasBullishPattern ? 2 : 0,
      level: 'NONE'
    }
  }

  let score = 0

  // Fundamentales
  if (context.isUndervalued) score += 2

  // Patrón de vela = trigger
  if (hasBullishPattern) score += 2

  // Ubicación
  if (context.isAtSupport) score += 2

  // Momentum
  if (context.rsiBullish) score += 2
  if (context.macdBullish) score += 1

  // Flujo / Koncorde
  if (context.koncordeBullish) score += 2

  // Tendencia
  if (context.isAboveEma200Day) score += 1
  if (context.isRecoveringEma200) score += 1
  if (context.trendBullish) score += 1

  let level: SignalScore['level'] = 'NONE'

  if (score >= 10) level = 'AP_PLUS'
  else if (score >= 7) level = 'AP'
  

  return { score, level }
}


function getBearishScore(
  context?: MarketContext,
  hasBearishPattern = false
): SignalScore {
  if (!context) {
    return {
      score: hasBearishPattern ? 2 : 0,
      level: 'NONE'
    }
  }

  let score = 0

  // Fundamentales
  if (context.isUndervalued === false) score += 2

  // Patrón de vela = trigger
  if (hasBearishPattern) score += 2

  // Ubicación
  if (context.isAtResistance) score += 2

  // Momentum
  if (context.rsiBearish) score += 2
  if (context.macdBearish) score += 1

  // Flujo / Koncorde
  if (context.koncordeBearish) score += 2

  // Tendencia
  if (context.isAboveEma200Day === false) score += 1
  if (context.trendBearish) score += 1

  let level: SignalScore['level'] = 'NONE'

  if (score >= 10) level = 'RC_STRONG'
  else if (score >= 7) level = 'RC'

  return { score, level }
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

export function detectCandlePatterns(
  candles: { time: number; open: number; high: number; low: number; close: number }[],
  context?: MarketContext
): CandlePatternMarker[] {
  const markers: CandlePatternMarker[] = []
  if (candles.length < 3) return markers

  const avgBody = (i: number, period = 14) => {
    const start = Math.max(0, i - period)
    const slice = candles.slice(start, i)
    if (!slice.length) return bodySize(candles[i])
    return slice.reduce((sum, c) => sum + bodySize(c), 0) / slice.length
  }

  // Filtros de Contexto Avanzado
  const getBullishLabel = () => {
  const result = getBullishScore(context, true)

  if (result.level === 'AP_PLUS') {
    return `🔥🔥 AP+`
  }

  if (result.level === 'AP') {
    return `🔥 AP`
  }


  return null
}


const getBearishLabel = () => {
  const result = getBearishScore(context, true)

  if (result.level === 'RC_STRONG') {
    return `🚨 RC+`
  }

  if (result.level === 'RC') {
    return `⚠️ RC`
  }


  return null
}

  const occupiedCandles = new Set<number>()

  // ── PASO 1: DETECTAR PATRONES COMPUESTOS FUERTES (3 y 2 Velas) ──
  for (let i = 2; i < candles.length; i++) {
    const pPrev = candles[i - 2]
    const prev = candles[i - 1]
    const curr = candles[i]
    
    const avg = avgBody(i)
    const isDownTrend = candles[i - 1].close < candles[Math.max(0, i - 3)].close
    const isUpTrend = candles[i - 1].close > candles[Math.max(0, i - 3)].close

    // A. Estrellas Doji de Reversión (3 velas)
    const rDoji = range(prev)
    const isDoji = rDoji > 0 && bodySize(prev) <= rDoji * 0.10
    
    if (isDoji) {
      const pPrevBig = bodySize(pPrev) > avg * 0.7
      const currBig = bodySize(curr) > avg * 0.7

      // Estrella de la Mañana Doji (Alcista)
      if (isBearish(pPrev) && pPrevBig && isBullish(curr) && currBig && curr.close > (pPrev.open + pPrev.close) / 2) {
        const signal = getBullishLabel()

const txt = signal
  ? `E. M. ${signal}`
  : 'E. M.'
        markers.push({ time: prev.time, position: 'belowBar', color: '#22c55e', shape: 'arrowUp', text: txt })
        occupiedCandles.add(pPrev.time); occupiedCandles.add(prev.time); occupiedCandles.add(curr.time)
        continue
      }

      // Estrella Vespertina Doji (Bajista)
      if (isBullish(pPrev) && pPrevBig && isBearish(curr) && currBig && curr.close < (pPrev.open + pPrev.close) / 2) {
        const signal = getBearishLabel()

const txt = signal
  ? `E. T. ${signal}`
  : 'E. T.'
        markers.push({ time: prev.time, position: 'aboveBar', color: '#ff0101', shape: 'arrowDown', text: txt })
        occupiedCandles.add(pPrev.time); occupiedCandles.add(prev.time); occupiedCandles.add(curr.time)
        continue
      }
    }

    // B. Envolventes (2 velas)
    const cutsPreviousBody = bodySize(curr) > bodySize(prev)
    const isBigCandle = bodySize(curr) > avg * 0.8

    // Envolvente Alcista
    if (isDownTrend && isBearish(prev) && isBullish(curr) && curr.close >= prev.open && curr.open <= prev.close && cutsPreviousBody && isBigCandle) {
      const signal = getBullishLabel()

const txt = signal
  ? `Env. A. ${signal}`
  : 'Env. A.'
      markers.push({ time: curr.time, position: 'belowBar', color: '#22c55e', shape: 'arrowUp', text: txt })
      occupiedCandles.add(prev.time); occupiedCandles.add(curr.time)
      continue
    }

    // Envolvente Bajista
    if (isUpTrend && isBullish(prev) && isBearish(curr) && curr.close <= prev.open && curr.open >= prev.close && cutsPreviousBody && isBigCandle) {
      const signal = getBearishLabel()

const txt = signal
  ? `Env. B. ${signal}`
  : 'Env. B.'
      markers.push({ time: curr.time, position: 'aboveBar', color: '#ff0101', shape: 'arrowDown', text: txt })
      occupiedCandles.add(prev.time); occupiedCandles.add(curr.time)
      continue
    }
  }

  // ── PASO 2: DETECTAR PATRONES INDIVIDUALES (Martillos) EN VELAS LIBRES ──
  for (let i = 2; i < candles.length; i++) {
    const c = candles[i]
    if (occupiedCandles.has(c.time)) continue

    const body = bodySize(c)
    const upper = upperWick(c)
    const lower = lowerWick(c)
    if (body <= 0) continue

    const isDownTrend = candles[i - 1].close < candles[Math.max(0, i - 3)].close
    const isUpTrend = candles[i - 1].close > candles[Math.max(0, i - 3)].close

    // 1. Cuerpo Arriba, Mecha Abajo (Martillo / Hombre Colgado)
    if (lower >= body * 2 && upper <= body * 0.5) {
      if (isDownTrend) {
        const signal = getBullishLabel()

const txt = signal
  ? `M. ${signal}`
  : 'M.'
        markers.push({ time: c.time, position: 'belowBar', color: '#22c55e', shape: 'arrowUp', text: txt })
      } else if (isUpTrend) {
        const signal = getBearishLabel()

const txt = signal
  ? `H. C. ${signal}`
  : 'H. C.'
        markers.push({ time: c.time, position: 'aboveBar', color: '#ff0101', shape: 'arrowDown', text: txt })
      }
    }

    // 2. Cuerpo Abajo, Mecha Arriba (Martillo Invertido / Estrella Fugaz)
    if (upper >= body * 2 && lower <= body * 0.5) {
      if (isDownTrend) {
        const signal = getBullishLabel()

const txt = signal
  ? `M. I. ${signal}`
  : 'M. I.'
        markers.push({ time: c.time, position: 'belowBar', color: '#22c55e', shape: 'arrowUp', text: txt })
      } else if (isUpTrend) {
        const signal = getBearishLabel()

const txt = signal
  ? `E. F. ${signal}`
  : 'E. F.'
        markers.push({ time: c.time, position: 'aboveBar', color: '#ff0101', shape: 'arrowDown', text: txt })
      }
    }
  }

  return markers.sort((a, b) => a.time - b.time)
}
