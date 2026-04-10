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
const SP500_DAILY = 0.0003

const C = {
  gain:    '#22c55e',
  loss:    '#f43f5e',
  accent:  '#00bfff',
  sp500:   '#6366f1',
  warning: '#eab308',
  card:    '#0a0a0a',
  border:  '#1a1a1a',
  muted:   '#444',
}

const PIE_COLORS = ['#00bfff','#6366f1','#22c55e','#eab308','#f43f5e','#a855f7','#ec4899','#14b8a6','#f97316','#84cc16']

export default function Graficos2Page() {
  const { money } = usePrivacy()

  const [allTrades,         setAllTrades]        = useState<any[]>([])
  const [portfolios,        setPortfolios]        = useState<any[]>([])
  const [selectedPortfolio, setSelectedPortfolio] = useState('all')
  const [loading,           setLoading]           = useState(true)

  const fetchData = useCallback(async () => {
    const [{ data: tData }, { data: pData }] = await Promise.all([
      supabase.from('trades').select('*').eq('status', 'closed'),
      supabase.from('portfolios').select('*'),
    ])
    if (tData) setAllTrades(tData)
    if (pData) setPortfolios(pData)
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const trades = useMemo(() =>
    selectedPortfolio === 'all'
      ? allTrades
      : allTrades.filter(t => t.portfolio_id === selectedPortfolio)
  , [allTrades, selectedPortfolio])

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

    const equityCurve:       any[] = []
    const drawdownCurve:     any[] = []
    const sp500Curve:        any[] = []
    const capitalAccum:      any[] = []
    const monthly:           Record<string, { pnl: number, sp500: number }> = {}
    const sector:            Record<string, number> = {}
    const weekday:           Record<string, number> = {}
    const pnlDistribution:   any[] = []
    const durationBuckets:   Record<string, number> = {
      '1-7 días': 0, '8-30 días': 0, '31-90 días': 0, '+90 días': 0
    }

    sorted.forEach((t, i) => {
      const pnl      = Number(t.realized_pnl) || 0
      const inv      = Number(t.total_invested) || 0
      const thisDate = parseDate(t.close_date)
      const days     = i === 0 ? 1 : Math.max(1, Math.ceil(
        (thisDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24)
      ))

      // Duración del trade
      const tradeDays = Math.max(1, Math.ceil(
        Math.abs(parseDate(t.close_date).getTime() - parseDate(t.open_date).getTime()) / (1000 * 60 * 60 * 24)
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
        SP500:      parseFloat(sp500.toFixed(2)),
      })
      capitalAccum.push({
        date:    label,
        capital: parseFloat(cumCapital.toFixed(2)),
        pnl:     parseFloat(equity.toFixed(2)),
      })

      if (pnl >= 0) { wins++; totalWin += pnl } else { losses++; totalLoss += Math.abs(pnl) }

      const m = thisDate.toLocaleDateString('es-MX', { year: 'numeric', month: 'short' })
      if (!monthly[m]) monthly[m] = { pnl: 0, sp500: 0 }
      monthly[m].pnl  += pnl
      monthly[m].sp500 += base * (Math.pow(1 + SP500_DAILY, days) - 1)

      const s = t.sector || 'Otros'
      sector[s] = (sector[s] || 0) + pnl

      const d = thisDate.toLocaleDateString('es-MX', { weekday: 'short' })
      weekday[d] = (weekday[d] || 0) + pnl

      const pnlPct = inv > 0 ? parseFloat(((pnl / inv) * 100).toFixed(1)) : 0
      pnlDistribution.push({ ticker: t.ticker, pnlPct, color: pnl >= 0 ? C.gain : C.loss })
    })

    const monthlyComparison = Object.entries(monthly)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, d]) => ({
        month,
        Portafolio: parseFloat(d.pnl.toFixed(2)),
        SP500:      parseFloat(d.sp500.toFixed(2)),
        Alpha:      parseFloat((d.pnl - d.sp500).toFixed(2)),
      }))

    const winRate      = wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0
    const profitFactor = totalLoss > 0 ? totalWin / totalLoss : totalWin
    const maxDD        = drawdownCurve.reduce((min, d) => Math.min(min, d.drawdown), 0)

    return {
      equityCurve, drawdownCurve, sp500Curve, capitalAccum,
      monthlyComparison,
      durationData: Object.entries(durationBuckets).map(([bucket, count]) => ({ bucket, count })),
      sectorData: Object.entries(sector)
        .map(([name, value]) => ({ name, value: parseFloat(value.toFixed(2)) }))
        .sort((a, b) => b.value - a.value),
      weekdayData: Object.entries(weekday)
        .map(([day, pnl]) => ({ day, pnl: parseFloat(pnl.toFixed(2)) })),
      pnlDistribution: pnlDistribution.sort((a, b) => a.pnlPct - b.pnlPct),
      winRate:       parseFloat(winRate.toFixed(1)),
      profitFactor:  parseFloat(profitFactor.toFixed(2)),
      maxDD:         parseFloat(Math.abs(maxDD).toFixed(2)),
      totalPnL:      parseFloat(equity.toFixed(2)),
      totalTrades:   sorted.length,
      wins, losses,
    }
  }, [trades])

  if (loading) return <AppShell><div style={{ padding: 40, color: C.muted }}>Cargando análisis...</div></AppShell>

  const tt = { background: '#050505', border: `1px solid ${C.border}`, fontSize: 11, borderRadius: 8 }

  return (
    <AppShell>
      <div style={{ padding: '24px 30px', color: 'white', maxWidth: 1400, margin: '0 auto' }}>

        {/* HEADER */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <TrendingUp size={20} color={C.accent} />
          <h1 style={{ fontSize: 18, fontWeight: 900, margin: 0 }}>Gráficas — trades cerrados</h1>
        </div>

        {/* FILTRO */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: `1px solid ${C.border}`, paddingBottom: 14, flexWrap: 'wrap' }}>
          {[{ id: 'all', name: 'Todos' }, ...portfolios].map(p => (
            <button key={p.id} onClick={() => setSelectedPortfolio(p.id)} style={filterBtn(selectedPortfolio === p.id)}>
              {p.name}
            </button>
          ))}
        </div>

        {!charts ? (
          <div style={{ textAlign: 'center', padding: 80, color: '#333' }}>No hay trades cerrados para este portafolio.</div>
        ) : (
          <>
            {/* KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 20 }}>
              {[
                { label: 'PnL total',       value: money(charts.totalPnL),     color: charts.totalPnL >= 0 ? C.gain : C.loss },
                { label: 'Win rate',        value: `${charts.winRate}%`,        color: charts.winRate >= 50 ? C.gain : C.loss },
                { label: 'Profit factor',   value: String(charts.profitFactor), color: charts.profitFactor >= 1.5 ? C.gain : C.warning },
                { label: 'Max drawdown',    value: `${charts.maxDD}%`,          color: C.loss },
                { label: 'Trades cerrados', value: String(charts.totalTrades),  color: '#fff' },
              ].map(k => (
                <div key={k.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '16px 18px' }}>
                  <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' as const, marginBottom: 8 }}>{k.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: k.color, fontFamily: 'monospace' }}>{k.value}</div>
                </div>
              ))}
            </div>

            {/* ── F1: Equity curve ── */}
            <ChartCard title="Curva de equity" sub="PnL acumulado · trades cerrados" mb={16}>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={charts.equityCurve} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <defs>
                    <linearGradient id="eqGrad2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={C.accent} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={C.accent} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#111" vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="date" stroke="#222" fontSize={9} tickLine={false} axisLine={false} />
                  <YAxis stroke="#222" fontSize={9} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                  <Tooltip contentStyle={tt} formatter={(v: any) => [money(v), 'Equity']} />
                  <ReferenceLine y={0} stroke="#333" strokeDasharray="3 3" />
                  <Area type="monotone" dataKey="equity" stroke={C.accent} fill="url(#eqGrad2)" strokeWidth={2.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* ── F2: Drawdown + SP500 ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <ChartCard title="Drawdown" sub="Caída máxima desde el pico de equity" mb={0}>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={charts.drawdownCurve} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <defs>
                      <linearGradient id="ddGrad2" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={C.loss} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={C.loss} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#111" vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="date" stroke="#222" fontSize={9} tickLine={false} axisLine={false} />
                    <YAxis stroke="#222" fontSize={9} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} />
                    <Tooltip contentStyle={tt} formatter={(v: any) => [`${v}%`, 'Drawdown']} />
                    <ReferenceLine y={0} stroke="#333" />
                    <Area type="monotone" dataKey="drawdown" stroke={C.loss} fill="url(#ddGrad2)" strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Portafolio vs S&P 500" sub="PnL acumulado real vs benchmark" mb={0}>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={charts.sp500Curve} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid stroke="#111" vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="date" stroke="#222" fontSize={9} tickLine={false} axisLine={false} />
                    <YAxis stroke="#222" fontSize={9} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                    <Tooltip contentStyle={tt} formatter={(v: any, name: string) => [money(v), name]} />
                    <ReferenceLine y={0} stroke="#333" strokeDasharray="3 3" />
                    <Line type="monotone" dataKey="Portafolio" stroke={C.accent} strokeWidth={2}   dot={false} />
                    <Line type="monotone" dataKey="SP500"      stroke={C.sp500}  strokeWidth={1.5} dot={false} strokeDasharray="5 5" />
                  </LineChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 9, color: C.muted }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 14, height: 2, background: C.accent, display: 'inline-block' }} /> Mi portafolio
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 14, height: 1, background: C.sp500, display: 'inline-block' }} /> S&P 500
                  </span>
                </div>
              </ChartCard>
            </div>

            {/* ── F3: PnL mensual vs SP500 + Alpha mensual ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16, marginBottom: 16 }}>
              <ChartCard title="PnL mensual vs S&P 500" sub="Barras = portafolio · línea punteada = benchmark" mb={0}>
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart data={charts.monthlyComparison} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid stroke="#111" vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="month" stroke="#222" fontSize={9} tickLine={false} axisLine={false} />
                    <YAxis stroke="#222" fontSize={9} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                    <Tooltip contentStyle={tt} formatter={(v: any, name: string) => [money(v), name]} />
                    <ReferenceLine y={0} stroke="#333" />
                    <Bar dataKey="Portafolio" radius={[3, 3, 0, 0]}>
                      {charts.monthlyComparison.map((entry, i) => (
                        <Cell key={i} fill={entry.Portafolio >= 0 ? C.gain : C.loss} fillOpacity={0.8} />
                      ))}
                    </Bar>
                    <Line type="monotone" dataKey="SP500" stroke={C.sp500} strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
                  </ComposedChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Alpha mensual" sub="Tu rendimiento menos el S&P 500 por mes" mb={0}>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={charts.monthlyComparison} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid stroke="#111" vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="month" stroke="#222" fontSize={9} tickLine={false} axisLine={false} />
                    <YAxis stroke="#222" fontSize={9} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                    <Tooltip contentStyle={tt} formatter={(v: any) => [money(v), 'Alpha']} />
                    <ReferenceLine y={0} stroke="#333" />
                    <Bar dataKey="Alpha" radius={[3, 3, 0, 0]}>
                      {charts.monthlyComparison.map((entry, i) => (
                        <Cell key={i} fill={entry.Alpha >= 0 ? C.gain : C.loss} fillOpacity={0.85} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            {/* ── F4: Distribución PnL % + Duración histograma ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, marginBottom: 16 }}>
              <ChartCard title="Distribución de PnL % por trade" sub="Cada barra = un trade cerrado · verde = ganado · rojo = perdido" mb={0}>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={charts.pnlDistribution} margin={{ top: 5, right: 10, left: 0, bottom: 30 }}>
                    <CartesianGrid stroke="#111" vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="ticker" stroke="#222" fontSize={8} tickLine={false} axisLine={false} angle={-45} textAnchor="end" height={40} />
                    <YAxis stroke="#222" fontSize={9} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} />
                    <Tooltip contentStyle={tt} formatter={(v: any) => [`${v}%`, 'PnL %']} />
                    <ReferenceLine y={0} stroke="#333" />
                    <Bar dataKey="pnlPct" radius={[3, 3, 0, 0]}>
                      {charts.pnlDistribution.map((entry, i) => (
                        <Cell key={i} fill={entry.color} fillOpacity={0.85} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Duración de trades" sub="Histograma por rango de días en posición" mb={0}>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={charts.durationData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid stroke="#111" vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="bucket" stroke="#222" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis stroke="#222" fontSize={9} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={tt} formatter={(v: any) => [v, 'Trades']} />
                    <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                      {charts.durationData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} fillOpacity={0.8} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            {/* ── F5: Capital acumulado + Sectores + Días + Win/Loss ── */}
            <ChartCard title="Acumulación de capital invertido vs PnL" sub="Capital total puesto en el mercado (área) vs PnL acumulado (línea)" mb={16}>
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={charts.capitalAccum} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <defs>
                    <linearGradient id="capGrad2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={C.sp500} stopOpacity={0.2} />
                      <stop offset="95%" stopColor={C.sp500} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#111" vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="date" stroke="#222" fontSize={9} tickLine={false} axisLine={false} />
                  <YAxis yAxisId="left"  stroke="#222" fontSize={9} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                  <YAxis yAxisId="right" orientation="right" stroke="#222" fontSize={9} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                  <Tooltip contentStyle={tt} formatter={(v: any, name: string) => [money(v), name === 'capital' ? 'Capital acumulado' : 'PnL acumulado']} />
                  <Area yAxisId="left" type="monotone" dataKey="capital" stroke={C.sp500} fill="url(#capGrad2)" strokeWidth={1.5} dot={false} />
                  <Line yAxisId="right" type="monotone" dataKey="pnl" stroke={C.accent} strokeWidth={2.5} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', gap: 20, marginTop: 8, fontSize: 9, color: C.muted }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 14, height: 8, background: C.sp500, opacity: 0.3, display: 'inline-block', borderRadius: 2 }} /> Capital invertido acumulado
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 14, height: 2, background: C.accent, display: 'inline-block' }} /> PnL acumulado
                </span>
              </div>
            </ChartCard>

            {/* ── F6: Sectores + Días + Win/Loss ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 24 }}>
              <ChartCard title="PnL por sector" sub="Suma de PnL realizado por sector" mb={0}>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={charts.sectorData.filter(s => s.value !== 0)}
                      cx="50%" cy="50%" innerRadius={50} outerRadius={75}
                      paddingAngle={4} dataKey="value">
                      {charts.sectorData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="none" />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tt} formatter={(v: any, name: string) => [money(v), name]} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px 10px', marginTop: 8 }}>
                  {charts.sectorData.slice(0, 6).map((s, i) => (
                    <span key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: '#888' }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: PIE_COLORS[i % PIE_COLORS.length], display: 'inline-block' }} />
                      {s.name}
                    </span>
                  ))}
                </div>
              </ChartCard>

              <ChartCard title="Rendimiento por día de la semana" sub="PnL total por día de cierre" mb={0}>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={charts.weekdayData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid stroke="#111" vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="day" stroke="#222" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis stroke="#222" fontSize={9} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                    <Tooltip contentStyle={tt} formatter={(v: any) => [money(v), 'PnL']} />
                    <ReferenceLine y={0} stroke="#333" />
                    <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                      {charts.weekdayData.map((entry, i) => (
                        <Cell key={i} fill={entry.pnl >= 0 ? C.gain : C.loss} fillOpacity={0.8} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Win vs Loss" sub={`${charts.wins} ganados · ${charts.losses} perdidos`} mb={0}>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={[{ name: 'Ganados', value: charts.wins }, { name: 'Perdidos', value: charts.losses }]}
                      cx="50%" cy="50%" innerRadius={50} outerRadius={75}
                      paddingAngle={6} dataKey="value" startAngle={90} endAngle={-270}>
                      <Cell fill={C.gain} stroke="none" />
                      <Cell fill={C.loss} stroke="none" />
                    </Pie>
                    <Tooltip contentStyle={tt} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginTop: 8 }}>
                  <span style={{ fontSize: 11, color: C.gain, fontWeight: 700 }}>● {charts.wins} ganados</span>
                  <span style={{ fontSize: 11, color: C.loss, fontWeight: 700 }}>● {charts.losses} perdidos</span>
                </div>
              </ChartCard>
            </div>
          </>
        )}
      </div>
    </AppShell>
  )
}

function ChartCard({ title, sub, children, mb = 16 }: any) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px 22px', marginBottom: mb }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: '#555', letterSpacing: 0.8, textTransform: 'uppercase' as const }}>{title}</div>
        {sub && <div style={{ fontSize: 9, color: C.muted, marginTop: 3 }}>{sub}</div>}
      </div>
      {children}
    </div>
  )
}

const filterBtn = (active: boolean): React.CSSProperties => ({
  padding: '6px 14px', borderRadius: 6, border: 'none',
  background: active ? C.accent : '#111',
  color: active ? '#000' : '#555',
  cursor: 'pointer', fontSize: 10, fontWeight: 'bold', whiteSpace: 'nowrap',
})