'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { usePrivacy } from '@/lib/PrivacyContext'
import AppShell from '../AppShell'
import { BarChart2 } from 'lucide-react'

const parseDate = (d: string) => new Date((d || '').split('T')[0] + 'T00:00:00')

export default function EstadisticasAbiertosPage() {
  const { money } = usePrivacy()

  const [trades,            setTrades]            = useState<any[]>([])
  const [portfolios,        setPortfolios]        = useState<any[]>([])
  const [selectedPortfolio, setSelectedPortfolio] = useState('all')
  const [selectedYear,      setSelectedYear]      = useState('all')

  const fetchData = useCallback(async () => {
    const { data: pData } = await supabase.from('portfolios').select('*')
    if (pData) setPortfolios(pData)
    const { data: tData } = await supabase
      .from('trades')
      .select('*, portfolios(name)')
      .eq('status', 'open')
    if (tData) setTrades(tData)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const availableYears = useMemo(() => {
    const years = trades.map(t => parseDate(t.open_date).getFullYear().toString())
    return Array.from(new Set(years)).sort((a, b) => b.localeCompare(a))
  }, [trades])

  const filteredTrades = useMemo(() => {
    return trades.filter(t => {
      const matchPortfolio = selectedPortfolio === 'all' || t.portfolio_id === selectedPortfolio
      const matchYear      = selectedYear === 'all' || parseDate(t.open_date).getFullYear().toString() === selectedYear
      return matchPortfolio && matchYear
    })
  }, [trades, selectedPortfolio, selectedYear])

  const stats = useMemo(() => {
    if (!filteredTrades.length) return null

    const totalInvested = filteredTrades.reduce((acc, t) => acc + Number(t.total_invested || 0), 0)

    // Horizonte por nombre de billetera
    const horizonStats = { long: 0, mid: 0, short: 0 }
    filteredTrades.forEach(t => {
      const pName = (t.portfolios?.name || '').toLowerCase()
      const inv   = Number(t.total_invested || 0)
      if (pName.includes('largo'))       horizonStats.long  += inv
      else if (pName.includes('media'))  horizonStats.mid   += inv
      else                               horizonStats.short += inv
    })

    // Sectores con subsectores (no tickers)
    const sectorGroups: Record<string, { total: number, subsectors: Record<string, number> }> = {}
    filteredTrades.forEach(t => {
      const s   = t.sector    || 'Otros'
      const sub = t.subsector || 'General'
      const inv = Number(t.total_invested || 0)
      if (!sectorGroups[s]) sectorGroups[s] = { total: 0, subsectors: {} }
      sectorGroups[s].total += inv
      sectorGroups[s].subsectors[sub] = (sectorGroups[s].subsectors[sub] || 0) + inv
    })

    // Países
    const countryGroups: Record<string, { total: number, count: number }> = {}
    filteredTrades.forEach(t => {
      const c = t.country || 'Otros'
      const inv = Number(t.total_invested || 0)
      if (!countryGroups[c]) countryGroups[c] = { total: 0, count: 0 }
      countryGroups[c].total += inv
      countryGroups[c].count++
    })

    // Top riesgo (mayores posiciones)
    const topPositions = [...filteredTrades]
      .sort((a, b) => b.total_invested - a.total_invested)
      .slice(0, 5)

    // Duración promedio de trades abiertos (días desde apertura)
    const now = new Date()
    const avgDuration = filteredTrades.reduce((acc, t) => {
      const days = Math.ceil((now.getTime() - parseDate(t.open_date).getTime()) / (1000 * 60 * 60 * 24))
      return acc + days
    }, 0) / filteredTrades.length

    // Promedio R/R logrado (para los que tienen stop y al menos un TP)
    const rrTrades = filteredTrades.filter(t => t.stop_loss && t.take_profit_1 && t.entry_price)
    const avgRR = rrTrades.length > 0
      ? rrTrades.reduce((acc, t) => {
          const risk   = Math.abs(Number(t.entry_price) - Number(t.stop_loss))
          const reward = Math.abs(Number(t.take_profit_1) - Number(t.entry_price))
          return acc + (risk > 0 ? reward / risk : 0)
        }, 0) / rrTrades.length
      : 0

    // Mejor y peor mes (por valor invertido acumulado en ese mes)
    const monthMap: Record<string, number> = {}
    filteredTrades.forEach(t => {
      const m = parseDate(t.open_date).toLocaleDateString('es-MX', { year: 'numeric', month: 'short' })
      monthMap[m] = (monthMap[m] || 0) + Number(t.total_invested || 0)
    })
    const monthEntries = Object.entries(monthMap).sort((a, b) => b[1] - a[1])
    const bestMonth  = monthEntries[0]
    const worstMonth = monthEntries[monthEntries.length - 1]

    // Racha de ganadas / perdidas consecutivas (por realized_pnl)
    const sorted     = [...filteredTrades].sort((a, b) => parseDate(a.open_date).getTime() - parseDate(b.open_date).getTime())
    let maxWinStreak = 0, maxLoseStreak = 0, curWin = 0, curLose = 0
    sorted.forEach(t => {
      if (Number(t.realized_pnl || 0) > 0) { curWin++; curLose = 0; maxWinStreak = Math.max(maxWinStreak, curWin) }
      else                                   { curLose++; curWin = 0; maxLoseStreak = Math.max(maxLoseStreak, curLose) }
    })

    return {
      totalInvested, totalCount: filteredTrades.length,
      horizonStats, sectorGroups, countryGroups, topPositions,
      avgDuration: parseFloat(avgDuration.toFixed(1)),
      avgRR:       parseFloat(avgRR.toFixed(2)),
      bestMonth, worstMonth,
      maxWinStreak, maxLoseStreak,
    }
  }, [filteredTrades])

  return (
    <AppShell>
      <div style={{ maxWidth: 1400, margin: '20px auto', padding: '0 30px', color: 'white' }}>

        {/* HEADER */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <BarChart2 size={20} color="#00bfff" />
          <h1 style={{ fontSize: 18, fontWeight: 900, margin: 0 }}>Estrategia & riesgo — trades abiertos</h1>
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
          <div style={{ textAlign: 'center', padding: 80, color: '#333' }}>No hay trades abiertos para este filtro.</div>
        ) : (
          <div style={{ display: 'grid', gap: 18 }}>

            {/* CARDS PRINCIPALES */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
              <StatCard label="Capital expuesto"    value={money(stats.totalInvested)}      color="#00bfff" />
              <StatCard label="Posiciones abiertas" value={String(stats.totalCount)}         color="#fff" />
              <StatCard label="Duración promedio"   value={`${stats.avgDuration} días`}      color="#eab308"
                desc="Tiempo promedio en posición abierta" />
              <StatCard label="R/R promedio objetivo" value={stats.avgRR > 0 ? `${stats.avgRR}R` : '—'} color="#22c55e"
                desc={`Calculado sobre ${filteredTrades.filter(t => t.stop_loss && t.take_profit_1).length} trades con SL y TP`} />
            </div>

            {/* RACHAS Y MESES */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
              <StatCard label="Racha ganadora máx."  value={`${stats.maxWinStreak} seguidas`}  color="#22c55e" />
              <StatCard label="Racha perdedora máx." value={`${stats.maxLoseStreak} seguidas`} color="#f43f5e" />
              <StatCard
                label="Mes con más capital"
                value={stats.bestMonth?.[0] || '—'}
                desc={stats.bestMonth ? money(stats.bestMonth[1]) : ''}
                color="#00bfff"
              />
              <StatCard
                label="Mes con menos capital"
                value={stats.worstMonth?.[0] || '—'}
                desc={stats.worstMonth ? money(stats.worstMonth[1]) : ''}
                color="#888"
              />
            </div>

            {/* HORIZONTE + TOP RIESGO */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 14 }}>
              <div style={box}>
                <div style={boxTitle}>Horizonte por billetera</div>
                <div style={{ display: 'grid', gap: 12, marginTop: 4 }}>
                  <ProgressBar label="Largo plazo (>10a)"    val={stats.horizonStats.long}  total={stats.totalInvested} color="#22c55e" money={money} />
                  <ProgressBar label="Mediano plazo (1-5a)"  val={stats.horizonStats.mid}   total={stats.totalInvested} color="#eab308" money={money} />
                  <ProgressBar label="Corto / Especulativo"  val={stats.horizonStats.short} total={stats.totalInvested} color="#f43f5e" money={money} />
                </div>
              </div>

              <div style={box}>
                <div style={boxTitle}>Top 5 posiciones por tamaño</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 4 }}>
                  <thead>
                    <tr>
                      {['Ticker', 'Invertido', '% Cartera'].map(h => (
                        <th key={h} style={th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stats.topPositions.map(t => (
                      <tr key={t.ticker} style={{ borderBottom: '1px solid #111' }}>
                        <td style={td}><span style={{ color: '#00bfff', fontWeight: 700 }}>{t.ticker}</span></td>
                        <td style={td}>{money(t.total_invested)}</td>
                        <td style={td}>{(t.total_invested / stats.totalInvested * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* SECTORES CON SUBSECTORES */}
            <div style={box}>
              <div style={boxTitle}>Distribución por sector y subsector</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14, marginTop: 8 }}>
                {Object.entries(stats.sectorGroups)
                  .sort(([, a], [, b]) => b.total - a.total)
                  .map(([sector, data]) => (
                    <div key={sector} style={sectorCard}>
                      {/* Header del sector */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid #1a1a1a' }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#00bfff' }}>{sector}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>
                          {(data.total / stats.totalInvested * 100).toFixed(1)}%
                        </span>
                      </div>
                      {/* Subsectores */}
                      {Object.entries(data.subsectors)
                        .sort(([, a], [, b]) => b - a)
                        .map(([sub, val]) => (
                          <div key={sub} style={{ marginBottom: 8 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                              <span style={{ color: '#888' }}>{sub}</span>
                              <span style={{ color: '#aaa' }}>{(val / data.total * 100).toFixed(1)}%</span>
                            </div>
                            <div style={{ background: '#111', height: 3, borderRadius: 2 }}>
                              <div style={{
                                width: `${(val / data.total * 100)}%`,
                                background: '#00bfff',
                                height: '100%', borderRadius: 2,
                                opacity: 0.6,
                              }} />
                            </div>
                          </div>
                        ))}
                      {/* Total del sector */}
                      <div style={{ marginTop: 8, fontSize: 10, color: '#444', textAlign: 'right' }}>
                        {money(data.total)}
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            {/* DISTRIBUCIÓN GEOGRÁFICA */}
            <div style={box}>
              <div style={boxTitle}>Distribución geográfica</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10, marginTop: 8 }}>
                {Object.entries(stats.countryGroups)
                  .sort(([, a], [, b]) => b.total - a.total)
                  .map(([country, d]) => (
                    <div key={country} style={{ padding: '12px 14px', background: '#050505', borderRadius: 8, border: '1px solid #151515' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 700 }}>{country}</span>
                        <span style={{ fontSize: 12, color: '#00bfff', fontWeight: 700 }}>
                          {(d.total / stats.totalInvested * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div style={{ height: 3, background: '#111', borderRadius: 2, marginBottom: 6 }}>
                        <div style={{
                          width: `${d.total / stats.totalInvested * 100}%`,
                          background: '#00bfff', height: '100%', borderRadius: 2, opacity: 0.5,
                        }} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#444' }}>
                        <span>{d.count} posición{d.count !== 1 ? 'es' : ''}</span>
                        <span>{money(d.total)}</span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>

          </div>
        )}
      </div>
    </AppShell>
  )
}

function StatCard({ label, value, desc, color = 'white' }: any) {
  return (
    <div style={{ background: '#080808', border: '1px solid #151515', padding: '18px 20px', borderRadius: 10 }}>
      <div style={{ fontSize: 9, color: '#444', marginBottom: 8, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 900, color }}>{value}</div>
      {desc && <div style={{ fontSize: 10, color: '#555', marginTop: 5 }}>{desc}</div>}
    </div>
  )
}

function ProgressBar({ label, val, total, color, money }: any) {
  const pct = total > 0 ? (val / total) * 100 : 0
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 11 }}>
        <span style={{ color: '#777' }}>{label}</span>
        <span style={{ fontWeight: 700 }}>{pct.toFixed(1)}% <span style={{ color: '#444', fontWeight: 400 }}>· {money(val)}</span></span>
      </div>
      <div style={{ background: '#111', height: 4, borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, background: color, height: '100%', borderRadius: 2 }} />
      </div>
    </div>
  )
}

const box: React.CSSProperties         = { background: '#080808', border: '1px solid #151515', padding: '18px 20px', borderRadius: 10 }
const boxTitle: React.CSSProperties    = { fontSize: 9, color: '#444', marginBottom: 14, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }
const sectorCard: React.CSSProperties  = { padding: '14px', background: '#050505', borderRadius: 8, border: '1px solid #151515' }
const selectStyle: React.CSSProperties = { background: '#080808', color: '#fff', border: '1px solid #222', padding: '6px 10px', borderRadius: 6, fontSize: 11, outline: 'none' }
const filterBtn = (active: boolean): React.CSSProperties => ({
  padding: '6px 14px', borderRadius: 6, border: 'none',
  background: active ? '#00bfff' : '#111',
  color: active ? '#000' : '#555',
  cursor: 'pointer', fontSize: 10, fontWeight: 'bold',
})
const th: React.CSSProperties = { padding: '6px 10px', textAlign: 'left', fontSize: 9, color: '#444', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', borderBottom: '1px solid #111' }
const td: React.CSSProperties = { padding: '8px 10px', fontSize: 12, color: '#ccc' }