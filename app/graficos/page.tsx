'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { usePrivacy } from '@/lib/PrivacyContext'
import AppShell from '../AppShell'
import { BarChart2 } from 'lucide-react'
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  ComposedChart, Area, Line, ReferenceLine,
} from 'recharts'

const C = {
  accent:  '#00bfff',
  success: '#22c55e',
  danger:  '#f43f5e',
  warning: '#eab308',
  sp500:   '#6366f1',
  card:    '#0a0a0a',
  border:  '#1a1a1a',
  muted:   '#444',
}

const PIE_COLORS = ['#00bfff','#6366f1','#22c55e','#eab308','#f43f5e','#a855f7','#ec4899','#14b8a6','#f97316','#84cc16']

const parseDate = (d: string) => new Date((d || '').split('T')[0] + 'T00:00:00')

// Número de semana ISO del año
const getWeekKey = (date: Date) => {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 4 - (d.getDay() || 7))
  const yearStart = new Date(d.getFullYear(), 0, 1)
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${d.getFullYear()}-S${String(week).padStart(2, '0')}`
}

export default function GraficosAbiertosPage() {
  const { money } = usePrivacy()

  const [allTrades,         setAllTrades]        = useState<any[]>([])
  const [allExecutions,     setAllExecutions]     = useState<any[]>([])
  const [portfolios,        setPortfolios]        = useState<any[]>([])
  const [selectedPortfolio, setSelectedPortfolio] = useState('all')
  const [loading,           setLoading]           = useState(true)

  const fetchData = useCallback(async () => {
    const [{ data: tData }, { data: pData }, { data: eData }] = await Promise.all([
      supabase.from('trades').select('*, portfolios(name, id)').eq('status', 'open'),
      supabase.from('portfolios').select('*'),
      supabase.from('trade_executions').select('*').order('executed_at', { ascending: true }),
    ])
    if (tData) setAllTrades(tData)
    if (pData) setPortfolios(pData)
    if (eData) setAllExecutions(eData)
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const trades = useMemo(() =>
    selectedPortfolio === 'all'
      ? allTrades
      : allTrades.filter(t => t.portfolio_id === selectedPortfolio)
  , [allTrades, selectedPortfolio])

  const tradeIds = useMemo(() => new Set(trades.map(t => t.id)), [trades])

  const charts = useMemo(() => {
    if (!trades.length) return null

    const totalInvested = trades.reduce((acc, t) => acc + Number(t.total_invested || 0), 0)

    // ── 1. Capital por sector (pie) ──────────────────────────────────────
    const sectorMap: Record<string, number> = {}
    trades.forEach(t => {
      const s = t.sector || 'Otros'
      sectorMap[s] = (sectorMap[s] || 0) + Number(t.total_invested || 0)
    })
    const sectorData = Object.entries(sectorMap)
      .map(([name, value]) => ({
        name,
        value: parseFloat(value.toFixed(2)),
        pct:   parseFloat((value / totalInvested * 100).toFixed(1)),
      }))
      .sort((a, b) => b.value - a.value)

    // ── 2. Capital por portafolio (barras) ───────────────────────────────
    const portfolioMap: Record<string, { name: string, value: number }> = {}
    trades.forEach(t => {
      const id   = t.portfolio_id
      const name = t.portfolios?.name || id
      if (!portfolioMap[id]) portfolioMap[id] = { name, value: 0 }
      portfolioMap[id].value += Number(t.total_invested || 0)
    })
    const portfolioData = Object.values(portfolioMap)
      .map(p => ({
        ...p,
        value: parseFloat(p.value.toFixed(2)),
        pct:   parseFloat((p.value / totalInvested * 100).toFixed(1)),
      }))
      .sort((a, b) => b.value - a.value)

    // ── 3. Horizonte (dona) ──────────────────────────────────────────────
    let long = 0, mid = 0, short = 0
    trades.forEach(t => {
      const name = (t.portfolios?.name || '').toLowerCase()
      const inv  = Number(t.total_invested || 0)
      if (name.includes('largo'))      long  += inv
      else if (name.includes('media')) mid   += inv
      else                             short += inv
    })
    const horizonData = [
      { name: 'Largo plazo',          value: parseFloat(long.toFixed(2)),  pct: parseFloat((long  / totalInvested * 100).toFixed(1)), color: C.success },
      { name: 'Mediano plazo',        value: parseFloat(mid.toFixed(2)),   pct: parseFloat((mid   / totalInvested * 100).toFixed(1)), color: C.warning },
      { name: 'Corto / Especulativo', value: parseFloat(short.toFixed(2)), pct: parseFloat((short / totalInvested * 100).toFixed(1)), color: C.danger  },
    ].filter(h => h.value > 0)

    // ── 4. PnL mensual (desde apertura de cada trade, usando entry_price) ─
    // Usamos realized_pnl parcial acumulado mes a mes desde open_date
    const monthlyMap: Record<string, number> = {}
    trades.forEach(t => {
      const m   = parseDate(t.open_date).toLocaleDateString('es-MX', { year: 'numeric', month: 'short' })
      const pnl = Number(t.realized_pnl || 0)
      monthlyMap[m] = (monthlyMap[m] || 0) + pnl
    })
    const monthlyData = Object.entries(monthlyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, pnl]) => ({ month, pnl: parseFloat(pnl.toFixed(2)) }))

    // ── 5. Volatilidad y rendimiento semanal (desde trade_executions) ────
    // Agrupamos precios de ejecución por semana para calcular variación
    const weeklyPrices: Record<string, number[]> = {}
    allExecutions
      .filter(e => tradeIds.has(e.trade_id))
      .forEach(e => {
        const week = getWeekKey(parseDate((e.executed_at || '').split('T')[0]))
        if (!weeklyPrices[week]) weeklyPrices[week] = []
        weeklyPrices[week].push(Number(e.price || 0))
      })

    // También incluimos precios de apertura de trades
    trades.forEach(t => {
      const week = getWeekKey(parseDate(t.open_date))
      if (!weeklyPrices[week]) weeklyPrices[week] = []
      weeklyPrices[week].push(Number(t.entry_price || 0))
    })

    const weeklyData = Object.entries(weeklyPrices)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, prices]) => {
        if (prices.length < 2) return { week, volatilidad: 0, rendimiento: 0 }
        const returns  = prices.slice(1).map((p, i) => (p - prices[i]) / prices[i] * 100)
        const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length
        const variance  = returns.reduce((a, r) => a + Math.pow(r - avgReturn, 2), 0) / returns.length
        const volatilidad = parseFloat(Math.sqrt(variance).toFixed(2))
        const rendimiento = parseFloat(avgReturn.toFixed(2))
        return { week, volatilidad, rendimiento }
      })
      .filter(w => w.volatilidad > 0 || w.rendimiento !== 0)

    // ── 6. Drawdown vs PnL acumulado (datos históricos combinados) ────────
    // Ordenamos trades por open_date y calculamos PnL acumulado + drawdown
    const sortedByDate = [...trades].sort(
      (a, b) => parseDate(a.open_date).getTime() - parseDate(b.open_date).getTime()
    )
    let cumPnL = 0, peak = 0
    const drawdownPnLData = sortedByDate.map(t => {
      cumPnL += Number(t.realized_pnl || 0)
      if (cumPnL > peak) peak = cumPnL
      const dd = peak > 0 ? parseFloat(((peak - cumPnL) / peak * -100).toFixed(2)) : 0
      return {
        date:      parseDate(t.open_date).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }),
        pnl:       parseFloat(cumPnL.toFixed(2)),
        drawdown:  dd,
      }
    })

    return {
      sectorData, portfolioData, horizonData,
      monthlyData, weeklyData, drawdownPnLData,
      totalInvested,
    }
  }, [trades, allExecutions, tradeIds])

  if (loading) return (
    <AppShell>
      <div style={{ padding: 40, color: C.muted }}>Cargando gráficas...</div>
    </AppShell>
  )

  const tooltipStyle = { background: '#050505', border: `1px solid ${C.border}`, fontSize: 11, borderRadius: 8 }

  return (
    <AppShell>
      <div style={{ padding: '24px 30px', color: 'white', maxWidth: 1400, margin: '0 auto' }}>

        {/* HEADER */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <BarChart2 size={20} color={C.accent} />
          <h1 style={{ fontSize: 18, fontWeight: 900, margin: 0 }}>Gráficas — trades abiertos</h1>
        </div>

        {/* FILTRO PORTAFOLIOS */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 24, borderBottom: `1px solid ${C.border}`, paddingBottom: 14, flexWrap: 'wrap' }}>
          {[{ id: 'all', name: 'Todos' }, ...portfolios].map(p => (
            <button key={p.id} onClick={() => setSelectedPortfolio(p.id)} style={filterBtn(selectedPortfolio === p.id)}>
              {p.name}
            </button>
          ))}
        </div>

        {!charts ? (
          <div style={{ textAlign: 'center', padding: 80, color: '#333' }}>
            No hay trades abiertos para este portafolio.
          </div>
        ) : (
          <>
            {/* KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
              <KpiCard label="Capital total expuesto" value={money(charts.totalInvested)} color={C.accent} />
              <KpiCard label="Posiciones abiertas"    value={String(trades.length)}        color="#fff" />
              <KpiCard label="Portafolios activos"    value={String(charts.portfolioData.length)} color={C.warning} />
            </div>

            {/* ── FILA 1: Sector pie + Horizonte dona ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>

              <ChartCard title="Capital por sector" sub="Distribución porcentual del capital invertido">
                <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
                  <div style={{ flex: '0 0 200px' }}>
                    <ResponsiveContainer width={200} height={200}>
                      <PieChart>
                        <Pie data={charts.sectorData} cx="50%" cy="50%"
                          innerRadius={50} outerRadius={80}
                          paddingAngle={3} dataKey="value">
                          {charts.sectorData.map((_, i) => (
                            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="none" />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} formatter={(v: any, name: string) => [money(v), name]} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {charts.sectorData.map((s, i) => (
                      <div key={s.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 7, color: '#aaa' }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: PIE_COLORS[i % PIE_COLORS.length], flexShrink: 0, display: 'inline-block' }} />
                          {s.name}
                        </span>
                        <span style={{ fontWeight: 700, color: '#fff' }}>{s.pct}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </ChartCard>

              <ChartCard title="Horizonte de inversión" sub="Capital por plazo según billetera">
                <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
                  <div style={{ flex: '0 0 200px' }}>
                    <ResponsiveContainer width={200} height={200}>
                      <PieChart>
                        <Pie data={charts.horizonData} cx="50%" cy="50%"
                          innerRadius={55} outerRadius={80}
                          paddingAngle={5} dataKey="value"
                          startAngle={90} endAngle={-270}>
                          {charts.horizonData.map((h, i) => (
                            <Cell key={i} fill={h.color} stroke="none" />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} formatter={(v: any, name: string) => [money(v), name]} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {charts.horizonData.map(h => (
                      <div key={h.name}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 5 }}>
                          <span style={{ color: '#aaa', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: h.color, display: 'inline-block' }} />
                            {h.name}
                          </span>
                          <span style={{ fontWeight: 700, color: h.color }}>{h.pct}%</span>
                        </div>
                        <div style={{ background: '#111', height: 4, borderRadius: 2 }}>
                          <div style={{ width: `${h.pct}%`, background: h.color, height: '100%', borderRadius: 2, opacity: 0.7 }} />
                        </div>
                        <div style={{ fontSize: 10, color: C.muted, marginTop: 3, textAlign: 'right' }}>{money(h.value)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </ChartCard>
            </div>

            {/* ── FILA 2: Capital por portafolio + PnL mensual ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <ChartCard title="Capital por portafolio" sub="Total invertido en trades abiertos por billetera">
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={charts.portfolioData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid stroke="#111" vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="name" stroke="#222" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis stroke="#222" fontSize={9} tickLine={false} axisLine={false} tickFormatter={v => `$${v.toLocaleString()}`} />
                    <Tooltip contentStyle={tooltipStyle}
                      formatter={(v: any) => [money(v), 'Invertido']}
                      labelFormatter={(label, payload) => {
                        const item = payload?.[0]?.payload
                        return item ? `${label} · ${item.pct}% del total` : label
                      }}
                    />
                    <Bar dataKey="value" radius={[6, 6, 0, 0]} fill={C.accent} fillOpacity={0.8} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="PnL mensual realizado" sub="PnL acumulado de trades abiertos por mes de apertura">
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={charts.monthlyData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid stroke="#111" vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="month" stroke="#222" fontSize={9} tickLine={false} axisLine={false} />
                    <YAxis stroke="#222" fontSize={9} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [money(v), 'PnL']} />
                    <ReferenceLine y={0} stroke="#333" />
                    <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                      {charts.monthlyData.map((entry, i) => (
                        <Cell key={i} fill={entry.pnl >= 0 ? C.success : C.danger} fillOpacity={0.8} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            {/* ── FILA 3: Volatilidad + Rendimiento semanal ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <ChartCard title="Volatilidad semanal" sub="Desviación estándar de precios de ejecución por semana">
                {charts.weeklyData.length > 1 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={charts.weeklyData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                      <CartesianGrid stroke="#111" vertical={false} strokeDasharray="3 3" />
                      <XAxis dataKey="week" stroke="#222" fontSize={8} tickLine={false} axisLine={false} />
                      <YAxis stroke="#222" fontSize={9} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [`${v}%`, 'Volatilidad']} />
                      <Bar dataKey="volatilidad" radius={[4, 4, 0, 0]} fill={C.warning} fillOpacity={0.75} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyChart message="Se necesitan más ejecuciones para calcular volatilidad" height={200} />
                )}
              </ChartCard>

              <ChartCard title="Rendimiento semanal promedio" sub="Variación % promedio de precios de ejecución por semana">
                {charts.weeklyData.length > 1 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={charts.weeklyData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                      <CartesianGrid stroke="#111" vertical={false} strokeDasharray="3 3" />
                      <XAxis dataKey="week" stroke="#222" fontSize={8} tickLine={false} axisLine={false} />
                      <YAxis stroke="#222" fontSize={9} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [`${v}%`, 'Rendimiento']} />
                      <ReferenceLine y={0} stroke="#333" />
                      <Bar dataKey="rendimiento" radius={[4, 4, 0, 0]}>
                        {charts.weeklyData.map((entry, i) => (
                          <Cell key={i} fill={entry.rendimiento >= 0 ? C.success : C.danger} fillOpacity={0.8} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyChart message="Se necesitan más ejecuciones para calcular rendimiento" height={200} />
                )}
              </ChartCard>
            </div>

            {/* ── FILA 4: Drawdown vs PnL acumulado (gráfica combinada) ── */}
            <ChartCard title="Drawdown vs PnL acumulado" sub="Caída máxima desde el pico (área roja) sobre el PnL acumulado (línea azul)">
              {charts.drawdownPnLData.length > 1 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={charts.drawdownPnLData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <defs>
                      <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={C.danger} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={C.danger} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#111" vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="date" stroke="#222" fontSize={9} tickLine={false} axisLine={false} />
                    <YAxis yAxisId="left"  stroke="#222" fontSize={9} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                    <YAxis yAxisId="right" orientation="right" stroke="#222" fontSize={9} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(v: any, name: string) =>
                        name === 'pnl' ? [money(v), 'PnL acumulado'] : [`${v}%`, 'Drawdown']
                      }
                    />
                    <ReferenceLine yAxisId="left" y={0} stroke="#333" strokeDasharray="3 3" />
                    <Area
                      yAxisId="right" type="monotone" dataKey="drawdown"
                      stroke={C.danger} fill="url(#ddGrad)" strokeWidth={1.5} dot={false}
                    />
                    <Line
                      yAxisId="left" type="monotone" dataKey="pnl"
                      stroke={C.accent} strokeWidth={2.5} dot={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart message="Se necesitan más trades para calcular drawdown" height={260} />
              )}
              <div style={{ display: 'flex', gap: 20, marginTop: 10, fontSize: 9, color: C.muted }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 16, height: 2, background: C.accent, display: 'inline-block' }} />
                  PnL acumulado (eje izq.)
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 16, height: 8, background: C.danger, opacity: 0.4, display: 'inline-block', borderRadius: 2 }} />
                  Drawdown % (eje der.)
                </span>
              </div>
            </ChartCard>
          </>
        )}
      </div>
    </AppShell>
  )
}

function KpiCard({ label, value, color = 'white' }: any) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '16px 18px' }}>
      <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' as const, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color }}>{value}</div>
    </div>
  )
}

function ChartCard({ title, sub, children, mb = 16 }: any) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px 22px', marginBottom: mb }}>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: '#555', letterSpacing: 0.8, textTransform: 'uppercase' as const }}>{title}</div>
        {sub && <div style={{ fontSize: 9, color: C.muted, marginTop: 3 }}>{sub}</div>}
      </div>
      {children}
    </div>
  )
}

function EmptyChart({ message, height = 200 }: { message: string, height?: number }) {
  return (
    <div style={{
      height, display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#2a2a2a', fontSize: 11, border: '1px dashed #1a1a1a', borderRadius: 8,
    }}>
      {message}
    </div>
  )
}

const filterBtn = (active: boolean): React.CSSProperties => ({
  padding: '6px 14px', borderRadius: 6, border: 'none',
  background: active ? C.accent : '#111',
  color: active ? '#000' : '#555',
  cursor: 'pointer', fontSize: 10, fontWeight: 'bold', whiteSpace: 'nowrap',
})