'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { usePrivacy } from '@/lib/PrivacyContext'
import AppShell from '../AppShell'
import { BarChart2 } from 'lucide-react'
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  ComposedChart, Area, Line, ReferenceLine, Legend,
} from 'recharts'

const C = {
  accent:  '#00bfff',
  success: '#22c55e',
  danger:  '#f43f5e',
  warning: '#eab308',
  sp500:   '#a78bfa',
  card:    '#080808',
  border:  '#1a1a1a',
  muted:   '#888',
}

const PIE_COLORS = ['#00bfff','#6366f1','#22c55e','#eab308','#f43f5e','#a855f7','#ec4899','#14b8a6','#f97316','#84cc16']

const parseDate = (d: string) => new Date((d || '').split('T')[0] + 'T00:00:00')

const getWeekKey = (date: Date) => {
  const d = new Date(date)
  d.setHours(0,0,0,0)
  d.setDate(d.getDate() + 4 - (d.getDay() || 7))
  const yearStart = new Date(d.getFullYear(), 0, 1)
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${d.getFullYear()}-S${String(week).padStart(2,'0')}`
}

// ── Cat decorators ─────────────────────────────────────────────────────────
const Paw = ({ size = 14, color = '#444', opacity = 1, style: s = {} }: any) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ opacity, flexShrink: 0, ...s }}>
    <ellipse cx="6"  cy="5"  rx="2.5" ry="3"/>
    <ellipse cx="11" cy="3"  rx="2.5" ry="3"/>
    <ellipse cx="16" cy="4"  rx="2.5" ry="3"/>
    <ellipse cx="19" cy="9"  rx="2"   ry="2.5"/>
    <path d="M12 22c-5 0-8-3-8-7 0-2.5 1.5-4.5 4-5.5 1-.4 2-.6 4-.6s3 .2 4 .6c2.5 1 4 3 4 5.5 0 4-3 7-8 7z"/>
  </svg>
)
const CatEars = ({ color = '#00bfff', opacity = 0.1, size = 36 }: any) => (
  <svg width={size * 1.5} height={size} viewBox="0 0 60 40" fill={color} style={{ opacity }}>
    <polygon points="0,40 12,0 24,40"/>
    <polygon points="36,40 48,0 60,40"/>
  </svg>
)
const CatTail = ({ color = '#00bfff', opacity = 0.07 }: any) => (
  <svg width={44} height={70} viewBox="0 0 50 80" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" style={{ opacity }}>
    <path d="M40 80 Q45 50 20 40 Q0 30 10 10 Q20 -5 35 5"/>
  </svg>
)

// Tooltip custom — fondo oscuro con texto blanco
const CustomTooltip = ({ active, payload, label, formatter }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#0d0d0d', border: '1px solid #333', borderRadius: 8, padding: '10px 14px', fontSize: 11 }}>
      {label && <div style={{ color: '#aaa', marginBottom: 6, fontWeight: 600 }}>{label}</div>}
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ color: p.color || '#fff', marginBottom: 2 }}>
          <span style={{ color: '#888', marginRight: 6 }}>{p.name}:</span>
          <span style={{ fontWeight: 700 }}>
            {formatter ? formatter(p.value, p.name) : p.value}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function GraficosAbiertosPage() {
  const { money } = usePrivacy()

  const [allTrades,         setAllTrades]         = useState<any[]>([])
  const [allExecutions,     setAllExecutions]      = useState<any[]>([])
  const [portfolios,        setPortfolios]         = useState<any[]>([])
  const [selectedPortfolio, setSelectedPortfolio]  = useState('all')
  const [loading,           setLoading]            = useState(true)
  const [sp500Data,         setSp500Data]          = useState<Record<string, number>>({})

  const fetchData = useCallback(async () => {
    const [{ data: tData }, { data: pData }, { data: eData }] = await Promise.all([
      supabase.from('trades').select('*, portfolios(name,id)').eq('status','open'),
      supabase.from('portfolios').select('*'),
      supabase.from('trade_executions').select('*').order('executed_at', { ascending: true }),
    ])
    if (tData) setAllTrades(tData)
    if (pData) setPortfolios(pData)
    if (eData) setAllExecutions(eData)
    setLoading(false)
  }, [])

  // Obtener datos SP500 históricos desde Yahoo Finance via API pública
  const fetchSP500 = useCallback(async (fromDate: string) => {
    try {
      const from = Math.floor(new Date(fromDate).getTime() / 1000)
      const to   = Math.floor(Date.now() / 1000)
      const res  = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?interval=1d&period1=${from}&period2=${to}`
      )
      const json = await res.json()
      const timestamps: number[] = json?.chart?.result?.[0]?.timestamp || []
      const closes: number[]     = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || []
      const map: Record<string, number> = {}
      timestamps.forEach((ts, i) => {
        if (closes[i] != null) {
          const dateStr = new Date(ts * 1000).toISOString().split('T')[0]
          map[dateStr] = closes[i]
        }
      })
      setSp500Data(map)
    } catch (e) { console.error('SP500 fetch error:', e) }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const trades = useMemo(() =>
    selectedPortfolio === 'all'
      ? allTrades
      : allTrades.filter(t => t.portfolio_id === selectedPortfolio)
  , [allTrades, selectedPortfolio])

  // Cargar SP500 cuando cambian los trades
  useEffect(() => {
    if (!trades.length) return
    const sorted = [...trades].sort((a, b) => parseDate(a.open_date).getTime() - parseDate(b.open_date).getTime())
    if (sorted[0]?.open_date) fetchSP500(sorted[0].open_date)
  }, [trades, fetchSP500])

  const tradeIds = useMemo(() => new Set(trades.map(t => t.id)), [trades])

  const charts = useMemo(() => {
    if (!trades.length) return null

    const totalInvested = trades.reduce((acc, t) => acc + Number(t.total_invested || 0), 0)
    const totalActual = trades.reduce((acc, t) => {
      const qty = Number(t.quantity || 0)
      const cur = Number(t.last_price || t.entry_price || 0)
      return acc + qty * cur
    }, 0)

    // Capital por sector
    const sectorMap: Record<string, number> = {}
    trades.forEach(t => {
      const s = t.sector || 'Otros'
      sectorMap[s] = (sectorMap[s] || 0) + Number(t.total_invested || 0)
    })
    const sectorData = Object.entries(sectorMap)
      .map(([name, value]) => ({ name, value: parseFloat(value.toFixed(2)), pct: parseFloat((value / totalInvested * 100).toFixed(1)) }))
      .sort((a, b) => b.value - a.value)

    // Capital por portafolio
    const portfolioMap: Record<string, { name: string, value: number }> = {}
    trades.forEach(t => {
      const id = t.portfolio_id
      if (!portfolioMap[id]) portfolioMap[id] = { name: t.portfolios?.name || id, value: 0 }
      portfolioMap[id].value += Number(t.total_invested || 0)
    })
    const portfolioData = Object.values(portfolioMap)
      .map(p => ({ ...p, value: parseFloat(p.value.toFixed(2)), pct: parseFloat((p.value / totalInvested * 100).toFixed(1)) }))
      .sort((a, b) => b.value - a.value)

    // Horizonte
    let long = 0, mid = 0, short = 0
    trades.forEach(t => {
      const name = (t.portfolios?.name || '').toLowerCase()
      const inv  = Number(t.total_invested || 0)
      if (name.includes('largo'))      long  += inv
      else if (name.includes('media')) mid   += inv
      else                             short += inv
    })
    const horizonData = [
      { name: 'Largo plazo',         value: parseFloat(long.toFixed(2)),  pct: parseFloat((long  / totalInvested * 100).toFixed(1)), color: C.success },
      { name: 'Mediano plazo',       value: parseFloat(mid.toFixed(2)),   pct: parseFloat((mid   / totalInvested * 100).toFixed(1)), color: C.warning },
      { name: 'Corto/Especulativo',  value: parseFloat(short.toFixed(2)), pct: parseFloat((short / totalInvested * 100).toFixed(1)), color: C.danger  },
    ]

    // PnL mensual
    const monthlyMap: Record<string, number> = {}
    trades.forEach(t => {
      const m   = parseDate(t.open_date).toLocaleDateString('es-MX', { year: 'numeric', month: 'short' })
      monthlyMap[m] = (monthlyMap[m] || 0) + Number(t.realized_pnl || 0)
    })
    const monthlyData = Object.entries(monthlyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, pnl]) => ({ month, pnl: parseFloat(pnl.toFixed(2)) }))

    // Volatilidad semanal
    const weeklyPrices: Record<string, number[]> = {}
    allExecutions.filter(e => tradeIds.has(e.trade_id)).forEach(e => {
      const week = getWeekKey(parseDate((e.executed_at || '').split('T')[0]))
      if (!weeklyPrices[week]) weeklyPrices[week] = []
      weeklyPrices[week].push(Number(e.price || 0))
    })
    trades.forEach(t => {
      const week = getWeekKey(parseDate(t.open_date))
      if (!weeklyPrices[week]) weeklyPrices[week] = []
      weeklyPrices[week].push(Number(t.entry_price || 0))
    })
    const weeklyData = Object.entries(weeklyPrices)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, prices]) => {
        if (prices.length < 2) return { week, volatilidad: 0, rendimiento: 0 }
        const returns    = prices.slice(1).map((p, i) => (p - prices[i]) / prices[i] * 100)
        const avgReturn  = returns.reduce((a, b) => a + b, 0) / returns.length
        const variance   = returns.reduce((a, r) => a + Math.pow(r - avgReturn, 2), 0) / returns.length
        return { week, volatilidad: parseFloat(Math.sqrt(variance).toFixed(2)), rendimiento: parseFloat(avgReturn.toFixed(2)) }
      })
      .filter(w => w.volatilidad > 0 || w.rendimiento !== 0)

    // ── Portafolio vs SP500 ──────────────────────────────────────────────
    // Base: capital total invertido como punto de partida = 100%
    const sortedByDate = [...trades].sort((a, b) => parseDate(a.open_date).getTime() - parseDate(b.open_date).getTime())

    let portfolioBase: number | null = null
    let sp500Base: number | null     = null
    let cumInvested = 0

    const vsData = sortedByDate
      .map(t => {
        cumInvested += Number(t.total_invested || 0)
        const dateStr = t.open_date
        const sp500Val = sp500Data[dateStr] || Object.entries(sp500Data).reverse().find(([d]) => d <= dateStr)?.[1]

        if (portfolioBase === null && cumInvested > 0) portfolioBase = cumInvested
        if (sp500Base === null && sp500Val) sp500Base = sp500Val

        const portfolioPct = portfolioBase ? parseFloat(((cumInvested / portfolioBase - 1) * 100).toFixed(2)) : 0
        const sp500Pct     = (sp500Base && sp500Val) ? parseFloat(((sp500Val / sp500Base - 1) * 100).toFixed(2)) : null

        return {
          date:      parseDate(dateStr).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }),
          dateStr,
          portfolio: portfolioPct,
          sp500:     sp500Pct,
        }
      })
      .filter(d => d.sp500 !== null)

    // Drawdown
    let cumPnL = 0, peak = 0
    const drawdownData = sortedByDate.map(t => {
      cumPnL += Number(t.realized_pnl || 0)
      if (cumPnL > peak) peak = cumPnL
      const dd = peak > 0 ? parseFloat(((peak - cumPnL) / peak * -100).toFixed(2)) : 0
      return {
        date:     parseDate(t.open_date).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }),
        pnl:      parseFloat(cumPnL.toFixed(2)),
        drawdown: dd,
      }
    })

const sorted = [...trades].sort((a, b) => Number(b.realized_pnl || 0) - Number(a.realized_pnl || 0))
    const top5Gains  = sorted.filter(t => Number(t.realized_pnl || 0) > 0).slice(0, 5)
      .map(t => ({ ticker: t.ticker, pnl: parseFloat(Number(t.realized_pnl).toFixed(2)) }))
    const top5Losses = sorted.filter(t => Number(t.realized_pnl || 0) < 0).slice(-5).reverse()
      .map(t => ({ ticker: t.ticker, pnl: parseFloat(Number(t.realized_pnl).toFixed(2)) }))

    return { sectorData, portfolioData, horizonData, monthlyData, weeklyData, drawdownData, vsData, totalInvested, totalActual, top5Gains, top5Losses }
  }, [trades, allExecutions, tradeIds, sp500Data])

  const tooltipStyle = { background: '#0d0d0d', border: '1px solid #333', fontSize: 11, borderRadius: 8 }
  const labelStyle   = { fill: '#aaa', fontSize: 10 }
  const axisStyle    = { stroke: '#333', fontSize: 9, fill: '#888' }

  if (loading) return (
    <AppShell>
      <div style={{ padding: 40, color: '#666', display: 'flex', alignItems: 'center', gap: 10 }}>
        <Paw size={16} color="#666" opacity={0.5} /> Cargando gráficas...
      </div>
    </AppShell>
  )

  return (
    <AppShell>
      <div style={{ padding: '22px 28px', color: 'white', maxWidth: 1400, margin: '0 auto', position: 'relative' }}>

        {/* Decoraciones de gatos */}
        <div style={{ position: 'absolute', top: 0, right: 60, pointerEvents: 'none' }}>
          <CatEars color="#00bfff" opacity={0.1} size={40} />
        </div>
        <div style={{ position: 'absolute', right: 0, top: '40%', pointerEvents: 'none' }}>
          <CatTail color="#a78bfa" opacity={0.08} />
        </div>

        {/* HEADER */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
          <Paw size={18} color="#00bfff" opacity={0.55} />
          <Paw size={13} color="#00bfff" opacity={0.3} />
          <Paw size={9}  color="#00bfff" opacity={0.15} />
          <BarChart2 size={20} color={C.accent} />
          <h1 style={{ fontSize: 18, fontWeight: 900, margin: 0 }}>Gráficas — trades abiertos</h1>
        </div>

        {/* FILTRO */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 22, borderBottom: `1px solid ${C.border}`, paddingBottom: 14, flexWrap: 'wrap' }}>
          {[{ id: 'all', name: 'Todos' }, ...portfolios].map(p => (
            <button key={p.id} onClick={() => setSelectedPortfolio(p.id)} style={filterBtn(selectedPortfolio === p.id)}>
              {p.name}
            </button>
          ))}
        </div>

        {!charts ? (
          <div style={{ textAlign: 'center', padding: 80, color: '#555', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <Paw size={40} color="#333" opacity={0.4} />
            No hay trades abiertos para este portafolio.
          </div>
        ) : (
          <>
            {/* KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 18 }}>
              <KpiCard label="Capital expuesto"    value={money(charts.totalInvested)} color={C.accent} />
              <KpiCard label="Capital actual"      value={money(charts.totalActual)}   color={charts.totalActual >= charts.totalInvested ? C.success : C.danger} />
              <KpiCard label="Posiciones abiertas" value={String(trades.length)}       color="#fff" />
              <KpiCard label="Portafolios activos" value={String(charts.portfolioData.length)} color={C.warning} />
            </div>

            {/* ── FILA 1: Sector pie + Horizonte ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              <ChartCard title="Capital por sector">
                <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                  <div style={{ flex: '0 0 180px' }}>
                    <ResponsiveContainer width={180} height={180}>
                      <PieChart>
                        <Pie data={charts.sectorData} cx="50%" cy="50%" innerRadius={46} outerRadius={76} paddingAngle={3} dataKey="value">
                          {charts.sectorData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="none" />)}
                        </Pie>
                        <Tooltip content={<CustomTooltip formatter={(v: number) => money(v)} />} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {charts.sectorData.map((s, i) => (
                      <div key={s.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#aaa' }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: PIE_COLORS[i % PIE_COLORS.length], display: 'inline-block', flexShrink: 0 }} />
                          {s.name}
                        </span>
                        <span style={{ fontWeight: 700, color: '#fff' }}>{s.pct}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </ChartCard>

              <ChartCard title="Horizonte de inversión">
                <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                  <div style={{ flex: '0 0 180px' }}>
                    <ResponsiveContainer width={180} height={180}>
                      <PieChart>
                        <Pie data={charts.horizonData} cx="50%" cy="50%" innerRadius={50} outerRadius={76} paddingAngle={5} dataKey="value" startAngle={90} endAngle={-270}>
                          {charts.horizonData.map((h, i) => <Cell key={i} fill={h.color} stroke="none" />)}
                        </Pie>
                        <Tooltip content={<CustomTooltip formatter={(v: number) => money(v)} />} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {charts.horizonData.map(h => (
                      <div key={h.name}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                          <span style={{ color: '#aaa', display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: h.color, display: 'inline-block' }} />
                            {h.name}
                          </span>
                          <span style={{ fontWeight: 700, color: h.color }}>{h.pct}%</span>
                        </div>
                        <div style={{ background: '#111', height: 3, borderRadius: 2 }}>
                          <div style={{ width: `${h.pct}%`, background: h.color, height: '100%', borderRadius: 2, opacity: 0.7 }} />
                        </div>
                        <div style={{ fontSize: 9, color: '#666', marginTop: 2, textAlign: 'right' }}>{money(h.value)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </ChartCard>
            </div>

            {/* ── FILA 2: Capital por portafolio + PnL mensual ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              <ChartCard title="Capital por portafolio" sub="Total invertido en trades abiertos">
                <ResponsiveContainer width="100%" height={190}>
                  <BarChart data={charts.portfolioData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid stroke="#151515" vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fill: '#aaa', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#888', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toLocaleString()}`} />
                    <Tooltip content={<CustomTooltip formatter={(v: number, name: string) => [`${money(v)} · ${charts.portfolioData.find(p => p.name === name)?.pct ?? ''}%`, name]} />} />
                    <Bar dataKey="value" name="Invertido" radius={[6,6,0,0]} fill={C.accent} fillOpacity={0.8} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="PnL mensual realizado" sub="Por mes de apertura del trade">
                <ResponsiveContainer width="100%" height={190}>
                  <BarChart data={charts.monthlyData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid stroke="#151515" vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="month" tick={{ fill: '#aaa', fontSize: 9 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#888', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                    <Tooltip content={<CustomTooltip formatter={(v: number) => money(v)} />} />
                    <ReferenceLine y={0} stroke="#333" />
                    <Bar dataKey="pnl" name="PnL" radius={[4,4,0,0]}>
                      {charts.monthlyData.map((e, i) => <Cell key={i} fill={e.pnl >= 0 ? C.success : C.danger} fillOpacity={0.8} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            {/* ── GRÁFICA PORTAFOLIO VS SP500 ── */}
            <ChartCard title="Portafolio vs S&P 500" sub="Rendimiento % comparado desde la primera operación — requiere datos de mercado">
              {charts.vsData.length > 1 ? (
                <>
                  <ResponsiveContainer width="100%" height={240}>
                    <ComposedChart data={charts.vsData} margin={{ top: 4, right: 10, left: 0, bottom: 4 }}>
                      <CartesianGrid stroke="#151515" vertical={false} strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fill: '#aaa', fontSize: 9 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: '#888', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
                      <Tooltip content={<CustomTooltip formatter={(v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`} />} />
                      <ReferenceLine y={0} stroke="#333" strokeDasharray="3 3" />
                      <Line type="monotone" dataKey="portfolio" name="Portafolio" stroke={C.accent}  strokeWidth={2.5} dot={false} />
                      <Line type="monotone" dataKey="sp500"     name="S&P 500"   stroke={C.sp500} strokeWidth={2}   dot={false} strokeDasharray="6 3" />
                      <Legend
                        formatter={(value) => <span style={{ color: '#aaa', fontSize: 10 }}>{value}</span>}
                        wrapperStyle={{ paddingTop: 8 }}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                  <div style={{ display: 'flex', gap: 20, marginTop: 8, fontSize: 9, color: '#666' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 16, height: 2, background: C.accent, display: 'inline-block' }} />
                      Capital acumulado del portafolio
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 16, height: 2, background: C.sp500, display: 'inline-block', borderTop: `2px dashed ${C.sp500}` }} />
                      S&P 500 (base desde primera operación)
                    </span>
                  </div>
                </>
              ) : (
                <EmptyChart message="Cargando datos del S&P 500... o no hay suficientes trades con fechas" height={240} />
              )}
            </ChartCard>

            {/* ── FILA 3: Volatilidad + Rendimiento semanal ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14, marginTop: 14 }}>
              <ChartCard title="Volatilidad semanal" sub="Desviación estándar de precios de ejecución">
                {charts.weeklyData.length > 1 ? (
                  <ResponsiveContainer width="100%" height={190}>
                    <BarChart data={charts.weeklyData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                      <CartesianGrid stroke="#151515" vertical={false} strokeDasharray="3 3" />
                      <XAxis dataKey="week" tick={{ fill: '#aaa', fontSize: 8 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: '#888', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
                      <Tooltip content={<CustomTooltip formatter={(v: number) => `${v}%`} />} />
                      <Bar dataKey="volatilidad" name="Volatilidad" radius={[4,4,0,0]} fill={C.warning} fillOpacity={0.75} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <EmptyChart message="Se necesitan más ejecuciones" height={190} />}
              </ChartCard>

              <ChartCard title="Rendimiento semanal promedio" sub="Variación % promedio de precios por semana">
                {charts.weeklyData.length > 1 ? (
                  <ResponsiveContainer width="100%" height={190}>
                    <BarChart data={charts.weeklyData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                      <CartesianGrid stroke="#151515" vertical={false} strokeDasharray="3 3" />
                      <XAxis dataKey="week" tick={{ fill: '#aaa', fontSize: 8 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: '#888', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
                      <Tooltip content={<CustomTooltip formatter={(v: number) => `${v}%`} />} />
                      <ReferenceLine y={0} stroke="#333" />
                      <Bar dataKey="rendimiento" name="Rendimiento" radius={[4,4,0,0]}>
                        {charts.weeklyData.map((e, i) => <Cell key={i} fill={e.rendimiento >= 0 ? C.success : C.danger} fillOpacity={0.8} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : <EmptyChart message="Se necesitan más ejecuciones" height={190} />}
              </ChartCard>
            </div>

            {/* ── DRAWDOWN VS PNL ── */}
            <ChartCard title="Drawdown vs PnL acumulado" sub="Caída máxima desde el pico (rojo) sobre el PnL acumulado (azul)">
              {charts.drawdownData.length > 1 ? (
                <>
                  <ResponsiveContainer width="100%" height={240}>
                    <ComposedChart data={charts.drawdownData} margin={{ top: 4, right: 10, left: 0, bottom: 4 }}>
                      <defs>
                        <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor={C.danger} stopOpacity={0.3} />
                          <stop offset="95%" stopColor={C.danger} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#151515" vertical={false} strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fill: '#aaa', fontSize: 9 }} axisLine={false} tickLine={false} />
                      <YAxis yAxisId="left"  tick={{ fill: '#888', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fill: '#888', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
                      <Tooltip content={<CustomTooltip formatter={(v: number, name: string) =>
                        name === 'PnL acumulado' ? money(v) : `${v}%`}
                      />} />
                      <ReferenceLine yAxisId="left" y={0} stroke="#333" strokeDasharray="3 3" />
                      <Area yAxisId="right" type="monotone" dataKey="drawdown" name="Drawdown" stroke={C.danger} fill="url(#ddGrad)" strokeWidth={1.5} dot={false} />
                      <Line yAxisId="left"  type="monotone" dataKey="pnl"      name="PnL acumulado" stroke={C.accent} strokeWidth={2.5} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                  <div style={{ display: 'flex', gap: 20, marginTop: 8, fontSize: 9, color: '#666' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 16, height: 2, background: C.accent, display: 'inline-block' }} /> PnL acumulado (eje izq.)
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 16, height: 8, background: C.danger, opacity: 0.4, display: 'inline-block', borderRadius: 2 }} /> Drawdown % (eje der.)
                    </span>
                  </div>
                </>
              ) : <EmptyChart message="Se necesitan más trades para calcular drawdown" height={240} />}
            </ChartCard>

            {/* ── TOP 5 GANANCIAS Y PÉRDIDAS ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
              <ChartCard title="Top 5 mayores ganancias" sub="Trades abiertos con mayor PnL realizado">
                {charts.top5Gains.length > 0 ? (
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={charts.top5Gains} layout="vertical" margin={{ top: 4, right: 16, left: 10, bottom: 4 }}>
                      <CartesianGrid stroke="#151515" horizontal={false} strokeDasharray="3 3" />
                      <XAxis type="number" tick={{ fill: '#888', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                      <YAxis type="category" dataKey="ticker" tick={{ fill: '#aaa', fontSize: 11, fontWeight: 700 }} axisLine={false} tickLine={false} width={48} />
                      <Tooltip content={<CustomTooltip formatter={(v: number) => money(v)} />} />
                      <Bar dataKey="pnl" name="PnL" radius={[0,6,6,0]} fill={C.success} fillOpacity={0.85} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <EmptyChart message="Sin ganancias realizadas aún" height={180} />}
              </ChartCard>

              <ChartCard title="Top 5 mayores pérdidas" sub="Trades abiertos con mayor PnL negativo">
                {charts.top5Losses.length > 0 ? (
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={charts.top5Losses} layout="vertical" margin={{ top: 4, right: 16, left: 10, bottom: 4 }}>
                      <CartesianGrid stroke="#151515" horizontal={false} strokeDasharray="3 3" />
                      <XAxis type="number" tick={{ fill: '#888', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                      <YAxis type="category" dataKey="ticker" tick={{ fill: '#aaa', fontSize: 11, fontWeight: 700 }} axisLine={false} tickLine={false} width={48} />
                      <Tooltip content={<CustomTooltip formatter={(v: number) => money(v)} />} />
                      <Bar dataKey="pnl" name="PnL" radius={[0,6,6,0]} fill={C.danger} fillOpacity={0.85} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <EmptyChart message="Sin pérdidas realizadas" height={180} />}
              </ChartCard>
            </div>
          </>
        )}
      </div>
    </AppShell>
  )
}

function KpiCard({ label, value, color = 'white' }: any) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', bottom: -8, right: -8, pointerEvents: 'none' }}>
        <Paw size={40} color="#fff" opacity={0.02} />
      </div>
      <div style={{ fontSize: 9, color: '#888', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' as const, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color }}>{value}</div>
    </div>
  )
}

function ChartCard({ title, sub, children, mb = 0 }: any) {
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

function EmptyChart({ message, height = 200 }: { message: string, height?: number }) {
  return (
    <div style={{ height, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#444', fontSize: 11, border: '1px dashed #1a1a1a', borderRadius: 8, gap: 8 }}>
      <Paw size={24} color="#333" opacity={0.4} />
      {message}
    </div>
  )
}

const filterBtn = (active: boolean): React.CSSProperties => ({
  padding: '6px 14px', borderRadius: 6, border: 'none',
  background: active ? C.accent : '#111',
  color: active ? '#000' : '#888',
  cursor: 'pointer', fontSize: 10, fontWeight: 'bold', whiteSpace: 'nowrap',
})