'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { usePrivacy } from '@/lib/PrivacyContext'
import AppShell from '../AppShell'
import {
  FaBell, FaPlus, FaTrash, FaSpinner,
  FaSort, FaSortUp, FaSortDown, FaSearch, FaSync, FaBrain,
} from 'react-icons/fa'
import { TrendingUp, TrendingDown, AlertTriangle, Eye } from 'lucide-react'

// Solo se llama desde el botón manual — el cron en Supabase hace el trabajo automático
const TD_API_KEY = process.env.NEXT_PUBLIC_TWELVEDATA_API_KEY || ''

// ── Utilidades ────────────────────────────────────────────────────────────────
const posAmount = (v: string) => v.replace(/[^0-9.]/g, '').replace(/^(\d*\.?\d*).*$/, '$1')

const isMarketOpen = () => {
  const now = new Date()
  const mx  = new Date(now.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }))
  const day  = mx.getDay()
  const time = mx.getHours() + mx.getMinutes() / 60
  return day >= 1 && day <= 5 && time >= 7.5 && time < 15
}

const isStale = (lastUpdated: string | null, minutes = 15) => {
  if (!lastUpdated) return true
  return (Date.now() - new Date(lastUpdated).getTime()) / 60000 > minutes
}

const fmtTime = (iso: string | null) => {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
}

// ── Cat decorators ─────────────────────────────────────────────────────────
const Paw = ({ size = 14, color = '#666', opacity = 1, style: s = {} }: any) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ opacity, flexShrink: 0, ...s }}>
    <ellipse cx="6"  cy="5"  rx="2.5" ry="3"/>
    <ellipse cx="11" cy="3"  rx="2.5" ry="3"/>
    <ellipse cx="16" cy="4"  rx="2.5" ry="3"/>
    <ellipse cx="19" cy="9"  rx="2"   ry="2.5"/>
    <path d="M12 22c-5 0-8-3-8-7 0-2.5 1.5-4.5 4-5.5 1-.4 2-.6 4-.6s3 .2 4 .6c2.5 1 4 3 4 5.5 0 4-3 7-8 7z"/>
  </svg>
)

const CatEars = ({ color = '#00bfff', opacity = 0.1, size = 40 }: any) => (
  <svg width={size * 1.5} height={size} viewBox="0 0 60 40" fill={color} style={{ opacity }}>
    <polygon points="0,40 12,0 24,40"/>
    <polygon points="36,40 48,0 60,40"/>
  </svg>
)

const CatTail = ({ color = '#00bfff', opacity = 0.07 }: any) => (
  <svg width={44} height={70} viewBox="0 0 50 80" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" style={{ opacity }}>
    <path d="M40 80 Q45 50 20 40 Q0 30 10 10 Q20 -5 35 5"/>
  </svg>
)

// ── Tipos ─────────────────────────────────────────────────────────────────────
type SortField = 'ticker' | 'price_change' | 'current_price' | 'buy_target' | 'distancia' | 'analyst_target' | 'vsAnalyst' | 'ai_probability'

interface WatchItem {
  id:               number
  ticker:           string
  buy_target:       number
  analyst_target:   number
  notes:            string
  current_price:    number | null
  price_change:     number | null
  price_name:       string | null
  last_updated:     string | null
  // IA
  rsi:              number | null
  ema20:            number | null
  volatility:       number | null
  ai_probability:   number | null
  ai_score:         number | null
  ai_signal:        string | null
  last_ai_alert_date: string | null
  last_alert_date:  string | null
}

interface EnrichedItem extends WatchItem {
  distancia: number
  vsAnalyst: number
  inZone:    boolean
  stale:     boolean
}

// ── Señal IA → color y etiqueta ───────────────────────────────────────────────
const signalMeta = (prob: number | null) => {
  if (!prob) return { color: '#444', bg: '#111', label: 'SIN DATOS', icon: null }
  if (prob >= 80) return { color: '#22c55e', bg: 'rgba(34,197,94,0.08)',  label: '🔥 STRONG BUY', icon: <TrendingUp size={11} /> }
  if (prob >= 65) return { color: '#eab308', bg: 'rgba(234,179,8,0.08)', label: '⚡ BUY',         icon: <TrendingUp size={11} /> }
  if (prob >= 50) return { color: '#00bfff', bg: 'rgba(0,191,255,0.08)', label: '👀 WATCH',       icon: <Eye size={11} /> }
  return { color: '#555', bg: 'transparent', label: 'NO TRADE', icon: null }
}

// ── RSI color ─────────────────────────────────────────────────────────────────
const rsiColor = (rsi: number | null) => {
  if (!rsi) return '#888'
  if (rsi < 30) return '#22c55e'   // sobrevendido — oportunidad
  if (rsi > 70) return '#f43f5e'   // sobrecomprado — precaución
  return '#aaa'
}

export default function WatchlistIAPage() {
  const { money } = usePrivacy()

  const [list,           setList]           = useState<WatchItem[]>([])
  const [loading,        setLoading]        = useState(false)
  const [loadingTickers, setLoadingTickers] = useState<string[]>([])
  const [lastRefresh,    setLastRefresh]    = useState<Date | null>(null)

  // Formulario agregar
  const [newTicker,  setNewTicker]  = useState('')
  const [newTarget,  setNewTarget]  = useState('')
  const [newAnalyst, setNewAnalyst] = useState('')
  const [newNotes,   setNewNotes]   = useState('')

  // Tabla
  const [sortField,  setSortField]  = useState<SortField>('ai_probability')
  const [sortDir,    setSortDir]    = useState<'asc' | 'desc'>('desc')
  const [filterText, setFilterText] = useState('')
  const [editingId,  setEditingId]  = useState<number | null>(null)
  const [tempTarget, setTempTarget] = useState('')

  // Vista
  const [view, setView] = useState<'table' | 'cards'>('table')

  // ── Carga desde Supabase (precios + IA ya calculados por el cron) ────────────
  const fetchList = useCallback(async (): Promise<WatchItem[]> => {
    const { data, error } = await supabase
      .from('watchlist')
      .select('*')
      .order('ai_probability', { ascending: false })
    if (error) { console.error(error); return [] }
    return (data as WatchItem[]) || []
  }, [])

  // ── Actualización manual de precios (solo cuando el usuario lo pide) ─────────
  // El cron de Supabase se encarga de actualizar automáticamente + IA
  const fetchPrices = useCallback(async (items: WatchItem[], force = false) => {
    if (!items.length) return
    const toUpdate = force ? items : items.filter(i => isStale(i.last_updated, 3))
    if (!toUpdate.length) { setLastRefresh(new Date()); return }

    setLoadingTickers(toUpdate.map(i => i.ticker))

    for (const item of toUpdate) {
      const ticker = item.ticker.trim().toUpperCase()
      try {
        const res  = await fetch(`https://api.twelvedata.com/quote?symbol=${ticker}&apikey=${TD_API_KEY}`)
        const data = await res.json()
        if (data.status === 'error' || !data?.close) continue

        const price    = parseFloat(Number(data.close).toFixed(2))
        const change   = parseFloat(Number(data.percent_change || 0).toFixed(2))
        const nowIso   = new Date().toISOString()

        await supabase.from('watchlist').update({
          current_price: price,
          price_change:  change,
          price_name:    data.name || ticker,
          last_updated:  nowIso,
        }).eq('id', item.id)

        setList(prev => prev.map(i =>
          i.id === item.id ? { ...i, current_price: price, price_change: change, last_updated: nowIso } : i
        ))
      } catch (err) {
        console.error(`Error ${ticker}:`, err)
      } finally {
        setLoadingTickers(prev => prev.filter(t => t !== ticker))
      }
      await new Promise(r => setTimeout(r, 6000))
    }
    setLastRefresh(new Date())
  }, [])

  const init = useCallback(async (force = false) => {
    setLoading(true)
    const items = await fetchList()
    setList(items)
    setLoading(false)
    if (force) fetchPrices(items, true)
    else setLastRefresh(new Date())
  }, [fetchList, fetchPrices])

  useEffect(() => { init() }, [init])

  // ── Agregar ticker ────────────────────────────────────────────────────────────
  const agregarEmpresa = async () => {
    const ticker = newTicker.trim().toUpperCase()
    if (!ticker || !newTarget) return alert('Ticker y precio objetivo son obligatorios')
    const { error } = await supabase.from('watchlist').insert({
      ticker,
      buy_target:     parseFloat(parseFloat(newTarget).toFixed(2)),
      analyst_target: parseFloat(newAnalyst) || 0,
      notes:          newNotes.trim(),
    })
    if (error) { alert('Error: ' + error.message); return }
    setNewTicker(''); setNewTarget(''); setNewAnalyst(''); setNewNotes('')

    const { data } = await supabase.from('watchlist').select('*').eq('ticker', ticker).order('created_at', { ascending: false }).limit(1).single()
    if (data) { setList(prev => [data, ...prev].sort((a, b) => (b.ai_probability || 0) - (a.ai_probability || 0))); fetchPrices([data], true) }
  }

  const eliminarEmpresa = async (id: number, ticker: string) => {
    if (!confirm(`¿Quitar ${ticker} de la watchlist?`)) return
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

  // ── Enriquecer lista ─────────────────────────────────────────────────────────
  const enrichedList = useMemo<EnrichedItem[]>(() =>
    list.map(item => {
      const cur  = item.current_price || 0
      const dist = cur > 0 ? ((item.buy_target - cur) / cur) * 100 : 0
      const vs   = cur > 0 && item.analyst_target > 0 ? ((item.analyst_target - cur) / cur) * 100 : 0
      const zone = cur > 0 && Math.abs((cur - item.buy_target) / item.buy_target) <= 0.02
      const stale = isStale(item.last_updated, 15)
      return { ...item, distancia: dist, vsAnalyst: vs, inZone: zone, stale }
    })
  , [list])

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('desc') }
  }

  const displayList = useMemo(() => {
    let filtered = enrichedList
    if (filterText) {
      const q = filterText.toLowerCase()
      filtered = enrichedList.filter(i =>
        i.ticker.toLowerCase().includes(q) || (i.price_name || '').toLowerCase().includes(q) || (i.notes || '').toLowerCase().includes(q)
      )
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

  // Tickers con señal fuerte para las tarjetas destacadas
  const strongSignals = useMemo(() =>
    enrichedList.filter(i => (i.ai_probability || 0) >= 65).slice(0, 6)
  , [enrichedList])

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <FaSort style={{ opacity: 0.3, marginLeft: 3 }} />
    return sortDir === 'asc' ? <FaSortUp style={{ color: '#00bfff', marginLeft: 3 }} /> : <FaSortDown style={{ color: '#00bfff', marginLeft: 3 }} />
  }

  const marketOpen = isMarketOpen()
  const staleTickers = list.filter(i => isStale(i.last_updated, 30)).length

  return (
    <AppShell>
      <div style={{ padding: '22px 28px', color: 'white', maxWidth: 1500, margin: '0 auto', position: 'relative' }}>

        {/* Cat decorations */}
        <div style={{ position: 'absolute', top: -2, right: 55, pointerEvents: 'none' }}>
          <CatEars color="#ffd700" opacity={0.12} size={42} />
        </div>
        <div style={{ position: 'absolute', right: -6, top: '40%', pointerEvents: 'none' }}>
          <CatTail color="#ffd700" opacity={0.08} />
        </div>

        {/* ── HEADER ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Paw size={20} color="#ffd700" opacity={0.6} />
              <Paw size={14} color="#ffd700" opacity={0.35} />
              <Paw size={9}  color="#ffd700" opacity={0.18} />
              <FaBell style={{ color: '#ffd700', fontSize: 18 }} />
              <FaBrain style={{ color: '#00bfff', fontSize: 16 }} />
              <h1 style={{ fontSize: 20, fontWeight: 900, margin: 0 }}>Watchlist & IA Signals</h1>
            </div>
            <div style={{ fontSize: 11, color: '#888', marginLeft: 60 }}>
              Monitoreo de precios · análisis técnico automatizado · alertas inteligentes
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Estado mercado */}
            <span style={{ fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: 5, color: marketOpen ? '#22c55e' : '#666' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: marketOpen ? '#22c55e' : '#444', display: 'inline-block' }} />
              {marketOpen ? 'Mercado abierto' : 'Mercado cerrado'}
            </span>

            {/* Indicador de datos viejos */}
            {staleTickers > 0 && (
              <span style={{ fontSize: '0.65rem', color: '#eab308', display: 'flex', alignItems: 'center', gap: 4 }}>
                <AlertTriangle size={10} />
                {staleTickers} dato{staleTickers !== 1 ? 's' : ''} desact.
              </span>
            )}

            {/* Spinner */}
            {loadingTickers.length > 0 && (
              <span style={{ color: '#00bfff', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: 5 }}>
                <FaSpinner className="animate-spin" />
                {loadingTickers[0]}
                {loadingTickers.length > 1 ? ` +${loadingTickers.length - 1}` : ''}
              </span>
            )}

            {lastRefresh && (
              <span style={{ fontSize: '0.65rem', color: '#444' }}>
                {lastRefresh.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}

            {/* Toggle vista */}
            <div style={{ display: 'flex', background: '#0a0a0a', border: '1px solid #222', borderRadius: 6, overflow: 'hidden' }}>
              {(['table', 'cards'] as const).map(v => (
                <button key={v} onClick={() => setView(v)} style={{
                  background: view === v ? '#00bfff' : 'transparent',
                  color: view === v ? '#000' : '#666',
                  border: 'none', padding: '6px 12px', cursor: 'pointer',
                  fontSize: 10, fontWeight: 700,
                }}>
                  {v === 'table' ? 'Tabla' : 'Tarjetas'}
                </button>
              ))}
            </div>

            <button onClick={() => init(true)} disabled={loading} style={btnStyle}>
              <FaSync style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
              Actualizar
            </button>
          </div>
        </div>

        {/* ── SEÑALES FUERTES (tarjetas mini destacadas) ── */}
        {strongSignals.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 9, color: '#888', fontWeight: 700, letterSpacing: 1, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 7 }}>
              <FaBrain style={{ color: '#00bfff', fontSize: 10 }} />
              SEÑALES IA ACTIVAS — TICKERS CON MAYOR PROBABILIDAD
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(strongSignals.length, 6)}, 1fr)`, gap: 10 }}>
              {strongSignals.map(item => {
                const sig = signalMeta(item.ai_probability)
                return (
                  <div key={item.id} style={{
                    background: sig.bg, border: `1px solid ${sig.color}44`,
                    borderRadius: 10, padding: '12px 14px', position: 'relative', overflow: 'hidden',
                  }}>
                    {/* Huella decorativa de fondo */}
                    <div style={{ position: 'absolute', bottom: -8, right: -8, pointerEvents: 'none' }}>
                      <Paw size={44} color={sig.color} opacity={0.07} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                      <div style={{ fontWeight: 900, color: '#fff', fontSize: 16 }}>{item.ticker}</div>
                      <div style={{ fontSize: 18, fontWeight: 900, color: sig.color }}>{item.ai_probability?.toFixed(0)}%</div>
                    </div>
                    <div style={{ fontSize: 10, color: sig.color, fontWeight: 700, marginBottom: 6 }}>{item.ai_signal}</div>
                    <div style={{ background: '#111', height: 3, borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
                      <div style={{ width: `${item.ai_probability || 0}%`, background: sig.color, height: '100%', borderRadius: 2 }} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, fontSize: 9 }}>
                      <div>
                        <div style={{ color: '#666' }}>Precio</div>
                        <div style={{ color: '#fff', fontWeight: 700 }}>{item.current_price ? `$${item.current_price.toFixed(2)}` : '—'}</div>
                      </div>
                      <div>
                        <div style={{ color: '#666' }}>RSI</div>
                        <div style={{ color: rsiColor(item.rsi), fontWeight: 700 }}>{item.rsi?.toFixed(1) || '—'}</div>
                      </div>
                      <div>
                        <div style={{ color: '#666' }}>Dist.</div>
                        <div style={{ color: item.inZone ? '#22c55e' : '#aaa', fontWeight: 700 }}>
                          {item.current_price ? (item.inZone ? '✓zona' : `${((item.buy_target - item.current_price) / item.current_price * 100).toFixed(1)}%`) : '—'}
                        </div>
                      </div>
                    </div>
                    <div style={{ fontSize: 8, color: '#444', marginTop: 6 }}>
                      Análisis: {fmtTime(item.last_updated)}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── FORMULARIO ── */}
        <div style={{ display: 'flex', gap: 8, background: '#0a0a0a', padding: 12, borderRadius: 10, marginBottom: 16, border: '1px solid #1a1a1a', flexWrap: 'wrap' }}>
          <input style={inpStyle} placeholder="TICKER" value={newTicker}
            onChange={e => setNewTicker(e.target.value.toUpperCase().replace(/\s/g,''))}
            onKeyDown={e => e.key === 'Enter' && agregarEmpresa()} />
          <input style={inpStyle} type="number" min="0" placeholder="Mi precio objetivo" value={newTarget}
            onChange={e => setNewTarget(posAmount(e.target.value))} />
          <input style={inpStyle} type="number" min="0" placeholder="Precio analistas (opc.)" value={newAnalyst}
            onChange={e => setNewAnalyst(posAmount(e.target.value))} />
          <input style={{ ...inpStyle, flex: 2, minWidth: 160 }} placeholder="Notas (opc.)" value={newNotes}
            onChange={e => setNewNotes(e.target.value)} />
          <button onClick={agregarEmpresa} style={btnStyle}><FaPlus /> Agregar</button>
        </div>

        {/* ── FILTRO ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FaSearch style={{ color: '#666', fontSize: 12 }} />
            <input style={{ ...inpStyle, width: 220, fontSize: '0.8rem' }} placeholder="Filtrar ticker, nombre o nota..."
              value={filterText} onChange={e => setFilterText(e.target.value)} />
            {filterText && <span style={{ fontSize: 10, color: '#666' }}>{displayList.length} resultado(s)</span>}
          </div>
          <div style={{ fontSize: 9, color: '#555', display: 'flex', gap: 16 }}>
            <span><span style={{ display: 'inline-block', width: 8, height: 8, background: 'rgba(34,197,94,0.3)', borderRadius: 1, marginRight: 4 }}></span>±2% de tu objetivo</span>
            <span>Dist (+) = falta bajar · (−) = ya pasó</span>
          </div>
        </div>

        {/* ── VISTA TABLA ── */}
        {view === 'table' && (
          <div style={{ overflowX: 'auto', background: '#050505', borderRadius: 12, border: '1px solid #1a1a1a' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead>
                <tr style={{ background: '#0a0a0a' }}>
                  {([
                    ['ticker',        'Ticker'],
                    ['price_change',  'Var. día'],
                    ['current_price', 'Precio'],
                    ['buy_target',    'Mi objetivo'],
                    ['distancia',     'Dist. %'],
                    ['analyst_target','Analistas'],
                    ['vsAnalyst',     'Vs analistas'],
                    ['ai_probability','IA prob.'],
                    [null,            'RSI'],
                    [null,            'Señal'],
                    [null,            'Actualizado'],
                    [null,            ''],
                  ] as [string | null, string][]).map(([field, label], idx) => (
                    <th key={idx}
                      style={{ ...thStyle, cursor: field ? 'pointer' : 'default' }}
                      onClick={field ? () => handleSort(field as SortField) : undefined}>
                      <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                        {label}
                        {field && <SortIcon field={field as SortField} />}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayList.length === 0 && (
                  <tr><td colSpan={12} style={{ padding: 40, textAlign: 'center', color: '#555' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                      <Paw size={28} color="#333" opacity={0.5} />
                      No hay activos. Agrega uno arriba.
                    </div>
                  </td></tr>
                )}
                {displayList.map(item => {
                  const sig = signalMeta(item.ai_probability)
                  return (
                    <tr key={item.id} style={{
                      borderBottom: '1px solid #0c0c0c',
                      background: item.inZone ? 'rgba(34,197,94,0.05)' : 'transparent',
                    }}>
                      {/* Ticker */}
                      <td style={{ ...tdStyle, textAlign: 'left', paddingLeft: 14 }}>
                        <div style={{ fontWeight: 700, color: item.inZone ? '#22c55e' : '#00bfff', fontSize: 14 }}>
                          {item.ticker}
                        </div>
                        {item.price_name && (
                          <div style={{ fontSize: 9, color: '#444', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {item.price_name}
                          </div>
                        )}
                      </td>

                      {/* Var. día */}
                      <td style={tdStyle}>
                        {loadingTickers.includes(item.ticker)
                          ? <FaSpinner style={{ animation: 'spin 1s linear infinite', color: '#444', fontSize: 10 }} />
                          : item.price_change !== null
                            ? <span style={{ color: item.price_change >= 0 ? '#22c55e' : '#f43f5e', fontWeight: 600, fontSize: 12 }}>
                                {item.price_change >= 0 ? '+' : ''}{item.price_change.toFixed(2)}%
                              </span>
                            : <span style={{ color: '#333' }}>—</span>
                        }
                      </td>

                      {/* Precio */}
                      <td style={{ ...tdStyle, fontWeight: 600, fontSize: 13 }}>
                        {item.current_price ? `$${item.current_price.toFixed(2)}` : <span style={{ color: '#333' }}>—</span>}
                      </td>

                      {/* Mi objetivo — editable */}
                      <td style={{ ...tdStyle, color: '#ffd700', fontWeight: 700, cursor: 'pointer' }}>
                        {editingId === item.id ? (
                          <input autoFocus type="number" min="0"
                            style={{ ...inpStyle, width: 80, padding: '4px 6px', fontSize: '0.8rem' }}
                            value={tempTarget} onChange={e => setTempTarget(e.target.value)}
                            onBlur={() => updateTarget(item.id, tempTarget)}
                            onKeyDown={e => { if (e.key === 'Enter') updateTarget(item.id, tempTarget); if (e.key === 'Escape') setEditingId(null) }}
                          />
                        ) : (
                          <span onClick={() => { setEditingId(item.id); setTempTarget(item.buy_target.toString()) }} title="Clic para editar">
                            ${item.buy_target.toFixed(2)}
                          </span>
                        )}
                      </td>

                      {/* Distancia */}
                      <td style={tdStyle}>
                        {item.current_price
                          ? item.inZone
                            ? <span style={{ color: '#22c55e', fontWeight: 700, fontSize: 11, background: 'rgba(34,197,94,0.1)', padding: '2px 7px', borderRadius: 3 }}>En zona</span>
                            : <span style={{ color: item.distancia < 0 ? '#f43f5e' : item.distancia < 10 ? '#ffd700' : '#666', fontWeight: 600, fontSize: 12 }}>
                                {item.distancia > 0 ? '+' : ''}{item.distancia.toFixed(2)}%
                              </span>
                          : <span style={{ color: '#333' }}>—</span>}
                      </td>

                      {/* Analistas */}
                      <td style={{ ...tdStyle, color: '#666', fontSize: 12 }}>
                        {item.analyst_target > 0 ? `$${Number(item.analyst_target).toFixed(2)}` : <span style={{ color: '#333' }}>—</span>}
                      </td>

                      {/* Vs analistas */}
                      <td style={tdStyle}>
                        {item.current_price && item.analyst_target > 0
                          ? <span style={{ color: item.vsAnalyst > 0 ? '#22c55e' : '#f43f5e', fontWeight: 600, fontSize: 12 }}>
                              {item.vsAnalyst > 0 ? '+' : ''}{item.vsAnalyst.toFixed(2)}%
                            </span>
                          : <span style={{ color: '#333' }}>—</span>}
                      </td>

                      {/* IA probabilidad */}
                      <td style={tdStyle}>
                        {item.ai_probability !== null ? (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                            <span style={{ color: sig.color, fontWeight: 700, fontSize: 13 }}>{item.ai_probability.toFixed(0)}%</span>
                            <div style={{ width: 40, background: '#111', height: 2, borderRadius: 1 }}>
                              <div style={{ width: `${item.ai_probability}%`, background: sig.color, height: '100%', borderRadius: 1 }} />
                            </div>
                          </div>
                        ) : <span style={{ color: '#333', fontSize: 10 }}>—</span>}
                      </td>

                      {/* RSI */}
                      <td style={{ ...tdStyle, fontWeight: 600, fontSize: 12 }}>
                        {item.rsi !== null
                          ? <span style={{ color: rsiColor(item.rsi) }}>{item.rsi.toFixed(1)}</span>
                          : <span style={{ color: '#333' }}>—</span>}
                      </td>

                      {/* Señal */}
                      <td style={tdStyle}>
                        {item.ai_signal
                          ? <span style={{ color: sig.color, fontSize: 10, fontWeight: 700, background: sig.bg, padding: '2px 7px', borderRadius: 4, border: `1px solid ${sig.color}33` }}>
                              {item.ai_signal}
                            </span>
                          : <span style={{ color: '#333', fontSize: 10 }}>—</span>}
                      </td>

                      {/* Actualizado */}
                      <td style={{ ...tdStyle, fontSize: 10 }}>
                        <span style={{ color: item.stale ? '#555' : '#888' }}>
                          {fmtTime(item.last_updated)}
                          {item.stale && <span style={{ color: '#444', marginLeft: 4 }}>●</span>}
                        </span>
                      </td>

                      {/* Eliminar */}
                      <td style={tdStyle}>
                        <button onClick={() => eliminarEmpresa(item.id, item.ticker)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#333', transition: 'color 0.2s', padding: 4 }}
                          onMouseEnter={e => (e.currentTarget.style.color = '#f43f5e')}
                          onMouseLeave={e => (e.currentTarget.style.color = '#333')}>
                          <FaTrash style={{ fontSize: 11 }} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── VISTA TARJETAS COMPLETA ── */}
        {view === 'cards' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
            {displayList.map(item => {
              const sig = signalMeta(item.ai_probability)
              return (
                <div key={item.id} style={{
                  background: '#080808', border: `1px solid ${sig.color}33`,
                  borderRadius: 14, padding: 18, position: 'relative', overflow: 'hidden',
                }}>
                  {/* Huella y glow */}
                  <div style={{ position: 'absolute', bottom: -12, right: -12, pointerEvents: 'none' }}>
                    <Paw size={70} color={sig.color} opacity={0.05} />
                  </div>
                  {(item.ai_probability || 0) >= 80 && (
                    <div style={{ position: 'absolute', top: -20, right: -20, width: 80, height: 80, background: `${sig.color}15`, borderRadius: '50%', filter: 'blur(20px)', pointerEvents: 'none' }} />
                  )}

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <div>
                      <div style={{ fontSize: 20, fontWeight: 900, color: '#fff' }}>{item.ticker}</div>
                      {item.price_name && <div style={{ fontSize: 9, color: '#555', marginTop: 2 }}>{item.price_name}</div>}
                    </div>
                    <div style={{ fontSize: 9, color: sig.color, fontWeight: 700, background: sig.bg, padding: '3px 8px', borderRadius: 5, border: `1px solid ${sig.color}44` }}>
                      {item.ai_signal || 'SIN DATOS'}
                    </div>
                  </div>

                  {/* Precios */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                    <div style={{ background: '#050505', borderRadius: 8, padding: '8px 10px', border: '1px solid #111' }}>
                      <div style={{ fontSize: 8, color: '#555', marginBottom: 3 }}>PRECIO ACTUAL</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>{item.current_price ? `$${item.current_price.toFixed(2)}` : '—'}</div>
                      {item.price_change !== null && (
                        <div style={{ fontSize: 9, color: item.price_change >= 0 ? '#22c55e' : '#f43f5e' }}>
                          {item.price_change >= 0 ? '+' : ''}{item.price_change.toFixed(2)}%
                        </div>
                      )}
                    </div>
                    <div style={{ background: '#050505', borderRadius: 8, padding: '8px 10px', border: '1px solid #111' }}>
                      <div style={{ fontSize: 8, color: '#555', marginBottom: 3 }}>MI OBJETIVO</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: '#ffd700' }}>${item.buy_target.toFixed(2)}</div>
                      {item.current_price && (
                        <div style={{ fontSize: 9, color: item.inZone ? '#22c55e' : '#888' }}>
                          {item.inZone ? '✓ En zona' : `${item.distancia.toFixed(1)}% lejos`}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Indicadores */}
                  <div style={{ background: '#050505', borderRadius: 8, padding: '10px 12px', border: '1px solid #111', marginBottom: 12 }}>
                    {[
                      { label: 'RSI (14)',    value: item.rsi        ? item.rsi.toFixed(2)        : '—', color: rsiColor(item.rsi) },
                      { label: 'EMA (20)',    value: item.ema20      ? `$${item.ema20.toFixed(2)}` : '—', color: item.current_price && item.ema20 ? (item.current_price > item.ema20 ? '#22c55e' : '#f43f5e') : '#888' },
                      { label: 'Volatilidad', value: item.volatility ? `${item.volatility.toFixed(2)}%` : '—', color: (item.volatility || 0) < 2 ? '#22c55e' : (item.volatility || 0) > 4 ? '#f43f5e' : '#888' },
                    ].map(row => (
                      <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #0d0d0d', fontSize: 11 }}>
                        <span style={{ color: '#666' }}>{row.label}</span>
                        <span style={{ color: row.color, fontWeight: 700, fontFamily: 'monospace' }}>{row.value}</span>
                      </div>
                    ))}
                  </div>

                  {/* IA confidence bar */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 9, color: '#888', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5 }}>
                        <FaBrain style={{ fontSize: 9, color: '#00bfff' }} /> IA CONFIDENCE
                      </span>
                      <span style={{ fontSize: 18, fontWeight: 900, color: sig.color }}>{item.ai_probability?.toFixed(0) || 0}%</span>
                    </div>
                    <div style={{ background: '#111', height: 4, borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ width: `${item.ai_probability || 0}%`, background: sig.color, height: '100%', borderRadius: 2, transition: 'width 0.8s ease' }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 9, color: '#444' }}>
                      <span>Score: {item.ai_score || 0} pts</span>
                      <span>Análisis: {fmtTime(item.last_updated)}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div style={{ marginTop: 10, fontSize: 9, color: '#333', textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
          <Paw size={9} color="#333" opacity={0.5} />
          Precios y análisis IA actualizados por cron en Supabase · actualización manual disponible con el botón
        </div>

      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        .animate-spin { animation: spin 1s linear infinite; }
        tbody tr:hover td { background: rgba(255,255,255,0.01) !important; }
      `}</style>
    </AppShell>
  )
}

const thStyle: React.CSSProperties = { padding: '10px 12px', textAlign: 'center', color: '#888', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.07em', userSelect: 'none', whiteSpace: 'nowrap' }
const tdStyle: React.CSSProperties = { padding: '8px 10px', textAlign: 'center', whiteSpace: 'nowrap', fontSize: '0.82rem' }
const inpStyle: React.CSSProperties = { background: '#000', border: '1px solid #222', color: 'white', padding: '8px 10px', borderRadius: 6, flex: 1, minWidth: 100, outline: 'none', fontSize: '0.85rem' }
const btnStyle: React.CSSProperties = { background: '#1b2a1b', color: '#22c55e', border: '1px solid #2d4a2d', padding: '8px 14px', borderRadius: 6, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', whiteSpace: 'nowrap' }