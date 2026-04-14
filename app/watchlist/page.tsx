'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { usePrivacy } from '@/lib/PrivacyContext'
import AppShell from '../AppShell'
import { FaBell, FaRegStickyNote, FaPlus, FaTrash, FaSpinner, FaSort, FaSortUp, FaSortDown, FaSearch, FaSync } from 'react-icons/fa'

const TD_API_KEY = process.env.NEXT_PUBLIC_TWELVEDATA_API_KEY || ''

const isMarketOpen = () => {
  const now = new Date(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chihuahua',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
    hour12: false
  }).format(new Date()));

  const day  = now.getDay();
  const hour = now.getHours();
  const mins = now.getMinutes();
  const time = hour + mins / 60;

  return day >= 1 && day <= 5 && time >= 7.5 && time < 15;
}

const isStale = (lastUpdated: string | null, minutes = 3) => {
  if (!lastUpdated) return true
  return (Date.now() - new Date(lastUpdated).getTime()) / 60000 > minutes
}

type SortField = 'ticker' | 'price_change' | 'current_price' | 'buy_target' | 'distancia' | 'analyst_target' | 'vsAnalyst'
type SortDir   = 'asc' | 'desc'

interface WatchItem {
  id:             number
  ticker:         string
  buy_target:     number
  analyst_target: number
  notes:          string
  current_price:  number | null
  price_change:   number | null
  price_name:     string | null
  last_updated:   string | null
}

interface EnrichedItem extends WatchItem {
  distancia: number
  vsAnalyst: number
  inZone:    boolean
}

export default function WatchlistPage() {
  const { money } = usePrivacy()

  const [list,           setList]           = useState<WatchItem[]>([])
  const [loading,        setLoading]        = useState(false)
  const [loadingTickers, setLoadingTickers] = useState<string[]>([])
  const [lastRefresh,    setLastRefresh]    = useState<Date | null>(null)

  const [newTicker,  setNewTicker]  = useState('')
  const [newTarget,  setNewTarget]  = useState('')
  const [newAnalyst, setNewAnalyst] = useState('')
  const [newNotes,   setNewNotes]   = useState('')

  const [sortField,  setSortField]  = useState<SortField>('ticker')
  const [sortDir,    setSortDir]    = useState<SortDir>('asc')
  const [filterText, setFilterText] = useState('')
  const [editingId,  setEditingId]  = useState<number | null>(null)
  const [tempTarget, setTempTarget] = useState('')

  const fetchList = useCallback(async (): Promise<WatchItem[]> => {
    const { data, error } = await supabase.from('watchlist').select('*').order('ticker')
    if (error) { console.error('Supabase error:', error); return [] }
    return (data as WatchItem[]) || []
  }, [])

  const fetchPrices = useCallback(async (items: WatchItem[], force = false) => {
    if (!items.length) return
    const toUpdate = force
    ? items
    : items.filter(i => isStale(i.last_updated, 3))
    if (!toUpdate.length) {
      setLastRefresh(new Date());
      return
    }

    setLoadingTickers(toUpdate.map(i => i.ticker))

for (const item of toUpdate) {
  const ticker = item.ticker.trim().toUpperCase()

  try {
    const res = await fetch(`https://api.twelvedata.com/quote?symbol=${ticker}&apikey=${TD_API_KEY}`)
    const data = await res.json()

    if (data.status === 'error') continue

    if (data?.close) {
      const price  = parseFloat(Number(data.close).toFixed(2))
      const change = parseFloat(Number(data.percent_change || 0).toFixed(2))
      const nowIso = new Date().toISOString()

      await supabase.from('watchlist').update({
        current_price: price,
        price_change: change,
        last_updated: nowIso,
      }).eq('id', item.id)

      setList(prev => prev.map(i =>
        i.id === item.id
          ? { ...i, current_price: price, price_change: change, last_updated: nowIso }
          : i
      ))
    }

    await new Promise(r => setTimeout(r, 6000))

  } catch (err) {
    console.error(`Error ${ticker}:`, err)
  } finally {
    setLoadingTickers(prev => prev.filter(t => t !== item.ticker))
  }
}

setLastRefresh(new Date())
}, [])

  const init = useCallback(async (force = false) => {
    setLoading(true)
    const items = await fetchList()
    setList(items)
    setLoading(false)
    if (force) {
      fetchPrices(items, true)
    } else {
      setLastRefresh(new Date())
    }
  }, [fetchList, fetchPrices])

  useEffect(() => {
    init()
  }, [init])

 const agregarEmpresa = async () => {
  const ticker = newTicker.trim().toUpperCase()
  if (!ticker || !newTarget) return alert('Ticker y precio objetivo son obligatorios')

  const { error } = await supabase.from('watchlist').insert({
    ticker,
    buy_target: parseFloat(parseFloat(newTarget).toFixed(2)),
    analyst_target: parseFloat(newAnalyst) || 0,
    notes: newNotes.trim(),
  })

  if (error) {
    alert('Error: ' + error.message)
    return
  }

  setNewTicker('')
  setNewTarget('')
  setNewAnalyst('')
  setNewNotes('')

  // 🔥 Obtener solo el nuevo registro
  const { data } = await supabase
    .from('watchlist')
    .select('*')
    .eq('ticker', ticker)
    .single()

  if (data) {
    setList(prev => [...prev, data])  // ✅ lo agregas a la UI
    fetchPrices([data], true)         // ✅ actualizas precio inmediato
  }
}

  const eliminarEmpresa = async (id: number, ticker: string) => {
    if (!confirm(`¿Quitar ${ticker}?`)) return
    await supabase.from('watchlist').delete().eq('id', id)
    setList(prev => prev.filter(i => i.id !== id))
  }

  const updateTarget = async (id: number, newPrice: string) => {
    const price = parseFloat(parseFloat(newPrice).toFixed(2))
    if (isNaN(price)) { setEditingId(null); return }
    await supabase.from('watchlist').update({ buy_target: price }).eq('id', id)
    setList(prev => prev.map(i => i.id === id ? { ...i, buy_target: price } : i))
    setEditingId(null)
  }

  const enrichedList = useMemo<EnrichedItem[]>(() =>
    list.map(item => {
      const cur  = item.current_price || 0
      const dist = cur > 0 ? ((item.buy_target - cur) / cur) * 100 : 0
      const vs   = cur > 0 && item.analyst_target > 0 ? ((item.analyst_target - cur) / cur) * 100 : 0
      const zone = cur > 0 && Math.abs((cur - item.buy_target) / item.buy_target) <= 0.02
      return { ...item, distancia: dist, vsAnalyst: vs, inZone: zone }
    })
  , [list])

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  const displayList = useMemo(() => {
    let filtered = enrichedList
    if (filterText) {
      const q = filterText.toLowerCase()
      filtered = enrichedList.filter(i => i.ticker.toLowerCase().includes(q))
    }
    return [...filtered].sort((a, b) => {
      let av: any = a[sortField] ?? 0
      let bv: any = b[sortField] ?? 0
      if (typeof av === 'string') av = av.toLowerCase()
      if (typeof bv === 'string') bv = bv.toLowerCase()
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [enrichedList, filterText, sortField, sortDir])

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <FaSort style={{ opacity: 0.3, marginLeft: 3 }} />
    return sortDir === 'asc' ? <FaSortUp style={{ color: '#00bfff', marginLeft: 3 }} /> : <FaSortDown style={{ color: '#00bfff', marginLeft: 3 }} />
  }

  const marketOpen = isMarketOpen()
  const staleCount = list.filter(i => isStale(i.last_updated, 10)).length

  return (
    <AppShell>
      <div style={{ padding: '24px 32px', color: 'white', maxWidth: '1400px', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '1.4rem', fontWeight: 700, margin: 0 }}>
            <FaBell style={{ color: '#ffd700' }} /> Watchlist & Alertas
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: 5, color: marketOpen ? '#22c55e' : '#555' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: marketOpen ? '#22c55e' : '#444', display: 'inline-block' }} />
              {marketOpen ? 'Mercado abierto · monitoreo automático' : 'Mercado cerrado'}
            </span>
            {lastRefresh && <span style={{ fontSize: '0.65rem', color: '#333' }}>{lastRefresh.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</span>}
            <button onClick={() => init(true)} disabled={loading} style={btnStyle}>
              <FaSync style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} /> Actualizar
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, background: '#0d0d0d', padding: 12, borderRadius: 10, marginBottom: 16, border: '1px solid #1e1e1e', flexWrap: 'wrap' }}>
          <input style={inputStyle} placeholder="TICKER" value={newTicker} onChange={e => setNewTicker(e.target.value.toUpperCase())} onKeyDown={e => e.key === 'Enter' && agregarEmpresa()} />
          <input style={inputStyle} type="number" placeholder="Mi objetivo" value={newTarget} onChange={e => setNewTarget(e.target.value)} />
          <input style={inputStyle} type="number" placeholder="Analistas (opc)" value={newAnalyst} onChange={e => setNewAnalyst(e.target.value)} />
          <input style={{ ...inputStyle, flex: 2 }} placeholder="Notas (opc.)" value={newNotes} onChange={e => setNewNotes(e.target.value)} />
          <button onClick={agregarEmpresa} style={btnStyle}><FaPlus /> Agregar</button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FaSearch style={{ color: '#444', fontSize: 12 }} />
            <input style={{ ...inputStyle, width: 220, fontSize: '0.8rem' }} placeholder="Filtrar ticker..." value={filterText} onChange={e => setFilterText(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 20, fontSize: '0.65rem', color: '#333' }}>
            <span><span style={{ display: 'inline-block', width: 8, height: 8, background: 'rgba(76,175,80,0.4)', marginRight: 4 }}></span>±2% de tu objetivo</span>
          </div>
        </div>

        <div style={{ overflowX: 'auto', background: '#050505', borderRadius: 12, border: '1px solid #1a1a1a' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 750 }}>
            <thead>
              <tr style={{ background: '#0a0a0a' }}>
                {[ ['ticker', 'Ticker'], ['price_change', 'Var. día'], ['current_price', 'Precio actual'], ['buy_target', 'Mi objetivo'], ['distancia', 'Distancia %'], ['analyst_target', 'Obj. analistas'], ['vsAnalyst', 'Vs analistas %'], [null, 'Notas'], [null, ''] ].map(([field, label], idx) => (
                  <th key={idx} style={{ ...thStyle, cursor: field ? 'pointer' : 'default' }} onClick={field ? () => handleSort(field as SortField) : undefined}>
                    <span style={{ display: 'inline-flex', alignItems: 'center' }}>{label}{field && <SortIcon field={field as SortField} />}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayList.length === 0 && <tr><td colSpan={9} style={{ padding: 30, textAlign: 'center', color: '#333' }}>No hay activos.</td></tr>}
              {displayList.map(item => (
                <tr key={item.id} style={{ borderBottom: '1px solid #0c0c0c', background: item.inZone ? 'rgba(76,175,80,0.06)' : 'transparent' }}>
                  <td style={{ ...tdStyle, textAlign: 'left', paddingLeft: 14 }}><div style={{ fontWeight: 700, color: item.inZone ? '#4caf50' : '#00bfff' }}>{item.ticker}</div></td>
                  <td style={tdStyle}>{loadingTickers.includes(item.ticker) ? <FaSpinner className="animate-spin" /> : item.price_change !== null ? <span style={{ color: item.price_change >= 0 ? '#4caf50' : '#f44336' }}>{item.price_change >= 0 ? '+' : ''}{item.price_change.toFixed(2)}%</span> : '—'}</td>
                  <td style={tdStyle}>{item.current_price ? `$${item.current_price.toFixed(2)}` : '—'}</td>
                  <td style={{ ...tdStyle, color: '#ffd700', fontWeight: 700, cursor: 'pointer' }}>
                    {editingId === item.id ? (
                      <input autoFocus type="number" style={{ ...inputStyle, width: 80 }} value={tempTarget} onChange={e => setTempTarget(e.target.value)} onBlur={() => updateTarget(item.id, tempTarget)} onKeyDown={e => e.key === 'Enter' && updateTarget(item.id, tempTarget)} />
                    ) : (
                      <span onClick={() => { setEditingId(item.id); setTempTarget(item.buy_target.toString()) }}>${item.buy_target.toFixed(2)}</span>
                    )}
                  </td>
                  <td style={tdStyle}>{item.current_price ? <span style={{ color: item.inZone ? '#4caf50' : item.distancia < 0 ? '#f44336' : '#ffd700' }}>{item.inZone ? 'En zona' : `${item.distancia > 0 ? '+' : ''}${item.distancia.toFixed(2)}%`}</span> : '—'}</td>
                  <td style={{ ...tdStyle, color: '#555' }}>{item.analyst_target > 0 ? `$${Number(item.analyst_target).toFixed(2)}` : '—'}</td>
                  <td style={tdStyle}>{item.current_price && item.analyst_target > 0 ? <span style={{ color: item.vsAnalyst > 0 ? '#4caf50' : '#f44336' }}>{item.vsAnalyst > 0 ? '+' : ''}{item.vsAnalyst.toFixed(2)}%</span> : '—'}</td>
                  <td style={{ ...tdStyle, color: '#555', fontSize: '0.72rem', textAlign: 'left' }}>{item.notes}</td>
                  <td style={tdStyle}><button onClick={() => eliminarEmpresa(item.id, item.ticker)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#222' }}><FaTrash /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 8, color: '#222', fontSize: '0.65rem', textAlign: 'right' }}>Monitoreo en la nube activo · se actualiza según cercanía al objetivo</div>
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } } .animate-spin { animation: spin 1s linear infinite; }`}</style>
    </AppShell>
  )
}

const thStyle: React.CSSProperties = { padding: '10px 12px', textAlign: 'center', color: '#444', fontSize: '0.6rem', textTransform: 'uppercase' }
const tdStyle: React.CSSProperties = { padding: '6px 10px', textAlign: 'center', fontSize: '0.82rem' }
const inputStyle: React.CSSProperties = { background: '#000', border: '1px solid #222', color: 'white', padding: '8px 10px', borderRadius: 6, outline: 'none' }
const btnStyle: React.CSSProperties = { background: '#1b4d20', color: 'white', border: '1px solid #2d7a34', padding: '8px 14px', borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }
