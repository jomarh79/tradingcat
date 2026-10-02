'use client'

import { useEffect, useRef, useState, useMemo, Suspense, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  createChart, CandlestickSeries, HistogramSeries, LineSeries,
  createSeriesMarkers, ColorType, IChartApi,
} from 'lightweight-charts'
import { supabase } from '@/lib/supabase'
import { rsiSeries, macdSeries, adxSeries, koncordeSeries, detectCandlePatterns, mogalefBandsSeries } from '@/lib/indicators'
import AppShell from '../AppShell'
import { BarChart2 } from 'lucide-react'

import DividendsChart from '../components/DividendsChart'
import DividendYieldChart from '../components/DividendYieldChart'
import { RibbonSeries } from '@/lib/ribbonSeriesPlugin'

type Interval = '45min' | '1day' | '1week' | '1month'

const C = {
  accent: '#00bfff', success: '#22c55e', danger: '#f43f5e', warning: '#eab308',
  card: '#080808', border: '#1a1a1a',
}

const CHART_HEIGHT = 700
const RATIO_CHART_HEIGHT = 220

const INTERVALS: { value: Interval; label: string }[] = [
  { value: '45min', label: '45 min' },
  { value: '1day',  label: 'Diario' },
  { value: '1week', label: 'Semanal' },
  { value: '1month', label: 'Mensual' },
]

const MA_COLORS: Record<string, string> = {
  ema8: '#e5e5e5', ema21: '#eab308', ema50: '#3b82f6', ema100: '#f97316', ema200: '#f43f5e',
  sma10: '#e5e5e5', sma20: '#eab308', sma50: '#3b82f6', sma100: '#f97316', sma200: '#f43f5e',
}
const MA_LABELS: Record<string, string> = {
  ema8: 'EMA 8', ema21: 'EMA 21', ema50: 'EMA 50', ema100: 'EMA 100', ema200: 'EMA 200',
  sma10: 'SMA 10', sma20: 'SMA 20', sma50: 'SMA 50', sma100: 'SMA 100', sma200: 'SMA 200',
}
const EMA_KEYS = ['ema8', 'ema21', 'ema50', 'ema100', 'ema200']
const SMA_KEYS = ['sma10', 'sma20', 'sma50', 'sma100', 'sma200']

// EMA en 45min y diario; SMA en semanal y mensual
const maKeysFor = (iv: Interval) => (iv === '45min' || iv === '1day') ? EMA_KEYS : SMA_KEYS

const dayKey = (d: any) => String(d || '').split('T')[0].split(' ')[0]
// Fecha 'YYYY-MM-DD' → ms en UTC (todas las comparaciones de fechas usan la misma base)
const toMs = (d: any) => Date.parse(dayKey(d) + 'T00:00:00Z')

const isEtf = (name: string | undefined) => ['EFT', 'ETF'].includes((name || '').toUpperCase())

// Figura por grupo de portafolio — "EFT" es excepción por nombre, no por grupo
function getPortfolioBadge(name: string | undefined, grupo: string | undefined) {
  if (isEtf(name))         return { symbol: '◆', label: 'ETF' }
  if (grupo === 'corto')   return { symbol: '●', label: 'PCP · Corto plazo' }
  if (grupo === 'mediano') return { symbol: '▲', label: 'PMP · Mediano plazo' }
  return { symbol: '■', label: 'PLP · Largo plazo' }
}

// Forma del marcador según portafolio — el color/posición ya indican compra/venta,
// así que la forma queda libre para identificar de qué portafolio es cada operación.
function getPortfolioMarkerShape(name: string | undefined, grupo: string | undefined): 'circle' | 'square' | 'arrowUp' | 'arrowDown' {
  if (isEtf(name))         return 'arrowDown'
  if (grupo === 'corto')   return 'circle'
  if (grupo === 'mediano') return 'square'
  return 'arrowUp' // largo plazo — el más común, mantiene el aspecto de flecha original
}

// Soportes/resistencias por pivotes — solo se usa en vista semanal/mensual, igual que el Pine original
function computePivots(
  candles: { high: number; low: number }[],
  leftBars = 5, rightBars = 5, maxLevels = 5, minDistPercent = 5
) {
  const resistances: number[] = []
  const supports: number[] = []
  const isFarEnough = (level: number, arr: number[]) =>
    arr.every(ex => Math.abs(level - ex) / ex * 100 >= minDistPercent)

  for (let i = leftBars; i < candles.length - rightBars; i++) {
    let maxH = -Infinity, minL = Infinity
    for (let j = i - leftBars; j <= i + rightBars; j++) {
      if (candles[j].high > maxH) maxH = candles[j].high
      if (candles[j].low  < minL) minL = candles[j].low
    }
    const h = candles[i].high
    const l = candles[i].low

    if (h === maxH && isFarEnough(h, resistances)) {
      resistances.unshift(h)
      if (resistances.length > maxLevels) resistances.pop()
    }
    if (l === minL && isFarEnough(l, supports)) {
      supports.unshift(l)
      if (supports.length > maxLevels) supports.pop()
    }
  }
  return { resistances, supports }
}

// Busca el cierre más cercano a una fecha dada (± unos días, por si no coincide exacto con día de mercado)
function findNearestClose(dailyCloses: { date: string; close: number }[], targetDate: string): number | null {
  if (!dailyCloses || !dailyCloses.length) return null
  const target = toMs(targetDate)
  let best: { close: number; diff: number } | null = null
  for (const d of dailyCloses) {
    const diff = Math.abs(toMs(d.date) - target)
    if (!best || diff < best.diff) best = { close: d.close, diff }
  }
  // si el más cercano está a más de 10 días, no es confiable — mejor no usarlo
  return best && best.diff <= 10 * 86400000 ? best.close : null
}

interface OwnHistoryEntry {
  year: number
  endDate: string
  filedDate: string | null
  eps: number | null
  revenue: number | null
  sharesOutstanding: number | null
  dividendPerShare: number | null
  operatingCashFlow: number | null
  stockholdersEquity: number | null
}

interface RatioSet {
  pe: number | null; ps: number | null; pcf: number | null; pb: number | null
  payoutRatio: number | null; dividendYield: number | null
}

interface StatPoint { price: number; date: string }

interface DailyStats {
  max: StatPoint; min: StatPoint
  max5: StatPoint | null; min5: StatPoint | null
  max52: StatPoint | null; min52: StatPoint | null
  dailyCloses: { date: string; close: number }[]
}

interface Fundamentals extends RatioSet {
  sectorAvg: RatioSet | null
  peerCount: number
  companyName: string | null
  ownHistory: OwnHistoryEntry[]
}

interface ChartData { candles: any[]; mas: Record<string, any[]> }

// Promedio propio de 5 años — cruza cada 10-K con el precio de esa fecha (no aplica a ETFs, no presentan 10-K)
function computeOwnFiveYearAvg(
  ownHistory: OwnHistoryEntry[],
  dailyCloses: { date: string; close: number }[]
) {
  if (!ownHistory || !ownHistory.length || !dailyCloses || !dailyCloses.length) return null

  const perYear = ownHistory.map(h => {
    const price = findNearestClose(dailyCloses, h.endDate)
    if (!price) return null
    const pe = h.eps && h.eps !== 0 ? price / h.eps : null
    const ps = h.revenue && h.sharesOutstanding ? (price * h.sharesOutstanding) / h.revenue : null
    const pcf = h.operatingCashFlow && h.sharesOutstanding ? (price * h.sharesOutstanding) / h.operatingCashFlow : null
    const pb = h.stockholdersEquity && h.sharesOutstanding ? (price * h.sharesOutstanding) / h.stockholdersEquity : null
    const payoutRatio = h.dividendPerShare != null && h.eps ? (h.dividendPerShare / h.eps) * 100 : null
    const dividendYield = h.dividendPerShare != null ? (h.dividendPerShare / price) * 100 : null
    return { year: h.year, time: toMs(h.endDate) / 1000, pe, ps, pcf, pb, payoutRatio, dividendYield }
  }).filter((v): v is NonNullable<typeof v> => v !== null)
    .sort((a, b) => a.time - b.time)

  if (perYear.length === 0) return null

  const avg = (key: keyof RatioSet) => {
    const vals = perYear.map(p => p[key]).filter((v): v is number => typeof v === 'number')
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null
  }
  return {
    pe: avg('pe'), ps: avg('ps'), pcf: avg('pcf'), pb: avg('pb'),
    payoutRatio: avg('payoutRatio'), dividendYield: avg('dividendYield'),
    yearsUsed: perYear.length,
  }
}

// ── Series diarias de ratios de valuación (P/E, P/S, P/CF, P/B) ────────────
// Enfoque "función escalón": el precio se mueve todos los días (real, de dailyCloses),
// pero el fundamental (EPS, ventas, flujo de caja, capital contable) solo se actualiza
// una vez al año, en la fecha REAL de presentación del 10-K (filedDate) — no en el cierre
// del año fiscal (endDate), porque el mercado no conoce el número hasta que se presenta.
type RatioPoint = { time: number; value: number }

function computeDailyRatioSeries(
  ownHistory: OwnHistoryEntry[] | undefined,
  dailyCloses: { date: string; close: number }[] | undefined,
  years = 10
) {
  const empty: { pe: RatioPoint[]; ps: RatioPoint[]; pcf: RatioPoint[]; pb: RatioPoint[] } = { pe: [], ps: [], pcf: [], pb: [] }
  if (!ownHistory || !ownHistory.length || !dailyCloses || !dailyCloses.length) return empty

  const reports = ownHistory
    .map(h => ({ ...h, filedTime: toMs(h.filedDate || h.endDate) }))
    .filter(h => !isNaN(h.filedTime))
    .sort((a, b) => a.filedTime - b.filedTime)

  if (!reports.length) return empty

  const cutoff = Date.now() - years * 365 * 24 * 60 * 60 * 1000

  const closes = dailyCloses
    .map(c => {
      const ms = toMs(c.date)
      return { time: Math.floor(ms / 1000), close: c.close, ms }
    })
    .filter(c => !isNaN(c.close) && !isNaN(c.ms) && c.ms >= cutoff)
    .sort((a, b) => a.time - b.time)

  const pe: RatioPoint[] = []
  const ps: RatioPoint[] = []
  const pcf: RatioPoint[] = []
  const pb: RatioPoint[] = []

  let idx = 0 // puntero al reporte vigente en cada fecha

  for (const day of closes) {
    while (idx + 1 < reports.length && reports[idx + 1].filedTime <= day.ms) idx++
    const r = reports[idx]
    if (r.filedTime > day.ms) continue // todavía no había ningún 10-K presentado en esa fecha

    const shares = r.sharesOutstanding
    if (r.eps && r.eps > 0) pe.push({ time: day.time, value: day.close / r.eps })
    if (r.revenue && shares) {
      const rps = r.revenue / shares
      if (rps > 0) ps.push({ time: day.time, value: day.close / rps })
    }
    if (r.operatingCashFlow && shares) {
      const cfps = r.operatingCashFlow / shares
      if (cfps > 0) pcf.push({ time: day.time, value: day.close / cfps })
    }
    if (r.stockholdersEquity && shares) {
      const bvps = r.stockholdersEquity / shares
      if (bvps > 0) pb.push({ time: day.time, value: day.close / bvps })
    }
  }

  return { pe, ps, pcf, pb }
}

// ── Carga de datos ──────────────────────────────────────────────────────────
const loadDailyStats = async (sym: string): Promise<DailyStats | null> => {
  const res = await fetch('/api/chart-data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol: sym }),
  })
  const data = await res.json()
  return data.error ? null : data
}

const loadFundamentals = async (sym: string): Promise<Fundamentals | null> => {
  const res = await fetch(`/api/fundamentals?symbol=${encodeURIComponent(sym)}`)
  const data = await res.json()
  return data.error ? null : data
}

// Datos por ticker con caché de sesión; ignora respuestas de un ticker anterior
function useTickerData<T>(ticker: string, load: (sym: string) => Promise<T | null>): T | null {
  const cache = useRef<Record<string, T>>({})
  const [data, setData] = useState<T | null>(null)

  useEffect(() => {
    if (!ticker) { setData(null); return }
    if (cache.current[ticker]) { setData(cache.current[ticker]); return }
    setData(null)
    let cancelled = false
    load(ticker)
      .then(d => {
        if (!d) return
        cache.current[ticker] = d
        if (!cancelled) setData(d)
      })
      .catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker])

  return data
}

// Cambia el ancho del gráfico cuando cambia el contenedor (también al colapsar el sidebar)
function observeWidth(el: HTMLElement, chart: IChartApi) {
  const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }))
  ro.observe(el)
  return () => ro.disconnect()
}

// Mini gráfica independiente para cada ratio — línea + marca punteada en el valor actual
function RatioMiniChart({ title, color, data }: { title: string; color: string; data: RatioPoint[] }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || !data || data.length === 0) return

    const chart = createChart(el, {
      layout: { background: { type: ColorType.Solid, color: '#080808' }, textColor: '#999' },
      grid: { vertLines: { color: '#141414' }, horzLines: { color: '#141414' } },
      width: el.clientWidth,
      height: RATIO_CHART_HEIGHT,
      rightPriceScale: { borderColor: '#222' },
      timeScale: { borderColor: '#222' },
    })

    const line = chart.addSeries(LineSeries, {
      color, lineWidth: 2, lastValueVisible: false, priceLineVisible: false,
    })
    line.setData(data as any)

    const current = data[data.length - 1]?.value
    if (current != null) {
      line.createPriceLine({
        price: current, color: '#3b82f6', lineWidth: 1, lineStyle: 2,
        axisLabelVisible: false, title: 'Actual',
      })
    }

    chart.timeScale().fitContent()
    const stopObserving = observeWidth(el, chart)

    return () => {
      stopObserving()
      chart.remove()
    }
  }, [data, color])

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 10 }}>
      <div style={{ fontSize: 10, color: '#888', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {title}
      </div>
      {(!data || data.length === 0) ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#444', fontSize: 11 }}>Sin datos suficientes</div>
      ) : (
        <div ref={ref} style={{ width: '100%', height: RATIO_CHART_HEIGHT }} />
      )}
    </div>
  )
}

// Tabla de distancia del precio a cada media móvil
function MaTable({ title, rows }: { title: string; rows: { key: string; label: string; dist: number | null }[] }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 14px', width: 160 }}>
      <div style={{ fontSize: 9, color: '#666', fontWeight: 700, letterSpacing: 0.5, marginBottom: 8, textTransform: 'uppercase' }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {rows.map(row => (
          <div key={row.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px', borderRadius: 4 }}>
            <span style={{ fontSize: 10, color: MA_COLORS[row.key], fontWeight: 700 }}>{row.label}</span>
            <span style={{ fontSize: 10, fontWeight: 800, color: row.dist == null ? '#555' : row.dist >= 0 ? C.success : C.danger }}>
              {row.dist != null ? `${row.dist >= 0 ? '+' : ''}${row.dist.toFixed(2)}%` : '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Última media y % de distancia al precio, ordenadas de mayor a menor distancia
function buildMaRows(keys: string[], data: ChartData | null, price: number | null) {
  return keys
    .map(key => {
      const arr = data?.mas?.[key]
      const value = arr && arr.length ? arr[arr.length - 1]?.value ?? null : null
      const dist = (value != null && price != null) ? ((price - value) / value) * 100 : null
      return { key, label: MA_LABELS[key], value, dist }
    })
    .sort((a, b) => (b.dist ?? -Infinity) - (a.dist ?? -Infinity))
}

const diffPct = (own: number | null, ref: number | null) =>
  own != null && ref != null && ref !== 0 ? ((own - ref) / Math.abs(ref)) * 100 : null

function ChartPageInner() {
  const searchParams = useSearchParams()
  const ticker = (searchParams.get('ticker') || '').toUpperCase()

  const [interval, setIntervalSel] = useState<Interval>('1day')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showRSI, setShowRSI] = useState(true)
  const [showMACD, setShowMACD] = useState(true)
  const [showADX, setShowADX] = useState(false)
  const [showKoncorde, setShowKoncorde] = useState(true)
  const [showPatterns, setShowPatterns] = useState(true)
  const [showMogalef, setShowMogalef] = useState(true)

  const [allTickerTrades, setAllTickerTrades] = useState<any[]>([])
  const [allExecutions, setAllExecutions] = useState<any[]>([])
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null)

  const [watchlistTarget, setWatchlistTarget] = useState<number | null>(null)
  const [liveQuote, setLiveQuote] = useState<{ price: number | null; change: number | null } | null>(null)

  const [chartData, setChartData] = useState<ChartData | null>(null)
  // Tablas fijas de EMA diario / SMA semanal — independientes del filtro de intervalo del gráfico principal
  const [emaDailyData, setEmaDailyData] = useState<ChartData | null>(null)
  const [smaWeeklyData, setSmaWeeklyData] = useState<ChartData | null>(null)

  const dailyStats = useTickerData<DailyStats>(ticker, loadDailyStats)
  const fundamentals = useTickerData<Fundamentals>(ticker, loadFundamentals)

  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  // Caché de sesión por ticker+intervalo; guarda la promesa en vuelo para no pedir lo mismo dos veces
  const cacheRef = useRef<Record<string, { data?: ChartData; promise?: Promise<ChartData> }>>({})
  const visibleRangeRef = useRef<{ key: string; range: any } | null>(null)
  const candleSeriesRef = useRef<any>(null)
  const targetPriceLineRef = useRef<any>(null)
  const tradePriceLinesRef = useRef<any[]>([])
  const maxMinPriceLinesRef = useRef<any[]>([])
  const mogalefSeriesRef = useRef<any[]>([])
  const panelSeriesRef = useRef<any[]>([])
  const markersPluginRef = useRef<any>(null)

  const getChartData = useCallback((sym: string, iv: Interval): Promise<ChartData> => {
    const key = `${sym}-${iv}`
    const entry = cacheRef.current[key]
    if (entry?.data) return Promise.resolve(entry.data)
    if (entry?.promise) return entry.promise

    const promise = fetch(`/api/chart-data?symbol=${encodeURIComponent(sym)}&interval=${iv}`)
      .then(async res => {
        const data = await res.json()
        if (data.error) throw new Error(data.error)
        if (!res.ok) throw new Error(`Error ${res.status}`)
        cacheRef.current[key] = { data }
        return data as ChartData
      })
      .catch(e => { delete cacheRef.current[key]; throw e })

    cacheRef.current[key] = { promise }
    return promise
  }, [])

  // ── Todas las operaciones del ticker (abiertas y cerradas) + sus ejecuciones ──
  useEffect(() => {
    if (!ticker) { setAllTickerTrades([]); setAllExecutions([]); setSelectedTradeId(null); return }
    let cancelled = false
    ;(async () => {
      const { data: trades, error: tErr } = await supabase
        .from('trades')
        .select('*, portfolios(name, grupo)')
        .eq('ticker', ticker)
      if (cancelled) return
      if (tErr || !trades || trades.length === 0) {
        setAllTickerTrades([]); setAllExecutions([]); setSelectedTradeId(null)
        return
      }
      setAllTickerTrades(trades)
      setSelectedTradeId(trades.find(t => t.status === 'open')?.id ?? null)

      const { data: execs } = await supabase
        .from('trade_executions')
        .select('*')
        .in('trade_id', trades.map(t => t.id))
      if (!cancelled) setAllExecutions(execs || [])
    })()
    return () => { cancelled = true }
  }, [ticker])

  const openTrades = useMemo(() => allTickerTrades.filter(t => t.status === 'open'), [allTickerTrades])
  const selectedTrade = openTrades.find(t => t.id === selectedTradeId) || null

  // ── Velas + medias móviles del gráfico principal ──
  useEffect(() => { setChartData(null) }, [ticker]) // al cambiar de ticker no se muestran velas del anterior

  useEffect(() => {
    if (!ticker) { setChartData(null); setError(null); return }
    const cached = cacheRef.current[`${ticker}-${interval}`]?.data
    if (cached) { setChartData(cached); setError(null); setLoading(false); return }

    let cancelled = false
    setLoading(true)
    setError(null)
    getChartData(ticker, interval)
      .then(data => { if (!cancelled) setChartData(data) })
      .catch(e => { if (!cancelled) { setError(String(e?.message ?? e)); setChartData(null) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [ticker, interval, getChartData])

  // ── Tablas fijas EMA diario / SMA semanal — reutilizan el mismo caché ──
  useEffect(() => {
    setEmaDailyData(null); setSmaWeeklyData(null)
    if (!ticker) return
    let cancelled = false
    getChartData(ticker, '1day').then(d => { if (!cancelled) setEmaDailyData(d) }).catch(() => {})
    getChartData(ticker, '1week').then(d => { if (!cancelled) setSmaWeeklyData(d) }).catch(() => {})
    return () => { cancelled = true }
  }, [ticker, getChartData])

  // ── Precio y variación en vivo para el encabezado ──
  useEffect(() => {
    setLiveQuote(null)
    if (!ticker) return
    let cancelled = false
    fetch(`/api/webull/quote?symbol=${encodeURIComponent(ticker)}`)
      .then(r => r.json())
      .then(data => { if (!cancelled && data.success) setLiveQuote({ price: data.price, change: data.change }) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [ticker])

  // ── Precio objetivo de watchlist (tu punto de entrada esperado) ──
  useEffect(() => {
    setWatchlistTarget(null)
    if (!ticker) return
    let cancelled = false
    supabase
      .from('watchlist')
      .select('buy_target')
      .eq('ticker', ticker)
      .maybeSingle()
      .then(({ data }) => { if (!cancelled) setWatchlistTarget(data?.buy_target ?? null) })
    return () => { cancelled = true }
  }, [ticker])

  // Promedio propio por año, cruzando fundamentales con precio — alimenta la columna "X años Avg."
  const ownFiveYearAvg = useMemo(() => {
    if (!fundamentals || !dailyStats) return null
    return computeOwnFiveYearAvg(fundamentals.ownHistory, dailyStats.dailyCloses)
  }, [fundamentals, dailyStats])

  // Series diarias de P/E, P/S, P/CF, P/B — para las 4 gráficas independientes de valuación
  const dailyRatioSeries = useMemo(() => {
    if (!fundamentals || !dailyStats) return { pe: [], ps: [], pcf: [], pb: [] }
    return computeDailyRatioSeries(fundamentals.ownHistory, dailyStats.dailyCloses)
  }, [fundamentals, dailyStats])

  const hasRatioCharts =
    dailyRatioSeries.pe.length > 0 || dailyRatioSeries.ps.length > 0 ||
    dailyRatioSeries.pcf.length > 0 || dailyRatioSeries.pb.length > 0

  // % de distancia al precio actual (diario; si no hay, semanal)
  const currentDailyPrice = emaDailyData?.candles?.length
    ? emaDailyData.candles[emaDailyData.candles.length - 1].close
    : (smaWeeklyData?.candles?.length ? smaWeeklyData.candles[smaWeeklyData.candles.length - 1].close : null)

  const emaTableRows = useMemo(() => buildMaRows(EMA_KEYS, emaDailyData, currentDailyPrice), [emaDailyData, currentDailyPrice])
  const smaTableRows = useMemo(() => buildMaRows(SMA_KEYS, smaWeeklyData, currentDailyPrice), [smaWeeklyData, currentDailyPrice])

  // ══════════════════════════════════════════════════════════════════════
  // EFECTO 1 — Gráfico base: velas, volumen, medias móviles, soportes/resistencias.
  // El único que crea/destruye el objeto `chart`.
  // ══════════════════════════════════════════════════════════════════════
  useEffect(() => {
    const el = containerRef.current
    if (!el || !chartData || chartData.candles.length === 0) return

    const rangeKey = `${ticker}-${interval}`

    const chart = createChart(el, {
      layout: { background: { type: ColorType.Solid, color: '#080808' }, textColor: '#999' },
      grid: { vertLines: { color: '#141414' }, horzLines: { color: '#141414' } },
      width: el.clientWidth,
      height: CHART_HEIGHT,
      rightPriceScale: { borderColor: '#222' },
      timeScale: { borderColor: '#222', timeVisible: interval === '45min' },
    })
    chartRef.current = chart
    // El chart es nuevo: se invalidan las referencias a series/líneas del anterior
    targetPriceLineRef.current = null
    tradePriceLinesRef.current = []
    maxMinPriceLinesRef.current = []
    mogalefSeriesRef.current = []
    panelSeriesRef.current = []
    markersPluginRef.current = null

    chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
      visibleRangeRef.current = { key: rangeKey, range }
    })

    // Cinta EMA/SMA — relleno verde/rojo entre las dos medias rápidas, según cuál esté arriba
    const isWeeklyOrMonthly = interval === '1week' || interval === '1month'
    const fastArr = chartData.mas[isWeeklyOrMonthly ? 'sma10' : 'ema8'] || []
    const slowArr = chartData.mas[isWeeklyOrMonthly ? 'sma20' : 'ema21'] || []
    if (fastArr.length && slowArr.length) {
      const ribbonData = chartData.candles.map((c: any, i: number) => {
        const fast = fastArr[i]?.value
        const slow = slowArr[i]?.value
        if (fast == null || slow == null) return { time: c.time }
        return { time: c.time, fast, slow }
      })
      const ribbonSeries = (chart as any).addCustomSeries(new RibbonSeries(), {
        upColor: 'rgba(34, 197, 94, 0.18)',
        downColor: 'rgba(244, 63, 94, 0.18)',
      })
      ribbonSeries.setData(ribbonData as any)
    }

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: C.success, downColor: C.danger, borderVisible: false,
      wickUpColor: C.success, wickDownColor: C.danger, priceLineVisible: true,
      priceLineColor: '#ffffff',
    })
    candleSeries.setData(chartData.candles as any)
    candleSeriesRef.current = candleSeries

    // Barras de volumen
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      lastValueVisible: false,
      priceLineVisible: false,
    })
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
    volumeSeries.setData(
      chartData.candles.map((c: any) => ({
        time: c.time,
        value: c.volume,
        color: c.close >= c.open ? 'rgba(34,197,94,0.5)' : 'rgba(244,63,94,0.5)',
      })) as any
    )

    // Media de volumen de 20 periodos (suma deslizante)
    const volumeMALine = chart.addSeries(LineSeries, {
      priceScaleId: 'volume', color: '#22c55e', lineWidth: 2,
      lastValueVisible: false, priceLineVisible: false,
    })
    const period = 20
    const volumeMA: { time: any; value: number }[] = []
    let volSum = 0
    chartData.candles.forEach((c: any, i: number) => {
      volSum += c.volume
      if (i >= period) volSum -= chartData.candles[i - period].volume
      if (i >= period - 1) volumeMA.push({ time: c.time, value: volSum / period })
    })
    volumeMALine.setData(volumeMA as any)

    // Medias móviles — EMA 8/21/50/100/200 (45min y diario) o SMA 10/20/50/100/200 (semanal y mensual)
    Object.entries(chartData.mas).forEach(([key, points]) => {
      const clean = (points as any[]).filter(p => p.value !== null)
      if (!clean.length) return
      const line = chart.addSeries(LineSeries, {
        color: MA_COLORS[key] || '#888',
        lineWidth: (key === 'ema8' || key === 'sma10') ? 2 : 1,
        priceLineVisible: false,
        lastValueVisible: false,
      })
      line.setData(clean as any)
    })

    // Soportes y resistencias — solo en vista semanal/mensual, igual que el Pine original
    if (isWeeklyOrMonthly) {
      const { resistances, supports } = computePivots(chartData.candles)
      resistances.forEach(price => {
        candleSeries.createPriceLine({ price, color: '#22d3ee', lineWidth: 1, lineStyle: 3, axisLabelVisible: false })
      })
      supports.forEach(price => {
        candleSeries.createPriceLine({ price, color: '#a3e635', lineWidth: 1, lineStyle: 3, axisLabelVisible: false })
      })
    }

    // El zoom solo se conserva si es el mismo ticker e intervalo (un rango lógico de otro gráfico no sirve)
    const saved = visibleRangeRef.current
    if (saved && saved.key === rangeKey && saved.range) {
      chart.timeScale().setVisibleLogicalRange(saved.range)
    } else {
      chart.timeScale().fitContent()
    }

    const stopObserving = observeWidth(el, chart)

    return () => {
      const current = chart.timeScale().getVisibleLogicalRange()
      if (current) visibleRangeRef.current = { key: rangeKey, range: current }
      stopObserving()
      chart.remove()
      chartRef.current = null
      candleSeriesRef.current = null
    }
  }, [chartData, interval, ticker])

  // ══════════════════════════════════════════════════════════════════════
  // EFECTO — Línea de precio objetivo (watchlist.buy_target).
  // ══════════════════════════════════════════════════════════════════════
  useEffect(() => {
    const candleSeries = candleSeriesRef.current
    if (!candleSeries) return

    if (targetPriceLineRef.current) {
      candleSeries.removePriceLine(targetPriceLineRef.current)
      targetPriceLineRef.current = null
    }
    if (watchlistTarget != null) {
      targetPriceLineRef.current = candleSeries.createPriceLine({
        price: watchlistTarget, color: C.accent, lineWidth: 2, lineStyle: 2,
        axisLabelVisible: true, title: 'Comprar',
      })
    }
  }, [chartData, interval, watchlistTarget])

  // ══════════════════════════════════════════════════════════════════════
  // EFECTO 2 — Líneas de precio del trade (costo promedio / stop / TP1-3).
  // ══════════════════════════════════════════════════════════════════════
  useEffect(() => {
    const candleSeries = candleSeriesRef.current
    if (!candleSeries) return

    tradePriceLinesRef.current.forEach(line => candleSeries.removePriceLine(line))
    tradePriceLinesRef.current = []
    if (!selectedTrade) return

    const addLine = (price: number, color: string, title: string) => {
      tradePriceLinesRef.current.push(candleSeries.createPriceLine({
        price, color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title,
      }))
    }

    const qty = Number(selectedTrade.quantity || 0)
    const invested = Number(selectedTrade.total_invested || 0)
    const avgCost = qty > 0 ? invested / qty : Number(selectedTrade.entry_price || 0)

    if (avgCost > 0) addLine(avgCost, C.warning, 'Posicion')
    if (selectedTrade.stop_loss) addLine(Number(selectedTrade.stop_loss), C.danger, 'SL')
    ;[selectedTrade.take_profit_1, selectedTrade.take_profit_2, selectedTrade.take_profit_3].forEach(tp => {
      if (tp) addLine(Number(tp), '#f97316', 'TP')
    })
  }, [chartData, interval, selectedTrade])

  // ══════════════════════════════════════════════════════════════════════
  // EFECTO 3 — Líneas de máximo/mínimo histórico (10 años).
  // ══════════════════════════════════════════════════════════════════════
  useEffect(() => {
    const candleSeries = candleSeriesRef.current
    if (!candleSeries) return

    maxMinPriceLinesRef.current.forEach(line => candleSeries.removePriceLine(line))
    maxMinPriceLinesRef.current = []

    if (dailyStats) {
      ;[{ price: dailyStats.max.price, title: 'Máx' }, { price: dailyStats.min.price, title: 'Mín' }].forEach(({ price, title }) => {
        maxMinPriceLinesRef.current.push(candleSeries.createPriceLine({
          price, color: '#f700ff', lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title,
        }))
      })
    }
  }, [chartData, interval, dailyStats])

  // ══════════════════════════════════════════════════════════════════════
  // EFECTO 4 — Marcadores: ejecuciones de todos los trades del ticker + patrones de velas.
  // createSeriesMarkers REEMPLAZA todos los marcadores en cada llamada.
  // ══════════════════════════════════════════════════════════════════════

  // Operaciones del historial (apertura reconstruida + ejecuciones) → marcador por evento
  const executionMarkers = useMemo(() => {
    const out: { day: string; position: 'belowBar' | 'aboveBar'; color: string; shape: any }[] = []

    allTickerTrades.forEach(trade => {
      const shape = getPortfolioMarkerShape(trade.portfolios?.name, trade.portfolios?.grupo)

      // La apertura no vive en trade_executions: se reconstruye de la fila del trade
      const events = [
        { day: dayKey(trade.open_date), seq: 0, type: 'apertura', qty: Number(trade.initial_quantity ?? trade.quantity) },
        ...allExecutions
          .filter(e => e.trade_id === trade.id)
          .map((e, i) => ({ day: dayKey(e.executed_at), seq: i + 1, type: e.execution_type as string, qty: Number(e.quantity) })),
      ]
        .filter(e => e.day)
        .sort((a, b) => a.day < b.day ? -1 : a.day > b.day ? 1 : a.seq - b.seq)

      let runningQty = 0
      events.forEach(e => {
        const isBuy = e.type === 'apertura' || e.type === 'buy'
        let color = '#888'
        if (isBuy) {
          runningQty += e.qty
          color = e.type === 'apertura' ? C.success : C.accent
        } else {
          runningQty -= e.qty
          color = runningQty <= 0.0001 ? '#e5e5e5' : C.danger
        }
        out.push({ day: e.day, position: isBuy ? 'belowBar' : 'aboveBar', color, shape })
      })
    })
    return out
  }, [allTickerTrades, allExecutions])

  // Patrones de velas con el contexto de mercado (valuación y tendencia)
  const patternMarkers = useMemo(() => {
    if (!showPatterns || !chartData) return []
    const ema200Arr = chartData.mas?.ema200 || []
    const currentPrice = chartData.candles[chartData.candles.length - 1]?.close
    const latestEma200 = ema200Arr.length ? ema200Arr[ema200Arr.length - 1]?.value : null
    const isAboveEma200Day = currentPrice != null && latestEma200 != null ? currentPrice > latestEma200 : false

    const currentPE = fundamentals?.pe
    const historyAvgPE = ownFiveYearAvg?.pe
    const isUndervalued = currentPE != null && historyAvgPE != null ? currentPE < historyAvgPE : false

    return detectCandlePatterns(chartData.candles, { isUndervalued, isAboveEma200Day }) as any[]
  }, [chartData, showPatterns, fundamentals?.pe, ownFiveYearAvg?.pe])

  useEffect(() => {
    const candleSeries = candleSeriesRef.current
    if (!candleSeries || !chartData) return

    // Los marcadores deben usar el mismo tipo de tiempo que las velas:
    // en 45min las velas llevan timestamp (segundos), no 'YYYY-MM-DD'
    const candles = chartData.candles
    const numericTime = typeof candles[0]?.time === 'number'
    const candleDays = numericTime
      ? candles.map((c: any) => new Date(c.time * 1000).toISOString().slice(0, 10))
      : []
    const snap = (day: string) => {
      if (!numericTime) return day
      const idx = candleDays.findIndex((d: string) => d >= day)
      // Si la fecha es posterior a la última vela, se ancla a la última (igual que hace la librería)
      return idx === -1 ? candles[candles.length - 1].time : candles[idx].time
    }

    const markers: any[] = []
    executionMarkers.forEach(m => {
      const time = snap(m.day)
      if (time != null) markers.push({ time, position: m.position, color: m.color, shape: m.shape })
    })
    markers.push(...patternMarkers)
    markers.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))

    if (!markersPluginRef.current) {
      markersPluginRef.current = createSeriesMarkers(candleSeries, markers as any)
    } else {
      markersPluginRef.current.setMarkers(markers as any)
    }
  }, [chartData, interval, executionMarkers, patternMarkers])

  // ══════════════════════════════════════════════════════════════════════
  // EFECTO 5 — Bandas de Mogalef (overlay en el panel principal).
  // ══════════════════════════════════════════════════════════════════════
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    mogalefSeriesRef.current.forEach(s => { try { chart.removeSeries(s) } catch { /* ya no existe */ } })
    mogalefSeriesRef.current = []

    if (showMogalef && chartData) {
      const mogalefData = mogalefBandsSeries(chartData.candles, 10, 30, 1.5)

      const supLine = chart.addSeries(LineSeries, { color: '#ffe600', lineWidth: 2, lastValueVisible: false, priceLineVisible: false })
      supLine.setData(mogalefData.filter(p => p.sup !== null).map(p => ({ time: p.time, value: p.sup })) as any)

      const infLine = chart.addSeries(LineSeries, { color: '#eeff00', lineWidth: 2, lastValueVisible: false, priceLineVisible: false })
      infLine.setData(mogalefData.filter(p => p.inf !== null).map(p => ({ time: p.time, value: p.inf })) as any)

      mogalefSeriesRef.current = [supLine, infLine]
    }
  }, [chartData, interval, showMogalef])

  // ══════════════════════════════════════════════════════════════════════
  // EFECTO 6 — Paneles de indicadores (RSI, MACD, Koncorde, ADX).
  // ══════════════════════════════════════════════════════════════════════
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !chartData) return

    panelSeriesRef.current.forEach(s => { try { chart.removeSeries(s) } catch { /* ya no existe */ } })
    panelSeriesRef.current = []

    const lineOpts = (color: string, lineWidth: 1 | 2) =>
      ({ color, lineWidth, lastValueVisible: false, priceLineVisible: false } as const)

    let nextPane = 1
    const added: any[] = []

    if (showRSI) {
      const paneIdx = nextPane++
      const rsiLine = chart.addSeries(LineSeries, lineOpts('#a78bfa', 2), paneIdx)
      rsiLine.setData(rsiSeries(chartData.candles).filter(p => p.value !== null) as any)
      rsiLine.createPriceLine({ price: 70, color: '#f43f5e', lineWidth: 1, lineStyle: 3, axisLabelVisible: false, title: '70' })
      rsiLine.createPriceLine({ price: 30, color: '#22c55e', lineWidth: 1, lineStyle: 3, axisLabelVisible: false, title: '30' })
      rsiLine.createPriceLine({ price: 50, color: '#ffffff', lineWidth: 1, lineStyle: 3, axisLabelVisible: false })
      added.push(rsiLine)
    }

    if (showMACD) {
      const paneIdx = nextPane++
      const macdData = macdSeries(chartData.candles)
      const histSeries = chart.addSeries(HistogramSeries, { lastValueVisible: false, priceLineVisible: false }, paneIdx)
      histSeries.setData(
        macdData.filter(d => d.hist !== null).map(d => ({
          time: d.time, value: d.hist as number,
          color: (d.hist as number) >= 0 ? 'rgba(34,197,94,0.7)' : 'rgba(244,63,94,0.7)',
        })) as any
      )
      const macdLine = chart.addSeries(LineSeries, lineOpts(C.success, 1), paneIdx)
      macdLine.setData(macdData.filter(d => d.macd !== null).map(d => ({ time: d.time, value: d.macd })) as any)
      const signalLine = chart.addSeries(LineSeries, lineOpts(C.danger, 1), paneIdx)
      signalLine.setData(macdData.filter(d => d.signal !== null).map(d => ({ time: d.time, value: d.signal })) as any)
      added.push(histSeries, macdLine, signalLine)
    }

    if (showKoncorde) {
      const paneIdx = nextPane++
      const konData = koncordeSeries(chartData.candles)
      const verdeLine = chart.addSeries(LineSeries, lineOpts('#f97316', 2), paneIdx)
      verdeLine.setData(konData.map(d => ({ time: d.time, value: d.verde })) as any)
      const marronLine = chart.addSeries(LineSeries, lineOpts('#22c55e', 2), paneIdx)
      marronLine.setData(konData.map(d => ({ time: d.time, value: d.marron })) as any)
      const azulLine = chart.addSeries(LineSeries, lineOpts('#00FFFF', 1), paneIdx)
      azulLine.setData(konData.map(d => ({ time: d.time, value: d.azul })) as any)
      const mediaLine = chart.addSeries(LineSeries, lineOpts('#f43f5e', 1), paneIdx)
      mediaLine.setData(konData.map(d => ({ time: d.time, value: d.media })) as any)
      mediaLine.createPriceLine({ price: 0, color: '#ffffff', lineWidth: 1, lineStyle: 3, axisLabelVisible: false })
      added.push(verdeLine, marronLine, azulLine, mediaLine)
    }

    if (showADX) {
      const paneIdx = nextPane++
      const adxData = adxSeries(chartData.candles)
      const adxLine = chart.addSeries(LineSeries, lineOpts(C.warning, 2), paneIdx)
      adxLine.setData(adxData.filter(d => d.adx !== null).map(d => ({ time: d.time, value: d.adx })) as any)
      const plusDI = chart.addSeries(LineSeries, lineOpts(C.success, 1), paneIdx)
      plusDI.setData(adxData.filter(d => d.plusDI !== null).map(d => ({ time: d.time, value: d.plusDI })) as any)
      const minusDI = chart.addSeries(LineSeries, lineOpts(C.danger, 1), paneIdx)
      minusDI.setData(adxData.filter(d => d.minusDI !== null).map(d => ({ time: d.time, value: d.minusDI })) as any)
      adxLine.createPriceLine({ price: 25, color: '#666', lineWidth: 1, lineStyle: 3, axisLabelVisible: false, title: '25' })
      added.push(adxLine, plusDI, minusDI)
    }

    chart.panes().slice(1).forEach(pane => pane.setStretchFactor(1))
    panelSeriesRef.current = added
  }, [chartData, interval, showRSI, showMACD, showKoncorde, showADX])

  const badge = selectedTrade
    ? getPortfolioBadge(selectedTrade.portfolios?.name, selectedTrade.portfolios?.grupo)
    : null

  // ── Máximos / mínimos históricos ──
  const lastClose = chartData?.candles?.length ? chartData.candles[chartData.candles.length - 1].close : null
  const pctUp   = (p?: number | null) => p != null && lastClose ? ((p - lastClose) / lastClose) * 100 : null
  const pctDown = (p?: number | null) => p != null && lastClose ? ((lastClose - p) / lastClose) * 100 : null

  const fmtDate = (d: string) => d ? new Date(dayKey(d) + 'T00:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

  const statsRows = useMemo(() => {
    if (!dailyStats) return []
    type Row = { label: string; price: number | undefined; pct: number | null; date: string | undefined; color: string }

    // Agrupa Máx/Mín cuando coinciden en fecha y precio (ej. Máx 10a = Máx 5a)
    const group = (rows: Row[]) => {
      const out: Row[] = []
      for (const row of rows) {
        if (row.price == null) continue
        const last = out[out.length - 1]
        if (last && last.price === row.price && last.date === row.date) {
          last.label += ` y ${row.label.split(' ')[1]}`
        } else {
          out.push({ ...row })
        }
      }
      return out
    }

    const maxRows: Row[] = [
      { label: 'Máx 10a', price: dailyStats.max.price,    pct: pctUp(dailyStats.max.price),    date: dailyStats.max.date,    color: C.success },
      { label: 'Máx 5a',  price: dailyStats.max5?.price,  pct: pctUp(dailyStats.max5?.price),  date: dailyStats.max5?.date,  color: C.success },
      { label: 'Máx 52s', price: dailyStats.max52?.price, pct: pctUp(dailyStats.max52?.price), date: dailyStats.max52?.date, color: C.success },
    ]
    const minRows: Row[] = [
      { label: 'Mín 52s', price: dailyStats.min52?.price, pct: pctDown(dailyStats.min52?.price), date: dailyStats.min52?.date, color: C.danger },
      { label: 'Mín 5a',  price: dailyStats.min5?.price,  pct: pctDown(dailyStats.min5?.price),  date: dailyStats.min5?.date,  color: C.danger },
      { label: 'Mín 10a', price: dailyStats.min.price,    pct: pctDown(dailyStats.min.price),    date: dailyStats.min.date,    color: C.danger },
    ]
    return [...group(maxRows), ...group(minRows)]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyStats, lastClose])

  // ── Tabla de ratios vs. sector y vs. promedio propio ──
  const ratioRows = useMemo(() => {
    if (!fundamentals) return []
    const sector = fundamentals.sectorAvg
    const own5 = ownFiveYearAvg
    const defs: { label: string; key: keyof RatioSet; suffix: string; higherIsBetter: boolean }[] = [
      { label: 'P/E',         key: 'pe',            suffix: '',  higherIsBetter: false },
      { label: 'P/S',         key: 'ps',            suffix: '',  higherIsBetter: false },
      { label: 'P/Cash Flow', key: 'pcf',           suffix: '',  higherIsBetter: false },
      { label: 'P/Book',      key: 'pb',            suffix: '',  higherIsBetter: false },
      { label: 'Payout',      key: 'payoutRatio',   suffix: '%', higherIsBetter: false },
      { label: 'Div Yield',   key: 'dividendYield', suffix: '%', higherIsBetter: true },
    ]
    return defs.map(d => {
      const own = fundamentals[d.key]
      const sec = sector?.[d.key] ?? null
      const avg5y = own5?.[d.key] ?? null
      const diffSector = diffPct(own, sec)
      const diff5y = diffPct(own, avg5y)
      const good = (diff: number | null) => diff == null ? null : d.higherIsBetter ? diff >= 0 : diff <= 0
      return { ...d, own, sector: sec, avg5y, diffSector, diff5y, goodSector: good(diffSector), good5y: good(diff5y) }
    })
  }, [fundamentals, ownFiveYearAvg])

  const diffColor = (good: boolean | null) => good == null ? '#444' : good ? C.success : C.danger
  const diffText  = (d: number | null) => d != null ? `${d >= 0 ? '+' : ''}${d.toFixed(1)}%` : '—'

  return (
    <AppShell>
      <div style={{ maxWidth: 1400, margin: '20px auto', padding: '0 28px', color: 'white' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
          <BarChart2 size={20} color={C.accent} />
          <h1 style={{ fontSize: 20, fontWeight: 900, margin: 0 }}>
            {ticker || 'Selecciona un ticker'}
          </h1>
          {fundamentals?.companyName && (
            <span style={{ fontSize: 18, color: '#888', fontWeight: 500 }}>
              {fundamentals.companyName}
            </span>
          )}
          {liveQuote?.change != null && (
            <span style={{
              fontSize: 18, fontWeight: 700, padding: '3px 8px', borderRadius: 5,
              color: liveQuote.change >= 0 ? C.success : C.danger,
              background: liveQuote.change >= 0 ? 'rgba(34,197,94,0.1)' : 'rgba(244,63,94,0.1)',
            }}>
              {liveQuote.change >= 0 ? '+' : ''}{liveQuote.change.toFixed(2)}%
            </span>
          )}
          {badge && (
            <span style={{ fontSize: 11, color: '#aaa', background: '#111', border: '1px solid #222', borderRadius: 6, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13 }}>{badge.symbol}</span> {badge.label}
            </span>
          )}
          {openTrades.length > 1 && (
            <select value={selectedTradeId || ''} onChange={e => setSelectedTradeId(e.target.value)} style={selectStyle}>
              {openTrades.map(t => (
                <option key={t.id} value={t.id}>{t.portfolios?.name || 'Portafolio'}</option>
              ))}
            </select>
          )}
        </div>

        <div style={{ display: 'flex', gap: 14, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {fundamentals && (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 14px', maxWidth: 620 }}>
              <div style={{ fontSize: 9, color: '#666', fontWeight: 700, letterSpacing: 0.5, marginBottom: 8, textTransform: 'uppercase' }}>
                Ratios vs. sector {fundamentals.peerCount > 0 ? `(${fundamentals.peerCount} comparables)` : ''}
                {ownFiveYearAvg ? ` · vs. propio promedio ${ownFiveYearAvg.yearsUsed}A` : ' · sin 10-K propio (ETF u otro caso sin reportes anuales)'}
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr>
                    {['', ticker, 'Sector', 'Diff', `${ticker} ${ownFiveYearAvg ? ownFiveYearAvg.yearsUsed : 5}A Avg.`, 'Diff'].map((h, i) => (
                      <th key={i} style={{ textAlign: i === 0 ? 'left' : 'right', color: '#555', fontSize: 9, fontWeight: 700, padding: '2px 6px', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ratioRows.map(row => (
                    <tr key={row.label} style={{ borderTop: '1px solid #151515' }}>
                      <td style={{ padding: '4px 6px', color: '#aaa' }}>{row.label}</td>
                      <td style={{ padding: '4px 6px', textAlign: 'right', color: '#fff', fontWeight: 700 }}>
                        {row.own != null ? `${row.own.toFixed(2)}${row.suffix}` : '—'}
                      </td>
                      <td style={{ padding: '4px 6px', textAlign: 'right', color: '#888' }}>
                        {row.sector != null ? `${row.sector.toFixed(2)}${row.suffix}` : '—'}
                      </td>
                      <td style={{ padding: '4px 6px', textAlign: 'right', fontWeight: 700, color: diffColor(row.goodSector) }}>
                        {diffText(row.diffSector)}
                      </td>
                      <td style={{ padding: '4px 6px', textAlign: 'right', color: '#888' }}>
                        {row.avg5y != null ? `${row.avg5y.toFixed(2)}${row.suffix}` : '—'}
                      </td>
                      <td style={{ padding: '4px 6px', textAlign: 'right', fontWeight: 700, color: diffColor(row.good5y) }}>
                        {diffText(row.diff5y)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {dailyStats && (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 14px', maxWidth: 320 }}>
              <div style={{ fontSize: 9, color: '#666', fontWeight: 700, letterSpacing: 0.5, marginBottom: 8, textTransform: 'uppercase' }}>
                Máximos / mínimos históricos
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <tbody>
                  {statsRows.map(row => (
                    <tr key={row.label} style={{ borderTop: '1px solid #151515' }}>
                      <td style={{ padding: '4px 6px', color: '#aaa' }}>{row.label}</td>
                      <td style={{ padding: '4px 6px', textAlign: 'right', color: '#fff', fontWeight: 700 }}>
                        {row.price != null ? `$${row.price.toFixed(2)}` : '—'}
                      </td>
                      <td style={{ padding: '4px 6px', textAlign: 'right', fontWeight: 700, color: row.pct != null ? row.color : '#444' }}>
                        {row.pct != null ? `${row.label.startsWith('Máx') ? '+' : '-'}${row.pct.toFixed(1)}%` : '—'}
                      </td>
                      <td style={{ padding: '4px 6px', textAlign: 'right', color: '#888', whiteSpace: 'nowrap' }}>
                        {row.date ? fmtDate(row.date) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {emaDailyData && <MaTable title="EMA Diario" rows={emaTableRows} />}
          {smaWeeklyData && <MaTable title="SMA Semanal" rows={smaTableRows} />}
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {INTERVALS.map(iv => (
            <button key={iv.value} onClick={() => setIntervalSel(iv.value)} disabled={loading} style={filterBtn(interval === iv.value)}>
              {iv.label}
            </button>
          ))}
          <span style={{ width: 1, background: '#222', margin: '2px 4px' }} />
          <button onClick={() => setShowRSI(v => !v)} style={filterBtn(showRSI)}>RSI</button>
          <button onClick={() => setShowMACD(v => !v)} style={filterBtn(showMACD)}>MACD</button>
          <button onClick={() => setShowKoncorde(v => !v)} style={filterBtn(showKoncorde)}>Koncorde</button>
          <button onClick={() => setShowADX(v => !v)} style={filterBtn(showADX)}>ADX</button>
          <button onClick={() => setShowPatterns(v => !v)} style={filterBtn(showPatterns)}>Patrones</button>
          <button onClick={() => setShowMogalef(v => !v)} style={filterBtn(showMogalef)}>Mogalef</button>
        </div>

        {!ticker && (
          <div style={{ padding: 60, textAlign: 'center', color: '#666' }}>
            Abre este gráfico desde un ticker de tu watchlist o de tus trades — falta <code>?ticker=</code> en la URL.
          </div>
        )}

        {ticker && error && (
          <div style={{ padding: 40, textAlign: 'center', color: C.danger, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12 }}>
            {error}
          </div>
        )}

        {ticker && loading && !chartData && (
          <div style={{ padding: 60, textAlign: 'center', color: '#666' }}>Cargando gráfico...</div>
        )}

        {ticker && !error && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, position: 'relative' }}>
            {loading && chartData && (
              <div style={{ position: 'absolute', top: 10, right: 16, fontSize: 10, color: C.accent, zIndex: 1 }}>
                Actualizando...
              </div>
            )}
            <div ref={containerRef} style={{ width: '100%', height: CHART_HEIGHT }} />
          </div>
        )}

        <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 10, color: '#888', flexWrap: 'wrap' }}>
          <span>Color: <span style={{ color: C.success }}>●</span> Apertura <span style={{ color: C.accent }}>●</span> Recompra <span style={{ color: C.danger }}>●</span> Venta parcial <span style={{ color: '#e5e5e5' }}>●</span> Cierre total</span>
          <span style={{ color: '#444' }}>|</span>
          <span>Forma: ● Corto ▪ Mediano ▲ Largo ▼ ETF</span>
          <span style={{ color: '#444' }}>|</span>
          <span><span style={{ color: C.warning }}>┄</span> Costo promedio</span>
          <span><span style={{ color: '#f97316' }}>┄</span> TP1 / TP2 / TP3</span>
          <span><span style={{ color: C.danger }}>┄</span> Stop loss</span>
          <span style={{ color: '#444' }}>|</span>
          {maKeysFor(interval).map(key => (
            <span key={key}><span style={{ color: MA_COLORS[key] }}>▬</span> {MA_LABELS[key]}</span>
          ))}
        </div>

        {/* ── Historial de dividendos ── */}
        {ticker && (
          <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 12 }}>
            <DividendsChart ticker={ticker} years={10} />
            <DividendYieldChart
              ticker={ticker}
              years={10}
              dailyCloses={dailyStats?.dailyCloses || []}
            />
          </div>
        )}

        {/* ── Ratios de valuación — 4 gráficas independientes ── */}
        {ticker && hasRatioCharts && (
          <div style={{ marginTop: 24 }}>
            <div style={{ fontSize: 11, color: '#666', fontWeight: 700, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Ratios de valuación — últimos 10 años (línea punteada azul = valor actual)
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
              <RatioMiniChart title="Price / Earnings" color="#facc15" data={dailyRatioSeries.pe} />
              <RatioMiniChart title="Price / Sales" color="#22d3ee" data={dailyRatioSeries.ps} />
              <RatioMiniChart title="Price / Cash Flow" color="#a78bfa" data={dailyRatioSeries.pcf} />
              <RatioMiniChart title="Price / Book" color="#f97316" data={dailyRatioSeries.pb} />
            </div>

            <div style={{ fontSize: 9, color: '#444', marginTop: 8 }}>
              El fundamental (EPS, ventas, flujo de caja, capital contable) se actualiza una vez al año en la fecha real de presentación del 10-K ante la SEC; el precio se mueve a diario.
            </div>
          </div>
        )}

      </div>
    </AppShell>
  )
}

const filterBtn = (active: boolean): React.CSSProperties => ({
  padding: '6px 14px', borderRadius: 6, border: 'none',
  background: active ? C.accent : '#111',
  color: active ? '#000' : '#888',
  cursor: 'pointer', fontSize: 10, fontWeight: 'bold',
})
const selectStyle: React.CSSProperties = {
  background: '#080808', color: '#ccc', border: '1px solid #222',
  padding: '6px 10px', borderRadius: 6, fontSize: 11, outline: 'none',
}

export default function ChartPage() {
  return (
    <Suspense fallback={<AppShell><div style={{ padding: 40, color: '#666' }}>Cargando...</div></AppShell>}>
      <ChartPageInner />
    </Suspense>
  )
}