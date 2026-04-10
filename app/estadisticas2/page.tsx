'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { usePrivacy } from '@/lib/PrivacyContext'
import AppShell from '../AppShell'
import { TrendingUp } from 'lucide-react'

const parseDate = (d: string) => new Date((d || '').split('T')[0] + 'T00:00:00')

export default function EstadisticasCerradosPage() {
  const { money } = usePrivacy()

  const [trades,            setTrades]            = useState<any[]>([])
  const [portfolios,        setPortfolios]        = useState<any[]>([])
  const [selectedPortfolio, setSelectedPortfolio] = useState('all')
  const [selectedYear,      setSelectedYear]      = useState('all')

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
    return Array.from(new Set(years)).sort((a, b) => b.localeCompare(a))
  }, [trades])

  const filteredTrades = useMemo(() => {
    return trades.filter(t => {
      // Fix: filtrar por portfolio_id no por nombre
      const matchPortfolio = selectedPortfolio === 'all' || t.portfolio_id === selectedPortfolio
      const matchYear      = selectedYear === 'all' || parseDate(t.close_date || t.open_date).getFullYear().toString() === selectedYear
      return matchPortfolio && matchYear
    })
  }, [trades, selectedPortfolio, selectedYear])

  const stats = useMemo(() => {
    if (!filteredTrades.length) return null

    const sorted = [...filteredTrades].sort(
      (a, b) => parseDate(a.close_date).getTime() - parseDate(b.close_date).getTime()
    )

    const totalTrades = sorted.length
    const wins   = sorted.filter(t => Number(t.realized_pnl) > 0)
    const losses = sorted.filter(t => Number(t.realized_pnl) < 0)

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
          Math.abs(parseDate(t.close_date).getTime() - parseDate(t.open_date).getTime()) / (1000 * 60 * 60 * 24)
        ))
        return acc + days
      }, 0) / totalTrades
    ).toFixed(1))

    // Streaks y drawdown
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

    // Distribución mensual
    const monthlyStats: Record<string, { count: number, pnl: number }> = {}
    sorted.forEach(t => {
      const key = parseDate(t.close_date).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })
      if (!monthlyStats[key]) monthlyStats[key] = { count: 0, pnl: 0 }
      monthlyStats[key].count++
      monthlyStats[key].pnl = parseFloat((monthlyStats[key].pnl + Number(t.realized_pnl || 0)).toFixed(2))
    })

    // Mejor y peor mes
    const monthEntries  = Object.entries(monthlyStats)
    const bestMonth     = monthEntries.sort(([, a], [, b]) => b.pnl - a.pnl)[0]
    const worstMonth    = monthEntries.sort(([, a], [, b]) => a.pnl - b.pnl)[0]

    // Sectores con mayor/menor rendimiento
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
      topWinners: [...sorted].sort((a, b) => Number(b.realized_pnl) - Number(a.realized_pnl)).slice(0, 5),
      topLosers:  [...sorted].sort((a, b) => Number(a.realized_pnl) - Number(b.realized_pnl)).slice(0, 5),
      monthlyStats,
    }
  }, [filteredTrades])

  return (
    <AppShell>
      <div style={{ maxWidth: 1400, margin: '20px auto', padding: '0 30px', color: 'white' }}>

        {/* HEADER */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <TrendingUp size={20} color="#00bfff" />
          <h1 style={{ fontSize: 18, fontWeight: 900, margin: 0 }}>Performance histórico — trades cerrados</h1>
        </div>

        {/* FILTROS */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 28, flexWrap: 'wrap', alignItems: 'center' }}>
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
          <div style={{ textAlign: 'center', padding: 80, color: '#333' }}>No hay trades cerrados para este filtro.</div>
        ) : (
          <div style={{ display: 'grid', gap: 16 }}>

            {/* FILA 1: KPIs principales */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
              <StatCard
                label="PnL total acumulado"
                value={money(stats.totalPnL)}
                color={stats.totalPnL >= 0 ? '#22c55e' : '#f43f5e'}
              />
              <StatCard
                label="Win rate"
                value={`${stats.winRate}%`}
                desc={`${stats.totalTrades} trades totales`}
                color="#fff"
                bar={stats.winRate}
              />
              <StatCard
                label="Profit factor"
                value={String(stats.profitFactor)}
                desc={stats.profitFactor >= 1.5 ? 'Sistema rentable' : stats.profitFactor >= 1 ? 'Marginalmente rentable' : 'Sistema con pérdidas'}
                color={stats.profitFactor >= 1.5 ? '#22c55e' : stats.profitFactor >= 1 ? '#eab308' : '#f43f5e'}
              />
              <StatCard
                label="Expectativa por trade"
                value={money(stats.expectancy)}
                desc={`Por cada trade, en promedio ${stats.expectancy >= 0 ? 'ganas' : 'pierdes'} ${money(Math.abs(stats.expectancy))}`}
                color="#00bfff"
              />
            </div>

            {/* FILA 2: Eficiencia + rachas + drawdown + duración */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>

              <div style={box}>
                <div style={boxTitle}>Eficiencia de trade</div>
                <Row label="Ganancia promedio"  value={money(stats.avgWin)}  color="#22c55e" />
                <Row label="Pérdida promedio"   value={money(stats.avgLoss)} color="#f43f5e" />
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #111' }}>
                  <div style={{ fontSize: 9, color: '#444', marginBottom: 4, fontWeight: 700, textTransform: 'uppercase' as const }}>Ratio Win/Loss</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: stats.winLossRatio >= 1 ? '#22c55e' : '#f43f5e' }}>
                    {stats.winLossRatio}x
                  </div>
                  <div style={{ fontSize: 10, color: '#444', marginTop: 3 }}>
                    {stats.winLossRatio >= 1 ? 'Ganas más de lo que pierdes' : 'Pierdes más de lo que ganas'}
                  </div>
                </div>
              </div>

              <div style={box}>
                <div style={boxTitle}>Drawdown máximo</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: '#f43f5e' }}>{money(stats.maxDD)}</div>
                <div style={{ fontSize: 10, color: '#444', marginTop: 6 }}>Caída máxima desde el pico de equity</div>
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 9, color: '#444', marginBottom: 4, fontWeight: 700, textTransform: 'uppercase' as const }}>Duración promedio</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: '#eab308' }}>{stats.avgDuration} días</div>
                  <div style={{ fontSize: 10, color: '#444', marginTop: 3 }}>en cerrar una posición</div>
                </div>
              </div>

              <div style={{ ...box, borderColor: 'rgba(34,197,94,0.2)' }}>
                <div style={{ ...boxTitle, color: '#22c55e' }}>Racha ganadora máx.</div>
                <div style={{ fontSize: 32, fontWeight: 900 }}>{stats.maxWinStrk}</div>
                <div style={{ fontSize: 10, color: '#444', marginTop: 4 }}>trades ganados consecutivos</div>
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 9, color: '#444', marginBottom: 4, fontWeight: 700, textTransform: 'uppercase' as const }}>Mejor mes</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#22c55e' }}>{stats.bestMonth?.[0] || '—'}</div>
                  <div style={{ fontSize: 11, color: '#22c55e' }}>{stats.bestMonth ? money(stats.bestMonth[1].pnl) : ''}</div>
                </div>
              </div>

              <div style={{ ...box, borderColor: 'rgba(244,67,54,0.2)' }}>
                <div style={{ ...boxTitle, color: '#f43f5e' }}>Racha perdedora máx.</div>
                <div style={{ fontSize: 32, fontWeight: 900 }}>{stats.maxLossStrk}</div>
                <div style={{ fontSize: 10, color: '#444', marginTop: 4 }}>trades perdidos consecutivos</div>
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 9, color: '#444', marginBottom: 4, fontWeight: 700, textTransform: 'uppercase' as const }}>Peor mes</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#f43f5e' }}>{stats.worstMonth?.[0] || '—'}</div>
                  <div style={{ fontSize: 11, color: '#f43f5e' }}>{stats.worstMonth ? money(stats.worstMonth[1].pnl) : ''}</div>
                </div>
              </div>
            </div>

            {/* FILA 3: Sectores + tops + mensual */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1.4fr', gap: 14 }}>

              <div style={box}>
                <div style={boxTitle}>Rendimiento por sector</div>
                {[stats.bestSector, stats.worstSector].filter(Boolean).map(([sector, pnl]: any, i) => (
                  <div key={sector} style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 9, color: '#444', fontWeight: 700, textTransform: 'uppercase' as const, marginBottom: 4 }}>
                      {i === 0 ? 'Mejor sector' : 'Peor sector'}
                    </div>
                    <div style={{ fontWeight: 700, color: '#00bfff', fontSize: 12 }}>{sector}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: pnl >= 0 ? '#22c55e' : '#f43f5e', marginTop: 2 }}>
                      {money(pnl)}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ ...box, borderColor: 'rgba(34,197,94,0.2)' }}>
                <div style={{ ...boxTitle, color: '#22c55e' }}>Mejores cierres</div>
                {stats.topWinners.map(t => (
                  <div key={t.id} style={listRow}>
                    <span style={{ color: '#00bfff', fontWeight: 700 }}>{t.ticker}</span>
                    <span style={{ color: '#22c55e', fontWeight: 700 }}>{money(Number(t.realized_pnl))}</span>
                  </div>
                ))}
              </div>

              <div style={{ ...box, borderColor: 'rgba(244,67,54,0.2)' }}>
                <div style={{ ...boxTitle, color: '#f43f5e' }}>Peores cierres</div>
                {stats.topLosers.map(t => (
                  <div key={t.id} style={listRow}>
                    <span style={{ color: '#00bfff', fontWeight: 700 }}>{t.ticker}</span>
                    <span style={{ color: '#f43f5e', fontWeight: 700 }}>{money(Number(t.realized_pnl))}</span>
                  </div>
                ))}
              </div>

              <div style={box}>
                <div style={boxTitle}>Desglose mensual</div>
                <div style={{ maxHeight: 200, overflowY: 'auto', paddingRight: 4 }}>
                  {Object.entries(stats.monthlyStats)
                    .reverse()
                    .map(([month, data]) => (
                      <div key={month} style={listRow}>
                        <span style={{ fontSize: 11, color: '#777', textTransform: 'capitalize' as const }}>{month}</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 10, color: '#333' }}>{data.count} trades</span>
                          <span style={{ fontWeight: 700, color: data.pnl >= 0 ? '#22c55e' : '#f43f5e' }}>
                            {money(data.pnl)}
                          </span>
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

function StatCard({ label, value, desc, color = 'white', bar }: any) {
  return (
    <div style={{ background: '#080808', border: '1px solid #151515', padding: '18px 20px', borderRadius: 10 }}>
      <div style={{ fontSize: 9, color: '#444', marginBottom: 8, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 900, color }}>{value}</div>
      {desc && <div style={{ fontSize: 10, color: '#555', marginTop: 5 }}>{desc}</div>}
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
      <span style={{ color: '#666' }}>{label}</span>
      <span style={{ fontWeight: 700, color }}>{value}</span>
    </div>
  )
}

const box: React.CSSProperties         = { background: '#080808', border: '1px solid #151515', padding: '16px 18px', borderRadius: 10 }
const boxTitle: React.CSSProperties    = { fontSize: 9, color: '#444', marginBottom: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }
const listRow: React.CSSProperties     = { display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #0f0f0f', fontSize: 11, alignItems: 'center' }
const selectStyle: React.CSSProperties = { background: '#080808', color: '#fff', border: '1px solid #222', padding: '6px 10px', borderRadius: 6, fontSize: 11, outline: 'none' }
const filterBtn = (active: boolean): React.CSSProperties => ({
  padding: '6px 14px', borderRadius: 6, border: 'none',
  background: active ? '#00bfff' : '#111',
  color: active ? '#000' : '#555',
  cursor: 'pointer', fontSize: 10, fontWeight: 'bold',
})