'use client'

import { useEffect, useRef, useState, Suspense, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  createChart, CandlestickSeries, HistogramSeries, LineSeries,
  createSeriesMarkers, ColorType, IChartApi,
} from 'lightweight-charts'
import { supabase } from '@/lib/supabase'
import { rsiSeries, macdSeries, adxSeries, koncordeSeries } from '@/lib/indicators'
import AppShell from '../AppShell'
import { BarChart2 } from 'lucide-react'

type Interval = '45min' | '1day' | '1week' | '1month'

const C = {
  accent: '#00bfff', success: '#22c55e', danger: '#f43f5e', warning: '#eab308',
  card: '#080808', border: '#1a1a1a',
}

const MA_COLORS: Record<string, string> = {
  ema8: '#eab308', ema21: '#e5e5e5', ema50: '#3b82f6', ema100: '#f97316', ema200: '#f43f5e',
  sma10: '#eab308', sma20: '#e5e5e5', sma50: '#3b82f6', sma100: '#f97316', sma200: '#f43f5e',
}
const MA_LABELS: Record<string, string> = {
  ema8: 'EMA 8', ema21: 'EMA 21', ema50: 'EMA 50', ema100: 'EMA 100', ema200: 'EMA 200',
  sma10: 'SMA 10', sma20: 'SMA 20', sma50: 'SMA 50', sma100: 'SMA 100', sma200: 'SMA 200',
}

// Figura por grupo de portafolio — "EFT" es excepción por nombre, no por grupo
function getPortfolioBadge(name: string | undefined, grupo: string | undefined) {
  if ((name || '').toUpperCase() === 'EFT') return { symbol: '◆', label: 'ETF' }
  if (grupo === 'corto')   return { symbol: '●', label: 'PCP · Corto plazo' }
  if (grupo === 'mediano') return { symbol: '▲', label: 'PMP · Mediano plazo' }
  return { symbol: '■', label: 'PLP · Largo plazo' }
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
    const windowSlice = candles.slice(i - leftBars, i + rightBars + 1)
    const h = candles[i].high
    const l = candles[i].low
    const isPivotHigh = h === Math.max(...windowSlice.map(c => c.high))
    const isPivotLow  = l === Math.min(...windowSlice.map(c => c.low))

    if (isPivotHigh && isFarEnough(h, resistances)) {
      resistances.unshift(h)
      if (resistances.length > maxLevels) resistances.pop()
    }
    if (isPivotLow && isFarEnough(l, supports)) {
      supports.unshift(l)
      if (supports.length > maxLevels) supports.pop()
    }
  }
  return { resistances, supports }
}

// Busca el cierre más cercano a una fecha dada (± unos días, por si no coincide exacto con día de mercado)
function findNearestClose(dailyCloses: { date: string; close: number }[], targetDate: string): number | null {
  if (!dailyCloses || !dailyCloses.length) return null
  const target = new Date(targetDate.split(' ')[0]).getTime()
  let best: { close: number; diff: number } | null = null
  for (const d of dailyCloses) {
    const diff = Math.abs(new Date(d.date).getTime() - target)
    if (!best || diff < best.diff) best = { close: d.close, diff }
  }
  // si el más cercano está a más de 10 días, no es confiable — mejor no usarlo
  return best && best.diff <= 10 * 86400000 ? best.close : null
}

// Promedio propio de 5 años — cruza cada 10-K con el precio de esa fecha (no aplica a ETFs, no presentan 10-K)
function computeOwnFiveYearAvg(
  ownHistory: { year: number; endDate: string; eps: number | null; revenue: number | null; sharesOutstanding: number | null; dividendPerShare: number | null }[],
  dailyCloses: { date: string; close: number }[]
) {
  if (!ownHistory || !ownHistory.length || !dailyCloses || !dailyCloses.length) return null

  const perYear = ownHistory.map(h => {
    const price = findNearestClose(dailyCloses, h.endDate)
    if (!price) return null
    const pe = h.eps && h.eps !== 0 ? price / h.eps : null
    const ps = h.revenue && h.sharesOutstanding ? (price * h.sharesOutstanding) / h.revenue : null
    const payoutRatio = h.dividendPerShare != null && h.eps ? (h.dividendPerShare / h.eps) * 100 : null
    const dividendYield = h.dividendPerShare != null ? (h.dividendPerShare / price) * 100 : null
    return { pe, ps, payoutRatio, dividendYield }
  }).filter((v): v is NonNullable<typeof v> => v !== null)

  if (perYear.length === 0) return null

  const avg = (key: 'pe' | 'ps' | 'payoutRatio' | 'dividendYield') => {
    const vals = perYear.map(p => p[key]).filter((v): v is number => typeof v === 'number')
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null
  }
  return { pe: avg('pe'), ps: avg('ps'), payoutRatio: avg('payoutRatio'), dividendYield: avg('dividendYield'), yearsUsed: perYear.length }
}

function ChartPageInner() {
  const searchParams = useSearchParams()
  const ticker = (searchParams.get('ticker') || '').toUpperCase()

  const [interval, setIntervalSel] = useState<Interval>('1day')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showRSI, setShowRSI] = useState(true)
  const [showMACD, setShowMACD] = useState(false)
  const [showADX, setShowADX] = useState(false)
  const [showKoncorde, setShowKoncorde] = useState(false)

  const [openTrades, setOpenTrades] = useState<any[]>([])
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null)
  const [executions, setExecutions] = useState<any[]>([])
  const [chartData, setChartData] = useState<{ candles: any[]; mas: Record<string, any[]> } | null>(null)
  const [dailyStats, setDailyStats] = useState<{
    max: { price: number; date: string }; min: { price: number; date: string }
    dailyCloses: { date: string; close: number }[]
  } | null>(null)
  const [fundamentals, setFundamentals] = useState<{
    pe: number | null; ps: number | null; payoutRatio: number | null; dividendYield: number | null
    sectorAvg: { pe: number | null; ps: number | null; payoutRatio: number | null; dividendYield: number | null } | null
    peerCount: number
    ownHistory: { year: number; endDate: string; eps: number | null; revenue: number | null; sharesOutstanding: number | null; dividendPerShare: number | null }[]
  } | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const cacheRef = useRef<Record<string, any>>({})
  const dailyStatsCacheRef = useRef<Record<string, any>>({})
  const fundamentalsCacheRef = useRef<Record<string, any>>({})
  const visibleRangeRef = useRef<any>(null)

  // ── Trades abiertos para este ticker ──
  useEffect(() => {
    if (!ticker) return
    supabase
      .from('trades')
      .select('*, portfolios(name, grupo)')
      .eq('ticker', ticker)
      .eq('status', 'open')
      .then(({ data }) => {
        setOpenTrades(data || [])
        setSelectedTradeId(data && data.length > 0 ? data[0].id : null)
      })
  }, [ticker])

  const selectedTrade = openTrades.find(t => t.id === selectedTradeId) || null

  // ── Ejecuciones (compras/ventas) del trade seleccionado ──
  useEffect(() => {
    if (!selectedTradeId) { setExecutions([]); return }
    supabase
      .from('trade_executions')
      .select('*')
      .eq('trade_id', selectedTradeId)
      .order('executed_at', { ascending: true })
      .then(({ data }) => setExecutions(data || []))
  }, [selectedTradeId])

  // ── Velas + medias móviles (con caché por sesión, ticker+intervalo) ──
  const fetchChartData = useCallback(async (sym: string, iv: Interval) => {
    const cacheKey = `${sym}-${iv}`
    if (cacheRef.current[cacheKey]) {
      setChartData(cacheRef.current[cacheKey])
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/chart-data?symbol=${encodeURIComponent(sym)}&interval=${iv}`)
      const data = await res.json()
      if (data.error) { setError(data.error); setChartData(null); return }
      cacheRef.current[cacheKey] = data
      setChartData(data)
    } catch (e: any) {
      setError(String(e?.message ?? e))
      setChartData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (ticker) fetchChartData(ticker, interval)
  }, [ticker, interval, fetchChartData])

  // ── MAX/MIN histórico (10 años, siempre diario) — una sola vez por ticker ──
  useEffect(() => {
    if (!ticker) { setDailyStats(null); return }
    if (dailyStatsCacheRef.current[ticker]) {
      setDailyStats(dailyStatsCacheRef.current[ticker])
      return
    }
    fetch('/api/chart-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: ticker }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.error) return
        dailyStatsCacheRef.current[ticker] = data
        setDailyStats(data)
      })
      .catch(() => {})
  }, [ticker])

  // ── P/E, P/S, Payout, Dividend Yield + comparación sector + historial propio — una sola vez por ticker ──
  useEffect(() => {
    if (!ticker) { setFundamentals(null); return }
    if (fundamentalsCacheRef.current[ticker]) {
      setFundamentals(fundamentalsCacheRef.current[ticker])
      return
    }
    fetch(`/api/fundamentals?symbol=${encodeURIComponent(ticker)}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) return
        fundamentalsCacheRef.current[ticker] = data
        setFundamentals(data)
      })
      .catch(() => {})
  }, [ticker])

  // ── Render del gráfico ──
  useEffect(() => {
    if (!containerRef.current || !chartData || chartData.candles.length === 0) return

    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: '#080808' }, textColor: '#999' },
      grid: { vertLines: { color: '#141414' }, horzLines: { color: '#141414' } },
      width: containerRef.current.clientWidth,
      height: totalHeight,
      rightPriceScale: { borderColor: '#222' },
      timeScale: { borderColor: '#222', timeVisible: interval === '45min' },
    })
    chartRef.current = chart

    chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
      visibleRangeRef.current = range
    })

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: C.success, downColor: C.danger, borderVisible: false,
      wickUpColor: C.success, wickDownColor: C.danger, priceLineVisible: true,
      priceLineColor: '#ffffff',
    })
    candleSeries.setData(chartData.candles as any)

    // Barras de volumen
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      lastValueVisible: false,
      priceLineVisible: false,
    })

    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    })

    volumeSeries.setData(
      chartData.candles.map((c: any) => ({
        time: c.time,
        value: c.volume,
        color: c.close >= c.open
          ? 'rgba(34,197,94,0.5)'
          : 'rgba(244,63,94,0.5)',
      })) as any
    )

    const volumeMALine = chart.addSeries(LineSeries, {
      priceScaleId: 'volume',
      color: '#22c55e',
      lineWidth: 2,
      lastValueVisible: false,
      priceLineVisible: false,
    })

    const period = 20

    const volumeMA = chartData.candles.map((c: any, i: number) => {
      if (i < period - 1) {
        return {
          time: c.time,
          value: null,
        }
      }

      const avg =
        chartData.candles
          .slice(i - period + 1, i + 1)
          .reduce((sum: number, x: any) => sum + x.volume, 0) / period

      return {
        time: c.time,
        value: avg,
      }
    })

    volumeMALine.setData(
      volumeMA.filter(v => v.value !== null) as any
    )

    // Medias móviles — EMA 8/21/50/100/200 (45min y diario) o SMA 10/20/50/100/200 (semanal y mensual)
    Object.entries(chartData.mas).forEach(([key, points]) => {
      const clean = (points as any[]).filter(p => p.value !== null)
      if (!clean.length) return
      const line = chart.addSeries(LineSeries, {
        color: MA_COLORS[key] || '#888',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      })
      line.setData(clean as any)
    })

    // Costo promedio (amarillo) / TP1-3 (naranja) / Stop loss (rojo) — punteadas
    if (selectedTrade) {
      const qty = Number(selectedTrade.quantity || 0)
      const invested = Number(selectedTrade.total_invested || 0)
      const avgCost = qty > 0 ? invested / qty : Number(selectedTrade.entry_price || 0)

      if (avgCost > 0) {
        candleSeries.createPriceLine({
          price: avgCost, color: C.warning, lineWidth: 1, lineStyle: 2,
          axisLabelVisible: true,
        })
      }
      if (selectedTrade.stop_loss) {
        candleSeries.createPriceLine({
          price: Number(selectedTrade.stop_loss), color: C.danger, lineWidth: 1, lineStyle: 2,
          axisLabelVisible: true,
        })
      }
      ;[selectedTrade.take_profit_1, selectedTrade.take_profit_2, selectedTrade.take_profit_3].forEach((tp, i) => {
        if (tp) {
          candleSeries.createPriceLine({
            price: Number(tp), color: '#f97316', lineWidth: 1, lineStyle: 2,
            axisLabelVisible: true,
          })
        }
      })
    }

    // Marcadores de operaciones — color = tipo (apertura/recompra/venta parcial/cierre)
    if (executions.length > 0) {
      const sorted = [...executions].sort(
        (a, b) => new Date(a.executed_at).getTime() - new Date(b.executed_at).getTime()
      )
      let runningQty = Number(selectedTrade?.initial_quantity || 0)
      const markers = sorted.map((e, index) => {
        const isBuy = e.execution_type === 'buy'
        let color = '#888'
        if (isBuy) {
          const isOpening = index === 0
          runningQty += Number(e.quantity)
          color = isOpening ? C.success : C.accent
        } else {
          runningQty -= Number(e.quantity)
          const isFullClose = runningQty <= 0.0001
          color = isFullClose ? '#e5e5e5' : C.danger
        }
        return {
          time: e.executed_at.slice(0, 10),
          position: isBuy ? ('belowBar' as const) : ('aboveBar' as const),
          color,
          shape: isBuy ? ('arrowUp' as const) : ('arrowDown' as const),
        }
      })
      createSeriesMarkers(candleSeries, markers as any)
    }

    // Soportes y resistencias — solo en vista semanal/mensual, igual que el Pine original
    if (interval === '1week' || interval === '1month') {
      const { resistances, supports } = computePivots(chartData.candles)
      resistances.forEach(price => {
        candleSeries.createPriceLine({
          price, color: '#22d3ee', lineWidth: 1, lineStyle: 3,
          axisLabelVisible: false,
        })
      })
      supports.forEach(price => {
        candleSeries.createPriceLine({
          price, color: '#a3e635', lineWidth: 1, lineStyle: 3,
          axisLabelVisible: false,
        })
      })
    }

    // MAX/MIN histórico (10 años) — siempre visible, calculado sobre velas diarias sin importar el intervalo activo
    if (dailyStats) {
      candleSeries.createPriceLine({
        price: dailyStats.max.price, color: '#f700ff', lineWidth: 4, lineStyle: 2,
        axisLabelVisible: true, title: 'Máx',
      })
      candleSeries.createPriceLine({
        price: dailyStats.min.price, color: '#f700ff', lineWidth: 4, lineStyle: 2,
        axisLabelVisible: true, title: 'Mín',
      })
    }

    // ── Paneles de indicadores ──
    let nextPane = 1

    if (showRSI) {
      const paneIdx = nextPane++
      const rsiLine = chart.addSeries(LineSeries, { color: '#a78bfa', lineWidth: 2, lastValueVisible: false, priceLineVisible: false }, paneIdx)
      rsiLine.setData(rsiSeries(chartData.candles).filter(p => p.value !== null) as any)
      rsiLine.createPriceLine({ price: 70, color: '#f43f5e', lineWidth: 1, lineStyle: 3, axisLabelVisible: false, title: '70' })
      rsiLine.createPriceLine({ price: 30, color: '#22c55e', lineWidth: 1, lineStyle: 3, axisLabelVisible:false, title: '30' })
      rsiLine.createPriceLine({ price: 50, color: '#ffffff', lineWidth: 1, lineStyle: 3,axisLabelVisible: false})
      chart.panes()[paneIdx]?.setHeight(130)
    }

    if (showMACD) {
      const paneIdx = nextPane++
      const macdData = macdSeries(chartData.candles)
      const histSeries = chart.addSeries(HistogramSeries,{lastValueVisible: false, priceLineVisible: false}, paneIdx)
      histSeries.setData(
        macdData.filter(d => d.hist !== null).map(d => ({
          time: d.time, value: d.hist as number,
          color: (d.hist as number) >= 0 ? 'rgba(34,197,94,0.7)' : 'rgba(244,63,94,0.7)',
        })) as any
      )
      const macdLine = chart.addSeries(LineSeries, { color: C.success, lineWidth: 1, lastValueVisible: false, priceLineVisible: false }, paneIdx)
      macdLine.setData(macdData.filter(d => d.macd !== null).map(d => ({ time: d.time, value: d.macd })) as any)
      const signalLine = chart.addSeries(LineSeries, { color: C.danger, lineWidth: 1, lastValueVisible: false, priceLineVisible: false }, paneIdx)
      signalLine.setData(macdData.filter(d => d.signal !== null).map(d => ({ time: d.time, value: d.signal })) as any)
      chart.panes()[paneIdx]?.setHeight(130)
    }

    if (showADX) {
      const paneIdx = nextPane++
      const adxData = adxSeries(chartData.candles)
      const adxLine = chart.addSeries(LineSeries, { color: C.warning, lineWidth: 2, lastValueVisible: false, priceLineVisible: false }, paneIdx)
      adxLine.setData(adxData.filter(d => d.adx !== null).map(d => ({ time: d.time, value: d.adx })) as any)
      const plusDI = chart.addSeries(LineSeries, { color: C.success, lineWidth: 1, lastValueVisible: false, priceLineVisible: false }, paneIdx)
      plusDI.setData(adxData.filter(d => d.plusDI !== null).map(d => ({ time: d.time, value: d.plusDI })) as any)
      const minusDI = chart.addSeries(LineSeries, { color: C.danger, lineWidth: 1, lastValueVisible: false, priceLineVisible: false}, paneIdx)
      minusDI.setData(adxData.filter(d => d.minusDI !== null).map(d => ({ time: d.time, value: d.minusDI })) as any)
      adxLine.createPriceLine({ price: 25, color: '#666', lineWidth: 1, lineStyle: 3, axisLabelVisible: false, title: '25' })
      chart.panes()[paneIdx]?.setHeight(130)
    }

    if (showKoncorde) {
      const paneIdx = nextPane++
      const konData = koncordeSeries(chartData.candles)
      const verdeLine = chart.addSeries(LineSeries, { color: '#f97316', lineWidth: 2, lastValueVisible: false, priceLineVisible: false }, paneIdx)
      verdeLine.setData(konData.map(d => ({ time: d.time, value: d.verde })) as any)
      const marronLine = chart.addSeries(LineSeries, { color: '#22c55e', lineWidth: 2, lastValueVisible: false, priceLineVisible: false }, paneIdx)
      marronLine.setData(konData.map(d => ({ time: d.time, value: d.marron })) as any)
      const azulLine = chart.addSeries(LineSeries, { color: '#00FFFF', lineWidth: 1, lastValueVisible: false, priceLineVisible: false }, paneIdx)
      azulLine.setData(konData.map(d => ({ time: d.time, value: d.azul })) as any)
      const mediaLine = chart.addSeries(LineSeries, { color: '#f43f5e', lineWidth: 1, lastValueVisible: false, priceLineVisible: false }, paneIdx)
      mediaLine.setData(konData.map(d => ({ time: d.time, value: d.media })) as any)
      mediaLine.createPriceLine({ price: 0, color: '#ffffff', lineWidth: 1, lineStyle: 3, axisLabelVisible: false})
      chart.panes()[paneIdx]?.setHeight(130)
    }

    if (visibleRangeRef.current) {
      chart.timeScale().setVisibleLogicalRange(visibleRangeRef.current)
    } else {
      chart.timeScale().fitContent()
    }

    const handleResize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth })
    }
    window.addEventListener('resize', handleResize)

    return () => {
      visibleRangeRef.current =
        chart.timeScale().getVisibleLogicalRange()

      window.removeEventListener('resize', handleResize)

      chart.remove()

      chartRef.current = null
    }
  }, [chartData, selectedTrade, executions, interval, dailyStats, showRSI, showMACD, showADX, showKoncorde])

  const badge = selectedTrade
    ? getPortfolioBadge(selectedTrade.portfolios?.name, selectedTrade.portfolios?.grupo)
    : null

  // Calculamos la altura total del gráfico
  // Altura fija del gráfico.
  // Siempre reserva espacio para todos los paneles para evitar que el gráfico cambie de tamaño.
  const totalHeight = 700

  const lastClose = chartData?.candles?.length ? chartData.candles[chartData.candles.length - 1].close : null
  const pctToMax = dailyStats && lastClose ? ((dailyStats.max.price - lastClose) / lastClose) * 100 : null
  const pctToMin = dailyStats && lastClose ? ((lastClose - dailyStats.min.price) / lastClose) * 100 : null

  const ownFiveYearAvg = fundamentals && dailyStats
    ? computeOwnFiveYearAvg(fundamentals.ownHistory, dailyStats.dailyCloses)
    : null

  return (
    <AppShell>
      <div style={{ maxWidth: 1400, margin: '20px auto', padding: '0 28px', color: 'white' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
          <BarChart2 size={20} color={C.accent} />
          <h1 style={{ fontSize: 18, fontWeight: 900, margin: 0 }}>
            {ticker || 'Selecciona un ticker'}
          </h1>
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
          {pctToMax !== null && (
            <span style={{ fontSize: 10, color: '#f700ff' }}>
              +{pctToMax.toFixed(1)}% al máx 10a
            </span>
          )}
          {pctToMin !== null && (
            <span style={{ fontSize: 10, color: '#f700ff' }}>
              -{pctToMin.toFixed(1)}% al mín 10a
            </span>
          )}
        </div>

        {fundamentals && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 14px', marginBottom: 16, maxWidth: 620 }}>
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
                {[
                  { label: 'P/E',       own: fundamentals.pe,            sector: fundamentals.sectorAvg?.pe ?? null,            avg5y: ownFiveYearAvg?.pe ?? null,            suffix: '', higherIsBetter: false },
                  { label: 'P/S',       own: fundamentals.ps,            sector: fundamentals.sectorAvg?.ps ?? null,            avg5y: ownFiveYearAvg?.ps ?? null,            suffix: '', higherIsBetter: false },
                  { label: 'Payout',    own: fundamentals.payoutRatio,   sector: fundamentals.sectorAvg?.payoutRatio ?? null,   avg5y: ownFiveYearAvg?.payoutRatio ?? null,   suffix: '%', higherIsBetter: false },
                  { label: 'Div Yield', own: fundamentals.dividendYield, sector: fundamentals.sectorAvg?.dividendYield ?? null, avg5y: ownFiveYearAvg?.dividendYield ?? null, suffix: '%', higherIsBetter: true },
                ].map(row => {
                  const diffSector = (row.own != null && row.sector != null && row.sector !== 0)
                    ? ((row.own - row.sector) / Math.abs(row.sector)) * 100
                    : null
                  const diff5y = (row.own != null && row.avg5y != null && row.avg5y !== 0)
                    ? ((row.own - row.avg5y) / Math.abs(row.avg5y)) * 100
                    : null
                  const isGoodSector = diffSector == null ? null : row.higherIsBetter ? diffSector >= 0 : diffSector <= 0
                  const isGood5y = diff5y == null ? null : row.higherIsBetter ? diff5y >= 0 : diff5y <= 0
                  return (
                    <tr key={row.label} style={{ borderTop: '1px solid #151515' }}>
                      <td style={{ padding: '4px 6px', color: '#aaa' }}>{row.label}</td>
                      <td style={{ padding: '4px 6px', textAlign: 'right', color: '#fff', fontWeight: 700 }}>
                        {row.own != null ? `${row.own.toFixed(2)}${row.suffix}` : '—'}
                      </td>
                      <td style={{ padding: '4px 6px', textAlign: 'right', color: '#888' }}>
                        {row.sector != null ? `${row.sector.toFixed(2)}${row.suffix}` : '—'}
                      </td>
                      <td style={{ padding: '4px 6px', textAlign: 'right', fontWeight: 700, color: isGoodSector == null ? '#444' : isGoodSector ? C.success : C.danger }}>
                        {diffSector != null ? `${diffSector >= 0 ? '+' : ''}${diffSector.toFixed(1)}%` : '—'}
                      </td>
                      <td style={{ padding: '4px 6px', textAlign: 'right', color: '#888' }}>
                        {row.avg5y != null ? `${row.avg5y.toFixed(2)}${row.suffix}` : '—'}
                      </td>
                      <td style={{ padding: '4px 6px', textAlign: 'right', fontWeight: 700, color: isGood5y == null ? '#444' : isGood5y ? C.success : C.danger }}>
                        {diff5y != null ? `${diff5y >= 0 ? '+' : ''}${diff5y.toFixed(1)}%` : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {(['45min', '1day', '1week', '1month'] as Interval[]).map(iv => (
            <button key={iv} onClick={() => setIntervalSel(iv)} disabled={loading} style={filterBtn(interval === iv)}>
              {iv === '45min' ? '45 min' : iv === '1day' ? 'Diario' : iv === '1week' ? 'Semanal' : 'Mensual'}
            </button>
          ))}
          <span style={{ width: 1, background: '#222', margin: '2px 4px' }} />
          <button onClick={() => setShowRSI(v => !v)} style={filterBtn(showRSI)}>RSI</button>
          <button onClick={() => setShowMACD(v => !v)} style={filterBtn(showMACD)}>MACD</button>
          <button onClick={() => setShowADX(v => !v)} style={filterBtn(showADX)}>ADX</button>
          <button onClick={() => setShowKoncorde(v => !v)} style={filterBtn(showKoncorde)}>Koncorde</button>
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
            <div ref={containerRef} style={{ width: '100%', height: totalHeight }} />
          </div>
        )}

        <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 10, color: '#888', flexWrap: 'wrap' }}>
          <span><span style={{ color: C.success }}>▲</span> Apertura</span>
          <span><span style={{ color: C.accent }}>▲</span> Recompra</span>
          <span><span style={{ color: C.danger }}>▼</span> Venta parcial</span>
          <span><span style={{ color: '#e5e5e5' }}>▼</span> Cierre total</span>
          <span style={{ color: '#444' }}>|</span>
          <span><span style={{ color: C.warning }}>┄</span> Costo promedio</span>
          <span><span style={{ color: '#f97316' }}>┄</span> TP1 / TP2 / TP3</span>
          <span><span style={{ color: C.danger }}>┄</span> Stop loss</span>
        </div>

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