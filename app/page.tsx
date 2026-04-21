'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { usePrivacy } from '@/lib/PrivacyContext'
import AppShell from './AppShell'
import { TrendingUp, TrendingDown, Zap, Target, BarChart2 } from 'lucide-react'
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine,
} from 'recharts'

const parseDate = (d: string) => new Date((d || '').split('T')[0] + 'T00:00:00')
//const SP500_DAILY = 0.0003
const PORT_COLORS = ['#00bfff', '#a78bfa', '#34d399', '#fb923c', '#f472b6']

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

// ═══════════════════════════════════════════════════════════════════════════
//  CAT SVG COMPONENTS — máximo temático
// ═══════════════════════════════════════════════════════════════════════════

const Paw = ({ size = 16, color = '#00bfff', opacity = 1, rotate = 0 }: any) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color}
    style={{ opacity, transform: `rotate(${rotate}deg)`, flexShrink: 0 }}>
    <ellipse cx="6"  cy="5"  rx="2.5" ry="3"/>
    <ellipse cx="11" cy="3"  rx="2.5" ry="3"/>
    <ellipse cx="16" cy="4"  rx="2.5" ry="3"/>
    <ellipse cx="19" cy="9"  rx="2"   ry="2.5"/>
    <path d="M12 22c-5 0-8-3-8-7 0-2.5 1.5-4.5 4-5.5 1-.4 2-.6 4-.6s3 .2 4 .6c2.5 1 4 3 4 5.5 0 4-3 7-8 7z"/>
  </svg>
)

// Gato completo sentado con detalles
const CatFull = ({ size = 80, color = '#00bfff', opacity = 0.08 }: any) => (
  <svg width={size} height={size * 1.35} viewBox="0 0 60 81" fill={color} style={{ opacity }}>
    {/* orejas */}
    <polygon points="8,22 15,4 24,22"/>
    <polygon points="36,22 45,4 52,22"/>
    {/* cabeza */}
    <ellipse cx="30" cy="30" rx="17" ry="15"/>
    {/* nariz */}
    <ellipse cx="30" cy="33" rx="2" ry="1.5" fill="white" opacity="0.3"/>
    {/* bigotes izq */}
    <line x1="5" y1="30" x2="22" y2="32" stroke="white" strokeWidth="0.8" opacity="0.2"/>
    <line x1="5" y1="34" x2="22" y2="34" stroke="white" strokeWidth="0.8" opacity="0.2"/>
    {/* bigotes der */}
    <line x1="55" y1="30" x2="38" y2="32" stroke="white" strokeWidth="0.8" opacity="0.2"/>
    <line x1="55" y1="34" x2="38" y2="34" stroke="white" strokeWidth="0.8" opacity="0.2"/>
    {/* cuerpo */}
    <ellipse cx="30" cy="58" rx="16" ry="18"/>
    {/* cola */}
    <path d="M46 68 Q58 55 54 42 Q50 32 46 38" fill="none" stroke={color} strokeWidth="3.5" strokeLinecap="round"/>
    {/* patas delanteras */}
    <ellipse cx="20" cy="74" rx="5" ry="3"/>
    <ellipse cx="40" cy="74" rx="5" ry="3"/>
  </svg>
)

// Orejas de gato (para header)
const CatEars = ({ color = '#00bfff', opacity = 0.12, size = 44 }: any) => (
  <svg width={size * 1.6} height={size} viewBox="0 0 70 44" fill={color} style={{ opacity }}>
    <polygon points="0,44 14,0 28,44"/>
    <polygon points="42,44 56,0 70,44"/>
  </svg>
)

// Cola de gato (lateral)
const CatTail = ({ color = '#00bfff', opacity = 0.08, height = 90 }: any) => (
  <svg width={50} height={height} viewBox="0 0 50 90" fill="none"
    stroke={color} strokeWidth="3.5" strokeLinecap="round" style={{ opacity }}>
    <path d="M42 90 Q48 60 22 48 Q0 36 12 12 Q22 -4 40 6"/>
  </svg>
)

// Bigotes horizontales
const Whiskers = ({ color = '#888', opacity = 0.12, width = 100 }: any) => (
  <svg width={width} height={36} viewBox={`0 0 ${width} 36`}
    stroke={color} strokeWidth="1.5" style={{ opacity }}>
    <line x1="0" y1="8"  x2={width * 0.42} y2="18"/>
    <line x1="0" y1="18" x2={width * 0.42} y2="18"/>
    <line x1="0" y1="28" x2={width * 0.42} y2="18"/>
    <line x1={width} y1="8"  x2={width * 0.58} y2="18"/>
    <line x1={width} y1="18" x2={width * 0.58} y2="18"/>
    <line x1={width} y1="28" x2={width * 0.58} y2="18"/>
  </svg>
)

// Rastro de huellas diagonal
const PawTrail = ({ color = '#00bfff', opacity = 0.06, count = 4, size = 14, gap = 26 }: any) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap, transform: 'rotate(-15deg)', pointerEvents: 'none' }}>
    {Array.from({ length: count }).map((_, i) => (
      <Paw key={i} size={size - i * 1.5} color={color} opacity={opacity - i * 0.01} rotate={i * 5} />
    ))}
  </div>
)

// Selector de período (reutilizable)
const PeriodSelector = ({ period, onChange }: { period: Period; onChange: (p: Period) => void }) => (
  <div style={{ display: 'flex', gap: 2, background: '#050505', padding: 3, borderRadius: 8, border: '1px solid #111' }}>
    {(['YTD', '1Y', '5Y', 'MAX'] as Period[]).map(p => (
      <button key={p} onClick={() => onChange(p)} style={{
        background:    period === p ? '#1a1a1a' : 'transparent',
        border:        period === p ? '1px solid #2a2a2a' : '1px solid transparent',
        color:         period === p ? '#fff' : '#444',
        padding:       '4px 10px', borderRadius: 6, cursor: 'pointer',
        fontSize: 11, fontWeight: period === p ? 700 : 400,
        transition: 'all 0.15s', letterSpacing: 0.3,
      }}>
        {p}
      </button>
    ))}
  </div>
)

// ═══════════════════════════════════════════════════════════════════════════

export default function HomePage() {
  const { money } = usePrivacy()

  const [allTrades,  setAllTrades]  = useState<any[]>([])
  const [portfolios, setPortfolios] = useState<any[]>([])
  const [movements,  setMovements]  = useState<any[]>([])
  const [watchlist,  setWatchlist]  = useState<any[]>([])
  const [loading,    setLoading]    = useState(true)
  const [period,     setPeriod]     = useState<Period>('YTD')
  const [equityPeriod, setEquityPeriod] = useState<Period>('YTD')
  const [sp500Data, setSp500Data] = useState<any[]>([])

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

  useEffect(() => {
  fetchData()
  fetchSP500()
}, [fetchData])

 const fetchSP500 = async () => {
  try {
    const res = await fetch(
      `https://api.twelvedata.com/time_series?symbol=SPY&interval=1day&outputsize=5000&apikey=${process.env.NEXT_PUBLIC_TWELVEDATA_API_KEY}`
    )

    const json = await res.json()

    if (json.values) {
      const formatted = json.values
        .map((d: any) => ({
          date: new Date(d.datetime),
          close: Number(d.close),
        }))
        .sort((a: any, b: any) => a.date.getTime() - b.date.getTime())

      setSp500Data(formatted)
    } else {
      console.error('Error SP500:', json)
    }
  } catch (e) {
    console.error('Error SP500 fetch:', e)
  }
}

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

    return {
      capital: parseFloat((deposited + invested).toFixed(2)),
      pnl, wins, winRate, avgPnl,
      openCount:   open.length,
      closedCount: closed.length,
    }
  }, [allTrades, movements])

  // ── Stats por portafolio ─────────────────────────────────────────────────
  const portfolioStats = useMemo(() => {
    const now = new Date()
    return portfolios.map((port, i) => {
      const closed = allTrades.filter(t => t.status === 'closed' && t.portfolio_id === port.id)
      const open   = allTrades.filter(t => t.status === 'open'   && t.portfolio_id === port.id)
      const wins   = closed.filter(t => Number(t.realized_pnl) > 0).length
      const pnl    = parseFloat(closed.reduce((a, t) => a + Number(t.realized_pnl || 0), 0).toFixed(2))

      const thisMonth = closed.filter(t => {
        const d = parseDate(t.close_date || t.open_date)
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
      }).sort((a, b) => Number(b.realized_pnl) - Number(a.realized_pnl))

      return {
        id:         port.id,
        name:       port.name,
        color:      PORT_COLORS[i % PORT_COLORS.length],
        closedCount: closed.length,
        openCount:   open.length,
        wins,
        pnl,
        bestTrade:  thisMonth[0]  || null,
        worstTrade: thisMonth[thisMonth.length - 1] || null,
      }
    })
  }, [allTrades, portfolios])

  // ── Curva de equity global con filtro de período ──────────────────────────
  const equityCurveAll = useMemo(() => {
    const closed = allTrades
      .filter(t => t.status === 'closed' && t.close_date)
      .sort((a, b) => parseDate(a.close_date).getTime() - parseDate(b.close_date).getTime())
    let cum = 0
    return closed.map(t => ({
      date:    parseDate(t.close_date),
      dateStr: parseDate(t.close_date).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }),
      dateFull:parseDate(t.close_date).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: '2-digit' }),
      pnl:     parseFloat((cum += Number(t.realized_pnl || 0), cum).toFixed(2)),
    }))
  }, [allTrades])

  const equityCurve = useMemo(() => {
    const cutoff   = periodCutoff(equityPeriod)
    const filtered = equityCurveAll.filter(d => d.date >= cutoff)
    const data     = filtered.length ? filtered : equityCurveAll
    if (!data.length) return []
    const base = data[0].pnl
    return data.map(d => ({
      date: equityPeriod === '5Y' || equityPeriod === 'MAX' ? d.dateFull : d.dateStr,
      pnl:  parseFloat((d.pnl - base).toFixed(2)),
    }))
  }, [equityCurveAll, equityPeriod])

  // ── Comparativo % semanal vs SP500 ────────────────────────────────────────
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

     const cutoff = periodCutoff(period)
const filteredSP = sp500Data.filter(d => d.date >= cutoff)
const first = filteredSP[0]?.close

    return weeks.map((monday, i) => {
  const nextM = new Date(monday)
  nextM.setDate(nextM.getDate() + 7)

  let spValue = 0

  if (filteredSP.length > 0 && first) {
    const current = filteredSP
      .filter(d => d.date <= monday)
      .slice(-1)[0]?.close

    if (current) {
      spValue = ((current - first) / first) * 100
    }
  }

const point: any = {
  label: monday.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }),
  labelFull: monday.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: '2-digit' }),
  date: monday,
  'S&P 500': parseFloat(spValue.toFixed(2)),
}
      portfolios.forEach(p => {
        const wm    = movements.filter(m => m.wallet_id === p.id && parseDate(m.date) >= monday && parseDate(m.date) < nextM)
        const open  = allTrades.filter(t => t.portfolio_id === p.id && t.status === 'open')
        cumMap[p.id] += wm.reduce((a, m) => a + Number(m.amount), 0)
        const cartera = cumMap[p.id] + open.reduce((a, t) => a + Number(t.total_invested || 0), 0)
        if (i === 0 && cartera > 0) baseMap[p.id] = cartera
        const base = baseMap[p.id] || 1
        point[p.name] = parseFloat(((cartera - base) / base * 100).toFixed(2))
      })
      return point
    })
  }, [movements, portfolios, allTrades, sp500Data, period])

  const compChart = useMemo(() => {
    if (!compChartAll.length) return []
    const cutoff   = periodCutoff(period)
    const filtered = compChartAll.filter(row => row.date >= cutoff)
    const data     = filtered.length ? filtered : compChartAll
    const firstSP  = data[0]['S&P 500']
    return data.map(row => {
      const point: any = {
        label:     period === '5Y' || period === 'MAX' ? row.labelFull : row.label,
        'S&P 500': parseFloat((row['S&P 500'] - firstSP).toFixed(2)),
      }
      portfolios.forEach(p => {
        const firstVal = data[0][p.name] ?? 0
        point[p.name]  = parseFloat(((row[p.name] ?? 0) - firstVal).toFixed(2))
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
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '70vh', gap: 16 }}>
        <CatFull size={70} color="#00bfff" opacity={0.5} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {[0,1,2,3].map(i => (
            <Paw key={i} size={12 - i * 1.5} color="#00bfff" opacity={0.4 - i * 0.08} rotate={i * 10} />
          ))}
        </div>
        <span style={{ fontSize: 11, letterSpacing: 3, color: '#333' }}>CARGANDO...</span>
      </div>
    </AppShell>
  )

  const pnlColor     = stats.pnl >= 0 ? '#22c55e' : '#f43f5e'
  const lastEquityPt = equityCurve[equityCurve.length - 1]

  return (
    <AppShell>
      <div style={{ color: 'white', padding: '20px 28px', maxWidth: 1400, margin: '0 auto', position: 'relative', overflow: 'hidden' }}>

        {/* ── DECORACIONES GLOBALES DE GATO ── */}
        <div style={{ position: 'absolute', top: 0, right: 60, pointerEvents: 'none', zIndex: 0 }}>
          <CatEars color="#00bfff" opacity={0.1} size={52} />
        </div>
        <div style={{ position: 'absolute', right: -10, top: '18%', pointerEvents: 'none', zIndex: 0 }}>
          <CatTail color="#a78bfa" opacity={0.07} height={110} />
        </div>
        <div style={{ position: 'absolute', left: -10, top: '55%', pointerEvents: 'none', zIndex: 0 }}>
          <CatTail color="#00bfff" opacity={0.05} height={90} />
        </div>
        <div style={{ position: 'absolute', top: 80, right: 100, pointerEvents: 'none', zIndex: 0 }}>
          <PawTrail color="#00bfff" opacity={0.05} count={5} size={15} gap={20} />
        </div>
        <div style={{ position: 'absolute', bottom: 80, left: 20, pointerEvents: 'none', zIndex: 0 }}>
          <PawTrail color="#a78bfa" opacity={0.04} count={4} size={12} gap={18} />
        </div>

        {/* ═══ FILA 1 — TARJETA PRINCIPAL + KPIs POR PORTAFOLIO ══════════ */}
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 14, marginBottom: 16, position: 'relative', zIndex: 1 }}>

          {/* ── Tarjeta TRADERCAT ── */}
          <div style={{
            background: 'linear-gradient(135deg, #060810 0%, #0a1428 50%, #080810 100%)',
            border: '1px solid #1a2a4a', borderRadius: 20, padding: '24px 26px',
            position: 'relative', overflow: 'hidden',
            display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
          }}>
            {/* Gato decorativo de fondo */}
            <div style={{ position: 'absolute', bottom: -12, right: -12, pointerEvents: 'none' }}>
              <CatFull size={110} color="#00bfff" opacity={0.06} />
            </div>
            <div style={{ position: 'absolute', top: 10, right: 14, pointerEvents: 'none' }}>
              <Whiskers color="#00bfff" opacity={0.1} width={90} />
            </div>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Paw size={18} color="#00bfff" opacity={0.9} />
              <Paw size={13} color="#00bfff" opacity={0.5} />
              <Paw size={9}  color="#00bfff" opacity={0.25} />
              <span style={{ fontSize: 9, color: '#1a4a7a', fontWeight: 900, letterSpacing: 2, marginLeft: 4 }}>
                TRADERCAT TERMINAL
              </span>
            </div>

            {/* Capital */}
            <div>
              <div style={{ fontSize: 10, color: '#1a3a5a', marginBottom: 4, fontWeight: 700, letterSpacing: 1 }}>
                CAPITAL TOTAL
              </div>
              <div style={{ fontSize: 32, fontWeight: 900, color: '#00bfff', letterSpacing: -1, lineHeight: 1, marginBottom: 16 }}>
                {money(stats.capital)}
              </div>

              {/* KPIs mini */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {[
                  { label: 'PNL',      value: money(stats.pnl),        color: pnlColor },
                  { label: 'WIN RATE', value: `${stats.winRate}%`,      color: stats.winRate >= 50 ? '#22c55e' : '#f43f5e' },
                  { label: 'ABIERTOS', value: stats.openCount,          color: '#fff' },
                ].map(k => (
                  <div key={k.label} style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: '8px 10px' }}>
                    <div style={{ fontSize: 8, color: '#2a4a6a', marginBottom: 3, fontWeight: 700 }}>{k.label}</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: k.color }}>{k.value}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── KPIs por portafolio — 4 secciones ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>

            {/* CERRADOS por portafolio */}
            <div style={{ ...kpiGroup, borderColor: '#1a1a2a' }}>
              <div style={kpiGroupHeader}>
                <BarChart2 size={12} color="#a78bfa" />
                <span style={{ color: '#a78bfa' }}>CERRADOS</span>
                <span style={{ marginLeft: 'auto', color: '#555' }}>{stats.closedCount} total</span>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
                {portfolioStats.map(ps => (
                  <div key={ps.id} style={kpiRow}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Paw size={8} color={ps.color} opacity={0.7} />
                      <span style={{ fontSize: 10, color: '#888', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ps.name}</span>
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 800, color: ps.color }}>{ps.closedCount}</span>
                  </div>
                ))}
                {portfolioStats.length === 0 && <span style={{ fontSize: 10, color: '#333' }}>Sin datos</span>}
              </div>
              <div style={{ borderTop: '1px solid #111', paddingTop: 6, fontSize: 9, color: '#555' }}>
                ~{money(stats.avgPnl)} / trade
              </div>
            </div>

            {/* GANANCIAS por portafolio */}
            <div style={{ ...kpiGroup, borderColor: 'rgba(34,197,94,0.15)' }}>
              <div style={kpiGroupHeader}>
                <TrendingUp size={12} color="#22c55e" />
                <span style={{ color: '#22c55e' }}>GANANCIAS</span>
                <span style={{ marginLeft: 'auto', color: '#555' }}>{stats.wins} total</span>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
                {portfolioStats.map(ps => {
                  const wr = ps.closedCount > 0 ? Math.round(ps.wins / ps.closedCount * 100) : 0
                  return (
                    <div key={ps.id} style={kpiRow}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Paw size={8} color={ps.color} opacity={0.7} />
                        <span style={{ fontSize: 10, color: '#888', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ps.name}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ fontSize: 12, fontWeight: 800, color: '#22c55e' }}>{ps.wins}</span>
                        <span style={{ fontSize: 9, color: wr >= 50 ? '#22c55e' : '#f43f5e' }}>{wr}%</span>
                      </div>
                    </div>
                  )
                })}
                {portfolioStats.length === 0 && <span style={{ fontSize: 10, color: '#333' }}>Sin datos</span>}
              </div>
              <div style={{ borderTop: '1px solid #111', paddingTop: 6, fontSize: 9, color: '#555' }}>
                de {stats.closedCount} trades totales
              </div>
            </div>

            {/* MEJOR TRADE del mes por portafolio */}
            <div style={{ ...kpiGroup, borderColor: 'rgba(234,179,8,0.15)' }}>
              <div style={kpiGroupHeader}>
                <Zap size={12} color="#eab308" />
                <span style={{ color: '#eab308' }}>MEJOR MES</span>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
                {portfolioStats.map(ps => (
                  <div key={ps.id} style={kpiRow}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Paw size={8} color={ps.color} opacity={0.7} />
                      <span style={{ fontSize: 10, color: '#888', maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ps.name}</span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: '#eab308' }}>
                        {ps.bestTrade?.ticker || '—'}
                      </div>
                      {ps.bestTrade && (
                        <div style={{ fontSize: 9, color: '#22c55e' }}>
                          {money(Number(ps.bestTrade.realized_pnl))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {portfolioStats.length === 0 && <span style={{ fontSize: 10, color: '#333' }}>Sin datos</span>}
              </div>
              <div style={{ borderTop: '1px solid #111', paddingTop: 6, fontSize: 9, color: '#555' }}>
                mejores cierres este mes
              </div>
            </div>

            {/* PEOR TRADE del mes por portafolio */}
            <div style={{ ...kpiGroup, borderColor: 'rgba(244,63,94,0.15)' }}>
              <div style={kpiGroupHeader}>
                <TrendingDown size={12} color="#f43f5e" />
                <span style={{ color: '#f43f5e' }}>PEOR MES</span>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
                {portfolioStats.map(ps => (
                  <div key={ps.id} style={kpiRow}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Paw size={8} color={ps.color} opacity={0.7} />
                      <span style={{ fontSize: 10, color: '#888', maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ps.name}</span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: '#f43f5e' }}>
                        {ps.worstTrade?.ticker || '—'}
                      </div>
                      {ps.worstTrade && (
                        <div style={{ fontSize: 9, color: '#f43f5e' }}>
                          {money(Number(ps.worstTrade.realized_pnl))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {portfolioStats.length === 0 && <span style={{ fontSize: 10, color: '#333' }}>Sin datos</span>}
              </div>
              <div style={{ borderTop: '1px solid #111', paddingTop: 6, fontSize: 9, color: '#555' }}>
                peores cierres este mes
              </div>
            </div>

          </div>
        </div>

        {/* ═══ FILA 2 — EQUITY (con período) + COMPARATIVO ════════════════ */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 14, marginBottom: 16, position: 'relative', zIndex: 1 }}>

          {/* Curva de equity CON filtro de período */}
          <div style={{ ...card, position: 'relative', overflow: 'hidden' }}>
            {/* Gato decorativo dentro de la tarjeta */}
            <div style={{ position: 'absolute', bottom: 0, right: -8, pointerEvents: 'none' }}>
              <CatFull size={55} color="#00bfff" opacity={0.04} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <Paw size={11} color="#00bfff" opacity={0.6} />
                <span style={cardLabel}>CURVA DE EQUITY</span>
                {lastEquityPt && (
                  <span style={{ fontSize: 12, fontWeight: 800, color: lastEquityPt.pnl >= 0 ? '#22c55e' : '#f43f5e', marginLeft: 6 }}>
                    {lastEquityPt.pnl >= 0 ? '+' : ''}{money(lastEquityPt.pnl)}
                  </span>
                )}
              </div>
              <PeriodSelector period={equityPeriod} onChange={setEquityPeriod} />
            </div>

            {equityCurve.length > 1 ? (
              <ResponsiveContainer width="100%" height={210}>
                <AreaChart data={equityCurve} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#00bfff" stopOpacity={0.22} />
                      <stop offset="95%" stopColor="#00bfff" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#0d0d0d" vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fill: '#888', fontSize: 9 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: '#888', fontSize: 9 }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                  <Tooltip contentStyle={tt} formatter={(v: any) => [money(v), 'PnL']} />
                  <ReferenceLine y={0} stroke="#222" strokeDasharray="3 3" />
                  <Area type="monotone" dataKey="pnl" stroke="#00bfff" fill="url(#eqGrad)" strokeWidth={2.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState msg="Cierra trades para ver la curva" height={210} />
            )}
          </div>

          {/* Comparativo vs SP500 */}
          <div style={{ ...card, position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 8, right: 120, pointerEvents: 'none' }}>
              <Whiskers color="#a78bfa" opacity={0.08} width={80} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <Paw size={11} color="#a78bfa" opacity={0.6} />
                <span style={cardLabel}>CRECIMIENTO % VS S&P 500</span>
              </div>
              <PeriodSelector period={period} onChange={setPeriod} />
            </div>

            {/* Mini badges de rendimiento */}
            {compChart.length > 0 && (
              <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                {portfolios.map((p, i) => {
                  const val = lastValues[p.name] ?? 0
                  return (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 9, height: 9, borderRadius: '50%', background: PORT_COLORS[i % PORT_COLORS.length], display: 'inline-block' }} />
                      <span style={{ fontSize: 10, color: '#666' }}>{p.name}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: val >= 0 ? '#22c55e' : '#f43f5e' }}>
                        {val >= 0 ? '+' : ''}{val.toFixed(2)}%
                      </span>
                    </div>
                  )
                })}
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 12, height: 1, background: '#6366f1', display: 'inline-block' }} />
                  <span style={{ fontSize: 10, color: '#666' }}>S&P 500</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: (lastValues['S&P 500'] ?? 0) >= 0 ? '#22c55e' : '#f43f5e' }}>
                    {(lastValues['S&P 500'] ?? 0) >= 0 ? '+' : ''}{(lastValues['S&P 500'] ?? 0).toFixed(2)}%
                  </span>
                </div>
              </div>
            )}

            {compChart.length > 1 ? (
              <ResponsiveContainer width="100%" height={186}>
                <LineChart data={compChart} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#0d0d0d" vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fill: '#888', fontSize: 9 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: '#888', fontSize: 9 }} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} />
                  <Tooltip contentStyle={tt} formatter={(v: any, n?: string) => [`${parseFloat(v) >= 0 ? '+' : ''}${parseFloat(v).toFixed(2)}%`, n]} />
                  <ReferenceLine y={0} stroke="#222" strokeDasharray="3 3" />
                  <Line type="monotone" dataKey="S&P 500" stroke="#6366f1" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
                  {portfolios.map((p, i) => (
                    <Line key={p.id} type="monotone" dataKey={p.name}
                      stroke={PORT_COLORS[i % PORT_COLORS.length]} strokeWidth={2} dot={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState msg="Sin datos en este período" height={186} />
            )}
          </div>
        </div>

        {/* ═══ FILA 3 — WATCHLIST EN ZONA ══════════════════════════════════ */}
        <div style={{ ...card, position: 'relative', overflow: 'hidden', zIndex: 1 }}>
          {/* Decoración interna */}
          <div style={{ position: 'absolute', bottom: -10, right: -8, pointerEvents: 'none' }}>
            <CatFull size={68} color="#22c55e" opacity={0.04} />
          </div>

          <div style={{ ...cardHeader, marginBottom: inZone.length ? 14 : 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Paw size={13} color="#22c55e" opacity={0.8} />
              <Paw size={9}  color="#22c55e" opacity={0.4} />
              <Target size={13} color="#22c55e" />
              <span style={cardLabel}>WATCHLIST EN ZONA ±2%</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 10, color: '#444' }}>
                {watchlist.length} activos monitoreados
              </span>
              {inZone.length > 0 && (
                <span style={{
                  fontSize: 10, fontWeight: 700, color: '#22c55e',
                  background: 'rgba(34,197,94,0.1)', padding: '2px 8px', borderRadius: 4,
                  border: '1px solid rgba(34,197,94,0.2)',
                }}>
                  {inZone.length} en zona 🐱
                </span>
              )}
            </div>
          </div>

          {inZone.length === 0 ? (
            <div style={{ padding: '16px 0 6px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <Paw size={20} color="#333" opacity={0.5} />
              <span style={{ color: '#333', fontSize: 12 }}>
                Ningún activo está cerca de tu precio objetivo ahora mismo.
              </span>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
              {inZone.map(item => {
                const veryClose = Math.abs(item.dist) <= 0.5
                return (
                  <div key={item.ticker} style={{
                    background: '#050505',
                    border: `1px solid ${veryClose ? 'rgba(34,197,94,0.3)' : 'rgba(34,197,94,0.12)'}`,
                    borderRadius: 12, padding: '12px 16px',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    position: 'relative', overflow: 'hidden',
                  }}>
                    <div style={{ position: 'absolute', bottom: -8, right: -8, pointerEvents: 'none' }}>
                      <Paw size={34} color="#22c55e" opacity={0.04} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 900, color: '#22c55e', fontSize: 15, marginBottom: 2 }}>{item.ticker}</div>
                      {item.price_name && <div style={{ fontSize: 9, color: '#444' }}>{item.price_name}</div>}
                      {item.ai_signal && (
                        <div style={{ fontSize: 9, color: '#888', marginTop: 3 }}>{item.ai_signal}</div>
                      )}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>${item.current_price?.toFixed(2)}</div>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                        <span style={{ fontSize: 9, color: '#444' }}>obj ${item.buy_target?.toFixed(2)}</span>
                        <span style={{
                          fontSize: 10, fontWeight: 800,
                          color: veryClose ? '#22c55e' : '#eab308',
                          background: veryClose ? 'rgba(34,197,94,0.1)' : 'rgba(234,179,8,0.1)',
                          padding: '1px 6px', borderRadius: 4,
                        }}>
                          {item.dist > 0 ? '+' : ''}{item.dist.toFixed(2)}%
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Rastro de huellas decorativo al fondo de la página */}
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 8, opacity: 0.06, pointerEvents: 'none' }}>
          {[18, 14, 11, 8, 6].map((s, i) => (
            <Paw key={i} size={s} color="#00bfff" opacity={1} rotate={i * 12} />
          ))}
        </div>

      </div>
    </AppShell>
  )
}

// ── Sub-componentes ──────────────────────────────────────────────────────────

function EmptyState({ msg, height }: { msg: string; height: number }) {
  return (
    <div style={{
      height, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 10, color: '#1a1a1a', fontSize: 11,
      border: '1px dashed #111', borderRadius: 10, marginTop: 8,
    }}>
      <Paw size={22} color="#1a1a1a" opacity={0.5} />
      {msg}
    </div>
  )
}

// ── Estilos ──────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: '#080808', border: '1px solid #141414', borderRadius: 16, padding: '18px 22px',
}
const cardHeader: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16,
}
const cardLabel: React.CSSProperties = {
  fontSize: 9, color: '#555', fontWeight: 700, letterSpacing: 1.2,
}
const kpiGroup: React.CSSProperties = {
  background: '#080808', border: '1px solid #1a1a1a', borderRadius: 14,
  padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10,
}
const kpiGroupHeader: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 5, fontSize: 9,
  fontWeight: 700, letterSpacing: 0.8, paddingBottom: 8,
  borderBottom: '1px solid #111',
}
const kpiRow: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
}