'use client'

import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { usePrivacy } from '@/lib/PrivacyContext'
import { useIsMobile } from '@/lib/useIsMobile'
import AppShell from '../AppShell'
import { Trash2, X, History, Pencil, Check, AlertTriangle } from 'lucide-react'
import { FaSort, FaSortUp, FaSortDown } from 'react-icons/fa'

const dayKey = (d: any) => String(d || '').split('T')[0].split(' ')[0]
const parseDate = (d: any) => new Date(dayKey(d) + 'T00:00:00')
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const yearOf = (key: string) => Number(key.slice(0, 4))
const monthOf = (key: string) => Number(key.slice(5, 7))
const closeKeyOf = (t: any) => dayKey(t.close_date || t.open_date)

const fmtDay = (d: any, year: '2-digit' | 'numeric' = '2-digit') => {
  const key = dayKey(d)
  if (!DAY_RE.test(key)) return '—'
  return parseDate(key).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year })
}

const r2 = (n: number) => parseFloat(n.toFixed(2))
const r6 = (n: number) => parseFloat(n.toFixed(6))

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

const CLOSE_REASONS = [
  'Take Profit', 'Stop loss', 'Decisión manual', 'Sentimiento del mercado',
  'Rompió estructura', 'Cambio de tesis', 'Necesidad de liquidez',
  'Error de análisis', 'Otro',
]

// Columnas por las que se puede ordenar (en la tabla, tocando el encabezado; en el celular, con el selector)
const SORT_OPTIONS: { key: string; label: string }[] = [
  { key: 'close_date', label: 'Cierre' },
  { key: 'open_date',  label: 'Apertura' },
  { key: 'ticker',     label: 'Ticker' },
  { key: 'sector',     label: 'Sector' },
  { key: 'diffDays',   label: 'Días' },
  { key: 'pnlCash',    label: 'PnL $' },
  { key: 'pnlPct',     label: 'PnL %' },
  { key: 'annualPct',  label: 'Anual %' },
]

// ── Supabase ──────────────────────────────────────────────────────────────────
// Supabase devuelve {error} en vez de lanzarlo: sin esto, un fallo en medio de una edición pasaba desapercibido
function must<T extends { error: any }>(res: T): T {
  if (res.error) throw new Error(res.error.message || String(res.error))
  return res
}

// Máximo 1000 filas por consulta: se pide por páginas (antes se cortaban los trades y dividendos a 1000)
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

type HistKind = EditRow['kind'] | 'div'
interface HistRow {
  key:         string
  kind:        HistKind
  executionId: string | null
  date:        string
  quantity:    number
  price:       number
  commission:  number
  net:         number
}

const HIST_LABEL: Record<HistKind, { label: string; color: string }> = {
  apertura: { label: 'Apertura',      color: '#00bfff' },
  buy:      { label: 'Recompra',      color: '#22c55e' },
  sell:     { label: 'Venta parcial', color: '#f43f5e' },
  close:    { label: 'Cierre',        color: '#00bfff' },
  div:      { label: 'Dividendo',     color: '#eab308' },
}

const execType = (e: any) => String(e?.execution_type || '').toLowerCase()

// ── Cálculo de un trade (una sola fuente: tabla, resumen, modal y guardado de ediciones) ──
// Antes, el guardado (recalcPnL) y la pantalla (calculateTradeData) tenían cada uno su copia de la fórmula.
function calcTrade(t: any, executions: any[] = t.trade_executions || []) {
  const openDate  = parseDate(t.open_date)
  const closeDate = parseDate(t.close_date || t.closed_at || t.open_date)
  const rawDays   = Math.round(Math.abs(closeDate.getTime() - openDate.getTime()) / 86400000)
  const diffDays  = Number.isFinite(rawDays) ? Math.max(1, rawDays) : 1

  const initialQty = r6(Number(t.initial_quantity || t.quantity))
  const initialInv = r2(initialQty * Number(t.entry_price))

  const buyExecs = executions
    .filter(e => execType(e) === 'buy')
    .reduce((acc, e) => r2(acc + Number(e.quantity) * Number(e.price) + Number(e.commission || 0)), 0)

  const totalInvested = r2(initialInv + buyExecs)

  const totalSells = executions
    .filter(e => ['sell', 'close'].includes(execType(e)))
    .reduce((acc, e) => r2(acc + Number(e.quantity) * Number(e.price) - Number(e.commission || 0)), 0)

  const pnlCash   = r2(totalSells - totalInvested)
  const pnlPct    = totalInvested > 0 ? r2((pnlCash / totalInvested) * 100) : 0
  const annualPct = pnlPct > -100
    ? r2((Math.pow(1 + pnlPct / 100, 365 / diffDays) - 1) * 100)
    : -100

  return { diffDays, totalInvested, totalSells, pnlCash, pnlPct, annualPct }
}

// El movimiento de apertura no tiene execution_id. Se busca por billetera + ticker + tipo 'trade' + monto
// negativo + fecha de apertura y, si hay varios (mismo ticker abierto dos veces el mismo día), se toma el de monto
// más parecido. Antes, al editar una apertura se tomaba el movimiento MÁS ANTIGUO de ese ticker en la billetera:
// con dos trades del mismo ticker se modificaba la apertura del otro.
async function findOpeningMovement(trade: any): Promise<any | null> {
  const gross = Number(trade.initial_quantity || trade.quantity) * Number(trade.entry_price)
  const { data } = must(await supabase
    .from('wallet_movements')
    .select('*')
    .eq('wallet_id', trade.portfolio_id)
    .eq('ticker', trade.ticker)
    .eq('movement_type', 'trade')
    .lt('amount', 0)
    .is('execution_id', null)
    .eq('date', dayKey(trade.open_date)))
  if (!data?.length) return null
  return [...data].sort((a: any, b: any) =>
    Math.abs(Number(a.amount) + gross) - Math.abs(Number(b.amount) + gross))[0]
}

function SortIcon({ col, sort }: { col: string; sort: { key: string; direction: 'asc' | 'desc' } }) {
  if (sort.key !== col) return <FaSort style={{ marginLeft: 4, opacity: 0.2 }} />
  return sort.direction === 'asc'
    ? <FaSortUp   style={{ marginLeft: 4, color: '#00bfff' }} />
    : <FaSortDown style={{ marginLeft: 4, color: '#00bfff' }} />
}

// Dato con etiqueta pequeña encima (tarjetas del celular)
const Metric = ({ label, children, align = 'left' }: { label: string; children: React.ReactNode; align?: 'left' | 'center' | 'right' }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, textAlign: align }}>
    <span style={{ fontSize: 9, color: '#666', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>{label}</span>
    <span style={{ fontSize: 13, fontWeight: 600 }}>{children}</span>
  </div>
)

export default function CerradosPage() {
  const { money, shares } = usePrivacy()
  const isMobile = useIsMobile()

  const [trades,            setTrades]            = useState<any[]>([])
  const [portfolios,        setPortfolios]        = useState<any[]>([])
  const [selectedPortfolio, setSelectedPortfolio] = useState('all')
  const [selectedYear,      setSelectedYear]      = useState(new Date().getFullYear().toString())
  const [filterMonth,       setFilterMonth]       = useState('all')
  const [filterTicker,      setFilterTicker]      = useState('')
  const [filterReason,      setFilterReason]      = useState('all')
  const [filterSector,      setFilterSector]      = useState('all')
  const [allDividends,      setAllDividends]      = useState<any[]>([])
  const [viewingTrade,      setViewingTrade]      = useState<any>(null)
  const [pageError,         setPageError]         = useState('')
  const [deletingId,        setDeletingId]        = useState<string | null>(null)
  const [sortConfig,        setSortConfig]        = useState<{ key: string; direction: 'asc' | 'desc' }>({
    key: 'close_date', direction: 'desc',
  })

  // ── Estado del modal de edición ───────────────────────────────────────────
  const [editingRow,  setEditingRow]  = useState<EditRow | null>(null)
  const [editValues,  setEditValues]  = useState({ date: '', quantity: '', price: '', commission: '' })
  const [editSaving,  setEditSaving]  = useState(false)
  const [editError,   setEditError]   = useState<string | null>(null)

  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  // Devuelve los trades cargados (el guardado los usa para refrescar el modal sin otra consulta)
  const fetchData = useCallback(async (): Promise<any[]> => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return []

      const [pData, tData, divData] = await Promise.all([
        fetchAll(() => supabase.from('portfolios').select('*').eq('user_id', user.id).order('id')),
        fetchAll(() => supabase.from('trades')
          .select('*, portfolios(name), trade_executions(*)')
          .eq('user_id', user.id)
          .eq('status', 'closed')
          .order('id')),
        // Dividendos con fecha y billetera, para repartirlos entre los trades del rango.
        // Mismo criterio que la página de inicio (is_dividend o movement_type = 'dividend').
        fetchAll(() => supabase.from('wallet_movements')
          .select('id, ticker, amount, date, wallet_id')
          .or('is_dividend.eq.true,movement_type.eq.dividend')
          .eq('user_id', user.id)
          .order('date')
          .order('id')),
      ])

      if (alive.current) {
        setPortfolios(pData)
        setTrades(tData)
        setAllDividends(divData)
        setPageError('')
      }
      return tData
    } catch (e: any) {
      if (alive.current) setPageError(`No se pudieron cargar los datos: ${e?.message || e}`)
      return []
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // ── Dividendos indexados por ticker (antes: recorrer todos los dividendos por cada trade y parsear fechas) ──
  const dividendsByTicker = useMemo(() => {
    const map = new Map<string, { key: string; amount: number; wallet: any }[]>()
    for (const d of allDividends) {
      const key = dayKey(d.date)
      if (!DAY_RE.test(key)) continue
      const list = map.get(d.ticker) || []
      list.push({ key, amount: Number(d.amount) || 0, wallet: d.wallet_id })
      map.set(d.ticker, list)
    }
    return map
  }, [allDividends])

  // Dividendos que caen dentro de las fechas del trade. Ahora también deben ser de SU billetera: antes, si tenías el
  // mismo ticker en dos portafolios al mismo tiempo, cada dividendo se sumaba a los dos trades.
  const getDividendsForTrade = useCallback((t: any) => {
    const list = dividendsByTicker.get(t.ticker)
    if (!list) return []
    const from = dayKey(t.open_date)
    const to   = dayKey(t.close_date || t.open_date)
    return list.filter(d => d.key >= from && d.key <= to && (!d.wallet || d.wallet === t.portfolio_id))
  }, [dividendsByTicker])

  const availableYears = useMemo(() => {
    const years = new Set(trades.map(t => yearOf(closeKeyOf(t))))
    years.add(new Date().getFullYear())
    return Array.from(years).filter(Number.isFinite).sort((a, b) => b - a)
  }, [trades])

  const availableMonths = useMemo(() => {
    const months = new Set(
      trades
        .filter(t => selectedYear === 'all' || String(yearOf(closeKeyOf(t))) === selectedYear)
        .map(t => String(monthOf(closeKeyOf(t))))
    )
    return Array.from(months).sort((a, b) => Number(a) - Number(b))
  }, [trades, selectedYear])

  const availableSectors = useMemo(() => {
    const sectors = new Set(trades.map(t => t.sector || 'Sin sector'))
    return Array.from(sectors).sort()
  }, [trades])

  // Razones del catálogo + las que existan en los datos (antes, una razón fuera del catálogo no se podía filtrar)
  const availableReasons = useMemo(() => {
    const reasons = new Set<string>(CLOSE_REASONS)
    trades.forEach(t => { if (t.close_reason) reasons.add(t.close_reason) })
    return Array.from(reasons)
  }, [trades])

  const handleSort = (key: string) => {
    setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc' }))
  }

  // ── Eliminar trade ────────────────────────────────────────────────────────
  // Las tablas dependen entre sí (movimientos → ejecuciones → trade), así que se borran en ese orden. Como no es una
  // sola transacción, se guarda lo borrado y, si un paso falla, se vuelve a insertar: antes un fallo a medias dejaba
  // el trade sin sus movimientos de billetera (y sin avisar, porque no se revisaban los errores).
  const handleDelete = async (trade: any) => {
    if (deletingId) return
    if (!confirm(`¿Eliminar trade de ${trade.ticker}? Se revertirán los movimientos de esta operación en la billetera.`)) return

    setDeletingId(trade.id)
    setPageError('')
    const undo: (() => PromiseLike<any>)[] = []

    try {
      const execs: any[] = trade.trade_executions || []
      const execIds = execs.map(e => e.id)

      // Movimientos vinculados a las ejecuciones (recompras, ventas, cierres) + el de apertura
      const linked = execIds.length
        ? (must(await supabase.from('wallet_movements').select('*').in('execution_id', execIds)).data || [])
        : []
      const opening = await findOpeningMovement(trade)
      const movements = opening ? [...linked, opening] : linked

      if (movements.length) {
        must(await supabase.from('wallet_movements').delete().in('id', movements.map((m: any) => m.id)))
        undo.push(() => supabase.from('wallet_movements').insert(movements))
      }
      if (execs.length) {
        must(await supabase.from('trade_executions').delete().eq('trade_id', trade.id))
        undo.push(() => supabase.from('trade_executions').insert(execs))
      }
      must(await supabase.from('trades').delete().eq('id', trade.id))

      if (viewingTrade?.id === trade.id) setViewingTrade(null)
    } catch (err: any) {
      for (const fn of undo.reverse()) { try { await fn() } catch { /* mejor esfuerzo */ } }
      setPageError(`No se pudo eliminar ${trade.ticker}: ${err?.message || err}. Se restauró lo que se alcanzó a borrar.`)
    } finally {
      setDeletingId(null)
      await fetchData()
    }
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
  // Cada escritura guarda su valor anterior; si algo falla se restaura todo (antes los errores no se revisaban y una
  // edición podía quedar a medias: ejecución cambiada pero billetera y PnL sin actualizar).
  const saveEdit = async () => {
    if (!editingRow || !viewingTrade || editSaving) return

    const newQty   = parseFloat(editValues.quantity)
    const newPrice = parseFloat(editValues.price)
    const newComm  = parseFloat(editValues.commission) || 0
    const newDate  = editValues.date

    if (!Number.isFinite(newQty) || !Number.isFinite(newPrice) || newQty <= 0 || newPrice <= 0) {
      setEditError('Cantidad y precio deben ser números positivos.')
      return
    }
    if (newComm < 0) { setEditError('La comisión no puede ser negativa.'); return }
    if (!DAY_RE.test(newDate)) { setEditError('Fecha inválida.'); return }

    setEditSaving(true)
    setEditError(null)
    const undo: (() => PromiseLike<any>)[] = []

    try {
      const trade = viewingTrade
      const execs: any[] = trade.trade_executions || []

      // ── APERTURA ──────────────────────────────────────────────────────────
      if (editingRow.kind === 'apertura') {
        const newGross = r6(newQty * newPrice)
        const movement = await findOpeningMovement(trade)
        const newPnL = calcTrade({ ...trade, entry_price: newPrice, initial_quantity: newQty }, execs).pnlCash

        const oldTrade = {
          entry_price: trade.entry_price, initial_quantity: trade.initial_quantity,
          open_date: trade.open_date, realized_pnl: trade.realized_pnl,
        }
        must(await supabase.from('trades').update({
          entry_price: newPrice, initial_quantity: newQty, open_date: newDate, realized_pnl: newPnL,
        }).eq('id', trade.id))
        undo.push(() => supabase.from('trades').update(oldTrade).eq('id', trade.id))

        if (movement) {
          must(await supabase.from('wallet_movements').update({ amount: -newGross, date: newDate }).eq('id', movement.id))
          undo.push(() => supabase.from('wallet_movements').update({ amount: movement.amount, date: movement.date }).eq('id', movement.id))
        }

      // ── RECOMPRA / VENTA PARCIAL / CIERRE ─────────────────────────────────
      } else if (editingRow.executionId) {
        const execId = editingRow.executionId
        const isBuy  = editingRow.kind === 'buy'
        const oldExec = execs.find(e => e.id === execId)
        if (!oldExec) throw new Error('No se encontró la ejecución a editar')

        // Recompra: sale dinero de la billetera. Venta/cierre: entra, menos comisión.
        const walletAmount = isBuy ? -(newQty * newPrice + newComm) : newQty * newPrice - newComm

        must(await supabase.from('trade_executions').update({
          quantity:    newQty,
          price:       newPrice,
          commission:  newComm,
          executed_at: newDate + 'T12:00:00',
          total:       newQty * newPrice,
        }).eq('id', execId))
        undo.push(() => supabase.from('trade_executions').update({
          quantity: oldExec.quantity, price: oldExec.price, commission: oldExec.commission,
          executed_at: oldExec.executed_at, total: oldExec.total,
        }).eq('id', execId))

        const { data: oldMovs } = must(await supabase
          .from('wallet_movements').select('id, amount, date').eq('execution_id', execId))
        must(await supabase.from('wallet_movements')
          .update({ amount: walletAmount, date: newDate })
          .eq('execution_id', execId))
        for (const m of oldMovs || []) {
          undo.push(() => supabase.from('wallet_movements').update({ amount: m.amount, date: m.date }).eq('id', m.id))
        }

        const updatedExecs = execs.map(e =>
          e.id === execId ? { ...e, quantity: newQty, price: newPrice, commission: newComm } : e)
        const tradeUpdate: Record<string, any> = { realized_pnl: calcTrade(trade, updatedExecs).pnlCash }
        // Si se corrige la fecha del cierre, la fecha de cierre del trade (la que usan la tabla y los filtros) la sigue
        if (editingRow.kind === 'close' && dayKey(trade.close_date) !== newDate) tradeUpdate.close_date = newDate

        const oldTradeFields: Record<string, any> = {}
        for (const k of Object.keys(tradeUpdate)) oldTradeFields[k] = trade[k]
        must(await supabase.from('trades').update(tradeUpdate).eq('id', trade.id))
        undo.push(() => supabase.from('trades').update(oldTradeFields).eq('id', trade.id))
      }

      // Refrescar datos y el modal con lo recién guardado
      const fresh = await fetchData()
      if (alive.current) {
        setViewingTrade(fresh.find((t: any) => t.id === trade.id) ?? null)
        setEditingRow(null)
      }

    } catch (err: any) {
      for (const fn of undo.reverse()) { try { await fn() } catch { /* mejor esfuerzo */ } }
      setEditError(`No se guardó: ${err?.message ?? 'error desconocido'}. Se restauraron los valores anteriores.`)
      console.error(err)
    } finally {
      if (alive.current) setEditSaving(false)
    }
  }

  const closeModal = () => {
    if (editSaving) return // no cerrar a mitad de un guardado
    setViewingTrade(null)
    setEditingRow(null)
  }

  // ── Filas de la tabla: filtro + cálculo + orden (el cálculo se hace una vez por trade, no en cada comparación) ──
  const rows = useMemo(() => {
    const tickerQ = filterTicker.toLowerCase()
    const list = trades
      .filter(t => {
        const key = closeKeyOf(t)
        if (selectedPortfolio !== 'all' && t.portfolio_id !== selectedPortfolio) return false
        if (selectedYear !== 'all' && String(yearOf(key)) !== selectedYear) return false
        if (filterMonth !== 'all' && String(monthOf(key)) !== filterMonth) return false
        if (tickerQ && !String(t.ticker).toLowerCase().includes(tickerQ)) return false
        if (filterReason !== 'all' && (t.close_reason || '') !== filterReason) return false
        if (filterSector !== 'all' && (t.sector || 'Sin sector') !== filterSector) return false
        return true
      })
      .map(t => {
        const d = calcTrade(t)
        const divTotal = getDividendsForTrade(t).reduce((a, dv) => a + dv.amount, 0)
        const totalWithDiv = d.pnlCash + divTotal
        return {
          t, ...d, divTotal, totalWithDiv,
          pctWithDiv: d.totalInvested > 0 ? (totalWithDiv / d.totalInvested) * 100 : 0,
          openKey: dayKey(t.open_date), closeKey: closeKeyOf(t),
        }
      })

    // La tabla muestra PnL $ y PnL % CON dividendos: el orden ahora usa esos mismos valores
    const sortValue = (r: (typeof list)[number]): string | number => {
      switch (sortConfig.key) {
        case 'ticker':     return String(r.t.ticker || '')
        case 'sector':     return String(r.t.sector || '')
        case 'open_date':  return r.openKey
        case 'close_date': return r.closeKey
        case 'diffDays':   return r.diffDays
        case 'annualPct':  return r.annualPct
        case 'pnlCash':    return r.totalWithDiv
        case 'pnlPct':     return r.pctWithDiv
        default:           return 0
      }
    }
    const dir = sortConfig.direction === 'asc' ? 1 : -1
    return list.sort((a, b) => {
      const v1 = sortValue(a), v2 = sortValue(b)
      if (typeof v1 === 'string' && typeof v2 === 'string') return v1.localeCompare(v2) * dir
      return ((v1 as number) - (v2 as number)) * dir
    })
  }, [trades, selectedPortfolio, selectedYear, filterMonth, filterTicker, filterReason, filterSector, sortConfig, getDividendsForTrade])

  const summary = useMemo(() => {
    const total    = rows.length
    const winners  = rows.filter(r => r.pnlCash > 0).length
    const totalPnl = rows.reduce((a, r) => a + r.pnlCash, 0)
    const totalInv = rows.reduce((a, r) => a + r.totalInvested, 0)
    const totalSell = rows.reduce((a, r) => a + r.totalSells, 0)
    const totalDividends = rows.reduce((a, r) => a + r.divTotal, 0)
    return {
      total, winners,
      winRate: total > 0 ? (winners / total) * 100 : 0,
      totalPnl, totalInv, totalSell, totalDividends,
      totalPnlWithDividends: totalPnl + totalDividends,
      // Retorno sobre lo invertido en el filtro actual (no es anualizado; antes se llamaba "Rend. anual")
      totalReturn: totalInv > 0 ? r2((totalPnl / totalInv) * 100) : 0,
    }
  }, [rows])

  // ── Filas del historial del trade abierto en el modal (apertura + ejecuciones + dividendos) ──
  const historyRows = useMemo<HistRow[]>(() => {
    if (!viewingTrade) return []
    const t = viewingTrade
    const gross = Number(t.initial_quantity || t.quantity) * Number(t.entry_price)

    const apertura: HistRow = {
      key: 'apertura', kind: 'apertura', executionId: null,
      date: dayKey(t.open_date),
      quantity: Number(t.initial_quantity || t.quantity),
      price: Number(t.entry_price),
      commission: 0,
      net: -gross,
    }

    const execRows: (HistRow & { created: string })[] = (t.trade_executions || []).map((ex: any) => {
      const type  = execType(ex)
      const isBuy = type === 'buy'
      const comm  = Number(ex.commission || 0)
      const g     = Number(ex.quantity) * Number(ex.price)
      return {
        key: ex.id,
        kind: (isBuy ? 'buy' : type === 'close' ? 'close' : 'sell') as HistKind,
        executionId: ex.id,
        date: dayKey(ex.executed_at),
        quantity: Number(ex.quantity),
        price: Number(ex.price),
        commission: comm,
        net: isBuy ? -(g + comm) : g - comm,
        created: String(ex.created_at || ''),
      }
    })

    const divRows: (HistRow & { created: string })[] = getDividendsForTrade(t).map((dv, i) => ({
      key: `div-${i}`, kind: 'div' as HistKind, executionId: null,
      date: dv.key, quantity: 0, price: 0, commission: 0, net: dv.amount, created: '',
    }))

    // Por fecha; el mismo día, por orden de creación (antes el orden entre ejecuciones del mismo día era arbitrario)
    const rest = [...execRows, ...divRows].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : a.created.localeCompare(b.created))

    return [apertura, ...rest]
  }, [viewingTrade, getDividendsForTrade])

  const viewingSummary = useMemo(() => {
    if (!viewingTrade) return null
    const d = calcTrade(viewingTrade)
    const divTotal = getDividendsForTrade(viewingTrade).reduce((a, dv) => a + dv.amount, 0)
    return { ...d, totalWithDiv: d.pnlCash + divTotal }
  }, [viewingTrade, getDividendsForTrade])

  const editField = (field: 'date' | 'quantity' | 'price' | 'commission') =>
    (e: React.ChangeEvent<HTMLInputElement>) => setEditValues(p => ({ ...p, [field]: e.target.value }))

  // Datos de la fila de historial que se pasa a openEdit (igual en tabla y en tarjeta)
  const startEdit = (r: HistRow) => openEdit({
    kind: r.kind as EditRow['kind'], executionId: r.executionId,
    date: r.date, quantity: r.quantity, price: r.price, commission: r.commission,
  })

  const isEditingRow = (r: HistRow) => !!editingRow && (r.kind === 'apertura'
    ? editingRow.kind === 'apertura'
    : editingRow.executionId === r.executionId)

  const pnlColor = (v: number) => (v >= 0 ? '#22c55e' : '#f43f5e')

  const headerCards = [
    { label: 'Trades',      value: summary.total,                    color: '#fff' },
    { label: 'Win rate',    value: `${summary.winRate.toFixed(1)}%`, color: summary.winRate >= 50 ? '#22c55e' : '#f43f5e' },
    { label: 'Invertido',   value: money(summary.totalInv),          color: '#aaa' },
    { label: 'Recuperado',  value: money(summary.totalSell),         color: '#aaa' },
    { label: 'PnL total',   value: money(summary.totalPnl),          color: summary.totalPnl >= 0 ? '#22c55e' : '#f43f5e' },
    { label: 'P/T + dividendos', value: money(summary.totalPnlWithDividends), color: summary.totalPnlWithDividends >= 0 ? '#22c55e' : '#f43f5e' },
    { label: 'Rend. total', value: `${summary.totalReturn >= 0 ? '+' : ''}${summary.totalReturn.toFixed(2)}%`, color: summary.totalReturn >= 0 ? '#22c55e' : '#f43f5e' },
  ]

  return (
    <AppShell>
      <div style={{ padding: isMobile ? '0 2px' : '0 30px', color: 'white', position: 'relative' }}>

        {/* ── Decoraciones gato ── */}
        {!isMobile && (
          <>
            <div style={{ position: 'absolute', top: -2, right: 60, pointerEvents: 'none' }}>
              <CatEars color="#22c55e" opacity={0.12} size={44} />
            </div>
            <div style={{ position: 'absolute', right: -6, top: '35%', pointerEvents: 'none' }}>
              <CatTail color="#22c55e" opacity={0.08} />
            </div>
            <div style={{ position: 'absolute', top: 16, right: 110, pointerEvents: 'none', display: 'flex', flexDirection: 'column', gap: 18, transform: 'rotate(-12deg)' }}>
              {[14, 11, 8, 6].map((s, i) => <Paw key={i} size={s} color="#22c55e" opacity={0.06 - i * 0.01} rotate={i * 8} />)}
            </div>
          </>
        )}

        {/* ── HEADER ── */}
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: isMobile ? 'stretch' : 'flex-start', margin: isMobile ? '8px 0 12px' : '20px 0 16px', flexWrap: 'wrap', gap: 12 }}>
          <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Paw size={22} color="#22c55e" opacity={0.7} />
            {!isMobile && <Paw size={16} color="#22c55e" opacity={0.4} />}
            <History size={22} color="#22c55e" />
            Trades cerrados
          </h1>

          <div style={isMobile
            ? { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }
            : { display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {headerCards.map(c => (
              <div key={c.label} style={{ ...summaryCard, minWidth: 0 }}>
                <span style={summaryLabel}>{c.label}</span>
                <span style={{ fontSize: 15, fontWeight: 700, color: c.color }}>{c.value}</span>
              </div>
            ))}
          </div>
        </div>

        {pageError && (
          <div style={{
            marginBottom: 14, padding: '10px 14px', borderRadius: 10, fontSize: 12,
            background: 'rgba(244,63,94,0.06)', border: '1px solid rgba(244,63,94,0.25)', color: '#f43f5e',
          }}>
            {pageError}
          </div>
        )}

        {/* ── TABS PORTAFOLIOS ── */}
        <div style={walletNav}>
          {[{ id: 'all', name: 'Todos' }, ...portfolios].map(p => (
            <button key={p.id} onClick={() => setSelectedPortfolio(p.id)}
              style={{ ...walletTab(selectedPortfolio === p.id), ...(isMobile ? { padding: '8px 14px', fontSize: 12, flexShrink: 0 } : {}) }}>
              {p.name}
            </button>
          ))}
        </div>

        {/* ── FILTROS ── */}
        <div style={isMobile
          ? { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, marginBottom: 12 }
          : { display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          {(() => {
            const sel: React.CSSProperties = isMobile
              ? { ...selectStyle, width: '100%', minWidth: 0, padding: '10px 10px', fontSize: 13 }
              : selectStyle
            return (
              <>
                <select value={selectedYear} onChange={e => { setSelectedYear(e.target.value); setFilterMonth('all') }} style={sel}>
                  <option value="all">Todos los años</option>
                  {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)} style={sel}>
                  <option value="all">Todos los meses</option>
                  {availableMonths.map(mo => (
                    <option key={mo} value={mo}>{MESES[Number(mo) - 1]}</option>
                  ))}
                </select>
                <select value={filterReason} onChange={e => setFilterReason(e.target.value)} style={sel}>
                  <option value="all">Todas las razones</option>
                  {availableReasons.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                <select value={filterSector} onChange={e => setFilterSector(e.target.value)} style={sel}>
                  <option value="all">Todos los sectores</option>
                  {availableSectors.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <input placeholder="Buscar ticker..." value={filterTicker}
                  onChange={e => setFilterTicker(e.target.value.toUpperCase())}
                  style={isMobile
                    ? { ...sel, gridColumn: '1 / -1', boxSizing: 'border-box', fontSize: 14, fontWeight: 700 }
                    : { ...selectStyle, minWidth: 140 }} />
                <span style={{ fontSize: 10, color: '#aaa', ...(isMobile ? { gridColumn: '1 / -1' } : {}) }}>{rows.length} resultado(s)</span>
              </>
            )
          })()}
        </div>

        {isMobile ? (
          <>
            {/* ── ORDENAR (en la tabla se ordena tocando el encabezado de cada columna) ── */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <select
                value={sortConfig.key}
                onChange={e => setSortConfig(prev => ({ ...prev, key: e.target.value }))}
                aria-label="Ordenar por"
                style={{ ...selectStyle, flex: 1, minWidth: 0, padding: '10px 10px', fontSize: 13 }}>
                {SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>Ordenar: {o.label}</option>)}
              </select>
              <button
                onClick={() => setSortConfig(prev => ({ ...prev, direction: prev.direction === 'asc' ? 'desc' : 'asc' }))}
                style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #1a1a1a', background: '#0a0a0a', color: '#00bfff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                {sortConfig.direction === 'asc' ? '↑ Asc' : '↓ Desc'}
              </button>
            </div>

            {/* ── TARJETAS ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
              {rows.length === 0 && (
                <div style={{ padding: 40, textAlign: 'center', color: '#666', background: '#0a0a0a', borderRadius: 12, border: '1px solid #1a1a1a' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                    <Paw size={30} color="#444" opacity={0.5} />
                    No hay trades cerrados para este filtro.
                  </div>
                </div>
              )}

              {rows.map(r => {
                const t = r.t
                return (
                  <div key={t.id} style={{
                    background: '#080808', border: '1px solid #1a1a1a', borderRadius: 12, padding: '10px 12px',
                    opacity: deletingId === t.id ? 0.4 : 1,
                  }}>
                    {/* Ticker, razón y resultado */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 900, fontSize: 17, color: '#00bfff' }}>{t.ticker}</div>
                        <div style={{ fontSize: 10, color: '#777', marginTop: 2 }}>
                          {t.open_date ? fmtDay(t.open_date) : '—'} → {t.close_date ? fmtDay(t.close_date) : '—'} · {r.diffDays} d
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 19, fontWeight: 900, lineHeight: 1.1, color: pnlColor(r.pctWithDiv) }}>
                          {`${r.pctWithDiv >= 0 ? '+' : ''}${r.pctWithDiv.toFixed(2)}%`}
                        </div>
                        <div style={{ fontSize: 12, color: pnlColor(r.totalWithDiv) }}>{money(r.totalWithDiv)}</div>
                      </div>
                    </div>

                    {/* Razón de cierre y sector */}
                    {(t.close_reason || t.sector) && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                        {t.close_reason && <span style={chip}>{t.close_reason}</span>}
                        {t.sector && <span style={{ ...chip, color: '#888' }}>{t.sector}</span>}
                      </div>
                    )}

                    {/* Dinero */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, marginBottom: 8 }}>
                      <Metric label="Invertido">{money(r.totalInvested)}</Metric>
                      <Metric label="Recuperado">{money(r.totalSells)}</Metric>
                      <Metric label="Dividendos">
                        {r.divTotal > 0 ? <span style={{ color: '#eab308' }}>{money(r.divTotal)}</span> : <span style={{ color: '#444' }}>—</span>}
                      </Metric>
                      <Metric label="Anual %">
                        <span style={{ color: pnlColor(r.annualPct) }}>
                          {r.annualPct > 500 ? '>500' : `${r.annualPct >= 0 ? '+' : ''}${r.annualPct.toFixed(1)}`}%
                        </span>
                      </Metric>
                    </div>

                    {/* Acciones */}
                    <div style={{ display: 'flex', gap: 8, paddingTop: 8, borderTop: '1px solid #151515' }}>
                      <button onClick={() => setViewingTrade(t)}
                        style={{ flex: 1, padding: '10px 12px', borderRadius: 8, border: '1px solid #1f2a33', background: 'rgba(0,191,255,0.06)', color: '#00bfff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                        Historial
                      </button>
                      <button onClick={() => handleDelete(t)} disabled={!!deletingId} aria-label="Eliminar" title="Eliminar"
                        style={{ ...iconBtn, padding: 12, border: '1px solid #1a1a1a', borderRadius: 8, color: '#666', opacity: deletingId === t.id ? 0.4 : 1 }}>
                        <Trash2 size={17} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        ) : (
          /* ── TABLA ── */
          <div style={tableWrapper}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#0a0a0a' }}>
                  {[
                    { key: 'ticker',     label: 'Ticker' },
                    { key: 'open_date',  label: 'Apertura' },
                    { key: 'close_date', label: 'Cierre' },
                    { key: 'diffDays',   label: 'Días' },
                    { key: null,         label: 'Razón de cierre' },
                    { key: 'sector',     label: 'Sector' },
                    { key: null,         label: 'Invertido' },
                    { key: null,         label: 'Recuperado' },
                    { key: null,         label: 'Dividendos' },
                    { key: 'pnlCash',    label: 'PnL $' },
                    { key: 'pnlPct',     label: 'PnL %' },
                    { key: 'annualPct',  label: 'Anual %' },
                    { key: null,         label: 'Acciones' },
                  ].map(({ key, label }) => (
                    <th key={label} style={{ ...thStyle, cursor: key ? 'pointer' : 'default' }}
                      onClick={key ? () => handleSort(key) : undefined}>
                      <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                        {label} {key && <SortIcon col={key} sort={sortConfig} />}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={13} style={{ padding: 40, textAlign: 'center', color: '#666' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                        <Paw size={30} color="#444" opacity={0.5} />
                        No hay trades cerrados para este filtro.
                      </div>
                    </td>
                  </tr>
                )}
                {rows.map(r => {
                  const t = r.t
                  return (
                    <tr key={t.id} style={trStyle}>
                      <td style={{ ...tdStyle, fontWeight: 'bold', color: '#00bfff' }}>{t.ticker}</td>
                      <td style={{ ...tdStyle, color: '#aaa', fontSize: 11 }}>{t.open_date ? fmtDay(t.open_date) : '—'}</td>
                      <td style={{ ...tdStyle, color: '#aaa', fontSize: 11 }}>{t.close_date ? fmtDay(t.close_date) : '—'}</td>
                      <td style={{ ...tdStyle, textAlign: 'center', color: '#aaa' }}>{r.diffDays}</td>
                      <td style={{ ...tdStyle, fontSize: 11, color: '#bbb' }}>
                        {t.close_reason || <span style={{ color: '#555' }}>—</span>}
                      </td>
                      <td style={{ ...tdStyle, fontSize: 11, color: '#bbb' }}>
                        {t.sector || <span style={{ color: '#555' }}>—</span>}
                      </td>
                      <td style={{ ...tdStyle, color: '#ccc' }}>{money(r.totalInvested)}</td>
                      <td style={{ ...tdStyle, color: '#ccc' }}>{money(r.totalSells)}</td>
                      <td style={{ ...tdStyle, color: '#eab308', fontWeight: 'bold' }}>
                        {r.divTotal > 0 ? money(r.divTotal) : <span style={{ color: '#333' }}>—</span>}
                      </td>
                      <td style={{ ...tdStyle, fontWeight: 'bold' }}>
                        <span style={{ color: r.totalWithDiv >= 0 ? '#22c55e' : '#f43f5e' }}>{money(r.totalWithDiv)}</span>
                      </td>
                      <td style={tdStyle}>
                        <span style={{ color: r.pctWithDiv >= 0 ? '#22c55e' : '#f43f5e' }}>
                          {`${r.pctWithDiv >= 0 ? '+' : ''}${r.pctWithDiv.toFixed(2)}%`}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, color: r.annualPct >= 0 ? '#22c55e' : '#f43f5e' }}>
                        {r.annualPct > 500 ? '>500' : `${r.annualPct >= 0 ? '+' : ''}${r.annualPct.toFixed(1)}`}%
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                          <button onClick={() => setViewingTrade(t)} style={actionBtn('#00bfff')}
                            title="Historial"
                            onMouseEnter={e => (e.currentTarget.style.color = '#00bfff')}
                            onMouseLeave={e => (e.currentTarget.style.color = '#777')}>
                            Historial
                          </button>
                          <button onClick={() => handleDelete(t)} style={{ ...iconBtn, opacity: deletingId === t.id ? 0.4 : 1 }}
                            title="Eliminar" disabled={!!deletingId}
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
        )}

        <div style={{ marginTop: 8, fontSize: 9, color: '#555', textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 5 }}>
          <Paw size={9} color="#444" opacity={0.5} />
          {rows.length} trades · PnL considera comisiones de cada ejecución
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            MODAL HISTORIAL + EDICIÓN
        ════════════════════════════════════════════════════════════════════ */}
        {viewingTrade && (
          <div style={overlayStyle} onClick={closeModal}>
            <div style={isMobile ? modalStyleMobile : modalStyle} onClick={e => e.stopPropagation()}>

              {/* Header del modal */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <Paw size={14} color="#00bfff" opacity={0.6} />
                  <h2 style={{ margin: 0, fontSize: 16 }}>
                    Historial: <span style={{ color: '#00bfff' }}>{viewingTrade.ticker}</span>
                  </h2>
                  {viewingTrade.sector && (
                    <span style={{ fontSize: 11, color: '#777', marginLeft: 4 }}>{viewingTrade.sector}</span>
                  )}
                </div>
                <button onClick={closeModal} aria-label="Cerrar"
                  style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: isMobile ? 8 : 0 }}>
                  <X size={isMobile ? 22 : 18} />
                </button>
              </div>

              {/* Aviso de edición */}
              <div style={{
                background: 'rgba(234,179,8,0.06)', border: '1px solid rgba(234,179,8,0.2)',
                borderRadius: 8, padding: '8px 12px', marginBottom: 14,
                display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: '#c8a800',
              }}>
                <AlertTriangle size={12} style={{ flexShrink: 0 }} />
                Haz clic en el lápiz de cualquier fila para corregir un error. Los cambios actualizan automáticamente precio, cantidad, comisión y billetera.
              </div>

              {isMobile ? (
                /* Historial en tarjetas (celular) */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {historyRows.map(r => {
                    const meta = HIST_LABEL[r.kind]

                    // Dividendos: solo lectura
                    if (r.kind === 'div') {
                      return (
                        <div key={r.key} style={{ ...histCard, background: 'rgba(234,179,8,0.04)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                              <div style={{ color: meta.color, fontWeight: 700, fontSize: 13 }}>{meta.label}</div>
                              <div style={{ fontSize: 11, color: '#777' }}>{fmtDay(r.date, 'numeric')}</div>
                            </div>
                            <div style={{ color: '#eab308', fontWeight: 700 }}>+{money(r.net)}</div>
                          </div>
                        </div>
                      )
                    }

                    const isEditing = isEditingRow(r)
                    const netColor = r.kind === 'apertura' || r.net < 0 ? '#f43f5e' : '#22c55e'

                    return (
                      <div key={r.key} style={{ ...histCard, background: isEditing ? 'rgba(0,191,255,0.04)' : '#050505' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ color: meta.color, fontWeight: 700, fontSize: 13 }}>{meta.label}</div>
                            {!isEditing && <div style={{ fontSize: 11, color: '#777' }}>{fmtDay(r.date, 'numeric')}</div>}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <div style={{ color: netColor, fontWeight: 700, fontSize: 14 }}>
                              {r.net >= 0 ? '+' : ''}{money(r.net)}
                            </div>
                            {!isEditing && <EditPencil big onClick={() => startEdit(r)} />}
                          </div>
                        </div>

                        {!isEditing && (
                          <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>
                            {shares(r.quantity)} × {money(r.price)}
                            {r.kind !== 'apertura' && r.commission > 0 && (
                              <span style={{ color: '#777' }}> · comisión {money(r.commission)}</span>
                            )}
                          </div>
                        )}

                        {isEditing && (
                          <div style={{ marginTop: 10 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                              <label style={editLabel}>Fecha
                                <input type="date" value={editValues.date} onChange={editField('date')} style={editInpMobile} />
                              </label>
                              <label style={editLabel}>Cantidad
                                <input type="number" inputMode="decimal" min="0" step="any" value={editValues.quantity} onChange={editField('quantity')} style={editInpMobile} />
                              </label>
                              <label style={editLabel}>Precio
                                <input type="number" inputMode="decimal" min="0" step="any" value={editValues.price} onChange={editField('price')} style={editInpMobile} />
                              </label>
                              {r.kind !== 'apertura' && (
                                <label style={editLabel}>Comisión
                                  <input type="number" inputMode="decimal" min="0" step="any" value={editValues.commission} onChange={editField('commission')} style={editInpMobile} />
                                </label>
                              )}
                            </div>
                            <div style={{ marginTop: 10 }}>
                              <EditActions big onSave={saveEdit} onCancel={() => setEditingRow(null)} saving={editSaving} />
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                /* Tabla de ejecuciones (escritorio) */
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
                      {historyRows.map(r => {
                        const meta = HIST_LABEL[r.kind]

                        // Dividendos: solo lectura
                        if (r.kind === 'div') {
                          return (
                            <tr key={r.key} style={{ ...trStyle, background: 'rgba(234,179,8,0.04)' }}>
                              <td style={modalTd}>{fmtDay(r.date, 'numeric')}</td>
                              <td style={{ ...modalTd, color: meta.color, fontWeight: 700 }}>{meta.label}</td>
                              <td style={{ ...modalTd, color: '#555' }}>—</td>
                              <td style={{ ...modalTd, color: '#555' }}>—</td>
                              <td style={{ ...modalTd, color: '#555' }}>—</td>
                              <td style={{ ...modalTd, color: '#eab308', fontWeight: 600 }}>+{money(r.net)}</td>
                              <td style={modalTd} />
                            </tr>
                          )
                        }

                        const isEditing = isEditingRow(r)
                        const netColor = r.kind === 'apertura' || r.net < 0 ? '#f43f5e' : '#22c55e'

                        return (
                          <tr key={r.key} style={{ ...trStyle, background: isEditing ? 'rgba(0,191,255,0.04)' : 'transparent' }}>
                            <td style={modalTd}>{isEditing
                              ? <input type="date" value={editValues.date} onChange={editField('date')} style={editInp} />
                              : fmtDay(r.date, 'numeric')
                            }</td>
                            <td style={{ ...modalTd, color: meta.color, fontWeight: 700 }}>{meta.label}</td>
                            <td style={modalTd}>{isEditing
                              ? <input type="number" min="0" step="any" value={editValues.quantity} onChange={editField('quantity')} style={{ ...editInp, width: 80 }} />
                              : shares(r.quantity)
                            }</td>
                            <td style={modalTd}>{isEditing
                              ? <input type="number" min="0" step="any" value={editValues.price} onChange={editField('price')} style={{ ...editInp, width: 90 }} />
                              : money(r.price)
                            }</td>
                            <td style={{ ...modalTd, color: r.kind === 'apertura' ? '#666' : '#aaa' }}>
                              {r.kind === 'apertura'
                                ? '—'
                                : isEditing
                                  ? <input type="number" min="0" step="any" value={editValues.commission} onChange={editField('commission')} style={{ ...editInp, width: 80 }} />
                                  : r.commission > 0 ? money(r.commission) : '—'
                              }
                            </td>
                            <td style={{ ...modalTd, color: netColor, fontWeight: 600 }}>
                              {r.net >= 0 ? '+' : ''}{money(r.net)}
                            </td>
                            <td style={modalTd}>
                              {isEditing
                                ? <EditActions onSave={saveEdit} onCancel={() => setEditingRow(null)} saving={editSaving} />
                                : <EditPencil onClick={() => startEdit(r)} />
                              }
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Error de edición (antes se guardaba el mensaje pero nunca se mostraba) */}
              {editError && (
                <div style={{
                  marginTop: 12, padding: '8px 12px', borderRadius: 8, fontSize: 11, color: '#f43f5e',
                  background: 'rgba(244,63,94,0.06)', border: '1px solid rgba(244,63,94,0.25)',
                }}>
                  {editError}
                </div>
              )}

              {/* Resumen del trade */}
              {viewingSummary && (
                <div style={{ display: 'flex', gap: isMobile ? 10 : 14, marginTop: 16, padding: '12px 14px', background: '#000', borderRadius: 10, flexWrap: 'wrap', justifyContent: isMobile ? 'space-between' : 'flex-start', borderTop: '1px solid #111' }}>
                  {[
                    { label: 'Invertido',  value: money(viewingSummary.totalInvested), color: '#aaa' },
                    { label: 'Recuperado', value: money(viewingSummary.totalSells),    color: '#aaa' },
                    { label: 'PnL (+ dividendos)', value: money(viewingSummary.totalWithDiv), color: viewingSummary.totalWithDiv >= 0 ? '#22c55e' : '#f43f5e' },
                    { label: 'PnL %',      value: `${viewingSummary.pnlPct >= 0 ? '+' : ''}${viewingSummary.pnlPct.toFixed(2)}%`, color: viewingSummary.pnlPct >= 0 ? '#22c55e' : '#f43f5e' },
                    { label: 'Duración',   value: `${viewingSummary.diffDays} días`,   color: '#aaa' },
                  ].map(item => (
                    <div key={item.label} style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 9, color: '#666', fontWeight: 700, letterSpacing: 0.5, marginBottom: 4 }}>{item.label}</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: item.color }}>{item.value}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </AppShell>
  )
}

// ── Botón lápiz ───────────────────────────────────────────────────────────────
function EditPencil({ onClick, big }: { onClick: () => void; big?: boolean }) {
  return (
    <button onClick={onClick} title="Editar este registro" aria-label="Editar este registro"
      style={{ background: 'none', border: 'none', cursor: 'pointer', color: big ? '#777' : '#444', padding: big ? 10 : 4, transition: 'color 0.2s', display: 'flex', alignItems: 'center' }}
      onMouseEnter={e => (e.currentTarget.style.color = '#eab308')}
      onMouseLeave={e => (e.currentTarget.style.color = big ? '#777' : '#444')}>
      <Pencil size={big ? 16 : 13} />
    </button>
  )
}

// ── Botones guardar / cancelar edición ────────────────────────────────────────
function EditActions({ onSave, onCancel, saving, big }: { onSave: () => void; onCancel: () => void; saving: boolean; big?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: big ? 8 : 6, alignItems: 'center' }}>
      <button onClick={onSave} disabled={saving}
        style={{ flex: big ? 1 : undefined, justifyContent: big ? 'center' : undefined, background: saving ? '#111' : 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.4)', color: '#22c55e', borderRadius: 5, padding: big ? '10px 14px' : '3px 8px', cursor: 'pointer', fontSize: big ? 13 : 10, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
        <Check size={big ? 14 : 11} /> {saving ? '...' : 'OK'}
      </button>
      <button onClick={onCancel} disabled={saving} aria-label="Cancelar"
        style={{ background: 'none', border: '1px solid #222', color: '#666', borderRadius: 5, padding: big ? '10px 14px' : '3px 8px', cursor: 'pointer', fontSize: 10, display: 'flex', alignItems: 'center' }}>
        <X size={big ? 14 : 11} />
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
const actionBtn = (_hoverColor: string): React.CSSProperties => ({ background: 'none', border: '1px solid #1a1a1a', color: '#777', padding: '3px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 10, fontWeight: 'bold', transition: 'color 0.2s' })
const iconBtn: React.CSSProperties      = { background: 'none', border: 'none', color: '#444', cursor: 'pointer', transition: 'color 0.2s', padding: 4, display: 'flex', alignItems: 'center' }
const overlayStyle: React.CSSProperties = { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.9)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }
const modalStyle: React.CSSProperties   = { background: '#0a0a0a', padding: 24, borderRadius: 16, width: '92%', maxWidth: 720, border: '1px solid #1a1a1a', maxHeight: '90vh', overflowY: 'auto' }
// En el celular el modal ocupa casi toda la pantalla y se desplaza por dentro
const modalStyleMobile: React.CSSProperties = { background: '#0a0a0a', padding: 14, borderRadius: 14, width: '96%', maxWidth: 720, border: '1px solid #1a1a1a', maxHeight: '92dvh', overflowY: 'auto', boxSizing: 'border-box' }
const modalTh: React.CSSProperties      = { padding: '8px 10px', textAlign: 'left', fontSize: 9, color: '#888', fontWeight: 700, letterSpacing: 0.5, borderBottom: '1px solid #1a1a1a' }
const modalTd: React.CSSProperties      = { padding: '9px 10px', fontSize: 12, color: '#ccc' }
const editInp: React.CSSProperties      = { background: '#050505', border: '1px solid #333', color: '#fff', padding: '3px 7px', borderRadius: 5, outline: 'none', fontSize: 11, width: 110 }
const editInpMobile: React.CSSProperties = { background: '#050505', border: '1px solid #333', color: '#fff', padding: '9px 10px', borderRadius: 8, outline: 'none', fontSize: 14, width: '100%', boxSizing: 'border-box' }
const editLabel: React.CSSProperties    = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 9, color: '#777', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }
const histCard: React.CSSProperties     = { border: '1px solid #1a1a1a', borderRadius: 10, padding: '10px 12px' }
const chip: React.CSSProperties         = { fontSize: 10, color: '#bbb', background: '#101010', border: '1px solid #1a1a1a', borderRadius: 999, padding: '2px 8px' }