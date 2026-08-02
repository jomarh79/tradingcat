'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { usePrivacy } from '@/lib/PrivacyContext'
import AppShell from '../AppShell'
import { BarChart2 } from 'lucide-react'
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  ComposedChart, Line, ReferenceLine, Legend,
} from 'recharts'

// ── Constantes ───────────────────────────────────────────────────────────
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

type RangeKey = 'YTD' | '1Y' | '5Y' | 'MAX'

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

export default function EstadisticasPage() {
  const { money } = usePrivacy()

  const [trades,            setTrades]            = useState<any[]>([])
  const [portfolios,        setPortfolios]        = useState<any[]>([])
  const [selectedPortfolio, setSelectedPortfolio] = useState('all')
  const [loading,           setLoading]           = useState(true)
  const [sp500Data,         setSp500Data]         = useState<Record<string, number>>({})
  const [range,             setRange]             = useState<RangeKey>('MAX')

  const fetchData = useCallback(async () => {
    const [{ data: tData }, { data: pData }] = await Promise.all([
      supabase.from('trades').select('*, portfolios(name)').eq('status', 'open'),
      supabase.from('portfolios').select('*'),
    ])
    if (tData) setTrades(tData)
    if (pData) setPortfolios(pData)
    setLoading(false)
  }, [])

  const loadSP500 = useCallback(() => {
    try {
      const cached = localStorage.getItem('sp500')
      if (cached) {
        const parsed: { date: string, close: number }[] = JSON.parse(cached)
        const map: Record<string, number> = {}
        parsed.forEach(d => { map[d.date] = d.close })
        setSp500Data(map)
      }
    } catch (e) { console.error('SP500 cache error:', e) }
  }, [])

  useEffect(() => { fetchData(); loadSP500() }, [fetchData, loadSP500])

  const filteredTrades = useMemo(() => {
    if (selectedPortfolio === 'all') return trades
    return trades.filter(t => t.portfolio_id === selectedPortfolio)
  }, [trades, selectedPortfolio])

  const stats = useMemo(() => {
    if (!filteredTrades.length) return null

    const totalInvested = filteredTrades.reduce((acc, t) => acc + Number(t.total_invested || 0), 0)
    const totalCurrent = filteredTrades.reduce((acc, t) => {
      const qty = Number(t.quantity || 0)
      const cur = Number(t.last_price || t.entry_price || 0)
      return acc + qty * cur
    }, 0)
    const totalPnL = totalCurrent - totalInvested
    const totalPnLPct = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0

    // Horizonte por billetera — SIEMPRE global, no depende del filtro de portafolio seleccionado
    const globalTotalInvested = trades.reduce((acc, t) => acc + Number(t.total_invested || 0), 0)
    const horizonStats = { long: 0, mid: 0, short: 0 }
    trades.forEach(t => {
      const pName = (t.portfolios?.name || '').toLowerCase()
      const inv   = Number(t.total_invested || 0)
      if (pName.includes('largo'))      horizonStats.long  += inv
      else if (pName.includes('media')) horizonStats.mid   += inv
      else                              horizonStats.short += inv
    })
    const horizonData = [
      { name: 'Largo plazo (>10a)',   value: horizonStats.long,  pct: globalTotalInvested > 0 ? parseFloat((horizonStats.long  / globalTotalInvested * 100).toFixed(1)) : 0, color: C.success },
      { name: 'Mediano plazo (1-5a)', value: horizonStats.mid,   pct: globalTotalInvested > 0 ? parseFloat((horizonStats.mid   / globalTotalInvested * 100).toFixed(1)) : 0, color: C.warning },
      { name: 'Corto / Especulativo', value: horizonStats.short, pct: globalTotalInvested > 0 ? parseFloat((horizonStats.short / globalTotalInvested * 100).toFixed(1)) : 0, color: C.danger  },
    ]

    // Distribución por sector (para dona)
    const sectorMap: Record<string, number> = {}
    filteredTrades.forEach(t => {
      const s = t.sector || 'Otros'
      sectorMap[s] = (sectorMap[s] || 0) + Number(t.total_invested || 0)
    })
    const sectorData = Object.entries(sectorMap)
      .map(([name, value]) => ({ name, value: parseFloat(value.toFixed(2)), pct: totalInvested > 0 ? parseFloat((value / totalInvested * 100).toFixed(1)) : 0 }))
      .sort((a, b) => b.value - a.value)

    // Distribución por país (para dona)
    const countryMap: Record<string, number> = {}
    filteredTrades.forEach(t => {
      const c = t.country || 'Otros'
      countryMap[c] = (countryMap[c] || 0) + Number(t.total_invested || 0)
    })
    const countryData = Object.entries(countryMap)
      .map(([name, value]) => ({ name, value: parseFloat(value.toFixed(2)), pct: totalInvested > 0 ? parseFloat((value / totalInvested * 100).toFixed(1)) : 0 }))
      .sort((a, b) => b.value - a.value)

    // PnL no realizado por trade
    const withPnl = filteredTrades.map(t => {
      const qty      = Number(t.quantity || 0)
      const avgPrice = qty > 0 ? Number(t.total_invested || 0) / qty : Number(t.entry_price || 0)
      const curPrice = Number(t.last_price || t.entry_price || 0)
      const pnl      = parseFloat(((curPrice - avgPrice) * qty).toFixed(2))
      const pnlPct   = avgPrice > 0 ? parseFloat(((curPrice - avgPrice) / avgPrice * 100).toFixed(2)) : 0
      return { ...t, pnl, pnlPct, avgPrice, curPrice }
    })
    const winningTrades = withPnl.filter(t => t.pnl > 0).length
    const losingTrades  = withPnl.filter(t => t.pnl < 0).length

    const topGains  = [...withPnl].filter(t => t.pnl > 0).sort((a, b) => b.pnl - a.pnl).slice(0, 5)
    const topLosses = [...withPnl].filter(t => t.pnl < 0).sort((a, b) => a.pnl - b.pnl).slice(0, 5)

    // PnL no realizado por sector
    const sectorPnlMap: Record<string, { pnl: number, invested: number, count: number }> = {}
    withPnl.forEach(t => {
      const s = t.sector || 'Otros'
      if (!sectorPnlMap[s]) sectorPnlMap[s] = { pnl: 0, invested: 0, count: 0 }
      sectorPnlMap[s].pnl      += t.pnl
      sectorPnlMap[s].invested += Number(t.total_invested || 0)
      sectorPnlMap[s].count    += 1
    })
    const sectorPnlData = Object.entries(sectorPnlMap)
      .map(([sector, d]) => ({
        sector, pnl: parseFloat(d.pnl.toFixed(2)),
        pct: d.invested > 0 ? parseFloat((d.pnl / d.invested * 100).toFixed(2)) : 0,
        count: d.count,
      }))
      .sort((a, b) => b.pnl - a.pnl)

    // Tiempo en posición
    const now = new Date()
    const daysInPosition = withPnl.map(t => {
      const days = Math.floor((now.getTime() - parseDate(t.open_date).getTime()) / 86400000)
      return {
        ticker: t.ticker,
        days,
        pnlPct: t.pnlPct,
        color: t.pnlPct >= 0 ? C.success : C.danger,
      }
    }).sort((a, b) => b.days - a.days)

    const avgDuration = filteredTrades.reduce((acc, t) =>
      acc + Math.ceil((now.getTime() - parseDate(t.open_date).getTime()) / 86400000), 0
    ) / filteredTrades.length

    const rrTrades = filteredTrades.filter(t => t.stop_loss && t.take_profit_1 && t.entry_price)
    const avgRR    = rrTrades.length > 0
      ? rrTrades.reduce((acc, t) => {
          const risk   = Math.abs(Number(t.entry_price) - Number(t.stop_loss))
          const reward = Math.abs(Number(t.take_profit_1) - Number(t.entry_price))
          return acc + (risk > 0 ? reward / risk : 0)
        }, 0) / rrTrades.length
      : 0

    // Curva de equity vs S&P 500, respetando el rango seleccionado
    const sortedByDate = [...filteredTrades].sort((a, b) => parseDate(a.open_date).getTime() - parseDate(b.open_date).getTime())

    let cutoff: Date | null = null
    if (range === 'YTD') cutoff = new Date(now.getFullYear(), 0, 1)
    else if (range === '1Y') cutoff = new Date(now.getTime() - 365 * 86400000)
    else if (range === '5Y') cutoff = new Date(now.getTime() - 5 * 365 * 86400000)

    const rangeTrades = cutoff ? sortedByDate.filter(t => parseDate(t.open_date).getTime() >= cutoff!.getTime()) : sortedByDate

    let portfolioBase: number | null = null
    let sp500Base: number | null     = null
    let cumInvested = 0

    const vsData = rangeTrades
      .map(t => {
        cumInvested += Number(t.total_invested || 0)
        const dateStr = t.open_date
        const sp500Val = sp500Data[dateStr] || Object.entries(sp500Data).reverse().find(([d]) => d <= dateStr)?.[1]

        if (portfolioBase === null && cumInvested > 0) portfolioBase = cumInvested
        if (sp500Base === null && sp500Val) sp500Base = sp500Val

        const portfolioPct = portfolioBase ? parseFloat(((cumInvested / portfolioBase - 1) * 100).toFixed(2)) : 0
        const sp500Pct     = (sp500Base && sp500Val) ? parseFloat(((sp500Val / sp500Base - 1) * 100).toFixed(2)) : null

        return {
          date: parseDate(dateStr).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }),
          dateStr,
          portfolio: portfolioPct,
          sp500: sp500Pct,
        }
      })
      .filter(d => d.sp500 !== null)

    return {
      totalInvested, totalCurrent, totalPnL, totalPnLPct,
      winningTrades, losingTrades, totalCount: filteredTrades.length,
      horizonData, sectorData, countryData, sectorPnlData,
      topGains, topLosses, daysInPosition, topBySize, vsData,
      avgDuration: parseFloat(avgDuration.toFixed(1)),
      avgRR: parseFloat(avgRR.toFixed(2)),
      rrCount: rrTrades.length,
    }
  }, [filteredTrades, trades, sp500Data, range])

  if (loading) return (
    <AppShell>
      <div style={{ padding: 40, color: '#666', display: 'flex', alignItems: 'center', gap: 10 }}>
        <Paw size={16} color="#666" opacity={0.5} /> Cargando estadísticas...
      </div>
    </AppShell>
  )

  return (
    <AppShell>
      <div style={{ maxWidth: 1400, margin: '20px auto', padding: '0 28px', color: 'white', position: 'relative' }}>

        {/* Cat ears decoration */}
        <div style={{ position: 'absolute', top: -4, right: 60, pointerEvents: 'none' }}>
          <CatEars color="#00bfff" opacity={0.12} size={40} />
        </div>

        {/* HEADER */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 22 }}>
          <Paw size={18} color="#00bfff" opacity={0.6} />
          <Paw size={13} color="#00bfff" opacity={0.35} />
          <Paw size={9}  color="#00bfff" opacity={0.18} />
          <BarChart2 size={20} color="#00bfff" />
          <h1 style={{ fontSize: 18, fontWeight: 900, margin: 0 }}>Estadísticas — trades abiertos</h1>
        </div>

        {/* FILTRO PORTAFOLIOS */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 26, flexWrap: 'wrap', alignItems: 'center', borderBottom: '1px solid #1a1a1a', paddingBottom: 14 }}>
          {[{ id: 'all', name: 'Todos' }, ...portfolios].map(p => (
            <button key={p.id} onClick={() => setSelectedPortfolio(p.id)} style={filterBtn(selectedPortfolio === p.id)}>
              {p.name}
            </button>
          ))}
        </div>

        {!stats ? (
          <div style={{ textAlign: 'center', padding: 80, color: '#666', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <Paw size={40} color="#333" opacity={0.4} />
            <span>No hay trades abiertos para este filtro.</span>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 16 }}>

            {/* ══ FILA 1 — KPIs PRINCIPALES (7) ══ */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px,1fr))', gap: 12 }}>
              <StatCard label="Capital expuesto" value={money(stats.totalInvested)} color="#00bfff" />
              <StatCard label="Capital actual"   value={money(stats.totalCurrent)}
                color={stats.totalPnL > 0 ? '#22c55e' : stats.totalPnL < 0 ? '#f43f5e' : '#00bfff'} />
              <StatCard label="PnL total"        value={`${stats.totalPnLPct >= 0 ? '+' : ''}${stats.totalPnLPct.toFixed(1)}%`}
                color={stats.totalPnL > 0 ? '#22c55e' : stats.totalPnL < 0 ? '#f43f5e' : '#fff'} />
              <StatCard label="Trades ganando"   value={String(stats.winningTrades)} color="#22c55e"
                desc={`de ${stats.totalCount} posiciones`} />
              <StatCard label="Trades perdiendo" value={String(stats.losingTrades)}  color="#f43f5e"
                desc={`de ${stats.totalCount} posiciones`} />
              <StatCard label="Duración promedio" value={`${stats.avgDuration} días`} color="#eab308" />
              <StatCard label="R/R promedio"     value={stats.avgRR > 0 ? `${stats.avgRR}R` : '—'} color="#22c55e"
                desc={`${stats.rrCount} con SL y TP`} />
            </div>

            {/* ══ FILA 2 — CURVA EQUITY + SP500 ══ */}
            <ChartCard
              title="Curva de equity vs S&P 500"
              sub="Rendimiento % comparado desde la primera operación del rango — requiere datos de mercado"
              headerRight={
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['YTD','1Y','5Y','MAX'] as RangeKey[]).map(r => (
                    <button key={r} onClick={() => setRange(r)} style={rangeBtn(range === r)}>{r}</button>
                  ))}
                </div>
              }
            >
              {stats.vsData.length > 1 ? (
                <>
                  <ResponsiveContainer width="100%" height={260}>
                    <ComposedChart data={stats.vsData} margin={{ top: 4, right: 10, left: 0, bottom: 4 }}>
                      <CartesianGrid stroke="#151515" vertical={false} strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fill: '#aaa', fontSize: 9 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: '#888', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
                      <Tooltip content={<CustomTooltip formatter={(v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`} />} />
                      <ReferenceLine y={0} stroke="#333" strokeDasharray="3 3" />
                      <Line type="monotone" dataKey="portfolio" name="Portafolio" stroke={C.accent} strokeWidth={2.5} dot={false} />
                      <Line type="monotone" dataKey="sp500"     name="S&P 500"   stroke={C.sp500} strokeWidth={2}   dot={false} strokeDasharray="6 3" />
                      <Legend formatter={(value) => <span style={{ color: '#aaa', fontSize: 10 }}>{value}</span>} wrapperStyle={{ paddingTop: 8 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </>
              ) : (
                <EmptyChart message="Cargando datos del S&P 500... o no hay suficientes trades con fechas en este rango" height={260} />
              )}
            </ChartCard>

            {/* ══ FILA 3 — TOP GANANCIAS / TOP PÉRDIDAS / PNL POR SECTOR ══ */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              <div style={{ ...box, position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', bottom: -8, right: -8, pointerEvents: 'none' }}>
                  <Paw size={60} color="#22c55e" opacity={0.03} />
                </div>
                <div style={boxTitle}>
                  <Paw size={10} color="#22c55e" opacity={0.6} style={{ marginRight: 6 }} />
                  Top 5 mayores ganancias
                </div>
                {stats.topGains.length === 0 ? (
                  <EmptyText text="Sin ganancias latentes" />
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>{['Ticker','PnL','%'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                    <tbody>
                      {stats.topGains.map(t => (
                        <tr key={t.ticker} style={{ borderBottom: '1px solid #111' }}>
                          <td style={td}><span style={{ color: '#22c55e', fontWeight: 700 }}>{t.ticker}</span></td>
                          <td style={{ ...td, textAlign: 'right', color: '#22c55e', fontWeight: 700 }}>+{money(t.pnl)}</td>
                          <td style={{ ...td, textAlign: 'right', color: '#888' }}>+{t.pnlPct}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div style={{ ...box, position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', bottom: -8, right: -8, pointerEvents: 'none' }}>
                  <Paw size={60} color="#f43f5e" opacity={0.03} />
                </div>
                <div style={boxTitle}>
                  <Paw size={10} color="#f43f5e" opacity={0.6} style={{ marginRight: 6 }} />
                  Top 5 mayores pérdidas
                </div>
                {stats.topLosses.length === 0 ? (
                  <EmptyText text="Sin pérdidas latentes" />
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>{['Ticker','PnL','%'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                    <tbody>
                      {stats.topLosses.map(t => (
                        <tr key={t.ticker} style={{ borderBottom: '1px solid #111' }}>
                          <td style={td}><span style={{ color: '#f43f5e', fontWeight: 700 }}>{t.ticker}</span></td>
                          <td style={{ ...td, textAlign: 'right', color: '#f43f5e', fontWeight: 700 }}>{money(t.pnl)}</td>
                          <td style={{ ...td, textAlign: 'right', color: '#888' }}>{t.pnlPct}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div style={box}>
                <div style={boxTitle}>
                  <Paw size={10} color="#00bfff" opacity={0.6} style={{ marginRight: 6 }} />
                  PnL no realizado por sector
                </div>
                {stats.sectorPnlData.length === 0 ? (
                  <EmptyText text="Sin posiciones abiertas" />
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 4 }}>
                    {stats.sectorPnlData.map(s => {
                      const maxAbs = Math.max(...stats.sectorPnlData.map(d => Math.abs(d.pnl)))
                      const width  = maxAbs > 0 ? Math.abs(s.pnl) / maxAbs * 100 : 0
                      const color  = s.pnl >= 0 ? '#22c55e' : '#f43f5e'
                      return (
                        <div key={s.sector}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, fontSize: 10 }}>
                            <span style={{ color: '#aaa' }}>{s.sector} <span style={{ color: '#444' }}>({s.count})</span></span>
                            <span style={{ fontWeight: 700, color }}>{s.pnl >= 0 ? '+' : ''}{money(s.pnl)}</span>
                          </div>
                          <div style={{ height: 5, background: '#111', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${width}%`, height: '100%', background: color, borderRadius: 3 }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* ══ FILA 4 — TIEMPO EN POSICIÓN / HORIZONTE / SECTOR / PAÍS (DONAS) ══ */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              <ChartCard title="Tiempo en posición" sub="Días desde apertura">
                {stats.daysInPosition.length > 0 ? (
                  <ResponsiveContainer width="100%" height={Math.max(180, Math.min(stats.daysInPosition.length * 26, 320))}>
                    <BarChart data={stats.daysInPosition} layout="vertical" margin={{ top: 4, right: 30, left: 6, bottom: 4 }}>
                      <CartesianGrid stroke="#151515" horizontal={false} strokeDasharray="3 3" />
                      <XAxis type="number" tick={{ fill: '#888', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `${v}d`} />
                      <YAxis type="category" dataKey="ticker" tick={{ fill: '#aaa', fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} width={46} />
                      <Tooltip content={<CustomTooltip formatter={(v: number, name: string) => name === 'Días' ? `${v} días` : `${v}%`} />} />
                      <Bar dataKey="days" name="Días" radius={[0, 6, 6, 0]}>
                        {stats.daysInPosition.map((e, i) => <Cell key={i} fill={e.color} fillOpacity={0.8} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : <EmptyChart message="Sin trades abiertos" height={180} />}
              </ChartCard>

              <ChartCard title="Horizonte por billetera">
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                  <ResponsiveContainer width={160} height={160}>
                    <PieChart>
                      <Pie data={stats.horizonData} cx="50%" cy="50%" innerRadius={44} outerRadius={70} paddingAngle={5} dataKey="value" startAngle={90} endAngle={-270}>
                        {stats.horizonData.map((h, i) => <Cell key={i} fill={h.color} stroke="none" />)}
                      </Pie>
                      <Tooltip content={<CustomTooltip formatter={(v: number) => money(v)} />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {stats.horizonData.map(h => (
                      <div key={h.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                        <span style={{ color: '#aaa', display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: h.color, display: 'inline-block' }} />
                          {h.name}
                        </span>
                        <span style={{ fontWeight: 700, color: h.color }}>{h.pct}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </ChartCard>

              <ChartCard title="Distribución por sector">
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                  <ResponsiveContainer width={160} height={160}>
                    <PieChart>
                      <Pie data={stats.sectorData} cx="50%" cy="50%" innerRadius={44} outerRadius={70} paddingAngle={3} dataKey="value">
                        {stats.sectorData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="none" />)}
                      </Pie>
                      <Tooltip content={<CustomTooltip formatter={(v: number) => money(v)} />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 110, overflowY: 'auto' }}>
                    {stats.sectorData.map((s, i) => (
                      <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                        <span style={{ color: '#aaa', display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: PIE_COLORS[i % PIE_COLORS.length], display: 'inline-block' }} />
                          {s.name}
                        </span>
                        <span style={{ fontWeight: 700, color: '#fff' }}>{s.pct}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </ChartCard>

              <ChartCard title="Distribución por país">
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                  <ResponsiveContainer width={160} height={160}>
                    <PieChart>
                      <Pie data={stats.countryData} cx="50%" cy="50%" innerRadius={44} outerRadius={70} paddingAngle={3} dataKey="value">
                        {stats.countryData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="none" />)}
                      </Pie>
                      <Tooltip content={<CustomTooltip formatter={(v: number) => money(v)} />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 110, overflowY: 'auto' }}>
                    {stats.countryData.map((s, i) => (
                      <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                        <span style={{ color: '#aaa', display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: PIE_COLORS[i % PIE_COLORS.length], display: 'inline-block' }} />
                          {s.name}
                        </span>
                        <span style={{ fontWeight: 700, color: '#fff' }}>{s.pct}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </ChartCard>
            </div>

          </div>
        )}
      </div>
    </AppShell>
  )
}

// ── Subcomponentes ──────────────────────────────────────────────────────
function StatCard({ label, value, desc, color = 'white' }: any) {
  return (
    <div style={{ background: '#080808', border: '1px solid #1a1a1a', padding: '16px 18px', borderRadius: 10, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', bottom: -8, right: -8, pointerEvents: 'none' }}>
        <Paw size={44} color="#fff" opacity={0.02} />
      </div>
      <div style={{ fontSize: 9, color: '#888', marginBottom: 8, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 900, color }}>{value}</div>
      {desc && <div style={{ fontSize: 9, color: '#666', marginTop: 5 }}>{desc}</div>}
    </div>
  )
}

function ChartCard({ title, sub, children, headerRight }: any) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '18px 20px' }}>
      <div style={{ marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 800, color: '#888', letterSpacing: 0.8, textTransform: 'uppercase' as const, display: 'flex', alignItems: 'center', gap: 7 }}>
            <Paw size={10} color="#666" opacity={0.5} />
            {title}
          </div>
          {sub && <div style={{ fontSize: 9, color: '#555', marginTop: 3 }}>{sub}</div>}
        </div>
        {headerRight}
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

function EmptyText({ text }: { text: string }) {
  return (
    <div style={{ color: '#555', fontSize: 11, padding: '12px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
      <Paw size={12} color="#333" opacity={0.5} />
      {text}
    </div>
  )
}

// ── Estilos ──────────────────────────────────────────────────────────────
const filterBtn = (active: boolean): React.CSSProperties => ({
  padding: '6px 14px', borderRadius: 6, border: 'none',
  background: active ? '#00bfff' : '#111',
  color: active ? '#000' : '#888',
  cursor: 'pointer', fontSize: 10, fontWeight: 'bold',
})
const rangeBtn = (active: boolean): React.CSSProperties => ({
  padding: '5px 12px', borderRadius: 6, border: 'none',
  background: active ? C.accent : '#111',
  color: active ? '#000' : '#888',
  cursor: 'pointer', fontSize: 9, fontWeight: 'bold',
})
const box: React.CSSProperties      = { background: '#080808', border: '1px solid #1a1a1a', padding: '18px 20px', borderRadius: 12 }
const boxTitle: React.CSSProperties = { fontSize: 9, color: '#888', marginBottom: 14, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', display: 'flex', alignItems: 'center' }
const th: React.CSSProperties       = { padding: '6px 10px', textAlign: 'left', fontSize: 9, color: '#888', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', borderBottom: '1px solid #1a1a1a' }
const td: React.CSSProperties       = { padding: '8px 10px', fontSize: 12, color: '#ccc' }