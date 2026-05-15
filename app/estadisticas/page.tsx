'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { usePrivacy } from '@/lib/PrivacyContext'
import AppShell from '../AppShell'
import { BarChart2, ChevronDown, ChevronUp, X } from 'lucide-react'

const parseDate = (d: string) => new Date((d || '').split('T')[0] + 'T00:00:00')

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
const Whiskers = ({ color = '#00bfff', opacity = 0.08 }: any) => (
  <svg width={80} height={28} viewBox="0 0 80 28" stroke={color} strokeWidth="1.5" style={{ opacity }}>
    <line x1="0" y1="8"  x2="34" y2="14"/><line x1="0" y1="16" x2="34" y2="14"/>
    <line x1="0" y1="24" x2="34" y2="14"/><line x1="80" y1="8"  x2="46" y2="14"/>
    <line x1="80" y1="16" x2="46" y2="14"/><line x1="80" y1="24" x2="46" y2="14"/>
  </svg>
)

export default function EstadisticasAbiertosPage() {
  const { money } = usePrivacy()

  const [trades,            setTrades]            = useState<any[]>([])
  const [portfolios,        setPortfolios]        = useState<any[]>([])
  const [selectedPortfolio, setSelectedPortfolio] = useState('all')

  // Expand state para sectores y países
  const [expandedSector,  setExpandedSector]  = useState<string | null>(null)
  const [expandedCountry, setExpandedCountry] = useState<string | null>(null)
  // Modal de tickers
  const [modal, setModal] = useState<{ title: string, tickers: { ticker: string, invested: number, pnl: number }[] } | null>(null)

  const fetchData = useCallback(async () => {
    const [{ data: pData }, { data: tData }] = await Promise.all([
      supabase.from('portfolios').select('*'),
      supabase.from('trades').select('*, portfolios(name)').eq('status', 'open'),
    ])
    if (pData) setPortfolios(pData)
    if (tData) setTrades(tData)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const filteredTrades = useMemo(() => {
    if (selectedPortfolio === 'all') return trades
    return trades.filter(t => t.portfolio_id === selectedPortfolio)
  }, [trades, selectedPortfolio])

  const stats = useMemo(() => {
    if (!filteredTrades.length) return null

    const totalInvested = filteredTrades.reduce((acc, t) => acc + Number(t.total_invested || 0), 0)
    const totalCurrent = filteredTrades.reduce((acc, t) => {
      const qty = Number(t.quantity || 0)
      const cur = Number(t.last_price || t.entry_price || 0)
      return acc + qty * cur
    }, 0)
    const totalPnL = totalCurrent - totalInvested

    const totalPnLPct =
      totalInvested > 0
        ? (totalPnL / totalInvested) * 100
        : 0

    // Horizonte
    const horizonStats = { long: 0, mid: 0, short: 0 }
    trades.forEach(t => {
      const pName = (t.portfolios?.name || '').toLowerCase()
      const inv   = Number(t.total_invested || 0)
      if (pName.includes('largo'))      horizonStats.long  += inv
      else if (pName.includes('media')) horizonStats.mid   += inv
      else                              horizonStats.short += inv
    })

    // Sectores con tickers por subsector
    const sectorGroups: Record<string, {
      total: number
      subsectors: Record<string, { total: number, tickers: { ticker: string, invested: number, pnl: number }[] }>
    }> = {}
    filteredTrades.forEach(t => {
      const s   = t.sector    || 'Otros'
      const sub = t.subsector || 'General'
      const inv = Number(t.total_invested || 0)
      const pnl = Number(t.realized_pnl   || 0)
      if (!sectorGroups[s]) sectorGroups[s] = { total: 0, subsectors: {} }
      sectorGroups[s].total += inv
      if (!sectorGroups[s].subsectors[sub]) sectorGroups[s].subsectors[sub] = { total: 0, tickers: [] }
      sectorGroups[s].subsectors[sub].total += inv
      sectorGroups[s].subsectors[sub].tickers.push({ ticker: t.ticker, invested: inv, pnl })
    })

    // Países con tickers
    const countryGroups: Record<string, { total: number, count: number, tickers: { ticker: string, invested: number, pnl: number }[] }> = {}
    filteredTrades.forEach(t => {
      const c   = t.country || 'Otros'
      const inv = Number(t.total_invested || 0)
      const pnl = Number(t.realized_pnl   || 0)
      if (!countryGroups[c]) countryGroups[c] = { total: 0, count: 0, tickers: [] }
      countryGroups[c].total += inv
      countryGroups[c].count++
      countryGroups[c].tickers.push({ ticker: t.ticker, invested: inv, pnl })
    })

    // Top 5 por tamaño
    const topPositions = [...filteredTrades].sort((a, b) => b.total_invested - a.total_invested).slice(0, 5)

    // Top 5 mayores ganancias y pérdidas (por realized_pnl)
    const withPnl = filteredTrades.map(t => {
      const qty      = Number(t.quantity || 0)
      const avgPrice = qty > 0 ? Number(t.total_invested || 0) / qty : Number(t.entry_price || 0)
      const curPrice = Number(t.last_price || t.entry_price || 0)
      const pnl      = parseFloat(((curPrice - avgPrice) * qty).toFixed(2))
      return { ...t, pnl }
    })
    const winningTrades = withPnl.filter(t => t.pnl > 0).length
    const losingTrades  = withPnl.filter(t => t.pnl < 0).length

    const topGains  = [...withPnl].sort((a, b) => b.pnl - a.pnl).slice(0, 5)
    const topLosses = [...withPnl].sort((a, b) => a.pnl - b.pnl).slice(0, 5)
    // Duración promedio
    const now = new Date()
    const avgDuration = filteredTrades.reduce((acc, t) =>
      acc + Math.ceil((now.getTime() - parseDate(t.open_date).getTime()) / 86400000), 0
    ) / filteredTrades.length

    // R/R promedio
    const rrTrades = filteredTrades.filter(t => t.stop_loss && t.take_profit_1 && t.entry_price)
    const avgRR    = rrTrades.length > 0
      ? rrTrades.reduce((acc, t) => {
          const risk   = Math.abs(Number(t.entry_price) - Number(t.stop_loss))
          const reward = Math.abs(Number(t.take_profit_1) - Number(t.entry_price))
          return acc + (risk > 0 ? reward / risk : 0)
        }, 0) / rrTrades.length
      : 0

    return {
      totalInvested,
      totalCurrent,
      totalPnL,
      totalPnLPct,
      winningTrades,
      losingTrades,
      totalCount: filteredTrades.length,
      horizonStats, sectorGroups, countryGroups,
      topPositions, topGains, topLosses,
      avgDuration: parseFloat(avgDuration.toFixed(1)),
      avgRR:       parseFloat(avgRR.toFixed(2)),
      rrCount:     rrTrades.length,
    }
  }, [filteredTrades])

  const openModal = (title: string, tickers: { ticker: string, invested: number, pnl: number }[]) => {
    setModal({ title, tickers: [...tickers].sort((a, b) => b.invested - a.invested) })
  }

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
          <h1 style={{ fontSize: 18, fontWeight: 900, margin: 0 }}>Estrategia & riesgo — trades abiertos</h1>
        </div>

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

            {/* ── KPIs PRINCIPALES ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              <StatCard 
                label="Capital expuesto / actual / %" 
                value={
                  <>
                    <span style={{ color: '#00bfff' }}>
                      {money(stats.totalInvested)}
                    </span>

                    <span style={{ color: '#666' }}> / </span>

                    <span style={{
                      color:
                        stats.totalPnL > 0
                          ? '#22c55e'
                          : stats.totalPnL < 0
                          ? '#f43f5e'
                          : '#fff'
                    }}>
                      {money(stats.totalCurrent)}
                    </span>

                    <span style={{ color: '#666' }}> / </span>

                    <span style={{
                      color:
                        stats.totalPnL > 0
                          ? '#22c55e'
                          : stats.totalPnL < 0
                          ? '#f43f5e'
                          : '#fff'
                    }}>
                      {stats.totalPnLPct.toFixed(1)}%
                    </span>
                  </>
                }
              />
            <StatCard 
              label="Posiciones abiertas / Ganando / Perdiendo"     
              value={
                <>
                  <span style={{
                    color:
                      stats.winningTrades > stats.losingTrades
                        ? '#22c55e'
                        : stats.losingTrades > stats.winningTrades
                        ? '#f43f5e'
                        : '#fff'
                  }}>
                    {stats.totalCount}
                  </span>

                  <span style={{ color: '#666' }}> / </span>

                  <span style={{ color: '#22c55e' }}>
                    {stats.winningTrades}
                  </span>

                  <span style={{ color: '#666' }}> / </span>

                  <span style={{ color: '#f43f5e' }}>
                    {stats.losingTrades}
                  </span>
                </>
              }
            />
              <StatCard label="Duración promedio"       value={`${stats.avgDuration} días`} color="#eab308"
                desc="Tiempo promedio en posición" />
              <StatCard label="R/R promedio objetivo"   value={stats.avgRR > 0 ? `${stats.avgRR}R` : '—'} color="#22c55e"
                desc={`${stats.rrCount} trades con SL y TP`} />
            </div>

            {/* ── TOP POSICIONES / GANANCIAS / PÉRDIDAS ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              {/* Top 5 por tamaño */}
              <div style={{ ...box, position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', bottom: -8, right: -8, pointerEvents: 'none' }}>
                  <Paw size={60} color="#00bfff" opacity={0.03} />
                </div>
                <div style={boxTitle}>
                  <Paw size={10} color="#00bfff" opacity={0.6} style={{ marginRight: 6 }} />
                  Top 5 posiciones por tamaño
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    {['Ticker','Invertido','% Cartera'].map(h => <th key={h} style={th}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {stats.topPositions.map((t, i) => (
                      <tr key={t.ticker} style={{ borderBottom: '1px solid #111' }}>
                        <td style={td}>
                          <span style={{ color: i === 0 ? '#ffd700' : '#00bfff', fontWeight: 700 }}>{t.ticker}</span>
                        </td>
                        <td style={{ ...td, textAlign: 'right' }}>{money(t.total_invested)}</td>
                        <td style={{ ...td, textAlign: 'right', color: '#888' }}>
                          {(t.total_invested / stats.totalInvested * 100).toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Top 5 ganancias */}
              <div style={{ ...box, position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', bottom: -8, right: -8, pointerEvents: 'none' }}>
                  <Paw size={60} color="#22c55e" opacity={0.03} />
                </div>
                <div style={boxTitle}>
                  <Paw size={10} color="#22c55e" opacity={0.6} style={{ marginRight: 6 }} />
                  Top 5 mayores ganancias
                </div>
                {stats.topGains.filter(t => t.pnl > 0).length === 0 ? (
                  <div style={{ color: '#555', fontSize: 11, padding: '12px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Paw size={12} color="#333" opacity={0.5} />
                    Sin ganancias realizadas aún
                  </div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>
                      {['Ticker','PnL','% vs Inv.'].map(h => <th key={h} style={th}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {stats.topGains.filter(t => t.pnl > 0).map((t, i) => (
                        <tr key={t.ticker} style={{ borderBottom: '1px solid #111' }}>
                          <td style={td}><span style={{ color: '#22c55e', fontWeight: 700 }}>{t.ticker}</span></td>
                          <td style={{ ...td, textAlign: 'right', color: '#22c55e', fontWeight: 700 }}>
                            +{money(t.pnl)}
                          </td>
                          <td style={{ ...td, textAlign: 'right', color: '#888' }}>
                            {t.total_invested > 0 ? `+${(t.pnl / t.total_invested * 100).toFixed(1)}%` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Top 5 pérdidas */}
              <div style={{ ...box, position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', bottom: -8, right: -8, pointerEvents: 'none' }}>
                  <Paw size={60} color="#f43f5e" opacity={0.03} />
                </div>
                <div style={boxTitle}>
                  <Paw size={10} color="#f43f5e" opacity={0.6} style={{ marginRight: 6 }} />
                  Top 5 mayores pérdidas
                </div>
                {stats.topLosses.filter(t => t.pnl < 0).length === 0 ? (
                  <div style={{ color: '#555', fontSize: 11, padding: '12px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Paw size={12} color="#333" opacity={0.5} />
                    Sin pérdidas realizadas
                  </div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>
                      {['Ticker','PnL','% vs Inv.'].map(h => <th key={h} style={th}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {stats.topLosses.filter(t => t.pnl < 0).map((t, i) => (
                        <tr key={t.ticker} style={{ borderBottom: '1px solid #111' }}>
                          <td style={td}><span style={{ color: '#f43f5e', fontWeight: 700 }}>{t.ticker}</span></td>
                          <td style={{ ...td, textAlign: 'right', color: '#f43f5e', fontWeight: 700 }}>
                            {money(t.pnl)}
                          </td>
                          <td style={{ ...td, textAlign: 'right', color: '#888' }}>
                            {t.total_invested > 0 ? `${(t.pnl / t.total_invested * 100).toFixed(1)}%` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* ── HORIZONTE ── */}
            <div style={{ ...box, position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 8, right: 12, pointerEvents: 'none' }}>
                <Whiskers color="#888" opacity={0.1} />
              </div>
              <div style={boxTitle}>
                <Paw size={10} color="#eab308" opacity={0.6} style={{ marginRight: 6 }} />
                Horizonte por billetera
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginTop: 4 }}>
                <ProgressBar label="Largo plazo (>10a)"   val={stats.horizonStats.long}  total={stats.totalInvested} color="#22c55e" money={money} />
                <ProgressBar label="Mediano plazo (1-5a)" val={stats.horizonStats.mid}   total={stats.totalInvested} color="#eab308" money={money} />
                <ProgressBar label="Corto / Especulativo" val={stats.horizonStats.short} total={stats.totalInvested} color="#f43f5e" money={money} />
              </div>
            </div>

            {/* ── SECTORES con clic para ver tickers ── */}
            <div style={box}>
              <div style={boxTitle}>
                <Paw size={10} color="#00bfff" opacity={0.6} style={{ marginRight: 6 }} />
                Distribución por sector y subsector
                <span style={{ fontSize: 9, color: '#555', fontWeight: 400, marginLeft: 8 }}>· clic en subsector para ver tickers</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px,1fr))', gap: 12, marginTop: 8 }}>
                {Object.entries(stats.sectorGroups)
                  .sort(([, a], [, b]) => b.total - a.total)
                  .map(([sector, data]) => (
                    <div key={sector} style={sectorCard}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid #1a1a1a' }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#00bfff' }}>{sector}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>
                          {(data.total / stats.totalInvested * 100).toFixed(1)}%
                        </span>
                      </div>
                      {Object.entries(data.subsectors)
                        .sort(([, a], [, b]) => b.total - a.total)
                        .map(([sub, subData]) => {
                          const isOpen = expandedSector === `${sector}::${sub}`
                          return (
                            <div key={sub} style={{ marginBottom: 10 }}>
                              <button
                                onClick={() => {
                                  const key = `${sector}::${sub}`
                                  setExpandedSector(isOpen ? null : key)
                                  openModal(`${sector} · ${sub}`, subData.tickers)
                                }}
                                style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                                  <span style={{ color: '#aaa', display: 'flex', alignItems: 'center', gap: 5 }}>
                                    <Paw size={8} color="#aaa" opacity={0.4} />
                                    {sub}
                                    <span style={{ fontSize: 9, color: '#555', marginLeft: 3 }}>
                                      ({subData.tickers.length} ticker{subData.tickers.length !== 1 ? 's' : ''})
                                    </span>
                                  </span>
                                  <span style={{ color: '#888', display: 'flex', alignItems: 'center', gap: 4 }}>
                                    {(subData.total / data.total * 100).toFixed(1)}%
                                    <ChevronDown size={10} color="#555" />
                                  </span>
                                </div>
                              </button>
                              <div style={{ background: '#111', height: 3, borderRadius: 2 }}>
                                <div style={{ width: `${subData.total / data.total * 100}%`, background: '#00bfff', height: '100%', borderRadius: 2, opacity: 0.5 }} />
                              </div>
                            </div>
                          )
                        })}
                      <div style={{ fontSize: 10, color: '#555', textAlign: 'right', marginTop: 6 }}>{money(data.total)}</div>
                    </div>
                  ))}
              </div>
            </div>

            {/* ── DISTRIBUCIÓN GEOGRÁFICA con clic para ver tickers ── */}
            <div style={box}>
              <div style={boxTitle}>
                <Paw size={10} color="#eab308" opacity={0.6} style={{ marginRight: 6 }} />
                Distribución geográfica
                <span style={{ fontSize: 9, color: '#555', fontWeight: 400, marginLeft: 8 }}>· clic en país para ver tickers</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))', gap: 10, marginTop: 8 }}>
                {Object.entries(stats.countryGroups)
                  .sort(([, a], [, b]) => b.total - a.total)
                  .map(([country, d]) => (
                    <button
                      key={country}
                      onClick={() => openModal(`Tickers en ${country}`, d.tickers)}
                      style={{ ...countryCard, cursor: 'pointer', textAlign: 'left' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Paw size={9} color="#eab308" opacity={0.5} />
                          {country}
                        </span>
                        <span style={{ fontSize: 12, color: '#00bfff', fontWeight: 700 }}>
                          {(d.total / stats.totalInvested * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div style={{ height: 3, background: '#111', borderRadius: 2, marginBottom: 6 }}>
                        <div style={{ width: `${d.total / stats.totalInvested * 100}%`, background: '#00bfff', height: '100%', borderRadius: 2, opacity: 0.5 }} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#888' }}>
                        <span>{d.count} posición{d.count !== 1 ? 'es' : ''} · <span style={{ color: '#555' }}>clic para ver</span></span>
                        <span>{money(d.total)}</span>
                      </div>
                    </button>
                  ))}
              </div>
            </div>

          </div>
        )}

        {/* ── MODAL TICKERS ── */}
        {modal && (
          <div style={modalOverlay} onClick={() => setModal(null)}>
            <div style={modalBox} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Paw size={14} color="#00bfff" opacity={0.7} />
                  <h3 style={{ margin: 0, fontSize: 14, color: '#fff' }}>{modal.title}</h3>
                </div>
                <button onClick={() => setModal(null)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}>
                  <X size={16} />
                </button>
              </div>
              <div style={{ position: 'absolute', bottom: -10, right: -10, pointerEvents: 'none' }}>
                <Paw size={80} color="#00bfff" opacity={0.03} />
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #1a1a1a' }}>
                    {['Ticker','Invertido','PnL parcial'].map(h => <th key={h} style={{ ...th, padding: '6px 10px' }}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {modal.tickers.map(t => (
                    <tr key={t.ticker} style={{ borderBottom: '1px solid #111' }}>
                      <td style={{ ...td, color: '#00bfff', fontWeight: 700 }}>{t.ticker}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{money(t.invested)}</td>
                      <td style={{ ...td, textAlign: 'right', color: t.pnl >= 0 ? '#22c55e' : '#f43f5e', fontWeight: 600 }}>
                        {t.pnl !== 0 ? (t.pnl > 0 ? '+' : '') + money(t.pnl) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </AppShell>
  )
}

function StatCard({ label, value, desc, color = 'white' }: any) {
  return (
    <div style={{ background: '#080808', border: '1px solid #1a1a1a', padding: '16px 18px', borderRadius: 10, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', bottom: -8, right: -8, pointerEvents: 'none' }}>
        <Paw size={44} color="#fff" opacity={0.02} />
      </div>
      <div style={{ fontSize: 9, color: '#888', marginBottom: 8, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 900, color }}>
        {value}
      </div>
      {desc && <div style={{ fontSize: 10, color: '#666', marginTop: 5 }}>{desc}</div>}
    </div>
  )
}

function ProgressBar({ label, val, total, color, money }: any) {
  const pct = total > 0 ? (val / total) * 100 : 0
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 11 }}>
        <span style={{ color: '#aaa' }}>{label}</span>
        <span style={{ fontWeight: 700, color: val > 0 ? color : '#555' }}>
          {pct.toFixed(1)}%
          <span style={{ color: '#666', fontWeight: 400 }}> · {val > 0 ? money(val) : '$0.00'}</span>
        </span>
      </div>
      <div style={{ background: '#111', height: 4, borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${Math.max(pct, 0)}%`, background: val > 0 ? color : '#222', height: '100%', borderRadius: 2 }} />
      </div>
    </div>
  )
}

const filterBtn = (active: boolean): React.CSSProperties => ({
  padding: '6px 14px', borderRadius: 6, border: 'none',
  background: active ? '#00bfff' : '#111',
  color: active ? '#000' : '#888',
  cursor: 'pointer', fontSize: 10, fontWeight: 'bold',
})
const box: React.CSSProperties         = { background: '#080808', border: '1px solid #1a1a1a', padding: '18px 20px', borderRadius: 12 }
const boxTitle: React.CSSProperties    = { fontSize: 9, color: '#888', marginBottom: 14, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', display: 'flex', alignItems: 'center' }
const sectorCard: React.CSSProperties  = { padding: 14, background: '#050505', borderRadius: 8, border: '1px solid #151515' }
const countryCard: React.CSSProperties = { padding: '12px 14px', background: '#050505', borderRadius: 8, border: '1px solid #151515', width: '100%' }
const th: React.CSSProperties          = { padding: '6px 10px', textAlign: 'left', fontSize: 9, color: '#888', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', borderBottom: '1px solid #1a1a1a' }
const td: React.CSSProperties          = { padding: '8px 10px', fontSize: 12, color: '#ccc' }
const modalOverlay: React.CSSProperties = { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.85)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }
const modalBox: React.CSSProperties     = { background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 14, padding: 24, width: 420, maxHeight: '80vh', overflowY: 'auto', position: 'relative' }