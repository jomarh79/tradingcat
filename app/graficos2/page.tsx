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
const SP500_DAILY = 0.0003

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

  const fetchData = useCallback(async () => {
    const [{ data: tData }, { data: pData }] = await Promise.all([
      supabase.from('trades').select('*').eq('status','closed'),
      supabase.from('portfolios').select('*'),
    ])
    if (tData) setAllTrades(tData)
    if (pData) setPortfolios(pData)
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const availableYears = useMemo(() => {
    const years = allTrades.map(t => parseDate(t.close_date || t.open_date).getFullYear().toString())
    return Array.from(new Set(years)).sort((a, b) => b.localeCompare(a))
  }, [allTrades])

  const trades = useMemo(() => {
    let filtered = selectedPortfolio === 'all' ? allTrades : allTrades.filter(t => t.portfolio_id === selectedPortfolio)
    if (selectedYear !== 'all') filtered = filtered.filter(t => parseDate(t.close_date || t.open_date).getFullYear().toString() === selectedYear)
    return filtered
  }, [allTrades, selectedPortfolio, selectedYear])

  const charts = useMemo(() => {
    if (!trades.length) return null

    const sorted = [...trades].sort(
      (a, b) => parseDate(a.close_date).getTime() - parseDate(b.close_date).getTime()
    )

    let equity = 0, peak = 0, sp500 = 0
    let wins = 0, losses = 0, totalWin = 0, totalLoss = 0
    let prevDate = parseDate(sorted[0].close_date)
    let cumCapital = 0
    const base = 10000

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
      const inv      = Number(t.total_invested) || 0
      const thisDate = parseDate(t.close_date)
      const days     = i === 0 ? 1 : Math.max(1, Math.ceil(
        (thisDate.getTime() - prevDate.getTime()) / 86400000
      ))
      const tradeDays = Math.max(1, Math.ceil(
        Math.abs(parseDate(t.close_date).getTime() - parseDate(t.open_date).getTime()) / 86400000
      ))

      if      (tradeDays <= 7)  durationBuckets['1-7 días']++
      else if (tradeDays <= 30) durationBuckets['8-30 días']++
      else if (tradeDays <= 90) durationBuckets['31-90 días']++
      else                      durationBuckets['+90 días']++

      equity    += pnl
      sp500     += base * (Math.pow(1 + SP500_DAILY, days) - 1)
      cumCapital += inv
      prevDate   = thisDate

      if (equity > peak) peak = equity
      const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0

      const label = thisDate.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })
      equityCurve.push({ date: label, equity: parseFloat(equity.toFixed(2)) })
      drawdownCurve.push({ date: label, drawdown: parseFloat((-dd).toFixed(2)) })
      sp500Curve.push({
        date: label,
        Portafolio: parseFloat(equity.toFixed(2)),
        'S&P 500':  parseFloat(sp500.toFixed(2)),
      })
      capitalAccum.push({ date: label, capital: parseFloat(cumCapital.toFixed(2)), pnl: parseFloat(equity.toFixed(2)) })

      if (pnl >= 0) { wins++; totalWin += pnl } else { losses++; totalLoss += Math.abs(pnl) }

      const m = thisDate.toLocaleDateString('es-MX', { year: 'numeric', month: 'short' })
      if (!monthly[m]) monthly[m] = { pnl: 0, sp500: 0, wins: 0, trades: 0 }
      monthly[m].pnl  += pnl
      monthly[m].sp500 += base * (Math.pow(1 + SP500_DAILY, days) - 1)
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

      const pnlPct = inv > 0 ? parseFloat(((pnl / inv) * 100).toFixed(1)) : 0
      pnlDistribution.push({ ticker: t.ticker, pnlPct, color: pnl >= 0 ? C.gain : C.loss })
    })

    const monthlyEntries = Object.entries(monthly).sort(([a], [b]) => a.localeCompare(b))

    const monthlyComparison = monthlyEntries.map(([month, d]) => ({
      month,
      Portafolio: parseFloat(d.pnl.toFixed(2)),
      'S&P 500':  parseFloat(d.sp500.toFixed(2)),
      Alpha:      parseFloat((d.pnl - d.sp500).toFixed(2)),
      winRate:    d.trades > 0 ? Math.round((d.wins / d.trades) * 100) : 0,
    }))

    // Waterfall mensual acumulado
    let cumPnl = 0
    monthlyEntries.forEach(([month, d]) => {
      const prev = cumPnl
      cumPnl = parseFloat((cumPnl + d.pnl).toFixed(2))
      monthlyWaterfall.push({
        month,
        base:  d.pnl >= 0 ? prev : cumPnl,
        value: Math.abs(d.pnl),
        pnl:   d.pnl,
        fill:  d.pnl >= 0 ? C.gain : C.loss,
        cumPnl,
      })
    })

    // Heatmap de WinRate mensual
    const winRateHeatmap = monthlyComparison.map(m => ({
      month: m.month,
      winRate: m.winRate,
      color: m.winRate >= 60 ? C.gain : m.winRate >= 40 ? C.warning : C.loss,
    }))

    const winRate      = wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0
    const profitFactor = totalLoss > 0 ? totalWin / totalLoss : totalWin
    const maxDD        = drawdownCurve.reduce((min, d) => Math.min(min, d.drawdown), 0)

    return {
      equityCurve, drawdownCurve, sp500Curve, capitalAccum,
      monthlyComparison, monthlyWaterfall, winRateHeatmap,
      durationData: Object.entries(durationBuckets).map(([bucket, count]) => ({ bucket, count })),
      sectorData: Object.entries(sector)
        .map(([name, d]) => ({ name, value: parseFloat(d.pnl.toFixed(2)), count: d.count }))
        .sort((a, b) => b.value - a.value),
      weekdayData: Object.entries(weekday)
        .map(([day, pnl]) => ({ day, pnl: parseFloat(pnl.toFixed(2)) })),
      closeReasonData: Object.entries(closeReason)
        .map(([reason, d]) => ({ reason, pnl: parseFloat(d.pnl.toFixed(2)), count: d.count }))
        .sort((a, b) => b.count - a.count),
      pnlDistribution: pnlDistribution.sort((a, b) => a.pnlPct - b.pnlPct),
      winRate: parseFloat(winRate.toFixed(1)),
      profitFactor: parseFloat(profitFactor.toFixed(2)),
      maxDD: parseFloat(Math.abs(maxDD).toFixed(2)),
      totalPnL: parseFloat(equity.toFixed(2)),
      totalTrades: sorted.length,
      wins, losses,
    }
  }, [trades])

  if (loading) return (
    <AppShell>
      <div style={{ padding: 40, color: '#888', display: 'flex', alignItems: 'center', gap: 10 }}>
        <Paw size={16} color="#888" opacity={0.5} /> Cargando análisis...
      </div>
    </AppShell>
  )

  const fmtMoney = (v: number) => money(v)

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
            <ChartCard title="Curva de equity" sub="PnL acumulado · trades cerrados" mb={14}>
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={charts.equityCurve} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
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
              <ChartCard title="Drawdown" sub="Caída máxima desde el pico de equity" mb={0}>
                <ResponsiveContainer width="100%" height={210}>
                  <AreaChart data={charts.drawdownCurve} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
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

              <ChartCard title="Portafolio vs S&P 500" sub="PnL acumulado real vs benchmark estimado" mb={0}>
                <ResponsiveContainer width="100%" height={210}>
                  <LineChart data={charts.sp500Curve} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
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

            {/* ── Win rate mensual heatmap + Razones de cierre ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              <ChartCard title="Win rate mensual" sub="% de trades ganadores por mes" mb={0}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  {charts.winRateHeatmap.map(m => (
                    <div key={m.month} style={{
                      background: m.color + '22',
                      border: `1px solid ${m.color}55`,
                      borderRadius: 6, padding: '8px 10px', minWidth: 80, textAlign: 'center',
                    }}>
                      <div style={{ fontSize: 9, color: '#888', marginBottom: 4 }}>{m.month}</div>
                      <div style={{ fontSize: 16, fontWeight: 900, color: m.color }}>{m.winRate}%</div>
                    </div>
                  ))}
                </div>
              </ChartCard>

              <ChartCard title="PnL por razón de cierre" sub="Suma de PnL agrupado por cómo cerraste" mb={0}>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={charts.closeReasonData} layout="vertical" margin={{ top: 4, right: 8, left: 60, bottom: 4 }}>
                    <CartesianGrid stroke="#151515" horizontal={false} strokeDasharray="3 3" />
                    <XAxis type="number" tick={{ fill: '#888', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                    <YAxis type="category" dataKey="reason" tick={{ fill: '#aaa', fontSize: 9 }} axisLine={false} tickLine={false} width={55} />
                    <Tooltip content={<CatTooltip formatter={(v: number, name: string) =>
                      name === 'pnl' ? fmtMoney(v) : String(v)
                    } />} />
                    <Bar dataKey="pnl" name="PnL" radius={[0,4,4,0]}>
                      {charts.closeReasonData.map((e, i) => <Cell key={i} fill={e.pnl >= 0 ? C.gain : C.loss} fillOpacity={0.8} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

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

            {/* ── Capital acumulado ── */}
            <ChartCard title="Capital invertido acumulado vs PnL" sub="Área = capital puesto en el mercado · línea = PnL acumulado" mb={14}>
              <ResponsiveContainer width="100%" height={230}>
                <ComposedChart data={charts.capitalAccum} margin={{ top: 4, right: 10, left: 0, bottom: 4 }}>
                  <defs>
                    <linearGradient id="capGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={C.sp500} stopOpacity={0.2} />
                      <stop offset="95%" stopColor={C.sp500} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#151515" vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fill: '#aaa', fontSize: 9 }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="left"  tick={{ fill: '#888', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fill: '#888', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                  <Tooltip content={<CatTooltip formatter={fmtMoney} />} />
                  <Area yAxisId="left" type="monotone" dataKey="capital" name="Capital" stroke={C.sp500} fill="url(#capGrad)" strokeWidth={1.5} dot={false} />
                  <Line yAxisId="right" type="monotone" dataKey="pnl" name="PnL" stroke={C.accent} strokeWidth={2.5} dot={false} />
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

function ChartCard({ title, sub, children, mb = 14 }: any) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '18px 20px', marginBottom: mb }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: '#888', letterSpacing: 0.8, textTransform: 'uppercase' as const, display: 'flex', alignItems: 'center', gap: 7 }}>
          <Paw size={10} color="#666" opacity={0.5} />
          {title}
        </div>
        {sub && <div style={{ fontSize: 9, color: '#555', marginTop: 3 }}>{sub}</div>}
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