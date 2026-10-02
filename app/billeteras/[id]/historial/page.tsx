'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { usePrivacy } from '@/lib/PrivacyContext'
import AppShell from '@/app/AppShell'
import { FaTrash, FaPencilAlt, FaSort, FaSortUp, FaSortDown } from 'react-icons/fa'
import { ArrowDownCircle, ArrowUpCircle, DollarSign, BarChart2, TrendingUp, TrendingDown } from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid
} from 'recharts'

// ── Helpers ───────────────────────────────────────────────────────────────────

// 'YYYY-MM-DD' (las fechas pueden venir con hora). Comparar strings es mucho más barato que crear Date
const dayKey = (d: string) => (d || '').split('T')[0]
const parseDate = (d: string) => new Date(dayKey(d) + 'T00:00:00')
const posAmount = (v: string) => v.replace(/[^0-9.]/g, '').replace(/^(\d*\.?\d*).*$/, '$1')

// Redondeo a centavos; el "+ 0" evita mostrar "-0.00" por residuos de coma flotante
const r2 = (n: number) => Math.round(n * 100) / 100 + 0
const errMsg = (e: any) => e?.message || String(e)

// Trae todas las filas paginando (la consulta debe traer un .order() determinístico)
async function fetchAllRows(build: (from: number, to: number) => any): Promise<any[]> {
  const all: any[] = []
  let from = 0
  while (true) {
    const { data, error } = await build(from, from + 999)
    if (error) throw error
    if (!data?.length) break
    all.push(...data)
    if (data.length < 1000) break
    from += 1000
  }
  return all
}

const PAGE_SIZE = 100

// ── Tema de gatos ────────────────────────────────────────────────────────────
const Paw = ({ size = 14, color = '#444', opacity = 1, style = {} }: any) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ opacity, flexShrink: 0, ...style }}>
    <ellipse cx="6"  cy="5"  rx="2.5" ry="3"/>
    <ellipse cx="11" cy="3"  rx="2.5" ry="3"/>
    <ellipse cx="16" cy="4"  rx="2.5" ry="3"/>
    <ellipse cx="19" cy="9"  rx="2"   ry="2.5"/>
    <path d="M12 22c-5 0-8-3-8-7 0-2.5 1.5-4.5 4-5.5 1-.4 2-.6 4-.6s3 .2 4 .6c2.5 1 4 3 4 5.5 0 4-3 7-8 7z"/>
  </svg>
)

// Rastro de huellas decorativas
const PawTrail = ({ color, top, right, rotate = 0 }: any) => (
  <div style={{ position: 'absolute', top, right, display: 'flex', gap: 6, transform: `rotate(${rotate}deg)`, pointerEvents: 'none' }}>
    {[0.12, 0.08, 0.05].map((op, i) => <Paw key={i} size={16} color={color} opacity={op} />)}
  </div>
)

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
  const { id }                = useParams()
  const walletId              = (Array.isArray(id) ? id[0] : id) as string | undefined
  const { money, visible }    = usePrivacy()

  const [portfolioName, setPortfolioName] = useState('')
  const [movements,     setMovements]     = useState<any[]>([])
  const [pnlCerrados,   setPnlCerrados]   = useState<number>(0)
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState('')

  const [filterTicker, setFilterTicker] = useState('')
  const [filterType,   setFilterType]   = useState('')
  const [filterYear,   setFilterYear]   = useState(new Date().getFullYear().toString())
  const [sortConfig,   setSortConfig]   = useState<{ key: string, direction: 'asc' | 'desc' }>({ key: 'date', direction: 'desc' })
  const [shown,        setShown]        = useState(PAGE_SIZE)

  const [editingMovement, setEditingMovement] = useState<any>(null)
  const [editAmount,      setEditAmount]      = useState('')
  const [editNotes,       setEditNotes]       = useState('')
  const [editDate,        setEditDate]        = useState('')
  const [saving,          setSaving]          = useState(false)

  // ── Carga de datos ────────────────────────────────────────────────────────
  const loadMovements = useCallback(async (isCancelled: () => boolean = () => false) => {
    if (!walletId) return
    try {
      const rows = await fetchAllRows((a, b) =>
        supabase.from('wallet_movements')
          .select('*')
          .eq('wallet_id', walletId)
          .order('date', { ascending: true })
          .order('id',   { ascending: true })   // desempate: sin esto la paginación puede repetir u omitir filas
          .range(a, b))
      if (!isCancelled()) { setMovements(rows); setError('') }
    } catch (err) {
      if (!isCancelled()) setError('No se pudieron cargar los movimientos: ' + errMsg(err))
    }
  }, [walletId])

  // Nombre de la billetera + PnL realizado de trades cerrados
  const loadMeta = useCallback(async (isCancelled: () => boolean = () => false) => {
    if (!walletId) return
    try {
      const [nameRes, closed] = await Promise.all([
        supabase.from('portfolios').select('name').eq('id', walletId).single(),
        fetchAllRows((a, b) =>
          supabase.from('trades')
            .select('realized_pnl')
            .eq('portfolio_id', walletId).eq('status', 'closed')
            .order('id').range(a, b)),
      ])
      if (isCancelled()) return
      if (nameRes.data) setPortfolioName(nameRes.data.name)
      setPnlCerrados(r2(closed.reduce((acc, t) => acc + Number(t.realized_pnl || 0), 0)))
    } catch (err) {
      console.error('Error cargando datos de la billetera:', err)
    }
  }, [walletId])

  useEffect(() => {
    if (!walletId) return
    let cancelled = false
    const isCancelled = () => cancelled
    setLoading(true)
    Promise.all([loadMovements(isCancelled), loadMeta(isCancelled)])
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [walletId, loadMovements, loadMeta])

  // ── Derivados ─────────────────────────────────────────────────────────────
  const availableYears = useMemo(() => {
    const years = new Set(movements.map(m => Number(dayKey(m.date).slice(0, 4))))
    years.add(new Date().getFullYear())
    return Array.from(years).sort((a, b) => b - a)
  }, [movements])

  const saldoDisponible = useMemo(() =>
    r2(movements.reduce((acc, m) => acc + Number(m.amount), 0))
  , [movements])

  const capitalDepositado = useMemo(() =>
    r2(movements
      .filter(m => m.movement_type === 'deposito' || m.movement_type === 'retiro')
      .reduce((acc, m) => acc + Number(m.amount), 0))
  , [movements])

  const sortedAndFiltered = useMemo(() => {
    const tk  = filterTicker.toLowerCase()
    const dir = sortConfig.direction === 'asc' ? 1 : -1
    let result = movements.filter(m =>
      (filterYear === 'all' || dayKey(m.date).slice(0, 4) === filterYear) &&
      (!tk         || m.ticker?.toLowerCase().includes(tk)) &&
      (!filterType || m.movement_type === filterType)
    )
    const valueOf = (m: any) => {
      switch (sortConfig.key) {
        case 'date':   return dayKey(m.date)
        case 'amount': return Number(m.amount)
        default:       return String(m[sortConfig.key] ?? '').toLowerCase()
      }
    }
    result = [...result].sort((a, b) => {
      const vA = valueOf(a), vB = valueOf(b)
      return vA < vB ? -dir : vA > vB ? dir : 0
    })
    return result
  }, [filterYear, filterTicker, filterType, movements, sortConfig])

  // Saldo acumulado sobre TODOS los movimientos y filtrado por año después,
  // así el año seleccionado arranca con el saldo que traías de años anteriores (antes arrancaba en 0)
  const chartData = useMemo(() => {
    const ordered = [...movements].sort((a, b) => {
      const dA = dayKey(a.date), dB = dayKey(b.date)
      return dA < dB ? -1 : dA > dB ? 1 : 0
    })
    let acc = 0
    const byDay = new Map<string, number>()
    for (const m of ordered) {
      acc += Number(m.amount)
      byDay.set(dayKey(m.date), r2(acc))   // un punto por día: el saldo al cierre de ese día
    }
    const rows = Array.from(byDay, ([date, saldo]) => ({ date, saldo }))
    return filterYear === 'all' ? rows : rows.filter(r => r.date.slice(0, 4) === filterYear)
  }, [movements, filterYear])

  // Al cambiar filtros u orden se vuelve a la primera página
  useEffect(() => { setShown(PAGE_SIZE) }, [filterYear, filterType, filterTicker, sortConfig])

  const visibleRows = useMemo(() => sortedAndFiltered.slice(0, shown), [sortedAndFiltered, shown])

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

  // ── Acciones ──────────────────────────────────────────────────────────────
  const handleDelete = async (m: any) => {
    const warn = m.movement_type === 'trade'
      ? 'Este movimiento pertenece a un trade: borrarlo NO modifica el trade ni sus ejecuciones y el saldo quedará desalineado.\n\n'
      : ''
    if (!window.confirm(`${warn}¿Eliminar este registro?`)) return
    const { error: dErr } = await supabase.from('wallet_movements').delete().eq('id', m.id)
    if (dErr) return alert('No se pudo eliminar el registro: ' + dErr.message)
    loadMovements()
  }

  const handleEditOpen = (m: any) => {
    setEditingMovement(m)
    setEditAmount(Math.abs(Number(m.amount)).toString())
    setEditNotes(m.notes || '')
    setEditDate(dayKey(m.date))
  }

  const handleUpdate = async () => {
    if (!editingMovement || saving) return
    if (!editAmount || !editDate) return alert('Monto y fecha son obligatorios')
    const raw = Math.abs(parseFloat(Number(editAmount).toFixed(2)))
    if (!raw || raw <= 0) return alert('El monto debe ser mayor a 0')
    const originalSign = Number(editingMovement.amount) < 0 ? -1 : 1
    const finalAmount  = parseFloat((originalSign * raw).toFixed(2))

    setSaving(true)
    try {
      const { error: uErr } = await supabase.from('wallet_movements')
        .update({ amount: finalAmount, notes: editNotes || null, date: editDate })
        .eq('id', editingMovement.id)
      if (uErr) throw uErr
      setEditingMovement(null)
      loadMovements()
    } catch (err) {
      alert('No se pudo guardar: ' + errMsg(err))
    } finally {
      setSaving(false)
    }
  }

  const pnlColor = pnlCerrados >= 0 ? '#22c55e' : '#f43f5e'

  return (
    <AppShell>
      <div style={{ maxWidth: 1200, margin: '0 auto', paddingTop: 20, paddingBottom: 40, color: 'white' }}>

        {/* ── HEADER ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, padding: '0 10px' }}>
          <div>
            {/* Rastro de huellas en el título */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <Paw size={18} color="#00bfff" opacity={0.5} />
              <Paw size={14} color="#00bfff" opacity={0.3} />
              <Paw size={10} color="#00bfff" opacity={0.15} />
              <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>
                Historial: <span style={{ color: '#00bfff' }}>{portfolioName}</span>
              </h1>
            </div>
            <p style={{ color: '#888', fontSize: 12, margin: '0 0 0 42px' }}>
              {movements.length} registros totales · paginación completa
            </p>
          </div>

          {/* Tres tarjetas de métricas */}
          <div style={{ display: 'flex', gap: 10 }}>
            {/* Saldo disponible */}
            <div style={{ ...statCard, borderColor: saldoDisponible >= 0 ? 'rgba(34,197,94,0.2)' : 'rgba(244,63,94,0.2)', position: 'relative', overflow: 'hidden' }}>
              <PawTrail color={saldoDisponible >= 0 ? '#22c55e' : '#f43f5e'} top={4} right={4} rotate={-20} />
              <div style={{ fontSize: 9, color: '#888', fontWeight: 800, letterSpacing: 0.5, marginBottom: 6 }}>SALDO DISPONIBLE</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: saldoDisponible >= 0 ? '#22c55e' : '#f43f5e' }}>
                {money(saldoDisponible)}
              </div>
              <div style={{ fontSize: 9, color: '#555', marginTop: 4 }}>depósitos + ventas + divid. − compras − retiros</div>
            </div>

            {/* Capital depositado */}
            <div style={{ ...statCard, borderColor: 'rgba(0,191,255,0.2)', position: 'relative', overflow: 'hidden' }}>
              <PawTrail color="#00bfff" top={4} right={4} rotate={10} />
              <div style={{ fontSize: 9, color: '#888', fontWeight: 800, letterSpacing: 0.5, marginBottom: 6 }}>CAPITAL DEPOSITADO</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: '#00bfff' }}>{money(capitalDepositado)}</div>
              <div style={{ fontSize: 9, color: '#555', marginTop: 4 }}>depósitos − retiros · de tu bolsillo</div>
            </div>

            {/* PnL de trades cerrados */}
            <div style={{ ...statCard, borderColor: `${pnlColor}33`, position: 'relative', overflow: 'hidden' }}>
              <PawTrail color={pnlColor} top={4} right={4} rotate={-10} />
              <div style={{ fontSize: 9, color: '#888', fontWeight: 800, letterSpacing: 0.5, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                {pnlCerrados >= 0
                  ? <TrendingUp size={11} color="#22c55e" />
                  : <TrendingDown size={11} color="#f43f5e" />
                }
                GANANCIAS / PÉRDIDAS
              </div>
              <div style={{ fontSize: 22, fontWeight: 900, color: pnlColor }}>{money(pnlCerrados)}</div>
              <div style={{ fontSize: 9, color: '#555', marginTop: 4 }}>PnL realizado · trades cerrados</div>
            </div>
          </div>
        </div>

        {error && (
          <div style={{ margin: '0 10px 16px', padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(244,63,94,0.3)', background: 'rgba(244,63,94,0.08)', color: '#f43f5e', fontSize: 12 }}>
            {error}
          </div>
        )}

        {/* ── GRÁFICA ── */}
        <div style={{ ...chartBox, margin: '0 10px 20px', position: 'relative', overflow: 'hidden' }}>
          {/* Huella grande decorativa de fondo */}
          <div style={{ position: 'absolute', bottom: -20, right: -20, opacity: 0.025 }}>
            <Paw size={160} color="#22c55e" />
          </div>
          <div style={{ fontSize: 10, color: '#888', marginBottom: 10, fontWeight: 700, letterSpacing: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Paw size={12} color="#22c55e" opacity={0.6} />
            SALDO DISPONIBLE ACUMULADO
            {filterYear !== 'all' ? ` · ${filterYear}` : ' · todos los años'}
            <span style={{ color: '#444', fontWeight: 400, fontSize: 9 }}>
              · todos los movimientos
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
              {/* En modo privado el eje no muestra montos */}
              <YAxis stroke="#333" fontSize={10}
                tickFormatter={v => visible ? `$${Number(v).toLocaleString()}` : ''} />
              <Tooltip
                contentStyle={{ background: '#000', border: '1px solid #222', fontSize: 12, borderRadius: 8 }}
                formatter={(v: any) => [money(Number(v)), 'Saldo']}
                labelFormatter={l => parseDate(l).toLocaleDateString('es-MX')}
              />
              <Area type="monotone" dataKey="saldo" stroke="#22c55e" strokeWidth={2} fillOpacity={1} fill="url(#colorSaldo)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* ── FILTROS ── */}
        <div style={{ ...filterBar, margin: '0 10px 16px' }}>
          <Paw size={12} color="#555" opacity={0.6} />
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
          <span style={{ fontSize: 10, color: '#888', alignSelf: 'center', marginLeft: 'auto' }}>
            {sortedAndFiltered.length} de {movements.length}
          </span>
        </div>

        {/* ── TABLA ── */}
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
              {loading && (
                <tr>
                  <td colSpan={6} style={{ padding: 40, textAlign: 'center', color: '#555' }}>Cargando movimientos...</td>
                </tr>
              )}
              {!loading && sortedAndFiltered.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: 40, textAlign: 'center', color: '#555' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                      <Paw size={28} color="#333" opacity={0.5} />
                      <span>No hay movimientos para este filtro</span>
                    </div>
                  </td>
                </tr>
              )}
              {visibleRows.map(m => {
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
                    <td style={{ ...tdStyle, color: '#aaa' }}>{m.ticker || '—'}</td>
                    <td style={{ ...tdStyle, color: '#888', fontSize: '0.82rem', maxWidth: 240 }}>
                      {m.notes
                        ? <span title={m.notes}>{m.notes.length > 50 ? m.notes.slice(0, 50) + '…' : m.notes}</span>
                        : '—'}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', gap: 12 }}>
                        <button onClick={() => handleEditOpen(m)} style={actionBtnStyle}
                          onMouseEnter={e => (e.currentTarget.style.color = '#eab308')}
                          onMouseLeave={e => (e.currentTarget.style.color = '#444')}>
                          <FaPencilAlt size={12} />
                        </button>
                        <button onClick={() => handleDelete(m)} style={actionBtnStyle}
                          onMouseEnter={e => (e.currentTarget.style.color = '#f43f5e')}
                          onMouseLeave={e => (e.currentTarget.style.color = '#444')}>
                          <FaTrash size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {sortedAndFiltered.length > shown && (
            <div style={{ padding: 12, textAlign: 'center', borderTop: '1px solid #1a1a1a' }}>
              <button onClick={() => setShown(s => s + PAGE_SIZE)} style={moreBtn}>
                Mostrar más ({Math.min(PAGE_SIZE, sortedAndFiltered.length - shown)} de {sortedAndFiltered.length - shown} restantes)
              </button>
            </div>
          )}
        </div>

        {/* ── MODAL EDITAR ── */}
        {editingMovement && (
          <div style={modalOverlay}>
            <div style={{ ...modalBox, position: 'relative', overflow: 'hidden' }}>
              {/* Huella decorativa en el modal */}
              <div style={{ position: 'absolute', bottom: -15, right: -15, opacity: 0.04 }}>
                <Paw size={100} color="#00bfff" />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                <Paw size={16} color="#00bfff" opacity={0.6} />
                <h3 style={{ margin: 0, fontSize: 15, color: 'white' }}>Editar movimiento</h3>
              </div>
              {editingMovement.movement_type === 'trade' && (
                <div style={{ marginBottom: 14, padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(234,179,8,0.3)', background: 'rgba(234,179,8,0.06)', color: '#eab308', fontSize: 11 }}>
                  Este movimiento pertenece a un trade: editarlo no actualiza el trade ni sus ejecuciones. Para corregir una operación usa la gestión del trade.
                </div>
              )}
              <label style={modalLabel}>Monto (USD) — valor absoluto</label>
              <input type="number" min="0" step="0.01" style={modalInput} value={editAmount}
                onChange={e => setEditAmount(posAmount(e.target.value))} placeholder="0.00" />
              <label style={modalLabel}>Fecha</label>
              <input type="date" style={modalInput} value={editDate} onChange={e => setEditDate(e.target.value)} />
              <label style={modalLabel}>Notas / Observación</label>
              <textarea style={{ ...modalInput, height: 80, resize: 'none' }} value={editNotes}
                onChange={e => setEditNotes(e.target.value)} />
              <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                <button onClick={handleUpdate} disabled={saving} style={{ ...confirmBtn, opacity: saving ? 0.6 : 1 }}>
                  {saving ? 'Guardando...' : 'Guardar cambios'}
                </button>
                <button onClick={() => setEditingMovement(null)} style={cancelBtn}>Cancelar</button>
              </div>
            </div>
          </div>
        )}

      </div>
    </AppShell>
  )
}

// ── Estilos ────────────────────────────────────────────────────────────────
const statCard: React.CSSProperties      = { background: '#0a0a0a', padding: '14px 18px', borderRadius: 12, border: '1px solid #1a1a1a', textAlign: 'right', color: 'white', minWidth: 180 }
const chartBox: React.CSSProperties      = { background: '#0a0a0a', padding: 25, borderRadius: 15, border: '1px solid #1a1a1a' }
const filterBar: React.CSSProperties     = { display: 'flex', alignItems: 'center', gap: 10, background: '#0a0a0a', padding: '10px 14px', borderRadius: 10, border: '1px solid #1a1a1a', flexWrap: 'wrap' }
const tableWrapper: React.CSSProperties  = { background: '#0a0a0a', borderRadius: 12, border: '1px solid #1a1a1a', overflow: 'hidden' }
const thStyle: React.CSSProperties       = { textAlign: 'left', padding: '12px 18px', color: '#888', fontSize: 9, fontWeight: 800, letterSpacing: 1, userSelect: 'none', whiteSpace: 'nowrap' }
const tdStyle: React.CSSProperties       = { padding: '11px 18px', fontSize: 12, color: '#ccc' }
const trStyle: React.CSSProperties       = { borderBottom: '1px solid #0f0f0f', transition: '0.2s' }
const selectStyle: React.CSSProperties   = { background: '#000', border: '1px solid #333', color: '#ccc', padding: '7px 10px', borderRadius: 6, fontSize: 11, outline: 'none' }
const inputMinimal: React.CSSProperties  = { background: '#000', border: '1px solid #333', padding: '7px 12px', borderRadius: 6, color: '#fff', fontSize: 11, outline: 'none' }
const actionBtnStyle: React.CSSProperties = { background: 'none', border: 'none', color: '#444', cursor: 'pointer', transition: 'color 0.2s', padding: 5, display: 'flex', alignItems: 'center' }
const moreBtn: React.CSSProperties       = { background: 'transparent', border: '1px solid #333', color: '#00bfff', padding: '8px 16px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer' }
const modalOverlay: React.CSSProperties  = { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.85)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }
const modalBox: React.CSSProperties      = { background: '#0a0a0a', padding: 28, borderRadius: 14, border: '1px solid #1a1a1a', width: 420 }
const modalLabel: React.CSSProperties    = { display: 'block', fontSize: 10, color: '#888', marginBottom: 5, fontWeight: 700, letterSpacing: 0.5 }
const modalInput: React.CSSProperties    = { width: '100%', background: '#000', border: '1px solid #333', padding: 11, borderRadius: 8, color: '#fff', marginBottom: 14, outline: 'none', boxSizing: 'border-box', fontSize: 13 }
const confirmBtn: React.CSSProperties    = { flex: 1, background: '#00bfff', color: '#000', border: 'none', padding: 12, borderRadius: 8, fontWeight: 'bold', cursor: 'pointer' }
const cancelBtn: React.CSSProperties     = { flex: 1, background: 'transparent', color: '#888', border: '1px solid #333', padding: 12, borderRadius: 8, cursor: 'pointer' }