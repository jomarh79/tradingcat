'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { usePrivacy } from '@/lib/PrivacyContext'
import AppShell from '../AppShell'
import { TrendingUp } from 'lucide-react'

const parseDate = (d: string) => new Date((d || '').split('T')[0] + 'T00:00:00')

// ── Cat decorators ─────────────────────────────────────────────────────────
const Paw = ({ size = 14, color = '#666', opacity = 1, style: s = {} }: any) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ opacity, flexShrink: 0, ...s }}>
    <ellipse cx="6"  cy="5"  rx="2.5" ry="3"/>
    <ellipse cx="11" cy="3"  rx="2.5" ry="3"/>
    <ellipse cx="16" cy="4"  rx="2.5" ry="3"/>
    <ellipse cx="19" cy="9"  rx="2"   ry="2.5"/>
    <path d="M12 22c-5 0-8-3-8-7 0-2.5 1.5-4.5 4-5.5 1-.4 2-.6 4-.6s3 .2 4 .6c2.5 1 4 3 4 5.5 0 4-3 7-8 7z"/>
  </svg>
)

const CatEars = ({ color = '#00bfff', opacity = 0.1, size = 40 }: any) => (
  <svg width={size * 1.5} height={size} viewBox="0 0 60 40" fill={color} style={{ opacity }}>
    <polygon points="0,40 12,0 24,40"/>
    <polygon points="36,40 48,0 60,40"/>
  </svg>
)

const Whiskers = ({ color = '#888', opacity = 0.1, width = 90 }: any) => (
  <svg width={width} height={32} viewBox={`0 0 ${width} 32`} stroke={color} strokeWidth="1.5" style={{ opacity }}>
    <line x1="0" y1="8"  x2={width * 0.44} y2="16"/>
    <line x1="0" y1="16" x2={width * 0.44} y2="16"/>
    <line x1="0" y1="24" x2={width * 0.44} y2="16"/>
    <line x1={width} y1="8"  x2={width * 0.56} y2="16"/>
    <line x1={width} y1="16" x2={width * 0.56} y2="16"/>
    <line x1={width} y1="24" x2={width * 0.56} y2="16"/>
  </svg>
)

const CatTail = ({ color = '#00bfff', opacity = 0.07 }: any) => (
  <svg width={46} height={76} viewBox="0 0 50 80" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" style={{ opacity }}>
    <path d="M40 80 Q45 50 20 40 Q0 30 10 10 Q20 -5 35 5"/>
  </svg>
)

// Gato sentado simplificado como SVG decorativo
const CatSitting = ({ size = 60, color = '#00bfff', opacity = 0.06 }: any) => (
  <svg width={size} height={size * 1.3} viewBox="0 0 50 65" fill={color} style={{ opacity }}>
    {/* orejas */}
    <polygon points="10,18 15,5 22,18"/>
    <polygon points="28,18 35,5 40,18"/>
    {/* cabeza */}
    <ellipse cx="25" cy="24" rx="14" ry="12"/>
    {/* cuerpo */}
    <ellipse cx="25" cy="46" rx="13" ry="14"/>
    {/* cola */}
    <path d="M38 56 Q50 48 46 38 Q42 30 38 36" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round"/>
  </svg>
)

export default function EstadisticasCerradosPage() {
  const { money } = usePrivacy()

  const [trades,            setTrades]            = useState<any[]>([])
  const [portfolios,        setPortfolios]        = useState<any[]>([])
  const [selectedPortfolio, setSelectedPortfolio] = useState('all')
  const [selectedYear,      setSelectedYear]      = useState(new Date().getFullYear().toString())

  const fetchData = useCallback(async () => {
    const [{ data: pData }, { data: tData }] = await Promise.all([
      supabase.from('portfolios').select('*'),
      supabase.from('trades').select('*, portfolios(name, id)').eq('status', 'closed'),
    ])
    if (pData) setPortfolios(pData)
    if (tData) setTrades(tData)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const availableYears = useMemo(() => {
    const years = trades.map(t => parseDate(t.close_date || t.open_date).getFullYear().toString())
    const set = Array.from(new Set(years)).sort((a, b) => b.localeCompare(a))
    return set
  }, [trades])

  const filteredTrades = useMemo(() => trades.filter(t => {
    const matchP = selectedPortfolio === 'all' || t.portfolio_id === selectedPortfolio
    const matchY = selectedYear === 'all' || parseDate(t.close_date || t.open_date).getFullYear().toString() === selectedYear
    return matchP && matchY
  }), [trades, selectedPortfolio, selectedYear])

  const stats = useMemo(() => {
    if (!filteredTrades.length) return null

    const sorted = [...filteredTrades].sort(
      (a, b) => parseDate(a.close_date).getTime() - parseDate(b.close_date).getTime()
    )

    const totalTrades = sorted.length
    const wins   = sorted.filter(t => Number(t.realized_pnl) > 0)
    const losses = sorted.filter(t => Number(t.realized_pnl) < 0)
    const breakEven = sorted.filter(t => Number(t.realized_pnl) === 0)

    const totalPnL  = parseFloat(sorted.reduce((acc, t) => acc + Number(t.realized_pnl || 0), 0).toFixed(2))
    const totalWin  = parseFloat(wins.reduce((acc, t)   => acc + Number(t.realized_pnl || 0), 0).toFixed(2))
    const totalLoss = parseFloat(losses.reduce((acc, t)  => acc + Math.abs(Number(t.realized_pnl || 0)), 0).toFixed(2))

    const winRate      = parseFloat(((wins.length / totalTrades) * 100).toFixed(1))
    const avgWin       = wins.length   ? parseFloat((totalWin  / wins.length).toFixed(2))   : 0
    const avgLoss      = losses.length ? parseFloat((totalLoss / losses.length).toFixed(2)) : 0
    const winLossRatio = avgLoss > 0   ? parseFloat((avgWin / avgLoss).toFixed(2))          : 0
    const profitFactor = totalLoss > 0 ? parseFloat((totalWin / totalLoss).toFixed(2))      : totalWin > 0 ? 100 : 0
    const expectancy   = parseFloat((((winRate / 100) * avgWin) - ((1 - winRate / 100) * avgLoss)).toFixed(2))

    // Duración promedio
    const avgDuration = parseFloat((
      sorted.reduce((acc, t) => {
        const days = Math.max(1, Math.ceil(
          Math.abs(parseDate(t.close_date).getTime() - parseDate(t.open_date).getTime()) / 86400000
        ))
        return acc + days
      }, 0) / totalTrades
    ).toFixed(1))

    // Streaks, drawdown, equity
    let equity = 0, peak = 0, maxDD = 0
    let winStrk = 0, maxWinStrk = 0, lossStrk = 0, maxLossStrk = 0
    sorted.forEach(t => {
      const pnl = Number(t.realized_pnl || 0)
      equity += pnl
      if (equity > peak) peak = equity
      const dd = peak - equity
      if (dd > maxDD) maxDD = dd
      if (pnl > 0) { winStrk++; lossStrk = 0; if (winStrk > maxWinStrk) maxWinStrk = winStrk }
      else          { lossStrk++; winStrk = 0; if (lossStrk > maxLossStrk) maxLossStrk = lossStrk }
    })

    // Calmar Ratio: retorno total / max drawdown
    const calmarRatio = maxDD > 0 ? parseFloat((totalPnL / maxDD).toFixed(2)) : null

    // Tasa de recuperación: cuántos trades consecutivos promedio para recuperar la racha perdedora
    const recoveryRate = maxLossStrk > 0 && avgWin > 0 && avgLoss > 0
      ? Math.ceil((maxLossStrk * avgLoss) / avgWin)
      : null

    // Rendimiento promedio % por trade
    const avgReturnPct = parseFloat((
      sorted.reduce((acc, t) => {
        const inv = Number(t.total_invested || 0)
        const pnl = Number(t.realized_pnl || 0)
        return acc + (inv > 0 ? (pnl / inv) * 100 : 0)
      }, 0) / totalTrades
    ).toFixed(2))

    // Mejor y peor trade en %
    const withPct = sorted.map(t => ({
      ...t,
      pct: Number(t.total_invested) > 0 ? (Number(t.realized_pnl) / Number(t.total_invested)) * 100 : 0,
    }))
    const bestTradePct  = [...withPct].sort((a, b) => b.pct - a.pct)[0]
    const worstTradePct = [...withPct].sort((a, b) => a.pct - b.pct)[0]

    // Distribución mensual
    const monthlyStats: Record<string, { count: number, pnl: number, wins: number }> = {}
    sorted.forEach(t => {
      const key = parseDate(t.close_date).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })
      if (!monthlyStats[key]) monthlyStats[key] = { count: 0, pnl: 0, wins: 0 }
      monthlyStats[key].count++
      monthlyStats[key].pnl = parseFloat((monthlyStats[key].pnl + Number(t.realized_pnl || 0)).toFixed(2))
      if (Number(t.realized_pnl || 0) > 0) monthlyStats[key].wins++
    })

    const monthEntries = Object.entries(monthlyStats)
    const bestMonth    = [...monthEntries].sort(([, a], [, b]) => b.pnl - a.pnl)[0]
    const worstMonth   = [...monthEntries].sort(([, a], [, b]) => a.pnl - b.pnl)[0]

    // Razones de cierre
    const closeReasons: Record<string, { count: number, pnl: number }> = {}
    sorted.forEach(t => {
      const r = t.close_reason || 'Sin especificar'
      if (!closeReasons[r]) closeReasons[r] = { count: 0, pnl: 0 }
      closeReasons[r].count++
      closeReasons[r].pnl = parseFloat((closeReasons[r].pnl + Number(t.realized_pnl || 0)).toFixed(2))
    })

    // Sectores
    const sectorPnL: Record<string, number> = {}
    sorted.forEach(t => {
      const s = t.sector || 'Otros'
      sectorPnL[s] = parseFloat(((sectorPnL[s] || 0) + Number(t.realized_pnl || 0)).toFixed(2))
    })
    const sectorEntries = Object.entries(sectorPnL).sort(([, a], [, b]) => b - a)
    const bestSector    = sectorEntries[0]
    const worstSector   = sectorEntries[sectorEntries.length - 1]

    return {
      totalTrades, totalPnL, winRate, profitFactor, expectancy,
      avgWin, avgLoss, winLossRatio, maxDD: parseFloat(maxDD.toFixed(2)),
      maxWinStrk, maxLossStrk, avgDuration,
      bestMonth, worstMonth, bestSector, worstSector,
      topWinners:    [...sorted].sort((a, b) => Number(b.realized_pnl) - Number(a.realized_pnl)).slice(0, 5),
      topLosers:     [...sorted].sort((a, b) => Number(a.realized_pnl) - Number(b.realized_pnl)).slice(0, 5),
      monthlyStats, closeReasons,
      calmarRatio, recoveryRate, avgReturnPct,
      bestTradePct, worstTradePct,
      winsCount: wins.length, lossesCount: losses.length, breakEvenCount: breakEven.length,
    }
  }, [filteredTrades])

  return (
    <AppShell>
      <div style={{ maxWidth: 1400, margin: '20px auto', padding: '0 28px', color: 'white', position: 'relative' }}>

        {/* ── Gatos decorativos extremos ── */}
        <div style={{ position: 'absolute', top: -4, right: 50, pointerEvents: 'none' }}>
          <CatEars color="#00bfff" opacity={0.14} size={46} />
        </div>
        <div style={{ position: 'absolute', right: -8, top: '20%', pointerEvents: 'none' }}>
          <CatTail color="#22c55e" opacity={0.09} />
        </div>
        <div style={{ position: 'absolute', left: 0, top: '60%', pointerEvents: 'none' }}>
          <CatSitting size={70} color="#00bfff" opacity={0.05} />
        </div>

        {/* ── HEADER ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 22 }}>
          <Paw size={22} color="#22c55e" opacity={0.7} />
          <Paw size={16} color="#22c55e" opacity={0.4} />
          <Paw size={10} color="#22c55e" opacity={0.2} />
          <TrendingUp size={20} color="#00bfff" />
          <h1 style={{ fontSize: 18, fontWeight: 900, margin: 0 }}>Performance histórico — trades cerrados</h1>
        </div>

        {/* ── FILTROS ── */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 26, flexWrap: 'wrap', alignItems: 'center', borderBottom: '1px solid #1a1a1a', paddingBottom: 14 }}>
          <select value={selectedYear} onChange={e => setSelectedYear(e.target.value)} style={selectStyle}>
            <option value="all">Todos los años</option>
            {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          {[{ id: 'all', name: 'Todos' }, ...portfolios].map(p => (
            <button key={p.id} onClick={() => setSelectedPortfolio(p.id)} style={filterBtn(selectedPortfolio === p.id)}>
              {p.name}
            </button>
          ))}
        </div>

        {!stats ? (
          <div style={{ textAlign: 'center', padding: 80, color: '#666', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <CatSitting size={60} color="#444" opacity={0.4} />
            <Paw size={24} color="#333" opacity={0.5} />
            <span>No hay trades cerrados para este filtro.</span>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 14 }}>

            {/* ── F1: KPIs principales ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              <StatCard label="PnL total acumulado"
                value={money(stats.totalPnL)}
                color={stats.totalPnL >= 0 ? '#22c55e' : '#f43f5e'}
                pawColor={stats.totalPnL >= 0 ? '#22c55e' : '#f43f5e'} />
              <StatCard label="Win rate" value={`${stats.winRate}%`}
                desc={`${stats.winsCount} ganados · ${stats.lossesCount} perdidos${stats.breakEvenCount ? ` · ${stats.breakEvenCount} BE` : ''}`}
                color="#fff" bar={stats.winRate} pawColor="#fff" />
              <StatCard label="Profit factor" value={String(stats.profitFactor)}
                desc={stats.profitFactor >= 1.5 ? 'Sistema rentable' : stats.profitFactor >= 1 ? 'Marginalmente rentable' : 'Sistema con pérdidas'}
                color={stats.profitFactor >= 1.5 ? '#22c55e' : stats.profitFactor >= 1 ? '#eab308' : '#f43f5e'}
                pawColor="#eab308" />
              <StatCard label="Expectativa por trade" value={money(stats.expectancy)}
                desc={`Ganas en promedio ${money(Math.abs(stats.expectancy))} por operación`}
                color="#00bfff" pawColor="#00bfff" />
            </div>

            {/* ── F2: Métricas avanzadas ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              <StatCard label="Rendimiento % promedio / trade" value={`${stats.avgReturnPct}%`}
                desc="Por trade vs capital invertido"
                color={stats.avgReturnPct >= 0 ? '#22c55e' : '#f43f5e'} pawColor="#a78bfa" />
              <StatCard label="Calmar ratio" value={stats.calmarRatio !== null ? String(stats.calmarRatio) : '—'}
                desc={stats.calmarRatio !== null
                  ? stats.calmarRatio >= 2 ? 'Excelente gestión de riesgo' : stats.calmarRatio >= 1 ? 'Buena gestión' : 'Mejorar gestión'
                  : 'Sin drawdown registrado'}
                color={stats.calmarRatio !== null ? (stats.calmarRatio >= 2 ? '#22c55e' : stats.calmarRatio >= 1 ? '#eab308' : '#f43f5e') : '#888'}
                pawColor="#a78bfa" />
              <StatCard label="Trades para recuperar racha"
                value={stats.recoveryRate !== null ? `${stats.recoveryRate} trades` : '—'}
                desc={stats.recoveryRate !== null ? `Para recuperar la racha de ${stats.maxLossStrk} pérdidas` : ''}
                color="#eab308" pawColor="#eab308" />
              <StatCard label="Duración promedio" value={`${stats.avgDuration} días`}
                desc="En cerrar una posición" color="#888" pawColor="#888" />
            </div>

            {/* ── F3: Eficiencia + Drawdown + Rachas ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>

              <div style={{ ...box, position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', bottom: -8, right: -8, pointerEvents: 'none' }}>
                  <Paw size={56} color="#00bfff" opacity={0.04} />
                </div>
                <div style={boxTitle}>
                  <Paw size={10} color="#00bfff" opacity={0.7} style={{ marginRight: 6 }} />
                  Eficiencia de trade
                </div>
                <Row label="Ganancia promedio"  value={money(stats.avgWin)}  color="#22c55e" />
                <Row label="Pérdida promedio"   value={money(stats.avgLoss)} color="#f43f5e" />
                <Row label="Ratio Win/Loss"     value={`${stats.winLossRatio}x`}
                  color={stats.winLossRatio >= 1 ? '#22c55e' : '#f43f5e'} />
                <div style={{ marginTop: 10, fontSize: 9, color: '#888' }}>
                  {stats.winLossRatio >= 1 ? 'Ganas más de lo que pierdes' : 'Pierdes más de lo que ganas'}
                </div>
              </div>

              <div style={{ ...box, position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', bottom: -8, right: -8, pointerEvents: 'none' }}>
                  <Paw size={56} color="#f43f5e" opacity={0.04} />
                </div>
                <div style={boxTitle}>
                  <Paw size={10} color="#f43f5e" opacity={0.7} style={{ marginRight: 6 }} />
                  Drawdown máximo
                </div>
                <div style={{ fontSize: 22, fontWeight: 900, color: '#f43f5e' }}>{money(stats.maxDD)}</div>
                <div style={{ fontSize: 10, color: '#888', marginTop: 4 }}>Caída máxima desde el pico de equity</div>
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 9, color: '#888', fontWeight: 700, textTransform: 'uppercase' as const, marginBottom: 4, letterSpacing: 0.5 }}>
                    Mejor trade (%)
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#22c55e' }}>
                    {stats.bestTradePct?.ticker} · +{stats.bestTradePct?.pct.toFixed(1)}%
                  </div>
                  <div style={{ fontSize: 9, color: '#888', fontWeight: 700, textTransform: 'uppercase' as const, marginBottom: 4, marginTop: 8, letterSpacing: 0.5 }}>
                    Peor trade (%)
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#f43f5e' }}>
                    {stats.worstTradePct?.ticker} · {stats.worstTradePct?.pct.toFixed(1)}%
                  </div>
                </div>
              </div>

              <div style={{ ...box, borderColor: 'rgba(34,197,94,0.2)', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: 8, right: 8, pointerEvents: 'none' }}>
                  <Whiskers color="#22c55e" opacity={0.12} width={70} />
                </div>
                <div style={{ ...boxTitle, color: '#22c55e' }}>
                  <Paw size={10} color="#22c55e" opacity={0.7} style={{ marginRight: 6 }} />
                  Racha ganadora máx.
                </div>
                <div style={{ fontSize: 36, fontWeight: 900, color: '#22c55e' }}>{stats.maxWinStrk}</div>
                <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>trades ganados consecutivos</div>
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 9, color: '#888', fontWeight: 700, textTransform: 'uppercase' as const, marginBottom: 4, letterSpacing: 0.5 }}>Mejor mes</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#22c55e', textTransform: 'capitalize' as const }}>{stats.bestMonth?.[0] || '—'}</div>
                  <div style={{ fontSize: 13, color: '#22c55e' }}>{stats.bestMonth ? money(stats.bestMonth[1].pnl) : ''}</div>
                </div>
              </div>

              <div style={{ ...box, borderColor: 'rgba(244,63,94,0.2)', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: 8, right: 8, pointerEvents: 'none' }}>
                  <Whiskers color="#f43f5e" opacity={0.12} width={70} />
                </div>
                <div style={{ ...boxTitle, color: '#f43f5e' }}>
                  <Paw size={10} color="#f43f5e" opacity={0.7} style={{ marginRight: 6 }} />
                  Racha perdedora máx.
                </div>
                <div style={{ fontSize: 36, fontWeight: 900, color: '#f43f5e' }}>{stats.maxLossStrk}</div>
                <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>trades perdidos consecutivos</div>
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 9, color: '#888', fontWeight: 700, textTransform: 'uppercase' as const, marginBottom: 4, letterSpacing: 0.5 }}>Peor mes</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#f43f5e', textTransform: 'capitalize' as const }}>{stats.worstMonth?.[0] || '—'}</div>
                  <div style={{ fontSize: 13, color: '#f43f5e' }}>{stats.worstMonth ? money(stats.worstMonth[1].pnl) : ''}</div>
                </div>
              </div>
            </div>

            {/* ── F4: Sectores + tops + mensual + razones de cierre ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1.3fr', gap: 12 }}>

              {/* Sectores */}
              <div style={{ ...box, position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', bottom: -8, right: -8, pointerEvents: 'none' }}>
                  <CatSitting size={48} color="#00bfff" opacity={0.04} />
                </div>
                <div style={boxTitle}>
                  <Paw size={10} color="#eab308" opacity={0.7} style={{ marginRight: 6 }} />
                  Rendimiento por sector
                </div>
                {[
                  { label: 'Mejor sector', data: stats.bestSector,  color: '#22c55e' },
                  { label: 'Peor sector',  data: stats.worstSector, color: '#f43f5e' },
                ].map(({ label, data, color }) => data && (
                  <div key={label} style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 9, color: '#888', fontWeight: 700, textTransform: 'uppercase' as const, marginBottom: 4, letterSpacing: 0.5 }}>{label}</div>
                    <div style={{ fontWeight: 700, color: '#00bfff', fontSize: 12 }}>{data[0]}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color, marginTop: 2 }}>{money(data[1] as number)}</div>
                  </div>
                ))}
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #111' }}>
                  <div style={{ fontSize: 9, color: '#888', fontWeight: 700, textTransform: 'uppercase' as const, marginBottom: 8, letterSpacing: 0.5 }}>Razones de cierre</div>
                  {Object.entries(stats.closeReasons)
                    .sort(([, a], [, b]) => b.count - a.count)
                    .slice(0, 4)
                    .map(([reason, data]) => (
                      <div key={reason} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #0f0f0f', fontSize: 10 }}>
                        <span style={{ color: '#aaa' }}>{reason}</span>
                        <span style={{ color: data.pnl >= 0 ? '#22c55e' : '#f43f5e', fontWeight: 600 }}>
                          {data.count}× · {money(data.pnl)}
                        </span>
                      </div>
                    ))}
                </div>
              </div>

              {/* Top winners */}
              <div style={{ ...box, borderColor: 'rgba(34,197,94,0.18)', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', bottom: -8, right: -8, pointerEvents: 'none' }}>
                  <Paw size={56} color="#22c55e" opacity={0.04} />
                </div>
                <div style={{ ...boxTitle, color: '#22c55e' }}>
                  <Paw size={10} color="#22c55e" opacity={0.7} style={{ marginRight: 6 }} />
                  Mejores cierres
                </div>
                {stats.topWinners.map((t, i) => (
                  <div key={t.id} style={listRow}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {i === 0 && <Paw size={9} color="#ffd700" opacity={0.8} />}
                      <span style={{ color: '#00bfff', fontWeight: 700 }}>{t.ticker}</span>
                    </span>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ color: '#22c55e', fontWeight: 700, fontSize: 12 }}>+{money(Number(t.realized_pnl))}</div>
                      {Number(t.total_invested) > 0 && (
                        <div style={{ color: '#888', fontSize: 9 }}>
                          +{((Number(t.realized_pnl) / Number(t.total_invested)) * 100).toFixed(1)}%
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Top losers */}
              <div style={{ ...box, borderColor: 'rgba(244,63,94,0.18)', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', bottom: -8, right: -8, pointerEvents: 'none' }}>
                  <Paw size={56} color="#f43f5e" opacity={0.04} />
                </div>
                <div style={{ ...boxTitle, color: '#f43f5e' }}>
                  <Paw size={10} color="#f43f5e" opacity={0.7} style={{ marginRight: 6 }} />
                  Peores cierres
                </div>
                {stats.topLosers.map((t, i) => (
                  <div key={t.id} style={listRow}>
                    <span style={{ color: '#00bfff', fontWeight: 700 }}>{t.ticker}</span>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ color: '#f43f5e', fontWeight: 700, fontSize: 12 }}>{money(Number(t.realized_pnl))}</div>
                      {Number(t.total_invested) > 0 && (
                        <div style={{ color: '#888', fontSize: 9 }}>
                          {((Number(t.realized_pnl) / Number(t.total_invested)) * 100).toFixed(1)}%
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Desglose mensual */}
              <div style={{ ...box, position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: 8, right: 8, pointerEvents: 'none' }}>
                  <Whiskers color="#00bfff" opacity={0.1} width={80} />
                </div>
                <div style={boxTitle}>
                  <Paw size={10} color="#00bfff" opacity={0.7} style={{ marginRight: 6 }} />
                  Desglose mensual
                </div>
                <div style={{ maxHeight: 240, overflowY: 'auto', paddingRight: 4 }}>
                  {Object.entries(stats.monthlyStats).reverse().map(([month, data]) => (
                    <div key={month} style={listRow}>
                      <div>
                        <div style={{ fontSize: 11, color: '#aaa', textTransform: 'capitalize' as const }}>{month}</div>
                        <div style={{ fontSize: 9, color: '#666' }}>
                          {data.count} trades · {Math.round((data.wins / data.count) * 100)}% WR
                        </div>
                      </div>
                      <span style={{ fontWeight: 700, color: data.pnl >= 0 ? '#22c55e' : '#f43f5e' }}>
                        {money(data.pnl)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

          </div>
        )}
      </div>
    </AppShell>
  )
}

function StatCard({ label, value, desc, color = 'white', bar, pawColor = '#666' }: any) {
  return (
    <div style={{ background: '#080808', border: '1px solid #1a1a1a', padding: '16px 18px', borderRadius: 10, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', bottom: -10, right: -10, pointerEvents: 'none' }}>
        <Paw size={50} color={pawColor} opacity={0.04} />
      </div>
      <div style={{ fontSize: 9, color: '#888', marginBottom: 8, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 5 }}>
        <Paw size={9} color={pawColor} opacity={0.5} />
        {label}
      </div>
      <div style={{ fontSize: 21, fontWeight: 900, color }}>{value}</div>
      {desc && <div style={{ fontSize: 10, color: '#888', marginTop: 5 }}>{desc}</div>}
      {bar !== undefined && (
        <div style={{ height: 3, background: '#111', borderRadius: 2, marginTop: 10 }}>
          <div style={{ height: '100%', width: `${Math.min(bar, 100)}%`, background: bar >= 50 ? '#22c55e' : '#f43f5e', borderRadius: 2 }} />
        </div>
      )}
    </div>
  )
}

function Row({ label, value, color = '#ccc' }: any) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #111', fontSize: 11 }}>
      <span style={{ color: '#aaa' }}>{label}</span>
      <span style={{ fontWeight: 700, color }}>{value}</span>
    </div>
  )
}

const filterBtn = (active: boolean): React.CSSProperties => ({
  padding: '6px 14px', borderRadius: 6, border: 'none',
  background: active ? '#00bfff' : '#111',
  color: active ? '#000' : '#aaa',
  cursor: 'pointer', fontSize: 10, fontWeight: 'bold',
})
const selectStyle: React.CSSProperties = { background: '#080808', color: '#ccc', border: '1px solid #222', padding: '6px 10px', borderRadius: 6, fontSize: 11, outline: 'none' }
const box: React.CSSProperties         = { background: '#080808', border: '1px solid #1a1a1a', padding: '16px 18px', borderRadius: 10 }
const boxTitle: React.CSSProperties    = { fontSize: 9, color: '#888', marginBottom: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', display: 'flex', alignItems: 'center' }
const listRow: React.CSSProperties     = { display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #0f0f0f', fontSize: 11, alignItems: 'center' }