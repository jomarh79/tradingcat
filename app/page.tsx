'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { usePrivacy } from '@/lib/PrivacyContext'
import AppShell from './AppShell'
import { Cat, TrendingUp, TrendingDown, Zap, Target, BarChart2 } from 'lucide-react'
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine,
} from 'recharts'

const parseDate = (d: string) => new Date((d || '').split('T')[0] + 'T00:00:00')
const SP500_DAILY  = 0.0003
const PORT_COLORS  = ['#00bfff', '#a78bfa', '#34d399', '#fb923c', '#f472b6']

type Period = 'YTD' | '1Y' | '5Y' | 'MAX'

const getMondayOfWeek = (d: Date): Date => {
  const date = new Date(d)
  const diff = date.getDay() === 0 ? -6 : 1 - date.getDay()
  date.setDate(date.getDate() + diff)
  date.setHours(0, 0, 0, 0)
  return date
}

const periodCutoff = (p: Period): Date => {
  const now = new Date()
  if (p === 'YTD') return new Date(now.getFullYear(), 0, 1)
  if (p === '1Y')  return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())
  if (p === '5Y')  return new Date(now.getFullYear() - 5, now.getMonth(), now.getDate())
  return new Date(2000, 0, 1)
}

export default function HomePage() {
  const { money } = usePrivacy()

  const [allTrades,  setAllTrades]  = useState<any[]>([])
  const [portfolios, setPortfolios] = useState<any[]>([])
  const [movements,  setMovements]  = useState<any[]>([])
  const [watchlist,  setWatchlist]  = useState<any[]>([])
  const [loading,    setLoading]    = useState(true)
  const [period,     setPeriod]     = useState<Period>('YTD')

  const fetchData = useCallback(async () => {
    const [{ data: t }, { data: p }, { data: m }, { data: w }] = await Promise.all([
      supabase.from('trades').select('*'),
      supabase.from('portfolios').select('*'),
      supabase.from('wallet_movements').select('amount, date, wallet_id'),
      supabase.from('watchlist').select('*'),
    ])
    if (t) setAllTrades(t)
    if (p) setPortfolios(p)
    if (m) setMovements(m)
    if (w) setWatchlist(w)
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // ── Stats globales ────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const open      = allTrades.filter(t => t.status === 'open')
    const closed    = allTrades.filter(t => t.status === 'closed')
    const deposited = movements.reduce((a, m) => a + Number(m.amount), 0)
    const invested  = open.reduce((a, t) => a + Number(t.total_invested || 0), 0)
    const pnl       = parseFloat(closed.reduce((a, t) => a + Number(t.realized_pnl || 0), 0).toFixed(2))
    const wins      = closed.filter(t => Number(t.realized_pnl) > 0).length
    const winRate   = closed.length ? parseFloat((wins / closed.length * 100).toFixed(1)) : 0
    const avgPnl    = closed.length ? parseFloat((pnl / closed.length).toFixed(2)) : 0

    const now = new Date()
    const thisMonth = closed
      .filter(t => {
        const d = parseDate(t.close_date || t.open_date)
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
      })
      .sort((a, b) => Number(b.realized_pnl) - Number(a.realized_pnl))

    return {
      capital: parseFloat((deposited + invested).toFixed(2)),
      pnl, wins, winRate, avgPnl,
      openCount:   open.length,
      closedCount: closed.length,
      bestTrade:   thisMonth[0],
      worstTrade:  thisMonth[thisMonth.length - 1],
    }
  }, [allTrades, movements])

  // ── Curva de equity global ────────────────────────────────────────────────
  const equityCurve = useMemo(() => {
    const closed = allTrades
      .filter(t => t.status === 'closed' && t.close_date)
      .sort((a, b) => parseDate(a.close_date).getTime() - parseDate(b.close_date).getTime())
    let cum = 0
    return closed.map(t => {
      cum += Number(t.realized_pnl || 0)
      return {
        date: parseDate(t.close_date).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }),
        pnl:  parseFloat(cum.toFixed(2)),
      }
    })
  }, [allTrades])

  // ── Comparativo % semanal vs SP500 — filtrado por período ─────────────────
  const compChartAll = useMemo(() => {
    if (!movements.length || !portfolios.length) return []

    const allDates    = movements.map(m => parseDate(m.date))
    const firstMonday = getMondayOfWeek(allDates.sort((a, b) => a.getTime() - b.getTime())[0])
    const weeks: Date[] = []
    const cur = new Date(firstMonday)
    const now = getMondayOfWeek(new Date())
    while (cur <= now) { weeks.push(new Date(cur)); cur.setDate(cur.getDate() + 7) }

    const cumMap:  Record<string, number> = {}
    const baseMap: Record<string, number> = {}
    portfolios.forEach(p => { cumMap[p.id] = 0; baseMap[p.id] = 0 })
    let sp500Cum = 0

    return weeks.map((monday, i) => {
      const nextM = new Date(monday); nextM.setDate(nextM.getDate() + 7)
      sp500Cum = parseFloat((sp500Cum + (Math.pow(1 + SP500_DAILY, 5) - 1) * 100).toFixed(3))

      const point: any = {
        label:     monday.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }),
        labelFull: monday.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: '2-digit' }),
        date:      monday,
        'S&P 500': parseFloat(sp500Cum.toFixed(2)),
      }

      portfolios.forEach(p => {
        const wm = movements.filter(m =>
          m.wallet_id === p.id &&
          parseDate(m.date) >= monday && parseDate(m.date) < nextM
        )
        const open = allTrades.filter(t => t.portfolio_id === p.id && t.status === 'open')
        cumMap[p.id] += wm.reduce((a, m) => a + Number(m.amount), 0)
        const cartera = cumMap[p.id] + open.reduce((a, t) => a + Number(t.total_invested || 0), 0)
        if (i === 0 && cartera > 0) baseMap[p.id] = cartera
        const base    = baseMap[p.id] || 1
        point[p.name] = parseFloat(((cartera - base) / base * 100).toFixed(2))
      })

      return point
    })
  }, [movements, portfolios, allTrades])

  // Filtrar por período seleccionado y re-basar desde 0
  const compChart = useMemo(() => {
    if (!compChartAll.length) return []
    const cutoff = periodCutoff(period)
    const filtered = compChartAll.filter(row => row.date >= cutoff)
    if (!filtered.length) return compChartAll  // si no hay datos en rango, mostrar todo

    // Re-basar: el primer punto del rango arranca en 0%
    const firstSP500 = filtered[0]['S&P 500']
    return filtered.map(row => {
      const point: any = {
        label:     period === '5Y' || period === 'MAX' ? row.labelFull : row.label,
        'S&P 500': parseFloat((row['S&P 500'] - firstSP500).toFixed(2)),
      }
      portfolios.forEach(p => {
        const firstVal = filtered[0][p.name] ?? 0
        point[p.name] = parseFloat(((row[p.name] ?? 0) - firstVal).toFixed(2))
      })
      return point
    })
  }, [compChartAll, period, portfolios])

  // ── Watchlist en zona ─────────────────────────────────────────────────────
  const inZone = useMemo(() =>
    watchlist
      .filter(i => i.current_price && Math.abs((i.current_price - i.buy_target) / i.buy_target) <= 0.02)
      .map(i => ({
        ...i,
        dist: parseFloat(((i.buy_target - i.current_price) / i.current_price * 100).toFixed(2)),
      }))
  , [watchlist])

  // ── Último valor de cada portafolio en el período ─────────────────────────
  const lastValues = useMemo(() => {
    if (!compChart.length) return {}
    const last = compChart[compChart.length - 1]
    const result: Record<string, number> = { 'S&P 500': last['S&P 500'] ?? 0 }
    portfolios.forEach(p => { result[p.name] = last[p.name] ?? 0 })
    return result
  }, [compChart, portfolios])

  const tt = { background: '#0a0a0a', border: '1px solid #1a1a1a', fontSize: 11, borderRadius: 8 }

  if (loading) return (
    <AppShell>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '70vh', gap: 10, color: '#333' }}>
        <Cat size={20} color="#00bfff" />
        <span style={{ fontSize: 12, letterSpacing: 2 }}>CARGANDO...</span>
      </div>
    </AppShell>
  )

  const pnlColor   = stats.pnl >= 0 ? '#22c55e' : '#f43f5e'
  const lastEquity = equityCurve[equityCurve.length - 1]

  return (
    <AppShell>
      <div style={{ color: 'white', padding: '20px 28px', maxWidth: 1360, margin: '0 auto' }}>

        {/* ═══ FILA 1 — KPIs ═══════════════════════════════════════════════ */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 12, marginBottom: 18 }}>

          {/* Tarjeta principal */}
          <div style={{
            background: 'linear-gradient(135deg, #080808 60%, #0d1a2e)',
            border: '1px solid #1a2a3a', borderRadius: 16, padding: '24px 28px',
            display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Cat size={16} color="#00bfff" />
              <span style={{ fontSize: 10, color: '#2a4a6a', fontWeight: 700, letterSpacing: 1 }}>TRADERCAT TERMINAL</span>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#2a4a6a', marginBottom: 6, fontWeight: 700, letterSpacing: 0.5 }}>CAPITAL TOTAL</div>
              <div style={{ fontSize: 34, fontWeight: 900, color: '#00bfff', letterSpacing: -1, lineHeight: 1 }}>
                {money(stats.capital)}
              </div>
              <div style={{ marginTop: 14, display: 'flex', gap: 20 }}>
                <div>
                  <div style={{ fontSize: 9, color: '#333', marginBottom: 3 }}>PNL REALIZADO</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: pnlColor }}>{money(stats.pnl)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 9, color: '#333', marginBottom: 3 }}>WIN RATE</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: stats.winRate >= 50 ? '#22c55e' : '#f43f5e' }}>
                    {stats.winRate}%
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 9, color: '#333', marginBottom: 3 }}>ABIERTOS</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>{stats.openCount}</div>
                </div>
              </div>
            </div>
          </div>

          <KpiCard icon={<BarChart2 size={14} color="#a78bfa" />} label="CERRADOS"      value={stats.closedCount}                  sub={`~${money(stats.avgPnl)} / trade`}                                     color="#a78bfa" />
          <KpiCard icon={<TrendingUp size={14} color="#22c55e" />} label="GANANCIAS"    value={stats.wins}                         sub={`de ${stats.closedCount} trades`}                                      color="#22c55e" />
          <KpiCard icon={<Zap size={14} color="#eab308" />}        label="MEJOR MES"   value={stats.bestTrade?.ticker || '—'}      sub={stats.bestTrade  ? money(stats.bestTrade.realized_pnl)  : 'sin cierres'} color="#eab308"  small />
          <KpiCard icon={<TrendingDown size={14} color="#f43f5e" />} label="PEOR MES"  value={stats.worstTrade?.ticker || '—'}     sub={stats.worstTrade ? money(stats.worstTrade.realized_pnl) : 'sin cierres'} color="#f43f5e" small />
        </div>

        {/* ═══ FILA 2 — Equity + Comparativo ══════════════════════════════ */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 12, marginBottom: 18 }}>

          {/* Curva de equity */}
          <div style={card}>
            <div style={cardHeader}>
              <span style={cardLabel}>CURVA DE EQUITY</span>
              {lastEquity && (
                <span style={{ fontSize: 13, fontWeight: 800, color: lastEquity.pnl >= 0 ? '#22c55e' : '#f43f5e' }}>
                  {money(lastEquity.pnl)}
                </span>
              )}
            </div>
            {equityCurve.length > 1 ? (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={equityCurve} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#00bfff" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#00bfff" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#0f0f0f" vertical={false} />
                  <XAxis dataKey="date" stroke="#1a1a1a" fontSize={9} tickLine={false} axisLine={false} />
                  <YAxis stroke="#1a1a1a" fontSize={9} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                  <Tooltip contentStyle={tt} formatter={(v: any) => [money(v), 'PnL acumulado']} />
                  <ReferenceLine y={0} stroke="#1a1a1a" />
                  <Area type="monotone" dataKey="pnl" stroke="#00bfff" fill="url(#eq)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState msg="Cierra trades para ver la curva" height={220} />
            )}
          </div>

          {/* Comparativo vs SP500 con selector de período */}
          <div style={card}>
            {/* Header con selector de período */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={cardLabel}>CRECIMIENTO % VS S&P 500</span>

              {/* Botones estilo Yahoo Finance */}
              <div style={{ display: 'flex', gap: 2, background: '#050505', padding: 3, borderRadius: 8, border: '1px solid #111' }}>
                {(['YTD', '1Y', '5Y', 'MAX'] as Period[]).map(p => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    style={{
                      background:   period === p ? '#1a1a1a' : 'transparent',
                      border:       period === p ? '1px solid #2a2a2a' : '1px solid transparent',
                      color:        period === p ? '#fff' : '#444',
                      padding:      '4px 10px',
                      borderRadius: 6,
                      cursor:       'pointer',
                      fontSize:     11,
                      fontWeight:   period === p ? 700 : 400,
                      transition:   'all 0.15s',
                      letterSpacing: 0.3,
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Rendimiento actual en el período — mini badges */}
            {compChart.length > 0 && (
              <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                {portfolios.map((p, i) => {
                  const val = lastValues[p.name] ?? 0
                  return (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: PORT_COLORS[i % PORT_COLORS.length], display: 'inline-block' }} />
                      <span style={{ fontSize: 10, color: '#555' }}>{p.name}</span>
                      <span style={{
                        fontSize: 11, fontWeight: 700,
                        color: val >= 0 ? '#22c55e' : '#f43f5e',
                      }}>
                        {val >= 0 ? '+' : ''}{val.toFixed(2)}%
                      </span>
                    </div>
                  )
                })}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 10, height: 1, background: '#6366f1', display: 'inline-block' }} />
                  <span style={{ fontSize: 10, color: '#555' }}>S&P 500</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: (lastValues['S&P 500'] ?? 0) >= 0 ? '#22c55e' : '#f43f5e' }}>
                    {(lastValues['S&P 500'] ?? 0) >= 0 ? '+' : ''}{(lastValues['S&P 500'] ?? 0).toFixed(2)}%
                  </span>
                </div>
              </div>
            )}

            {compChart.length > 1 ? (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={compChart} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#0f0f0f" vertical={false} />
                  <XAxis dataKey="label" stroke="#1a1a1a" fontSize={9} tickLine={false} axisLine={false} />
                  <YAxis stroke="#1a1a1a" fontSize={9} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} />
                  <Tooltip
                    contentStyle={tt}
                    formatter={(v: any, n?: string) => [`${parseFloat(v) >= 0 ? '+' : ''}${parseFloat(v).toFixed(2)}%`, n]}
                  />
                  <ReferenceLine y={0} stroke="#1a1a1a" strokeDasharray="3 3" />
                  <Line type="monotone" dataKey="S&P 500" stroke="#6366f1" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
                  {portfolios.map((p, i) => (
                    <Line key={p.id} type="monotone" dataKey={p.name}
                      stroke={PORT_COLORS[i % PORT_COLORS.length]} strokeWidth={2} dot={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState msg="Sin datos en este período" height={180} />
            )}
          </div>
        </div>

        {/* ═══ FILA 3 — Watchlist en zona ══════════════════════════════════ */}
        <div style={card}>
          <div style={{ ...cardHeader, marginBottom: inZone.length ? 14 : 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Target size={14} color="#22c55e" />
              <span style={cardLabel}>WATCHLIST EN ZONA ±2%</span>
            </div>
            <span style={{ fontSize: 10, color: '#2a2a2a' }}>
              {watchlist.length} activos monitoreados · precios desde Supabase
            </span>
          </div>

          {inZone.length === 0 ? (
            <div style={{ padding: '18px 0 6px', color: '#2a2a2a', fontSize: 12 }}>
              Ningún activo está cerca de tu precio objetivo ahora mismo.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
              {inZone.map(item => (
                <div key={item.ticker} style={{
                  background: '#050505', border: '1px solid rgba(34,197,94,0.15)',
                  borderRadius: 12, padding: '14px 18px',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <div>
                    <div style={{ fontWeight: 900, color: '#22c55e', fontSize: 16, marginBottom: 2 }}>{item.ticker}</div>
                    {item.price_name && <div style={{ fontSize: 10, color: '#333' }}>{item.price_name}</div>}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>${item.current_price?.toFixed(2)}</div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
                      <span style={{ fontSize: 10, color: '#444' }}>obj. ${item.buy_target?.toFixed(2)}</span>
                      <span style={{
                        fontSize: 10, fontWeight: 800,
                        color: Math.abs(item.dist) <= 0.5 ? '#22c55e' : '#eab308',
                        background: Math.abs(item.dist) <= 0.5 ? 'rgba(34,197,94,0.1)' : 'rgba(234,179,8,0.1)',
                        padding: '1px 6px', borderRadius: 4,
                      }}>
                        {item.dist > 0 ? '+' : ''}{item.dist.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </AppShell>
  )
}

// ── Sub-componentes ────────────────────────────────────────────────────────

function KpiCard({ icon, label, value, sub, color, small = false }: any) {
  return (
    <div style={{
      background: '#080808', border: '1px solid #141414',
      borderRadius: 16, padding: '20px 18px',
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
        {icon}
        <span style={{ fontSize: 9, color: '#2a2a2a', fontWeight: 700, letterSpacing: 0.8 }}>{label}</span>
      </div>
      <div>
        <div style={{ fontSize: small ? 15 : 22, fontWeight: 900, color, lineHeight: 1.1 }}>{value}</div>
        {sub && <div style={{ fontSize: 10, color: '#444', marginTop: 6 }}>{sub}</div>}
      </div>
    </div>
  )
}

function EmptyState({ msg, height }: { msg: string; height: number }) {
  return (
    <div style={{
      height, display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#1a1a1a', fontSize: 11, border: '1px dashed #111', borderRadius: 10, marginTop: 8,
    }}>
      {msg}
    </div>
  )
}

// ── Estilos ────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: '#080808', border: '1px solid #141414', borderRadius: 16, padding: '18px 22px',
}
const cardHeader: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16,
}
const cardLabel: React.CSSProperties = {
  fontSize: 9, color: '#333', fontWeight: 700, letterSpacing: 1.2,
}