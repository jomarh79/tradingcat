'use client'
import { useEffect, useMemo, useState, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts'
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

const MONTH_ORDER   = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
const SECTOR_COLORS = ['#00bfff','#a78bfa','#22c55e','#eab308','#f472b6','#fb923c','#34d399','#f43f5e','#60a5fa','#c084fc']

export default function InformeAbiertos() {
  const [trades,       setTrades]       = useState<any[]>([])
  const [portfolios,   setPortfolios]   = useState<any[]>([])
  const [sp500Map,     setSp500Map]     = useState<Record<string, number>>({})
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

    try {
      const cached = localStorage.getItem('sp500')
      if (cached) {
        const parsed: { date: string, close: number }[] = JSON.parse(cached)
        const map: Record<string, number> = {}
        parsed.forEach(d => { map[d.date] = d.close })
        setSp500Map(map)
      }
    } catch (e) { console.error('SP500 cache:', e) }

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
      '0-30d':    { count: 0, pnl: 0 },
      '31-90d':   { count: 0, pnl: 0 },
      '91-180d':  { count: 0, pnl: 0 },
      '181-365d': { count: 0, pnl: 0 },
      '+1 año':   { count: 0, pnl: 0 },
    }
    tradesWithCalc.forEach(t => {
      const key = t.days <= 30 ? '0-30d' : t.days <= 90 ? '31-90d' : t.days <= 180 ? '91-180d' : t.days <= 365 ? '181-365d' : '+1 año'
      durationMap[key].count++
      durationMap[key].pnl += t.pnl
    })
    const durationData = Object.entries(durationMap)
      .map(([range, d]) => ({ range, count: d.count, pnl: parseFloat(d.pnl.toFixed(2)) }))
      .filter(d => d.count > 0)

    // ── Evolución mensual (PnL latente por mes de apertura) ───────────────
    const monthly: Record<string, { pnl: number, count: number }> = {}
    tradesWithCalc.forEach(t => {
      const d   = parseDate(t.open_date)
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2,'0')}`
      if (!monthly[key]) monthly[key] = { pnl: 0, count: 0 }
      monthly[key].pnl   += t.pnl
      monthly[key].count += 1
    })
    let cumPnl = 0
    const monthlyData = Object.entries(monthly)
      .sort(([a], [b]) => {
        const [ya, ma] = a.split('-'); const [yb, mb] = b.split('-')
        return parseInt(ya) !== parseInt(yb) ? parseInt(ya) - parseInt(yb) : parseInt(ma) - parseInt(mb)
      })
      .map(([key, d]) => {
        const [y, m] = key.split('-')
        cumPnl = parseFloat((cumPnl + d.pnl).toFixed(2))
        return { label: `${MONTH_ORDER[parseInt(m)]} ${y}`, pnl: parseFloat(d.pnl.toFixed(2)), cumPnl, count: d.count }
      })

    // ── Rendimiento vs SP500 ──────────────────────────────────────────────
    const sp500Keys = Object.keys(sp500Map).sort()
    const periods   = [
      { label: '1 mes',   months: 1  },
      { label: '3 meses', months: 3  },
      { label: '6 meses', months: 6  },
      { label: '1 año',   months: 12 },
      { label: '5 años',  months: 60 },
    ]
    const periodRows = periods.map(p => {
      const cutoff        = new Date(now.getFullYear(), now.getMonth() - p.months, now.getDate())
      const pTrades       = tradesWithCalc.filter(t => parseDate(t.open_date) >= cutoff)
      const pInv          = pTrades.reduce((a, t) => a + t.inv, 0)
      const pPnl          = pTrades.reduce((a, t) => a + t.pnl, 0)
      const portRend      = pInv > 0 ? parseFloat((pPnl / pInv * 100).toFixed(2)) : null
      const cutoffStr     = cutoff.toISOString().split('T')[0]
      const sp500StartKey = sp500Keys.filter(k => k <= cutoffStr).slice(-1)[0]
      const sp500EndKey   = sp500Keys.slice(-1)[0]
      const sp500Start    = sp500StartKey ? sp500Map[sp500StartKey] : null
      const sp500End      = sp500EndKey   ? sp500Map[sp500EndKey]   : null
      const sp500Rend     = sp500Start && sp500End ? parseFloat(((sp500End - sp500Start) / sp500Start * 100).toFixed(2)) : null
      const diff          = portRend !== null && sp500Rend !== null ? parseFloat((portRend - sp500Rend).toFixed(2)) : null
      return { label: p.label, portRend, sp500Rend, diff }
    })

    // ── Portfolio Score ───────────────────────────────────────────────────
    const scoreGainRate  = Math.min(gainRate, 100)
    const scoreDiversif  = Math.min((sectorData.length / 8) * 100, 100)
    const scoreRetorno   = Math.min(Math.max((totalPnlPct + 20) * 2.5, 0), 100)
    const scoreRsi       = avgRsi > 0 ? (avgRsi >= 30 && avgRsi <= 60 ? 100 : avgRsi < 30 || avgRsi > 70 ? 40 : 70) : 50
    const scoreTiempo    = avgDays <= 180 ? 100 : avgDays <= 365 ? 70 : 40
    const portfolioScore = Math.round(
      scoreGainRate * 0.30 + scoreDiversif * 0.20 +
      scoreRetorno  * 0.25 + scoreRsi      * 0.15 + scoreTiempo * 0.10
    )

    return {
      total, totalInv, totalCurVal, totalPnl, totalPnlPct,
      inGain, gainRate, avgDays, avgRsi, dayPnl,
      bestTrade, worstTrade, top5Best, top5Worst,
      sectorData, durationData, monthlyData, periodRows,
      portfolioScore, scoreGainRate, scoreDiversif, scoreRetorno, scoreRsi, scoreTiempo,
    }
  }, [filtered, calcInvested, sp500Map])

  const scoreColor = (s: number) => s >= 75 ? C.gain : s >= 50 ? C.gold : C.loss
  const scoreLabel = (s: number) => s >= 75 ? 'Sólido' : s >= 50 ? 'Regular' : 'Mejorable'

  const FilterBar = () => (
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
  )

  if (loading) return (
    <AppShell>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: C.muted, fontSize: 13 }}>
        Cargando informe...
      </div>
    </AppShell>
  )

  if (!stats) return (
    <AppShell>
      <div style={{ padding: '20px 24px', background: C.bg, minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>📈 Informe ejecutivo</div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: C.accent }}>Trades Abiertos</h1>
        </div>
        <FilterBar />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40vh', color: C.muted, fontSize: 13 }}>
          Sin trades abiertos para el portafolio seleccionado.
        </div>
      </div>
    </AppShell>
  )

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
          <div style={{ textAlign: 'center', background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '14px 24px' }}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>PORTFOLIO SCORE</div>
            <div style={{ fontSize: 36, fontWeight: 900, color: scoreColor(stats.portfolioScore), lineHeight: 1 }}>
              {stats.portfolioScore}
            </div>
            <div style={{ fontSize: 9, color: scoreColor(stats.portfolioScore), marginTop: 4 }}>/ 100 · {scoreLabel(stats.portfolioScore)}</div>
          </div>
        </div>

        {/* ── Filtros ── */}
        <FilterBar />

        {/* ── Fila 1: KPIs ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 10, marginBottom: 16 }}>
          {[
            { label: 'CAPITAL INVERTIDO', value: money(stats.totalInv),    color: C.text,   sub: `${stats.total} posiciones` },
            { label: 'VALOR ACTUAL',      value: money(stats.totalCurVal), color: C.accent, sub: fmtPct(stats.totalPnlPct) },
            { label: 'PnL NO REALIZADO',  value: money(stats.totalPnl),    color: stats.totalPnl >= 0 ? C.gain : C.loss, sub: fmtPct(stats.totalPnlPct) },
            { label: 'VARIACIÓN HOY',     value: money(stats.dayPnl),      color: stats.dayPnl >= 0 ? C.gain : C.loss, sub: 'en tu cartera' },
            { label: 'EN GANANCIA',       value: `${stats.gainRate}%`,     color: stats.gainRate >= 60 ? C.gain : C.gold, sub: `${stats.inGain} de ${stats.total}` },
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

        {/* ── Fila 2: Evolución mensual + Rendimiento vs SP500 ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 14, marginBottom: 16 }}>

          {/* Evolución mensual PnL latente */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8 }}>PnL LATENTE POR MES DE APERTURA</div>
                <div style={{ fontSize: 9, color: '#555', marginTop: 2 }}>Barras = PnL no realizado · Línea = acumulado</div>
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: stats.totalPnl >= 0 ? C.gain : C.loss }}>
                {money(stats.totalPnl)} latente total
              </div>
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <ComposedChart data={stats.monthlyData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gainGradA" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor={C.gain} stopOpacity={0.9} />
                    <stop offset="100%" stopColor={C.gain} stopOpacity={0.4} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#111" vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 8 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: C.muted, fontSize: 8 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `$${v}`} width={36} />
                <Tooltip
                  contentStyle={{ background: C.dim, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11 }}
                  labelStyle={{ color: C.accent, fontWeight: 700 }}
                  formatter={(v: number | undefined, name: string | undefined) => [money(v || 0), name === 'cumPnl' ? 'Acumulado' : 'PnL latente']}
                />
                <Bar dataKey="pnl" name="PnL latente" radius={[4, 4, 0, 0]}>
                  {stats.monthlyData.map((m, i) => <Cell key={i} fill={m.pnl >= 0 ? 'url(#gainGradA)' : C.loss} fillOpacity={0.85} />)}
                </Bar>
                <Line type="monotone" dataKey="cumPnl" name="cumPnl" stroke={C.accent} strokeWidth={2} dot={{ fill: C.accent, r: 3, strokeWidth: 0 }} activeDot={{ r: 5 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Rendimiento vs SP500 */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8, marginBottom: 14 }}>RENDIMIENTO VS S&P 500</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: C.dim }}>
                  {['Período', 'Portafolio', 'S&P 500', 'Alfa'].map(h => (
                    <th key={h} style={{ padding: '7px 10px', textAlign: h === 'Período' ? 'left' : 'right', color: '#555', fontSize: 8, fontWeight: 700, letterSpacing: 0.5, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.periodRows.map(row => (
                  <tr key={row.label} style={{ borderBottom: '1px solid #0a0a0a' }}>
                    <td style={{ padding: '9px 10px', color: C.muted, fontWeight: 600, fontSize: 11 }}>{row.label}</td>
                    <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700, fontSize: 11, color: row.portRend === null ? '#333' : row.portRend >= 0 ? C.gain : C.loss }}>
                      {row.portRend === null ? '—' : fmtPct(row.portRend)}
                    </td>
                    <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700, fontSize: 11, color: row.sp500Rend === null ? '#333' : '#60a5fa' }}>
                      {row.sp500Rend === null ? '—' : fmtPct(row.sp500Rend)}
                    </td>
                    <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 800, fontSize: 12, color: row.diff === null ? '#333' : row.diff >= 0 ? C.gain : C.loss }}>
                      {row.diff === null ? '—' : `${row.diff >= 0 ? '▲' : '▼'} ${Math.abs(row.diff).toFixed(1)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[
                { label: 'Días promedio posición', value: `${stats.avgDays}d`,                   color: C.accent },
                { label: 'RSI promedio cartera',   value: stats.avgRsi > 0 ? `${stats.avgRsi}` : '—', color: stats.avgRsi > 70 ? C.loss : stats.avgRsi < 30 ? C.gain : C.gold },
              ].map(k => (
                <div key={k.label} style={{ background: C.dim, borderRadius: 8, padding: '8px 10px' }}>
                  <div style={{ fontSize: 8, color: '#555', marginBottom: 4 }}>{k.label.toUpperCase()}</div>
                  <div style={{ fontSize: 15, fontWeight: 900, color: k.color }}>{k.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Fila 3: Top posiciones + Sectores + Tiempo ── */}
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

        {/* ── Fila 4: Portfolio Score desglose (tarjetas) ── */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8 }}>PORTFOLIO SCORE — DESGLOSE</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ fontSize: 28, fontWeight: 900, color: scoreColor(stats.portfolioScore) }}>{stats.portfolioScore}</div>
              <div style={{ fontSize: 9, color: scoreColor(stats.portfolioScore) }}>/ 100</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
            {[
              { label: 'En ganancia',    pct: 30, score: Math.round(stats.scoreGainRate) },
              { label: 'Retorno',        pct: 25, score: Math.min(Math.round(stats.scoreRetorno), 100) },
              { label: 'Diversificación',pct: 20, score: Math.round(stats.scoreDiversif) },
              { label: 'RSI',            pct: 15, score: Math.round(stats.scoreRsi) },
              { label: 'Tiempo',         pct: 10, score: Math.round(stats.scoreTiempo) },
            ].map(k => (
              <div key={k.label} style={{ background: C.dim, borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: C.muted, marginBottom: 6 }}>{k.label}</div>
                <div style={{ fontSize: 18, fontWeight: 900, color: scoreColor(k.score) }}>{k.score}</div>
                <div style={{ fontSize: 8, color: '#555', marginTop: 2 }}>peso {k.pct}%</div>
                <div style={{ height: 3, background: C.border, borderRadius: 2, marginTop: 6 }}>
                  <div style={{ width: `${Math.min(k.score, 100)}%`, height: '100%', background: scoreColor(k.score), borderRadius: 2 }} />
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </AppShell>
  )
}