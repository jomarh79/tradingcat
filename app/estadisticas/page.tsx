'use client'
import { useEffect, useMemo, useState, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, ComposedChart
} from 'recharts'
import AppShell from '../AppShell'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const parseDate = (d: string) => new Date((d || '').split('T')[0] + 'T00:00:00')
const money     = (v: number) => `$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtPct    = (v: number, d = 2) => `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`
const shares    = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 6 })

const C = {
  bg: '#070709', card: '#0a0a0c', border: '#141418',
  accent: '#00bfff', gain: '#22c55e', loss: '#f43f5e',
  gold: '#eab308', purple: '#a78bfa', text: '#e2e8f0',
  muted: '#64748b', dim: '#0f0f12',
}

const SECTOR_COLORS = ['#00bfff','#a78bfa','#22c55e','#eab308','#f472b6','#fb923c','#34d399','#f43f5e','#60a5fa','#c084fc']

const Paw = ({ size = 12, color = '#555', opacity = 1 }: any) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} opacity={opacity} style={{ flexShrink: 0 }}>
    <ellipse cx="12" cy="17" rx="5" ry="4" /><ellipse cx="6" cy="12" rx="2.5" ry="3" /><ellipse cx="18" cy="12" rx="2.5" ry="3" /><ellipse cx="9" cy="8" rx="2" ry="2.5" /><ellipse cx="15" cy="8" rx="2" ry="2.5" />
  </svg>
)

const card: React.CSSProperties = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px' }
const cardLabel: React.CSSProperties = { fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase' as const }

export default function AbiertosUnificado() {
  const [trades,          setTrades]          = useState<any[]>([])
  const [allTrades,       setAllTrades]       = useState<any[]>([])
  const [portfolios,      setPortfolios]      = useState<any[]>([])
  const [sp500Data,       setSp500Data]       = useState<{ date: string; close: number }[]>([])
  const [loading,         setLoading]         = useState(true)
  const [selectedPortfolio, setSelectedPortfolio] = useState('all')
  const [equityPeriod,    setEquityPeriod]    = useState<'YTD'|'1Y'|'5Y'|'MAX'>('YTD')
  const [tickerSearch,    setTickerSearch]    = useState('')
  const [hideValues,      setHideValues]      = useState(false)
  const [sortKey,         setSortKey]         = useState<string>('pnlPct')
  const [sortDir,         setSortDir]         = useState<'asc'|'desc'>('desc')

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }

      const [{ data: tData, error: tErr }, { data: pData, error: pErr }, { data: aData }] = await Promise.all([
        supabase.from('trades').select('*, trade_executions(quantity, price, commission, execution_type)')
          .eq('user_id', user.id).eq('status', 'open'),
        supabase.from('portfolios').select('id, name, grupo').eq('user_id', user.id),
        supabase.from('trades').select('id, portfolio_id, open_date, realized_pnl, status, total_invested, last_price, entry_price, quantity')
          .eq('user_id', user.id),
      ])
      if (tErr) console.error('trades error:', tErr)
      if (pErr) console.error('portfolios error:', pErr)
      setTrades(tData || [])
      setAllTrades(aData || [])
      setPortfolios(pData || [])

      try {
        const cached = localStorage.getItem('sp500')
        if (cached) setSp500Data(JSON.parse(cached))
      } catch (e) { console.error('SP500 cache:', e) }
    } catch (err) {
      console.error('fetchData error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const calcInvested = useCallback((t: any): number => {
    const ini   = Number(t.initial_entry_price || t.entry_price || 0) * Number(t.initial_quantity || t.quantity || 0)
    const extra = (t.trade_executions || [])
      .filter((e: any) => e.execution_type === 'buy')
      .reduce((a: number, e: any) => a + Number(e.quantity) * Number(e.price) + Number(e.commission || 0), 0)
    return parseFloat((ini + extra).toFixed(2))
  }, [])

  // ── Trades filtrados por portafolio ──────────────────────────────────────
  const filteredTrades = useMemo(() => {
    return selectedPortfolio === 'all'
      ? trades
      : trades.filter(t => t.portfolio_id === selectedPortfolio)
  }, [trades, selectedPortfolio])

  // ── Trades enriquecidos para tabla ───────────────────────────────────────
  const enriched = useMemo(() => {
    const now = new Date()
    const totalInvAll = filteredTrades.reduce((a, t) => a + calcInvested(t), 0)

    const base = tickerSearch
      ? filteredTrades.filter(t => t.ticker.toLowerCase().includes(tickerSearch.toLowerCase()))
      : filteredTrades

    return base.map(t => {
      const inv      = calcInvested(t)
      const qty      = Number(t.quantity || 0)
      const cur      = Number(t.last_price || t.entry_price || 0)
      const avg      = qty > 0 ? inv / qty : Number(t.entry_price || 0)
      const curVal   = cur * qty
      const pnl      = parseFloat(((cur - avg) * qty).toFixed(2))
      const pnlPct   = avg > 0 ? parseFloat(((cur - avg) / avg * 100).toFixed(2)) : 0
      const dayChg   = Number(t.day_change || 0)
      const days     = Math.floor((now.getTime() - parseDate(t.open_date).getTime()) / 86400000)
      const weight   = totalInvAll > 0 ? parseFloat((inv / totalInvAll * 100).toFixed(1)) : 0
      const weightCur= totalInvAll > 0 ? parseFloat((curVal / totalInvAll * 100).toFixed(1)) : 0
      const portName = portfolios.find(p => p.id === t.portfolio_id)?.name || '—'
      const rsi      = Number(t.rsi || 0)
      return { ...t, inv, qty, cur, avg, curVal, pnl, pnlPct, dayChg, days, weight, weightCur, portName, rsi }
    })
  }, [filteredTrades, portfolios, tickerSearch, calcInvested])

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const totalInv  = parseFloat(enriched.reduce((a, t) => a + t.inv, 0).toFixed(2))
    const totalCur  = parseFloat(enriched.reduce((a, t) => a + t.curVal, 0).toFixed(2))
    const totalPnl  = parseFloat((totalCur - totalInv).toFixed(2))
    const pnlPct    = totalInv > 0 ? parseFloat((totalPnl / totalInv * 100).toFixed(2)) : 0
    const dayPnl    = parseFloat(enriched.reduce((a, t) => a + (t.dayChg / 100 * t.curVal), 0).toFixed(2))
    const inGain    = enriched.filter(t => t.pnl > 0).length
    const gainRate  = enriched.length > 0 ? parseFloat((inGain / enriched.length * 100).toFixed(1)) : 0
    const avgDays   = enriched.length > 0 ? parseFloat((enriched.reduce((a, t) => a + t.days, 0) / enriched.length).toFixed(1)) : 0
    const rsiList   = enriched.filter(t => t.rsi > 0).map(t => t.rsi)
    const avgRsi    = rsiList.length > 0 ? parseFloat((rsiList.reduce((a: number, b: number) => a + b, 0) / rsiList.length).toFixed(1)) : 0
    return { totalInv, totalCur, totalPnl, pnlPct, dayPnl, inGain, gainRate, total: enriched.length, avgDays, avgRsi }
  }, [enriched])

  // ── Gráficas ──────────────────────────────────────────────────────────────
  const charts = useMemo(() => {
    const now = new Date()

    // ── Curva equity ─────────────────────────────────────────────────────
    const cutoffMap: Record<string, Date> = {
      YTD: new Date(now.getFullYear(), 0, 1),
      '1Y': new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()),
      '5Y': new Date(now.getFullYear() - 5, now.getMonth(), now.getDate()),
      MAX:  new Date(2000, 0, 1),
    }
    const cutoff = cutoffMap[equityPeriod]
    const sp500Map: Record<string, number> = {}
    sp500Data.forEach(d => { sp500Map[d.date] = d.close })
    const sp500Keys = Object.keys(sp500Map).sort()

    // Portafolio acumulado por fecha
    const portByDate: Record<string, number> = {}
    const portOpen = selectedPortfolio === 'all'
      ? allTrades.filter(t => t.status === 'open')
      : allTrades.filter(t => t.status === 'open' && t.portfolio_id === selectedPortfolio)
    portOpen.forEach(t => {
      const d    = t.open_date
      if (!d || parseDate(d) < cutoff) return
      const cur  = Number(t.last_price || t.entry_price || 0)
      const qty  = Number(t.quantity || 0)
      const inv  = Number(t.total_invested || 0)
      portByDate[d] = (portByDate[d] || 0) + ((cur - (qty > 0 ? inv / qty : 0)) * qty)
    })

    // SP500 base
    const sortedDates = Object.keys(portByDate).sort()
    const sp500Base   = sortedDates.length > 0
      ? sp500Map[sortedDates[0]] || sp500Keys.filter(k => k <= sortedDates[0]).slice(-1)[0]?.split('').map(() => 0).reduce((a, b) => a + b, sp500Map[sp500Keys.filter(k => k <= sortedDates[0]).slice(-1)[0]] || 0) || null
      : null
    const sp500BaseVal = sp500Base ? sp500Map[sp500Keys.filter(k => k <= sortedDates[0]).slice(-1)[0]] : null

    let cumPort = 0
    const vsData = sortedDates.map(date => {
      cumPort += portByDate[date]
      const sp500Cur    = sp500Map[date] || sp500Keys.filter(k => k <= date).slice(-1)[0] ? sp500Map[sp500Keys.filter(k => k <= date).slice(-1)[0]] : null
      const sp500Pct    = sp500BaseVal && sp500Cur ? parseFloat(((sp500Cur - sp500BaseVal) / sp500BaseVal * 100).toFixed(2)) : null
      return {
        date,
        Portafolio: parseFloat(cumPort.toFixed(2)),
        'S&P 500':  sp500Pct,
      }
    })

    // ── Horizonte ─────────────────────────────────────────────────────────
    const buckets: Record<string, number> = { 'Corto (<3m)': 0, 'Medio (3-12m)': 0, 'Largo (>1a)': 0 }
    enriched.forEach(t => {
      if (t.days < 90)       buckets['Corto (<3m)']++
      else if (t.days < 365) buckets['Medio (3-12m)']++
      else                   buckets['Largo (>1a)']++
    })
    const horizonData = Object.entries(buckets).map(([name, value]) => ({ name, value })).filter(d => d.value > 0)

    // ── Sectores dona ─────────────────────────────────────────────────────
    const sectorMap: Record<string, number> = {}
    enriched.forEach(t => { sectorMap[t.sector || 'Sin sector'] = (sectorMap[t.sector || 'Sin sector'] || 0) + t.inv })
    const totalInv = enriched.reduce((a, t) => a + t.inv, 0)
    const sectorData = Object.entries(sectorMap)
      .map(([name, val]) => ({ name, value: parseFloat(val.toFixed(2)), pct: totalInv > 0 ? parseFloat((val / totalInv * 100).toFixed(1)) : 0 }))
      .sort((a, b) => b.value - a.value)

    // ── PnL por sector ────────────────────────────────────────────────────
    const sectorPnlMap: Record<string, { pnl: number, inv: number, count: number }> = {}
    enriched.forEach(t => {
      const s = t.sector || 'Sin sector'
      if (!sectorPnlMap[s]) sectorPnlMap[s] = { pnl: 0, inv: 0, count: 0 }
      sectorPnlMap[s].pnl   += t.pnl
      sectorPnlMap[s].inv   += t.inv
      sectorPnlMap[s].count += 1
    })
    const sectorPnlData = Object.entries(sectorPnlMap)
      .map(([sector, d]) => ({
        sector, count: d.count,
        pnl:    parseFloat(d.pnl.toFixed(2)),
        pct:    d.inv > 0 ? parseFloat((d.pnl / d.inv * 100).toFixed(2)) : 0,
        color:  d.pnl >= 0 ? C.gain : C.loss,
      }))
      .sort((a, b) => b.pnl - a.pnl)

    // ── Top 5 ─────────────────────────────────────────────────────────────
    const top5Gain = [...enriched].sort((a, b) => b.pnl - a.pnl).slice(0, 5)
    const top5Loss = [...enriched].sort((a, b) => a.pnl - b.pnl).slice(0, 5)

    // ── Tiempo en posición ─────────────────────────────────────────────────
    const durationMap: Record<string, { count: number, pnl: number }> = {
      '0-30d': { count: 0, pnl: 0 }, '31-90d': { count: 0, pnl: 0 },
      '91-180d': { count: 0, pnl: 0 }, '181-365d': { count: 0, pnl: 0 }, '+1 año': { count: 0, pnl: 0 },
    }
    enriched.forEach(t => {
      const key = t.days <= 30 ? '0-30d' : t.days <= 90 ? '31-90d' : t.days <= 180 ? '91-180d' : t.days <= 365 ? '181-365d' : '+1 año'
      durationMap[key].count++
      durationMap[key].pnl += t.pnl
    })
    const durationData = Object.entries(durationMap)
      .map(([range, d]) => ({ range, count: d.count, pnl: parseFloat(d.pnl.toFixed(2)) }))
      .filter(d => d.count > 0)

    // ── Días por ticker ───────────────────────────────────────────────────
    const daysInPosition = [...enriched]
      .sort((a, b) => b.days - a.days)
      .slice(0, 20)
      .map(t => ({ ticker: t.ticker, days: t.days, pnlPct: t.pnlPct, color: t.pnl >= 0 ? C.gain : C.loss }))

    return { vsData, horizonData, sectorData, sectorPnlData, top5Gain, top5Loss, durationData, daysInPosition }
  }, [enriched, allTrades, selectedPortfolio, sp500Data, equityPeriod])

  // ── Sort tabla ────────────────────────────────────────────────────────────
  const sorted = useMemo(() => {
    return [...enriched].sort((a, b) => {
      const va = (a as any)[sortKey] ?? 0
      const vb = (b as any)[sortKey] ?? 0
      return sortDir === 'desc' ? vb - va : va - vb
    })
  }, [enriched, sortKey, sortDir])

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const hide = (v: string) => hideValues ? '••••' : v

  const PeriodSelector = () => (
    <div style={{ display: 'flex', gap: 2, background: C.dim, padding: 3, borderRadius: 8, border: `1px solid ${C.border}` }}>
      {(['YTD','1Y','5Y','MAX'] as const).map(p => (
        <button key={p} onClick={() => setEquityPeriod(p)} style={{
          background: equityPeriod === p ? '#1a1a1a' : 'transparent',
          border: equityPeriod === p ? `1px solid #2a2a2a` : '1px solid transparent',
          color: equityPeriod === p ? '#fff' : '#444',
          padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
          fontSize: 11, fontWeight: equityPeriod === p ? 700 : 400,
        }}>{p}</button>
      ))}
    </div>
  )

  const thStyle: React.CSSProperties = {
    padding: '7px 10px', fontSize: 9, color: '#555', fontWeight: 700,
    textAlign: 'left', borderBottom: `1px solid ${C.border}`,
    cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none',
  }
  const tdStyle: React.CSSProperties = {
    padding: '7px 10px', fontSize: 11, borderBottom: `1px solid #0a0a0a`, whiteSpace: 'nowrap',
  }

  if (loading) return (
    <AppShell>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: C.muted, fontSize: 13 }}>
        Cargando...
      </div>
    </AppShell>
  )

  return (
    <AppShell>
      <div style={{ padding: '16px 20px', background: C.bg, minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>

        {/* ── Header + Filtros ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <Paw size={14} color={C.accent} opacity={0.8} />
              <h1 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: C.accent }}>Trades Abiertos</h1>
            </div>
            <div style={{ fontSize: 11, color: C.muted }}>{kpis.total} posiciones · {new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              placeholder="Buscar ticker..."
              value={tickerSearch}
              onChange={e => setTickerSearch(e.target.value)}
              style={{ background: C.dim, border: `1px solid ${C.border}`, color: C.text, padding: '6px 12px', borderRadius: 8, fontSize: 11, outline: 'none', width: 140 }}
            />
            <button
              onClick={() => setSelectedPortfolio('all')}
              style={{
                padding: '6px 12px',
                borderRadius: 8,
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                background: selectedPortfolio === 'all' ? C.accent : C.dim,
                color: selectedPortfolio === 'all' ? '#000' : C.muted,
                border: `1px solid ${selectedPortfolio === 'all' ? C.accent : C.border}`,
              }}
            >
              Todos
            </button>
            {portfolios.map(p => (
              <button key={p.id} onClick={() => setSelectedPortfolio(p.id)} style={{
                padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                background: selectedPortfolio === p.id ? C.accent : C.dim,
                color: selectedPortfolio === p.id ? '#000' : C.muted,
                border: `1px solid ${selectedPortfolio === p.id ? C.accent : C.border}`,
              }}>{p.name}</button>
            ))}
            <button onClick={() => setHideValues(v => !v)} style={{
              padding: '6px 12px', borderRadius: 8, fontSize: 11, cursor: 'pointer',
              background: C.dim, color: C.muted, border: `1px solid ${C.border}`,
            }}>{hideValues ? '👁 Mostrar' : '🙈 Ocultar'}</button>
          </div>
        </div>

        {/* ── Fila 1: KPIs ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, marginBottom: 14 }}>
          {[
            { label: 'INVERTIDO',     value: hide(money(kpis.totalInv)),  color: C.text,   sub: `${kpis.total} posiciones` },
            { label: 'VALOR ACTUAL',  value: hide(money(kpis.totalCur)),  color: C.accent, sub: fmtPct(kpis.pnlPct) },
            { label: 'PnL LATENTE',   value: hide(money(kpis.totalPnl)),  color: kpis.totalPnl >= 0 ? C.gain : C.loss, sub: fmtPct(kpis.pnlPct) },
            { label: 'VARIACIÓN HOY', value: hide(money(kpis.dayPnl)),    color: kpis.dayPnl >= 0 ? C.gain : C.loss, sub: 'en cartera' },
            { label: 'EN GANANCIA',   value: `${kpis.gainRate}%`,         color: kpis.gainRate >= 60 ? C.gain : C.gold, sub: `${kpis.inGain} de ${kpis.total}` },
            { label: 'DÍAS PROMEDIO', value: `${kpis.avgDays}d`,          color: C.purple, sub: 'en posición' },
            { label: 'RSI PROMEDIO',  value: kpis.avgRsi > 0 ? `${kpis.avgRsi}` : '—', color: kpis.avgRsi > 70 ? C.loss : kpis.avgRsi < 30 ? C.gain : C.gold, sub: kpis.avgRsi > 70 ? 'sobrecomprado' : kpis.avgRsi < 30 ? 'sobrevendido' : 'zona neutral' },
          ].map(k => (
            <div key={k.label} style={{ ...card }}>
              <div style={{ ...cardLabel, marginBottom: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
                <Paw size={7} color={k.color} opacity={0.6} />{k.label}
              </div>
              <div style={{ fontSize: 16, fontWeight: 900, color: k.color, marginBottom: 2 }}>{k.value}</div>
              <div style={{ fontSize: 9, color: '#555' }}>{k.sub}</div>
            </div>
          ))}
        </div>

        {/* ── Fila 2: Tabla de posiciones ── */}
        <div style={{ ...card, marginBottom: 14, overflow: 'hidden' }}>
          <div style={{ ...cardLabel, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 5 }}>
            <Paw size={8} color={C.accent} opacity={0.6} />POSICIONES ABIERTAS
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: C.dim }}>
                  {[
                    { key: 'open_date', label: 'Fecha' },
                    { key: 'ticker',    label: 'Ticker' },
                    { key: 'dayChg',    label: 'Var día' },
                    { key: 'rsi',       label: 'RSI' },
                    { key: 'pnlPct',    label: 'PnL %' },
                    { key: 'pnl',       label: 'PnL $' },
                    { key: 'weight',    label: 'Inv/Act %' },
                    { key: 'qty',       label: 'Cant.' },
                    { key: 'avg',       label: 'Avg' },
                    { key: 'inv',       label: 'Invertido' },
                    { key: 'cur',       label: 'Precio actual' },
                    { key: 'curVal',    label: 'Valor actual' },
                  ].map(h => (
                    <th key={h.key} onClick={() => toggleSort(h.key)} style={{ ...thStyle }}>
                      {h.label}{sortKey === h.key ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map(t => (
                  <tr key={t.id}
                    style={{ background: 'transparent', transition: 'background 0.15s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#0f0f12')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <td style={{ ...tdStyle, color: '#666' }}>{parseDate(t.open_date).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: '2-digit' })}</td>
                    <td style={{ ...tdStyle }}>
                      <a href={`https://es.tradingview.com/chart/?symbol=${t.ticker}`} target="_blank" rel="noreferrer"
                        style={{ color: C.accent, fontWeight: 700, textDecoration: 'none', fontSize: 13 }}>{t.ticker}</a>
                      <div style={{ fontSize: 8, color: '#444' }}>{t.portName}</div>
                    </td>
                    <td style={{ ...tdStyle, color: t.dayChg >= 0 ? C.gain : C.loss }}>{t.dayChg >= 0 ? '+' : ''}{t.dayChg.toFixed(2)}%</td>
                    <td style={{ ...tdStyle, color: t.rsi > 70 ? C.loss : t.rsi < 30 ? C.gain : C.muted }}>
                      {t.rsi > 0 ? t.rsi.toFixed(0) : '—'}
                    </td>
                    <td style={{ ...tdStyle, color: t.pnlPct >= 0 ? C.gain : C.loss, fontWeight: 700 }}>{fmtPct(t.pnlPct)}</td>
                    <td style={{ ...tdStyle, color: t.pnl >= 0 ? C.gain : C.loss }}>{hide(money(t.pnl))}</td>
                    <td style={{ ...tdStyle }}>
                      <span style={{ color: '#888' }}>{t.weight.toFixed(1)}</span>
                      <span style={{ color: '#444', margin: '0 2px' }}>/</span>
                      <span style={{ color: t.weightCur > t.weight ? C.gain : t.weightCur < t.weight ? C.loss : '#666' }}>{t.weightCur.toFixed(1)}</span>
                      <span style={{ fontSize: 9, color: '#444' }}>%</span>
                    </td>
                    <td style={{ ...tdStyle, color: '#888' }}>{shares(t.qty)}</td>
                    <td style={{ ...tdStyle, color: '#888' }}>{hide(money(t.avg))}</td>
                    <td style={{ ...tdStyle, color: '#888' }}>{hide(money(t.inv))}</td>
                    <td style={{ ...tdStyle, color: C.text }}>{hide(money(t.cur))}</td>
                    <td style={{ ...tdStyle, color: t.pnl >= 0 ? C.gain : C.loss }}>{hide(money(t.curVal))}</td>
                  </tr>
                ))}
                {sorted.length === 0 && (
                  <tr><td colSpan={12} style={{ ...tdStyle, textAlign: 'center', color: '#333', padding: 24 }}>Sin posiciones</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Fila 3: Curva equity + SP500 ── */}
        <div style={{ ...card, marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Paw size={9} color={C.accent} opacity={0.6} />
              <div>
                <div style={{ ...cardLabel }}>CRECIMIENTO % VS S&P 500</div>
                <div style={{ fontSize: 9, color: '#555', marginTop: 2 }}>PnL acumulado del portafolio vs benchmark</div>
              </div>
            </div>
            <PeriodSelector />
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={charts.vsData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#111" vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fill: C.muted, fontSize: 8 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: C.muted, fontSize: 8 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `$${v}`} width={40} />
              <Tooltip
                contentStyle={{ background: C.dim, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11 }}
                formatter={(v: number | undefined, name: string | undefined) => [name === 'S&P 500' ? `${(v || 0).toFixed(2)}%` : money(v || 0), name || '']}
              />
              <ReferenceLine y={0} stroke="#333" strokeDasharray="4 4" />
              <Line type="monotone" dataKey="Portafolio" stroke={C.gain} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="S&P 500" stroke="#60a5fa" strokeWidth={2} dot={false} strokeDasharray="4 4" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* ── Fila 4: Top 5 ganancias + Top 5 pérdidas + PnL por sector ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>

          <div style={{ ...card }}>
            <div style={{ ...cardLabel, color: C.gain, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 5 }}>
              <Paw size={8} color={C.gain} opacity={0.7} />🏆 TOP 5 GANANCIAS
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {charts.top5Gain.map((t, i) => (
                <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${C.border}`, paddingBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 9, color: '#444', minWidth: 14 }}>{i + 1}</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{t.ticker}</div>
                      <div style={{ fontSize: 8, color: '#555' }}>{t.days}d · RSI {t.rsi > 0 ? t.rsi.toFixed(0) : '—'}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 15, fontWeight: 900, color: C.gain }}>{fmtPct(t.pnlPct)}</div>
                    <div style={{ fontSize: 9, color: C.gain, opacity: 0.7 }}>{hide(money(t.pnl))}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ ...card }}>
            <div style={{ ...cardLabel, color: C.loss, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 5 }}>
              <Paw size={8} color={C.loss} opacity={0.7} />⚠️ TOP 5 PÉRDIDAS
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {charts.top5Loss.map((t, i) => (
                <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${C.border}`, paddingBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 9, color: '#444', minWidth: 14 }}>{i + 1}</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{t.ticker}</div>
                      <div style={{ fontSize: 8, color: '#555' }}>{t.days}d · RSI {t.rsi > 0 ? t.rsi.toFixed(0) : '—'}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 15, fontWeight: 900, color: C.loss }}>{fmtPct(t.pnlPct)}</div>
                    <div style={{ fontSize: 9, color: C.loss, opacity: 0.7 }}>{hide(money(t.pnl))}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ ...card }}>
            <div style={{ ...cardLabel, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 5 }}>
              <Paw size={8} color={C.purple} opacity={0.6} />PnL LATENTE POR SECTOR
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {charts.sectorPnlData.slice(0, 5).map(s => {
                const maxAbs = Math.max(...charts.sectorPnlData.map(x => Math.abs(x.pnl)), 1)
                const width  = Math.abs(s.pnl) / maxAbs * 100
                return (
                  <div key={s.sector}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                      <span style={{ fontSize: 10, color: C.muted }}>{s.sector} <span style={{ color: '#444', fontSize: 8 }}>({s.count})</span></span>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: s.color }}>{fmtPct(s.pct)}</span>
                        <span style={{ fontSize: 9, color: s.color, opacity: 0.7, marginLeft: 6 }}>{hide(money(s.pnl))}</span>
                      </div>
                    </div>
                    <div style={{ height: 3, background: C.dim, borderRadius: 2 }}>
                      <div style={{ width: `${width}%`, height: '100%', background: s.color, borderRadius: 2, opacity: 0.8 }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* ── Fila 5: Tiempo en posición + Horizonte + Sector dona ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '0.8fr 1fr 1.2fr', gap: 12 }}>

          <div style={{ ...card }}>
            <div style={{ ...cardLabel, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 5 }}>
              <Paw size={8} color={C.gold} opacity={0.6} />TIEMPO EN POSICIÓN
            </div>
            <div style={{ textAlign: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 9, color: '#555', marginBottom: 3 }}>Promedio</div>
              <div style={{ fontSize: 28, fontWeight: 900, color: C.accent }}>{kpis.avgDays}</div>
              <div style={{ fontSize: 9, color: C.muted }}>días</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {charts.durationData.map(d => (
                <div key={d.range} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${C.border}`, paddingBottom: 6 }}>
                  <span style={{ fontSize: 10, color: C.muted }}>{d.range}</span>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <span style={{ fontSize: 11, color: C.text, fontWeight: 700 }}>{d.count}</span>
                    <span style={{ fontSize: 10, color: d.pnl >= 0 ? C.gain : C.loss }}>{hide(money(d.pnl))}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ ...card }}>
            <div style={{ ...cardLabel, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 5 }}>
              <Paw size={8} color={C.accent} opacity={0.6} />DÍAS POR TICKER
            </div>
            <ResponsiveContainer width="100%" height={Math.max(180, charts.daysInPosition.length * 22)}>
              <BarChart data={charts.daysInPosition} layout="vertical" margin={{ top: 0, right: 40, left: 8, bottom: 0 }}>
                <CartesianGrid stroke="#111" horizontal={false} strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fill: C.muted, fontSize: 8 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}d`} />
                <YAxis type="category" dataKey="ticker" tick={{ fill: C.muted, fontSize: 9, fontWeight: 700 }} axisLine={false} tickLine={false} width={44} />
                <Tooltip
                  contentStyle={{ background: C.dim, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11 }}
                  formatter={(v: number | undefined) => [`${v} días`, 'Tiempo']}
                />
                <Bar dataKey="days" name="Días" radius={[0, 4, 4, 0]}>
                  {charts.daysInPosition.map((d, i) => <Cell key={i} fill={d.pnlPct >= 0 ? C.gain : C.loss} fillOpacity={0.75} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={{ ...card }}>
            <div style={{ ...cardLabel, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 5 }}>
              <Paw size={8} color={C.purple} opacity={0.6} />DISTRIBUCIÓN POR SECTOR
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={charts.sectorData} cx="50%" cy="50%" innerRadius={40} outerRadius={65} paddingAngle={3} dataKey="value">
                    {charts.sectorData.map((_, i) => <Cell key={i} fill={SECTOR_COLORS[i % SECTOR_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: C.dim, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11 }}
                    formatter={(v: number | undefined) => [hide(money(v || 0)), 'Invertido']} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, justifyContent: 'center' }}>
                {charts.sectorData.slice(0, 7).map((s, i) => (
                  <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 9, color: C.muted }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: SECTOR_COLORS[i % SECTOR_COLORS.length], display: 'inline-block' }} />
                      {s.name}
                    </span>
                    <span style={{ fontSize: 9, color: SECTOR_COLORS[i % SECTOR_COLORS.length], fontWeight: 700 }}>{s.pct}%</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Horizonte */}
            <div style={{ marginTop: 12, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
              <div style={{ ...cardLabel, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
                <Paw size={7} color={C.muted} opacity={0.6} />HORIZONTE DE INVERSIÓN
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {charts.horizonData.map((h, i) => {
                  const colors = [C.gain, C.gold, C.accent]
                  const total  = charts.horizonData.reduce((a, x) => a + x.value, 0)
                  const pct    = total > 0 ? Math.round(h.value / total * 100) : 0
                  return (
                    <div key={h.name} style={{ flex: 1, background: C.dim, borderRadius: 8, padding: '8px 10px', textAlign: 'center', border: `1px solid ${C.border}` }}>
                      <div style={{ fontSize: 18, fontWeight: 900, color: colors[i] }}>{h.value}</div>
                      <div style={{ fontSize: 8, color: C.muted, marginTop: 2 }}>{h.name}</div>
                      <div style={{ fontSize: 9, color: colors[i], opacity: 0.7 }}>{pct}%</div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>

      </div>
    </AppShell>
  )
}