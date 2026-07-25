'use client'
import { useEffect, useMemo, useState, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, AreaChart, Area } from 'recharts'
import AppShell from '../AppShell'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const parseDate = (d: string) => new Date((d || '').split('T')[0] + 'T00:00:00')
const money     = (v: number) => `$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtPct    = (v: number, decimals = 2) => `${v >= 0 ? '+' : ''}${v.toFixed(decimals)}%`

const C = {
  bg:     '#070709',
  card:   '#0a0a0c',
  border: '#141418',
  accent: '#00bfff',
  gain:   '#22c55e',
  loss:   '#f43f5e',
  gold:   '#eab308',
  purple: '#a78bfa',
  text:   '#e2e8f0',
  muted:  '#64748b',
  dim:    '#0f0f12',
}

const SECTOR_COLORS = ['#00bfff','#a78bfa','#22c55e','#eab308','#f472b6','#fb923c','#34d399','#f43f5e','#60a5fa','#c084fc']

export default function InformeAbiertos() {
  const [trades,       setTrades]       = useState<any[]>([])
  const [portfolios,   setPortfolios]   = useState<any[]>([])
  const [loading,      setLoading]      = useState(true)
  const [filterWallet, setFilterWallet] = useState('all')

  const fetchData = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    const [{ data: tData }, { data: pData }] = await Promise.all([
      supabase.from('trades')
        .select('*, trade_executions(quantity, price, commission, execution_type), portfolios(name, id)')
        .eq('user_id', user.id)
        .eq('status', 'open'),
      supabase.from('portfolios').select('id, name, grupo').eq('user_id', user.id),
    ])

    setTrades(tData || [])
    setPortfolios(pData || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const calcInvested = useCallback((t: any): number => {
    const initialInv = Number(t.initial_entry_price || t.entry_price || 0) * Number(t.initial_quantity || t.quantity || 0)
    const buyExtra   = (t.trade_executions || [])
      .filter((e: any) => e.execution_type === 'buy')
      .reduce((a: number, e: any) => a + Number(e.quantity) * Number(e.price) + Number(e.commission || 0), 0)
    return parseFloat((initialInv + buyExtra).toFixed(2))
  }, [])

  const filtered = useMemo(() => {
    return trades.filter(t => filterWallet === 'all' || t.portfolio_id === filterWallet)
  }, [trades, filterWallet])

  const stats = useMemo(() => {
    if (!filtered.length) return null
    const now = new Date()

    const tradesWithCalc = filtered.map(t => {
      const inv      = calcInvested(t)
      const qty      = Number(t.quantity || 0)
      const cur      = Number(t.last_price || t.entry_price || 0)
      const avg      = qty > 0 ? inv / qty : Number(t.entry_price || 0)
      const curValue = cur * qty
      const pnl      = parseFloat(((cur - avg) * qty).toFixed(2))
      const pnlPct   = avg > 0 ? parseFloat(((cur - avg) / avg * 100).toFixed(2)) : 0
      const dayChg   = Number(t.day_change || 0)
      const days     = Math.floor((now.getTime() - parseDate(t.open_date).getTime()) / 86400000)
      const rsi      = Number(t.rsi || 0)
      return { ...t, inv, qty, cur, avg, curValue, pnl, pnlPct, dayChg, days, rsi }
    })

    // ── KPIs ─────────────────────────────────────────────────────────────
    const totalInv    = parseFloat(tradesWithCalc.reduce((a, t) => a + t.inv, 0).toFixed(2))
    const totalCurVal = parseFloat(tradesWithCalc.reduce((a, t) => a + t.curValue, 0).toFixed(2))
    const totalPnl    = parseFloat(tradesWithCalc.reduce((a, t) => a + t.pnl, 0).toFixed(2))
    const totalPnlPct = totalInv > 0 ? parseFloat((totalPnl / totalInv * 100).toFixed(2)) : 0
    const total       = tradesWithCalc.length
    const inGain      = tradesWithCalc.filter(t => t.pnl > 0).length
    const inLoss      = tradesWithCalc.filter(t => t.pnl < 0).length
    const gainRate    = total > 0 ? parseFloat((inGain / total * 100).toFixed(1)) : 0
    const avgDays     = parseFloat((tradesWithCalc.reduce((a, t) => a + t.days, 0) / total).toFixed(1))
    const avgRsi      = tradesWithCalc.filter(t => t.rsi > 0).length > 0
      ? parseFloat((tradesWithCalc.filter(t => t.rsi > 0).reduce((a, t) => a + t.rsi, 0) / tradesWithCalc.filter(t => t.rsi > 0).length).toFixed(1))
      : 0
    const dayPnl      = parseFloat(tradesWithCalc.reduce((a, t) => a + (t.dayChg / 100 * t.curValue), 0).toFixed(2))

    // ── Mejor y peor posición ─────────────────────────────────────────────
    const byPnl      = [...tradesWithCalc].sort((a, b) => b.pnl - a.pnl)
    const top5Best   = byPnl.slice(0, 5)
    const top5Worst  = byPnl.slice(-5).reverse()
    const bestTrade  = top5Best[0]
    const worstTrade = top5Worst[0]

    // ── Por sector ────────────────────────────────────────────────────────
    const sectorMap: Record<string, { inv: number, curVal: number, pnl: number, count: number }> = {}
    tradesWithCalc.forEach(t => {
      const s = t.sector || 'Sin sector'
      if (!sectorMap[s]) sectorMap[s] = { inv: 0, curVal: 0, pnl: 0, count: 0 }
      sectorMap[s].inv    += t.inv
      sectorMap[s].curVal += t.curValue
      sectorMap[s].pnl    += t.pnl
      sectorMap[s].count  += 1
    })
    const sectorData = Object.entries(sectorMap)
      .map(([sector, d]) => ({
        sector,
        pnl:    parseFloat(d.pnl.toFixed(2)),
        inv:    parseFloat(d.inv.toFixed(2)),
        weight: totalInv > 0 ? parseFloat((d.inv / totalInv * 100).toFixed(1)) : 0,
        count:  d.count,
      }))
      .sort((a, b) => b.inv - a.inv)

    // ── Tiempo en posición por rango ──────────────────────────────────────
    const durationMap: Record<string, { count: number, pnl: number }> = {
      '0-30d':   { count: 0, pnl: 0 },
      '31-90d':  { count: 0, pnl: 0 },
      '91-180d': { count: 0, pnl: 0 },
      '181-365d':{ count: 0, pnl: 0 },
      '+1 año':  { count: 0, pnl: 0 },
    }
    tradesWithCalc.forEach(t => {
      const key = t.days <= 30 ? '0-30d' : t.days <= 90 ? '31-90d' : t.days <= 180 ? '91-180d' : t.days <= 365 ? '181-365d' : '+1 año'
      durationMap[key].count++
      durationMap[key].pnl += t.pnl
    })
    const durationData = Object.entries(durationMap)
      .map(([range, d]) => ({ range, count: d.count, pnl: parseFloat(d.pnl.toFixed(2)) }))
      .filter(d => d.count > 0)

    // ── RSI distribution ──────────────────────────────────────────────────
    const rsiData = [
      { label: 'Sobrevendido (<30)', count: tradesWithCalc.filter(t => t.rsi > 0 && t.rsi < 30).length, color: C.gain },
      { label: 'Neutral (30-70)',    count: tradesWithCalc.filter(t => t.rsi >= 30 && t.rsi <= 70).length, color: C.gold },
      { label: 'Sobrecomprado (>70)',count: tradesWithCalc.filter(t => t.rsi > 70).length, color: C.loss },
      { label: 'Sin RSI',            count: tradesWithCalc.filter(t => !t.rsi || t.rsi === 0).length, color: '#333' },
    ].filter(d => d.count > 0)

    // ── Variación del día por posición ────────────────────────────────────
    const dayData = [...tradesWithCalc]
      .sort((a, b) => b.dayChg - a.dayChg)
      .map(t => ({ ticker: t.ticker, dayChg: t.dayChg, pnl: t.pnl }))

    // ── Portfolio Score ───────────────────────────────────────────────────
    const scoreGainRate   = Math.min(gainRate, 100)
    const scoreDiversif   = Math.min((sectorData.length / 8) * 100, 100)
    const scoreRetorno    = Math.min(Math.max((totalPnlPct + 20) * 2.5, 0), 100)
    const scoreRsi        = avgRsi > 0
      ? avgRsi >= 30 && avgRsi <= 60 ? 100 : avgRsi < 30 || avgRsi > 70 ? 40 : 70
      : 50
    const scoreTiempo     = avgDays <= 180 ? 100 : avgDays <= 365 ? 70 : 40
    const portfolioScore  = Math.round(
      scoreGainRate * 0.30 +
      scoreDiversif * 0.20 +
      scoreRetorno  * 0.25 +
      scoreRsi      * 0.15 +
      scoreTiempo   * 0.10
    )

    return {
      total, totalInv, totalCurVal, totalPnl, totalPnlPct,
      inGain, inLoss, gainRate, avgDays, avgRsi, dayPnl,
      bestTrade, worstTrade, top5Best, top5Worst,
      sectorData, durationData, rsiData, dayData,
      portfolioScore,
      scoreGainRate, scoreDiversif, scoreRetorno, scoreRsi, scoreTiempo,
      tradesWithCalc,
    }
  }, [filtered, calcInvested])

  const scoreColor = (s: number) => s >= 75 ? C.gain : s >= 50 ? C.gold : C.loss
  const scoreLabel = (s: number) => s >= 75 ? 'Sólido' : s >= 50 ? 'Regular' : 'Mejorable'

  const EmptyWithFilters = () => (
    <AppShell>
      <div style={{ padding: '20px 24px', background: C.bg, minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>📈 Informe ejecutivo</div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: C.accent }}>Trades Abiertos</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={() => setFilterWallet('all')} style={{
            padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer',
            background: filterWallet === 'all' ? C.accent : C.dim,
            color: filterWallet === 'all' ? '#000' : C.muted,
            border: `1px solid ${filterWallet === 'all' ? C.accent : C.border}`,
          }}>Todas</button>
          {portfolios.map(p => (
            <button key={p.id} onClick={() => setFilterWallet(p.id)} style={{
              padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer',
              background: filterWallet === p.id ? C.accent : C.dim,
              color: filterWallet === p.id ? '#000' : C.muted,
              border: `1px solid ${filterWallet === p.id ? C.accent : C.border}`,
            }}>{p.name}</button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40vh', color: C.muted, fontSize: 13 }}>
          Sin trades abiertos para el portafolio seleccionado.
        </div>
      </div>
    </AppShell>
  )

  if (loading) return (
    <AppShell>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: C.muted, fontSize: 13 }}>
        Cargando informe...
      </div>
    </AppShell>
  )

  if (!stats) return <EmptyWithFilters />

  return (
    <AppShell>
      <div style={{ padding: '20px 24px', background: C.bg, minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>

        {/* ── Header ── */}
        <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>
              📈 Informe ejecutivo
            </div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: C.accent, letterSpacing: -0.5 }}>
              Trades Abiertos
            </h1>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>
              {stats.total} posiciones · {new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })}
            </div>
          </div>
          {/* Portfolio Score */}
          <div style={{ textAlign: 'center', background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '14px 24px' }}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>PORTFOLIO SCORE</div>
            <div style={{ fontSize: 36, fontWeight: 900, color: scoreColor(stats.portfolioScore), lineHeight: 1 }}>
              {stats.portfolioScore}
            </div>
            <div style={{ fontSize: 9, color: scoreColor(stats.portfolioScore), marginTop: 4 }}>/ 100 · {scoreLabel(stats.portfolioScore)}</div>
          </div>
        </div>

        {/* ── Filtros ── */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={() => setFilterWallet('all')} style={{
            padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer',
            background: filterWallet === 'all' ? C.accent : C.dim,
            color: filterWallet === 'all' ? '#000' : C.muted,
            border: `1px solid ${filterWallet === 'all' ? C.accent : C.border}`,
          }}>Todas</button>
          {portfolios.map(p => (
            <button key={p.id} onClick={() => setFilterWallet(p.id)} style={{
              padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer',
              background: filterWallet === p.id ? C.accent : C.dim,
              color: filterWallet === p.id ? '#000' : C.muted,
              border: `1px solid ${filterWallet === p.id ? C.accent : C.border}`,
            }}>{p.name}</button>
          ))}
        </div>

        {/* ── Fila 1: KPIs ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 10, marginBottom: 16 }}>
          {[
            { label: 'CAPITAL INVERTIDO', value: money(stats.totalInv),     color: C.text,   sub: `${stats.total} posiciones` },
            { label: 'VALOR ACTUAL',      value: money(stats.totalCurVal),  color: C.accent, sub: `${fmtPct(stats.totalPnlPct)} total` },
            { label: 'PnL NO REALIZADO',  value: money(stats.totalPnl),     color: stats.totalPnl >= 0 ? C.gain : C.loss, sub: fmtPct(stats.totalPnlPct) },
            { label: 'VARIACIÓN HOY',     value: money(stats.dayPnl),       color: stats.dayPnl >= 0 ? C.gain : C.loss, sub: 'en tu cartera' },
            { label: 'EN GANANCIA',       value: `${stats.gainRate}%`,      color: stats.gainRate >= 60 ? C.gain : C.gold, sub: `${stats.inGain} de ${stats.total}` },
            { label: 'MEJOR POSICIÓN',    value: stats.bestTrade ? money(stats.bestTrade.pnl) : '—', color: C.gain, sub: stats.bestTrade?.ticker || '—' },
            { label: 'PEOR POSICIÓN',     value: stats.worstTrade ? money(stats.worstTrade.pnl) : '—', color: C.loss, sub: stats.worstTrade?.ticker || '—' },
          ].map(k => (
            <div key={k.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px' }}>
              <div style={{ fontSize: 8, color: C.muted, fontWeight: 700, letterSpacing: 0.8, marginBottom: 6 }}>{k.label}</div>
              <div style={{ fontSize: 17, fontWeight: 900, color: k.color, marginBottom: 3 }}>{k.value}</div>
              <div style={{ fontSize: 9, color: '#555' }}>{k.sub}</div>
            </div>
          ))}
        </div>

        {/* ── Fila 2: Top posiciones + Sectores + Tiempo ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 0.7fr', gap: 14, marginBottom: 16 }}>

          {/* Top 5 ganancias */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ fontSize: 9, color: C.gain, fontWeight: 700, letterSpacing: 0.8, marginBottom: 12 }}>🏆 TOP 5 GANANCIAS LATENTES</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {stats.top5Best.map((t, i) => (
                <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${C.border}`, paddingBottom: 7 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 9, color: '#444', fontWeight: 700, minWidth: 14 }}>{i + 1}</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{t.ticker}</div>
                      <div style={{ fontSize: 8, color: '#555' }}>{t.days}d · RSI {t.rsi > 0 ? t.rsi.toFixed(0) : '—'}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: C.gain }}>{money(t.pnl)}</div>
                    <div style={{ fontSize: 9, color: C.gain, opacity: 0.7 }}>{fmtPct(t.pnlPct)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Top 5 pérdidas */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ fontSize: 9, color: C.loss, fontWeight: 700, letterSpacing: 0.8, marginBottom: 12 }}>⚠️ TOP 5 PÉRDIDAS LATENTES</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {stats.top5Worst.map((t, i) => (
                <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${C.border}`, paddingBottom: 7 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 9, color: '#444', fontWeight: 700, minWidth: 14 }}>{i + 1}</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{t.ticker}</div>
                      <div style={{ fontSize: 8, color: '#555' }}>{t.days}d · RSI {t.rsi > 0 ? t.rsi.toFixed(0) : '—'}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: C.loss }}>{money(t.pnl)}</div>
                    <div style={{ fontSize: 9, color: C.loss, opacity: 0.7 }}>{fmtPct(t.pnlPct)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Sectores */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8, marginBottom: 12 }}>DISTRIBUCIÓN POR SECTOR</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {stats.sectorData.slice(0, 7).map((s, i) => (
                <div key={s.sector}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span style={{ fontSize: 10, color: C.muted }}>{s.sector} <span style={{ color: '#444', fontSize: 8 }}>({s.count})</span></span>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: 10, color: SECTOR_COLORS[i % SECTOR_COLORS.length], fontWeight: 700 }}>{s.weight}%</span>
                      <span style={{ fontSize: 9, color: s.pnl >= 0 ? C.gain : C.loss, marginLeft: 6 }}>{money(s.pnl)}</span>
                    </div>
                  </div>
                  <div style={{ height: 3, background: C.dim, borderRadius: 2 }}>
                    <div style={{ width: `${s.weight}%`, height: '100%', background: SECTOR_COLORS[i % SECTOR_COLORS.length], borderRadius: 2, opacity: 0.8 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Tiempo en posición */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8, marginBottom: 12 }}>TIEMPO EN POSICIÓN</div>
            <div style={{ textAlign: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 9, color: '#555', marginBottom: 4 }}>Promedio</div>
              <div style={{ fontSize: 26, fontWeight: 900, color: C.accent }}>{stats.avgDays}</div>
              <div style={{ fontSize: 9, color: C.muted }}>días</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {stats.durationData.map(d => (
                <div key={d.range} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 9, color: C.muted }}>{d.range}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 10, color: C.text, fontWeight: 700 }}>{d.count}</span>
                    <span style={{ fontSize: 9, color: d.pnl >= 0 ? C.gain : C.loss }}>{money(d.pnl)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Fila 3: Variación del día + RSI + Portfolio Score ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 0.8fr 1fr', gap: 14 }}>

          {/* Variación del día */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8 }}>VARIACIÓN DEL DÍA POR POSICIÓN</div>
                <div style={{ fontSize: 9, color: '#555', marginTop: 2 }}>% variación hoy por ticker</div>
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: stats.dayPnl >= 0 ? C.gain : C.loss }}>
                {stats.dayPnl >= 0 ? '+' : ''}{money(stats.dayPnl)} hoy
              </div>
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <ComposedChart
                data={stats.dayData}
                layout="vertical"
                margin={{ top: 4, right: 40, left: 10, bottom: 4 }}
              >
                <CartesianGrid stroke="#111" horizontal={false} strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fill: C.muted, fontSize: 8 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}%`} />
                <YAxis type="category" dataKey="ticker" tick={{ fill: C.muted, fontSize: 9, fontWeight: 700 }} axisLine={false} tickLine={false} width={44} />
                <Tooltip
                  contentStyle={{ background: C.dim, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11 }}
                  formatter={(v: number | undefined) => [`${(v || 0).toFixed(2)}%`, 'Var. día']}
                />
                <Bar dataKey="dayChg" name="Var. día" radius={[0, 4, 4, 0]}>
                  {stats.dayData.map((d, i) => <Cell key={i} fill={d.dayChg >= 0 ? C.gain : C.loss} fillOpacity={0.8} />)}
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* RSI */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8, marginBottom: 12 }}>DISTRIBUCIÓN RSI</div>
            <div style={{ textAlign: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: 9, color: '#555', marginBottom: 4 }}>RSI promedio</div>
              <div style={{ fontSize: 28, fontWeight: 900, color: stats.avgRsi > 70 ? C.loss : stats.avgRsi < 30 ? C.gain : C.gold }}>
                {stats.avgRsi > 0 ? stats.avgRsi : '—'}
              </div>
              <div style={{ fontSize: 9, color: C.muted }}>
                {stats.avgRsi > 70 ? 'Sobrecomprado' : stats.avgRsi < 30 ? 'Sobrevendido' : stats.avgRsi > 0 ? 'Zona neutral' : 'Sin datos'}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {stats.rsiData.map(r => (
                <div key={r.label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span style={{ fontSize: 9, color: C.muted }}>{r.label}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: r.color }}>{r.count}</span>
                  </div>
                  <div style={{ height: 3, background: C.dim, borderRadius: 2 }}>
                    <div style={{ width: `${(r.count / stats.total) * 100}%`, height: '100%', background: r.color, borderRadius: 2, opacity: 0.8 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Portfolio Score desglose */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8 }}>PORTFOLIO SCORE</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ fontSize: 28, fontWeight: 900, color: scoreColor(stats.portfolioScore) }}>{stats.portfolioScore}</div>
                <div style={{ fontSize: 9, color: scoreColor(stats.portfolioScore) }}>/ 100</div>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { label: 'En ganancia',    pct: 30, score: Math.round(stats.scoreGainRate) },
                { label: 'Retorno',        pct: 25, score: Math.min(Math.round(stats.scoreRetorno), 100) },
                { label: 'Diversificación',pct: 20, score: Math.round(stats.scoreDiversif) },
                { label: 'RSI',            pct: 15, score: Math.round(stats.scoreRsi) },
                { label: 'Tiempo',         pct: 10, score: Math.round(stats.scoreTiempo) },
              ].map(k => (
                <div key={k.label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span style={{ fontSize: 10, color: C.muted }}>{k.label} <span style={{ color: '#333', fontSize: 8 }}>({k.pct}%)</span></span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: scoreColor(k.score) }}>{k.score}</span>
                  </div>
                  <div style={{ height: 3, background: C.dim, borderRadius: 2 }}>
                    <div style={{ width: `${Math.min(k.score, 100)}%`, height: '100%', background: scoreColor(k.score), borderRadius: 2 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </AppShell>
  )
}