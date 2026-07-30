'use client'

import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { usePrivacy } from '@/lib/PrivacyContext'
import AppShell from '../AppShell'
import { BarChart2 } from 'lucide-react'
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  ComposedChart, Line, ReferenceLine, Legend,
} from 'recharts'

// ── Colores y Constantes ────────────────────────────────────────────────────
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

const PIE_COLORS = ['#00bfff', '#6366f1', '#22c55e', '#eab308', '#f43f5e', '#a855f7', '#ec4899', '#14b8a6', '#f97316', '#84cc16']

const parseDate = (d: string) => new Date((d || '').split('T')[0] + 'T00:00:00')

// ── Decoradores de Gatitos ──────────────────────────────────────────────────
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

// ── UI Helpers y Estilos ───────────────────────────────────────────────────
const filterBtn = (active: boolean): React.CSSProperties => ({
  padding: '6px 14px',
  borderRadius: 6,
  border: 'none',
  background: active ? C.accent : '#111',
  color: active ? '#000' : '#888',
  cursor: 'pointer',
  fontSize: 10,
  fontWeight: 'bold',
  whiteSpace: 'nowrap',
})

function KpiCard({ label, value, color = 'white' }: any) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', bottom: -8, right: -8, pointerEvents: 'none' }}>
        <Paw size={40} color="#fff" opacity={0.02} />
      </div>
      <div style={{ fontSize: 9, color: '#888', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color }}>{value}</div>
    </div>
  )
}

function ChartCard({ title, sub, children, mb = 0 }: any) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '18px 20px', marginBottom: mb }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: '#888', letterSpacing: 0.8, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 7 }}>
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

// ── COMPONENTE PRINCIPAL CONSOLIDADO ────────────────────────────────────────
export default function EstadisticasDashboardPage() {
  const { money } = usePrivacy()

  const [allTrades, setAllTrades] = useState<any[]>([])
  const [portfolios, setPortfolios] = useState<any[]>([])
  const [selectedPortfolio, setSelectedPortfolio] = useState('all')
  const [timeRange, setTimeRange] = useState<'YTD' | '1Y' | '5Y' | 'MAX'>('MAX')
  const [loading, setLoading] = useState(true)
  const [sp500Data, setSp500Data] = useState<Record<string, number>>({})

  // Cargar Trades y Portafolios desde Supabase
  const fetchData = useCallback(async () => {
    const [{ data: tData }, { data: pData }] = await Promise.all([
      supabase.from('trades').select('*, portfolios(name,id)'),
      supabase.from('portfolios').select('*'),
    ])
    if (tData) setAllTrades(tData)
    if (pData) setPortfolios(pData)
    setLoading(false)
  }, [])

  // Cargar Caché del S&P 500
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

  // Filtrar Trades por Portafolio Seleccionado
  const trades = useMemo(() =>
    selectedPortfolio === 'all'
      ? allTrades
      : allTrades.filter(t => t.portfolio_id === selectedPortfolio)
  , [allTrades, selectedPortfolio])

  // Cálculo Integrado de Métricas y Gráficos
  const charts = useMemo(() => {
    if (!trades.length) return null

    const openTrades = trades.filter(t => t.status === 'open')
    const closedTrades = trades.filter(t => t.status === 'closed')

    // KPIs
    const capitalExpuesto = openTrades.reduce((acc, t) => acc + Number(t.total_invested || 0), 0)
    const capitalActual = openTrades.reduce((acc, t) => {
      const qty = Number(t.quantity || 0)
      const cur = Number(t.last_price || t.entry_price || 0)
      return acc + (qty * cur)
    }, 0)
    
    const pnlRealizadoTotal = trades.reduce((acc, t) => acc + Number(t.realized_pnl || 0), 0)
    const ganadores = closedTrades.filter(t => Number(t.realized_pnl || 0) > 0)
    const perdedores = closedTrades.filter(t => Number(t.realized_pnl || 0) <= 0)
    const winRate = closedTrades.length > 0 ? (ganadores.length / closedTrades.length) * 100 : 0
    
    const profitTotal = ganadores.reduce((acc, t) => acc + Number(t.realized_pnl || 0), 0)
    const lossTotal = Math.abs(perdedores.reduce((acc, t) => acc + Number(t.realized_pnl || 0), 0))
    const profitFactor = lossTotal > 0 ? profitTotal / lossTotal : profitTotal > 0 ? 999 : 0

    // Posiciones Abiertas + PnL Latente
    const tradesWithUnrealizedPnl = openTrades.map(t => {
      const qty = Number(t.quantity || 0)
      const inv = Number(t.total_invested || 0)
      const cur = Number(t.last_price || t.entry_price || 0)
      const avg = qty > 0 ? inv / qty : Number(t.entry_price || 0)
      const unrealizedPnl = parseFloat(((cur - avg) * qty).toFixed(2))
      const unrealizedPct = avg > 0 ? parseFloat(((cur - avg) / avg * 100).toFixed(2)) : 0
      return { ...t, avg, cur, unrealizedPnl, pnl: unrealizedPnl, unrealizedPct }
    })

    // Top Ganancias y Pérdidas Latentes
    const top5Gains = [...tradesWithUnrealizedPnl]
      .filter(t => t.unrealizedPnl > 0)
      .sort((a, b) => b.unrealizedPnl - a.unrealizedPnl)
      .slice(0, 5)

    const top5Losses = [...tradesWithUnrealizedPnl]
      .filter(t => t.unrealizedPnl < 0)
      .sort((a, b) => a.unrealizedPnl - b.unrealizedPnl)
      .slice(0, 5)

    // Agrupación por Sector
    const sectorMap: Record<string, number> = {}
    openTrades.forEach(t => {
      const s = t.sector || 'Otros'
      sectorMap[s] = (sectorMap[s] || 0) + Number(t.total_invested || 0)
    })
    const sectorData = Object.entries(sectorMap)
      .map(([name, value]) => ({
        name,
        value: parseFloat(value.toFixed(2)),
        pct: capitalExpuesto > 0 ? parseFloat((value / capitalExpuesto * 100).toFixed(1)) : 0
      }))
      .sort((a, b) => b.value - a.value)

    // Tiempo en Posición
    const today = new Date()
    const daysInPosition = openTrades.map(t => {
      const days = Math.floor((today.getTime() - parseDate(t.open_date).getTime()) / 86400000)
      const pnlPct = (() => {
        const qty = Number(t.quantity || 0)
        const inv = Number(t.total_invested || 0)
        const cur = Number(t.last_price || t.entry_price || 0)
        const avg = qty > 0 ? inv / qty : Number(t.entry_price || 0)
        return avg > 0 ? ((cur - avg) / avg * 100) : 0
      })()
      return {
        ticker: t.ticker,
        days,
        pnlPct: parseFloat(pnlPct.toFixed(2)),
      }
    }).sort((a, b) => b.days - a.days)

    // Curva de Equity vs S&P 500
    const sortedByDate = [...trades].sort((a, b) => parseDate(a.open_date).getTime() - parseDate(b.open_date).getTime())
    let portfolioBase: number | null = null
    let sp500Base: number | null     = null
    let cumInvested = 0

    let vsData = sortedByDate
      .map(t => {
        cumInvested += Number(t.total_invested || 0)
        const dateStr = t.open_date
        const sp500Val = sp500Data[dateStr] || Object.entries(sp500Data).reverse().find(([d]) => d <= dateStr)?.[1]

        if (portfolioBase === null && cumInvested > 0) portfolioBase = cumInvested
        if (sp500Base === null && sp500Val) sp500Base = sp500Val

        const portfolioPct = portfolioBase ? parseFloat(((cumInvested / portfolioBase - 1) * 100).toFixed(2)) : 0
        const sp500Pct     = (sp500Base && sp500Val) ? parseFloat(((sp500Val / sp500Base - 1) * 100).toFixed(2)) : null

        return {
          date: parseDate(dateStr).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: '2-digit' }),
          rawDate: parseDate(dateStr),
          portfolio: portfolioPct,
          sp500: sp500Pct,
        }
      })
      .filter(d => d.sp500 !== null)

    if (timeRange !== 'MAX' && vsData.length > 0) {
      const now = new Date()
      const cutoff = new Date()
      if (timeRange === 'YTD') cutoff.setMonth(0, 1)
      else if (timeRange === '1Y') cutoff.setFullYear(now.getFullYear() - 1)
      else if (timeRange === '5Y') cutoff.setFullYear(now.getFullYear() - 5)
      vsData = vsData.filter(d => d.rawDate >= cutoff)
    }

    return {
      capitalExpuesto,
      capitalActual,
      pnlRealizadoTotal,
      winRate,
      profitFactor,
      openCount: openTrades.length,
      closedCount: closedTrades.length,
      tradesWithUnrealizedPnl,
      top5Gains,
      top5Losses,
      sectorData,
      daysInPosition,
      vsData
    }
  }, [trades, sp500Data, timeRange])

  if (loading) return (
    <AppShell>
      <div style={{ padding: 40, color: '#666', display: 'flex', alignItems: 'center', gap: 10 }}>
        <Paw size={16} color="#666" opacity={0.5} /> Cargando estadísticas y métricas visuales...
      </div>
    </AppShell>
  )

  return (
    <AppShell>
      <div style={{ padding: '22px 28px', color: 'white', maxWidth: 1400, margin: '0 auto', position: 'relative' }}>

        {/* Fondo Decorativo Gatuno */}
        <div style={{ position: 'absolute', top: 0, right: 60, pointerEvents: 'none' }}>
          <CatEars color="#00bfff" opacity={0.1} size={40} />
        </div>
        <div style={{ position: 'absolute', right: 0, top: '40%', pointerEvents: 'none' }}>
          <CatTail color="#a78bfa" opacity={0.08} />
        </div>

        {/* Header Principal */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
          <Paw size={18} color="#00bfff" opacity={0.55} />
          <Paw size={13} color="#00bfff" opacity={0.3} />
          <Paw size={9}  color="#00bfff" opacity={0.15} />
          <BarChart2 size={20} color={C.accent} />
          <h1 style={{ fontSize: 18, fontWeight: 900, margin: 0 }}>Análisis Consolidado de Estadísticas</h1>
        </div>

        {/* Filtro de Portafolios */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 22, borderBottom: `1px solid ${C.border}`, paddingBottom: 14, flexWrap: 'wrap' }}>
          {[{ id: 'all', name: 'Todos los Portafolios' }, ...portfolios].map(p => (
            <button key={p.id} onClick={() => setSelectedPortfolio(p.id)} style={filterBtn(selectedPortfolio === p.id)}>
              {p.name}
            </button>
          ))}
        </div>

        {!charts ? (
          <div style={{ textAlign: 'center', padding: 80, color: '#555', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <Paw size={40} color="#333" opacity={0.4} />
            No se registraron transacciones para este portafolio.
          </div>
        ) : (
          <>
            {/* ── FILA 1: KPIs Principales ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 10, marginBottom: 18 }}>
              <KpiCard label="Cap. Expuesto" value={money(charts.capitalExpuesto)} color={C.accent} />
              <KpiCard label="Cap. Actual" value={money(charts.capitalActual)} color={charts.capitalActual >= charts.capitalExpuesto ? C.success : C.danger} />
              <KpiCard label="PnL Realizado" value={money(charts.pnlRealizadoTotal)} color={charts.pnlRealizadoTotal >= 0 ? C.success : C.danger} />
              <KpiCard label="Win Rate" value={`${charts.winRate.toFixed(1)}%`} color={charts.winRate >= 50 ? C.success : C.warning} />
              <KpiCard label="Profit Factor" value={charts.profitFactor.toFixed(2)} color={charts.profitFactor >= 1.5 ? C.success : C.warning} />
              <KpiCard label="Abiertas" value={String(charts.openCount)} color="#fff" />
              <KpiCard label="Cerradas" value={String(charts.closedCount)} color={C.muted} />
            </div>

            {/* ── FILA 2: Tabla Compacta de Posiciones Activas ── */}
            <div style={{ marginBottom: 18 }}>
              <ChartCard title="Posiciones Activas">
                <div style={{ overflowX: 'auto', maxHeight: 220 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, textAlign: 'left' }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${C.border}`, color: '#888' }}>
                        <th style={{ padding: '6px 8px' }}>Ticker</th>
                        <th style={{ padding: '6px 8px' }}>Sector</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right' }}>Cant.</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right' }}>P. Promedio</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right' }}>P. Actual</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right' }}>PnL ($)</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right' }}>PnL (%)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {charts.tradesWithUnrealizedPnl.map(t => (
                        <tr key={t.id} style={{ borderBottom: '1px solid #111' }}>
                          <td style={{ padding: '6px 8px', fontWeight: 700, color: C.accent }}>{t.ticker}</td>
                          <td style={{ padding: '6px 8px', color: '#aaa' }}>{t.sector || 'Otros'}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>{t.quantity}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>{money(t.avg)}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>{money(t.cur)}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: t.unrealizedPnl >= 0 ? C.success : C.danger }}>
                            {money(t.unrealizedPnl)}
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: t.unrealizedPct >= 0 ? C.success : C.danger }}>
                            {t.unrealizedPct > 0 ? '+' : ''}{t.unrealizedPct}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </ChartCard>
            </div>

            {/* ── FILA 3: Equity Curve vs S&P 500 ── */}
            <div style={{ marginBottom: 18 }}>
              <ChartCard title="Rendimiento del Portafolio vs S&P 500" sub="Rendimiento relativo histórico acumulado">
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginBottom: 10 }}>
                  {(['YTD', '1Y', '5Y', 'MAX'] as const).map(range => (
                    <button
                      key={range}
                      onClick={() => setTimeRange(range)}
                      style={{
                        background: timeRange === range ? C.accent : '#151515',
                        color: timeRange === range ? '#000' : '#888',
                        border: 'none',
                        borderRadius: 4,
                        padding: '3px 8px',
                        fontSize: 10,
                        fontWeight: 700,
                        cursor: 'pointer'
                      }}
                    >
                      {range}
                    </button>
                  ))}
                </div>
                {charts.vsData.length > 1 ? (
                  <ResponsiveContainer width="100%" height={260}>
                    <ComposedChart data={charts.vsData} margin={{ top: 4, right: 10, left: 0, bottom: 4 }}>
                      <CartesianGrid stroke="#151515" vertical={false} strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fill: '#aaa', fontSize: 9 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: '#888', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
                      <Tooltip content={<CustomTooltip formatter={(v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`} />} />
                      <ReferenceLine y={0} stroke="#333" strokeDasharray="3 3" />
                      <Line type="monotone" dataKey="portfolio" name="Portafolio" stroke={C.accent} strokeWidth={2.5} dot={false} />
                      <Line type="monotone" dataKey="sp500" name="S&P 500" stroke={C.sp500} strokeWidth={2} dot={false} strokeDasharray="6 3" />
                      <Legend formatter={(val) => <span style={{ color: '#aaa', fontSize: 10 }}>{val}</span>} />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyChart message="Esperando suficientes datos comparativos para proyectar la curva..." height={240} />
                )}
              </ChartCard>
            </div>

            {/* ── FILA 4: PnL por Sector y PnL No Realizado ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 18 }}>
              {/* PnL Actual por Sector */}
              <ChartCard title="PnL actual por sector" sub="Ganancia o pérdida latente agrupada por sector">
                {charts.tradesWithUnrealizedPnl.length > 0 ? (() => {
                  const sectorMap: Record<string, { pnl: number, invested: number, count: number }> = {}
                  charts.tradesWithUnrealizedPnl.forEach((t: any) => {
                    const s = t.sector || 'Sin sector'
                    if (!sectorMap[s]) sectorMap[s] = { pnl: 0, invested: 0, count: 0 }
                    sectorMap[s].pnl      += t.unrealizedPnl
                    sectorMap[s].invested += Number(t.total_invested || 0)
                    sectorMap[s].count    += 1
                  })
                  const data = Object.entries(sectorMap)
                    .map(([sector, d]) => ({
                      sector,
                      pnl:    parseFloat(d.pnl.toFixed(2)),
                      pct:    d.invested > 0 ? parseFloat((d.pnl / d.invested * 100).toFixed(2)) : 0,
                      count:  d.count,
                    }))
                    .sort((a, b) => b.pnl - a.pnl)
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {data.map((s) => {
                        const maxAbs = Math.max(...data.map(d => Math.abs(d.pnl)))
                        const width  = maxAbs > 0 ? (Math.abs(s.pnl) / maxAbs) * 100 : 0
                        const color  = s.pnl >= 0 ? C.success : C.danger
                        return (
                          <div key={s.sector}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                              <span style={{ fontSize: 11, color: '#aaa' }}>
                                {s.sector}
                                <span style={{ fontSize: 9, color: '#444', marginLeft: 6 }}>{s.count} trade{s.count > 1 ? 's' : ''}</span>
                              </span>
                              <span style={{ fontSize: 11, fontWeight: 700, color }}>
                                {s.pnl >= 0 ? '+' : ''}{money(s.pnl)}
                                <span style={{ fontSize: 9, marginLeft: 6, opacity: 0.7 }}>
                                  ({s.pct >= 0 ? '+' : ''}{s.pct}%)
                                </span>
                              </span>
                            </div>
                            <div style={{ height: 6, background: '#111', borderRadius: 3, overflow: 'hidden' }}>
                              <div style={{ width: `${width}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.6s ease' }} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })() : <EmptyChart message="Sin posiciones abiertas" height={180} />}
              </ChartCard>

              {/* PnL No Realizado por Ticker */}
              <ChartCard title="PnL no realizado por posición" sub="Ganancia o pérdida latente de cada trade abierto">
                {charts.top5Gains.length > 0 || charts.top5Losses.length > 0 ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart
                      data={[...charts.top5Losses, ...charts.top5Gains].sort((a, b) => a.pnl - b.pnl)}
                      margin={{ top: 4, right: 16, left: 10, bottom: 4 }}
                      layout="vertical"
                    >
                      <CartesianGrid stroke="#151515" horizontal={false} strokeDasharray="3 3" />
                      <XAxis type="number" tick={{ fill: '#888', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                      <YAxis type="category" dataKey="ticker" tick={{ fill: '#aaa', fontSize: 11, fontWeight: 700 }} axisLine={false} tickLine={false} width={48} />
                      <Tooltip content={<CustomTooltip formatter={(v: number, name: string) => name === 'PnL $' ? money(v) : `${v}%`} />} />
                      <ReferenceLine x={0} stroke="#333" />
                      <Bar dataKey="pnl" name="PnL $" radius={[0, 6, 6, 0]}>
                        {[...charts.top5Losses, ...charts.top5Gains].sort((a, b) => a.pnl - b.pnl).map((e, i) => (
                          <Cell key={i} fill={e.pnl >= 0 ? C.success : C.danger} fillOpacity={0.85} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : <EmptyChart message="Sin datos de PnL no realizado" height={240} />}
              </ChartCard>
            </div>

            {/* Top 5 Ganancias y Pérdidas */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 18 }}>
              <ChartCard title="Top 5 mayores ganancias" sub="PnL no realizado — posiciones con mayor ganancia latente">
                {charts.top5Gains.length > 0 ? (
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={charts.top5Gains} layout="vertical" margin={{ top: 4, right: 16, left: 10, bottom: 4 }}>
                      <CartesianGrid stroke="#151515" horizontal={false} strokeDasharray="3 3" />
                      <XAxis type="number" tick={{ fill: '#888', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                      <YAxis type="category" dataKey="ticker" tick={{ fill: '#aaa', fontSize: 11, fontWeight: 700 }} axisLine={false} tickLine={false} width={48} />
                      <Tooltip content={<CustomTooltip formatter={(v: number) => money(v)} />} />
                      <Bar dataKey="pnl" name="PnL" radius={[0, 6, 6, 0]} fill={C.success} fillOpacity={0.85} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <EmptyChart message="Sin ganancias latentes registradas" height={180} />}
              </ChartCard>

              <ChartCard title="Top 5 mayores pérdidas" sub="PnL no realizado — posiciones con mayor pérdida latente">
                {charts.top5Losses.length > 0 ? (
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={charts.top5Losses} layout="vertical" margin={{ top: 4, right: 16, left: 10, bottom: 4 }}>
                      <CartesianGrid stroke="#151515" horizontal={false} strokeDasharray="3 3" />
                      <XAxis type="number" tick={{ fill: '#888', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                      <YAxis type="category" dataKey="ticker" tick={{ fill: '#aaa', fontSize: 11, fontWeight: 700 }} axisLine={false} tickLine={false} width={48} />
                      <Tooltip content={<CustomTooltip formatter={(v: number) => money(v)} />} />
                      <Bar dataKey="pnl" name="PnL" radius={[0, 6, 6, 0]} fill={C.danger} fillOpacity={0.85} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <EmptyChart message="Sin pérdidas latentes registradas" height={180} />}
              </ChartCard>
            </div>

            {/* ── FILA 5: Tiempo en Posición y Distribución Sectorial ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {/* Tiempo en Posición */}
              <ChartCard title="Tiempo en posición por trade" sub="Días desde apertura — rojo = pérdida latente, verde = ganancia latente">
                {charts.daysInPosition.length > 0 ? (
                  <ResponsiveContainer width="100%" height={Math.max(180, charts.daysInPosition.length * 28)}>
                    <BarChart data={charts.daysInPosition} layout="vertical" margin={{ top: 4, right: 60, left: 10, bottom: 4 }}>
                      <CartesianGrid stroke="#151515" horizontal={false} strokeDasharray="3 3" />
                      <XAxis type="number" tick={{ fill: '#888', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `${v}d`} />
                      <YAxis type="category" dataKey="ticker" tick={{ fill: '#aaa', fontSize: 11, fontWeight: 700 }} axisLine={false} tickLine={false} width={52} />
                      <Tooltip content={<CustomTooltip formatter={(v: number, name: string) => name === 'Días' ? `${v} días` : `${v}%`} />} />
                      <Bar dataKey="days" name="Días" radius={[0, 6, 6, 0]}>
                        {charts.daysInPosition.map((e, i) => (
                          <Cell key={i} fill={e.pnlPct >= 0 ? C.success : C.danger} fillOpacity={0.75} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : <EmptyChart message="Sin trades abiertos" height={180} />}
              </ChartCard>

              {/* Distribución por Sector */}
              <ChartCard title="Distribución por Sector" sub="Composición actual del capital expuesto por industria">
                <div style={{ display: 'flex', alignItems: 'center', height: 180 }}>
                  <ResponsiveContainer width="50%" height={160}>
                    <PieChart>
                      <Pie data={charts.sectorData} cx="50%" cy="50%" innerRadius={35} outerRadius={55} paddingAngle={3} dataKey="value">
                        {charts.sectorData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="none" />)}
                      </Pie>
                      <Tooltip content={<CustomTooltip formatter={(v: number) => money(v)} />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ width: '50%', display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 160, overflowY: 'auto' }}>
                    {charts.sectorData.map((s, i) => (
                      <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                        <span style={{ color: '#888', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: PIE_COLORS[i % PIE_COLORS.length] }} />
                          {s.name}
                        </span>
                        <span style={{ fontWeight: 700, color: '#fff' }}>{s.pct}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </ChartCard>
            </div>
          </>
        )}
      </div>
    </AppShell>
  )
}