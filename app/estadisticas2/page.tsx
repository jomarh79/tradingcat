'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { usePrivacy } from '@/lib/PrivacyContext'
import AppShell from '../AppShell'
import { TrendingUp } from 'lucide-react'
import {
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  BarChart, Bar, PieChart, Pie, Cell,
  AreaChart, Area, LineChart, Line, ReferenceLine, ComposedChart,
} from 'recharts'

const parseDate = (d: string) => new Date((d || '').split('T')[0] + 'T00:00:00')

const C = {
  gain:    '#22c55e',
  loss:    '#f43f5e',
  accent:  '#00bfff',
  sp500:   '#a78bfa',
  warning: '#eab308',
  card:    '#080808',
  border:  '#1a1a1a',
  muted:   '#888',
}

const PIE_COLORS = ['#00bfff','#6366f1','#22c55e','#eab308','#f43f5e','#a855f7','#ec4899','#14b8a6','#f97316','#84cc16']

// ── Cat decorators ─────────────────────────────────────────────────────────
const Paw = ({ size = 14, color = '#666', opacity = 1, style: s = {} }: any) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ opacity, flexShrink: 0, ...s }}>
    <ellipse cx="6"  cy="5"  rx="2.5" ry="3"/>
    <ellipse cx="11" cy="3"  rx="2.5" ry="3"/>
    <ellipse cx="16" cy="4"  rx="2.5" ry="3"/>
    <ellipse cx="19" cy="9"  rx="2"   ry="2.5"/>
    <path d="M12 22c-5 0-8-3-8-7 0-2.5 1.5-4.5 4-5.5 1-.4 2-.6 4-.6s3 .2 4 .6c2.5 1 4 3 4 5.5 0 4-3 7-8 7z"/>
  </svg>
)
const CatEars = ({ color = '#00bfff', opacity = 0.1, size = 40 }: any) => (
  <svg width={size * 1.5} height={size} viewBox="0 0 60 40" fill={color} style={{ opacity }}>
    <polygon points="0,40 12,0 24,40"/>
    <polygon points="36,40 48,0 60,40"/>
  </svg>
)
const Whiskers = ({ color = '#888', opacity = 0.1, width = 90 }: any) => (
  <svg width={width} height={32} viewBox={`0 0 ${width} 32`} stroke={color} strokeWidth="1.5" style={{ opacity }}>
    <line x1="0" y1="8"  x2={width * 0.44} y2="16"/>
    <line x1="0" y1="16" x2={width * 0.44} y2="16"/>
    <line x1="0" y1="24" x2={width * 0.44} y2="16"/>
    <line x1={width} y1="8"  x2={width * 0.56} y2="16"/>
    <line x1={width} y1="16" x2={width * 0.56} y2="16"/>
    <line x1={width} y1="24" x2={width * 0.56} y2="16"/>
  </svg>
)
const CatTail = ({ color = '#00bfff', opacity = 0.07 }: any) => (
  <svg width={46} height={76} viewBox="0 0 50 80" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" style={{ opacity }}>
    <path d="M40 80 Q45 50 20 40 Q0 30 10 10 Q20 -5 35 5"/>
  </svg>
)
const CatSitting = ({ size = 60, color = '#00bfff', opacity = 0.06 }: any) => (
  <svg width={size} height={size * 1.3} viewBox="0 0 50 65" fill={color} style={{ opacity }}>
    <polygon points="10,18 15,5 22,18"/>
    <polygon points="28,18 35,5 40,18"/>
    <ellipse cx="25" cy="24" rx="14" ry="12"/>
    <ellipse cx="25" cy="46" rx="13" ry="14"/>
    <path d="M38 56 Q50 48 46 38 Q42 30 38 36" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round"/>
  </svg>
)

const CatTooltip = ({ active, payload, label, formatter, labelFormatter }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#0a0a0a', border: '1px solid #333', borderRadius: 8, padding: '10px 14px', fontSize: 11 }}>
      {label && <div style={{ color: '#aaa', marginBottom: 6, fontWeight: 600 }}>
        {labelFormatter ? labelFormatter(label) : label}
      </div>}
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, display: 'inline-block' }} />
          <span style={{ color: '#888' }}>{p.name}:</span>
          <span style={{ color: '#fff', fontWeight: 700 }}>
            {formatter ? formatter(p.value, p.name) : p.value}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function EstadisticasCerradosPage() {
  const { money } = usePrivacy()

  const [trades,            setTrades]            = useState<any[]>([])
  const [portfolios,        setPortfolios]        = useState<any[]>([])
  const [selectedPortfolio, setSelectedPortfolio] = useState('all')
  const [selectedYear,      setSelectedYear]      = useState(new Date().getFullYear().toString())
  const [loading,           setLoading]           = useState(true)
  const [sp500Map,          setSp500Map]          = useState<Record<string, number>>({})
  const [equityPeriod,      setEquityPeriod]      = useState<'YTD' | '1Y' | '5Y' | 'MAX'>('YTD')

  const fetchData = useCallback(async () => {
    const [{ data: pData }, { data: tData }] = await Promise.all([
      supabase.from('portfolios').select('*'),
      supabase.from('trades').select('*, portfolios(name, id), trade_executions(quantity, price, commission, execution_type)').eq('status', 'closed'),
    ])
    if (pData) setPortfolios(pData)
    if (tData) setTrades(tData)
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchData()
    try {
      const cached = localStorage.getItem('sp500')
      if (cached) {
        const parsed: { date: string, close: number }[] = JSON.parse(cached)
        const map: Record<string, number> = {}
        parsed.forEach(d => { map[d.date] = d.close })
        setSp500Map(map)
      }
    } catch (e) { console.error('SP500 cache:', e) }
  }, [fetchData])

  const availableYears = useMemo(() => {
    const years = trades.map(t => parseDate(t.close_date || t.open_date).getFullYear().toString())
    return Array.from(new Set(years)).sort((a, b) => b.localeCompare(a))
  }, [trades])

  const filteredTrades = useMemo(() => trades.filter(t => {
    const matchP = selectedPortfolio === 'all' || t.portfolio_id === selectedPortfolio
    const matchY = selectedYear === 'all' || parseDate(t.close_date || t.open_date).getFullYear().toString() === selectedYear
    return matchP && matchY
  }), [trades, selectedPortfolio, selectedYear])

  const calcInvested = useCallback((t: any): number => {
    const initialInv = Number(t.initial_entry_price || t.entry_price || 0) * Number(t.initial_quantity || t.quantity || 0)
    const buyExtra = (t.trade_executions || [])
      .filter((e: any) => e.execution_type === 'buy')
      .reduce((a: number, e: any) => a + Number(e.quantity) * Number(e.price) + Number(e.commission || 0), 0)
    return parseFloat((initialInv + buyExtra).toFixed(2))
  }, [])

  // ── Métricas y tarjetas (números, rachas, top trades) ─────────────────────
  const stats = useMemo(() => {
    if (!filteredTrades.length) return null

    const sorted = [...filteredTrades].sort(
      (a, b) => parseDate(a.close_date).getTime() - parseDate(b.close_date).getTime()
    )

    const totalTrades = sorted.length
    const wins   = sorted.filter(t => Number(t.realized_pnl) > 0)
    const losses = sorted.filter(t => Number(t.realized_pnl) < 0)
    const breakEven = sorted.filter(t => Number(t.realized_pnl) === 0)

    const totalPnL  = parseFloat(sorted.reduce((acc, t) => acc + Number(t.realized_pnl || 0), 0).toFixed(2))
    const totalInvestedPnL = sorted.reduce((acc, t) => acc + calcInvested(t), 0)

    const totalPnLPct = totalInvestedPnL > 0 ? parseFloat(((totalPnL / totalInvestedPnL) * 100).toFixed(2)) : 0
    const totalWin  = parseFloat(wins.reduce((acc, t)   => acc + Number(t.realized_pnl || 0), 0).toFixed(2))
    const totalLoss = parseFloat(losses.reduce((acc, t)  => acc + Math.abs(Number(t.realized_pnl || 0)), 0).toFixed(2))

    const winRate      = parseFloat(((wins.length / totalTrades) * 100).toFixed(1))
    const avgWin       = wins.length   ? parseFloat((totalWin  / wins.length).toFixed(2))   : 0
    const avgLoss      = losses.length ? parseFloat((totalLoss / losses.length).toFixed(2)) : 0
    const winLossRatio = avgLoss > 0   ? parseFloat((avgWin / avgLoss).toFixed(2))          : 0
    const profitFactor = totalLoss > 0 ? parseFloat((totalWin / totalLoss).toFixed(2))      : totalWin > 0 ? 100 : 0
    const expectancy   = parseFloat((((winRate / 100) * avgWin) - ((1 - winRate / 100) * avgLoss)).toFixed(2))

    const avgDuration = parseFloat((
      sorted.reduce((acc, t) => {
        const days = Math.max(1, Math.ceil(
          Math.abs(parseDate(t.close_date).getTime() - parseDate(t.open_date).getTime()) / 86400000
        ))
        return acc + days
      }, 0) / totalTrades
    ).toFixed(1))

  // Streaks, drawdown, equity
let equity = 0, peak = 0, maxDD = 0
let winStrk = 0, maxWinStrk = 0, lossStrk = 0, maxLossStrk = 0

sorted.forEach(t => {
  const pnl = Number(t.realized_pnl || 0)

  equity += pnl

  if (equity > peak) peak = equity

  const dd = peak - equity

  if (dd > maxDD) maxDD = dd

  if (pnl > 0) {
    winStrk++
    lossStrk = 0
    if (winStrk > maxWinStrk) maxWinStrk = winStrk
  } else {
    lossStrk++
    winStrk = 0
    if (lossStrk > maxLossStrk) maxLossStrk = lossStrk
  }
})

const recoveryFactor =
  maxDD > 0
    ? parseFloat((totalPnL / maxDD).toFixed(2))
    : null

    const tradesWithPct = sorted.map(t => {
      const invested = calcInvested(t)
      const pnl = Number(t.realized_pnl || 0)
      return invested > 0 ? (pnl / invested) * 100 : 0
    })
    const avgReturnPct = tradesWithPct.length > 0
      ? parseFloat((tradesWithPct.reduce((acc, pct) => acc + pct, 0) / tradesWithPct.length).toFixed(2))
      : 0

    const withPct = sorted.map(t => ({
      ...t,
      pct: calcInvested(t) > 0 ? (Number(t.realized_pnl) / calcInvested(t)) * 100 : 0,
    }))
    const bestTradePct  = [...withPct].sort((a, b) => b.pct - a.pct)[0]
    const worstTradePct = [...withPct].sort((a, b) => a.pct - b.pct)[0]

    // Mejor y peor mes (solo para las tarjetas de rachas — el detalle completo está en "Resumen por mes")
    const monthlyStats: Record<string, { count: number, pnl: number, wins: number }> = {}
    sorted.forEach(t => {
      const key = parseDate(t.close_date).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })
      if (!monthlyStats[key]) monthlyStats[key] = { count: 0, pnl: 0, wins: 0 }
      monthlyStats[key].count++
      monthlyStats[key].pnl = parseFloat((monthlyStats[key].pnl + Number(t.realized_pnl || 0)).toFixed(2))
      if (Number(t.realized_pnl || 0) > 0) monthlyStats[key].wins++
    })
    const monthEntries = Object.entries(monthlyStats)
    const bestMonth  = [...monthEntries].sort(([, a], [, b]) => b.pnl - a.pnl)[0]
    const worstMonth = [...monthEntries].sort(([, a], [, b]) => a.pnl - b.pnl)[0]

    return {
      totalTrades, totalPnL, totalPnLPct, winRate, profitFactor, expectancy,
      avgWin, avgLoss, winLossRatio, maxDD: parseFloat(maxDD.toFixed(2)),
      maxWinStrk, maxLossStrk, avgDuration,
      bestMonth, worstMonth,
      topWinners: [...sorted].sort((a, b) => Number(b.realized_pnl) - Number(a.realized_pnl)).slice(0, 5),
      topLosers:  [...sorted].sort((a, b) => Number(a.realized_pnl) - Number(b.realized_pnl)).slice(0, 5),
      recoveryFactor, avgReturnPct,
      bestTradePct, worstTradePct,
      winsCount: wins.length, lossesCount: losses.length, breakEvenCount: breakEven.length,
    }
  }, [filteredTrades, calcInvested])

  // ── Gráficas ────────────────────────────────────────────────────────────
  const charts = useMemo(() => {
    if (!filteredTrades.length) return null

    const sorted = [...filteredTrades].sort(
      (a, b) => parseDate(a.close_date).getTime() - parseDate(b.close_date).getTime()
    )

    let equity = 0, peak = 0

    const firstDateStr = sorted[0].close_date
    const sp500Prices  = Object.entries(sp500Map).sort(([a], [b]) => a.localeCompare(b))
    const sp500Base    = sp500Map[firstDateStr] ||
      sp500Prices.reverse().find(([d]) => d <= firstDateStr)?.[1] || null

    const drawdownCurve: any[] = []
    const sp500Curve: any[]    = []
    const monthly: Record<string, { pnl: number, wins: number, trades: number }> = {}
    const sector: Record<string, { pnl: number, count: number }> = {}
    const weekday: Record<string, number> = {}
    const closeReason: Record<string, { pnl: number, count: number }> = {}
    const pnlDistribution: any[] = []
    const durationBuckets: Record<string, number> = {
      '1-7 días': 0, '8-30 días': 0, '31-90 días': 0, '+90 días': 0
    }
    const monthlyWaterfall: any[] = []

    sorted.forEach(t => {
      const pnl      = Number(t.realized_pnl) || 0
      const thisDate = parseDate(t.close_date)
      const tradeDays = Math.max(1, Math.ceil(
        Math.abs(parseDate(t.close_date).getTime() - parseDate(t.open_date).getTime()) / 86400000
      ))

      if      (tradeDays <= 7)  durationBuckets['1-7 días']++
      else if (tradeDays <= 30) durationBuckets['8-30 días']++
      else if (tradeDays <= 90) durationBuckets['31-90 días']++
      else                      durationBuckets['+90 días']++

      equity += pnl
      if (equity > peak) peak = equity
      const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0

      const label = thisDate.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })
      drawdownCurve.push({ date: label, rawDate: t.close_date, drawdown: parseFloat((-dd).toFixed(2)) })

      const closeDateStr = t.close_date
      const sp500Current = sp500Map[closeDateStr] ||
        Object.entries(sp500Map).sort(([a],[b]) => b.localeCompare(a)).find(([d]) => d <= closeDateStr)?.[1] || null
      const sp500Pct = sp500Base && sp500Current
        ? parseFloat(((sp500Current - sp500Base) / sp500Base * equity).toFixed(2))
        : null

      sp500Curve.push({
        date: label,
        rawDate: t.close_date,
        Portafolio: parseFloat(equity.toFixed(2)),
        'S&P 500':  sp500Pct,
      })

      const m = thisDate.toLocaleDateString('es-MX', { year: 'numeric', month: 'short' })
      if (!monthly[m]) monthly[m] = { pnl: 0, wins: 0, trades: 0 }
      monthly[m].pnl += pnl
      monthly[m].trades++
      if (pnl > 0) monthly[m].wins++

      const s = t.sector || 'Otros'
      if (!sector[s]) sector[s] = { pnl: 0, count: 0 }
      sector[s].pnl   += pnl
      sector[s].count++

      const d = thisDate.toLocaleDateString('es-MX', { weekday: 'short' })
      weekday[d] = (weekday[d] || 0) + pnl

      const r = t.close_reason || 'Sin especificar'
      if (!closeReason[r]) closeReason[r] = { pnl: 0, count: 0 }
      closeReason[r].pnl   += pnl
      closeReason[r].count++

      const invReal = calcInvested(t)
      const pnlPct  = invReal > 0 ? parseFloat(((pnl / invReal) * 100).toFixed(1)) : 0
      pnlDistribution.push({ ticker: t.ticker, pnlPct, color: pnl >= 0 ? C.gain : C.loss })
    })

    const MONTH_ORDER = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
    const sortedByMonth = Object.entries(monthly).sort(([a], [b]) => {
      const partsA   = a.replace('.','').split(' ')
      const partsB   = b.replace('.','').split(' ')
      const yearDiff = parseInt(partsA[1]) - parseInt(partsB[1])
      if (yearDiff !== 0) return yearDiff
      return MONTH_ORDER.indexOf(partsA[0].toLowerCase().slice(0,3)) - MONTH_ORDER.indexOf(partsB[0].toLowerCase().slice(0,3))
    })

    let cumPnl = 0
    sortedByMonth.forEach(([month, d]: [string, any]) => {
      const val = parseFloat(d.pnl.toFixed(2))
      monthlyWaterfall.push({
        month,
        value:  val,
        base:   val >= 0 ? cumPnl : cumPnl + val,
        cumPnl: parseFloat((cumPnl + val).toFixed(2)),
        fill:   val >= 0 ? '#22c55e' : '#f43f5e',
      })
      cumPnl += val
    })

    const now2    = new Date()
    const periods = [
      { label: '1 mes',   months: 1  },
      { label: '3 meses', months: 3  },
      { label: '6 meses', months: 6  },
      { label: '1 año',   months: 12 },
      { label: '3 años',  months: 36 },
      { label: '5 años',  months: 60 },
    ]
    const periodRows = periods.map(p => {
      const cutoff        = new Date(now2.getFullYear(), now2.getMonth() - p.months, now2.getDate())
      const periodTrades  = sorted.filter(t => parseDate(t.close_date) >= cutoff)
      const periodInv     = periodTrades.reduce((a, t) => a + calcInvested(t), 0)
      const periodPnl     = periodTrades.reduce((a, t) => a + Number(t.realized_pnl || 0), 0)
      const portRend      = periodInv > 0 ? parseFloat((periodPnl / periodInv * 100).toFixed(2)) : null
      const cutoffStr     = cutoff.toISOString().split('T')[0]
      const sp500Keys     = Object.keys(sp500Map).sort()
      const sp500StartKey = sp500Keys.filter(k => k <= cutoffStr).slice(-1)[0]
      const sp500EndKey   = sp500Keys.slice(-1)[0]
      const sp500Start    = sp500StartKey ? sp500Map[sp500StartKey] : null
      const sp500End      = sp500EndKey   ? sp500Map[sp500EndKey]   : null
      const sp500Rend     = sp500Start && sp500End
        ? parseFloat(((sp500End - sp500Start) / sp500Start * 100).toFixed(2))
        : null
      const diff = portRend !== null && sp500Rend !== null
        ? parseFloat((portRend - sp500Rend).toFixed(2))
        : null
      return { label: p.label, portRend, sp500Rend, diff }
    }).reverse()

    return {
      drawdownCurve, sp500Curve, monthlyWaterfall,
      durationData: Object.entries(durationBuckets).map(([bucket, count]) => ({ bucket, count })),
      sectorData: Object.entries(sector)
        .map(([name, d]) => ({ name, value: parseFloat(d.pnl.toFixed(2)), count: d.count }))
        .sort((a, b) => b.value - a.value),
      weekdayData: (() => {
        const DAY_ORDER = ['lun','mar','mié','jue','vie','sáb','dom']
        return Object.entries(weekday)
          .map(([day, pnl]) => ({ day, pnl: parseFloat((pnl as number).toFixed(2)) }))
          .sort((a, b) => {
            const ia = DAY_ORDER.findIndex(d => a.day.toLowerCase().startsWith(d))
            const ib = DAY_ORDER.findIndex(d => b.day.toLowerCase().startsWith(d))
            return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
          })
      })(),
      closeReasonData: Object.entries(closeReason)
        .map(([reason, d]) => ({ reason, pnl: parseFloat(d.pnl.toFixed(2)), count: d.count }))
        .sort((a, b) => b.count - a.count),
      pnlDistribution: pnlDistribution.sort((a, b) => a.pnlPct - b.pnlPct),
      periodRows,
      scatterData: sorted.map(t => {
        const inv = calcInvested(t)
        const pnl = Number(t.realized_pnl || 0)
        const days = Math.max(1, Math.ceil(
          Math.abs(parseDate(t.close_date).getTime() - parseDate(t.open_date).getTime()) / 86400000
        ))
        const pnlPct = inv > 0 ? parseFloat(((pnl / inv) * 100).toFixed(2)) : 0
        return { ticker: t.ticker, days, pnlPct, pnl: parseFloat(pnl.toFixed(2)), color: pnl >= 0 ? C.gain : C.loss }
      }),
      monthlyTable: sortedByMonth.map(([month, d]: [string, any]) => ({
        month,
        pnl:     parseFloat(d.pnl.toFixed(2)),
        trades:  d.trades,
        wins:    d.wins,
        losses:  d.trades - d.wins,
        winRate: d.trades > 0 ? Math.round((d.wins / d.trades) * 100) : 0,
      })).sort((a, b) => b.pnl - a.pnl),
    }
  }, [filteredTrades, sp500Map, calcInvested])

  const fmtMoney = (v: number) => money(v)

  const periodCutoff = (p: 'YTD' | '1Y' | '5Y' | 'MAX'): Date => {
    const now = new Date()
    if (p === 'YTD') return new Date(now.getFullYear(), 0, 1)
    if (p === '1Y')  return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())
    if (p === '5Y')  return new Date(now.getFullYear() - 5, now.getMonth(), now.getDate())
    return new Date(2000, 0, 1)
  }
  const cutoff = periodCutoff(equityPeriod)
  const filterCurve = (data: any[]) => data.filter(d => !d.rawDate || new Date(d.rawDate + 'T00:00:00') >= cutoff)
  const drawdownFiltered = charts ? filterCurve(charts.drawdownCurve) : []
  const sp500Filtered    = charts ? filterCurve(charts.sp500Curve)    : []

  const PeriodSelector = () => (
    <div style={{ display: 'flex', gap: 2, background: '#050505', padding: 3, borderRadius: 8, border: '1px solid #111' }}>
      {(['YTD', '1Y', '5Y', 'MAX'] as const).map(p => (
        <button key={p} onClick={() => setEquityPeriod(p)} style={{
          background: equityPeriod === p ? '#1a1a1a' : 'transparent',
          border: equityPeriod === p ? '1px solid #2a2a2a' : '1px solid transparent',
          color: equityPeriod === p ? '#fff' : '#444',
          padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
          fontSize: 11, fontWeight: equityPeriod === p ? 700 : 400,
        }}>{p}</button>
      ))}
    </div>
  )

  if (loading) return (
    <AppShell>
      <div style={{ padding: 40, color: '#888', display: 'flex', alignItems: 'center', gap: 10 }}>
        <Paw size={16} color="#888" opacity={0.5} /> Cargando análisis...
      </div>
    </AppShell>
  )

  return (
    <AppShell>
      <div style={{ maxWidth: 1400, margin: '20px auto', padding: '0 28px', color: 'white', position: 'relative' }}>

        {/* ── Gatos decorativos ── */}
        <div style={{ position: 'absolute', top: -4, right: 50, pointerEvents: 'none' }}>
          <CatEars color="#00bfff" opacity={0.14} size={46} />
        </div>
        <div style={{ position: 'absolute', right: -8, top: '20%', pointerEvents: 'none' }}>
          <CatTail color="#22c55e" opacity={0.09} />
        </div>
        <div style={{ position: 'absolute', left: 0, top: '60%', pointerEvents: 'none' }}>
          <CatSitting size={70} color="#00bfff" opacity={0.05} />
        </div>

        {/* ── HEADER ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 22 }}>
          <Paw size={22} color="#22c55e" opacity={0.7} />
          <Paw size={16} color="#22c55e" opacity={0.4} />
          <Paw size={10} color="#22c55e" opacity={0.2} />
          <TrendingUp size={20} color="#00bfff" />
          <h1 style={{ fontSize: 18, fontWeight: 900, margin: 0 }}>Performance histórico — trades cerrados</h1>
        </div>

        {/* ── FILTROS ── */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 26, flexWrap: 'wrap', alignItems: 'center', borderBottom: '1px solid #1a1a1a', paddingBottom: 14 }}>
          <select value={selectedYear} onChange={e => setSelectedYear(e.target.value)} style={selectStyle}>
            <option value="all">Todos los años</option>
            {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          {[{ id: 'all', name: 'Todos' }, ...portfolios].map(p => (
            <button key={p.id} onClick={() => setSelectedPortfolio(p.id)} style={filterBtn(selectedPortfolio === p.id)}>
              {p.name}
            </button>
          ))}
        </div>

        {!stats || !charts ? (
          <div style={{ textAlign: 'center', padding: 80, color: '#666', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <CatSitting size={60} color="#444" opacity={0.4} />
            <Paw size={24} color="#333" opacity={0.5} />
            <span>No hay trades cerrados para este filtro.</span>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 14 }}>

            {/* ── F1: KPIs principales ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 12 }}>
              <StatCard
                label="PnL total acumulado / %"
                value={`${money(stats.totalPnL)} / ${stats.totalPnLPct.toFixed(1)}%`}
                color={stats.totalPnL > 0 ? '#22c55e' : stats.totalPnL < 0 ? '#f43f5e' : '#00bfff'}
                pawColor={stats.totalPnL > 0 ? '#22c55e' : stats.totalPnL < 0 ? '#f43f5e' : '#00bfff'}
              />
              <StatCard label="Win rate" value={`${stats.winRate}%`}
                desc={`${stats.winsCount} ganados · ${stats.lossesCount} perdidos${stats.breakEvenCount ? ` · ${stats.breakEvenCount} BE` : ''}`}
                color="#fff" bar={stats.winRate} pawColor="#fff" />
              <StatCard label="Profit factor" value={String(stats.profitFactor)}
                desc={stats.profitFactor >= 1.5 ? 'Sistema rentable' : stats.profitFactor >= 1 ? 'Marginalmente rentable' : 'Sistema con pérdidas'}
                color={stats.profitFactor >= 1.5 ? '#22c55e' : stats.profitFactor >= 1 ? '#eab308' : '#f43f5e'}
                pawColor="#eab308" />
              <StatCard label="Expectativa por trade" value={money(stats.expectancy)}
                desc={`Ganas en promedio ${money(Math.abs(stats.expectancy))} por operación`}
                color="#00bfff" pawColor="#00bfff" />
              <StatCard label="Rendimiento % promedio / trade" value={`${stats.avgReturnPct}%`}
                desc="Por trade vs capital invertido"
                color={stats.avgReturnPct >= 0 ? '#22c55e' : '#f43f5e'} pawColor="#a78bfa" />
              <StatCard
                label="Recovery Factor"
                value={stats.recoveryFactor !== null ? String(stats.recoveryFactor) : '—'}
                desc={
                  stats.recoveryFactor !== null
                    ? stats.recoveryFactor >= 5
                      ? 'Excelente recuperación'
                      : stats.recoveryFactor >= 3
                        ? 'Muy buena recuperación'
                        : stats.recoveryFactor >= 2
                          ? 'Buena recuperación'
                          : stats.recoveryFactor >= 1
                            ? 'Recuperación aceptable'
                            : 'Recuperación deficiente'
                    : 'Sin drawdown registrado'
                }
                color={
                  stats.recoveryFactor !== null
                    ? (stats.recoveryFactor >= 2 ? '#22c55e' : stats.recoveryFactor >= 1 ? '#eab308' : '#f43f5e')
                    : '#888'
                }
                pawColor="#a78bfa"
              />
              <StatCard label="Duración promedio" value={`${stats.avgDuration} días`}
                desc="En cerrar una posición" color="#888" pawColor="#888" />
            </div>

            {/* ── F2: Eficiencia + Drawdown máx + Rachas ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 }}>

              <div style={{ ...box, position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', bottom: -8, right: -8, pointerEvents: 'none' }}>
                  <Paw size={56} color="#00bfff" opacity={0.04} />
                </div>
                <div style={boxTitle}>
                  <Paw size={10} color="#00bfff" opacity={0.7} style={{ marginRight: 6 }} />
                  Eficiencia de trade
                </div>
                <Row label="Ganancia promedio"  value={money(stats.avgWin)}  color="#22c55e" />
                <Row label="Pérdida promedio"   value={money(stats.avgLoss)} color="#f43f5e" />
                <Row label="Ratio Win/Loss"     value={`${stats.winLossRatio}x`}
                  color={stats.winLossRatio >= 1 ? '#22c55e' : '#f43f5e'} />
                <div style={{ marginTop: 10, fontSize: 9, color: '#888' }}>
                  {stats.winLossRatio >= 1 ? 'Ganas más de lo que pierdes' : 'Pierdes más de lo que ganas'}
                </div>
              </div>

              <div style={{ ...box, position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', bottom: -8, right: -8, pointerEvents: 'none' }}>
                  <Paw size={56} color="#f43f5e" opacity={0.04} />
                </div>
                <div style={boxTitle}>
                  <Paw size={10} color="#f43f5e" opacity={0.7} style={{ marginRight: 6 }} />
                  Drawdown máximo
                </div>
                <div style={{ fontSize: 22, fontWeight: 900, color: '#f43f5e' }}>{money(stats.maxDD)}</div>
                <div style={{ fontSize: 10, color: '#888', marginTop: 4 }}>Caída máxima desde el pico de equity</div>
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 9, color: '#888', fontWeight: 700, textTransform: 'uppercase' as const, marginBottom: 4, letterSpacing: 0.5 }}>
                    Mejor trade (%)
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#22c55e' }}>
                    {stats.bestTradePct?.ticker} · +{stats.bestTradePct?.pct.toFixed(1)}%
                  </div>
                  <div style={{ fontSize: 9, color: '#888', fontWeight: 700, textTransform: 'uppercase' as const, marginBottom: 4, marginTop: 8, letterSpacing: 0.5 }}>
                    Peor trade (%)
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#f43f5e' }}>
                    {stats.worstTradePct?.ticker} · {stats.worstTradePct?.pct.toFixed(1)}%
                  </div>
                </div>
              </div>

              <div style={{ ...box, borderColor: 'rgba(34,197,94,0.2)', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: 8, right: 8, pointerEvents: 'none' }}>
                  <Whiskers color="#22c55e" opacity={0.12} width={70} />
                </div>
                <div style={{ ...boxTitle, color: '#22c55e' }}>
                  <Paw size={10} color="#22c55e" opacity={0.7} style={{ marginRight: 6 }} />
                  Racha ganadora máx.
                </div>
                <div style={{ fontSize: 36, fontWeight: 900, color: '#22c55e' }}>{stats.maxWinStrk}</div>
                <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>trades ganados consecutivos</div>
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 9, color: '#888', fontWeight: 700, textTransform: 'uppercase' as const, marginBottom: 4, letterSpacing: 0.5 }}>Mejor mes</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#22c55e', textTransform: 'capitalize' as const }}>{stats.bestMonth?.[0] || '—'}</div>
                  <div style={{ fontSize: 13, color: '#22c55e' }}>{stats.bestMonth ? money(stats.bestMonth[1].pnl) : ''}</div>
                </div>
              </div>

              <div style={{ ...box, borderColor: 'rgba(244,63,94,0.2)', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: 8, right: 8, pointerEvents: 'none' }}>
                  <Whiskers color="#f43f5e" opacity={0.12} width={70} />
                </div>
                <div style={{ ...boxTitle, color: '#f43f5e' }}>
                  <Paw size={10} color="#f43f5e" opacity={0.7} style={{ marginRight: 6 }} />
                  Racha perdedora máx.
                </div>
                <div style={{ fontSize: 36, fontWeight: 900, color: '#f43f5e' }}>{stats.maxLossStrk}</div>
                <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>trades perdidos consecutivos</div>
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 9, color: '#888', fontWeight: 700, textTransform: 'uppercase' as const, marginBottom: 4, letterSpacing: 0.5 }}>Peor mes</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#f43f5e', textTransform: 'capitalize' as const }}>{stats.worstMonth?.[0] || '—'}</div>
                  <div style={{ fontSize: 13, color: '#f43f5e' }}>{stats.worstMonth ? money(stats.worstMonth[1].pnl) : ''}</div>
                </div>
              </div>

              <div style={{ ...box, borderColor: 'rgba(34,197,94,0.18)', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', bottom: -8, right: -8, pointerEvents: 'none' }}>
                  <Paw size={56} color="#22c55e" opacity={0.04} />
                </div>
                <div style={{ ...boxTitle, color: '#22c55e' }}>
                  <Paw size={10} color="#22c55e" opacity={0.7} style={{ marginRight: 6 }} />
                  Mejores cierres
                </div>
                {stats.topWinners.map((t, i) => (
                  <div key={t.id} style={listRow}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {i === 0 && <Paw size={9} color="#ffd700" opacity={0.8} />}
                      <span style={{ color: '#00bfff', fontWeight: 700 }}>{t.ticker}</span>
                    </span>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ color: '#22c55e', fontWeight: 700, fontSize: 12 }}>
                        +{money(Number(t.realized_pnl))}
                      </div>
                      {calcInvested(t) > 0 && (
                        <div style={{ color: '#22c55e', fontSize: 10, opacity: 0.8 }}>
                          +{((Number(t.realized_pnl) / calcInvested(t)) * 100).toFixed(2)}%
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ ...box, borderColor: 'rgba(244,63,94,0.18)', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', bottom: -8, right: -8, pointerEvents: 'none' }}>
                  <Paw size={56} color="#f43f5e" opacity={0.04} />
                </div>
                <div style={{ ...boxTitle, color: '#f43f5e' }}>
                  <Paw size={10} color="#f43f5e" opacity={0.7} style={{ marginRight: 6 }} />
                  Peores cierres
                </div>
                {stats.topLosers.map(t => (
                  <div key={t.id} style={listRow}>
                    <span style={{ color: '#00bfff', fontWeight: 700 }}>{t.ticker}</span>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ color: '#f43f5e', fontWeight: 700, fontSize: 12 }}>
                        {money(Number(t.realized_pnl))}
                      </div>
                      {calcInvested(t) > 0 && (
                        <div style={{ color: '#f43f5e', fontSize: 10, opacity: 0.8 }}>
                          {((Number(t.realized_pnl) / calcInvested(t)) * 100).toFixed(2)}%
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── F3: Scatter días vs PnL % ── */}
            <ChartCard title="Scatter: días en posición vs PnL %" sub="Cada punto = un trade · izquierda = rápido · derecha = lento" mb={0}>
              {charts.scatterData.length > 0 ? (
                <div style={{ position: 'relative', height: 220 }}>
                  <svg width="100%" height={220} viewBox="0 0 1200 220" preserveAspectRatio="none" style={{ overflow: 'visible' }}>
                    {(() => {
                      const data = charts.scatterData
                      const maxDays = Math.max(...data.map(d => d.days), 1)
                      const maxPct  = Math.max(...data.map(d => Math.abs(d.pnlPct)), 1)
                      const padX = 40, padY = 20, padR = 16, padB = 30
                      const W = 1200, H = 220
                      const toX = (days: number) => padX + (days / maxDays) * (W - padX - padR)
                      const toY = (pct: number)  => padY + ((maxPct - pct) / (maxPct * 2)) * (H - padY - padB)
                      const zeroY = toY(0)
                      return (
                        <>
                          <line x1={padX} y1={padY} x2={padX} y2={H - padB} stroke="#222" strokeWidth={1} />
                          <line x1={padX} y1={zeroY} x2={W - padR} y2={zeroY} stroke="#333" strokeWidth={1} strokeDasharray="4 4" />
                          {[-maxPct, -maxPct/2, 0, maxPct/2, maxPct].map(v => (
                            <text key={v} x={padX - 4} y={toY(v) + 4} textAnchor="end" fill="#555" fontSize={8}>
                              {v.toFixed(0)}%
                            </text>
                          ))}
                          {[0, Math.round(maxDays/4), Math.round(maxDays/2), Math.round(maxDays*3/4), maxDays].map(v => (
                            <text key={v} x={toX(v)} y={H - padB + 14} textAnchor="middle" fill="#555" fontSize={8}>
                              {v}d
                            </text>
                          ))}
                          {data.map((d, i) => (
                            <g key={i}>
                              <circle
                                cx={toX(d.days)} cy={toY(d.pnlPct)}
                                r={5} fill={d.color} fillOpacity={0.75}
                                stroke={d.color} strokeWidth={1}
                              />
                              <title>{d.ticker} · {d.days}d · {d.pnlPct}%</title>
                            </g>
                          ))}
                        </>
                      )
                    })()}
                  </svg>
                  <div style={{ position: 'absolute', bottom: 4, right: 8, fontSize: 8, color: '#444', display: 'flex', gap: 12 }}>
                    <span style={{ color: C.gain }}>● ganancia</span>
                    <span style={{ color: C.loss }}>● pérdida</span>
                  </div>
                </div>
              ) : <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444', fontSize: 11 }}>Sin datos</div>}
            </ChartCard>

            {/* ── F4: Sector + Día + Win/Loss ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
              <ChartCard title="PnL por sector" sub="Suma de PnL realizado" mb={0}>
                <ResponsiveContainer width="100%" height={190}>
                  <PieChart>
                    <Pie data={charts.sectorData.filter(s => s.value !== 0)}
                      cx="50%" cy="50%" innerRadius={46} outerRadius={72}
                      paddingAngle={4} dataKey="value">
                      {charts.sectorData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="none" />)}
                    </Pie>
                    <Tooltip content={<CatTooltip formatter={fmtMoney} />} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 8px', marginTop: 6 }}>
                  {charts.sectorData.slice(0, 6).map((s, i) => (
                    <span key={s.name} style={{ fontSize: 9, color: '#aaa', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: PIE_COLORS[i % PIE_COLORS.length], display: 'inline-block' }} />
                      {s.name}
                    </span>
                  ))}
                </div>
              </ChartCard>

              <ChartCard title="Duración de trades" sub="Histograma por rango de días en posición" mb={0}>
                <ResponsiveContainer width="100%" height={210}>
                  <BarChart data={charts.durationData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid stroke="#151515" vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="bucket" tick={{ fill: '#aaa', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#888', fontSize: 9 }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip content={<CatTooltip formatter={(v: number) => `${v} trades`} />} />
                    <Bar dataKey="count" name="Trades" radius={[6,6,0,0]}>
                      {charts.durationData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} fillOpacity={0.8} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Win vs Loss" sub={`${stats.winsCount} ganados · ${stats.lossesCount} perdidos`} mb={0}>
                <ResponsiveContainer width="100%" height={190}>
                  <PieChart>
                    <Pie
                      data={[{ name: 'Ganados', value: stats.winsCount }, { name: 'Perdidos', value: stats.lossesCount }]}
                      cx="50%" cy="50%" innerRadius={46} outerRadius={72}
                      paddingAngle={6} dataKey="value" startAngle={90} endAngle={-270}>
                      <Cell fill={C.gain} stroke="none" />
                      <Cell fill={C.loss} stroke="none" />
                    </Pie>
                    <Tooltip content={<CatTooltip formatter={(v: number) => `${v} trades`} />} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginTop: 6 }}>
                  <span style={{ fontSize: 11, color: C.gain, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Paw size={10} color={C.gain} opacity={0.7} /> {stats.winsCount} ganados
                  </span>
                  <span style={{ fontSize: 11, color: C.loss, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Paw size={10} color={C.loss} opacity={0.7} /> {stats.lossesCount} perdidos
                  </span>
                </div>
              </ChartCard>
            </div>

            {/* ── F5: Drawdown % + Portafolio vs S&P 500 ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
              <ChartCard title="Drawdown" sub="Caída máxima desde el pico de equity" mb={0} extra={<PeriodSelector />}>
                <ResponsiveContainer width="100%" height={210}>
                  <AreaChart data={drawdownFiltered} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <defs>
                      <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={C.loss} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={C.loss} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#151515" vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fill: '#aaa', fontSize: 9 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#888', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
                    <Tooltip content={<CatTooltip formatter={(v: number) => `${v}%`} />} />
                    <ReferenceLine y={0} stroke="#333" />
                    <Area type="monotone" dataKey="drawdown" name="Drawdown" stroke={C.loss} fill="url(#ddGrad)" strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Portafolio vs S&P 500" sub="PnL acumulado real vs benchmark estimado" mb={0} extra={<PeriodSelector />}>
                <ResponsiveContainer width="100%" height={210}>
                  <LineChart data={sp500Filtered} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid stroke="#151515" vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fill: '#aaa', fontSize: 9 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#888', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                    <Tooltip content={<CatTooltip formatter={fmtMoney} />} />
                    <ReferenceLine y={0} stroke="#333" strokeDasharray="3 3" />
                    <Line type="monotone" dataKey="Portafolio" stroke={C.accent} strokeWidth={2.5} dot={false} />
                    <Line type="monotone" dataKey="S&P 500" stroke={C.sp500} strokeWidth={1.5} dot={false} strokeDasharray="5 5" />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Rendimiento por período vs S&P 500" sub="Comparativo de tu portafolio contra el índice en distintos horizontes" mb={0}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#050505' }}>
                      {['Período', 'Tu portafolio', 'S&P 500', 'Diferencia'].map(h => (
                        <th key={h} style={{
                          padding: '8px 14px', textAlign: h === 'Período' ? 'left' : 'right',
                          color: '#555', fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
                          borderBottom: '1px solid #111'
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(charts.periodRows || []).map(row => (
                      <tr key={row.label} style={{ borderBottom: '1px solid #0a0a0a' }}>
                        <td style={{ padding: '10px 14px', color: '#aaa', fontWeight: 600 }}>{row.label}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700,
                          color: row.portRend === null ? '#333' : row.portRend >= 0 ? C.gain : C.loss }}>
                          {row.portRend === null ? '—' : `${row.portRend >= 0 ? '+' : ''}${row.portRend.toFixed(2)}%`}
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700,
                          color: row.sp500Rend === null ? '#333' : row.sp500Rend >= 0 ? '#60a5fa' : C.loss }}>
                          {row.sp500Rend === null ? '—' : `${row.sp500Rend >= 0 ? '+' : ''}${row.sp500Rend.toFixed(2)}%`}
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 800, fontSize: 13,
                          color: row.diff === null ? '#333' : row.diff >= 0 ? C.gain : C.loss }}>
                          {row.diff === null ? '—' : (
                            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                              {row.diff >= 0 ? '▲' : '▼'} {Math.abs(row.diff).toFixed(2)}%
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ChartCard>

            </div>



            {/* ── F6: Rendimiento por período + Razones de cierre ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '0.5fr 1fr', gap: 14 }}>
              
              <ChartCard title="PnL por razón de cierre" sub="Suma de PnL agrupado por cómo cerraste" mb={0}>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={charts.closeReasonData} layout="vertical" margin={{ top: 4, right: 8, left: 60, bottom: 4 }}>
                    <CartesianGrid stroke="#151515" horizontal={false} strokeDasharray="3 3" />
                    <XAxis type="number" tick={{ fill: '#888', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                    <YAxis type="category" dataKey="reason" tick={{ fill: '#aaa', fontSize: 9 }} axisLine={false} tickLine={false} width={55} />
                    <Tooltip content={<CatTooltip formatter={(v: number) => fmtMoney(v)} />} />
                    <Bar dataKey="pnl" name="PnL" radius={[0,4,4,0]}>
                      {charts.closeReasonData.map((e, i) => <Cell key={i} fill={e.pnl >= 0 ? C.gain : C.loss} fillOpacity={0.8} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Resumen por mes" sub="Mejores y peores meses ordenados por PnL" mb={0}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div>
                    <div style={{ fontSize: 9, color: C.gain, fontWeight: 700, letterSpacing: 0.5, marginBottom: 8 }}>MEJORES MESES</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                      <thead>
                        <tr style={{ background: '#050505' }}>
                          {['Mes', 'PnL', 'Trades', 'Gan.', 'Perd.', 'WR%'].map(h => (
                            <th key={h} style={{ padding: '5px 8px', textAlign: h === 'Mes' ? 'left' : 'right', color: '#555', fontSize: 9, fontWeight: 700, borderBottom: '1px solid #111' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {charts.monthlyTable.filter(m => m.pnl >= 0).slice(0, 6).map(m => (
                          <tr key={m.month} style={{ borderBottom: '1px solid #0a0a0a' }}>
                            <td style={{ padding: '5px 8px', color: '#aaa', textTransform: 'capitalize' }}>{m.month}</td>
                            <td style={{ padding: '5px 8px', textAlign: 'right', color: C.gain, fontWeight: 700 }}>{fmtMoney(m.pnl)}</td>
                            <td style={{ padding: '5px 8px', textAlign: 'right', color: '#666' }}>{m.trades}</td>
                            <td style={{ padding: '5px 8px', textAlign: 'right', color: C.gain }}>{m.wins}</td>
                            <td style={{ padding: '5px 8px', textAlign: 'right', color: C.loss }}>{m.losses}</td>
                            <td style={{ padding: '5px 8px', textAlign: 'right', color: m.winRate >= 50 ? C.gain : C.loss, fontWeight: 700 }}>{m.winRate}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: C.loss, fontWeight: 700, letterSpacing: 0.5, marginBottom: 8 }}>PEORES MESES</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                      <thead>
                        <tr style={{ background: '#050505' }}>
                          {['Mes', 'PnL', 'Trades', 'Gan.', 'Perd.', 'WR%'].map(h => (
                            <th key={h} style={{ padding: '5px 8px', textAlign: h === 'Mes' ? 'left' : 'right', color: '#555', fontSize: 9, fontWeight: 700, borderBottom: '1px solid #111' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {charts.monthlyTable.filter(m => m.pnl < 0).slice(-6).reverse().map(m => (
                          <tr key={m.month} style={{ borderBottom: '1px solid #0a0a0a' }}>
                            <td style={{ padding: '5px 8px', color: '#aaa', textTransform: 'capitalize' }}>{m.month}</td>
                            <td style={{ padding: '5px 8px', textAlign: 'right', color: C.loss, fontWeight: 700 }}>{fmtMoney(m.pnl)}</td>
                            <td style={{ padding: '5px 8px', textAlign: 'right', color: '#666' }}>{m.trades}</td>
                            <td style={{ padding: '5px 8px', textAlign: 'right', color: C.gain }}>{m.wins}</td>
                            <td style={{ padding: '5px 8px', textAlign: 'right', color: C.loss }}>{m.losses}</td>
                            <td style={{ padding: '5px 8px', textAlign: 'right', color: m.winRate >= 50 ? C.gain : C.loss, fontWeight: 700 }}>{m.winRate}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </ChartCard>

            </div>

            {/* ── F7: Distribución PnL % + Duración ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr ', gap: 14 }}>

              <ChartCard title="Acumulado mensual de PnL" sub="Construcción progresiva del PnL — verde sube, rojo baja" mb={0}>
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={charts.monthlyWaterfall} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid stroke="#151515" vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="month" tick={{ fill: '#aaa', fontSize: 9 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#888', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                    <Tooltip content={<CatTooltip formatter={(v: number) => fmtMoney(v)} />} />
                    <ReferenceLine y={0} stroke="#333" strokeDasharray="3 3" />
                    <Bar dataKey="base" stackId="a" fill="transparent" stroke="none" />
                    <Bar dataKey="value" stackId="a" name="PnL mes" radius={[3,3,0,0]}>
                      {charts.monthlyWaterfall.map((e, i) => <Cell key={i} fill={e.fill} fillOpacity={0.85} />)}
                    </Bar>
                    <Line type="monotone" dataKey="cumPnl" name="Acumulado" stroke={C.accent} strokeWidth={2} dot={{ fill: C.accent, r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </ChartCard>

            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}

function StatCard({ label, value, desc, color = 'white', bar, pawColor = '#666' }: any) {
  return (
    <div style={{ background: '#080808', border: '1px solid #1a1a1a', padding: '16px 18px', borderRadius: 10, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', bottom: -10, right: -10, pointerEvents: 'none' }}>
        <Paw size={50} color={pawColor} opacity={0.04} />
      </div>
      <div style={{ fontSize: 9, color: '#888', marginBottom: 8, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 5 }}>
        <Paw size={9} color={pawColor} opacity={0.5} />
        {label}
      </div>
      <div style={{ fontSize: 21, fontWeight: 900, color }}>{value}</div>
      {desc && <div style={{ fontSize: 10, color: '#888', marginTop: 5 }}>{desc}</div>}
      {bar !== undefined && (
        <div style={{ height: 3, background: '#111', borderRadius: 2, marginTop: 10 }}>
          <div style={{ height: '100%', width: `${Math.min(bar, 100)}%`, background: bar >= 50 ? '#22c55e' : '#f43f5e', borderRadius: 2 }} />
        </div>
      )}
    </div>
  )
}

function Row({ label, value, color = '#ccc' }: any) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #111', fontSize: 11 }}>
      <span style={{ color: '#aaa' }}>{label}</span>
      <span style={{ fontWeight: 700, color }}>{value}</span>
    </div>
  )
}

function ChartCard({ title, sub, children, mb = 14, extra }: any) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '18px 20px', marginBottom: mb }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 800, color: '#888', letterSpacing: 0.8, textTransform: 'uppercase' as const, display: 'flex', alignItems: 'center', gap: 7 }}>
            <Paw size={10} color="#666" opacity={0.5} />
            {title}
          </div>
          {sub && <div style={{ fontSize: 9, color: '#555', marginTop: 3 }}>{sub}</div>}
        </div>
        {extra && <div>{extra}</div>}
      </div>
      {children}
    </div>
  )
}

const filterBtn = (active: boolean): React.CSSProperties => ({
  padding: '6px 14px', borderRadius: 6, border: 'none',
  background: active ? '#00bfff' : '#111',
  color: active ? '#000' : '#aaa',
  cursor: 'pointer', fontSize: 10, fontWeight: 'bold',
})
const selectStyle: React.CSSProperties = { background: '#080808', color: '#ccc', border: '1px solid #222', padding: '6px 10px', borderRadius: 6, fontSize: 11, outline: 'none' }
const box: React.CSSProperties      = { background: '#080808', border: '1px solid #1a1a1a', padding: '16px 18px', borderRadius: 10 }
const boxTitle: React.CSSProperties = { fontSize: 9, color: '#888', marginBottom: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', display: 'flex', alignItems: 'center' }
const listRow: React.CSSProperties  = { display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #0f0f0f', fontSize: 11, alignItems: 'center' }