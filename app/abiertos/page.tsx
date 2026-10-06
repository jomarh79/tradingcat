'use client'

import { useEffect, useState, useMemo, useCallback, useRef } from "react"
import { supabase } from "@/lib/supabase"
import { usePrivacy } from "@/lib/PrivacyContext"
import AppShell from "../AppShell"
import TradeManagerModal from "../components/TradeManagerModal"
import { FaSort, FaSortUp, FaSortDown, FaSync } from 'react-icons/fa'
import { TrendingUp, Settings, Trash2, Star, BarChart2, FileText, Activity } from 'lucide-react'

// ── Helpers ──────────────────────────────────────────────────────────────────
const r2 = (n: number) => Math.round(n * 100) / 100 + 0
const r4 = (n: number) => Math.round(n * 10000) / 10000 + 0
const r6 = (n: number) => Math.round(n * 1000000) / 1000000 + 0
const dayKey    = (d: any) => String(d || '').split('T')[0]
const parseDate = (d: any) => new Date(dayKey(d) + 'T00:00:00')
const errMsg    = (e: any) => e?.message || String(e)

// Mercado de EE.UU. (NYSE/Nasdaq): lun-vie 9:30–16:00 hora de Nueva York.
// Usar la zona de NY evita desfases cuando cambia el horario de verano.
const isMarketOpen = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(new Date())
  const get  = (t: string) => parts.find(p => p.type === t)?.value
  const wd   = get('weekday')
  const time = (Number(get('hour')) % 24) + Number(get('minute')) / 60
  return wd !== 'Sat' && wd !== 'Sun' && time >= 9.5 && time < 16
}

// Umbral para considerar un trade "actualizado" (gris) vs "desactualizado" (verde) —
// un poco por encima de los 5min del cron, para dar margen.
const FRESH_THRESHOLD_MIN = 6
// Separación mínima entre refrescos individuales del mismo trade (espejo del cooldown de servidor)
const SINGLE_TICKER_MIN_MINUTES = 1

// Un solo punto de llamada para refrescar todos los precios o un ticker.
// Va a nuestra ruta del servidor con la sesión; el token de la función ya no está en el navegador.
async function callUpdateTrades(ticker?: string) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error("Sesión expirada, vuelve a iniciar sesión")
  const res = await fetch("/api/update-trades", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(ticker ? { ticker } : {}),
  })
  if (!res.ok) {
    const j = await res.json().catch(() => null)
    throw new Error(j?.error || `update-trades respondió ${res.status}`)
  }
}
const TARGETS = [
  { field: 'take_profit_1', hit: 'tp1_hit' },
  { field: 'take_profit_2', hit: 'tp2_hit' },
  { field: 'take_profit_3', hit: 'tp3_hit' },
] as const

type HitField = 'tp1_hit' | 'tp2_hit' | 'tp3_hit' | 'stop_hit'

// Distancia porcentual del precio actual a un objetivo (null si no aplica)
const distPct = (cur: number, target: any) =>
  target && cur > 0 ? Math.abs((cur - Number(target)) / cur * 100) : null

const COLUMNS: { key: string | null, label: string }[] = [
  { key: 'open_date',       label: 'Fecha' },
  { key: 'ticker',          label: 'Ticker' },
  { key: 'dayChange',       label: 'Var día' },
  { key: 'pnlPct',          label: 'PnL %' },
  { key: 'pnl',             label: 'PnL $' },
  { key: 'portfolioWeight', label: 'Inv/Act %' },
  { key: 'quantity',        label: 'Cant.' },
  { key: 'avgPrice',        label: 'AVG' },
  { key: 'invested',        label: 'Invertido' },
  { key: 'stop_loss',       label: 'Stop' },
  { key: 'curPrice',        label: 'Actual' },
  { key: 'take_profit_1',   label: 'TP 1' },
  { key: 'take_profit_2',   label: 'TP 2' },
  { key: 'take_profit_3',   label: 'TP 3' },
  { key: null,              label: 'Acciones' },
]

// ── Paw SVG ──────────────────────────────────────────────────────────────────
const Paw = ({ size = 14, color = '#333', opacity = 1 }: { size?: number; color?: string; opacity?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ opacity, flexShrink: 0 }}>
    <ellipse cx="6"  cy="5"  rx="2.5" ry="3"/>
    <ellipse cx="11" cy="3"  rx="2.5" ry="3"/>
    <ellipse cx="16" cy="4"  rx="2.5" ry="3"/>
    <ellipse cx="19" cy="9"  rx="2"   ry="2.5"/>
    <path d="M12 22c-5 0-8-3-8-7 0-2.5 1.5-4.5 4-5.5 1-.4 2-.6 4-.6s3 .2 4 .6c2.5 1 4 3 4 5.5 0 4-3 7-8 7z"/>
  </svg>
)

const SortIcon = ({ active, direction }: { active: boolean; direction: 'asc' | 'desc' }) => {
  if (!active) return <FaSort style={{ marginLeft: 4, opacity: 0.15 }} />
  return direction === 'asc'
    ? <FaSortUp   style={{ marginLeft: 4, color: '#00bfff' }} />
    : <FaSortDown style={{ marginLeft: 4, color: '#00bfff' }} />
}

// Botón / enlace de icono con color al pasar el mouse
const iconBase: React.CSSProperties = { background: 'none', border: 'none', padding: 4, display: 'flex', transition: 'color 0.2s' }

const IconButton = ({ onClick, title, color, hover = '#00bfff', disabled, children }: any) => (
  <button
    onClick={onClick}
    title={title}
    disabled={disabled}
    style={{ ...iconBase, color, cursor: disabled ? 'default' : 'pointer' }}
    onMouseEnter={e => { if (!disabled) e.currentTarget.style.color = hover }}
    onMouseLeave={e => { e.currentTarget.style.color = color }}>
    {children}
  </button>
)

const IconLink = ({ href, title, color = '#555', children }: any) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    title={title}
    style={{ ...iconBase, color }}
    onMouseEnter={e => (e.currentTarget.style.color = '#00bfff')}
    onMouseLeave={e => (e.currentTarget.style.color = color)}>
    {children}
  </a>
)

export default function TradesAbiertosPage() {
  const { money, shares } = usePrivacy()

  const [selectedTrade,     setSelectedTrade]     = useState<any | null>(null)
  const [trades,            setTrades]            = useState<any[]>([])
  const [portfolios,        setPortfolios]        = useState<any[]>([])
  const [selectedPortfolio, setSelectedPortfolio] = useState("all")
  const [tickerSearch,      setTickerSearch]      = useState("")
  const [isRefreshing,      setIsRefreshing]      = useState(false)
  const [isUpdatingAll,     setIsUpdatingAll]     = useState(false)
  const [loaded,            setLoaded]            = useState(false)
  const [loadError,         setLoadError]         = useState<string | null>(null)
  const [deletingId,        setDeletingId]        = useState<string | null>(null)
  const [refreshingTickers, setRefreshingTickers] = useState<Set<string>>(new Set())
  const [lastRefresh,       setLastRefresh]       = useState<Date | null>(null)
  const [currentTime,       setCurrentTime]       = useState(new Date())
  const [sortConfig,        setSortConfig]        = useState<{ key: string, direction: 'asc' | 'desc' }>({ key: 'ticker', direction: 'asc' })

  const requestId = useRef(0)

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000)
    return () => clearInterval(timer)
  }, [])

  const fetchPortfolios = useCallback(async () => {
    const { data, error } = await supabase.from("portfolios").select("id, name")
    if (error) { console.error("Error cargando portafolios:", error); return }
    setPortfolios(data || [])
  }, [])

  // Solo se aplica la respuesta más reciente: una petición lenta no pisa a una nueva
  const fetchTrades = useCallback(async () => {
    const id = ++requestId.current
    setIsRefreshing(true)
    try {
      const { data, error } = await supabase.from("trades").select("*").eq("status", "open")
      if (error) throw error
      if (id !== requestId.current) return
      setTrades(data || [])
      setLoadError(null)
      setLastRefresh(new Date())
    } catch (err) {
      console.error("Error cargando trades:", err)
      if (id === requestId.current) setLoadError(errMsg(err))
    } finally {
      if (id === requestId.current) { setIsRefreshing(false); setLoaded(true) }
    }
  }, [])

  useEffect(() => {
    fetchTrades()
    fetchPortfolios()
  }, [fetchTrades, fetchPortfolios])

  // ── Refrescar precios ──────────────────────────────────────────────────────
  const refreshSingleTrade = async (trade: any) => {
    if (refreshingTickers.has(trade.ticker)) return
    if (trade.last_price_updated_at) {
      const minutesSince = (Date.now() - new Date(trade.last_price_updated_at).getTime()) / 60000
      if (minutesSince < SINGLE_TICKER_MIN_MINUTES) return
    }

    setRefreshingTickers(prev => new Set(prev).add(trade.ticker))
    try {
      await callUpdateTrades(trade.ticker)
      await fetchTrades()
    } catch (err) {
      console.error("Error refrescando ticker:", trade.ticker, err)
      alert(`No se pudo actualizar ${trade.ticker}: ${errMsg(err)}`)
    } finally {
      setRefreshingTickers(prev => {
        const next = new Set(prev)
        next.delete(trade.ticker)
        return next
      })
    }
  }

  const refreshAll = async () => {
    if (isUpdatingAll) return
    setIsUpdatingAll(true)
    try {
      await callUpdateTrades()
      await fetchTrades()
    } catch (err) {
      console.error("Error actualizando precios:", err)
      alert(`No se pudieron actualizar los precios: ${errMsg(err)}`)
    } finally {
      setIsUpdatingAll(false)
    }
  }

  // ── Marcar objetivos / prioridad (optimista, con reversión si falla) ──────
  const updateTradeField = async (tradeId: string, field: string, newValue: boolean) => {
    setTrades(prev => prev.map(t => t.id === tradeId ? { ...t, [field]: newValue } : t))
    const { error } = await supabase.from("trades").update({ [field]: newValue }).eq("id", tradeId)
    if (error) {
      console.error(`Error actualizando ${field}:`, error)
      setTrades(prev => prev.map(t => t.id === tradeId ? { ...t, [field]: !newValue } : t))
    }
  }

  const toggleTarget = (trade: any, field: HitField) => updateTradeField(trade.id, field, !trade[field])
  const handleTogglePriority = (trade: any) => updateTradeField(trade.id, 'priority', !trade.priority)

  // ── Eliminar trade y revertir SUS movimientos de billetera ────────────────
  const handleDelete = async (trade: any) => {
    if (deletingId) return
    if (!confirm(`¿Eliminar el trade de ${trade.ticker}? Se revertirán todos los movimientos en la billetera.`)) return

    setDeletingId(trade.id)
    let warning = ''
    try {
      // 1) Movimientos ligados a las ejecuciones de ESTE trade
      const { data: execs, error: exErr } = await supabase
        .from("trade_executions").select("id").eq("trade_id", trade.id)
      if (exErr) throw exErr
      const execIds = (execs || []).map(e => e.id)
      if (execIds.length) {
        const { error } = await supabase.from("wallet_movements").delete().in("execution_id", execIds)
        if (error) throw error
      }

      // 2) Movimiento de apertura (no tiene execution_id): se identifica con cuidado
      //    para no borrar la apertura de otro trade del mismo ticker
      const { data: cands, error: cErr } = await supabase
        .from("wallet_movements")
        .select("id, date, notes")
        .eq("wallet_id", trade.portfolio_id)
        .eq("ticker", trade.ticker)
        .eq("movement_type", "trade")
        .is("execution_id", null)
        .ilike("notes", "Apertura%")
      if (cErr) throw cErr

      let pool = cands || []
      const sameDate = pool.filter(c => dayKey(c.date) === dayKey(trade.open_date))
      if (sameDate.length) pool = sameDate
      if (pool.length > 1) {
        const qtyText = `${Number(trade.initial_quantity ?? trade.quantity)} acc`
        const byQty = pool.filter(c => c.notes?.includes(qtyText))
        if (byQty.length) pool = byQty
      }
      if (pool.length === 1) {
        const { error } = await supabase.from("wallet_movements").delete().eq("id", pool[0].id)
        if (error) throw error
      } else if (pool.length > 1) {
        warning = '\n\nNo pude identificar con certeza el movimiento de apertura; revísalo en el historial de la billetera.'
      } else {
        warning = '\n\nNo encontré el movimiento de apertura en la billetera; revísalo en su historial.'
      }

      // 3) Ejecuciones y trade
      const x = await supabase.from("trade_executions").delete().eq("trade_id", trade.id)
      if (x.error) throw x.error
      const t = await supabase.from("trades").delete().eq("id", trade.id)
      if (t.error) throw t.error

      if (warning) alert(`Trade eliminado.${warning}`)
    } catch (err) {
      alert(`No se pudo eliminar el trade: ${errMsg(err)}`)
    } finally {
      setDeletingId(null)
      fetchTrades()
    }
  }

  // ── Datos calculados ───────────────────────────────────────────────────────
  const enrichedTrades = useMemo(() => {
    const search = tickerSearch.trim().toLowerCase()
    const filtered = trades.filter(t =>
      (selectedPortfolio === "all" || t.portfolio_id === selectedPortfolio) &&
      (!search || t.ticker.toLowerCase().includes(search))
    )

    const items = filtered.map(trade => {
      const qty      = r6(Number(trade.quantity) || 0)
      const invested = r2(Number(trade.total_invested) || 0)
      const curPrice = r4(Number(trade.last_price || trade.entry_price) || 0)
      const avgPrice = qty > 0 ? r4(invested / qty) : r4(Number(trade.entry_price) || 0)
      const curValue = r2(curPrice * qty)
      const pnl      = r2(curValue - invested)
      const pnlPct   = invested > 0 ? r2(pnl / invested * 100) : 0

      const nearStop = (distPct(curPrice, trade.stop_loss) ?? Infinity) <= 1 && !trade.stop_hit
      const nearTP   = TARGETS.some(({ field, hit }) => (distPct(curPrice, trade[field]) ?? Infinity) <= 1 && !trade[hit])

      return {
        ...trade, curPrice, avgPrice, pnl, pnlPct, invested, curValue, nearStop, nearTP,
        dayChange: r2(Number(trade.day_change) || 0),
      }
    })

    const totalInvested = items.reduce((acc, i) => acc + i.invested, 0)
    return items.map(item => ({
      ...item,
      portfolioWeightOriginal: totalInvested > 0 ? r2(item.invested / totalInvested * 100) : 0,
      portfolioWeight:         totalInvested > 0 ? r2(item.curValue / totalInvested * 100) : 0,
    }))
  }, [trades, selectedPortfolio, tickerSearch])

  const totals = useMemo(() => {
    const totalInvested = enrichedTrades.reduce((a, t) => a + t.invested, 0)
    const totalValue    = enrichedTrades.reduce((a, t) => a + t.curValue, 0)
    const totalPnl      = r2(totalValue - totalInvested)
    const totalPnlPct   = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0
    return { totalInvested, totalValue, totalPnl, totalPnlPct }
  }, [enrichedTrades])

  const sortedTrades = useMemo(() => {
    const { key, direction } = sortConfig
    const isText = key === 'ticker' || key === 'open_date'
    const val = (r: any) => r[key] ?? (isText ? '' : 0)
    const dir = direction === 'asc' ? 1 : -1
    return [...enrichedTrades].sort((a, b) => {
      const v1 = val(a), v2 = val(b)
      const c = isText ? String(v1).localeCompare(String(v2)) : Number(v1) - Number(v2)
      return c !== 0 ? c * dir : a.ticker.localeCompare(b.ticker)
    })
  }, [enrichedTrades, sortConfig])

  const requestSort = (key: string) => {
    setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc' }))
  }

  const targetBtn = (checked: boolean, color: string, disabled: boolean): React.CSSProperties => ({
    color: checked ? '#333' : color, cursor: disabled ? 'default' : 'pointer', fontWeight: 'bold',
    background: 'none', border: 'none',
    textDecoration: checked ? 'line-through' : 'none', fontSize: '0.7rem',
  })

  const marketOpen = isMarketOpen()
  const busy = isRefreshing || isUpdatingAll

  // Estado del botón de refresco individual
  const freshness = (trade: any) => {
    const refreshing   = refreshingTickers.has(trade.ticker)
    const minutesSince = trade.last_price_updated_at
      ? (currentTime.getTime() - new Date(trade.last_price_updated_at).getTime()) / 60000
      : Infinity
    const isFresh        = minutesSince < FRESH_THRESHOLD_MIN
    const cooldownActive = minutesSince < SINGLE_TICKER_MIN_MINUTES
    const color = refreshing ? '#00bfff' : isFresh ? '#333' : '#22c55e'
    const title = refreshing
      ? 'Actualizando...'
      : isFresh
        ? `Actualizado hace ${minutesSince.toFixed(1)} min`
        : 'Actualizar este ticker'
    return { refreshing, disabled: refreshing || cooldownActive, color, title }
  }

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
              <button onClick={refreshAll} disabled={busy} style={refreshBtn(busy)}>
                <FaSync style={{ animation: busy ? 'spin 1s linear infinite' : 'none' }} />
                {isUpdatingAll ? 'Actualizando...' : 'Actualizar'}
              </button>
            </div>
          </div>
        </div>

        {loadError && (
          <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(244,63,94,0.3)', background: 'rgba(244,63,94,0.08)', color: '#f43f5e', fontSize: 12 }}>
            No se pudieron cargar los trades: {loadError}
            <button onClick={fetchTrades} style={{ marginLeft: 12, background: 'none', border: '1px solid #f43f5e', color: '#f43f5e', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 11 }}>
              Reintentar
            </button>
          </div>
        )}

        {/* ── TABS PORTAFOLIOS ── */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, borderBottom: '1px solid #1a1a1a', paddingBottom: 10, overflowX: 'auto', alignItems: 'center' }}>
          {[{ id: 'all', name: 'Todos' }, ...portfolios].map(p => (
            <button key={p.id} onClick={() => setSelectedPortfolio(p.id)} style={portfolioTab(selectedPortfolio === p.id)}>
              {p.name}
            </button>
          ))}
          <input
            type="text"
            placeholder="🔍 Buscar ticker..."
            value={tickerSearch}
            onChange={e => setTickerSearch(e.target.value.toUpperCase())}
            style={{
              marginLeft: 'auto', padding: '4px 10px', borderRadius: 6, border: '1px solid #222',
              background: '#0a0a0a', color: '#fff', fontSize: 11, fontWeight: 700, width: 160, outline: 'none',
            }}
          />
        </div>

        {/* ── TABLA ── */}
        <div style={{ overflowX: 'auto', background: '#050505', borderRadius: 12, border: '1px solid #1a1a1a' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#0a0a0a' }}>
                {COLUMNS.map(({ key, label }) => (
                  <th key={label} style={{ ...tableTh, cursor: key ? 'pointer' : 'default' }}
                    onClick={key ? () => requestSort(key) : undefined}>
                    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                      {label} {key && <SortIcon active={sortConfig.key === key} direction={sortConfig.direction} />}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedTrades.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} style={{ padding: 40, textAlign: 'center', color: '#555' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                      <Paw size={28} color="#333" opacity={0.5} />
                      {loaded ? 'No hay trades abiertos.' : 'Cargando trades...'}
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
                const fresh = freshness(trade)
                const ticker = encodeURIComponent(trade.ticker)

                return (
                  <tr key={trade.id} style={{ background: rowBg, borderBottom: '1px solid #0a0a0a', opacity: deletingId === trade.id ? 0.4 : 1 }}>

                    {/* Fecha */}
                    <td style={{ ...tdStyle, color: '#555', fontSize: '0.65rem' }}>
                      {trade.open_date
                        ? parseDate(trade.open_date).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: '2-digit' })
                        : '—'}
                    </td>

                    {/* Ticker */}
                    <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 'bold' }}>
                      <a
                        href={`https://es.tradingview.com/chart/?symbol=${ticker}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: '#00bfff', textDecoration: 'none', cursor: 'pointer' }}
                        onMouseEnter={e => { e.currentTarget.style.textDecoration = 'underline' }}
                        onMouseLeave={e => { e.currentTarget.style.textDecoration = 'none' }}>
                        {trade.ticker}
                      </a>
                    </td>

                    {/* Var día */}
                    <td style={{ ...tdStyle, color: trade.dayChange >= 0 ? '#4caf50' : '#f43f5e' }}>
                      {trade.dayChange >= 0 ? '+' : ''}{trade.dayChange.toFixed(2)}%
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
                    <td style={{ ...tdStyle, color: '#666' }}>
                      <span style={{ color: '#888' }}>{trade.portfolioWeightOriginal.toFixed(1)}</span>
                      <span style={{ color: '#555', margin: '0 2px' }}>/</span>
                      <span style={{ color: trade.portfolioWeight > trade.portfolioWeightOriginal ? '#4caf50' : trade.portfolioWeight < trade.portfolioWeightOriginal ? '#f43f5e' : '#666' }}>
                        {trade.portfolioWeight.toFixed(1)}
                      </span>
                      <span style={{ color: '#444', fontSize: '0.6rem' }}>%</span>
                    </td>

                    {/* Cantidad */}
                    <td style={tdStyle}>{shares(trade.quantity)}</td>

                    {/* Avg */}
                    <td style={{ ...tdStyle, color: '#fbbf24' }}>{money(trade.avgPrice)}</td>

                    {/* Invertido */}
                    <td style={{ ...tdStyle, fontWeight: 'bold' }}>{money(trade.invested)}</td>

                    {/* Stop */}
                    <td style={tdStyle}>
                      <button
                        onClick={() => toggleTarget(trade, 'stop_hit')}
                        disabled={!trade.stop_loss}
                        style={targetBtn(trade.stop_hit, '#f44336', !trade.stop_loss)}>
                        {trade.stop_loss ? money(trade.stop_loss) : '—'}
                      </button>
                    </td>

                    {/* Precio actual */}
                    <td style={{ ...tdStyle, color: '#fbbf24', fontWeight: 'bold' }}>
                      {money(trade.curPrice)}
                    </td>

                    {/* TPs */}
                    {TARGETS.map(tp => (
                      <td key={tp.field} style={tdStyle}>
                        <button
                          onClick={() => toggleTarget(trade, tp.hit)}
                          disabled={!trade[tp.field]}
                          style={targetBtn(trade[tp.hit], '#4caf50', !trade[tp.field])}>
                          {trade[tp.field] ? money(trade[tp.field]) : '—'}
                        </button>
                      </td>
                    ))}

                    {/* Acciones */}
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center' }}>
                        <IconButton
                          onClick={() => refreshSingleTrade(trade)}
                          title={fresh.title}
                          color={fresh.color}
                          disabled={fresh.disabled}>
                          <FaSync style={{ animation: fresh.refreshing ? 'spin 1s linear infinite' : 'none', fontSize: 12 }} />
                        </IconButton>

                        <IconButton onClick={() => setSelectedTrade(trade)} title="Editar trade" color="#555">
                          <Settings size={14} />
                        </IconButton>

                        <IconLink href={`/chart?ticker=${ticker}`} title="Ver gráficos">
                          <BarChart2 size={14} />
                        </IconLink>

                        <IconLink href={`/position?ticker=${ticker}&tradeId=${encodeURIComponent(trade.id)}`} title="Ver radiografía de la posición">
                          <Activity size={14} />
                        </IconLink>

                        <IconLink href={`/fundamentals?ticker=${ticker}`} title="Ver fundamentales" color="#333">
                          <FileText size={14} />
                        </IconLink>

                        <IconButton
                          onClick={() => handleDelete(trade)}
                          title="Eliminar trade"
                          color="#2a2a2a"
                          hover="#f43f5e"
                          disabled={deletingId !== null}>
                          <Trash2 size={14} />
                        </IconButton>

                        <button onClick={() => handleTogglePriority(trade)} title="Seleccionar trade"
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
          Precios desde cron · actualiza cada 5min en horario de mercado
        </div>
      </div>

      {selectedTrade && (
        <TradeManagerModal
          trade={selectedTrade}
          onClose={() => { setSelectedTrade(null); fetchTrades() }}
          onRefresh={fetchTrades}
        />
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </AppShell>
  )
}

// ── Estilos ──────────────────────────────────────────────────────────────────
const tableTh: React.CSSProperties = { textAlign: 'center', padding: '8px 6px', color: '#888', fontSize: '0.6rem', borderBottom: '1px solid #1a1a1a', textTransform: 'uppercase', userSelect: 'none', letterSpacing: 0.5, whiteSpace: 'nowrap' }
const tdStyle: React.CSSProperties = { padding: '5px 8px', fontSize: '0.72rem', borderBottom: '1px solid #0a0a0a', textAlign: 'center', whiteSpace: 'nowrap' }
const summaryCard: React.CSSProperties = { display: 'flex', flexDirection: 'column', fontSize: 11, gap: 2 }
const summaryLabel: React.CSSProperties = { fontSize: 9, color: '#888', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }
const refreshBtn = (loading: boolean): React.CSSProperties => ({
  background: '#0a0a0a', border: '1px solid #222',
  color: loading ? '#444' : '#eab308',
  padding: '6px 12px', borderRadius: 6, cursor: loading ? 'default' : 'pointer',
  fontSize: 10, fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 6,
})
const portfolioTab = (active: boolean): React.CSSProperties => ({
  padding: '4px 12px', borderRadius: 4, border: 'none', cursor: 'pointer',
  background: active ? '#22c55e' : 'transparent',
  color: active ? '#000' : '#888',
  fontSize: 10, fontWeight: 'bold', whiteSpace: 'nowrap',
})