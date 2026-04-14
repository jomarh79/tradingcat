'use client'

import { useEffect, useState, useMemo, useCallback } from "react"
import { supabase } from "@/lib/supabase"
import { usePrivacy } from "@/lib/PrivacyContext"
import AppShell from "../AppShell"
import TradeManagerModal from "../components/TradeManagerModal"
import { FaSort, FaSortUp, FaSortDown, FaSync } from 'react-icons/fa'
import { TrendingUp, Settings, Trash2, Star } from 'lucide-react'

const FINNHUB_API_KEY = process.env.NEXT_PUBLIC_FINNHUB_KEY
const MARKET_CACHE_KEY = 'tradercat_market_data'
const TARGETS_KEY      = 'tradercat_targets_v2'

const parseDate = (d: string) => new Date((d || '').split('T')[0] + 'T00:00:00')

const isMarketOpen = () => {
  const now = new Date()
  const day = now.getDay()
  const hour = now.getHours()
  return day !== 0 && day !== 6 && hour >= 8 && hour < 15
}

const calculateRSI = (prices: number[], period = 14) => {
  if (!prices || prices.length < period + 1) return null
  let gains = 0, losses = 0
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1]
    if (diff >= 0) gains += diff; else losses -= diff
  }
  let avgGain = gains / period, avgLoss = losses / period
  for (let i = period + 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1]
    avgGain = ((avgGain * (period - 1)) + (diff > 0 ? diff : 0)) / period
    avgLoss = ((avgLoss * (period - 1)) + (diff < 0 ? -diff : 0)) / period
  }
  if (avgLoss === 0) return 100
  return parseFloat((100 - (100 / (1 + avgGain / avgLoss))).toFixed(1))
}

export default function TradesAbiertosPage() {
  const { money, shares, visible } = usePrivacy()
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [selectedTrade,     setSelectedTrade]     = useState<any | null>(null)
  const [trades,            setTrades]            = useState<any[]>([])
  const [portfolios,        setPortfolios]        = useState<any[]>([])
  const [selectedPortfolio, setSelectedPortfolio] = useState("all")
  const [isRefreshing,      setIsRefreshing]      = useState(false)

  const [currentTime, setCurrentTime] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000) // Actualiza cada minuto
    return () => clearInterval(timer)
  }, [])


  // Persistir marketData en localStorage para que sobreviva cambios de página
  const [marketData, setMarketData] = useState<any>(() => {
    if (typeof window === 'undefined') return {}
    try { return JSON.parse(localStorage.getItem(MARKET_CACHE_KEY) || '{}') } catch { return {} }
  })

  const [checkedTargets, setCheckedTargets] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {}
    try { return JSON.parse(localStorage.getItem(TARGETS_KEY) || '{}') } catch { return {} }
  })

  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' }>({
    key: 'ticker', direction: 'asc'
  })

  // Persistir marketData cuando cambia
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(MARKET_CACHE_KEY, JSON.stringify(marketData))
    }
  }, [marketData])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(TARGETS_KEY, JSON.stringify(checkedTargets))
    }
  }, [checkedTargets])

  const fetchPortfolios = useCallback(async () => {
    const { data } = await supabase.from("portfolios").select("*")
    if (data) setPortfolios(data)
  }, [])

  const fetchTrades = useCallback(async (force = false) => {
  // 1. Evitar múltiples clics
  if (isRefreshing) return;
  setIsRefreshing(true);

  try {
    // 2. Traer los trades actualizados por el servidor desde Supabase
    const { data, error } = await supabase
      .from("trades")
      .select("*, portfolios(name, id)")
      .eq("status", "open");

    if (error) throw error;

    if (data) {
      setTrades(data);

      // 3. Sincronizar el estado local marketData con los precios de la DB
      const syncedData: any = { ...marketData };
      data.forEach((t: any) => {
        if (t.last_price) {
          syncedData[t.ticker] = {
            price: t.last_price,
            changePercent: t.day_change || 0,
            // El RSI lo dejamos como estaba o lo traemos de la DB si decides guardarlo allá
            rsi: marketData[t.ticker]?.rsi 
          };
        }
      });
      setMarketData(syncedData);
    }
  } catch (err) {
    console.error("Error cargando trades:", err);
  } finally {
    setIsRefreshing(false);
    setLastRefresh(new Date());
  }
}, [isRefreshing, marketData]);


  useEffect(() => {
  fetchTrades(); 
  fetchPortfolios();
  // El setInterval que estaba aquí se borra porque el servidor ya hace el trabajo
}, [fetchTrades, fetchPortfolios])

  const toggleTarget = (targetId: string) =>
    setCheckedTargets(prev => ({ ...prev, [targetId]: !prev[targetId] }))

  const handleDelete = async (trade: any) => {
    if (!confirm(`¿Eliminar el trade de ${trade.ticker} completo? Se revertirán todos los movimientos en la billetera.`)) return
    await supabase.from("wallet_movements").delete()
      .eq("ticker", trade.ticker)
      .eq("wallet_id", trade.portfolio_id)
      .eq("movement_type", "trade")
    await supabase.from("trade_executions").delete().eq("trade_id", trade.id)
    await supabase.from("trades").delete().eq("id", trade.id)
    fetchTrades()
  }

  const handleTogglePriority = async (trade: any) => {
    await supabase.from("trades").update({ priority: !trade.priority }).eq("id", trade.id)
    fetchTrades()
  }

  const enrichedTrades = useMemo(() => {
    const filtered = selectedPortfolio === "all"
      ? trades
      : trades.filter(t => t.portfolios?.id === selectedPortfolio)

    const items = filtered.map(trade => {
      const qty       = parseFloat(Number(trade.quantity     || 0).toFixed(6))
      const invested  = parseFloat(Number(trade.total_invested || 0).toFixed(2))
      const mData     = marketData[trade.ticker] || {}
      const curPrice  = parseFloat(Number(mData.price || trade.entry_price || 0).toFixed(2))
      const avgPrice  = qty > 0 ? parseFloat((invested / qty).toFixed(2)) : parseFloat(Number(trade.entry_price || 0).toFixed(2))
      const pnl       = parseFloat(((curPrice - avgPrice) * qty).toFixed(2))
      const pnlPct    = avgPrice > 0 ? parseFloat(((curPrice - avgPrice) / avgPrice * 100).toFixed(2)) : 0
      const curValue  = parseFloat((curPrice * qty).toFixed(2))
      const stopDist  = trade.stop_loss  ? Math.abs((curPrice - trade.stop_loss)  / curPrice * 100) : null
      const tp1Dist   = trade.take_profit_1 ? Math.abs((curPrice - trade.take_profit_1) / curPrice * 100) : null
      const nearStop  = stopDist !== null && stopDist <= 2
      const nearTP    = tp1Dist  !== null && tp1Dist  <= 2

      return {
        ...trade, curPrice, avgPrice, pnl, pnlPct,
        invested, curValue, nearStop, nearTP,
        rsi:       mData.rsi,
        dayChange: parseFloat(Number(mData.changePercent || 0).toFixed(2)),
      }
    })

    const totalValue = items.reduce((acc, i) => acc + i.curValue, 0)
    return items.map(item => ({
      ...item,
      portfolioWeight: totalValue > 0 ? parseFloat((item.curValue / totalValue * 100).toFixed(2)) : 0
    }))
  }, [trades, selectedPortfolio, marketData])

  // Totales del header
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
      ? <FaSortUp  style={{ marginLeft: 4, color: '#00bfff' }} />
      : <FaSortDown style={{ marginLeft: 4, color: '#00bfff' }} />
  }

  const getRSIColor = (rsi: number | null) => {
    if (rsi === null || rsi === undefined) return '#444'
    if (rsi >= 80) return '#ff6b6b'; if (rsi >= 70) return '#cc3333'
    if (rsi <= 20) return '#90ee90'; if (rsi <= 30) return '#22c55e'
    return '#555'
  }

  const targetBtn = (checked: boolean, color: string): React.CSSProperties => ({
    color: checked ? '#333' : color,
    cursor: 'pointer', fontWeight: 'bold', background: 'none', border: 'none',
    textDecoration: checked ? 'line-through' : 'none', fontSize: '0.7rem',
  })

  return (
    <AppShell>
      <div style={{ padding: '15px 25px', color: 'white' }}>

        {/* HEADER */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
          <h1 style={{ fontSize: '1.2rem', fontWeight: 900, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <TrendingUp size={20} color="#4caf50" /> Trades abiertos
            <span style={{ fontSize: 11, color: '#444', fontWeight: 400 }}>({enrichedTrades.length})</span>
          </h1>

{/* RESUMEN RÁPIDO */}
<div style={{ display: 'flex', gap: 20, alignItems: 'flex-end', flexWrap: 'wrap' }}>
  
  {/* Ajustado para que no empuje todo al centro */}
  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
    <div style={{ fontSize: '0.65rem', fontWeight: 'bold', letterSpacing: 0.5, whiteSpace: 'nowrap' }}>
      <span style={{ color: isMarketOpen() ? '#22c55e' : '#f43f5e', textTransform: 'uppercase' }}>
        {isMarketOpen() ? 'Mercado abierto • auto-refresh 5min ' : 'Mercado cerrado • solo manual '}
      </span>
      <span style={{ color: '#444', marginLeft: 4 }}>
        {currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }).toLowerCase()}
      </span>
    </div>

    {/* Aquí empiezan tus cards alineadas a la orilla */}
    <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
      <div style={summaryCard}>
        <span style={summaryLabel}>Invertido</span>
        <span style={{ color: '#fff' }}>{money(totals.totalInvested)}</span>
      </div>

      <div style={summaryCard}>
        <span style={summaryLabel}>Valor actual</span>
        <span style={{ color: '#00bfff' }}>{money(totals.totalValue)}</span>
      </div>

      <div style={summaryCard}>
        <span style={summaryLabel}>PnL total</span>
        <span style={{ color: totals.totalPnl >= 0 ? '#22c55e' : '#f43f5e', fontWeight: 700 }}>
          {money(totals.totalPnl)} ({totals.totalPnlPct >= 0 ? '+' : ''}{totals.totalPnlPct.toFixed(2)}%)
        </span>
      </div>

      <button 
  onClick={() => fetchTrades(true)} 
  disabled={isRefreshing} 
  style={refreshBtn(isRefreshing)}
>
  <FaSync 
    style={{ 
      animation: isRefreshing ? 'spin 1s linear infinite' : 'none',
      color: isRefreshing ? '#555' : '#eab308' 
    }} 
  />
  {isRefreshing ? 'Actualizando...' : 'Actualizar'}
</button>

    </div>
  </div>
</div>


        </div>

        {/* TABS PORTAFOLIOS */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, borderBottom: '1px solid #1a1a1a', paddingBottom: 10, overflowX: 'auto' }}>
          {[{ id: 'all', name: 'Todos' }, ...portfolios].map(p => (
            <button key={p.id} onClick={() => setSelectedPortfolio(p.id)}
              style={portfolioTab(selectedPortfolio === p.id)}>
              {p.name}
            </button>
          ))}
        </div>

        {/* TABLA */}
        <div style={{ overflowX: 'auto', background: '#050505', borderRadius: 12, border: '1px solid #1a1a1a' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#0a0a0a' }}>
                {[
                  { key: null,             label: '★' },
                  { key: 'open_date',      label: 'Fecha' },
                  { key: 'ticker',         label: 'Ticker' },
                  { key: 'dayChange',      label: 'Var día' },
                  { key: 'rsi',            label: 'RSI' },
                  { key: 'pnlPct',         label: 'PnL %' },
                  { key: 'pnl',            label: 'PnL $' },
                  { key: 'portfolioWeight',label: '% Cartera' },
                  { key: 'quantity',       label: 'Cant.' },
                  { key: 'avgPrice',       label: 'Avg' },
                  { key: 'invested',       label: 'Invertido' },
                  { key: 'stop_loss',      label: 'Stop' },
                  { key: 'curPrice',       label: 'Actual' },
                  { key: 'take_profit_1',  label: 'TP 1' },
                  { key: 'take_profit_2',  label: 'TP 2' },
                  { key: 'take_profit_3',  label: 'TP 3' },
                  { key: null,             label: 'Acc.' },
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
                  <td colSpan={17} style={{ padding: 40, textAlign: 'center', color: '#333' }}>
                    No hay trades abiertos.
                  </td>
                </tr>
              )}
              {sortedTrades.map(trade => {
                const rowBg = trade.priority
                  ? 'rgba(255,215,0,0.10)'
                  : trade.nearStop
                    ? 'rgba(255, 17, 0, 0.12)'
                    : trade.nearTP
                      ? 'rgba(0, 255, 8, 0.08)'
                      : 'transparent'

                return (
                  <tr key={trade.id} style={{ background: rowBg, borderBottom: '1px solid #0a0a0a' }}>

                    {/* Prioridad */}
                    <td style={tdStyle}>
                      <button onClick={() => handleTogglePriority(trade)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}>
                        <Star size={13} fill={trade.priority ? '#ffd700' : 'none'} color={trade.priority ? '#ffd700' : '#333'} />
                      </button>
                    </td>

                    {/* Fecha */}
                    <td style={{ ...tdStyle, color: '#444', fontSize: '0.65rem' }}>
                      {trade.open_date ? parseDate(trade.open_date).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }) : '—'}
                    </td>

                    {/* Ticker */}
                    <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 'bold', color: '#00bfff' }}>
                      {trade.ticker}
                      <div style={{ fontSize: '0.55rem', color: '#333' }}>{trade.portfolios?.name}</div>
                    </td>

                    {/* Var día */}
                    <td style={{ ...tdStyle, color: trade.dayChange >= 0 ? '#4caf50' : '#f43f5e' }}>
                      {trade.dayChange >= 0 ? '+' : ''}{trade.dayChange.toFixed(2)}%
                    </td>

                    {/* RSI */}
                    <td style={{ ...tdStyle, fontWeight: 'bold', color: getRSIColor(trade.rsi) }}>
                      {trade.rsi !== null && trade.rsi !== undefined ? trade.rsi : '—'}
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
                    <td style={{ ...tdStyle, color: '#555' }}>{trade.portfolioWeight.toFixed(2)}%</td>

                    {/* Cantidad */}
                    <td style={tdStyle}>{shares(trade.quantity)}</td>

                    {/* Avg */}
                    <td style={{ ...tdStyle, color: '#666' }}>{money(trade.avgPrice)}</td>

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
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                        <button onClick={() => setSelectedTrade(trade)}
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
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selectedTrade && (
        <TradeManagerModal
          trade={selectedTrade}
          onClose={() => { setSelectedTrade(null); fetchTrades() }}
          onRefresh={fetchTrades}
        />
      )}
    </AppShell>
  )
}

const tableTh: React.CSSProperties = {
  textAlign: 'center', padding: '8px 6px', color: '#444',
  fontSize: '0.6rem', borderBottom: '1px solid #1a1a1a',
  textTransform: 'uppercase', userSelect: 'none', letterSpacing: 0.5, whiteSpace: 'nowrap',
}
const tdStyle: React.CSSProperties = {
  padding: '5px 8px', fontSize: '0.72rem',
  borderBottom: '1px solid #0a0a0a', textAlign: 'center', whiteSpace: 'nowrap',
}
const summaryCard: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', fontSize: 11, gap: 2,
}
const summaryLabel: React.CSSProperties = {
  fontSize: 9, color: '#444', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
}
const refreshBtn = (loading: boolean): React.CSSProperties => ({
  background: '#0a0a0a', border: '1px solid #222',
  color: loading ? '#444' : '#00bfff',
  padding: '6px 12px', borderRadius: 6, cursor: 'pointer',
  fontSize: 10, fontWeight: 'bold',
  display: 'flex', alignItems: 'center', gap: 6,
})
const portfolioTab = (active: boolean): React.CSSProperties => ({
  padding: '4px 12px', borderRadius: 4, border: 'none', cursor: 'pointer',
  background: active ? '#22c55e' : 'transparent',
  color: active ? '#000' : '#555',
  fontSize: 10, fontWeight: 'bold', whiteSpace: 'nowrap',
})