'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { usePrivacy } from '@/lib/PrivacyContext'
import AppShell from '../AppShell'
import { Trash2, X, History, Pencil, Check, AlertTriangle } from 'lucide-react'
import { FaSort, FaSortUp, FaSortDown } from 'react-icons/fa'

const parseDate = (d: string) => new Date((d || '').split('T')[0] + 'T00:00:00')

const CLOSE_REASONS = [
  'Take Profit', 'Stop loss', 'Decisión manual', 'Sentimiento del mercado',
  'Rompió estructura', 'Cambio de tesis', 'Necesidad de liquidez',
  'Error de análisis', 'Otro',
]

// ── Cat SVGs ──────────────────────────────────────────────────────────────────
const Paw = ({ size = 14, color = '#555', opacity = 1, rotate = 0 }: any) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color}
    style={{ opacity, transform: `rotate(${rotate}deg)`, flexShrink: 0 }}>
    <ellipse cx="6"  cy="5"  rx="2.5" ry="3"/>
    <ellipse cx="11" cy="3"  rx="2.5" ry="3"/>
    <ellipse cx="16" cy="4"  rx="2.5" ry="3"/>
    <ellipse cx="19" cy="9"  rx="2"   ry="2.5"/>
    <path d="M12 22c-5 0-8-3-8-7 0-2.5 1.5-4.5 4-5.5 1-.4 2-.6 4-.6s3 .2 4 .6c2.5 1 4 3 4 5.5 0 4-3 7-8 7z"/>
  </svg>
)

const CatEars = ({ color = '#22c55e', opacity = 0.1, size = 40 }: any) => (
  <svg width={size * 1.5} height={size} viewBox="0 0 60 40" fill={color} style={{ opacity }}>
    <polygon points="0,40 12,0 24,40"/>
    <polygon points="36,40 48,0 60,40"/>
  </svg>
)

const CatTail = ({ color = '#22c55e', opacity = 0.07 }: any) => (
  <svg width={44} height={70} viewBox="0 0 50 80" fill="none"
    stroke={color} strokeWidth="3" strokeLinecap="round" style={{ opacity }}>
    <path d="M40 80 Q45 50 20 40 Q0 30 10 10 Q20 -5 35 5"/>
  </svg>
)

// ── Tipos para la edición ─────────────────────────────────────────────────────
interface EditRow {
  kind:        'apertura' | 'buy' | 'sell' | 'close'
  executionId: string | null   // null = apertura (viene de trade directamente)
  date:        string
  quantity:    number
  price:       number
  commission:  number
}

// ── Recalcular realized_pnl de un trade completo ─────────────────────────────
// PnL = suma(ventas/cierres netos) − inversión total
async function recalcPnL(tradeId: string, tradeData: any, executions: any[]): Promise<number> {
  const initialQty = Number(tradeData.initial_quantity || tradeData.quantity)
  const initialInv = initialQty * Number(tradeData.entry_price)

  const buyExtraInv = executions
    .filter(e => e.execution_type?.toLowerCase() === 'buy')
    .reduce((acc, e) => acc + Number(e.quantity) * Number(e.price) + Number(e.commission || 0), 0)

  const totalInv = initialInv + buyExtraInv

  const totalSells = executions
    .filter(e => ['sell', 'close'].includes(e.execution_type?.toLowerCase()))
    .reduce((acc, e) => acc + Number(e.quantity) * Number(e.price) - Number(e.commission || 0), 0)

  return parseFloat((totalSells - totalInv).toFixed(2))
}

export default function CerradosPage() {
  const { money, shares } = usePrivacy()

  const [trades,            setTrades]            = useState<any[]>([])
  const [portfolios,        setPortfolios]        = useState<any[]>([])
  const [selectedPortfolio, setSelectedPortfolio] = useState('all')
  const [selectedYear,      setSelectedYear]      = useState(new Date().getFullYear().toString())
  const [filterMonth, setFilterMonth] = useState('all')
  const [filterTicker,      setFilterTicker]      = useState('')
  const [filterReason,      setFilterReason]      = useState('all')
  const [filterSector,      setFilterSector]      = useState('all')
  const [viewingTrade,      setViewingTrade]      = useState<any>(null)
  const [sortConfig,        setSortConfig]        = useState<{ key: string; direction: 'asc' | 'desc' }>({
    key: 'close_date', direction: 'desc',
  })

  // ── Estado del modal de edición ───────────────────────────────────────────
  const [editingRow,  setEditingRow]  = useState<EditRow | null>(null)
  const [editValues,  setEditValues]  = useState({ date: '', quantity: '', price: '', commission: '' })
  const [editSaving,  setEditSaving]  = useState(false)
  const [editError,   setEditError]   = useState<string | null>(null)

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

  const availableMonths = useMemo(() => {
    const months = new Set(
      trades.map(t => {
        const d = parseDate(t.close_date || t.open_date)
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      })
    )
    return Array.from(months).sort((a, b) => b.localeCompare(a))
  }, [trades])

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
        return parseFloat((acc + Number(e.quantity) * Number(e.price) + Number(e.commission || 0)).toFixed(2))
      }, 0)

    const totalInvested = parseFloat((initialInv + buyExecs).toFixed(2))

    const totalSells = executions
      .filter((e: any) => ['sell', 'close'].includes(e.execution_type?.toLowerCase()))
      .reduce((acc: number, e: any) => {
        return parseFloat((acc + Number(e.quantity) * Number(e.price) - Number(e.commission || 0)).toFixed(2))
      }, 0)

    const pnlCash   = parseFloat((totalSells - totalInvested).toFixed(2))
    const pnlPct    = totalInvested > 0 ? parseFloat(((pnlCash / totalInvested) * 100).toFixed(2)) : 0
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
  if (!confirm(`¿Eliminar trade de ${trade.ticker}? Se revertirán los movimientos de esta operación en la billetera.`)) return

  // 1. Obtener los IDs de las ejecuciones de ESTE trade
  const { data: execs } = await supabase
    .from('trade_executions')
    .select('id')
    .eq('trade_id', trade.id)

  const execIds = (execs || []).map((e: any) => e.id)

  // 2. Borrar wallet_movements vinculados a estas ejecuciones (recompras, cierres, ventas)
  if (execIds.length > 0) {
    await supabase
      .from('wallet_movements')
      .delete()
      .in('execution_id', execIds)
  }

  // 3. Borrar el movimiento de APERTURA de este trade
  //    Se identifica por: mismo ticker, misma billetera, tipo 'trade',
  //    monto negativo, execution_id null, y fecha igual a open_date
  await supabase
    .from('wallet_movements')
    .delete()
    .eq('wallet_id', trade.portfolio_id)
    .eq('ticker', trade.ticker)
    .eq('movement_type', 'trade')
    .lt('amount', 0)
    .is('execution_id', null)
    .eq('date', trade.open_date)

  // 4. Borrar ejecuciones del trade
  await supabase
    .from('trade_executions')
    .delete()
    .eq('trade_id', trade.id)

  // 5. Borrar el trade
  await supabase
    .from('trades')
    .delete()
    .eq('id', trade.id)

  fetchData()
}

  // ── Abrir modal de edición ────────────────────────────────────────────────
  const openEdit = (row: EditRow) => {
    setEditingRow(row)
    setEditValues({
      date:       row.date,
      quantity:   String(row.quantity),
      price:      String(row.price),
      commission: String(row.commission),
    })
    setEditError(null)
  }

  // ── Guardar edición ───────────────────────────────────────────────────────
  const saveEdit = async () => {
    if (!editingRow || !viewingTrade) return
    setEditSaving(true)
    setEditError(null)

    const newQty   = parseFloat(editValues.quantity)
    const newPrice = parseFloat(editValues.price)
    const newComm  = parseFloat(editValues.commission) || 0
    const newDate  = editValues.date

    if (isNaN(newQty) || isNaN(newPrice) || newQty <= 0 || newPrice <= 0) {
      setEditError('Cantidad y precio deben ser números positivos.')
      setEditSaving(false)
      return
    }

    try {
      const trade = viewingTrade

      // ── APERTURA ──────────────────────────────────────────────────────────
      if (editingRow.kind === 'apertura') {
        const oldGross = Number(trade.initial_quantity || trade.quantity) * Number(trade.entry_price)
        const newGross = newQty * newPrice

        // 1. Actualizar trade
        await supabase.from('trades').update({
          entry_price:       newPrice,
          initial_quantity:  newQty,
          open_date:         newDate,
        }).eq('id', trade.id)

        // 2. Actualizar wallet_movement de apertura
        //    El movimiento de apertura no tiene execution_id, se identifica por
        //    ticker + portfolio_id + movement_type='trade' + monto negativo (compra)
        const { data: wms } = await supabase
          .from('wallet_movements')
          .select('*')
          .eq('wallet_id', trade.portfolio_id)
          .eq('ticker', trade.ticker)
          .eq('movement_type', 'trade')
          .lt('amount', 0)
          .is('execution_id', null)
          .order('date', { ascending: true })
          .limit(1)

        if (wms && wms.length > 0) {
          await supabase.from('wallet_movements')
            .update({ amount: -newGross, date: newDate })
            .eq('id', wms[0].id)
        }

        // 3. Recalcular realized_pnl con las ejecuciones actualizadas
        const updatedExecs = trade.trade_executions || []
        const newPnL = await recalcPnL(trade.id, { ...trade, entry_price: newPrice, initial_quantity: newQty }, updatedExecs)
        await supabase.from('trades').update({ realized_pnl: newPnL }).eq('id', trade.id)

      // ── RECOMPRA (buy) ────────────────────────────────────────────────────
      } else if (editingRow.kind === 'buy' && editingRow.executionId) {
        const oldExec = trade.trade_executions.find((e: any) => e.id === editingRow.executionId)
        const newNet  = newQty * newPrice + newComm   // débito de billetera

        // 1. Actualizar ejecución
        await supabase.from('trade_executions').update({
          quantity:    newQty,
          price:       newPrice,
          commission:  newComm,
          executed_at: newDate + 'T12:00:00',
          total:       newQty * newPrice,
        }).eq('id', editingRow.executionId)

        // 2. Actualizar wallet_movement vinculado por execution_id
        await supabase.from('wallet_movements')
          .update({ amount: -newNet, date: newDate })
          .eq('execution_id', editingRow.executionId)

        // 3. Recalcular PnL
        const updatedExecs = trade.trade_executions.map((e: any) =>
          e.id === editingRow.executionId
            ? { ...e, quantity: newQty, price: newPrice, commission: newComm }
            : e
        )
        const newPnL = await recalcPnL(trade.id, trade, updatedExecs)
        await supabase.from('trades').update({ realized_pnl: newPnL }).eq('id', trade.id)

      // ── VENTA PARCIAL (sell) o CIERRE (close) ────────────────────────────
      } else if ((editingRow.kind === 'sell' || editingRow.kind === 'close') && editingRow.executionId) {
        const newNet = newQty * newPrice - newComm   // crédito a billetera

        // 1. Actualizar ejecución
        await supabase.from('trade_executions').update({
          quantity:    newQty,
          price:       newPrice,
          commission:  newComm,
          executed_at: newDate + 'T12:00:00',
          total:       newQty * newPrice,
        }).eq('id', editingRow.executionId)

        // 2. Actualizar wallet_movement vinculado
        await supabase.from('wallet_movements')
          .update({ amount: newNet, date: newDate })
          .eq('execution_id', editingRow.executionId)

        // 3. Recalcular PnL
        const updatedExecs = trade.trade_executions.map((e: any) =>
          e.id === editingRow.executionId
            ? { ...e, quantity: newQty, price: newPrice, commission: newComm }
            : e
        )
        const newPnL = await recalcPnL(trade.id, trade, updatedExecs)
        await supabase.from('trades').update({ realized_pnl: newPnL }).eq('id', trade.id)
      }

      // Refrescar datos
      await fetchData()

      // Actualizar viewingTrade con los datos frescos
      const { data: freshTrade } = await supabase
        .from('trades')
        .select('*, portfolios(name), trade_executions(*)')
        .eq('id', trade.id)
        .single()
      if (freshTrade) setViewingTrade(freshTrade)

      setEditingRow(null)

    } catch (err: any) {
      setEditError(err?.message ?? 'Error al guardar. Revisa la consola.')
      console.error(err)
    } finally {
      setEditSaving(false)
    }
  }

  const filteredAndSorted = useMemo(() => {
    let result = trades.filter(t => {
      const matchPortfolio = selectedPortfolio === 'all' || t.portfolio_id === selectedPortfolio
      const matchYear      = selectedYear === 'all' || parseDate(t.close_date || t.open_date).getFullYear().toString() === selectedYear
      const matchTicker    = !filterTicker || t.ticker.toLowerCase().includes(filterTicker.toLowerCase())
      const matchReason    = filterReason === 'all' || (t.close_reason || '') === filterReason
      const matchSector    = filterSector === 'all' || (t.sector || 'Sin sector') === filterSector

      const matchMonth = filterMonth === 'all' || (() => {
        const d = parseDate(t.close_date || t.open_date)
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` === filterMonth
      })()

      return matchPortfolio && matchYear && matchTicker && matchReason && matchSector && matchMonth
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
  }, [trades, selectedPortfolio, selectedYear, filterMonth, filterTicker, filterReason, filterSector, sortConfig, calculateTradeData])

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

        {/* ── Decoraciones gato ── */}
        <div style={{ position: 'absolute', top: -2, right: 60, pointerEvents: 'none' }}>
          <CatEars color="#22c55e" opacity={0.12} size={44} />
        </div>
        <div style={{ position: 'absolute', right: -6, top: '35%', pointerEvents: 'none' }}>
          <CatTail color="#22c55e" opacity={0.08} />
        </div>
        <div style={{ position: 'absolute', top: 16, right: 110, pointerEvents: 'none', display: 'flex', flexDirection: 'column', gap: 18, transform: 'rotate(-12deg)' }}>
          {[14, 11, 8, 6].map((s, i) => <Paw key={i} size={s} color="#22c55e" opacity={0.06 - i * 0.01} rotate={i * 8} />)}
        </div>

        {/* ── HEADER ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', margin: '20px 0 16px', flexWrap: 'wrap', gap: 12 }}>
          <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Paw size={22} color="#22c55e" opacity={0.7} />
            <Paw size={16} color="#22c55e" opacity={0.4} />
            <History size={22} color="#22c55e" />
            Trades cerrados
          </h1>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {[
              { label: 'Trades',      value: summary.total,                   color: '#fff' },
              { label: 'Win rate',    value: `${summary.winRate.toFixed(1)}%`, color: summary.winRate >= 50 ? '#22c55e' : '#f43f5e' },
              { label: 'Invertido',  value: money(summary.totalInv),         color: '#aaa' },
              { label: 'Recuperado', value: money(summary.totalSell),        color: '#aaa' },
              { label: 'PnL total',  value: money(summary.totalPnl),         color: summary.totalPnl >= 0 ? '#22c55e' : '#f43f5e' },
              { label: 'PnL/trade',  value: money(summary.avgPnl),           color: summary.avgPnl >= 0 ? '#22c55e' : '#f43f5e' },
            ].map(c => (
              <div key={c.label} style={summaryCard}>
                <span style={summaryLabel}>{c.label}</span>
                <span style={{ fontSize: 15, fontWeight: 700, color: c.color }}>{c.value}</span>
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
          <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)} style={selectStyle}>
            <option value="all">Todos los meses</option>
            {availableMonths.map(m => {
              const [y, mo] = m.split('-')
              const label = new Date(Number(y), Number(mo) - 1, 1)
                .toLocaleDateString('es-MX', { month: 'long' })
              return <option key={m} value={m}>{label}</option>
            })}
          </select>
          <select value={filterReason} onChange={e => setFilterReason(e.target.value)} style={selectStyle}>
            <option value="all">Todas las razones</option>
            {CLOSE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={filterSector} onChange={e => setFilterSector(e.target.value)} style={selectStyle}>
            <option value="all">Todos los sectores</option>
            {availableSectors.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <input placeholder="Buscar ticker..." value={filterTicker}
            onChange={e => setFilterTicker(e.target.value.toUpperCase())}
            style={{ ...selectStyle, minWidth: 140 }} />
          <span style={{ fontSize: 10, color: '#aaa' }}>{filteredAndSorted.length} resultado(s)</span>
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
                  <th key={label} style={{ ...thStyle, cursor: key ? 'pointer' : 'default' }}
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
                  <td colSpan={12} style={{ padding: 40, textAlign: 'center', color: '#666' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                      <Paw size={30} color="#444" opacity={0.5} />
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
                      <div style={{ fontSize: '0.6rem', color: '#777' }}>{t.portfolios?.name}</div>
                    </td>
                    <td style={{ ...tdStyle, color: '#aaa', fontSize: 11 }}>
                      {t.open_date ? parseDate(t.open_date).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}
                    </td>
                    <td style={{ ...tdStyle, color: '#aaa', fontSize: 11 }}>
                      {t.close_date ? parseDate(t.close_date).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center', color: '#aaa' }}>{d.diffDays}</td>
                    <td style={{ ...tdStyle, fontSize: 11, color: '#bbb' }}>
                      {t.close_reason || <span style={{ color: '#555' }}>—</span>}
                    </td>
                    <td style={{ ...tdStyle, fontSize: 11, color: '#bbb' }}>
                      {t.sector || <span style={{ color: '#555' }}>—</span>}
                    </td>
                    <td style={{ ...tdStyle, color: '#ccc' }}>{money(d.totalInvested)}</td>
                    <td style={{ ...tdStyle, color: '#ccc' }}>{money(d.totalSells)}</td>
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
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                        <button onClick={() => setViewingTrade(t)} style={actionBtn('#00bfff')}
                          title="Historial"
                          onMouseEnter={e => (e.currentTarget.style.color = '#00bfff')}
                          onMouseLeave={e => (e.currentTarget.style.color = '#555')}>
                          Historial
                        </button>
                        <button onClick={() => handleDelete(t)} style={iconBtn}
                          title="Eliminar"
                          onMouseEnter={e => (e.currentTarget.style.color = '#f43f5e')}
                          onMouseLeave={e => (e.currentTarget.style.color = '#444')}>
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

        <div style={{ marginTop: 8, fontSize: 9, color: '#555', textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 5 }}>
          <Paw size={9} color="#444" opacity={0.5} />
          {filteredAndSorted.length} trades · PnL considera comisiones de cada ejecución
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            MODAL HISTORIAL + EDICIÓN
        ════════════════════════════════════════════════════════════════════ */}
        {viewingTrade && (
          <div style={overlayStyle} onClick={() => { setViewingTrade(null); setEditingRow(null) }}>
            <div style={modalStyle} onClick={e => e.stopPropagation()}>

              {/* Header del modal */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Paw size={14} color="#00bfff" opacity={0.6} />
                  <h2 style={{ margin: 0, fontSize: 16 }}>
                    Historial: <span style={{ color: '#00bfff' }}>{viewingTrade.ticker}</span>
                  </h2>
                  {viewingTrade.sector && (
                    <span style={{ fontSize: 11, color: '#777', marginLeft: 4 }}>{viewingTrade.sector}</span>
                  )}
                </div>
                <button onClick={() => { setViewingTrade(null); setEditingRow(null) }}
                  style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}>
                  <X size={18} />
                </button>
              </div>

              {/* Aviso de edición */}
              <div style={{
                background: 'rgba(234,179,8,0.06)', border: '1px solid rgba(234,179,8,0.2)',
                borderRadius: 8, padding: '8px 12px', marginBottom: 14,
                display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: '#c8a800',
              }}>
                <AlertTriangle size={12} />
                Haz clic en el lápiz de cualquier fila para corregir un error. Los cambios actualizan automáticamente precio, cantidad, comisión y billetera.
              </div>

              {/* Tabla de ejecuciones */}
              <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#000' }}>
                      {['Fecha', 'Tipo', 'Cantidad', 'Precio', 'Comisión', 'Neto billetera', 'Editar'].map(h => (
                        <th key={h} style={modalTh}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {/* ── FILA APERTURA ── */}
                    {(() => {
                      const isEditing = editingRow?.kind === 'apertura'
                      const gross = Number(viewingTrade.initial_quantity || viewingTrade.quantity) * Number(viewingTrade.entry_price)
                      return (
                        <tr style={{ ...trStyle, background: isEditing ? 'rgba(0,191,255,0.04)' : 'transparent' }}>
                          <td style={modalTd}>{isEditing
                            ? <input type="date" value={editValues.date} onChange={e => setEditValues(p => ({ ...p, date: e.target.value }))} style={editInp} />
                            : parseDate(viewingTrade.open_date).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
                          }</td>
                          <td style={{ ...modalTd, color: '#00bfff', fontWeight: 700 }}>Apertura</td>
                          <td style={modalTd}>{isEditing
                            ? <input type="number" min="0" value={editValues.quantity} onChange={e => setEditValues(p => ({ ...p, quantity: e.target.value }))} style={{ ...editInp, width: 80 }} />
                            : shares(viewingTrade.initial_quantity || viewingTrade.quantity)
                          }</td>
                          <td style={modalTd}>{isEditing
                            ? <input type="number" min="0" value={editValues.price} onChange={e => setEditValues(p => ({ ...p, price: e.target.value }))} style={{ ...editInp, width: 90 }} />
                            : money(viewingTrade.entry_price)
                          }</td>
                          <td style={{ ...modalTd, color: '#666' }}>—</td>
                          <td style={{ ...modalTd, color: '#f43f5e' }}>−{money(gross)}</td>
                          <td style={modalTd}>
                            {isEditing
                              ? <EditActions onSave={saveEdit} onCancel={() => setEditingRow(null)} saving={editSaving} />
                              : <EditPencil onClick={() => openEdit({
                                  kind: 'apertura', executionId: null,
                                  date: viewingTrade.open_date, quantity: Number(viewingTrade.initial_quantity || viewingTrade.quantity),
                                  price: Number(viewingTrade.entry_price), commission: 0,
                                })} />
                            }
                          </td>
                        </tr>
                      )
                    })()}

                    {/* ── FILAS DE EJECUCIONES ── */}
                    {viewingTrade.trade_executions
                      ?.slice()
                      .sort((a: any, b: any) => new Date(a.executed_at).getTime() - new Date(b.executed_at).getTime())
                      .map((ex: any) => {
                        const type    = ex.execution_type?.toLowerCase()
                        const isBuy   = type === 'buy'
                        const isClose = type === 'close'
                        const comm    = Number(ex.commission || 0)
                        const gross   = Number(ex.quantity) * Number(ex.price)
                        const net     = isBuy ? -(gross + comm) : gross - comm
                        const typeLabel = isBuy ? 'Recompra' : isClose ? 'Cierre' : 'Venta parcial'
                        const typeColor = isBuy ? '#22c55e' : isClose ? '#00bfff' : '#f43f5e'
                        const isEditing = editingRow?.executionId === ex.id
                        const exDateStr = (ex.executed_at || '').split('T')[0]

                        return (
                          <tr key={ex.id} style={{ ...trStyle, background: isEditing ? 'rgba(0,191,255,0.04)' : 'transparent' }}>
                            <td style={modalTd}>{isEditing
                              ? <input type="date" value={editValues.date} onChange={e => setEditValues(p => ({ ...p, date: e.target.value }))} style={editInp} />
                              : parseDate(exDateStr).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
                            }</td>
                            <td style={{ ...modalTd, color: typeColor, fontWeight: 700 }}>{typeLabel}</td>
                            <td style={modalTd}>{isEditing
                              ? <input type="number" min="0" value={editValues.quantity} onChange={e => setEditValues(p => ({ ...p, quantity: e.target.value }))} style={{ ...editInp, width: 80 }} />
                              : shares(ex.quantity)
                            }</td>
                            <td style={modalTd}>{isEditing
                              ? <input type="number" min="0" value={editValues.price} onChange={e => setEditValues(p => ({ ...p, price: e.target.value }))} style={{ ...editInp, width: 90 }} />
                              : money(ex.price)
                            }</td>
                            <td style={{ ...modalTd, color: '#aaa' }}>{isEditing
                              ? <input type="number" min="0" value={editValues.commission} onChange={e => setEditValues(p => ({ ...p, commission: e.target.value }))} style={{ ...editInp, width: 80 }} />
                              : comm > 0 ? money(comm) : '—'
                            }</td>
                            <td style={{ ...modalTd, color: net >= 0 ? '#22c55e' : '#f43f5e', fontWeight: 600 }}>
                              {net >= 0 ? '+' : ''}{money(net)}
                            </td>
                            <td style={modalTd}>
                              {isEditing
                                ? <EditActions onSave={saveEdit} onCancel={() => setEditingRow(null)} saving={editSaving} />
                                : <EditPencil onClick={() => openEdit({
                                    kind: isBuy ? 'buy' : isClose ? 'close' : 'sell',
                                    executionId: ex.id,
                                    date: exDateStr, quantity: Number(ex.quantity),
                                    price: Number(ex.price), commission: comm,
                                  })} />
                              }
                            </td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              </div>

              {/* Error de edición */}
              {editError && (
                <div style={{ marginTop: 10, background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.3)', borderRadius: 6, padding: '8px 12px', fontSize: 11, color: '#f43f5e', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <AlertTriangle size={12} /> {editError}
                </div>
              )}

              {/* Resumen del trade */}
              {(() => {
                const d = calculateTradeData(viewingTrade)
                return (
                  <div style={{ display: 'flex', gap: 14, marginTop: 16, padding: '12px 14px', background: '#000', borderRadius: 10, flexWrap: 'wrap', borderTop: '1px solid #111' }}>
                    {[
                      { label: 'Invertido',  value: money(d.totalInvested), color: '#aaa' },
                      { label: 'Recuperado', value: money(d.totalSells),    color: '#aaa' },
                      { label: 'PnL',        value: money(d.pnlCash),       color: d.pnlCash >= 0 ? '#22c55e' : '#f43f5e' },
                      { label: 'PnL %',      value: `${d.pnlPct >= 0 ? '+' : ''}${d.pnlPct.toFixed(2)}%`, color: d.pnlPct >= 0 ? '#22c55e' : '#f43f5e' },
                      { label: 'Duración',   value: `${d.diffDays} días`,   color: '#aaa' },
                    ].map(item => (
                      <div key={item.label} style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 9, color: '#666', fontWeight: 700, letterSpacing: 0.5, marginBottom: 4 }}>{item.label}</div>
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

// ── Botón lápiz ───────────────────────────────────────────────────────────────
function EditPencil({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} title="Editar este registro"
      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#444', padding: 4, transition: 'color 0.2s', display: 'flex', alignItems: 'center' }}
      onMouseEnter={e => (e.currentTarget.style.color = '#eab308')}
      onMouseLeave={e => (e.currentTarget.style.color = '#444')}>
      <Pencil size={13} />
    </button>
  )
}

// ── Botones guardar / cancelar edición ────────────────────────────────────────
function EditActions({ onSave, onCancel, saving }: { onSave: () => void; onCancel: () => void; saving: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <button onClick={onSave} disabled={saving}
        style={{ background: saving ? '#111' : 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.4)', color: '#22c55e', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
        <Check size={11} /> {saving ? '...' : 'OK'}
      </button>
      <button onClick={onCancel} disabled={saving}
        style={{ background: 'none', border: '1px solid #222', color: '#666', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', fontSize: 10 }}>
        <X size={11} />
      </button>
    </div>
  )
}

// ── Estilos ───────────────────────────────────────────────────────────────────
const walletNav: React.CSSProperties    = { display: 'flex', gap: 8, marginBottom: 14, borderBottom: '1px solid #1a1a1a', paddingBottom: 10, overflowX: 'auto' }
const walletTab = (active: boolean): React.CSSProperties => ({ background: active ? '#22c55e' : 'transparent', color: active ? '#000' : '#aaa', border: 'none', padding: '5px 12px', borderRadius: 4, fontSize: 10, fontWeight: 'bold', cursor: 'pointer', whiteSpace: 'nowrap' })
const tableWrapper: React.CSSProperties = { background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: 12, overflow: 'hidden', marginBottom: 24 }
const thStyle: React.CSSProperties      = { padding: '10px 12px', textAlign: 'left', fontSize: 9, textTransform: 'uppercase', color: '#888', userSelect: 'none', whiteSpace: 'nowrap', letterSpacing: 0.5 }
const tdStyle: React.CSSProperties      = { padding: '8px 12px', fontSize: 12, borderBottom: '1px solid #0a0a0a' }
const trStyle: React.CSSProperties      = { borderBottom: '1px solid #0a0a0a' }
const selectStyle: React.CSSProperties  = { background: '#0a0a0a', color: '#ccc', border: '1px solid #1a1a1a', padding: '6px 10px', borderRadius: 6, fontSize: 11, outline: 'none' }
const summaryCard: React.CSSProperties  = { display: 'flex', flexDirection: 'column', gap: 3, background: '#0a0a0a', padding: '8px 14px', borderRadius: 8, border: '1px solid #1a1a1a' }
const summaryLabel: React.CSSProperties = { fontSize: 9, color: '#888', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }
const actionBtn = (hoverColor: string): React.CSSProperties => ({ background: 'none', border: '1px solid #1a1a1a', color: '#777', padding: '3px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 10, fontWeight: 'bold', transition: 'color 0.2s' })
const iconBtn: React.CSSProperties      = { background: 'none', border: 'none', color: '#444', cursor: 'pointer', transition: 'color 0.2s', padding: 4, display: 'flex', alignItems: 'center' }
const overlayStyle: React.CSSProperties = { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.9)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }
const modalStyle: React.CSSProperties   = { background: '#0a0a0a', padding: 24, borderRadius: 16, width: '92%', maxWidth: 720, border: '1px solid #1a1a1a', maxHeight: '90vh', overflowY: 'auto' }
const modalTh: React.CSSProperties      = { padding: '8px 10px', textAlign: 'left', fontSize: 9, color: '#888', fontWeight: 700, letterSpacing: 0.5, borderBottom: '1px solid #1a1a1a' }
const modalTd: React.CSSProperties      = { padding: '9px 10px', fontSize: 12, color: '#ccc' }
const editInp: React.CSSProperties      = { background: '#050505', border: '1px solid #333', color: '#fff', padding: '3px 7px', borderRadius: 5, outline: 'none', fontSize: 11, width: 110 }