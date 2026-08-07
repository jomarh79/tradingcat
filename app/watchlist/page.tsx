'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { usePrivacy } from '@/lib/PrivacyContext'
import AppShell from '../AppShell'
import {
  FaBell, FaPlus, FaTrash, FaSpinner,
  FaSort, FaSortUp, FaSortDown, FaSearch, FaSync, FaBrain,
} from 'react-icons/fa'
import { AlertTriangle } from 'lucide-react'

const posAmount = (v: string) => v.replace(/[^0-9.]/g, '').replace(/^(\d*\.?\d*).*$/, '$1')

// ── Protección de cuota de la API externa (ajusta estos números cuando confirmes tu límite real) ──
// "Actualizar" dispara la IA para TODOS los tickers de golpe (≈1 llamada externa por ticker).
const GLOBAL_UPDATE_COOLDOWN_MIN = 15
// Reanalizar una sola fila — no deja repetir el mismo ticker si se actualizó hace poco.
const TICKER_REFRESH_COOLDOWN_MIN = 3
const GLOBAL_COOLDOWN_KEY = 'watchlist_last_global_trigger'
// Separación mínima entre CUALQUIER disparo individual (agregar ticker o reanalizar fila),
// sin importar si es el mismo ticker u otro — protege el límite de 8 llamadas/minuto de TwelveData,
// ya que cada ticker individual no tiene throttling del lado del servidor.
const SINGLE_TRIGGER_MIN_GAP_SEC = 10

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

type SortField = 'ticker' | 'price_change' | 'current_price' | 'buy_target' | 'distancia' | 'analyst_target' | 'vsAnalyst' | 'ai_probability' | 'rsi' | 'notes'

interface WatchItem {
  id:                 number
  ticker:             string
  buy_target:         number
  analyst_target:     number
  notes:              string
  current_price:      number | null
  price_change:       number | null
  price_name:         string | null
  last_updated:       string | null
  rsi:                number | null
  ema20:              number | null
  volatility:         number | null
  ai_probability:     number | null
  ai_score:           number | null
  ai_signal:          string | null
  last_ai_alert_date: string | null
  last_alert_date:    string | null
  favorite: boolean | null
}

interface EnrichedItem extends WatchItem {
  distancia: number
  vsAnalyst: number
  inZone:    boolean
  stale:     boolean
}

const signalMeta = (prob: number | null) => {
  if (prob === null || prob === undefined)
    return { color: '#444', bg: '#111', label: 'SIN DATOS' }
  if (prob >= 80) return { color: '#22c55e', bg: 'rgba(34,197,94,0.08)',  label: '🔥 STRONG BUY' }
  if (prob >= 65) return { color: '#eab308', bg: 'rgba(234,179,8,0.08)', label: '⚡ BUY' }
  if (prob >= 50) return { color: '#00bfff', bg: 'rgba(0,191,255,0.08)', label: '👀 WATCH' }
  return { color: '#555', bg: 'transparent', label: 'NO TRADE' }
}

const rsiColor = (rsi: number | null) => {
  if (rsi === null || rsi === undefined) return '#888'
  if (rsi < 30) return '#22c55e'
  if (rsi > 70) return '#f43f5e'
  return '#aaa'
}

// Dispara el análisis IA en tu API de Render (todos los tickers, o uno solo si se pasa)
async function triggerIA(
    ticker?: string,
    force = false
): Promise<void> {

    try {

        await fetch('/api/trigger-ia', {

            method: 'POST',

            headers: {
                'Content-Type': 'application/json',
            },

            body: JSON.stringify({
                ...(ticker ? { ticker } : {}),
                force,
            }),

        })

    } catch (error) {

        console.error("Error al disparar la IA:", error)

    }

}

export default function WatchlistIAPage() {
  const { money } = usePrivacy()

  const [list,        setList]        = useState<WatchItem[]>([])
  const [loading,     setLoading]     = useState(false)
  const [addingNew,   setAddingNew]   = useState(false)  // spinner solo para ticker nuevo
  const [refreshingTickers, setRefreshingTickers] = useState<Set<string>>(new Set())
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const [newTicker,  setNewTicker]  = useState('')
  const [newTarget,  setNewTarget]  = useState('')
  const [newAnalyst, setNewAnalyst] = useState('')
  const [newNotes,   setNewNotes]   = useState('')

  const [sortField, setSortField] = useState<SortField>('distancia')
  const [sortDir,   setSortDir]   = useState<'asc' | 'desc'>('desc')
  const [filterText,  setFilterText] = useState('')
  const [editingId,   setEditingId]  = useState<number | null>(null)
  const [tempTarget,  setTempTarget] = useState('')

  // ── Cooldown del botón "Actualizar" (todos los tickers) ──
  const [lastGlobalTrigger, setLastGlobalTrigger] = useState<number | null>(null)
  const [nowTick, setNowTick] = useState(Date.now())

  useEffect(() => {
    const stored = localStorage.getItem(GLOBAL_COOLDOWN_KEY)
    if (stored) setLastGlobalTrigger(Number(stored))
  }, [])

  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 3000)
    return () => clearInterval(t)
  }, [])

  const globalCooldownRemaining = useCallback(() => {
    if (!lastGlobalTrigger) return 0
    const elapsedMin = (nowTick - lastGlobalTrigger) / 60000
    return Math.max(0, GLOBAL_UPDATE_COOLDOWN_MIN - elapsedMin)
  }, [lastGlobalTrigger, nowTick])

  const tickerCooldownRemaining = useCallback((lastUpdated: string | null) => {
    if (!lastUpdated) return 0
    const elapsedMin = (nowTick - new Date(lastUpdated).getTime()) / 60000
    return Math.max(0, TICKER_REFRESH_COOLDOWN_MIN - elapsedMin)
  }, [nowTick])

  // ── Separación mínima entre disparos individuales (agregar / reanalizar fila) ──
  const [lastSingleTrigger, setLastSingleTrigger] = useState<number | null>(null)

  const singleTriggerGapRemaining = useCallback(() => {
    if (!lastSingleTrigger) return 0
    const elapsedSec = (nowTick - lastSingleTrigger) / 1000
    return Math.max(0, SINGLE_TRIGGER_MIN_GAP_SEC - elapsedSec)
  }, [lastSingleTrigger, nowTick])

  const fetchList = useCallback(async (): Promise<WatchItem[]> => {
    const { data, error } = await supabase
      .from('watchlist')
      .select('*')
      .gt('buy_target', 0)
      .order('ai_probability', { ascending: false })

    if (error) {
      console.error(error)
      return []
    }
    return (data as WatchItem[]) || []
  }, [])

const isMarketOpen = () => {
  const mexico = new Date(
    new Date().toLocaleString("en-US", {
      timeZone: "America/Mexico_City",
    })
  )

  const day = mexico.getDay()
  const hour = mexico.getHours() + mexico.getMinutes() / 60

  return (
    day >= 1 &&
    day <= 5 &&
    hour >= 7 &&
    hour < 15
  )
}
  
  const init = useCallback(async () => {
    setLoading(true)
    const items = await fetchList()
    setList(items)
    setLoading(false)
    setLastRefresh(new Date())
  }, [fetchList])

  useEffect(() => {

  init()

  const interval = setInterval(async () => {

    if (isMarketOpen()) {

      await triggerIA()

      await new Promise(r => setTimeout(r, 6000))

    }

    const updated = await fetchList()

    setList(updated)

    setLastRefresh(new Date())

  }, 120000)

  return () => clearInterval(interval)

}, [init, fetchList])

  // ── Espera a que un ticker específico tenga datos frescos, refrescando la lista mientras tanto ──
  const pollTicker = useCallback((ticker: string, onDone?: () => void) => {
    let attempts = 0
    const maxAttempts = 10
    const interval = setInterval(async () => {
      const updated = await fetchList()
      const found = updated.find(i => i.ticker === ticker && i.current_price !== null)
      setList(updated)
      attempts++
      if (found || attempts >= maxAttempts) {
        clearInterval(interval)
        onDone?.()
      }
    }, 3000)
  }, [fetchList])

  // ── Botón Actualizar (todos) — dispara IA y sondea varias veces en vez de esperar a ciegas ──
  const handleUpdate = async () => {
    if (globalCooldownRemaining() > 0) return
    setLoading(true)
    const triggeredAt = Date.now()
    setLastGlobalTrigger(triggeredAt)
    localStorage.setItem(GLOBAL_COOLDOWN_KEY, String(triggeredAt))
    await triggerIA(undefined, true)
    for (let i = 0; i < 3; i++) {
      await new Promise(r => setTimeout(r, 5000))
      const updated = await fetchList()
      setList(updated)
    }
    setLoading(false)
    setLastRefresh(new Date())
  }

  // ── Reanalizar un solo ticker desde la fila ──
  const refreshTicker = async (ticker: string, lastUpdated: string | null) => {
    if (tickerCooldownRemaining(lastUpdated) > 0) return
    if (singleTriggerGapRemaining() > 0) return
    setLastSingleTrigger(Date.now())
    setRefreshingTickers(prev => new Set(prev).add(ticker))
    await triggerIA(ticker)
    pollTicker(ticker, () => {
      setRefreshingTickers(prev => {
        const next = new Set(prev)
        next.delete(ticker)
        return next
      })
    })
  }

  // ── Agregar ticker — inserta en DB y dispara IA solo para ese ticker ───────
  const agregarEmpresa = async () => {
    const ticker = newTicker.trim().toUpperCase()
    if (!ticker || !newTarget) return alert('Ticker y precio objetivo son obligatorios')
    if (singleTriggerGapRemaining() > 0) return alert(`Espera ${Math.ceil(singleTriggerGapRemaining())}s antes de otro análisis individual`)

    const { error } = await supabase.from('watchlist').insert({
      ticker,
      buy_target:     parseFloat(parseFloat(newTarget).toFixed(2)),
      analyst_target: parseFloat(newAnalyst) || 0,
      notes:          newNotes.trim(),
    })
    if (error) { alert('Error: ' + error.message); return }

    setNewTicker(''); setNewTarget(''); setNewAnalyst(''); setNewNotes('')

    const { data: newItem } = await supabase.from('watchlist').select('*')
      .eq('ticker', ticker).order('created_at', { ascending: false }).limit(1).single()
    if (newItem) {
      setList(prev => [newItem, ...prev].sort((a, b) => (b.ai_probability || 0) - (a.ai_probability || 0)))
    }

    setAddingNew(true)
    setLastSingleTrigger(Date.now())
    triggerIA(ticker)
      .then(() => pollTicker(ticker, () => setAddingNew(false)))
      .catch((err) => {
        console.error("Error al procesar ticker nuevo:", err)
        setAddingNew(false)
      })
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

  const toggleFavorite = async (id: number, current: boolean | null) => {
    const newValue = !current
    setList(prev => prev.map(i => i.id === id ? { ...i, favorite: newValue } : i))

    const { error } = await supabase
      .from('watchlist')
      .update({ favorite: newValue })
      .eq('id', id)

    if (error) {
      console.error('ERROR FAVORITE:', error)
      setList(prev => prev.map(i => i.id === id ? { ...i, favorite: current } : i))
    }
  }

  const enrichedList = useMemo<EnrichedItem[]>(() =>
    list.map(item => {
      const cur  = item.current_price || 0
      const dist = cur > 0 ? ((item.buy_target - cur) / cur) * 100 : 0
      const vs   = cur > 0 && item.analyst_target > 0 ? ((item.analyst_target - cur) / cur) * 100 : 0
      const zone = cur > 0 && Math.abs((cur - item.buy_target) / item.buy_target) <= 0.02
      return { ...item, distancia: dist, vsAnalyst: vs, inZone: zone, stale: isStale(item.last_updated, 5) }
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
        i.ticker.toLowerCase().includes(q) ||
        (i.price_name || '').toLowerCase().includes(q) ||
        (i.notes || '').toLowerCase().includes(q)
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

  const strongSignals = useMemo(() =>
    enrichedList.filter(i => (i.ai_probability || 0) >= 65).slice(0, 6)
  , [enrichedList])

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <FaSort style={{ opacity: 0.3, marginLeft: 3 }} />
    return sortDir === 'asc'
      ? <FaSortUp   style={{ color: '#00bfff', marginLeft: 3 }} />
      : <FaSortDown style={{ color: '#00bfff', marginLeft: 3 }} />
  }

  const staleTickers = list.filter(i => isStale(i.last_updated, 5)).length
  const inZoneCount   = enrichedList.filter(i => i.inZone).length
  const strongCount   = enrichedList.filter(i => (i.ai_probability || 0) >= 65).length

  return (
    <AppShell>
      <div style={{ padding: '22px 28px', color: 'white', maxWidth: 1500, margin: '0 auto', position: 'relative' }}>

        <div style={{ position: 'absolute', top: -2, right: 55, pointerEvents: 'none' }}>
          <CatEars color="#ffd700" opacity={0.12} size={42} />
        </div>
        <div style={{ position: 'absolute', right: -6, top: '40%', pointerEvents: 'none' }}>
          <CatTail color="#ffd700" opacity={0.08} />
        </div>

        {/* ── HEADER ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Paw size={20} color="#ffd700" opacity={0.6} />
              <Paw size={14} color="#ffd700" opacity={0.35} />
              <Paw size={9}  color="#ffd700" opacity={0.18} />
              <FaBell  style={{ color: '#ffd700', fontSize: 18 }} />
              <FaBrain style={{ color: '#00bfff', fontSize: 16 }} />
              <h1 style={{ fontSize: 20, fontWeight: 900, margin: 0 }}>Watchlist & IA Signals</h1>
            </div>
            <div style={{ fontSize: 11, color: '#888', marginLeft: 60 }}>
              Monitoreo de precios · análisis técnico automatizado · alertas inteligentes
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.65rem', color: '#666' }}>{list.length} tickers</span>
            <span style={{ fontSize: '0.65rem', color: '#22c55e' }}>{inZoneCount} en zona</span>
            <span style={{ fontSize: '0.65rem', color: '#eab308' }}>{strongCount} señales fuertes</span>

            {staleTickers > 0 && (
              <span style={{ fontSize: '0.65rem', color: '#eab308', display: 'flex', alignItems: 'center', gap: 4 }}>
                <AlertTriangle size={10} />
                {staleTickers} dato{staleTickers !== 1 ? 's' : ''} desact.
              </span>
            )}

            {addingNew && (
              <span style={{ fontSize: '0.65rem', color: '#00bfff', display: 'flex', alignItems: 'center', gap: 5 }}>
                <FaSpinner style={{ animation: 'spin 1s linear infinite' }} />
                Analizando nuevo ticker...
              </span>
            )}

            {lastRefresh && (
              <span style={{ fontSize: '0.65rem', color: '#444' }}>
                {lastRefresh.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}

            <button
              onClick={handleUpdate}
              disabled={loading || globalCooldownRemaining() > 0}
              title={globalCooldownRemaining() > 0 ? `Protección de cuota: espera ${Math.ceil(globalCooldownRemaining())} min` : 'Reanalizar todos los tickers'}
              style={{ ...btnStyle, opacity: globalCooldownRemaining() > 0 ? 0.5 : 1, cursor: globalCooldownRemaining() > 0 ? 'default' : 'pointer' }}>
              <FaSync style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
              {globalCooldownRemaining() > 0 ? `Espera ${Math.ceil(globalCooldownRemaining())} min` : 'Actualizar'}
            </button>
          </div>
        </div>

        {/* ── SEÑALES FUERTES ── */}
        {strongSignals.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 9, color: '#888', fontWeight: 700, letterSpacing: 1, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 7 }}>
              <FaBrain style={{ color: '#00bfff', fontSize: 10 }} />
              SEÑALES IA ACTIVAS — TICKERS CON MAYOR PROBABILIDAD
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(strongSignals.length, 6)}, 1fr)`, gap: 10 }}>
              {strongSignals.map(item => {
                const sig = signalMeta(item.ai_probability)
                const rsiVal = Number(item.rsi)
                const rsiOk  = isFinite(rsiVal) && rsiVal >= 0 && rsiVal <= 100
                return (
                  <div key={item.id} style={{
                    background: sig.bg, border: `1px solid ${sig.color}44`,
                    borderRadius: 10, padding: '12px 14px', position: 'relative', overflow: 'hidden',
                  }}>
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
                        <div style={{ color: rsiColor(rsiOk ? rsiVal : null), fontWeight: 700 }}>
                          {rsiOk ? rsiVal.toFixed(1) : '—'}
                        </div>
                      </div>
                      <div>
                        <div style={{ color: '#666' }}>Dist.</div>
                        <div style={{ color: '#aaa', fontWeight: 700 }}>
                          {item.current_price
                            ? `${((item.buy_target - item.current_price) / item.current_price * 100).toFixed(1)}%`
                            : '—'}
                        </div>
                      </div>
                    </div>
                    <div style={{ fontSize: 8, color: '#444', marginTop: 6 }}>Análisis: {fmtTime(item.last_updated)}</div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── FORMULARIO ── */}
        <div style={{ display: 'flex', gap: 8, background: '#0a0a0a', padding: 12, borderRadius: 10, marginBottom: 16, border: '1px solid #1a1a1a', flexWrap: 'wrap' }}>
          <input style={inpStyle} placeholder="TICKER" value={newTicker}
            onChange={e => setNewTicker(e.target.value.toUpperCase().replace(/\s/g, ''))}
            onKeyDown={e => e.key === 'Enter' && agregarEmpresa()} />
          <input style={inpStyle} type="number" min="0" placeholder="Mi precio objetivo" value={newTarget}
            onChange={e => setNewTarget(posAmount(e.target.value))} />
          <input style={inpStyle} type="number" min="0" placeholder="Precio analistas (opc.)" value={newAnalyst}
            onChange={e => setNewAnalyst(posAmount(e.target.value))} />
          <input style={{ ...inpStyle, flex: 2, minWidth: 160 }} placeholder="Notas (opc.)" value={newNotes}
            onChange={e => setNewNotes(e.target.value)} />
          <button onClick={agregarEmpresa} disabled={addingNew} style={btnStyle}>
            {addingNew ? <FaSpinner style={{ animation: 'spin 1s linear infinite' }} /> : <FaPlus />}
            {addingNew ? 'Analizando...' : 'Agregar'}
          </button>
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
            <span>
              <span style={{ display: 'inline-block', width: 8, height: 8, background: 'rgba(34,197,94,0.3)', borderRadius: 1, marginRight: 4 }} />
              ±2% de tu objetivo
            </span>
            <span>Dist (+) = falta bajar · (−) = ya pasó</span>
          </div>
        </div>

        {/* ── TABLA ── */}
        <div style={{ overflowX: 'auto', background: '#050505', borderRadius: 12, border: '1px solid #1a1a1a' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1080 }}>
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
                  ['sma200_weekly','Media 200 semanal'],
                  ['rsi',           'RSI'],
                  ['notes',         'Notas'],
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
                <tr><td colSpan={11} style={{ padding: 40, textAlign: 'center', color: '#555' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                    <Paw size={28} color="#333" opacity={0.5} />
                    No hay activos. Agrega uno arriba.
                  </div>
                </td></tr>
              )}
              {displayList.map(item => {
                const sig      = signalMeta(item.ai_probability)
                const rsiValue = Number(item.rsi)
                const rsiOk    = isFinite(rsiValue) && rsiValue >= 0 && rsiValue <= 100
                const refreshingThis = refreshingTickers.has(item.ticker)
                const cooldownLeft   = tickerCooldownRemaining(item.last_updated)
                const sharedGapLeft  = singleTriggerGapRemaining()
                const canRefresh     = !refreshingThis && cooldownLeft <= 0 && sharedGapLeft <= 0

                return (
                  <tr key={item.id} style={{
                    borderBottom: '1px solid #0c0c0c',
                    background: item.favorite
                      ? 'rgba(234,179,8,0.12)'
                      : item.inZone
                        ? 'rgba(34,197,94,0.05)'
                        : 'transparent',
                  }}>

                    {/* Ticker */}
                    <td style={{ ...tdStyle, textAlign: 'left', paddingLeft: 14 }}>
                      <a
                        href={`https://es.tradingview.com/chart/?symbol=${item.ticker}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontWeight: 700,
                          color: item.inZone ? '#22c55e' : '#00bfff',
                          fontSize: 14,
                          textDecoration: 'none',
                        }}
                      >
                        {item.ticker}
                      </a>
                    </td>

                    {/* Var. día en % */}
                    <td style={tdStyle}>
                      {item.price_change !== null && item.price_change !== undefined
                        ? <span style={{
                            color: item.price_change >= 0 ? '#22c55e' : '#f43f5e',
                            fontWeight: 600, fontSize: 12,
                            background: item.price_change >= 0 ? 'rgba(34,197,94,0.08)' : 'rgba(244,63,94,0.08)',
                            padding: '2px 6px', borderRadius: 3,
                          }}>
                            {item.price_change >= 0 ? '+' : ''}{item.price_change.toFixed(2)}%
                          </span>
                        : <span style={{ color: '#333' }}>—</span>}
                    </td>

                    {/* Precio */}
                    <td style={{ ...tdStyle, fontWeight: 600, fontSize: 13 }}>
                      {item.current_price ? `$${item.current_price.toFixed(2)}` : <span style={{ color: '#333' }}>—</span>}
                    </td>

                    {/* Mi objetivo — editable */}
                    <td style={{ ...tdStyle, color: '#ffd700', fontWeight: 700, cursor: 'pointer' }}>
                      {editingId === item.id ? (
                        <input autoFocus type="number" min="0"
                          style={{ ...inpStyle, width: 80, padding: '4px 6px', fontSize: '0.8rem', flex: 'unset', minWidth: 'unset' }}
                          value={tempTarget}
                          onChange={e => setTempTarget(e.target.value)}
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
                        ? <span style={{
                            color: item.distancia < 0 ? '#f43f5e' : item.distancia < 10 ? '#ffd700' : '#666',
                            fontWeight: 600,
                            fontSize: 12
                          }}>
                            {item.distancia > 0 ? '+' : ''}{item.distancia.toFixed(2)}%
                          </span>
                        : <span style={{ color: '#333' }}>—</span>}
                    </td>

                    {/* Precio analistas */}
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

                    {/* Media 200 semanal */}
                    <td style={{ ...tdStyle, fontWeight: 600, fontSize: 12 }}>
                     
                    </td>

                    {/* RSI */}
                    <td style={{ ...tdStyle, fontWeight: 700, fontSize: 13 }}>
                      {rsiOk
                        ? <span style={{ color: rsiColor(rsiValue) }}>{rsiValue.toFixed(1)}</span>
                        : <span style={{ color: '#333' }}>—</span>}
                    </td>

                    {/* Notas */}
                    <td style={{ ...tdStyle, textAlign: 'left', maxWidth: 180 }}>
                      {item.notes
                        ? <span style={{ color: '#888', fontSize: 11 }} title={item.notes}>
                            {item.notes.length > 30 ? item.notes.slice(0, 30) + '…' : item.notes}
                          </span>
                        : <span style={{ color: '#333' }}>—</span>}
                    </td>

                    {/* Reanalizar + Estrella + Eliminar */}
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center' }}>
                        <button
                          onClick={() => refreshTicker(item.ticker, item.last_updated)}
                          disabled={!canRefresh}
                          title={
                            refreshingThis ? 'Analizando...' :
                            cooldownLeft > 0 ? `Protección de cuota: espera ${Math.ceil(cooldownLeft)} min` :
                            sharedGapLeft > 0 ? `Espera ${Math.ceil(sharedGapLeft)}s (límite de ráfaga)` :
                            'Reanalizar este ticker'
                          }
                          style={{ background: 'none', border: 'none', cursor: canRefresh ? 'pointer' : 'default', padding: 4,
                            color: refreshingThis ? '#00bfff' : canRefresh ? '#333' : '#222', fontSize: 12, transition: 'color 0.2s' }}
                          onMouseEnter={e => { if (canRefresh) e.currentTarget.style.color = '#00bfff' }}
                          onMouseLeave={e => { if (canRefresh) e.currentTarget.style.color = '#333' }}>
                          <FaSync style={{ animation: refreshingThis ? 'spin 1s linear infinite' : 'none' }} />
                        </button>
                        <button
                          onClick={() => toggleFavorite(item.id, item.favorite)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                            color: item.favorite ? '#ffd700' : '#333', fontSize: 16, transition: 'color 0.2s' }}
                          onMouseEnter={e => (e.currentTarget.style.color = '#ffd700')}
                          onMouseLeave={e => (e.currentTarget.style.color = item.favorite ? '#ffd700' : '#333')}>
                          ★
                        </button>
                        <button onClick={() => eliminarEmpresa(item.id, item.ticker)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#333', padding: 4, transition: 'color 0.2s' }}
                          onMouseEnter={e => (e.currentTarget.style.color = '#f43f5e')}
                          onMouseLeave={e => (e.currentTarget.style.color = '#333')}>
                          <FaTrash style={{ fontSize: 11 }} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 10, fontSize: 9, color: '#333', textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
          <Paw size={9} color="#333" opacity={0.5} />
          Análisis IA actualizado por cron en Supabase · botón Actualizar o el ícono de reanalizar fuerzan la ejecución
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