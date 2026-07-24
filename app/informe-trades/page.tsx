'use client'
import { useEffect, useMemo, useState, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, PieChart, Pie } from 'recharts'
import AppShell from '../AppShell'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const parseDate  = (d: string) => new Date((d || '').split('T')[0] + 'T00:00:00')
const money      = (v: number) => `$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtPct     = (v: number, decimals = 2) => `${v >= 0 ? '+' : ''}${v.toFixed(decimals)}%`

const C = {
  bg:      '#070709',
  card:    '#0a0a0c',
  border:  '#141418',
  accent:  '#00bfff',
  gain:    '#22c55e',
  loss:    '#f43f5e',
  gold:    '#eab308',
  purple:  '#a78bfa',
  text:    '#e2e8f0',
  muted:   '#64748b',
  dim:     '#0f0f12',
}

const MONTH_ORDER = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
const MESES_FULL  = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const SECTOR_COLORS = ['#00bfff','#a78bfa','#22c55e','#eab308','#f472b6','#fb923c','#34d399','#f43f5e','#60a5fa','#c084fc']

export default function InformeTrades() {
  const [trades,      setTrades]      = useState<any[]>([])
  const [portfolios,  setPortfolios]  = useState<any[]>([])
  const [sp500Map,    setSp500Map]    = useState<Record<string, number>>({})
  const [loading,     setLoading]     = useState(true)
  const [filterWallet,setFilterWallet]= useState('all')
  const [filterYear,  setFilterYear]  = useState<string>(new Date().getFullYear().toString())

  const fetchData = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    const [{ data: tData }, { data: pData }] = await Promise.all([
      supabase.from('trades')
        .select('*, trade_executions(quantity, price, commission, execution_type), portfolios(name, id)')
        .eq('user_id', user.id)
        .eq('status', 'closed'),
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

  const availableYears = useMemo(() => {
    const years = new Set(trades.map(t => parseDate(t.close_date || t.open_date).getFullYear().toString()))
    return Array.from(years).sort((a, b) => b.localeCompare(a))
  }, [trades])

  const filtered = useMemo(() => {
    return trades.filter(t => {
      const matchWallet = filterWallet === 'all' || t.portfolio_id === filterWallet
      const matchYear   = filterYear === 'all' || parseDate(t.close_date || t.open_date).getFullYear().toString() === filterYear
      return matchWallet && matchYear
    })
  }, [trades, filterWallet, filterYear])

  const stats = useMemo(() => {
    if (!filtered.length) return null
    const now   = new Date()
    const year  = filterYear === 'all' ? now.getFullYear() : parseInt(filterYear)
    const month = now.getMonth()

    const sorted = [...filtered].sort((a, b) =>
      parseDate(a.close_date || a.open_date).getTime() - parseDate(b.close_date || b.open_date).getTime()
    )

    // ── KPIs básicos ─────────────────────────────────────────────────────
    let wins = 0, totalWin = 0, totalLoss = 0
    let equity = 0, peak = 0, maxDD = 0

    const tradesWithCalc = sorted.map(t => {
      const inv     = calcInvested(t)
      const pnl     = Number(t.realized_pnl || 0)
      const pnlPct  = inv > 0 ? (pnl / inv * 100) : 0
      const open    = parseDate(t.open_date)
      const close   = parseDate(t.close_date || t.open_date)
      const days    = Math.max(1, Math.ceil(Math.abs(close.getTime() - open.getTime()) / 86400000))

      equity += pnl
      if (equity > peak) peak = equity
      const dd = peak > 0 ? ((peak - equity) / peak * 100) : 0
      if (dd > maxDD) maxDD = dd

      if (pnl > 0) { wins++; totalWin += pnl } else { totalLoss += Math.abs(pnl) }

      return { ...t, inv, pnl, pnlPct, days }
    })

    const total       = tradesWithCalc.length
    const winRate     = total > 0 ? parseFloat((wins / total * 100).toFixed(1)) : 0
    const profitFactor= totalLoss > 0 ? parseFloat((totalWin / totalLoss).toFixed(2)) : totalWin > 0 ? 99 : 0
    const totalPnl    = parseFloat(equity.toFixed(2))
    const avgPnl      = total > 0 ? parseFloat((totalPnl / total).toFixed(2)) : 0
    const avgDays     = parseFloat((tradesWithCalc.reduce((a, t) => a + t.days, 0) / total).toFixed(1))
    const totalInv    = parseFloat(tradesWithCalc.reduce((a, t) => a + t.inv, 0).toFixed(2))
    const retorno     = totalInv > 0 ? parseFloat((totalPnl / totalInv * 100).toFixed(2)) : 0

    // ── Top trades ───────────────────────────────────────────────────────
    const byPnl    = [...tradesWithCalc].sort((a, b) => b.pnl - a.pnl)
    const top5Best = byPnl.slice(0, 5)
    const top5Worst= byPnl.slice(-5).reverse()
    const bestTrade = top5Best[0]
    const worstTrade= top5Worst[0]

    // ── Evolución mensual ────────────────────────────────────────────────
    const monthly: Record<string, { pnl: number, trades: number, wins: number }> = {}
    tradesWithCalc.forEach(t => {
      const d   = parseDate(t.close_date || t.open_date)
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`
      const lbl = `${MONTH_ORDER[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`
      if (!monthly[key]) monthly[key] = { pnl: 0, trades: 0, wins: 0 }
      monthly[key].pnl    += t.pnl
      monthly[key].trades += 1
      if (t.pnl > 0) monthly[key].wins++
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
        return {
          label:   `${MONTH_ORDER[parseInt(m)]} ${y}`,
          pnl:     parseFloat(d.pnl.toFixed(2)),
          cumPnl,
          trades:  d.trades,
          winRate: d.trades > 0 ? Math.round(d.wins / d.trades * 100) : 0,
          fill:    d.pnl >= 0 ? C.gain : C.loss,
        }
      })

    // ── Por sector ───────────────────────────────────────────────────────
    const sectorMap: Record<string, { pnl: number, count: number, wins: number }> = {}
    tradesWithCalc.forEach(t => {
      const s = t.sector || 'Sin sector'
      if (!sectorMap[s]) sectorMap[s] = { pnl: 0, count: 0, wins: 0 }
      sectorMap[s].pnl   += t.pnl
      sectorMap[s].count += 1
      if (t.pnl > 0) sectorMap[s].wins++
    })
    const sectorData = Object.entries(sectorMap)
      .map(([sector, d]) => ({ sector, pnl: parseFloat(d.pnl.toFixed(2)), count: d.count, winRate: Math.round(d.wins / d.count * 100) }))
      .sort((a, b) => b.pnl - a.pnl)

    // ── Razón de cierre ──────────────────────────────────────────────────
    const reasonMap: Record<string, { pnl: number, count: number }> = {}
    tradesWithCalc.forEach(t => {
      const r = t.close_reason || 'Sin razón'
      if (!reasonMap[r]) reasonMap[r] = { pnl: 0, count: 0 }
      reasonMap[r].pnl   += t.pnl
      reasonMap[r].count += 1
    })
    const reasonData = Object.entries(reasonMap)
      .map(([reason, d]) => ({ reason, pnl: parseFloat(d.pnl.toFixed(2)), count: d.count }))
      .sort((a, b) => b.pnl - a.pnl)

    // ── Días promedio por resultado ───────────────────────────────────────
    const winDays  = tradesWithCalc.filter(t => t.pnl > 0).reduce((a, t) => a + t.days, 0) / (wins || 1)
    const lossDays = tradesWithCalc.filter(t => t.pnl <= 0).reduce((a, t) => a + t.days, 0) / ((total - wins) || 1)

    // ── Rendimiento por período vs SP500 ─────────────────────────────────
    const sp500Keys  = Object.keys(sp500Map).sort()
    const periods = [
      { label: '1 mes',   months: 1  },
      { label: '3 meses', months: 3  },
      { label: '6 meses', months: 6  },
      { label: '1 año',   months: 12 },
    ]
    const periodRows = periods.map(p => {
      const cutoff       = new Date(now.getFullYear(), now.getMonth() - p.months, now.getDate())
      const pTrades      = tradesWithCalc.filter(t => parseDate(t.close_date) >= cutoff)
      const pInv         = pTrades.reduce((a, t) => a + t.inv, 0)
      const pPnl         = pTrades.reduce((a, t) => a + t.pnl, 0)
      const portRend     = pInv > 0 ? parseFloat((pPnl / pInv * 100).toFixed(2)) : null
      const cutoffStr    = cutoff.toISOString().split('T')[0]
      const sp500StartKey= sp500Keys.filter(k => k <= cutoffStr).slice(-1)[0]
      const sp500EndKey  = sp500Keys.slice(-1)[0]
      const sp500Start   = sp500StartKey ? sp500Map[sp500StartKey] : null
      const sp500End     = sp500EndKey   ? sp500Map[sp500EndKey]   : null
      const sp500Rend    = sp500Start && sp500End ? parseFloat(((sp500End - sp500Start) / sp500Start * 100).toFixed(2)) : null
      const diff         = portRend !== null && sp500Rend !== null ? parseFloat((portRend - sp500Rend).toFixed(2)) : null
      return { label: p.label, portRend, sp500Rend, diff }
    })

    // ── Trade Score ───────────────────────────────────────────────────────
    const scoreWR      = Math.min(winRate, 100)
    const scorePF      = Math.min((profitFactor / 3) * 100, 100)
    const scoreRetorno = Math.min(Math.max(retorno * 5, 0), 100)
    const scoreSector  = Math.min((sectorData.length / 8) * 100, 100)
    const scoreMeses   = monthlyData.length > 0
      ? Math.min((monthlyData.filter(m => m.pnl > 0).length / monthlyData.length) * 100, 100)
      : 0
    const tradeScore   = Math.round(
      scoreWR      * 0.30 +
      scorePF      * 0.25 +
      scoreRetorno * 0.20 +
      scoreSector  * 0.15 +
      scoreMeses   * 0.10
    )

// PnL anual histórico — usa todos los trades sin filtro de año
    const byYearAll: Record<string, number> = {}
    trades.forEach(t => {
      const y = parseDate(t.close_date || t.open_date).getFullYear().toString()
      byYearAll[y] = (byYearAll[y] || 0) + Number(t.realized_pnl || 0)
    })
    const pnlAnual = Object.entries(byYearAll)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([year, pnl]) => ({ year, pnl: parseFloat(pnl.toFixed(2)) }))

    return {
      total, wins, winRate, totalPnl, avgPnl, avgDays, totalInv, retorno,
      profitFactor, maxDD: parseFloat(maxDD.toFixed(2)),
      bestTrade, worstTrade, top5Best, top5Worst,
      monthlyData, sectorData, reasonData,
      winDays: parseFloat(winDays.toFixed(1)),
      lossDays: parseFloat(lossDays.toFixed(1)),
      periodRows, tradeScore,
      scoreWR, scorePF, scoreRetorno, scoreSector, scoreMeses,
      year,
      pnlAnual,
    }
  }, [filtered, calcInvested, sp500Map, filterYear])

  const scoreColor = (s: number) => s >= 75 ? C.gain : s >= 50 ? C.gold : C.loss
  const scoreLabel = (s: number) => s >= 75 ? 'Sólido' : s >= 50 ? 'Regular' : 'Mejorable'

  if (loading) return (
    <AppShell>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: C.muted, fontSize: 13 }}>
        Cargando informe...
      </div>
    </AppShell>
  )

  if (!stats) return (
    <AppShell>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: C.muted, fontSize: 13 }}>
        Sin trades cerrados para el período seleccionado.
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
              📊 Informe ejecutivo
            </div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: C.accent, letterSpacing: -0.5 }}>
              Trades Cerrados
            </h1>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>
              {filterYear === 'all' ? 'Histórico completo' : stats.year} · {stats.total} operaciones
            </div>
          </div>
          {/* Trade Score */}
          <div style={{ textAlign: 'center', background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '14px 24px' }}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>TRADE SCORE</div>
            <div style={{ fontSize: 36, fontWeight: 900, color: scoreColor(stats.tradeScore), lineHeight: 1 }}>
              {stats.tradeScore}
            </div>
            <div style={{ fontSize: 9, color: scoreColor(stats.tradeScore), marginTop: 4 }}>/ 100 · {scoreLabel(stats.tradeScore)}</div>
          </div>
        </div>

        {/* ── Filtros ── */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <select value={filterYear} onChange={e => setFilterYear(e.target.value)} style={{
              background: C.dim, border: `1px solid ${C.border}`, color: C.text,
              padding: '6px 32px 6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700,
              cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none', outline: 'none',
            }}>
              <option value="all">Todos los años</option>
              {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: C.muted, fontSize: 10 }}>▼</span>
          </div>
          <div style={{ width: 1, background: C.border, height: 28 }} />
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
            { label: 'PnL TOTAL',      value: money(stats.totalPnl),      color: stats.totalPnl >= 0 ? C.gain : C.loss, sub: `${fmtPct(stats.retorno)} retorno` },
            { label: 'WIN RATE',       value: `${stats.winRate}%`,        color: stats.winRate >= 60 ? C.gain : C.gold, sub: `${stats.wins} de ${stats.total} trades` },
            { label: 'PROFIT FACTOR',  value: stats.profitFactor,         color: stats.profitFactor >= 2 ? C.gain : stats.profitFactor >= 1 ? C.gold : C.loss, sub: 'ganancia / pérdida' },
            { label: 'PnL PROMEDIO',   value: money(stats.avgPnl),        color: stats.avgPnl >= 0 ? C.gain : C.loss, sub: 'por trade' },
            { label: 'MEJOR TRADE',    value: stats.bestTrade ? money(stats.bestTrade.pnl) : '—', color: C.gain, sub: stats.bestTrade?.ticker || '—' },
            { label: 'PEOR TRADE',     value: stats.worstTrade ? money(stats.worstTrade.pnl) : '—', color: C.loss, sub: stats.worstTrade?.ticker || '—' },
            { label: 'DRAWDOWN MÁX',   value: `${stats.maxDD.toFixed(1)}%`, color: stats.maxDD < 10 ? C.gain : stats.maxDD < 20 ? C.gold : C.loss, sub: 'caída máxima' },
          ].map(k => (
            <div key={k.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px' }}>
              <div style={{ fontSize: 8, color: C.muted, fontWeight: 700, letterSpacing: 0.8, marginBottom: 6 }}>{k.label}</div>
              <div style={{ fontSize: 17, fontWeight: 900, color: k.color as string, marginBottom: 3 }}>{k.value}</div>
              <div style={{ fontSize: 9, color: '#555' }}>{k.sub}</div>
            </div>
          ))}
        </div>

        {/* ── Fila 2: Evolución mensual + Período vs SP500 ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 14, marginBottom: 16 }}>

          {/* Evolución mensual */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8 }}>EVOLUCIÓN MENSUAL DEL PnL</div>
                <div style={{ fontSize: 9, color: '#555', marginTop: 2 }}>Barras = PnL mes · Línea = acumulado</div>
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: stats.totalPnl >= 0 ? C.gain : C.loss }}>
                {money(stats.totalPnl)} acumulado
              </div>
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <ComposedChart data={stats.monthlyData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gainGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"  stopColor={C.gain} stopOpacity={0.9} />
                    <stop offset="100%" stopColor={C.gain} stopOpacity={0.4} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#111" vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 8 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: C.muted, fontSize: 8 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `$${v}`} width={36} />
                <Tooltip
                  contentStyle={{ background: C.dim, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11 }}
                  labelStyle={{ color: C.accent, fontWeight: 700 }}
                  formatter={(v: number | undefined, name: string | undefined) => [money(v || 0), name === 'cumPnl' ? 'Acumulado' : 'PnL mes']}
                />
                <Bar dataKey="pnl" name="PnL mes" radius={[4, 4, 0, 0]}>
                  {stats.monthlyData.map((m, i) => <Cell key={i} fill={m.pnl >= 0 ? 'url(#gainGrad)' : C.loss} fillOpacity={0.85} />)}
                </Bar>
                <Line type="monotone" dataKey="cumPnl" name="cumPnl" stroke={C.accent} strokeWidth={2} dot={{ fill: C.accent, r: 3, strokeWidth: 0 }} activeDot={{ r: 5 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Rendimiento por período */}
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
                  <tr key={row.label} style={{ borderBottom: `1px solid #0a0a0a` }}>
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
            {/* Stats extra */}
            <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[
                { label: 'Días promedio ganador', value: `${stats.winDays}d`, color: C.gain },
                { label: 'Días promedio perdedor', value: `${stats.lossDays}d`, color: C.loss },
              ].map(k => (
                <div key={k.label} style={{ background: C.dim, borderRadius: 8, padding: '8px 10px' }}>
                  <div style={{ fontSize: 8, color: '#555', marginBottom: 4 }}>{k.label.toUpperCase()}</div>
                  <div style={{ fontSize: 15, fontWeight: 900, color: k.color }}>{k.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Fila 3: Top trades + Sectores + Razones ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: 14, marginBottom: 16 }}>

          {/* Top 5 mejores */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ fontSize: 9, color: C.gain, fontWeight: 700, letterSpacing: 0.8, marginBottom: 12 }}>🏆 TOP 5 MEJORES TRADES</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {stats.top5Best.map((t, i) => (
                <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${C.border}`, paddingBottom: 7 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 9, color: '#444', fontWeight: 700, minWidth: 14 }}>{i + 1}</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{t.ticker}</div>
                      <div style={{ fontSize: 8, color: '#555' }}>{t.days}d · {t.close_reason || '—'}</div>
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

          {/* Top 5 peores */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ fontSize: 9, color: C.loss, fontWeight: 700, letterSpacing: 0.8, marginBottom: 12 }}>⚠️ TOP 5 PEORES TRADES</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {stats.top5Worst.map((t, i) => (
                <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${C.border}`, paddingBottom: 7 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 9, color: '#444', fontWeight: 700, minWidth: 14 }}>{i + 1}</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{t.ticker}</div>
                      <div style={{ fontSize: 8, color: '#555' }}>{t.days}d · {t.close_reason || '—'}</div>
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
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8, marginBottom: 12 }}>PnL POR SECTOR</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {stats.sectorData.slice(0, 7).map((s, i) => {
                const maxAbs = Math.max(...stats.sectorData.map(x => Math.abs(x.pnl)), 1)
                const width  = Math.abs(s.pnl) / maxAbs * 100
                const color  = SECTOR_COLORS[i % SECTOR_COLORS.length]
                return (
                  <div key={s.sector}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                      <span style={{ fontSize: 10, color: C.muted }}>{s.sector} <span style={{ color: '#444', fontSize: 8 }}>({s.count})</span></span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: s.pnl >= 0 ? C.gain : C.loss }}>{money(s.pnl)}</span>
                    </div>
                    <div style={{ height: 3, background: C.dim, borderRadius: 2 }}>
                      <div style={{ width: `${width}%`, height: '100%', background: s.pnl >= 0 ? color : C.loss, borderRadius: 2, opacity: 0.8 }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Razones de cierre */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8, marginBottom: 12 }}>PnL POR RAZÓN DE CIERRE</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {stats.reasonData.map((r, i) => {
                const maxAbs = Math.max(...stats.reasonData.map(x => Math.abs(x.pnl)), 1)
                const width  = Math.abs(r.pnl) / maxAbs * 100
                return (
                  <div key={r.reason}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                      <span style={{ fontSize: 10, color: C.muted }}>{r.reason} <span style={{ color: '#444', fontSize: 8 }}>({r.count})</span></span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: r.pnl >= 0 ? C.gain : C.loss }}>{money(r.pnl)}</span>
                    </div>
                    <div style={{ height: 4, background: C.dim, borderRadius: 2 }}>
                      <div style={{ width: `${width}%`, height: '100%', background: r.pnl >= 0 ? C.gain : C.loss, borderRadius: 2, opacity: 0.75 }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

            {/* PnL anual histórico */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8, marginBottom: 12 }}>PnL ANUAL</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {stats.pnlAnual.map(y => {
                const maxAbs = Math.max(...stats.pnlAnual.map(x => Math.abs(x.pnl)), 1)
                const width  = Math.abs(y.pnl) / maxAbs * 100
                const isSelected = y.year === filterYear
                return (
                  <div key={y.year}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                      <span style={{ fontSize: 11, fontWeight: isSelected ? 900 : 600, color: isSelected ? C.accent : C.muted }}>
                        {y.year} {isSelected && <span style={{ fontSize: 8, color: C.accent }}>● actual</span>}
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: y.pnl >= 0 ? C.gain : C.loss }}>
                        {y.pnl >= 0 ? '+' : ''}{money(y.pnl)}
                      </span>
                    </div>
                    <div style={{ height: 3, background: C.dim, borderRadius: 2 }}>
                      <div style={{ width: `${width}%`, height: '100%', borderRadius: 2, background: y.pnl >= 0 ? C.gain : C.loss, opacity: isSelected ? 1 : 0.4 }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

        </div>

        {/* ── Fila 4: Trade Score desglose + Razones cierre ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>

          {/* Trade Score */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8 }}>TRADE SCORE — DESGLOSE</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ fontSize: 28, fontWeight: 900, color: scoreColor(stats.tradeScore) }}>{stats.tradeScore}</div>
                <div style={{ fontSize: 9, color: scoreColor(stats.tradeScore) }}>/ 100</div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
              {[
                { label: 'Win Rate',    pct: 30, score: Math.round(stats.scoreWR) },
                { label: 'Prof. Factor',pct: 25, score: Math.round(stats.scorePF) },
                { label: 'Retorno',     pct: 20, score: Math.round(stats.scoreRetorno) },
                { label: 'Sectores',    pct: 15, score: Math.round(stats.scoreSector) },
                { label: 'Consistencia',pct: 10, score: Math.min(Math.round(stats.scoreMeses), 100) },
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

      </div>
    </AppShell>
  )
}