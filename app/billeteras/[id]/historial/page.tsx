'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { usePrivacy } from '@/lib/PrivacyContext'
import AppShell from '@/app/AppShell'
import { FaTrash, FaPencilAlt, FaSort, FaSortUp, FaSortDown } from 'react-icons/fa'
import { ArrowDownCircle, ArrowUpCircle, DollarSign, BarChart2 } from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid
} from 'recharts'

const parseDate = (d: string) => new Date((d || '').split('T')[0] + 'T00:00:00')

const MOVEMENT_TYPES = [
  { value: '',         label: 'Todos los tipos' },
  { value: 'deposito', label: 'Depósito' },
  { value: 'retiro',   label: 'Retiro' },
  { value: 'dividend', label: 'Dividendo' },
  { value: 'trade',    label: 'Trade (compras / ventas)' },
]

const movementLabel = (type: string, notes?: string) => {
  if (type === 'trade' && notes) {
    const n = notes.toLowerCase()
    if (n.includes('apertura'))      return { text: 'Apertura',      color: '#f43f5e', icon: <BarChart2 size={12} /> }
    if (n.includes('recompra'))      return { text: 'Recompra',      color: '#f43f5e', icon: <BarChart2 size={12} /> }
    if (n.includes('cierre'))        return { text: 'Cierre',        color: '#22c55e', icon: <BarChart2 size={12} /> }
    if (n.includes('venta parcial')) return { text: 'Venta parcial', color: '#eab308', icon: <BarChart2 size={12} /> }
  }
  switch (type) {
    case 'deposito': return { text: 'Depósito',  color: '#22c55e', icon: <ArrowDownCircle size={12} /> }
    case 'retiro':   return { text: 'Retiro',     color: '#f43f5e', icon: <ArrowUpCircle   size={12} /> }
    case 'dividend': return { text: 'Dividendo',  color: '#00bfff', icon: <DollarSign      size={12} /> }
    case 'trade':    return { text: 'Trade',      color: '#ffd700', icon: <BarChart2       size={12} /> }
    default:         return { text: type,         color: '#888',    icon: null }
  }
}

export default function HistorialPage() {
  const { id }   = useParams()
  const { money } = usePrivacy()

  const [portfolioName, setPortfolioName] = useState('')
  const [movements,     setMovements]     = useState<any[]>([])

  const [filterTicker, setFilterTicker] = useState('')
  const [filterType,   setFilterType]   = useState('')
  const [filterYear,   setFilterYear]   = useState(new Date().getFullYear().toString())
  const [sortConfig,   setSortConfig]   = useState<{ key: string, direction: 'asc' | 'desc' }>({ key: 'date', direction: 'desc' })

  const [editingMovement, setEditingMovement] = useState<any>(null)
  const [editAmount,      setEditAmount]      = useState('')
  const [editNotes,       setEditNotes]       = useState('')
  const [editDate,        setEditDate]        = useState('')

  // ── Fetch con paginación completa ─────────────────────────────────────────
  const fetchMovements = useCallback(async () => {
    if (!id) return
    let all: any[] = []
    let from = 0
    while (true) {
      const { data, error } = await supabase
        .from('wallet_movements')
        .select('*')
        .eq('wallet_id', id)
        .order('date', { ascending: true })
        .range(from, from + 999)
      if (error || !data?.length) break
      all = [...all, ...data]
      if (data.length < 1000) break
      from += 1000
    }
    setMovements(all)
  }, [id])

  const fetchPortfolioName = useCallback(async () => {
    const { data } = await supabase.from('portfolios').select('name').eq('id', id).single()
    if (data) setPortfolioName(data.name)
  }, [id])

  useEffect(() => {
    if (id) { fetchMovements(); fetchPortfolioName() }
  }, [id, fetchMovements, fetchPortfolioName])

  const availableYears = useMemo(() => {
    const years = new Set(movements.map(m => parseDate(m.date).getFullYear()))
    years.add(new Date().getFullYear())
    return Array.from(years).sort((a, b) => b - a)
  }, [movements])

  // ── Métricas globales (todos los movimientos) ─────────────────────────────
  const saldoDisponible  = useMemo(() =>
    movements.reduce((acc, m) => acc + Number(m.amount), 0)
  , [movements])

  const capitalDepositado = useMemo(() =>
    movements
      .filter(m => m.movement_type === 'deposito' || m.movement_type === 'retiro')
      .reduce((acc, m) => acc + Number(m.amount), 0)
  , [movements])

  // ── Filtros ───────────────────────────────────────────────────────────────
  const sortedAndFiltered = useMemo(() => {
    let result = [...movements]
    if (filterYear !== 'all') result = result.filter(m => parseDate(m.date).getFullYear().toString() === filterYear)
    if (filterTicker)         result = result.filter(m => m.ticker?.toLowerCase().includes(filterTicker.toLowerCase()))
    if (filterType)           result = result.filter(m => m.movement_type === filterType)

    result.sort((a, b) => {
      let vA = a[sortConfig.key], vB = b[sortConfig.key]
      if (sortConfig.key === 'date')   { vA = parseDate(a.date).getTime(); vB = parseDate(b.date).getTime() }
      if (sortConfig.key === 'amount') { vA = Number(a.amount);            vB = Number(b.amount) }
      if (vA < vB) return sortConfig.direction === 'asc' ? -1 : 1
      if (vA > vB) return sortConfig.direction === 'asc' ? 1 : -1
      return 0
    })
    return result
  }, [filterYear, filterTicker, filterType, movements, sortConfig])

  // ── Gráfica: saldo real acumulado (TODOS los movimientos) ─────────────────
  const chartData = useMemo(() => {
    let base = [...movements].sort((a, b) => parseDate(a.date).getTime() - parseDate(b.date).getTime())
    if (filterYear !== 'all') base = base.filter(m => parseDate(m.date).getFullYear().toString() === filterYear)
    let accumulated = 0
    return base.map(m => {
      accumulated += Number(m.amount)
      return {
        date:   m.date,
        saldo:  parseFloat(accumulated.toFixed(2)),
        tipo:   m.movement_type,
      }
    })
  }, [movements, filterYear])

  const requestSort = (key: string) => {
    setSortConfig(prev =>
      prev.key === key
        ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' }
    )
  }

  const renderSortIcon = (key: string) => {
    if (sortConfig.key !== key) return <FaSort style={{ marginLeft: 5, opacity: 0.3 }} />
    return sortConfig.direction === 'asc'
      ? <FaSortUp   style={{ marginLeft: 5, color: '#00bfff' }} />
      : <FaSortDown style={{ marginLeft: 5, color: '#00bfff' }} />
  }

  const handleDelete = async (movementId: string) => {
    if (!window.confirm('¿Eliminar este registro?')) return
    const { error } = await supabase.from('wallet_movements').delete().eq('id', movementId)
    if (!error) fetchMovements()
  }

  const handleEditOpen = (m: any) => {
    setEditingMovement(m)
    setEditAmount(Math.abs(Number(m.amount)).toString())
    setEditNotes(m.notes || '')
    setEditDate(m.date)
  }

  const handleUpdate = async () => {
    if (!editAmount || !editDate) return alert('Monto y fecha son obligatorios')
    const originalSign = Number(editingMovement.amount) < 0 ? -1 : 1
    const finalAmount  = parseFloat((originalSign * Math.abs(Number(editAmount))).toFixed(2))
    const { error } = await supabase.from('wallet_movements')
      .update({ amount: finalAmount, notes: editNotes, date: editDate })
      .eq('id', editingMovement.id)
    if (!error) { setEditingMovement(null); fetchMovements() }
    else alert(error.message)
  }

  return (
    <AppShell>
      <div style={{ maxWidth: 1200, margin: '0 auto', paddingTop: 20, paddingBottom: 40 }}>

        {/* HEADER */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, padding: '0 10px' }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: 'white' }}>
              Historial: {portfolioName}
            </h1>
            <p style={{ color: '#444', fontSize: 13, margin: '5px 0 0' }}>
              {movements.length} registros totales
            </p>
          </div>

          {/* Dos métricas */}
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={statCardMini}>
              <span style={{ fontSize: 9, color: '#444', fontWeight: 800, display: 'block', marginBottom: 4, letterSpacing: 0.5 }}>
                SALDO DISPONIBLE
              </span>
              <span style={{ fontSize: 20, fontWeight: 900, color: saldoDisponible >= 0 ? '#22c55e' : '#f43f5e' }}>
                {money(saldoDisponible)}
              </span>
              <span style={{ fontSize: 9, color: '#333', display: 'block', marginTop: 3 }}>
                depósitos + ventas + dividendos − compras − retiros
              </span>
            </div>
            <div style={statCardMini}>
              <span style={{ fontSize: 9, color: '#444', fontWeight: 800, display: 'block', marginBottom: 4, letterSpacing: 0.5 }}>
                CAPITAL DEPOSITADO
              </span>
              <span style={{ fontSize: 20, fontWeight: 900, color: '#00bfff' }}>
                {money(capitalDepositado)}
              </span>
              <span style={{ fontSize: 9, color: '#333', display: 'block', marginTop: 3 }}>
                depósitos − retiros · de tu bolsillo
              </span>
            </div>
          </div>
        </div>

        {/* GRÁFICA */}
        <div style={{ ...chartBox, margin: '0 10px 20px' }}>
          <div style={{ fontSize: 10, color: '#444', marginBottom: 10, fontWeight: 700, letterSpacing: 1 }}>
            SALDO DISPONIBLE ACUMULADO
            {filterYear !== 'all' ? ` · ${filterYear}` : ' · todos los años'}
            <span style={{ color: '#2a2a2a', marginLeft: 8, fontWeight: 400, fontSize: 9 }}>
              todos los movimientos (depósitos, compras, ventas, dividendos, retiros)
            </span>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorSaldo" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1a1a1a" vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="date" stroke="#333" fontSize={10}
                tickFormatter={v => parseDate(v).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })} />
              <YAxis stroke="#333" fontSize={10} tickFormatter={v => `$${v.toLocaleString()}`} />
              <Tooltip
                contentStyle={{ background: '#000', border: '1px solid #222', fontSize: 12 }}
                formatter={(v: any) => [money(Number(v)), 'Saldo']}
                labelFormatter={l => parseDate(l).toLocaleDateString('es-MX')}
              />
              <Area type="monotone" dataKey="saldo" stroke="#22c55e" strokeWidth={2} fillOpacity={1} fill="url(#colorSaldo)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* FILTROS */}
        <div style={{ ...filterBar, margin: '0 10px 16px' }}>
          <select value={filterYear} onChange={e => setFilterYear(e.target.value)} style={selectStyle}>
            <option value="all">Todos los años</option>
            {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={filterType} onChange={e => setFilterType(e.target.value)} style={selectStyle}>
            {MOVEMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <input
            placeholder="Filtrar ticker..."
            value={filterTicker}
            onChange={e => setFilterTicker(e.target.value.toUpperCase())}
            style={inputMinimal}
          />
          <span style={{ fontSize: 10, color: '#333', alignSelf: 'center', marginLeft: 'auto' }}>
            {sortedAndFiltered.length} de {movements.length}
          </span>
        </div>

        {/* TABLA */}
        <div style={{ ...tableWrapper, margin: '0 10px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1a1a1a', background: '#050505' }}>
                {[
                  { key: 'date',          label: 'Fecha' },
                  { key: 'movement_type', label: 'Tipo' },
                  { key: 'amount',        label: 'Monto' },
                  { key: 'ticker',        label: 'Ticker' },
                ].map(col => (
                  <th key={col.key} style={{ ...thStyle, cursor: 'pointer' }} onClick={() => requestSort(col.key)}>
                    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                      {col.label} {renderSortIcon(col.key)}
                    </span>
                  </th>
                ))}
                <th style={thStyle}>Observación</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Acc.</th>
              </tr>
            </thead>
            <tbody>
              {sortedAndFiltered.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: 40, textAlign: 'center', color: '#333' }}>
                    No hay movimientos para este filtro.
                  </td>
                </tr>
              )}
              {sortedAndFiltered.map(m => {
                const label = movementLabel(m.movement_type, m.notes)
                return (
                  <tr key={m.id} style={trStyle}>
                    <td style={tdStyle}>
                      {parseDate(m.date).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                    <td style={tdStyle}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: label.color, fontWeight: 700, fontSize: 11 }}>
                        {label.icon} {label.text}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, color: Number(m.amount) >= 0 ? '#22c55e' : '#f43f5e', fontWeight: 700, fontFamily: 'monospace' }}>
                      {money(Number(m.amount))}
                    </td>
                    <td style={{ ...tdStyle, color: '#888' }}>{m.ticker || '—'}</td>
                    <td style={{ ...tdStyle, color: '#555', fontSize: '0.82rem', maxWidth: 240 }}>
                      {m.notes
                        ? <span title={m.notes}>{m.notes.length > 50 ? m.notes.slice(0, 50) + '…' : m.notes}</span>
                        : '—'}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', gap: 12 }}>
                        <button onClick={() => handleEditOpen(m)} style={actionBtnStyle}
                          onMouseEnter={e => (e.currentTarget.style.color = '#eab308')}
                          onMouseLeave={e => (e.currentTarget.style.color = '#333')}>
                          <FaPencilAlt size={12} />
                        </button>
                        <button onClick={() => handleDelete(m.id)} style={actionBtnStyle}
                          onMouseEnter={e => (e.currentTarget.style.color = '#f43f5e')}
                          onMouseLeave={e => (e.currentTarget.style.color = '#333')}>
                          <FaTrash size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* MODAL EDITAR */}
        {editingMovement && (
          <div style={modalOverlay}>
            <div style={modalBox}>
              <h3 style={{ margin: '0 0 20px 0', fontSize: 16, color: 'white' }}>Editar movimiento</h3>
              <label style={modalLabel}>Monto (USD) — valor absoluto</label>
              <input type="number" style={modalInput} value={editAmount}
                onChange={e => setEditAmount(e.target.value)} placeholder="0.00" />
              <label style={modalLabel}>Fecha</label>
              <input type="date" style={modalInput} value={editDate}
                onChange={e => setEditDate(e.target.value)} />
              <label style={modalLabel}>Notas / Observación</label>
              <textarea style={{ ...modalInput, height: 80, resize: 'none' }} value={editNotes}
                onChange={e => setEditNotes(e.target.value)} />
              <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                <button onClick={handleUpdate} style={confirmBtn}>Guardar cambios</button>
                <button onClick={() => setEditingMovement(null)} style={cancelBtn}>Cancelar</button>
              </div>
            </div>
          </div>
        )}

      </div>
    </AppShell>
  )
}

const chartBox: React.CSSProperties      = { background: '#0a0a0a', padding: 25, borderRadius: 15, border: '1px solid #1a1a1a' }
const filterBar: React.CSSProperties     = { display: 'flex', alignItems: 'center', gap: 10, background: '#0a0a0a', padding: '10px 14px', borderRadius: 10, border: '1px solid #1a1a1a', flexWrap: 'wrap' }
const statCardMini: React.CSSProperties  = { background: '#0a0a0a', padding: '12px 18px', borderRadius: 10, border: '1px solid #1a1a1a', textAlign: 'right', color: 'white' }
const tableWrapper: React.CSSProperties  = { background: '#0a0a0a', borderRadius: 12, border: '1px solid #1a1a1a', overflow: 'hidden' }
const thStyle: React.CSSProperties       = { textAlign: 'left', padding: '12px 18px', color: '#444', fontSize: 9, fontWeight: 800, letterSpacing: 1, userSelect: 'none', whiteSpace: 'nowrap' }
const tdStyle: React.CSSProperties       = { padding: '11px 18px', fontSize: 12, color: '#ccc' }
const trStyle: React.CSSProperties       = { borderBottom: '1px solid #0f0f0f', transition: '0.2s' }
const selectStyle: React.CSSProperties   = { background: '#000', border: '1px solid #222', color: '#ccc', padding: '7px 10px', borderRadius: 6, fontSize: 11, outline: 'none' }
const inputMinimal: React.CSSProperties  = { background: '#000', border: '1px solid #222', padding: '7px 12px', borderRadius: 6, color: '#fff', fontSize: 11, outline: 'none' }
const actionBtnStyle: React.CSSProperties = { background: 'none', border: 'none', color: '#333', cursor: 'pointer', transition: 'color 0.2s', padding: 5, display: 'flex', alignItems: 'center' }
const modalOverlay: React.CSSProperties  = { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }
const modalBox: React.CSSProperties      = { background: '#0a0a0a', padding: 30, borderRadius: 15, border: '1px solid #1a1a1a', width: 400 }
const modalLabel: React.CSSProperties    = { display: 'block', fontSize: 10, color: '#444', marginBottom: 5, fontWeight: 'bold', letterSpacing: 0.5 }
const modalInput: React.CSSProperties    = { width: '100%', background: '#000', border: '1px solid #222', padding: 12, borderRadius: 8, color: '#fff', marginBottom: 15, outline: 'none', boxSizing: 'border-box', fontSize: 13 }
const confirmBtn: React.CSSProperties    = { flex: 1, background: '#00bfff', color: '#000', border: 'none', padding: 12, borderRadius: 8, fontWeight: 'bold', cursor: 'pointer' }
const cancelBtn: React.CSSProperties     = { flex: 1, background: 'transparent', color: '#444', border: '1px solid #222', padding: 12, borderRadius: 8, cursor: 'pointer' }