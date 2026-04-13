'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { usePrivacy } from '@/lib/PrivacyContext'
import AppShell from '../AppShell'
import { FaTrash, FaPencilAlt, FaSort, FaSortUp, FaSortDown, FaSearch, FaPlus } from 'react-icons/fa'
import { DollarSign } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Cell
} from 'recharts'

const parseDate = (d: string) => new Date((d || '').split('T')[0] + 'T00:00:00')
const posAmount  = (v: string) => v.replace(/[^0-9.]/g, '').replace(/^(\d*\.?\d*).*$/, '$1')

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

const Paw = ({ size = 14, color = '#666', opacity = 1 }: any) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ opacity, flexShrink: 0 }}>
    <ellipse cx="6"  cy="5"  rx="2.5" ry="3"/>
    <ellipse cx="11" cy="3"  rx="2.5" ry="3"/>
    <ellipse cx="16" cy="4"  rx="2.5" ry="3"/>
    <ellipse cx="19" cy="9"  rx="2"   ry="2.5"/>
    <path d="M12 22c-5 0-8-3-8-7 0-2.5 1.5-4.5 4-5.5 1-.4 2-.6 4-.6s3 .2 4 .6c2.5 1 4 3 4 5.5 0 4-3 7-8 7z"/>
  </svg>
)

export default function DividendosPage() {
  const { money, visible } = usePrivacy()

  const [movements,  setMovements]  = useState<any[]>([])
  const [trades,     setTrades]     = useState<any[]>([])
  const [portfolios, setPortfolios] = useState<any[]>([])
  const [user,       setUser]       = useState<any>(null)

  const [selectedPortfolio, setSelectedPortfolio] = useState('all')
  const [selectedYear,      setSelectedYear]      = useState(new Date().getFullYear().toString())
  const [selectedMonth,     setSelectedMonth]     = useState('all')
  const [filterTicker,      setFilterTicker]      = useState('')
  const [sortConfig,        setSortConfig]        = useState<{ key: string, direction: 'asc' | 'desc' }>({ key: 'date', direction: 'desc' })

  // Modal editar
  const [editingMovement, setEditingMovement] = useState<any>(null)
  const [editAmount,      setEditAmount]      = useState('')
  const [editNotes,       setEditNotes]       = useState('')
  const [editDate,        setEditDate]        = useState('')

  // Modal agregar dividendo
  const [showAdd,       setShowAdd]       = useState(false)
  const [addPortfolio,  setAddPortfolio]  = useState('')
  const [addTicker,     setAddTicker]     = useState('')
  const [addAmount,     setAddAmount]     = useState('')
  const [addDate,       setAddDate]       = useState(new Date().toISOString().split('T')[0])
  const [addNotes,      setAddNotes]      = useState('')
  const [addSaving,     setAddSaving]     = useState(false)
  const [openTickers,   setOpenTickers]   = useState<string[]>([])

  const fetchData = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser()
    if (userData.user) setUser(userData.user)

    const [{ data: mData }, { data: pData }, { data: tData }] = await Promise.all([
      supabase.from('wallet_movements').select('*, portfolios:wallet_id(name)').eq('is_dividend', true).order('date', { ascending: false }),
      supabase.from('portfolios').select('*'),
      supabase.from('trades').select('ticker, total_invested, portfolio_id').eq('status', 'open'),
    ])
    if (mData) setMovements(mData)
    if (pData) setPortfolios(pData)
    if (tData) {
      setTrades(tData)
      setOpenTickers(Array.from(new Set(tData.map((t: any) => t.ticker))).sort() as string[])
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Auto-seleccionar primer portafolio al abrir modal
  useEffect(() => {
    if (showAdd && portfolios.length > 0 && !addPortfolio) {
      setAddPortfolio(portfolios[0].id)
    }
  }, [showAdd, portfolios])

  // Tickers del portafolio seleccionado
  const portfolioTickers = useMemo(() => {
    if (!addPortfolio) return openTickers
    return Array.from(new Set(
      trades.filter(t => t.portfolio_id === addPortfolio).map(t => t.ticker)
    )).sort() as string[]
  }, [addPortfolio, trades, openTickers])

  const availableYears = useMemo(() => {
    const years = new Set(movements.map(m => parseDate(m.date).getFullYear()))
    years.add(new Date().getFullYear())
    return Array.from(years).sort((a, b) => b - a)
  }, [movements])

  const filtered = useMemo(() => {
    let result = movements.filter(m => {
      const d = parseDate(m.date)
      const matchPortfolio = selectedPortfolio === 'all' || m.wallet_id === selectedPortfolio
      const matchYear      = selectedYear === 'all' || d.getFullYear().toString() === selectedYear
      const matchMonth     = selectedMonth === 'all' || (d.getMonth() + 1).toString() === selectedMonth
      const matchTicker    = !filterTicker || (m.ticker || '').toLowerCase().includes(filterTicker.toLowerCase())
      return matchPortfolio && matchYear && matchMonth && matchTicker
    })
    return result.sort((a, b) => {
      let v1 = a[sortConfig.key], v2 = b[sortConfig.key]
      if (sortConfig.key === 'date')   { v1 = parseDate(a.date).getTime(); v2 = parseDate(b.date).getTime() }
      if (sortConfig.key === 'amount') { v1 = Number(v1); v2 = Number(v2) }
      if (v1 < v2) return sortConfig.direction === 'asc' ? -1 : 1
      if (v1 > v2) return sortConfig.direction === 'asc' ? 1 : -1
      return 0
    })
  }, [movements, selectedPortfolio, selectedYear, selectedMonth, filterTicker, sortConfig])

  const totalPeriod = useMemo(() => filtered.reduce((acc, m) => acc + Number(m.amount), 0), [filtered])

  // Top 9 tickers por total de dividendos — todos los movimientos, sin filtrar por período
  const tickerSummary = useMemo(() => {
    const map: Record<string, number> = {}
    movements.forEach(m => {
      if (!m.ticker) return
      map[m.ticker] = (map[m.ticker] || 0) + Number(m.amount)
    })
    return Object.entries(map)
      .map(([ticker, total]) => {
        const trade    = trades.find(t => t.ticker === ticker)
        const invested = trade ? Number(trade.total_invested || 0) : 0
        const yoc      = invested > 0 ? (total / invested) * 100 : null
        return { ticker, total: parseFloat(total.toFixed(2)), yoc }
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, 9)
  }, [movements, trades])

  const dynamicChartData = useMemo(() => {
    const groups: Record<string, number> = {}
    filtered.forEach(m => {
      const d   = parseDate(m.date)
      const key = selectedMonth === 'all'
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        : `Sem ${Math.ceil(d.getDate() / 7)}`
      groups[key] = (groups[key] || 0) + Number(m.amount)
    })
    const sortedKeys = Object.keys(groups).sort()
    return sortedKeys.map((key, i) => {
      const current = groups[key]
      const prev    = i > 0 ? groups[sortedKeys[i - 1]] : 0
      const growth  = prev > 0 ? ((current - prev) / prev) * 100 : 0
      return { label: key, monto: parseFloat(current.toFixed(2)), growth: growth.toFixed(1) }
    })
  }, [filtered, selectedMonth])

  const handleSort = (key: string) => {
    setSortConfig(prev =>
      prev.key === key
        ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' }
    )
  }

  const renderSortIcon = (key: string) => {
    if (sortConfig.key !== key) return <FaSort style={{ marginLeft: 4, opacity: 0.3 }} />
    return sortConfig.direction === 'asc'
      ? <FaSortUp   style={{ marginLeft: 4, color: '#eab308' }} />
      : <FaSortDown style={{ marginLeft: 4, color: '#eab308' }} />
  }

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este dividendo?')) return
    const { error } = await supabase.from('wallet_movements').delete().eq('id', id)
    if (!error) fetchData()
    else alert(error.message)
  }

  const handleEditOpen = (m: any) => {
    setEditingMovement(m)
    setEditAmount(Math.abs(Number(m.amount)).toString())
    setEditNotes(m.notes || '')
    setEditDate(m.date)
  }

  const handleUpdate = async () => {
    if (!editAmount || !editDate) return alert('Monto y fecha son obligatorios')
    const finalAmount = parseFloat(Math.abs(Number(editAmount)).toFixed(2))
    if (finalAmount <= 0) return alert('El monto debe ser mayor a 0')
    const { error } = await supabase.from('wallet_movements')
      .update({ amount: finalAmount, notes: editNotes, date: editDate })
      .eq('id', editingMovement.id)
    if (!error) { setEditingMovement(null); fetchData() }
    else alert(error.message)
  }

  const handleAddDividend = async () => {
    if (!addPortfolio || !addTicker || !addAmount || !addDate)
      return alert('Billetera, ticker, monto y fecha son obligatorios')
    const raw = Math.abs(parseFloat(Number(addAmount).toFixed(2)))
    if (!raw || raw <= 0) return alert('El monto debe ser mayor a 0')
    if (!user) return alert('Sesión no encontrada')

    setAddSaving(true)
    try {
      const { error } = await supabase.from('wallet_movements').insert({
        wallet_id:     addPortfolio,
        user_id:       user.id,
        amount:        raw,
        movement_type: 'dividend',
        is_dividend:   true,
        ticker:        addTicker.toUpperCase(),
        notes:         addNotes || null,
        date:          addDate,
      })
      if (error) throw error
      setShowAdd(false)
      setAddTicker(''); setAddAmount(''); setAddNotes('')
      setAddDate(new Date().toISOString().split('T')[0])
      fetchData()
    } catch (err: any) {
      alert('Error: ' + (err?.message || err))
    } finally {
      setAddSaving(false)
    }
  }

  return (
    <AppShell>
      <div style={{ padding: '0 30px', color: 'white' }}>

        {/* HEADER */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '20px 0 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <DollarSign size={22} color="#eab308" />
            <h1 style={{ fontSize: 20, fontWeight: 900, color: '#eab308', margin: 0 }}>Flujo de dividendos</h1>
            <Paw size={14} color="#eab308" opacity={0.5} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ textAlign: 'right' }}>
              <span style={{ fontSize: 9, color: '#888', fontWeight: 'bold', display: 'block', marginBottom: 4 }}>Total período</span>
              <span style={{ fontSize: 22, fontWeight: 900, color: '#eab308' }}>{money(totalPeriod)}</span>
            </div>
            <button onClick={() => setShowAdd(true)} style={addBtn}>
              <FaPlus size={11} /> Agregar dividendo
            </button>
          </div>
        </div>

        {/* TABS PORTAFOLIOS */}
        <div style={walletNav}>
          {[{ id: 'all', name: 'Todos' }, ...portfolios].map(p => (
            <button key={p.id} onClick={() => setSelectedPortfolio(p.id)} style={walletTab(selectedPortfolio === p.id)}>
              {p.name}
            </button>
          ))}
        </div>

        {/* FILTROS */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={selectedYear} onChange={e => setSelectedYear(e.target.value)} style={selectStyle}>
            <option value="all">Todos los años</option>
            {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} style={selectStyle}>
            <option value="all">Todos los meses (vista mensual)</option>
            {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: 6, padding: '6px 10px' }}>
            <FaSearch style={{ color: '#888', fontSize: 10 }} />
            <input
              placeholder="Buscar ticker..."
              value={filterTicker}
              onChange={e => setFilterTicker(e.target.value.toUpperCase())}
              style={{ background: 'none', border: 'none', color: 'white', outline: 'none', fontSize: 11, width: 120 }}
            />
          </div>
          {(filterTicker || selectedPortfolio !== 'all' || selectedMonth !== 'all') && (
            <span style={{ fontSize: 10, color: '#888' }}>{filtered.length} resultado(s)</span>
          )}
        </div>

        {/* GRÁFICA */}
        <div style={chartContainer}>
          <div style={{ fontSize: 9, color: '#888', fontWeight: 800, letterSpacing: 1, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Paw size={10} color="#888" opacity={0.6} />
            {selectedMonth === 'all' ? 'Vista mensual' : `Vista semanal · ${MESES[Number(selectedMonth) - 1]}`}
          </div>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={dynamicChartData}>
              <CartesianGrid stroke="#1a1a1a" vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#888' }} />
              <YAxis hide />
              <Tooltip
                contentStyle={{ background: '#000', border: '1px solid #333', borderRadius: 8 }}
                formatter={(v: any) => [visible ? `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '$***', 'Dividendo']}
                labelStyle={{ color: '#888', fontSize: 10 }}
              />
              <Bar dataKey="monto" radius={[4, 4, 0, 0]}>
                {dynamicChartData.map((entry, i) => (
                  <Cell key={i} fill={Number(entry.growth) >= 0 ? '#eab308' : '#856404'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* TOP 9 TICKERS */}
        {tickerSummary.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 9, color: '#888', fontWeight: 800, letterSpacing: 1, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Paw size={10} color="#eab308" opacity={0.6} />
              TOP 9 PAGADORES DE DIVIDENDOS · HISTÓRICO TOTAL
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', gap: 8 }}>
              {tickerSummary.map((item, idx) => (
                <div key={item.ticker} style={{
                  background: '#0a0a0a',
                  border: `1px solid ${idx === 0 ? 'rgba(234,179,8,0.4)' : 'rgba(234,179,8,0.12)'}`,
                  borderRadius: 10, padding: '10px 12px',
                  position: 'relative', overflow: 'hidden',
                }}>
                  {/* Huella decorativa de fondo */}
                  <div style={{ position: 'absolute', bottom: -6, right: -6 }}>
                    <Paw size={36} color="#eab308" opacity={0.03} />
                  </div>
                  {/* Número de ranking */}
                  {idx === 0 && (
                    <div style={{ fontSize: 8, color: '#eab308', fontWeight: 800, letterSpacing: 0.5, marginBottom: 4 }}>TOP 1</div>
                  )}
                  <div style={{ fontWeight: 800, color: '#eab308', fontSize: 13, marginBottom: 4 }}>{item.ticker}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{money(item.total)}</div>
                  {item.yoc !== null && (
                    <div style={{ fontSize: 9, color: '#888', marginTop: 4 }}>
                      YOC <span style={{ color: item.yoc >= 3 ? '#22c55e' : '#aaa', fontWeight: 700 }}>{item.yoc.toFixed(2)}%</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TABLA */}
        <div style={tableWrapper}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#0a0a0a' }}>
                {[
                  { key: 'date',   label: 'Fecha' },
                  { key: 'ticker', label: 'Activo' },
                  { key: 'amount', label: 'Monto' },
                ].map(col => (
                  <th key={col.key} style={{ ...thStyle, cursor: 'pointer' }} onClick={() => handleSort(col.key)}>
                    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                      {col.label} {renderSortIcon(col.key)}
                    </span>
                  </th>
                ))}
                <th style={thStyle}>Notas</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: 40, textAlign: 'center', color: '#888' }}>
                    No hay dividendos para el período seleccionado.
                  </td>
                </tr>
              )}
              {filtered.map(m => (
                <tr key={m.id} style={trStyle}>
                  <td style={tdStyle}>
                    {parseDate(m.date).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </td>
                  <td style={{ ...tdStyle, color: '#eab308', fontWeight: 'bold' }}>{m.ticker || '—'}</td>
                  <td style={{ ...tdStyle, color: '#eab308', fontWeight: 'bold', fontFamily: 'monospace' }}>
                    {money(Number(m.amount))}
                  </td>
                  <td style={{ ...tdStyle, color: '#aaa', fontSize: 11 }}>{m.notes || '—'}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    <div style={{ display: 'inline-flex', gap: 12 }}>
                      <button onClick={() => handleEditOpen(m)} title="Editar" style={actionBtn}
                        onMouseEnter={e => (e.currentTarget.style.color = '#eab308')}
                        onMouseLeave={e => (e.currentTarget.style.color = '#555')}>
                        <FaPencilAlt size={12} />
                      </button>
                      <button onClick={() => handleDelete(m.id)} title="Eliminar" style={actionBtn}
                        onMouseEnter={e => (e.currentTarget.style.color = '#f43f5e')}
                        onMouseLeave={e => (e.currentTarget.style.color = '#555')}>
                        <FaTrash size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ════ MODAL AGREGAR DIVIDENDO ════ */}
        {showAdd && (
          <div style={modalOverlay}>
            <div style={modalBox}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                <Paw size={16} color="#eab308" opacity={0.7} />
                <h3 style={{ margin: 0, fontSize: 16 }}>Registrar dividendo</h3>
              </div>

              <label style={modalLabel}>Billetera</label>
              <select value={addPortfolio} onChange={e => { setAddPortfolio(e.target.value); setAddTicker('') }} style={modalInput}>
                {portfolios.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>

              <label style={modalLabel}>Ticker</label>
              <div style={{ display: 'flex', gap: 6, marginBottom: 15 }}>
                <select value={addTicker} onChange={e => setAddTicker(e.target.value)}
                  style={{ ...modalInput, marginBottom: 0, flex: 1 }}>
                  <option value="">Selecciona...</option>
                  {portfolioTickers.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <input
                  placeholder="O escribe"
                  value={addTicker}
                  onChange={e => setAddTicker(e.target.value.toUpperCase())}
                  style={{ ...modalInput, marginBottom: 0, flex: 1 }}
                />
              </div>

              <label style={modalLabel}>Monto (USD)</label>
              <input
                type="number" min="0" step="0.01"
                placeholder="0.00" value={addAmount}
                onChange={e => setAddAmount(posAmount(e.target.value))}
                style={modalInput}
              />

              <label style={modalLabel}>Fecha</label>
              <input type="date" value={addDate} onChange={e => setAddDate(e.target.value)} style={modalInput} />

              <label style={modalLabel}>Notas (opcional)</label>
              <input placeholder="Observaciones..." value={addNotes} onChange={e => setAddNotes(e.target.value)} style={modalInput} />

              <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                <button onClick={handleAddDividend} disabled={addSaving} style={confirmBtn}>
                  {addSaving ? 'Guardando...' : 'Registrar dividendo'}
                </button>
                <button onClick={() => setShowAdd(false)} style={cancelBtn}>Cancelar</button>
              </div>
            </div>
          </div>
        )}

        {/* ════ MODAL EDITAR ════ */}
        {editingMovement && (
          <div style={modalOverlay}>
            <div style={modalBox}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                <Paw size={16} color="#eab308" opacity={0.6} />
                <h3 style={{ margin: 0, fontSize: 16 }}>Editar dividendo</h3>
              </div>
              <label style={modalLabel}>Monto (USD)</label>
              <input type="number" min="0" step="0.01" style={modalInput} value={editAmount}
                onChange={e => setEditAmount(posAmount(e.target.value))} placeholder="0.00" />
              <label style={modalLabel}>Fecha</label>
              <input type="date" style={modalInput} value={editDate} onChange={e => setEditDate(e.target.value)} />
              <label style={modalLabel}>Notas / Observación</label>
              <textarea style={{ ...modalInput, height: 80, resize: 'none' }} value={editNotes}
                onChange={e => setEditNotes(e.target.value)} />
              <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
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

const walletNav: React.CSSProperties = { display: 'flex', gap: 8, marginBottom: 14, borderBottom: '1px solid #222', paddingBottom: 10, marginTop: 10, overflowX: 'auto' }
const walletTab = (active: boolean): React.CSSProperties => ({
  background: active ? '#eab308' : 'transparent', color: active ? '#000' : '#888',
  border: 'none', padding: '5px 15px', borderRadius: 4, fontSize: 11, fontWeight: 'bold', cursor: 'pointer', whiteSpace: 'nowrap',
})
const selectStyle: React.CSSProperties     = { background: '#0a0a0a', color: 'white', border: '1px solid #1a1a1a', padding: '6px 10px', borderRadius: 6, fontSize: 11, outline: 'none' }
const chartContainer: React.CSSProperties  = { background: '#050505', padding: '16px 10px 8px', marginBottom: 20, border: '1px solid #111', borderRadius: 12 }
const tableWrapper: React.CSSProperties    = { background: '#050505', borderRadius: 12, border: '1px solid #111', overflow: 'hidden', marginBottom: 30 }
const thStyle: React.CSSProperties         = { textAlign: 'left', padding: '12px 15px', color: '#888', fontSize: 9, fontWeight: 800, userSelect: 'none', whiteSpace: 'nowrap' }
const tdStyle: React.CSSProperties         = { padding: '10px 15px', fontSize: 12, color: '#ccc', borderBottom: '1px solid #0f0f0f' }
const trStyle: React.CSSProperties         = { transition: '0.2s' }
const actionBtn: React.CSSProperties       = { background: 'none', border: 'none', color: '#555', cursor: 'pointer', transition: 'color 0.2s', padding: 5, display: 'flex', alignItems: 'center' }
const addBtn: React.CSSProperties          = { background: '#1a1200', border: '1px solid #eab308', color: '#eab308', padding: '7px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }
const modalOverlay: React.CSSProperties    = { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }
const modalBox: React.CSSProperties        = { background: '#0a0a0a', padding: 28, borderRadius: 14, border: '1px solid #1a1a1a', width: 420 }
const modalLabel: React.CSSProperties      = { display: 'block', fontSize: 10, color: '#888', marginBottom: 5, fontWeight: 'bold', letterSpacing: 0.5 }
const modalInput: React.CSSProperties      = { width: '100%', background: '#000', border: '1px solid #333', padding: 11, borderRadius: 8, color: '#fff', marginBottom: 14, outline: 'none', boxSizing: 'border-box', fontSize: 13 }
const confirmBtn: React.CSSProperties      = { flex: 1, background: '#eab308', color: '#000', border: 'none', padding: 12, borderRadius: 8, fontWeight: 'bold', cursor: 'pointer' }
const cancelBtn: React.CSSProperties       = { flex: 1, background: 'transparent', color: '#888', border: '1px solid #333', padding: 12, borderRadius: 8, cursor: 'pointer' }