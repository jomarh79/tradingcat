'use client'

import { useEffect, useState, useMemo, useCallback } from "react"
import { supabase } from "@/lib/supabase"
import { usePrivacy } from "@/lib/PrivacyContext"
import AppShell from "../AppShell"
import TradeManagerModal from "../components/TradeManagerModal"
import AiInsightPanel from "../components/AiInsightPanel"
import { FaSort, FaSortUp, FaSortDown, FaSync } from 'react-icons/fa'
import { TrendingUp, Settings, Trash2, Star } from 'lucide-react'

const parseDate = (d: string) => new Date((d || '').split('T')[0] + 'T00:00:00')

const isMarketOpen = () => {
  const now = new Date()
  const mx  = new Date(now.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }))
  const day  = mx.getDay()
  const time = mx.getHours() + mx.getMinutes() / 60
  return day >= 1 && day <= 5 && time >= 7.5 && time < 15
}

// ── Paw SVG ────────────────────────────────────────────────────────────────
const Paw = ({ size = 14, color = '#333', opacity = 1 }: any) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ opacity, flexShrink: 0 }}>
    <ellipse cx="6"  cy="5"  rx="2.5" ry="3"/>
    <ellipse cx="11" cy="3"  rx="2.5" ry="3"/>
    <ellipse cx="16" cy="4"  rx="2.5" ry="3"/>
    <ellipse cx="19" cy="9"  rx="2"   ry="2.5"/>
    <path d="M12 22c-5 0-8-3-8-7 0-2.5 1.5-4.5 4-5.5 1-.4 2-.6 4-.6s3 .2 4 .6c2.5 1 4 3 4 5.5 0 4-3 7-8 7z"/>
  </svg>
)

// RSI color
const rsiColor = (rsi: number | null) => {
  if (rsi === null || rsi === undefined) return '#444'
  if (rsi < 30) return '#22c55e'   // sobrevendido
  if (rsi <= 45) return '#4caf50'
  if (rsi >= 80) return '#ff4444'  // muy sobrecomprado
  if (rsi >= 70) return '#f43f5e'  // sobrecomprado
  return '#666'                    // neutro — gris oscuro
}

export default function TradesAbiertosPage() {
  const { money, shares } = usePrivacy()

  const [selectedTrade,     setSelectedTrade]     = useState<any | null>(null)
  const [showAITerminal, setShowAITerminal] = useState(false)
  const [trades,            setTrades]            = useState<any[]>([])
  const [portfolios,        setPortfolios]        = useState<any[]>([])
  const [selectedPortfolio, setSelectedPortfolio] = useState("all")
  const [tickerFilter, setTickerFilter] = useState("all")
  const [tickerSearch, setTickerSearch] = useState("")
  const [isRefreshing,      setIsRefreshing]      = useState(false)
  const [lastRefresh,       setLastRefresh]       = useState<Date | null>(null)
  const [currentTime, setCurrentTime] = useState(new Date())


  const [checkedTargets, setCheckedTargets] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {}
    try { return JSON.parse(localStorage.getItem('tradercat_targets_v2') || '{}') } catch { return {} }
  })

  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' }>({
    key: 'ticker', direction: 'asc'
  })

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('tradercat_targets_v2', JSON.stringify(checkedTargets))
    }
  }, [checkedTargets])

  const fetchPortfolios = useCallback(async () => {
    const { data } = await supabase.from("portfolios").select("*")
    if (data) setPortfolios(data)
  }, [])

    const fetchTrades = useCallback(async () => {
    if (isRefreshing) return
    setIsRefreshing(true)
    try {
      const { data, error } = await supabase
        .from("trades")
        .select("*, portfolios(name, id)")
        .eq("status", "open")
      if (error) throw error
      if (data) setTrades(data)
    } catch (err) {
      console.error("Error cargando trades:", err)
    } finally {
      setIsRefreshing(false)
      setLastRefresh(new Date())
    }
  }, [isRefreshing])

  useEffect(() => {
  fetchTrades()
  fetchPortfolios() 
}, [])
  
  const toggleTarget = (id: string) =>
    setCheckedTargets(prev => ({ ...prev, [id]: !prev[id] }))

  const handleDelete = async (trade: any) => {
    if (!confirm(`¿Eliminar el trade de ${trade.ticker}? Se revertirán todos los movimientos en la billetera.`)) return
    await supabase.from("wallet_movements").delete()
      .eq("ticker", trade.ticker).eq("wallet_id", trade.portfolio_id).eq("movement_type", "trade")
    await supabase.from("trade_executions").delete().eq("trade_id", trade.id)
    await supabase.from("trades").delete().eq("id", trade.id)
    fetchTrades()
  }

  const handleTogglePriority = async (trade: any) => {
    await supabase.from("trades").update({ priority: !trade.priority }).eq("id", trade.id)
    fetchTrades()
  }

  const uniqueTickers = useMemo(() => {
  const set = new Set(trades.map(t => t.ticker))
  return ["all", ...Array.from(set).sort()]
}, [trades])

  const enrichedTrades = useMemo(() => {
 let filtered = trades

if (selectedPortfolio !== "all") {
  filtered = filtered.filter(t => t.portfolios?.id === selectedPortfolio)
}

if (tickerSearch.trim() !== "") {
  filtered = filtered.filter(t =>
    t.ticker.toLowerCase().includes(tickerSearch.toLowerCase())
  )
}
    const items = filtered.map(trade => {
      const qty      = parseFloat(Number(trade.quantity      || 0).toFixed(6))
      const invested = parseFloat(Number(trade.total_invested || 0).toFixed(2))
      const curPrice = parseFloat(Number(trade.last_price || trade.entry_price || 0).toFixed(2))
      const avgPrice = qty > 0
        ? parseFloat((invested / qty).toFixed(2))
        : parseFloat(Number(trade.entry_price || 0).toFixed(2))
      const pnl    = parseFloat(((curPrice - avgPrice) * qty).toFixed(2))
      const pnlPct = avgPrice > 0 ? parseFloat(((curPrice - avgPrice) / avgPrice * 100).toFixed(2)) : 0
      const curValue = parseFloat((curPrice * qty).toFixed(2))

      const stopDist = trade.stop_loss     ? Math.abs((curPrice - trade.stop_loss)     / curPrice * 100) : null
      const tp1Dist  = trade.take_profit_1 ? Math.abs((curPrice - trade.take_profit_1) / curPrice * 100) : null
      const nearStop = stopDist !== null && stopDist <= 2
      const nearTP   = tp1Dist  !== null && tp1Dist  <= 2

      // RSI desde watchlist — no requiere llamada extra a API
     const rsi = trade.rsi ?? null
      const dayChange = parseFloat(Number(trade.day_change || 0).toFixed(2))

      return {
        ...trade, curPrice, avgPrice, pnl, pnlPct,
        invested, curValue, nearStop, nearTP, rsi, dayChange,
      }
    })

    const totalValue = items.reduce((acc, i) => acc + i.curValue, 0)
    return items.map(item => ({
      ...item,
      portfolioWeight: totalValue > 0 ? parseFloat((item.curValue / totalValue * 100).toFixed(2)) : 0
    }))
  }, [trades, selectedPortfolio])

  const totals = useMemo(() => {
    const totalInvested = enrichedTrades.reduce((a, t) => a + t.invested, 0)
    const totalValue    = enrichedTrades.reduce((a, t) => a + t.curValue, 0)
    const totalPnl      = enrichedTrades.reduce((a, t) => a + t.pnl, 0)
    const totalPnlPct   = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0
    return { totalInvested, totalValue, totalPnl, totalPnlPct }
  }, [enrichedTrades])

  const sortedTrades = useMemo(() => {
    return [...enrichedTrades].sort((a, b) => {
      const v1 = a[sortConfig.key] ?? 0
      const v2 = b[sortConfig.key] ?? 0
      return sortConfig.direction === 'asc' ? (v1 < v2 ? -1 : 1) : (v1 > v2 ? -1 : 1)
    })
  }, [enrichedTrades, sortConfig])

  const requestSort = (key: string) => {
    setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc' }))
  }

  const SortIcon = ({ column }: { column: string }) => {
    if (sortConfig.key !== column) return <FaSort style={{ marginLeft: 4, opacity: 0.15 }} />
    return sortConfig.direction === 'asc'
      ? <FaSortUp   style={{ marginLeft: 4, color: '#00bfff' }} />
      : <FaSortDown style={{ marginLeft: 4, color: '#00bfff' }} />
  }

  const targetBtn = (checked: boolean, color: string): React.CSSProperties => ({
    color: checked ? '#333' : color, cursor: 'pointer', fontWeight: 'bold',
    background: 'none', border: 'none',
    textDecoration: checked ? 'line-through' : 'none', fontSize: '0.7rem',
  })

  const marketOpen = isMarketOpen()

  return (
    <AppShell>
      <div style={{ padding: '15px 25px', color: 'white', position: 'relative' }}>

        {/* Huella decorativa de fondo */}
        <div style={{ position: 'absolute', top: 8, right: 30, pointerEvents: 'none', display: 'flex', gap: 6, transform: 'rotate(-12deg)' }}>
          <Paw size={16} color="#22c55e" opacity={0.07} />
          <Paw size={12} color="#22c55e" opacity={0.05} />
          <Paw size={8}  color="#22c55e" opacity={0.03} />
        </div>

        {/* ── HEADER ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
          <h1 style={{ fontSize: '1.2rem', fontWeight: 900, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <TrendingUp size={20} color="#4caf50" />
            Trades abiertos
            <span style={{ fontSize: 11, color: '#666', fontWeight: 400 }}>({enrichedTrades.length})</span>
          </h1>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {/* Estado mercado */}
            <div style={{ fontSize: '0.65rem', fontWeight: 'bold', letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: marketOpen ? '#22c55e' : '#f43f5e', display: 'inline-block' }} />
                <span style={{ color: marketOpen ? '#22c55e' : '#f43f5e' }}>
                  {marketOpen ? 'Mercado abierto' : 'Mercado cerrado'}
                </span>
              </span>
              <span style={{ color: '#555' }}>
                {currentTime.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
              </span>
              {lastRefresh && (
                <span style={{ color: '#444' }}>
                  · actualizado {lastRefresh.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>

            {/* KPIs + botón */}
            <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
              <div style={summaryCard}>
                <span style={summaryLabel}>Invertido</span>
                <span style={{ color: '#fff', fontWeight: 700 }}>{money(totals.totalInvested)}</span>
              </div>
              <div style={summaryCard}>
                <span style={summaryLabel}>Valor actual</span>
                <span style={{ color: '#00bfff', fontWeight: 700 }}>{money(totals.totalValue)}</span>
              </div>
              <div style={summaryCard}>
                <span style={summaryLabel}>PnL total</span>
                <span style={{ color: totals.totalPnl >= 0 ? '#22c55e' : '#f43f5e', fontWeight: 700 }}>
                  {money(totals.totalPnl)} ({totals.totalPnlPct >= 0 ? '+' : ''}{totals.totalPnlPct.toFixed(2)}%)
                </span>
              </div>
              <button
                onClick={async () => {
                  await fetch("https://kdxqnaglhhjwnzvptqvt.supabase.co/functions/v1/update-trades", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer tradingcat-cron-2026"
                  }
                })

                fetchTrades()
              }}
                disabled={isRefreshing}
                style={refreshBtn(isRefreshing)}>
                <FaSync style={{ animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }} />
                {isRefreshing ? 'Actualizando...' : 'Actualizar'}
              </button>
            </div>
          </div>
        </div>
        

        {/* ── TABS PORTAFOLIOS ── */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, borderBottom: '1px solid #1a1a1a', paddingBottom: 10, overflowX: 'auto', alignItems: 'center' }}>
            {[{ id: 'all', name: 'Todos' }, ...portfolios].map(p => (
            <button key={p.id} onClick={() => setSelectedPortfolio(p.id)}
              style={portfolioTab(selectedPortfolio === p.id)}>
              {p.name}
            </button>
          ))}
          <input
            type="text"
            placeholder="🔍 Buscar ticker..."
            value={tickerSearch}
            onChange={e => setTickerSearch(e.target.value.toUpperCase())}
            style={{
              marginLeft: 'auto',
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid #222',
              background: '#0a0a0a',
              color: '#fff',
              fontSize: 11,
              fontWeight: 700,
              width: 160,
              outline: 'none',
            }}
          />
        </div>

        {/* ── TABLA ── */}
        <div style={{ overflowX: 'auto', background: '#050505', borderRadius: 12, border: '1px solid #1a1a1a' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#0a0a0a' }}>
                {[
                  { key: 'open_date',       label: 'Fecha' },
                  { key: 'ticker',          label: 'Ticker' },
                  { key: 'dayChange',       label: 'Var día' },
                  { key: 'rsi',             label: 'RSI' },
                  { key: 'pnlPct',          label: 'PnL %' },
                  { key: 'pnl',             label: 'PnL $' },
                  { key: 'portfolioWeight', label: '% Cartera' },
                  { key: 'quantity',        label: 'Cant.' },
                  { key: 'avgPrice',        label: 'AVG' },
                  { key: 'invested',        label: 'Invertido' },
                  { key: 'stop_loss',       label: 'Stop' },
                  { key: 'curPrice',        label: 'Actual' },
                  { key: 'take_profit_1',   label: 'TP 1' },
                  { key: 'take_profit_2',   label: 'TP 2' },
                  { key: 'take_profit_3',   label: 'TP 3' },
                  { key: null,              label: 'Acc.' },
                ].map(({ key, label }) => (
                  <th key={label} style={{ ...tableTh, cursor: key ? 'pointer' : 'default' }}
                    onClick={key ? () => requestSort(key) : undefined}>
                    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                      {label} {key && <SortIcon column={key} />}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedTrades.length === 0 && (
                <tr>
                  <td colSpan={16} style={{ padding: 40, textAlign: 'center', color: '#555' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                      <Paw size={28} color="#333" opacity={0.5} />
                      No hay trades abiertos.
                    </div>
                  </td>
                </tr>
              )}
              {sortedTrades.map(trade => {
                const rowBg = trade.priority
                  ? 'rgba(255,215,0,0.08)'
                  : trade.nearStop
                    ? 'rgba(255,17,0,0.10)'
                    : trade.nearTP
                      ? 'rgba(0,255,8,0.06)'
                      : 'transparent'

                return (
                  <tr key={trade.id} style={{ background: rowBg, borderBottom: '1px solid #0a0a0a' }}>

                    {/* Fecha */}
                    <td style={{ ...tdStyle, color: '#555', fontSize: '0.65rem' }}>
                      {trade.open_date
                        ? parseDate(trade.open_date).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: '2-digit'})
                        : '—'}
                    </td>

                    {/* Ticker */}
                    <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 'bold', color: '#00bfff' }}>
                      {trade.ticker}
                      <div style={{ fontSize: '0.55rem', color: '#444' }}>{trade.portfolios?.name}</div>
                    </td>

                    {/* Var día */}
                    <td style={{ ...tdStyle, color: trade.dayChange >= 0 ? '#4caf50' : '#f43f5e' }}>
                      {trade.dayChange >= 0 ? '+' : ''}{trade.dayChange.toFixed(2)}%
                    </td>

                    {/* RSI */}
                    <td style={{ ...tdStyle, fontWeight: 'bold', color: rsiColor(trade.rsi) }}>
                     {trade.rsi !== null && trade.rsi !== undefined
                        ? trade.rsi.toFixed(1)
                        : <span style={{ color: '#333' }}>—</span>}
                    </td>

                    {/* PnL % */}
                    <td style={{ ...tdStyle, fontWeight: 'bold', color: trade.pnlPct >= 0 ? '#4caf50' : '#f44336' }}>
                      {trade.pnlPct >= 0 ? '+' : ''}{trade.pnlPct.toFixed(2)}%
                    </td>

                    {/* PnL $ */}
                    <td style={{ ...tdStyle, color: trade.pnl >= 0 ? '#4caf50' : '#f44336' }}>
                      {money(trade.pnl)}
                    </td>

                    {/* % Cartera */}
                    <td style={{ ...tdStyle, color: '#666' }}>{trade.portfolioWeight.toFixed(2)}%</td>

                    {/* Cantidad */}
                    <td style={tdStyle}>{shares(trade.quantity)}</td>

                    {/* Avg */}
                    <td style={{ ...tdStyle, color: '#fbbf24'}}>{money(trade.avgPrice)}</td>

                    {/* Invertido */}
                    <td style={{ ...tdStyle, fontWeight: 'bold' }}>{money(trade.invested)}</td>

                    {/* Stop */}
                    <td style={tdStyle} onClick={() => toggleTarget(`${trade.id}-stop`)}>
                      <button style={targetBtn(checkedTargets[`${trade.id}-stop`], '#f44336')}>
                        {trade.stop_loss ? money(trade.stop_loss) : '—'}
                      </button>
                    </td>

                    {/* Precio actual */}
                    <td style={{ ...tdStyle, color: '#fbbf24', fontWeight: 'bold' }}>
                      {money(trade.curPrice)}
                    </td>

                    {/* TPs */}
                    {['take_profit_1', 'take_profit_2', 'take_profit_3'].map((tp, i) => (
                      <td key={tp} style={tdStyle} onClick={() => toggleTarget(`${trade.id}-tp${i + 1}`)}>
                        <button style={targetBtn(checkedTargets[`${trade.id}-tp${i + 1}`], '#4caf50')}>
                          {trade[tp] ? money(trade[tp]) : '—'}
                        </button>
                      </td>
                    ))}

                    {/* Acciones */}
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center' }}>
                        <button onClick={() => {
                          setSelectedTrade(trade)
                        }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#555', padding: 4, transition: 'color 0.2s' }}
                          onMouseEnter={e => (e.currentTarget.style.color = '#00bfff')}
                          onMouseLeave={e => (e.currentTarget.style.color = '#555')}>
                          <Settings size={14} />
                        </button>
                        <button onClick={() => handleDelete(trade)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2a2a2a', padding: 4, transition: 'color 0.2s' }}
                          onMouseEnter={e => (e.currentTarget.style.color = '#f43f5e')}
                          onMouseLeave={e => (e.currentTarget.style.color = '#2a2a2a')}>
                          <Trash2 size={14} />
                        </button>
                        <button onClick={() => handleTogglePriority(trade)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                          <Star size={13} fill={trade.priority ? '#ffd700' : 'none'} color={trade.priority ? '#ffd700' : '#333'} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 8, fontSize: 9, color: '#333', textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 5 }}>
          <Paw size={9} color="#333" opacity={0.4} />
          RSI y precios desde cron · actualiza cada 5min en horario de mercado
        </div>
      </div>

     {selectedTrade && (
      <>
        <TradeManagerModal
          trade={selectedTrade}
          onClose={() => {
            setSelectedTrade(null)
            setShowAITerminal(false)
            fetchTrades()
          }}
          onRefresh={fetchTrades}
        />

        {showAITerminal && (
          <AiInsightPanel
            ticker={selectedTrade.ticker}
            country={selectedTrade.country}
            sector={selectedTrade.sector}
            subsector={selectedTrade.subsector}
            onClose={() => setShowAITerminal(false)}
          />
        )}
      </>
    )}

      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </AppShell>
  )
}

const tableTh: React.CSSProperties = { textAlign: 'center', padding: '8px 6px', color: '#888', fontSize: '0.6rem', borderBottom: '1px solid #1a1a1a', textTransform: 'uppercase', userSelect: 'none', letterSpacing: 0.5, whiteSpace: 'nowrap' }
const tdStyle: React.CSSProperties = { padding: '5px 8px', fontSize: '0.72rem', borderBottom: '1px solid #0a0a0a', textAlign: 'center', whiteSpace: 'nowrap' }
const summaryCard: React.CSSProperties = { display: 'flex', flexDirection: 'column', fontSize: 11, gap: 2 }
const summaryLabel: React.CSSProperties = { fontSize: 9, color: '#888', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }
const refreshBtn = (loading: boolean): React.CSSProperties => ({
  background: '#0a0a0a', border: '1px solid #222',
  color: loading ? '#444' : '#eab308',
  padding: '6px 12px', borderRadius: 6, cursor: 'pointer',
  fontSize: 10, fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 6,
})
const portfolioTab = (active: boolean): React.CSSProperties => ({
  padding: '4px 12px', borderRadius: 4, border: 'none', cursor: 'pointer',
  background: active ? '#22c55e' : 'transparent',
  color: active ? '#000' : '#888',
  fontSize: 10, fontWeight: 'bold', whiteSpace: 'nowrap',
})