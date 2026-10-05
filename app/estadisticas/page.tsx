'use client'

import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { usePrivacy } from '@/lib/PrivacyContext'
import AppShell from '../AppShell'
import { BarChart2 } from 'lucide-react'
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  ComposedChart, Line, ReferenceLine, Legend, Treemap,
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

// Color del mapa de calor — gris neutro en 0%, se satura a verde (+) o rojo (−) según magnitud (tope en ±30%)
function heatColor(pct: number): string {
  const clamp = Math.max(-30, Math.min(30, pct))
  const t = Math.abs(clamp) / 30
  const base   = { r: 26, g: 26, b: 26 }
  const target = clamp >= 0 ? { r: 34, g: 197, b: 94 } : { r: 244, g: 63, b: 94 }
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t)
  return `rgb(${mix(base.r, target.r)}, ${mix(base.g, target.g)}, ${mix(base.b, target.b)})`
}

const dayKey = (d: any) => String(d || '').split('T')[0].split(' ')[0]
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const localDayKey = (d: Date) => d.toLocaleDateString('sv-SE') // yyyy-MM-dd en hora local
const dayMs = (k: string) => new Date(k + 'T00:00:00').getTime()
const r2 = (n: number) => parseFloat(n.toFixed(2))

type RangeKey = 'YTD' | '1Y' | '5Y' | 'MAX'

// Máximo 1000 filas por consulta en Supabase: se pide por páginas
const PAGE = 1000
async function fetchAll(make: () => any): Promise<any[]> {
  const rows: any[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await make().range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    if (!data?.length) break
    rows.push(...data)
    if (data.length < PAGE) break
  }
  return rows
}

// Costo vigente de una posición abierta (mismo criterio que el resto de páginas)
function openInvested(t: any): number {
  const ti = Number(t.total_invested)
  if (Number.isFinite(ti) && ti > 0) return ti
  const initialInv = Number(t.initial_entry_price || t.entry_price || 0) * Number(t.initial_quantity || t.quantity || 0)
  const buyExtra = (t.trade_executions || [])
    .filter((e: any) => e.execution_type === 'buy')
    .reduce((a: number, e: any) => a + Number(e.quantity) * Number(e.price) + Number(e.commission || 0), 0)
  return r2(initialInv + buyExtra)
}

// Un solo criterio de sector para dona, PnL por sector y mapa de calor
// (antes la dona decía "Otros" y el mapa de calor "ETFs" para lo mismo)
function normSector(s: any): string {
  const v = String(s || '').trim()
  if (!v) return 'ETFs'
  return v.charAt(0).toUpperCase() + v.slice(1).toLowerCase()
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
  const [loadError,         setLoadError]         = useState('')
  const [spSeries,          setSpSeries]          = useState<{ dates: string[]; closes: number[] }>({ dates: [], closes: [] })
  const [range,             setRange]             = useState<RangeKey>('MAX')

  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const fetchData = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const [tData, pData] = await Promise.all([
        fetchAll(() => supabase.from('trades')
          .select('*, portfolios(name), trade_executions(quantity, price, commission, execution_type)')
          .eq('user_id', user.id).eq('status', 'open').order('open_date').order('id')),
        fetchAll(() => supabase.from('portfolios').select('id, name').eq('user_id', user.id).order('id')),
      ])
      if (!alive.current) return
      setTrades(tData); setPortfolios(pData); setLoadError('')
    } catch (e: any) {
      if (alive.current) setLoadError(e?.message || 'No se pudieron cargar los datos')
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [])

  // Caché del S&P 500 (acepta formato viejo [{date,close}] y nuevo {ts,rows})
  const loadSP500 = useCallback(() => {
    try {
      const cached = localStorage.getItem('sp500')
      if (!cached) return
      const parsed = JSON.parse(cached)
      const rows: { date: string; close: number }[] = Array.isArray(parsed) ? parsed : (parsed?.rows || [])
      const clean = rows
        .map(d => ({ date: dayKey(d.date), close: Number(d.close) }))
        .filter(d => DAY_RE.test(d.date) && d.close > 0)
        .sort((a, b) => a.date.localeCompare(b.date))
      setSpSeries({ dates: clean.map(d => d.date), closes: clean.map(d => d.close) })
    } catch (e) { console.error('SP500 cache error:', e) }
  }, [])

  useEffect(() => { fetchData(); loadSP500() }, [fetchData, loadSP500])

  const filteredTrades = useMemo(() => {
    if (selectedPortfolio === 'all') return trades
    return trades.filter(t => t.portfolio_id === selectedPortfolio)
  }, [trades, selectedPortfolio])

  const stats = useMemo(() => {
    if (!filteredTrades.length) return null

    // Una sola vez por trade: costo, valor actual, PnL
    const withPnl = filteredTrades.map(t => {
      const qty      = Number(t.quantity || 0)
      const invested = openInvested(t)
      const avgPrice = qty > 0 ? invested / qty : Number(t.entry_price || 0)
      const curPrice = Number(t.last_price || t.entry_price || 0)
      const value    = qty * curPrice
      const pnl      = r2(value - invested)
      const pnlPct   = invested > 0 ? r2(((value - invested) / invested) * 100) : 0
      return { ...t, invested, qty, avgPrice, curPrice, value, pnl, pnlPct, sectorN: normSector(t.sector) }
    })

    const totalInvested = withPnl.reduce((a, t) => a + t.invested, 0)
    const totalCurrent  = withPnl.reduce((a, t) => a + t.value, 0)
    const totalPnL      = totalCurrent - totalInvested
    const totalPnLPct   = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0

    // Horizonte por billetera — SIEMPRE global, no depende del filtro de portafolio seleccionado
    const horizonStats = { long: 0, mid: 0, short: 0 }
    let globalTotalInvested = 0
    trades.forEach(t => {
      const pName = (t.portfolios?.name || '').toLowerCase()
      const inv   = openInvested(t)
      globalTotalInvested += inv
      if (pName.includes('largo'))      horizonStats.long  += inv
      else if (pName.includes('media')) horizonStats.mid   += inv
      else                              horizonStats.short += inv
    })
    const hp = (v: number) => globalTotalInvested > 0 ? parseFloat((v / globalTotalInvested * 100).toFixed(1)) : 0
    const horizonData = [
      { name: 'Largo plazo (>10a)',   value: horizonStats.long,  pct: hp(horizonStats.long),  color: C.success },
      { name: 'Mediano plazo (1-5a)', value: horizonStats.mid,   pct: hp(horizonStats.mid),   color: C.warning },
      { name: 'Corto / Especulativo', value: horizonStats.short, pct: hp(horizonStats.short), color: C.danger  },
    ]

    // Distribución por sector / país (dona)
    const toDist = (m: Record<string, number>) => Object.entries(m)
      .map(([name, value]) => ({ name, value: r2(value), pct: totalInvested > 0 ? parseFloat((value / totalInvested * 100).toFixed(1)) : 0 }))
      .sort((a, b) => b.value - a.value)
    const sectorMap: Record<string, number> = {}
    const countryMap: Record<string, number> = {}
    withPnl.forEach(t => {
      sectorMap[t.sectorN] = (sectorMap[t.sectorN] || 0) + t.invested
      const c = String(t.country || '').trim() || 'Otros'
      countryMap[c] = (countryMap[c] || 0) + t.invested
    })
    const sectorData  = toDist(sectorMap)
    const countryData = toDist(countryMap)

    const winningTrades = withPnl.filter(t => t.pnl > 0).length
    const losingTrades  = withPnl.filter(t => t.pnl < 0).length
    const topGains  = withPnl.filter(t => t.pnl > 0).sort((a, b) => b.pnl - a.pnl).slice(0, 5)
    const topLosses = withPnl.filter(t => t.pnl < 0).sort((a, b) => a.pnl - b.pnl).slice(0, 5)

    // PnL no realizado por sector
    const sectorPnlMap: Record<string, { pnl: number; invested: number; count: number }> = {}
    withPnl.forEach(t => {
      const d = (sectorPnlMap[t.sectorN] ||= { pnl: 0, invested: 0, count: 0 })
      d.pnl += t.pnl; d.invested += t.invested; d.count += 1
    })
    const sectorPnlData = Object.entries(sectorPnlMap)
      .map(([sector, d]) => ({
        sector, pnl: r2(d.pnl),
        pct: d.invested > 0 ? r2(d.pnl / d.invested * 100) : 0,
        count: d.count,
      }))
      .sort((a, b) => b.pnl - a.pnl)

    // Mapa de calor — agrupado por sector, tamaño = valor actual, color = % no realizado
    const heatmapBySector: Record<string, { name: string; size: number; pnlPct: number }[]> = {}
    withPnl.forEach(t => {
      ;(heatmapBySector[t.sectorN] ||= []).push({
        name: t.ticker,
        size: t.value > 0 ? r2(t.value) : 0.01,
        pnlPct: t.pnlPct,
      })
    })
    const heatmapData = Object.entries(heatmapBySector).map(([sector, children]) => ({ name: sector, children }))

    // Tiempo en posición (mismo cálculo para el gráfico y el promedio: días completos)
    const nowMs = Date.now()
    const daysOf = (t: any) => {
      const k = dayKey(t.open_date)
      return DAY_RE.test(k) ? Math.max(0, Math.floor((nowMs - dayMs(k)) / 86400000)) : null
    }
    const daysInPosition = withPnl
      .map(t => ({ ticker: t.ticker, days: daysOf(t), pnlPct: t.pnlPct, color: t.pnlPct >= 0 ? C.success : C.danger }))
      .filter((d): d is { ticker: string; days: number; pnlPct: number; color: string } => d.days !== null)
      .sort((a, b) => b.days - a.days)
    const avgDuration = daysInPosition.length
      ? daysInPosition.reduce((a, d) => a + d.days, 0) / daysInPosition.length
      : 0

    // R/R promedio (solo si hay SL y TP válidos)
    const rrList = withPnl
      .map(t => {
        const e = Number(t.entry_price), sl = Number(t.stop_loss), tp = Number(t.take_profit_1)
        if (!(e > 0) || !(sl > 0) || !(tp > 0)) return null
        const risk = Math.abs(e - sl), reward = Math.abs(tp - e)
        return risk > 0 ? reward / risk : null
      })
      .filter((x): x is number => x !== null)
    const avgRR = rrList.length ? rrList.reduce((a, b) => a + b, 0) / rrList.length : 0

    // ── Curva "tu portafolio vs haber comprado S&P 500" ───────────────────
    // Antes la línea del portafolio era capital aportado acumulado (crecía con cada compra aunque
    // no ganaras nada), así que no era comparable con el S&P. Ahora, para los trades abiertos hasta cada fecha:
    //   portafolio = valor actual / costo − 1
    //   S&P        = lo que valdrían hoy esos mismos importes si se hubieran puesto en el S&P ese día − 1
    const { dates, closes } = spSeries
    const spAt = (k: string): number | null => {
      let lo = 0, hi = dates.length - 1, idx = -1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (dates[mid] <= k) { idx = mid; lo = mid + 1 } else hi = mid - 1
      }
      return idx >= 0 ? closes[idx] : null
    }
    const spLast = closes.length ? closes[closes.length - 1] : null

    const todayD = new Date()
    let cutoffKey: string | null = null
    if (range === 'YTD') cutoffKey = `${todayD.getFullYear()}-01-01`
    else if (range === '1Y') cutoffKey = localDayKey(new Date(todayD.getFullYear() - 1, todayD.getMonth(), todayD.getDate()))
    else if (range === '5Y') cutoffKey = localDayKey(new Date(todayD.getFullYear() - 5, todayD.getMonth(), todayD.getDate()))

    const byDate = [...withPnl]
      .filter(t => DAY_RE.test(dayKey(t.open_date)))
      .sort((a, b) => dayKey(a.open_date).localeCompare(dayKey(b.open_date)))
      .filter(t => !cutoffKey || dayKey(t.open_date) >= cutoffKey)

    const vsData: { date: string; dateStr: string; portfolio: number; sp500: number }[] = []
    if (spLast) {
      let cumInv = 0, cumCur = 0, spUnits = 0
      byDate.forEach(t => {
        const k = dayKey(t.open_date)
        const sp = spAt(k)
        if (!sp || t.invested <= 0) return
        cumInv += t.invested; cumCur += t.value; spUnits += t.invested / sp
        const point = {
          date: new Date(k + 'T00:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: '2-digit' }),
          dateStr: k,
          portfolio: r2((cumCur / cumInv - 1) * 100),
          sp500: r2((spUnits * spLast / cumInv - 1) * 100),
        }
        // varios trades el mismo día → un solo punto (el acumulado final del día)
        if (vsData.length && vsData[vsData.length - 1].dateStr === k) vsData[vsData.length - 1] = point
        else vsData.push(point)
      })
    }

    return {
      totalInvested, totalCurrent, totalPnL, totalPnLPct,
      winningTrades, losingTrades, totalCount: filteredTrades.length,
      horizonData, sectorData, countryData, sectorPnlData, heatmapData,
      topGains, topLosses, daysInPosition, vsData,
      avgDuration: parseFloat(avgDuration.toFixed(1)),
      avgRR: parseFloat(avgRR.toFixed(2)),
      rrCount: rrList.length,
    }
  }, [filteredTrades, trades, spSeries, range])

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

        {loadError && (
          <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 10, fontSize: 12, background: 'rgba(244,63,94,0.06)', border: '1px solid rgba(244,63,94,0.25)', color: C.danger }}>
            No se pudieron cargar los datos ({loadError}). Recarga la página.
          </div>
        )}

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

            {/* ══ FILA 2 — CURVA PORTAFOLIO vs S&P 500 ══ */}
            <ChartCard
              title="Portafolio vs haber comprado S&P 500"
              sub="Por cada fecha de apertura: rendimiento actual de tus trades abiertos hasta ese día vs. lo que rendirían esos mismos importes si se hubieran invertido en el S&P 500 ese día"
              headerRight={
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['YTD','1Y','5Y','MAX'] as RangeKey[]).map(r => (
                    <button key={r} onClick={() => setRange(r)} style={rangeBtn(range === r)}>{r}</button>
                  ))}
                </div>
              }
            >
              {stats.vsData.length > 1 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={stats.vsData} margin={{ top: 4, right: 10, left: 0, bottom: 4 }}>
                    <CartesianGrid stroke="#151515" vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fill: '#aaa', fontSize: 9 }} axisLine={false} tickLine={false} minTickGap={24} />
                    <YAxis tick={{ fill: '#888', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
                    <Tooltip content={<CustomTooltip formatter={(v: number) => `${v > 0 ? '+' : ''}${Number(v).toFixed(2)}%`} />} />
                    <ReferenceLine y={0} stroke="#333" strokeDasharray="3 3" />
                    <Line type="monotone" dataKey="portfolio" name="Portafolio" stroke={C.accent} strokeWidth={2.5} dot={false} />
                    <Line type="monotone" dataKey="sp500"     name="S&P 500"   stroke={C.sp500} strokeWidth={2}   dot={false} strokeDasharray="6 3" />
                    <Legend formatter={(value) => <span style={{ color: '#aaa', fontSize: 10 }}>{value}</span>} wrapperStyle={{ paddingTop: 8 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart
                  message={spSeries.dates.length === 0
                    ? 'Sin datos del S&P 500 en caché — abre Inicio una vez para cargarlos'
                    : 'No hay suficientes trades con fecha en este rango'}
                  height={260}
                />
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
                        <tr key={t.id ?? t.ticker} style={{ borderBottom: '1px solid #111' }}>
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
                        <tr key={t.id ?? t.ticker} style={{ borderBottom: '1px solid #111' }}>
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
                    {(() => {
                      const maxAbs = Math.max(...stats.sectorPnlData.map(d => Math.abs(d.pnl)))
                      return stats.sectorPnlData.map(s => {
                        const width = maxAbs > 0 ? Math.abs(s.pnl) / maxAbs * 100 : 0
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
                      })
                    })()}
                  </div>
                )}
              </div>
            </div>

            {/* ══ FILA 4 — TIEMPO EN POSICIÓN / HORIZONTE / SECTOR / PAÍS ══ */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              <ChartCard title="Tiempo en posición" sub="Días desde apertura">
                {stats.daysInPosition.length > 0 ? (
                  <ResponsiveContainer width="100%" height={Math.max(180, Math.min(stats.daysInPosition.length * 26, 320))}>
                    <BarChart data={stats.daysInPosition} layout="vertical" margin={{ top: 4, right: 30, left: 6, bottom: 4 }}>
                      <CartesianGrid stroke="#151515" horizontal={false} strokeDasharray="3 3" />
                      <XAxis type="number" tick={{ fill: '#888', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `${v}d`} />
                      <YAxis type="category" dataKey="ticker" tick={{ fill: '#aaa', fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} width={46} />
                      <Tooltip content={<CustomTooltip formatter={(v: number) => `${v} días`} />} />
                      <Bar dataKey="days" name="Días" radius={[0, 6, 6, 0]}>
                        {stats.daysInPosition.map((e, i) => <Cell key={i} fill={e.color} fillOpacity={0.8} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : <EmptyChart message="Sin trades abiertos" height={180} />}
              </ChartCard>

              <DonutCard title="Horizonte por billetera" data={stats.horizonData} money={money} colorOf={(d: any) => d.color} />
              <DonutCard title="Distribución por sector" data={stats.sectorData} money={money} />
              <DonutCard title="Distribución por país"   data={stats.countryData} money={money} />
            </div>

            {/* ══ FILA 5 — MAPA DE CALOR POR SECTOR ══ */}
            <ChartCard
              title="Mapa de calor — posiciones por sector"
              sub="Tamaño = valor actual en $ · color = % de ganancia/pérdida no realizada (verde = gana, rojo = pierde)"
            >
              {stats.heatmapData.length > 0 ? (
                <ResponsiveContainer width="100%" height={420}>
                  <Treemap
                    data={stats.heatmapData}
                    dataKey="size"
                    aspectRatio={4 / 3}
                    stroke="#050505"
                    content={<HeatmapCell money={money} />}
                  />
                </ResponsiveContainer>
              ) : <EmptyChart message="Sin posiciones abiertas" height={300} />}
            </ChartCard>

          </div>
        )}
      </div>
    </AppShell>
  )
}

// ── Subcomponentes ──────────────────────────────────────────────────────
// Dona + leyenda (antes el mismo bloque estaba copiado tres veces)
function DonutCard({ title, data, money, colorOf }: { title: string; data: any[]; money: (n: number) => string; colorOf?: (d: any) => string }) {
  const col = (d: any, i: number) => colorOf ? colorOf(d) : PIE_COLORS[i % PIE_COLORS.length]
  return (
    <ChartCard title={title}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <ResponsiveContainer width={160} height={160}>
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius={44} outerRadius={70} paddingAngle={3} dataKey="value">
              {data.map((d, i) => <Cell key={i} fill={col(d, i)} stroke="none" />)}
            </Pie>
            <Tooltip content={<CustomTooltip formatter={(v: number) => money(v)} />} />
          </PieChart>
        </ResponsiveContainer>
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 110, overflowY: 'auto' }}>
          {data.map((s, i) => (
            <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
              <span style={{ color: '#aaa', display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: col(s, i), display: 'inline-block' }} />
                {s.name}
              </span>
              <span style={{ fontWeight: 700, color: colorOf ? col(s, i) : '#fff' }}>{s.pct}%</span>
            </div>
          ))}
        </div>
      </div>
    </ChartCard>
  )
}

function HeatmapCell(props: any) {
  const { x, y, width, height, name, pnlPct, size, depth, money } = props

  // Nivel 1 = Sector
  if (depth === 1) {
    return (
      <g>
        <rect x={x} y={y} width={width} height={height}
          style={{ fill: '#090909', stroke: '#222222', strokeWidth: 1.5, rx: 4 }} />
        {width > 60 && height > 18 && (
          <text x={x + 6} y={y + 14} fontSize={10} fill="#00bfff" fontWeight={800}
            style={{ textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {name}
          </text>
        )}
      </g>
    )
  }

  // Nivel 2 = Posición individual
  const pct = Number(pnlPct ?? 0)
  const fill = heatColor(pct)
  const valueTxt = money ? money(Number(size || 0)) : ''
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} style={{ fill, stroke: '#080808', strokeWidth: 1 }} />
      <title>{`${name}: ${valueTxt} · ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`}</title>
      {width > 36 && height > 22 && (
        <>
          <text x={x + width / 2} y={y + height / 2 - 4} textAnchor="middle"
            fontSize={11} fontWeight={900} fill="#ffffff" stroke="#000000" strokeWidth={0.5}>
            {name}
          </text>
          <text x={x + width / 2} y={y + height / 2 + 10} textAnchor="middle"
            fontSize={9} fontWeight={800} fill="#ffffff" stroke="#000000" strokeWidth={0.4}>
            {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
          </text>
        </>
      )}
    </g>
  )
}

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
          {sub && <div style={{ fontSize: 9, color: '#555', marginTop: 3, maxWidth: 760 }}>{sub}</div>}
        </div>
        {headerRight}
      </div>
      {children}
    </div>
  )
}

function EmptyChart({ message, height = 200 }: { message: string, height?: number }) {
  return (
    <div style={{ height, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#444', fontSize: 11, border: '1px dashed #1a1a1a', borderRadius: 8, gap: 8, textAlign: 'center', padding: '0 16px' }}>
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