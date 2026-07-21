'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { usePrivacy } from '@/lib/PrivacyContext'
import AppShell from '../AppShell'
import { TrendingUp } from 'lucide-react'
import {
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  BarChart, Bar, PieChart, Pie, Cell,
  AreaChart, Area, LineChart, Line, ReferenceLine, ComposedChart, Legend,
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

// Tooltip unificado con texto visible
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

export default function Graficos2Page() {
  const { money } = usePrivacy()

  const [allTrades,         setAllTrades]        = useState<any[]>([])
  const [portfolios,        setPortfolios]        = useState<any[]>([])
  const [selectedPortfolio, setSelectedPortfolio] = useState('all')
  const [selectedYear,      setSelectedYear]      = useState(new Date().getFullYear().toString())
  const [loading,           setLoading]           = useState(true)
  const [sp500Map, setSp500Map] = useState<Record<string, number>>({})
  const [equityPeriod, setEquityPeriod] = useState<'YTD' | '1Y' | '5Y' | 'MAX'>('YTD')

  const fetchData = useCallback(async () => {
    const [{ data: tData }, { data: pData }] = await Promise.all([
      supabase.from('trades').select('*, trade_executions(quantity, price, commission, execution_type)').eq('status','closed'),
      supabase.from('portfolios').select('*'),
    ])
    if (tData) setAllTrades(tData)
    if (pData) setPortfolios(pData)
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
    const years = allTrades.map(t => parseDate(t.close_date || t.open_date).getFullYear().toString())
    return Array.from(new Set(years)).sort((a, b) => b.localeCompare(a))
  }, [allTrades])

  const trades = useMemo(() => {
    let filtered = selectedPortfolio === 'all' ? allTrades : allTrades.filter(t => t.portfolio_id === selectedPortfolio)
    if (selectedYear !== 'all') filtered = filtered.filter(t => parseDate(t.close_date || t.open_date).getFullYear().toString() === selectedYear)
    return filtered
  }, [allTrades, selectedPortfolio, selectedYear])

  const calcInvested = (t: any): number => {
    const initialInv = Number(t.initial_entry_price || t.entry_price || 0) * Number(t.initial_quantity || t.quantity || 0)
    const buyExtra = (t.trade_executions || [])
      .filter((e: any) => e.execution_type === 'buy')
      .reduce((a: number, e: any) => a + Number(e.quantity) * Number(e.price) + Number(e.commission || 0), 0)
    return parseFloat((initialInv + buyExtra).toFixed(2))
  }

  const charts = useMemo(() => {
    if (!trades.length) return null

    const sorted = [...trades].sort(
      (a, b) => parseDate(a.close_date).getTime() - parseDate(b.close_date).getTime()
    )

    let equity = 0, peak = 0
    let wins = 0, losses = 0, totalWin = 0, totalLoss = 0
    let cumCapital = 0

    // SP500 real: buscar el precio base en la fecha del primer trade
    const firstDateStr = sorted[0].close_date
    const sp500Prices  = Object.entries(sp500Map).sort(([a], [b]) => a.localeCompare(b))
    const sp500Base    = sp500Map[firstDateStr] ||
      sp500Prices.reverse().find(([d]) => d <= firstDateStr)?.[1] || null

    const equityCurve: any[]   = []
    const drawdownCurve: any[] = []
    const sp500Curve: any[]    = []
    const capitalAccum: any[]  = []
    const monthly: Record<string, { pnl: number, sp500: number, wins: number, trades: number }> = {}
    const sector: Record<string, { pnl: number, count: number }> = {}
    const weekday: Record<string, number> = {}
    const closeReason: Record<string, { pnl: number, count: number }> = {}
    const pnlDistribution: any[] = []
    const durationBuckets: Record<string, number> = {
      '1-7 días': 0, '8-30 días': 0, '31-90 días': 0, '+90 días': 0
    }
    // PnL acumulado por mes (waterfall)
    const monthlyWaterfall: any[] = []

    sorted.forEach((t, i) => {
      const pnl      = Number(t.realized_pnl) || 0
      const thisDate = parseDate(t.close_date)
      const tradeDays = Math.max(1, Math.ceil(
        Math.abs(parseDate(t.close_date).getTime() - parseDate(t.open_date).getTime()) / 86400000
      ))

      if      (tradeDays <= 7)  durationBuckets['1-7 días']++
      else if (tradeDays <= 30) durationBuckets['8-30 días']++
      else if (tradeDays <= 90) durationBuckets['31-90 días']++
      else                      durationBuckets['+90 días']++

      const inv = calcInvested(t)
      equity     += pnl
      cumCapital += inv

      if (equity > peak) peak = equity
      const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0

      const label = thisDate.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })
      equityCurve.push({ date: label, rawDate: t.close_date, equity: parseFloat(equity.toFixed(2)) })
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
      capitalAccum.push({ date: label, capital: parseFloat(cumCapital.toFixed(2)), pnl: parseFloat(equity.toFixed(2)) })

      if (pnl >= 0) { wins++; totalWin += pnl } else { losses++; totalLoss += Math.abs(pnl) }

      const m = thisDate.toLocaleDateString('es-MX', { year: 'numeric', month: 'short' })
      if (!monthly[m]) monthly[m] = { pnl: 0, sp500: 0, wins: 0, trades: 0 }
      monthly[m].pnl  += pnl
      monthly[m].sp500 += 0 // se calcula abajo con SP500 real
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

    // Llenar monthlyWaterfall desde sortedByMonth
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
    
    const monthlyComparison = sortedByMonth.map(([month, d]) => ({

      month,
      Portafolio: parseFloat(d.pnl.toFixed(2)),
      'S&P 500':  parseFloat(d.sp500.toFixed(2)),
      Alpha:      parseFloat((d.pnl - d.sp500).toFixed(2)),
      winRate:    d.trades > 0 ? Math.round((d.wins / d.trades) * 100) : 0,
    }))

    // Heatmap de WinRate mensual
    const winRateHeatmap = monthlyComparison.map(m => ({
      month: m.month,
      winRate: m.winRate,
      color: m.winRate >= 60 ? C.gain : m.winRate >= 40 ? C.warning : C.loss,
    }))

    const winRate      = wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0
    const profitFactor = totalLoss > 0 ? totalWin / totalLoss : totalWin
    const maxDD        = drawdownCurve.reduce((min, d) => Math.min(min, d.drawdown), 0)

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
      equityCurve, drawdownCurve, sp500Curve, capitalAccum,

      monthlyComparison, monthlyWaterfall, winRateHeatmap,
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
      winRate: parseFloat(winRate.toFixed(1)),
      profitFactor: parseFloat(profitFactor.toFixed(2)),
      maxDD: parseFloat(Math.abs(maxDD).toFixed(2)),
      totalPnL: parseFloat(equity.toFixed(2)),
      totalTrades: sorted.length,
      wins, losses, periodRows,
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
  }, [trades, sp500Map, calcInvested])

  if (loading) return (
    <AppShell>
      <div style={{ padding: 40, color: '#888', display: 'flex', alignItems: 'center', gap: 10 }}>
        <Paw size={16} color="#888" opacity={0.5} /> Cargando análisis...
      </div>
    </AppShell>
  )

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
  const equityFiltered   = charts ? filterCurve(charts.equityCurve)   : []
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

  const filterByPeriod = (data: any[]) => {
    if (!data.length) return data
    // data tiene campo 'date' como string formateado, necesitamos filtrar por índice
    // usamos equityCurveAll para filtrar por fecha real
    return data
  }
  
  return (
    <AppShell>
      <div style={{ padding: '22px 28px', color: 'white', maxWidth: 1400, margin: '0 auto', position: 'relative' }}>

        {/* Gatos decorativos */}
        <div style={{ position: 'absolute', top: -2, right: 55, pointerEvents: 'none' }}>
          <CatEars color="#22c55e" opacity={0.12} size={44} />
        </div>
        <div style={{ position: 'absolute', right: -6, top: '35%', pointerEvents: 'none' }}>
          <CatTail color="#22c55e" opacity={0.08} />
        </div>
        <div style={{ position: 'absolute', left: 0, bottom: '20%', pointerEvents: 'none' }}>
          <CatSitting size={65} color="#00bfff" opacity={0.04} />
        </div>

        {/* HEADER */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
          <Paw size={20} color="#22c55e" opacity={0.6} />
          <Paw size={14} color="#22c55e" opacity={0.35} />
          <Paw size={9}  color="#22c55e" opacity={0.18} />
          <TrendingUp size={20} color={C.accent} />
          <h1 style={{ fontSize: 18, fontWeight: 900, margin: 0 }}>Gráficas — trades cerrados</h1>
        </div>

        {/* FILTROS */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: `1px solid ${C.border}`, paddingBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
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

        {!charts ? (
          <div style={{ textAlign: 'center', padding: 80, color: '#666', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <CatSitting size={60} color="#444" opacity={0.4} />
            <Paw size={24} color="#333" opacity={0.5} />
            No hay trades cerrados para este filtro.
          </div>
        ) : (
          <>
            {/* KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12, marginBottom: 18 }}>
              {[
                { label: 'PnL total',       value: fmtMoney(charts.totalPnL),  color: charts.totalPnL >= 0 ? C.gain : C.loss },
                { label: 'Win rate',        value: `${charts.winRate}%`,        color: charts.winRate >= 50 ? C.gain : C.loss },
                { label: 'Profit factor',   value: String(charts.profitFactor), color: charts.profitFactor >= 1.5 ? C.gain : C.warning },
                { label: 'Max drawdown',    value: `${charts.maxDD}%`,          color: C.loss },
                { label: 'Trades cerrados', value: String(charts.totalTrades),  color: '#fff' },
              ].map(k => (
                <div key={k.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px', position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', bottom: -8, right: -8, pointerEvents: 'none' }}>
                    <Paw size={40} color={k.color} opacity={0.04} />
                  </div>
                  <div style={{ fontSize: 9, color: '#888', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' as const, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Paw size={9} color={k.color} opacity={0.5} />
                    {k.label}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: k.color }}>{k.value}</div>
                </div>
              ))}
            </div>

            {/* ── Equity curve ── */}
            <ChartCard title="Curva de equity" sub="PnL acumulado · trades cerrados" mb={14} extra={<PeriodSelector />}>
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={equityFiltered} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                  <defs>
                    <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={C.accent} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={C.accent} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#151515" vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fill: '#aaa', fontSize: 9 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#888', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                  <Tooltip content={<CatTooltip formatter={fmtMoney} />} />
                  <ReferenceLine y={0} stroke="#333" strokeDasharray="3 3" />
                  <Area type="monotone" dataKey="equity" name="Equity" stroke={C.accent} fill="url(#eqGrad)" strokeWidth={2.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* ── Drawdown + SP500 ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
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
                    <Legend formatter={v => <span style={{ color: '#aaa', fontSize: 9 }}>{v}</span>} wrapperStyle={{ paddingTop: 6 }} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            {/* ── PnL mensual + Alpha ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 14, marginBottom: 14 }}>
              <ChartCard title="PnL mensual vs S&P 500" sub="Barras = portafolio · línea = benchmark" mb={0}>
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={charts.monthlyComparison} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid stroke="#151515" vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="month" tick={{ fill: '#aaa', fontSize: 9 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#888', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                    <Tooltip content={<CatTooltip formatter={fmtMoney} />} />
                    <ReferenceLine y={0} stroke="#333" />
                    <Bar dataKey="Portafolio" radius={[3,3,0,0]}>
                      {charts.monthlyComparison.map((e, i) => <Cell key={i} fill={e.Portafolio >= 0 ? C.gain : C.loss} fillOpacity={0.8} />)}
                    </Bar>
                    <Line type="monotone" dataKey="S&P 500" stroke={C.sp500} strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
                  </ComposedChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Alpha mensual" sub="Tu PnL menos el S&P 500 por mes" mb={0}>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={charts.monthlyComparison} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid stroke="#151515" vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="month" tick={{ fill: '#aaa', fontSize: 9 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#888', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                    <Tooltip content={<CatTooltip formatter={fmtMoney} />} />
                    <ReferenceLine y={0} stroke="#333" />
                    <Bar dataKey="Alpha" radius={[3,3,0,0]}>
                      {charts.monthlyComparison.map((e, i) => <Cell key={i} fill={e.Alpha >= 0 ? C.gain : C.loss} fillOpacity={0.85} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            {/* ── FILA: Razones de cierre + Rendimiento por período ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              <ChartCard title="Scatter: días en posición vs PnL %" sub="Cada punto = un trade · izquierda = rápido · derecha = lento" mb={0}>
                {charts.scatterData.length > 0 ? (
                  <div style={{ position: 'relative', height: 220 }}>
                    <svg width="100%" height={220} style={{ overflow: 'visible' }}>
                      {(() => {
                        const data = charts.scatterData
                        const maxDays = Math.max(...data.map(d => d.days), 1)
                        const maxPct  = Math.max(...data.map(d => Math.abs(d.pnlPct)), 1)
                        const padX = 40, padY = 20, padR = 16, padB = 30
                        const W = 600, H = 220
                        const toX = (days: number) => padX + (days / maxDays) * (W - padX - padR)
                        const toY = (pct: number)  => padY + ((maxPct - pct) / (maxPct * 2)) * (H - padY - padB)
                        const zeroY = toY(0)
                        return (
                          <>
                            {/* Ejes */}
                            <line x1={padX} y1={padY} x2={padX} y2={H - padB} stroke="#222" strokeWidth={1} />
                            <line x1={padX} y1={zeroY} x2={W - padR} y2={zeroY} stroke="#333" strokeWidth={1} strokeDasharray="4 4" />
                            {/* Labels Y */}
                            {[-maxPct, -maxPct/2, 0, maxPct/2, maxPct].map(v => (
                              <text key={v} x={padX - 4} y={toY(v) + 4} textAnchor="end" fill="#555" fontSize={8}>
                                {v.toFixed(0)}%
                              </text>
                            ))}
                            {/* Labels X */}
                            {[0, Math.round(maxDays/4), Math.round(maxDays/2), Math.round(maxDays*3/4), maxDays].map(v => (
                              <text key={v} x={toX(v)} y={H - padB + 14} textAnchor="middle" fill="#555" fontSize={8}>
                                {v}d
                              </text>
                            ))}
                            {/* Puntos */}
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

              {/* ── RENDIMIENTO POR PERÍODO ── */}
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
                        {row.portRend === null ? '—' : `${row.portRend >= 0 ? '+' : ''}${row.portRend}%`}
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700,
                        color: row.sp500Rend === null ? '#333' : row.sp500Rend >= 0 ? '#60a5fa' : C.loss }}>
                        {row.sp500Rend === null ? '—' : `${row.sp500Rend >= 0 ? '+' : ''}${row.sp500Rend}%`}
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 800, fontSize: 13,
                        color: row.diff === null ? '#333' : row.diff >= 0 ? C.gain : C.loss }}>
                        {row.diff === null ? '—' : (
                          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                            {row.diff >= 0 ? '▲' : '▼'} {Math.abs(row.diff)}%
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ChartCard>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>

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
            </div>

            {/* ── Tabla mejores y peores meses ── */}
            <ChartCard title="Resumen por mes" sub="Mejores y peores meses ordenados por PnL" mb={14}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                {/* Top mejores */}
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
                {/* Peores */}
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

            

            {/* ── Distribución PnL % + Duración ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14, marginBottom: 14 }}>
              <ChartCard title="Distribución de PnL % por trade" sub="Verde = ganado · rojo = perdido" mb={0}>
                <ResponsiveContainer width="100%" height={210}>
                  <BarChart data={charts.pnlDistribution} margin={{ top: 4, right: 8, left: 0, bottom: 30 }}>
                    <CartesianGrid stroke="#151515" vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="ticker" tick={{ fill: '#aaa', fontSize: 8 }} axisLine={false} tickLine={false} angle={-45} textAnchor="end" height={40} />
                    <YAxis tick={{ fill: '#888', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
                    <Tooltip content={<CatTooltip formatter={(v: number) => `${v}%`} />} />
                    <ReferenceLine y={0} stroke="#333" />
                    <Bar dataKey="pnlPct" name="PnL %" radius={[3,3,0,0]}>
                      {charts.pnlDistribution.map((e, i) => <Cell key={i} fill={e.color} fillOpacity={0.85} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
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
            </div>

            {/* ── Waterfall PnL mensual acumulado ── */}
            <ChartCard title="Acumulado mensual de PnL" sub="Construcción progresiva del PnL — verde sube, rojo baja" mb={14}>
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={charts.monthlyWaterfall} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid stroke="#151515" vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fill: '#aaa', fontSize: 9 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#888', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                  <Tooltip content={<CatTooltip formatter={(v: number, n: string) =>
                    n === 'Acumulado' ? fmtMoney(v) : fmtMoney(v)
                  } />} />
                  <ReferenceLine y={0} stroke="#333" strokeDasharray="3 3" />
                  <Bar dataKey="base" stackId="a" fill="transparent" stroke="none" />
                  <Bar dataKey="value" stackId="a" name="PnL mes" radius={[3,3,0,0]}>
                    {charts.monthlyWaterfall.map((e, i) => (
                      <Cell key={i} fill={e.fill} fillOpacity={0.85} />
                    ))}
                  </Bar>
                  <Line type="monotone" dataKey="cumPnl" name="Acumulado" stroke={C.accent} strokeWidth={2} dot={{ fill: C.accent, r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* ── Sectores + Días + Win/Loss ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 20 }}>
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

              <ChartCard title="Rendimiento por día" sub="PnL total por día de cierre" mb={0}>
                <ResponsiveContainer width="100%" height={190}>
                  <BarChart data={charts.weekdayData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid stroke="#151515" vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="day" tick={{ fill: '#aaa', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#888', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                    <Tooltip content={<CatTooltip formatter={fmtMoney} />} />
                    <ReferenceLine y={0} stroke="#333" />
                    <Bar dataKey="pnl" name="PnL" radius={[4,4,0,0]}>
                      {charts.weekdayData.map((e, i) => <Cell key={i} fill={e.pnl >= 0 ? C.gain : C.loss} fillOpacity={0.8} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Win vs Loss" sub={`${charts.wins} ganados · ${charts.losses} perdidos`} mb={0}>
                <ResponsiveContainer width="100%" height={190}>
                  <PieChart>
                    <Pie
                      data={[{ name: 'Ganados', value: charts.wins }, { name: 'Perdidos', value: charts.losses }]}
                      cx="50%" cy="50%" innerRadius={46} outerRadius={72}
                      paddingAngle={6} dataKey="value" startAngle={90} endAngle={-270}>
                      <Cell fill={C.gain} stroke="none" />
                      <Cell fill={C.loss} stroke="none" />
                    </Pie>
                    <Tooltip content={<CatTooltip formatter={(v: number, n: string) => `${v} trades`} />} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginTop: 6 }}>
                  <span style={{ fontSize: 11, color: C.gain, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Paw size={10} color={C.gain} opacity={0.7} /> {charts.wins} ganados
                  </span>
                  <span style={{ fontSize: 11, color: C.loss, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Paw size={10} color={C.loss} opacity={0.7} /> {charts.losses} perdidos
                  </span>
                </div>
              </ChartCard>
            </div>
          </>
        )}
      </div>
    </AppShell>
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
const selectStyle: React.CSSProperties = { background: C.card, color: '#ccc', border: '1px solid #333', padding: '6px 10px', borderRadius: 6, fontSize: 11, outline: 'none' }
const filterBtn = (active: boolean): React.CSSProperties => ({
  padding: '6px 14px', borderRadius: 6, border: 'none',
  background: active ? C.accent : '#111',
  color: active ? '#000' : '#aaa',
  cursor: 'pointer', fontSize: 10, fontWeight: 'bold', whiteSpace: 'nowrap',
})