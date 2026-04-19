'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { usePrivacy } from '@/lib/PrivacyContext'
import AppShell from '../AppShell'
import { Trash2, X, History } from 'lucide-react'
import { FaSort, FaSortUp, FaSortDown } from 'react-icons/fa'

const parseDate = (d: string) => new Date((d || '').split('T')[0] + 'T00:00:00')

const CLOSE_REASONS = [
  'Take Profit', 'Stop loss', 'Decisión manual', 'Sentimiento del mercado',
  'Rompió estructura', 'Cambio de tesis', 'Necesidad de liquidez',
  'Error de análisis', 'Otro',
]

const Paw = ({ size = 14, color = '#333', opacity = 1 }: any) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ opacity, flexShrink: 0 }}>
    <ellipse cx="6"  cy="5"  rx="2.5" ry="3"/>
    <ellipse cx="11" cy="3"  rx="2.5" ry="3"/>
    <ellipse cx="16" cy="4"  rx="2.5" ry="3"/>
    <ellipse cx="19" cy="9"  rx="2"   ry="2.5"/>
    <path d="M12 22c-5 0-8-3-8-7 0-2.5 1.5-4.5 4-5.5 1-.4 2-.6 4-.6s3 .2 4 .6c2.5 1 4 3 4 5.5 0 4-3 7-8 7z"/>
  </svg>
)

export default function CerradosPage() {
  const { money, shares } = usePrivacy()

  const [trades,            setTrades]            = useState<any[]>([])
  const [portfolios,        setPortfolios]        = useState<any[]>([])
  const [selectedPortfolio, setSelectedPortfolio] = useState('all')
  const [selectedYear,      setSelectedYear]      = useState(new Date().getFullYear().toString())
  const [filterTicker,      setFilterTicker]      = useState('')
  const [filterReason,      setFilterReason]      = useState('all')
  const [filterSector,      setFilterSector]      = useState('all')
  const [viewingTrade,      setViewingTrade]      = useState<any>(null)
  const [sortConfig,        setSortConfig]        = useState<{ key: string, direction: 'asc' | 'desc' }>({
    key: 'close_date', direction: 'desc'
  })

  const fetchData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const [{ data: pData }, { data: tData }] = await Promise.all([
      supabase.from('portfolios').select('*').eq('user_id', user.id),
      supabase.from('trades')
        .select('*, portfolios(name), trade_executions(*)')
        .eq('user_id', user.id)
        .eq('status', 'closed'),
    ])
    if (pData) setPortfolios(pData)
    if (tData) setTrades(tData)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const availableYears = useMemo(() => {
    const years = new Set(trades.map(t => parseDate(t.close_date || t.open_date).getFullYear()))
    years.add(new Date().getFullYear())
    return Array.from(years).sort((a, b) => b - a)
  }, [trades])

  // Sectores únicos para el filtro
  const availableSectors = useMemo(() => {
    const sectors = new Set(trades.map(t => t.sector || 'Sin sector').filter(Boolean))
    return Array.from(sectors).sort()
  }, [trades])

  const calculateTradeData = useCallback((t: any) => {
    const openDate  = parseDate(t.open_date)
    const closeDate = parseDate(t.close_date || t.closed_at || t.open_date)
    const diffDays  = Math.max(1, Math.ceil(Math.abs(closeDate.getTime() - openDate.getTime()) / 86400000))

    const executions = t.trade_executions || []

    const initialQty = parseFloat(Number(t.initial_quantity || t.quantity).toFixed(6))
    const initialInv = parseFloat((initialQty * Number(t.entry_price)).toFixed(2))

    const buyExecs = executions
      .filter((e: any) => e.execution_type?.toLowerCase() === 'buy')
      .reduce((acc: number, e: any) => {
        const gross = parseFloat((Number(e.quantity) * Number(e.price)).toFixed(2))
        const comm  = parseFloat(Number(e.commission || 0).toFixed(2))
        return parseFloat((acc + gross + comm).toFixed(2))
      }, 0)

    const totalInvested = parseFloat((initialInv + buyExecs).toFixed(2))

    const totalSells = executions
      .filter((e: any) => ['sell', 'close'].includes(e.execution_type?.toLowerCase()))
      .reduce((acc: number, e: any) => {
        const gross = parseFloat((Number(e.quantity) * Number(e.price)).toFixed(2))
        const comm  = parseFloat(Number(e.commission || 0).toFixed(2))
        return parseFloat((acc + gross - comm).toFixed(2))
      }, 0)

    const pnlCash  = parseFloat((totalSells - totalInvested).toFixed(2))
    const pnlPct   = totalInvested > 0 ? parseFloat(((pnlCash / totalInvested) * 100).toFixed(2)) : 0
    const annualPct = pnlPct > -100
      ? parseFloat(((Math.pow(1 + pnlPct / 100, 365 / diffDays) - 1) * 100).toFixed(2))
      : -100

    return { diffDays, totalInvested, totalSells, pnlCash, pnlPct, annualPct }
  }, [])

  const handleSort = (key: string) => {
    setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc' }))
  }

  const SortIcon = ({ col }: { col: string }) => {
    if (sortConfig.key !== col) return <FaSort style={{ marginLeft: 4, opacity: 0.2 }} />
    return sortConfig.direction === 'asc'
      ? <FaSortUp   style={{ marginLeft: 4, color: '#00bfff' }} />
      : <FaSortDown style={{ marginLeft: 4, color: '#00bfff' }} />
  }

  const handleDelete = async (trade: any) => {
    if (!confirm(`¿Eliminar trade de ${trade.ticker}? Se revertirán los movimientos en la billetera.`)) return
    await supabase.from('wallet_movements').delete()
      .eq('ticker', trade.ticker).eq('wallet_id', trade.portfolio_id).eq('movement_type', 'trade')
    await supabase.from('trade_executions').delete().eq('trade_id', trade.id)
    await supabase.from('trades').delete().eq('id', trade.id)
    fetchData()
  }

  const filteredAndSorted = useMemo(() => {
    let result = trades.filter(t => {
      const matchPortfolio = selectedPortfolio === 'all' || t.portfolio_id === selectedPortfolio
      const matchYear      = selectedYear === 'all' || parseDate(t.close_date || t.open_date).getFullYear().toString() === selectedYear
      const matchTicker    = !filterTicker || t.ticker.toLowerCase().includes(filterTicker.toLowerCase())
      const matchReason    = filterReason === 'all' || (t.close_reason || '') === filterReason
      const matchSector    = filterSector === 'all' || (t.sector || 'Sin sector') === filterSector
      return matchPortfolio && matchYear && matchTicker && matchReason && matchSector
    })

    return result.sort((a, b) => {
      const da = calculateTradeData(a)
      const db = calculateTradeData(b)
      let v1: any = a[sortConfig.key] ?? 0
      let v2: any = b[sortConfig.key] ?? 0

      if (sortConfig.key === 'close_date' || sortConfig.key === 'open_date') {
        v1 = parseDate(a[sortConfig.key] || a.open_date).getTime()
        v2 = parseDate(b[sortConfig.key] || b.open_date).getTime()
      }
      if (sortConfig.key === 'pnlCash')   { v1 = da.pnlCash;   v2 = db.pnlCash }
      if (sortConfig.key === 'pnlPct')    { v1 = da.pnlPct;    v2 = db.pnlPct }
      if (sortConfig.key === 'diffDays')  { v1 = da.diffDays;  v2 = db.diffDays }
      if (sortConfig.key === 'annualPct') { v1 = da.annualPct; v2 = db.annualPct }

      if (v1 < v2) return sortConfig.direction === 'asc' ? -1 : 1
      if (v1 > v2) return sortConfig.direction === 'asc' ? 1 : -1
      return 0
    })
  }, [trades, selectedPortfolio, selectedYear, filterTicker, filterReason, filterSector, sortConfig, calculateTradeData])

  const summary = useMemo(() => {
    const total    = filteredAndSorted.length
    const winners  = filteredAndSorted.filter(t => calculateTradeData(t).pnlCash > 0).length
    const winRate  = total > 0 ? (winners / total * 100) : 0
    const totalPnl = filteredAndSorted.reduce((acc, t) => acc + calculateTradeData(t).pnlCash, 0)
    const totalInv = filteredAndSorted.reduce((acc, t) => acc + calculateTradeData(t).totalInvested, 0)
    const totalSell = filteredAndSorted.reduce((acc, t) => acc + calculateTradeData(t).totalSells, 0)
    const avgPnl   = total > 0 ? totalPnl / total : 0
    return { total, winners, winRate, totalPnl, totalInv, totalSell, avgPnl }
  }, [filteredAndSorted, calculateTradeData])

  return (
    <AppShell>
      <div style={{ padding: '0 30px', color: 'white', position: 'relative' }}>

        {/* Huellas decorativas */}
        <div style={{ position: 'absolute', top: 12, right: 32, pointerEvents: 'none', display: 'flex', gap: 5, transform: 'rotate(-10deg)' }}>
          <Paw size={14} color="#22c55e" opacity={0.07} />
          <Paw size={10} color="#22c55e" opacity={0.05} />
          <Paw size={7}  color="#22c55e" opacity={0.03} />
        </div>

        {/* ── HEADER ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', margin: '20px 0 16px', flexWrap: 'wrap', gap: 12 }}>
          <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <History size={22} color="#22c55e" /> Trades cerrados
          </h1>

          {/* RESUMEN — ahora incluye PnL promedio */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {[
              { label: 'Trades',       value: summary.total,                         color: '#fff' },
              { label: 'Win rate',     value: `${summary.winRate.toFixed(1)}%`,       color: summary.winRate >= 50 ? '#22c55e' : '#f43f5e' },
              { label: 'Invertido',   value: money(summary.totalInv),               color: '#888' },
              { label: 'Recuperado',  value: money(summary.totalSell),              color: '#888' },
              { label: 'PnL total',   value: money(summary.totalPnl),               color: summary.totalPnl >= 0 ? '#22c55e' : '#f43f5e' },
              { label: 'PnL / trade', value: money(summary.avgPnl),                 color: summary.avgPnl >= 0 ? '#22c55e' : '#f43f5e' },
            ].map(card => (
              <div key={card.label} style={summaryCard}>
                <span style={summaryLabel}>{card.label}</span>
                <span style={{ fontSize: 15, fontWeight: 700, color: card.color }}>{card.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── TABS PORTAFOLIOS ── */}
        <div style={walletNav}>
          {[{ id: 'all', name: 'Todos' }, ...portfolios].map(p => (
            <button key={p.id} onClick={() => setSelectedPortfolio(p.id)} style={walletTab(selectedPortfolio === p.id)}>
              {p.name}
            </button>
          ))}
        </div>

        {/* ── FILTROS ── */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={selectedYear} onChange={e => setSelectedYear(e.target.value)} style={selectStyle}>
            <option value="all">Todos los años</option>
            {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={filterReason} onChange={e => setFilterReason(e.target.value)} style={selectStyle}>
            <option value="all">Todas las razones</option>
            {CLOSE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          {/* Nuevo filtro por sector */}
          <select value={filterSector} onChange={e => setFilterSector(e.target.value)} style={selectStyle}>
            <option value="all">Todos los sectores</option>
            {availableSectors.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <input
            placeholder="Buscar ticker..."
            value={filterTicker}
            onChange={e => setFilterTicker(e.target.value.toUpperCase())}
            style={{ ...selectStyle, minWidth: 140 }}
          />
          <span style={{ fontSize: 10, color: '#888' }}>{filteredAndSorted.length} resultado(s)</span>
        </div>

        {/* ── TABLA ── */}
        <div style={tableWrapper}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#0a0a0a' }}>
                {[
                  { key: 'ticker',     label: 'Ticker' },
                  { key: 'open_date',  label: 'Apertura' },
                  { key: 'close_date', label: 'Cierre' },
                  { key: 'diffDays',   label: 'Días' },
                  { key: null,         label: 'Razón' },
                  { key: 'sector',     label: 'Sector' },
                  { key: null,         label: 'Invertido' },
                  { key: null,         label: 'Recuperado' },
                  { key: 'pnlCash',    label: 'PnL $' },
                  { key: 'pnlPct',     label: 'PnL %' },
                  { key: 'annualPct',  label: 'Anual %' },
                  { key: null,         label: 'Acciones' },
                ].map(({ key, label }) => (
                  <th key={label}
                    style={{ ...thStyle, cursor: key ? 'pointer' : 'default' }}
                    onClick={key ? () => handleSort(key) : undefined}>
                    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                      {label} {key && <SortIcon col={key} />}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredAndSorted.length === 0 && (
                <tr>
                  <td colSpan={12} style={{ padding: 40, textAlign: 'center', color: '#555' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                      <Paw size={28} color="#333" opacity={0.5} />
                      No hay trades cerrados para este filtro.
                    </div>
                  </td>
                </tr>
              )}
              {filteredAndSorted.map(t => {
                const d = calculateTradeData(t)
                return (
                  <tr key={t.id} style={trStyle}>
                    <td style={{ ...tdStyle, fontWeight: 'bold', color: '#00bfff' }}>
                      {t.ticker}
                      <div style={{ fontSize: '0.6rem', color: '#444' }}>{t.portfolios?.name}</div>
                    </td>
                    <td style={{ ...tdStyle, color: '#666', fontSize: 11 }}>
                      {t.open_date ? parseDate(t.open_date).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}
                    </td>
                    <td style={{ ...tdStyle, color: '#666', fontSize: 11 }}>
                      {t.close_date ? parseDate(t.close_date).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center', color: '#888' }}>{d.diffDays}</td>
                    <td style={{ ...tdStyle, fontSize: 10 }}>
                      {t.close_reason
                        ? <span style={{ background: '#111', border: '1px solid #222', padding: '2px 6px', borderRadius: 3, color: '#aaa' }}>{t.close_reason}</span>
                        : <span style={{ color: '#333' }}>—</span>}
                    </td>
                    {/* Columna sector — nueva */}
                    <td style={{ ...tdStyle, fontSize: 10, color: '#666' }}>
                      {t.sector
                        ? <span style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '2px 6px', borderRadius: 3 }}>{t.sector}</span>
                        : <span style={{ color: '#333' }}>—</span>}
                    </td>
                    <td style={tdStyle}>{money(d.totalInvested)}</td>
                    <td style={tdStyle}>{money(d.totalSells)}</td>
                    <td style={{ ...tdStyle, color: d.pnlCash >= 0 ? '#22c55e' : '#f43f5e', fontWeight: 'bold' }}>
                      {money(d.pnlCash)}
                    </td>
                    <td style={{ ...tdStyle, color: d.pnlPct >= 0 ? '#22c55e' : '#f43f5e' }}>
                      {d.pnlPct >= 0 ? '+' : ''}{d.pnlPct.toFixed(2)}%
                    </td>
                    <td style={{ ...tdStyle, color: d.annualPct >= 0 ? '#22c55e' : '#f43f5e' }}>
                      {d.annualPct > 500 ? '>500' : `${d.annualPct >= 0 ? '+' : ''}${d.annualPct.toFixed(1)}`}%
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                        <button onClick={() => setViewingTrade(t)} style={viewBtn}
                          onMouseEnter={e => (e.currentTarget.style.color = '#00bfff')}
                          onMouseLeave={e => (e.currentTarget.style.color = '#666')}>
                          Ver historial
                        </button>
                        <button onClick={() => handleDelete(t)}
                          style={{ background: 'none', border: 'none', color: '#2a2a2a', cursor: 'pointer', transition: 'color 0.2s' }}
                          onMouseEnter={e => (e.currentTarget.style.color = '#f43f5e')}
                          onMouseLeave={e => (e.currentTarget.style.color = '#2a2a2a')}>
                          <Trash2 size={13} />
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
          {filteredAndSorted.length} trades · PnL considera comisiones de cada ejecución
        </div>

        {/* ── MODAL HISTORIAL ── */}
        {viewingTrade && (
          <div style={overlayStyle} onClick={() => setViewingTrade(null)}>
            <div style={modalStyle} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h2 style={{ margin: 0, fontSize: 16 }}>
                  Historial: <span style={{ color: '#00bfff' }}>{viewingTrade.ticker}</span>
                  {viewingTrade.sector && <span style={{ fontSize: 11, color: '#555', marginLeft: 8 }}>{viewingTrade.sector}</span>}
                </h2>
                <button onClick={() => setViewingTrade(null)}
                  style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer' }}>
                  <X size={18} />
                </button>
              </div>
              <div style={{ maxHeight: 350, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#000' }}>
                      {['Fecha', 'Tipo', 'Cantidad', 'Precio', 'Comisión', 'Total'].map(h => (
                        <th key={h} style={modalTh}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={trStyle}>
                      <td style={modalTd}>{parseDate(viewingTrade.open_date).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                      <td style={{ ...modalTd, color: '#00bfff', fontWeight: 700 }}>Apertura</td>
                      <td style={modalTd}>{shares(viewingTrade.initial_quantity || viewingTrade.quantity)}</td>
                      <td style={modalTd}>{money(viewingTrade.entry_price)}</td>
                      <td style={{ ...modalTd, color: '#444' }}>—</td>
                      <td style={modalTd}>{money((viewingTrade.initial_quantity || viewingTrade.quantity) * viewingTrade.entry_price)}</td>
                    </tr>
                    {viewingTrade.trade_executions?.map((ex: any) => {
                      const type    = ex.execution_type?.toLowerCase()
                      const isBuy   = type === 'buy'
                      const isClose = type === 'close'
                      const comm    = parseFloat(Number(ex.commission || 0).toFixed(2))
                      const gross   = parseFloat((Number(ex.quantity) * Number(ex.price)).toFixed(2))
                      const net     = isBuy ? gross + comm : gross - comm
                      return (
                        <tr key={ex.id} style={trStyle}>
                          <td style={modalTd}>
                            {parseDate((ex.executed_at || '').split('T')[0]).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}
                          </td>
                          <td style={{ ...modalTd, color: isBuy ? '#22c55e' : isClose ? '#00bfff' : '#f43f5e', fontWeight: 700 }}>
                            {isBuy ? 'Recompra' : isClose ? 'Cierre' : 'Venta parcial'}
                          </td>
                          <td style={modalTd}>{shares(ex.quantity)}</td>
                          <td style={modalTd}>{money(ex.price)}</td>
                          <td style={{ ...modalTd, color: '#666' }}>{comm > 0 ? money(comm) : '—'}</td>
                          <td style={modalTd}>{money(net)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {(() => {
                const d = calculateTradeData(viewingTrade)
                return (
                  <div style={{ display: 'flex', gap: 16, marginTop: 16, padding: '12px', background: '#000', borderRadius: 8, flexWrap: 'wrap' }}>
                    {[
                      { label: 'Invertido',  value: money(d.totalInvested), color: '#888' },
                      { label: 'Recuperado', value: money(d.totalSells),    color: '#888' },
                      { label: 'PnL',        value: money(d.pnlCash),       color: d.pnlCash >= 0 ? '#22c55e' : '#f43f5e' },
                      { label: 'PnL %',      value: `${d.pnlPct >= 0 ? '+' : ''}${d.pnlPct.toFixed(2)}%`, color: d.pnlPct >= 0 ? '#22c55e' : '#f43f5e' },
                      { label: 'Duración',   value: `${d.diffDays} días`,   color: '#888' },
                    ].map(item => (
                      <div key={item.label} style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 9, color: '#555', fontWeight: 700, letterSpacing: 0.5, marginBottom: 3 }}>{item.label}</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: item.color }}>{item.value}</div>
                      </div>
                    ))}
                  </div>
                )
              })()}
            </div>
          </div>
        )}

      </div>
    </AppShell>
  )
}

const walletNav: React.CSSProperties    = { display: 'flex', gap: 8, marginBottom: 14, borderBottom: '1px solid #1a1a1a', paddingBottom: 10, overflowX: 'auto' }
const walletTab = (active: boolean): React.CSSProperties => ({ background: active ? '#22c55e' : 'transparent', color: active ? '#000' : '#888', border: 'none', padding: '5px 12px', borderRadius: 4, fontSize: 10, fontWeight: 'bold', cursor: 'pointer', whiteSpace: 'nowrap' })
const tableWrapper: React.CSSProperties = { background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: 12, overflow: 'hidden', marginBottom: 30 }
const thStyle: React.CSSProperties      = { padding: '10px 12px', textAlign: 'left', fontSize: 9, textTransform: 'uppercase', color: '#888', userSelect: 'none', whiteSpace: 'nowrap', letterSpacing: 0.5 }
const tdStyle: React.CSSProperties      = { padding: '8px 12px', fontSize: 12, borderBottom: '1px solid #0a0a0a' }
const trStyle: React.CSSProperties      = { borderBottom: '1px solid #0a0a0a' }
const selectStyle: React.CSSProperties  = { background: '#0a0a0a', color: '#ccc', border: '1px solid #1a1a1a', padding: '6px 10px', borderRadius: 6, fontSize: 11, outline: 'none' }
const summaryCard: React.CSSProperties  = { display: 'flex', flexDirection: 'column', gap: 3, background: '#0a0a0a', padding: '8px 14px', borderRadius: 8, border: '1px solid #1a1a1a' }
const summaryLabel: React.CSSProperties = { fontSize: 9, color: '#888', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }
const viewBtn: React.CSSProperties      = { background: 'none', border: '1px solid #1a1a1a', color: '#666', padding: '3px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 10, fontWeight: 'bold', transition: 'color 0.2s' }
const overlayStyle: React.CSSProperties = { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.88)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }
const modalStyle: React.CSSProperties   = { background: '#0a0a0a', padding: 24, borderRadius: 14, width: '90%', maxWidth: 640, border: '1px solid #1a1a1a' }
const modalTh: React.CSSProperties      = { padding: '8px 10px', textAlign: 'left', fontSize: 9, color: '#888', fontWeight: 700, letterSpacing: 0.5, borderBottom: '1px solid #1a1a1a' }
const modalTd: React.CSSProperties      = { padding: '9px 10px', fontSize: 12, color: '#ccc' }