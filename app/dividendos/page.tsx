'use client'

import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { usePrivacy } from '@/lib/PrivacyContext'
import { useIsMobile } from '@/lib/useIsMobile'
import AppShell from '../AppShell'
import { FaTrash, FaPencilAlt, FaSort, FaSortUp, FaSortDown, FaSearch, FaPlus } from 'react-icons/fa'
import { DollarSign } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Cell
} from 'recharts'

const dayKey = (d: any) => String(d || '').split('T')[0].split(' ')[0]
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const parseDate = (d: any) => new Date(dayKey(d) + 'T00:00:00')
const posAmount  = (v: string) => v.replace(/[^0-9.]/g, '').replace(/^(\d*\.?\d*).*$/, '$1')
const r2 = (n: number) => parseFloat(n.toFixed(2))
// Hoy en hora LOCAL. new Date().toISOString() es UTC: en México, después de las 6 pm daba la fecha de mañana
const todayLocal = () => new Date().toLocaleDateString('sv-SE')
const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.\-]{0,11}$/

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const MESES_CORTO = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']

const SORT_OPTIONS = [
  { key: 'date',   label: 'Fecha' },
  { key: 'ticker', label: 'Activo' },
  { key: 'amount', label: 'Monto' },
]

// Máximo 1000 filas por consulta en Supabase: se pide por páginas
const PAGE = 1000
async function fetchAll(make: () => any): Promise<any[]> {
  const rows: any[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await make().range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    if (!data?.length) break
    rows.push(...data)
    if (data.length < PAGE) break
  }
  return rows
}

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
  const { money } = usePrivacy()
  const isMobile = useIsMobile()

  const [movements,  setMovements]  = useState<any[]>([])
  const [trades,     setTrades]     = useState<any[]>([])
  const [portfolios, setPortfolios] = useState<any[]>([])
  const [user,       setUser]       = useState<any>(null)
  const [loadError,  setLoadError]  = useState('')

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
  const [editSaving,      setEditSaving]      = useState(false)

  // Modal agregar dividendo
  const [showAdd,       setShowAdd]       = useState(false)
  const [addPortfolio,  setAddPortfolio]  = useState('')
  const [addTicker,     setAddTicker]     = useState('')
  const [addAmount,     setAddAmount]     = useState('')
  const [addDate,       setAddDate]       = useState(todayLocal())
  const [addNotes,      setAddNotes]      = useState('')
  const [addSaving,     setAddSaving]     = useState(false)

  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const fetchData = useCallback(async () => {
    try {
      const { data: userData } = await supabase.auth.getUser()
      const u = userData.user
      if (!u) return
      if (alive.current) setUser(u)

      const [mData, pData, tData] = await Promise.all([
        // Mismo criterio de dividendo que el resto de la app (is_dividend o movement_type = 'dividend').
        fetchAll(() => supabase.from('wallet_movements')
          .select('id, wallet_id, ticker, amount, date, notes, is_dividend, movement_type')
          .eq('user_id', u.id)
          .or('is_dividend.eq.true,movement_type.eq.dividend')
          .order('date', { ascending: false })
          .order('id')),
        fetchAll(() => supabase.from('portfolios').select('id, name').eq('user_id', u.id).order('id')),
        fetchAll(() => supabase.from('trades').select('ticker, total_invested, portfolio_id')
          .eq('user_id', u.id).eq('status', 'open').order('id')),
      ])
      if (!alive.current) return
      setMovements(mData); setPortfolios(pData); setTrades(tData)
      setLoadError('')
    } catch (e: any) {
      if (alive.current) setLoadError(e?.message || 'No se pudieron cargar los datos')
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Billetera del modal: la elegida o, por defecto, la primera
  const effectiveAddPortfolio = addPortfolio || portfolios[0]?.id || ''

  // Tickers con posición abierta en la billetera del modal
  const portfolioTickers = useMemo(() => {
    const list = effectiveAddPortfolio ? trades.filter(t => t.portfolio_id === effectiveAddPortfolio) : trades
    return Array.from(new Set<string>(list.map(t => t.ticker))).sort()
  }, [effectiveAddPortfolio, trades])

  // Fechas ya convertidas una sola vez
  const rows = useMemo(() => movements.map(m => {
    const key = dayKey(m.date)
    return { ...m, key, year: key.slice(0, 4), month: String(Number(key.slice(5, 7))), amountNum: Number(m.amount) || 0 }
  }), [movements])

  const availableYears = useMemo(() => {
    const years = new Set<string>([new Date().getFullYear().toString()])
    rows.forEach(m => { if (/^\d{4}$/.test(m.year)) years.add(m.year) })
    return Array.from(years).sort((a, b) => b.localeCompare(a))
  }, [rows])

  const filtered = useMemo(() => {
    const q = filterTicker.toLowerCase()
    const result = rows.filter(m =>
      (selectedPortfolio === 'all' || m.wallet_id === selectedPortfolio) &&
      (selectedYear === 'all' || m.year === selectedYear) &&
      (selectedMonth === 'all' || m.month === selectedMonth) &&
      (!q || (m.ticker || '').toLowerCase().includes(q))
    )
    const dir = sortConfig.direction === 'asc' ? 1 : -1
    return result.sort((a, b) => {
      if (sortConfig.key === 'amount') return (a.amountNum - b.amountNum) * dir
      if (sortConfig.key === 'ticker') return String(a.ticker || '').localeCompare(String(b.ticker || '')) * dir
      return a.key.localeCompare(b.key) * dir // fecha
    })
  }, [rows, selectedPortfolio, selectedYear, selectedMonth, filterTicker, sortConfig])

  const totalPeriod = useMemo(() => r2(filtered.reduce((acc, m) => acc + m.amountNum, 0)), [filtered])

  // Top 9 tickers por total de dividendos — todos los movimientos, sin filtrar por período.
  const tickerSummary = useMemo(() => {
    const totals: Record<string, number> = {}
    rows.forEach(m => { if (m.ticker) totals[m.ticker] = (totals[m.ticker] || 0) + m.amountNum })
    const invested: Record<string, number> = {}
    trades.forEach(t => { invested[t.ticker] = (invested[t.ticker] || 0) + Number(t.total_invested || 0) })

    return Object.entries(totals)
      .map(([ticker, total]) => {
        const inv = invested[ticker] || 0
        return { ticker, total: r2(total), yoc: inv > 0 ? (total / inv) * 100 : null }
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, 9)
  }, [rows, trades])

  const dynamicChartData = useMemo(() => {
    const groups: Record<string, number> = {}
    const labels: Record<string, string> = {}
    filtered.forEach(m => {
      let key: string, label: string
      if (selectedMonth === 'all') {
        key = m.key.slice(0, 7) // 'YYYY-MM'
        label = `${MESES_CORTO[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}`
      } else {
        const week = Math.ceil(Number(m.key.slice(8, 10)) / 7)
        key = `Sem ${week}`
        label = key
      }
      groups[key] = (groups[key] || 0) + m.amountNum
      labels[key] = label
    })
    const sortedKeys = Object.keys(groups).sort()
    return sortedKeys.map((key, i) => {
      const current = groups[key]
      const prev    = i > 0 ? groups[sortedKeys[i - 1]] : 0
      const growth  = prev > 0 ? ((current - prev) / prev) * 100 : 0
      return { label: labels[key], monto: r2(current), growth }
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
    setEditDate(dayKey(m.date))
  }

  const handleUpdate = async () => {
    if (editSaving) return
    if (!editAmount || !DAY_RE.test(editDate)) return alert('Monto y fecha son obligatorios')
    const finalAmount = r2(Math.abs(Number(editAmount)))
    if (!(finalAmount > 0)) return alert('El monto debe ser mayor a 0')

    setEditSaving(true)
    const { error } = await supabase.from('wallet_movements')
      .update({ amount: finalAmount, notes: editNotes.trim() || null, date: editDate })
      .eq('id', editingMovement.id)
    if (alive.current) setEditSaving(false)
    if (!error) { setEditingMovement(null); fetchData() }
    else alert(error.message)
  }

  const handleAddDividend = async () => {
    if (addSaving) return
    const ticker = addTicker.toUpperCase().trim()
    if (!effectiveAddPortfolio || !ticker || !addAmount || !DAY_RE.test(addDate))
      return alert('Billetera, ticker, monto y fecha son obligatorios')
    if (!SYMBOL_RE.test(ticker)) return alert('Ticker inválido')
    const raw = r2(Math.abs(Number(addAmount)))
    if (!(raw > 0)) return alert('El monto debe ser mayor a 0')
    if (!user) return alert('Sesión no encontrada')

    setAddSaving(true)
    try {
      const { error } = await supabase.from('wallet_movements').insert({
        wallet_id:     effectiveAddPortfolio,
        user_id:       user.id,
        amount:        raw,
        movement_type: 'dividend',
        is_dividend:   true,
        ticker,
        notes:         addNotes.trim() || null,
        date:          addDate,
      })
      if (error) throw error
      setShowAdd(false)
      setAddTicker(''); setAddAmount(''); setAddNotes('')
      setAddDate(todayLocal())
      fetchData()
    } catch (err: any) {
      alert('Error: ' + (err?.message || err))
    } finally {
      if (alive.current) setAddSaving(false)
    }
  }

  const fmtDate = (key: string) => DAY_RE.test(key)
    ? parseDate(key).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—'

  const box: React.CSSProperties = isMobile ? modalBoxMobile : modalBox
  const selMobile: React.CSSProperties = { ...selectStyle, width: '100%', minWidth: 0, padding: '10px 10px', fontSize: 13 }

  return (
    <AppShell>
      <div style={{ padding: isMobile ? '0 2px' : '0 30px', color: 'white' }}>

        {/* HEADER */}
        {isMobile ? (
          <div style={{ margin: '8px 0 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <DollarSign size={20} color="#eab308" />
                <h1 style={{ fontSize: 18, fontWeight: 900, color: '#eab308', margin: 0 }}>Dividendos</h1>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: 9, color: '#888', fontWeight: 'bold', display: 'block' }}>Total período</span>
                <span style={{ fontSize: 20, fontWeight: 900, color: '#eab308' }}>{money(totalPeriod)}</span>
              </div>
            </div>
            <button onClick={() => setShowAdd(true)} style={{ ...addBtn, justifyContent: 'center', padding: '12px 14px', fontSize: 13 }}>
              <FaPlus size={11} /> Agregar dividendo
            </button>
          </div>
        ) : (
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
        )}

        {loadError && (
          <div style={{
            marginBottom: 14, padding: '10px 14px', borderRadius: 10, fontSize: 12,
            background: 'rgba(244,63,94,0.06)', border: '1px solid rgba(244,63,94,0.25)', color: '#f43f5e',
          }}>
            No se pudieron cargar los datos ({loadError}). Lo que ves puede estar incompleto; recarga la página.
          </div>
        )}

        {/* TABS PORTAFOLIOS */}
        <div style={walletNav}>
          {[{ id: 'all', name: 'Todos' }, ...portfolios].map(p => (
            <button key={p.id} onClick={() => setSelectedPortfolio(p.id)}
              style={{ ...walletTab(selectedPortfolio === p.id), ...(isMobile ? { padding: '8px 14px', fontSize: 12 } : {}) }}>
              {p.name}
            </button>
          ))}
        </div>

        {/* FILTROS */}
        <div style={isMobile
          ? { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, marginBottom: 12 }
          : { display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={selectedYear} onChange={e => setSelectedYear(e.target.value)} style={isMobile ? selMobile : selectStyle}>
            <option value="all">Todos los años</option>
            {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} style={isMobile ? selMobile : selectStyle}>
            <option value="all">{isMobile ? 'Todos los meses' : 'Todos los meses (vista mensual)'}</option>
            {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: 6, padding: isMobile ? '10px 10px' : '6px 10px', ...(isMobile ? { gridColumn: '1 / -1' } : {}) }}>
            <FaSearch style={{ color: '#888', fontSize: 10 }} />
            <input
              placeholder="Buscar ticker..."
              value={filterTicker}
              onChange={e => setFilterTicker(e.target.value.toUpperCase())}
              style={{ background: 'none', border: 'none', color: 'white', outline: 'none', fontSize: isMobile ? 14 : 11, width: isMobile ? '100%' : 120, minWidth: 0 }}
            />
          </div>
          {(filterTicker || selectedPortfolio !== 'all' || selectedMonth !== 'all') && (
            <span style={{ fontSize: 10, color: '#888', ...(isMobile ? { gridColumn: '1 / -1' } : {}) }}>{filtered.length} resultado(s)</span>
          )}
        </div>

        {/* GRÁFICA */}
        <div style={{ ...chartContainer, ...(isMobile ? { padding: '12px 4px 4px', marginBottom: 14 } : {}) }}>
          <div style={{ fontSize: 9, color: '#888', fontWeight: 800, letterSpacing: 1, marginBottom: 8, paddingLeft: isMobile ? 8 : 0, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Paw size={10} color="#888" opacity={0.6} />
            {selectedMonth === 'all' ? 'Vista mensual' : `Vista semanal · ${MESES[Number(selectedMonth) - 1]}`}
          </div>
          <ResponsiveContainer width="100%" height={isMobile ? 130 : 140}>
            <BarChart data={dynamicChartData}>
              <CartesianGrid stroke="#1a1a1a" vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#888' }} interval={isMobile ? 'preserveStartEnd' : 0} />
              <YAxis hide />
              <Tooltip
                contentStyle={{ background: '#000', border: '1px solid #333', borderRadius: 8 }}
                formatter={(v: any) => [money(Number(v) || 0), 'Dividendo']}
                labelStyle={{ color: '#888', fontSize: 10 }}
              />
              <Bar dataKey="monto" radius={[4, 4, 0, 0]}>
                {dynamicChartData.map((entry, i) => (
                  <Cell key={i} fill={entry.growth >= 0 ? '#eab308' : '#856404'} />
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
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(3, minmax(0, 1fr))' : 'repeat(9, 1fr)', gap: 8 }}>
              {tickerSummary.map((item, idx) => (
                <div key={item.ticker} style={{
                  background: '#0a0a0a',
                  border: `1px solid ${idx === 0 ? 'rgba(234,179,8,0.4)' : 'rgba(234,179,8,0.12)'}`,
                  borderRadius: 10, padding: isMobile ? '8px 8px' : '10px 12px',
                  position: 'relative', overflow: 'hidden', minWidth: 0,
                }}>
                  {/* Huella decorativa de fondo */}
                  <div style={{ position: 'absolute', bottom: -6, right: -6 }}>
                    <Paw size={36} color="#eab308" opacity={0.03} />
                  </div>
                  {idx === 0 && (
                    <div style={{ fontSize: 8, color: '#eab308', fontWeight: 800, letterSpacing: 0.5, marginBottom: 4 }}>TOP 1</div>
                  )}
                  <div style={{ fontWeight: 800, color: '#eab308', fontSize: 13, marginBottom: 4 }}>{item.ticker}</div>
                  <div style={{ fontSize: isMobile ? 12 : 13, fontWeight: 700, color: '#fff' }}>{money(item.total)}</div>
                  {item.yoc !== null && (
                    <div style={{ fontSize: 9, color: '#888', marginTop: 4 }} title="Total cobrado entre lo invertido hoy en este ticker">
                      Acum. s/costo <span style={{ color: item.yoc >= 3 ? '#22c55e' : '#aaa', fontWeight: 700 }}>{item.yoc.toFixed(2)}%</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {isMobile ? (
          <>
            {/* ORDENAR */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <select
                value={sortConfig.key}
                onChange={e => setSortConfig(prev => ({ ...prev, key: e.target.value }))}
                aria-label="Ordenar por"
                style={{ ...selMobile, flex: 1 }}>
                {SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>Ordenar: {o.label}</option>)}
              </select>
              <button
                onClick={() => setSortConfig(prev => ({ ...prev, direction: prev.direction === 'asc' ? 'desc' : 'asc' }))}
                style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #1a1a1a', background: '#0a0a0a', color: '#eab308', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                {sortConfig.direction === 'asc' ? '↑ Asc' : '↓ Desc'}
              </button>
            </div>

            {/* TARJETAS */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
              {filtered.length === 0 && (
                <div style={{ padding: 36, textAlign: 'center', color: '#888', background: '#0a0a0a', borderRadius: 12, border: '1px solid #1a1a1a' }}>
                  No hay dividendos para el período seleccionado.
                </div>
              )}
              {filtered.map(m => (
                <div key={m.id} style={{ background: '#080808', border: '1px solid #1a1a1a', borderRadius: 12, padding: '10px 12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: '#eab308', fontWeight: 900, fontSize: 16 }}>{m.ticker || '—'}</div>
                      <div style={{ fontSize: 11, color: '#777', marginTop: 2 }}>{fmtDate(m.key)}</div>
                    </div>
                    <div style={{ color: '#eab308', fontWeight: 900, fontSize: 18, fontFamily: 'monospace' }}>{money(m.amountNum)}</div>
                  </div>
                  {m.notes && <div style={{ fontSize: 12, color: '#aaa', marginTop: 6, wordBreak: 'break-word' }}>{m.notes}</div>}
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, paddingTop: 8, borderTop: '1px solid #151515' }}>
                    <button onClick={() => handleEditOpen(m)} aria-label="Editar"
                      style={{ flex: 1, padding: '10px 12px', borderRadius: 8, border: '1px solid #2a2410', background: 'rgba(234,179,8,0.06)', color: '#eab308', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                      <FaPencilAlt size={12} /> Editar
                    </button>
                    <button onClick={() => handleDelete(m.id)} aria-label="Eliminar"
                      style={{ ...actionBtn, padding: 12, border: '1px solid #1a1a1a', borderRadius: 8, color: '#777' }}>
                      <FaTrash size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          /* TABLA */
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
                    <td style={tdStyle}>{fmtDate(m.key)}</td>
                    <td style={{ ...tdStyle, color: '#eab308', fontWeight: 'bold' }}>{m.ticker || '—'}</td>
                    <td style={{ ...tdStyle, color: '#eab308', fontWeight: 'bold', fontFamily: 'monospace' }}>
                      {money(m.amountNum)}
                    </td>
                    <td style={{ ...tdStyle, color: '#aaa', fontSize: 11 }}>{m.notes || '—'}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', gap: 12 }}>
                        <button onClick={() => handleEditOpen(m)} title="Editar" aria-label="Editar" style={actionBtn}
                          onMouseEnter={e => (e.currentTarget.style.color = '#eab308')}
                          onMouseLeave={e => (e.currentTarget.style.color = '#555')}>
                          <FaPencilAlt size={12} />
                        </button>
                        <button onClick={() => handleDelete(m.id)} title="Eliminar" aria-label="Eliminar" style={actionBtn}
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
        )}

        {/* ════ MODAL AGREGAR DIVIDENDO ════ */}
        {showAdd && (
          <div style={modalOverlay}>
            <div style={box}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                <Paw size={16} color="#eab308" opacity={0.7} />
                <h3 style={{ margin: 0, fontSize: 16 }}>Registrar dividendo</h3>
              </div>

              <label style={modalLabel}>Billetera</label>
              <select value={effectiveAddPortfolio} onChange={e => { setAddPortfolio(e.target.value); setAddTicker('') }} style={modalInput}>
                {portfolios.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>

              <label style={modalLabel}>Ticker</label>
              <div style={{ display: 'flex', gap: 6, marginBottom: 15 }}>
                <select value={portfolioTickers.includes(addTicker) ? addTicker : ''} onChange={e => setAddTicker(e.target.value)}
                  style={{ ...modalInput, marginBottom: 0, flex: 1, minWidth: 0 }}>
                  <option value="">Selecciona...</option>
                  {portfolioTickers.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <input
                  placeholder="O escribe"
                  value={addTicker}
                  onChange={e => setAddTicker(e.target.value.toUpperCase())}
                  style={{ ...modalInput, marginBottom: 0, flex: 1, minWidth: 0 }}
                />
              </div>

              <label style={modalLabel}>Monto (USD)</label>
              <input
                type="text" inputMode="decimal"
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
                <button onClick={() => setShowAdd(false)} disabled={addSaving} style={cancelBtn}>Cancelar</button>
              </div>
            </div>
          </div>
        )}

        {/* ════ MODAL EDITAR ════ */}
        {editingMovement && (
          <div style={modalOverlay}>
            <div style={box}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                <Paw size={16} color="#eab308" opacity={0.6} />
                <h3 style={{ margin: 0, fontSize: 16 }}>Editar dividendo</h3>
              </div>
              <label style={modalLabel}>Monto (USD)</label>
              <input type="text" inputMode="decimal" style={modalInput} value={editAmount}
                onChange={e => setEditAmount(posAmount(e.target.value))} placeholder="0.00" />
              <label style={modalLabel}>Fecha</label>
              <input type="date" style={modalInput} value={editDate} onChange={e => setEditDate(e.target.value)} />
              <label style={modalLabel}>Notas / Observación</label>
              <textarea style={{ ...modalInput, height: 80, resize: 'none' }} value={editNotes}
                onChange={e => setEditNotes(e.target.value)} />
              <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                <button onClick={handleUpdate} disabled={editSaving} style={confirmBtn}>
                  {editSaving ? 'Guardando...' : 'Guardar cambios'}
                </button>
                <button onClick={() => setEditingMovement(null)} disabled={editSaving} style={cancelBtn}>Cancelar</button>
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
  border: 'none', padding: '5px 15px', borderRadius: 4, fontSize: 11, fontWeight: 'bold', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
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
// En el celular el modal usa casi todo el ancho y se desplaza por dentro si no cabe
const modalBoxMobile: React.CSSProperties  = { background: '#0a0a0a', padding: 18, borderRadius: 14, border: '1px solid #1a1a1a', width: '94%', maxWidth: 420, maxHeight: '92dvh', overflowY: 'auto', boxSizing: 'border-box' }
const modalLabel: React.CSSProperties      = { display: 'block', fontSize: 10, color: '#888', marginBottom: 5, fontWeight: 'bold', letterSpacing: 0.5 }
const modalInput: React.CSSProperties      = { width: '100%', background: '#000', border: '1px solid #333', padding: 11, borderRadius: 8, color: '#fff', marginBottom: 14, outline: 'none', boxSizing: 'border-box', fontSize: 13 }
const confirmBtn: React.CSSProperties      = { flex: 1, background: '#eab308', color: '#000', border: 'none', padding: 12, borderRadius: 8, fontWeight: 'bold', cursor: 'pointer' }
const cancelBtn: React.CSSProperties       = { flex: 1, background: 'transparent', color: '#888', border: '1px solid #333', padding: 12, borderRadius: 8, cursor: 'pointer' }