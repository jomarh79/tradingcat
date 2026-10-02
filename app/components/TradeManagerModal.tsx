"use client"

import { useState, useEffect, useMemo } from "react"
import { supabase } from "@/lib/supabase"
import { usePrivacy } from "@/lib/PrivacyContext"
import { Trash2, Pencil, X, ChevronRight } from "lucide-react"
import AiInsightPanel from "./AiInsightPanel"

// ── Helpers ──────────────────────────────────────────────────────────────────
const r2 = (n: number) => Math.round(n * 100) / 100 + 0
const r4 = (n: number) => Math.round(n * 10000) / 10000 + 0
const r6 = (n: number) => Math.round(n * 1000000) / 1000000 + 0

const dayKey    = (d: any) => String(d || '').split('T')[0]
const parseDate = (d: any) => new Date(dayKey(d) + 'T00:00:00')
const todayLocal = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' })

// Supabase devuelve { error } en vez de lanzar: lo convertimos en excepción
function must<T>(res: { data: T; error: any }): T {
  if (res.error) throw res.error
  return res.data
}
const errMsg = (e: any) => e?.message || String(e)

// Valor de un input de stop/TP → número o null
const toTarget = (v: string) => {
  const n = parseFloat(v)
  return n > 0 ? r4(n) : null
}

// Cache de tipo de cambio por fecha (USD → MXN)
const fxCache: Record<string, string> = {}

const CLOSE_REASONS = [
  'Take Profit',
  'Stop loss',
  'Decisión manual',
  'Sentimiento del mercado',
  'Rompió estructura',
  'Cambio de tesis',
  'Necesidad de liquidez',
  'Error de análisis',
  'Rebote',
  'Otro',
]

// ── Lógica de posición (una sola fuente de verdad) ───────────────────────────
type ExType = 'buy' | 'sell' | 'close'
interface Calc { qty: number; cap: number; pnl: number }

// Aplica una ejecución sobre el estado de la posición.
// Se usa tanto para la vista previa (pendientes) como para recalcular desde la BD.
function applyExecution(s: Calc, type: ExType, q: number, price: number, comm: number): Calc {
  const gross = r2(q * price)
  if (type === 'buy') {
    return { qty: r6(s.qty + q), cap: r2(s.cap + gross + comm), pnl: s.pnl }
  }
  const avgM  = s.qty > 0 ? s.cap / s.qty : 0
  const cost  = r2(q * avgM)
  const netIn = r2(gross - comm)
  const qty   = r6(s.qty - q)
  if (qty <= 0) return { qty: 0, cap: 0, pnl: r2(s.pnl + netIn - cost) }
  return { qty, cap: r2(s.cap - cost), pnl: r2(s.pnl + netIn - cost) }
}

// Verifica que ninguna venta deje la posición en negativo
function isValidSequence(base: Calc, moves: PendingMove[]): boolean {
  let s = base
  for (const m of moves) {
    if (m.exType !== 'buy' && m.q > s.qty + 1e-9) return false
    s = applyExecution(s, m.exType, m.q, m.pr, m.commission)
  }
  return true
}

function computeFromExecutions(t: any, ex: any[]): Calc {
  const q0 = r6(Number(t.initial_quantity ?? t.quantity) || 0)
  const p0 = Number(t.initial_entry_price ?? t.entry_price) || 0
  let s: Calc = { qty: q0, cap: r2(q0 * p0), pnl: 0 }
  for (const e of ex) {
    const type: ExType = e.execution_type === 'buy' ? 'buy' : e.execution_type === 'sell' ? 'sell' : 'close'
    s = applyExecution(s, type, r6(Number(e.quantity)), r4(Number(e.price)), r2(Number(e.commission || 0)))
  }
  return s
}

interface PendingMove {
  type: string            // "Recompra (USD)" — se guarda en notes de wallet_movements
  amount: number          // efecto en la billetera (USD)
  gross: number
  commission: number
  date: string
  q: number
  pr: number              // precio en USD
  exType: ExType
  tc: number
  closeReason?: string
}

interface HistoryItem {
  id: string
  date: string
  actions: number
  price: number
  commission: number
  total: number           // neto: compra = bruto + comisión, venta = bruto − comisión
  type: string
  exType: 'open' | ExType
  seq: number             // desempate dentro del mismo día
}

interface TradeManagerModalProps {
  trade: any
  onClose: () => void
  onRefresh: () => void | Promise<void>
}

// Huella de gato SVG pequeña
const Paw = ({ color = '#555', size = 14 }: { color?: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
    <ellipse cx="6"  cy="5"  rx="2.5" ry="3"/>
    <ellipse cx="11" cy="3"  rx="2.5" ry="3"/>
    <ellipse cx="16" cy="4"  rx="2.5" ry="3"/>
    <ellipse cx="19" cy="9"  rx="2"   ry="2.5"/>
    <path d="M12 22c-5 0-8-3-8-7 0-2.5 1.5-4.5 4-5.5 1-.4 2-.6 4-.6s3 .2 4 .6c2.5 1 4 3 4 5.5 0 4-3 7-8 7z"/>
  </svg>
)

export default function TradeManagerModal({ trade, onClose, onRefresh }: TradeManagerModalProps) {
  const { money, shares } = usePrivacy()

  // Posición confirmada en la BD (los pendientes se aplican encima)
  const [base, setBase] = useState<Calc & { avg: number }>({
    qty: r6(Number(trade.quantity) || 0),
    cap: r2(Number(trade.total_invested) || 0),
    pnl: r2(Number(trade.realized_pnl) || 0),
    avg: r4(Number(trade.entry_price) || 0),
  })

  const [actions,     setActions]     = useState("")
  const [price,       setPrice]       = useState("")
  const [date,        setDate]        = useState(todayLocal())
  const [commission,  setCommission]  = useState("0")
  const [closeReason, setCloseReason] = useState("")
  const [isSaving,    setIsSaving]    = useState(false)
  const [editing,     setEditing]     = useState<HistoryItem | null>(null)
  const [closingMode, setClosingMode] = useState(false)
  const [showAI,      setShowAI]      = useState(false)

  const [stop, setStop] = useState(trade.stop_loss     ? String(trade.stop_loss)     : '')
  const [tp1,  setTp1]  = useState(trade.take_profit_1 ? String(trade.take_profit_1) : '')
  const [tp2,  setTp2]  = useState(trade.take_profit_2 ? String(trade.take_profit_2) : '')
  const [tp3,  setTp3]  = useState(trade.take_profit_3 ? String(trade.take_profit_3) : '')

  const [currency,     setCurrency]     = useState<'USD' | 'MXN'>('USD')
  const [exchangeRate, setExchangeRate] = useState('1')
  const [fxError,      setFxError]      = useState(false)
  const [history,      setHistory]      = useState<HistoryItem[]>([])
  const [moves,        setMoves]        = useState<PendingMove[]>([])

  // ── Tipo de cambio ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (currency !== 'MXN') { setExchangeRate('1'); setFxError(false); return }
    if (!date) return
    if (fxCache[date]) { setExchangeRate(fxCache[date]); setFxError(false); return }

    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`https://api.frankfurter.app/${date}?from=USD&to=MXN`)
        let rate = res.ok ? (await res.json())?.rates?.MXN : null
        if (!rate) {
          const latest = await fetch('https://api.frankfurter.app/latest?from=USD&to=MXN')
          rate = (await latest.json())?.rates?.MXN
        }
        const n = Number(rate)
        if (!(n > 0)) throw new Error('sin tipo de cambio')
        const fixed = n.toFixed(4)
        fxCache[date] = fixed
        if (!cancelled) { setExchangeRate(fixed); setFxError(false) }
      } catch {
        if (!cancelled) { setExchangeRate(''); setFxError(true) }
      }
    })()
    return () => { cancelled = true }
  }, [date, currency])

  // ── Valores derivados de la operación en curso ─────────────────────────────
  const fx         = currency === 'MXN' ? (parseFloat(exchangeRate) || 0) : 1
  const rateOk     = fx > 0
  const priceNum   = Number(price) || 0
  const priceUSD   = rateOk ? r4(priceNum / fx) : 0
  const commUSD    = rateOk ? r2((parseFloat(commission) || 0) / fx) : 0
  const actionsNum = parseFloat(actions) || 0

  // Posición proyectada = BD + operaciones pendientes
  const proj = useMemo(
    () => moves.reduce<Calc>((s, m) => applyExecution(s, m.exType, m.q, m.pr, m.commission), base),
    [base, moves]
  )
  const avg = proj.qty > 0 ? r4(proj.cap / proj.qty) : base.avg

  const opQty      = closingMode ? proj.qty : actionsNum
  const totalOp    = r2(opQty * priceNum)
  const totalOpUSD = r2(opQty * priceUSD)

  // ── Carga / recálculo desde la BD ──────────────────────────────────────────
  async function fetchTradeData() {
    const t  = must(await supabase.from("trades").select("*").eq("id", trade.id).single()) as any
    const ex = must(await supabase.from("trade_executions").select("*")
      .eq("trade_id", trade.id).order('executed_at', { ascending: true })) as any[]
    return { t, ex: ex || [] }
  }

  function buildHistory(t: any, ex: any[]): HistoryItem[] {
    const initialQty   = r6(Number(t.initial_quantity ?? trade.quantity) || 0)
    const initialPrice = r4(Number(t.initial_entry_price ?? trade.entry_price) || 0)

    const opening: HistoryItem = {
      id: 'apertura', date: t.open_date || trade.open_date,
      actions: initialQty, price: initialPrice, commission: 0,
      total: r2(initialQty * initialPrice), type: 'Apertura', exType: 'open', seq: 0,
    }

    const execs: HistoryItem[] = ex.map((e, i) => {
      const q     = r6(Number(e.quantity))
      const p     = r4(Number(e.price))
      const comm  = r2(Number(e.commission || 0))
      const gross = r2(Number(e.total ?? q * p))
      const isBuy = e.execution_type === 'buy'
      return {
        id: e.id, date: e.executed_at, actions: q, price: p, commission: comm,
        total: isBuy ? r2(gross + comm) : r2(gross - comm),
        type: isBuy ? 'Recompra' : e.execution_type === 'sell' ? 'Venta parcial' : 'Cierre',
        exType: isBuy ? 'buy' : e.execution_type === 'sell' ? 'sell' : 'close',
        seq: i + 1,
      }
    })

    return [opening, ...execs].sort((a, b) => {
      const da = dayKey(a.date), db = dayKey(b.date)
      return da === db ? b.seq - a.seq : da < db ? 1 : -1
    })
  }

  // Lee la BD, recalcula y (si persist) guarda los totales del trade en una sola escritura.
  // extra recibe si el trade quedó cerrado y devuelve campos adicionales a guardar.
  async function refreshFromDb(persist: boolean, extra?: (closed: boolean) => Record<string, any>) {
    const { t, ex } = await fetchTradeData()

    if (persist) {
      const calc   = computeFromExecutions(t, ex)
      const closed = calc.qty <= 0
      const avgPrice = calc.qty > 0
        ? r4(calc.cap / calc.qty)
        : r4(Number(t.initial_entry_price ?? t.entry_price) || 0)

      const payload: Record<string, any> = {
        quantity:       calc.qty,
        total_invested: calc.cap,
        entry_price:    avgPrice,
        realized_pnl:   calc.pnl,
        status:         closed ? 'closed' : 'open',
      }
      if (!closed) {
        payload.close_date   = null   // si se eliminó el cierre, el trade se reabre limpio
        payload.close_reason = null
      } else if (!t.close_date) {
        payload.close_date = ex.length ? dayKey(ex[ex.length - 1].executed_at) : todayLocal()
      }
      Object.assign(payload, extra?.(closed) ?? {})

      const { error } = await supabase.from("trades").update(payload).eq("id", trade.id)
      if (error) throw error
      setBase({ ...calc, avg: avgPrice })
    }

    setHistory(buildHistory(t, ex))
  }

  useEffect(() => {
    refreshFromDb(false).catch(e => console.error("Error cargando historial:", e))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trade.id])

  // ── Validación de la operación del formulario ──────────────────────────────
  const validateOp = (qty: number): string | null => {
    if (!rateOk)        return 'Ingresa el tipo de cambio'
    if (!(qty > 0))     return 'Ingresa una cantidad mayor a 0'
    if (!(priceUSD > 0)) return 'Ingresa un precio válido'
    if (!date)          return 'Selecciona la fecha'
    if ((parseFloat(commission) || 0) < 0) return 'La comisión no puede ser negativa'
    return null
  }

  const resetForm = () => {
    setActions(""); setPrice(""); setCommission("0"); setClosingMode(false)
  }

  // ── Operaciones pendientes ─────────────────────────────────────────────────
  const recomprar = () => {
    const err = validateOp(actionsNum)
    if (err) return alert(err)
    const gross = r2(actionsNum * priceUSD)
    setMoves(prev => [...prev, {
      type: `Recompra (${currency})`, amount: -r2(gross + commUSD),
      gross, commission: commUSD, date, q: r6(actionsNum), pr: priceUSD,
      exType: 'buy', tc: fx,
    }])
    resetForm()
  }

  const ventaParcial = () => {
    const err = validateOp(actionsNum)
    if (err) return alert(err)
    if (actionsNum > proj.qty) return alert('No puedes vender más acciones de las que tienes')
    const gross = r2(actionsNum * priceUSD)
    setMoves(prev => [...prev, {
      type: `Venta parcial (${currency})`, amount: r2(gross - commUSD),
      gross, commission: commUSD, date, q: r6(actionsNum), pr: priceUSD,
      exType: 'sell', tc: fx,
    }])
    resetForm()
  }

  const buildCloseMove = (): PendingMove | null => {
    const err = validateOp(proj.qty)
    if (err) { alert(err); return null }
    if (!closeReason) { alert('Selecciona la razón de cierre'); return null }
    const gross = r2(proj.qty * priceUSD)
    return {
      type: `Cierre total (${currency})`, amount: r2(gross - commUSD),
      gross, commission: commUSD, date, q: r6(proj.qty), pr: priceUSD,
      exType: 'close', tc: fx, closeReason,
    }
  }

  const removeMove = (index: number) => {
    const next = moves.filter((_, i) => i !== index)
    if (!isValidSequence(base, next)) {
      return alert('No puedes quitar esta compra: una venta pendiente depende de ella')
    }
    setMoves(next)
  }

  // ── Edición / eliminación de ejecuciones guardadas ─────────────────────────
  const startEdit = (h: HistoryItem) => {
    setEditing(h)
    setActions(h.actions.toString())
    setPrice(h.price.toString())
    setDate(dayKey(h.date))
    setCurrency('USD')
    setCommission(h.commission?.toString() || '0')
    setClosingMode(false)
  }

  const cancelEdit = () => {
    setEditing(null)
    setDate(todayLocal())
    resetForm()
  }

  const deleteExecution = async (h: HistoryItem) => {
    if (h.id === 'apertura' || isSaving) return
    if (!confirm('¿Eliminar esta ejecución? También se ajustará el movimiento de la billetera.')) return
    setIsSaving(true)
    try {
      // Primero el movimiento: así no queda huérfano aunque la FK haga SET NULL
      const m = await supabase.from("wallet_movements").delete().eq("execution_id", h.id)
      if (m.error) throw m.error
      const x = await supabase.from("trade_executions").delete().eq("id", h.id)
      if (x.error) throw x.error
      await refreshFromDb(true)
      await onRefresh()
    } catch (e) {
      alert('No se pudo eliminar: ' + errMsg(e))
    } finally {
      setIsSaving(false)
    }
  }

  const updateExecution = async () => {
    if (!editing || isSaving) return
    const err = validateOp(actionsNum)
    if (err) return alert(err)

    setIsSaving(true)
    try {
      if (editing.id === 'apertura') {
        const { error } = await supabase.from("trades").update({
          initial_quantity:    r6(actionsNum),
          initial_entry_price: priceUSD,
          open_date:           date,
        }).eq("id", trade.id)
        if (error) throw error
      } else {
        const gross  = r2(actionsNum * priceUSD)
        const isBuy  = editing.exType === 'buy'
        const walletAmount = isBuy ? -r2(gross + commUSD) : r2(gross - commUSD)

        const ex = await supabase.from("trade_executions").update({
          quantity: r6(actionsNum), price: priceUSD, total: gross,
          commission: commUSD, executed_at: date,
        }).eq("id", editing.id)
        if (ex.error) throw ex.error

        const mv = await supabase.from("wallet_movements")
          .update({ date, amount: walletAmount })
          .eq("execution_id", editing.id)
        if (mv.error) {
          // Revertimos la ejecución para que BD y billetera no queden desalineadas
          await supabase.from("trade_executions").update({
            quantity: editing.actions, price: editing.price,
            total: r2(editing.actions * editing.price),
            commission: editing.commission, executed_at: dayKey(editing.date),
          }).eq("id", editing.id)
          throw mv.error
        }
      }
      await refreshFromDb(true)
      await onRefresh()
      cancelEdit()
    } catch (e) {
      alert('No se pudo actualizar: ' + errMsg(e))
    } finally {
      setIsSaving(false)
    }
  }

  // ── Guardar ────────────────────────────────────────────────────────────────
  async function guardar() {
    if (isSaving) return

    let allMoves = moves
    if (closingMode) {
      const closeMove = buildCloseMove()
      if (!closeMove) return
      allMoves = [...moves, closeMove]
    }

    setIsSaving(true)
    const createdExecIds: string[] = []
    try {
      for (const m of allMoves) {
        const exec = must(await supabase.from("trade_executions").insert({
          trade_id:       trade.id,
          execution_type: m.exType,
          quantity:       m.q,
          price:          m.pr,
          total:          m.gross,
          commission:     m.commission,
          executed_at:    m.date,
        }).select('id').single()) as any
        createdExecIds.push(exec.id)

        const { error } = await supabase.from("wallet_movements").insert({
          wallet_id:     trade.portfolio_id,
          user_id:       trade.user_id,
          ticker:        trade.ticker,
          amount:        m.amount,
          movement_type: 'trade',
          notes:         `${m.type} T/C: ${m.tc}`,
          date:          m.date,
          execution_id:  exec.id,
        })
        if (error) throw error
      }

      const lastMove = allMoves[allMoves.length - 1]
      await refreshFromDb(true, closed => ({
        stop_loss:     toTarget(stop),
        take_profit_1: toTarget(tp1),
        take_profit_2: toTarget(tp2),
        take_profit_3: toTarget(tp3),
        ...(closed && lastMove
          ? { close_date: lastMove.date, close_reason: closingMode ? closeReason : null }
          : {}),
      }))

      await onRefresh()
      onClose()
    } catch (e) {
      // Deshacer lo insertado para no dejar ejecuciones sin su movimiento (o viceversa)
      for (const id of [...createdExecIds].reverse()) {
        await supabase.from("wallet_movements").delete().eq("execution_id", id)
        await supabase.from("trade_executions").delete().eq("id", id)
      }
      alert('No se pudo guardar (no se aplicó ningún cambio): ' + errMsg(e))
    } finally {
      setIsSaving(false)
    }
  }

  const renderPct = (val: string, isStop = false) => {
    const n = Number(val)
    if (!avg || !n) return <span style={{ color: '#333', fontSize: 12 }}>—</span>
    const pct   = ((n - avg) / avg) * 100
    const color = isStop
      ? (n < avg ? '#ef4444' : '#22c55e')
      : (n > avg ? '#22c55e' : '#ef4444')
    return <span style={{ color, fontSize: 12, fontWeight: 900 }}>{pct > 0 ? '+' : ''}{pct.toFixed(2)}%</span>
  }

  const canSave = !isSaving && (!closingMode || (priceUSD > 0 && closeReason !== '' && rateOk))

  const targets = [
    { val: stop, set: setStop, isStop: true },
    { val: tp1,  set: setTp1,  isStop: false },
    { val: tp2,  set: setTp2,  isStop: false },
    { val: tp3,  set: setTp3,  isStop: false },
  ]

  const opBtn = (base: React.CSSProperties): React.CSSProperties => ({
    ...base,
    opacity: closingMode || isSaving ? 0.4 : 1,
    cursor:  closingMode || isSaving ? 'not-allowed' : 'pointer',
  })

  return (
    <div style={overlay}>
      <div style={{ display: 'flex', alignItems: 'stretch', maxHeight: '92vh' }}>
        <div style={{
          ...modal,
          height: '100%',
          borderRadius: showAI ? '12px 0 0 12px' : '12px',
          borderRight:  showAI ? 'none' : '1px solid #333',
        }}>

          {/* HEADER */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #1a1a1a', paddingBottom: 12, marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Paw color="#00bfff" size={16} />
              <h2 style={{ margin: 0, fontSize: 18 }}>
                Gestión: <span style={{ color: '#00bfff' }}>{trade.ticker}</span>
              </h2>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              {editing && <span style={{ color: '#eab308', fontWeight: 'bold', fontSize: 11 }}>Modo edición</span>}

              <button
                onClick={() => setShowAI(v => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  background: showAI ? 'rgba(0,191,255,0.1)' : '#111',
                  border: `1px solid ${showAI ? 'rgba(0,191,255,0.3)' : '#222'}`,
                  color: showAI ? '#00bfff' : '#666',
                  borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
                  fontSize: 10, fontWeight: 700, transition: 'all 0.2s',
                }}
              >
                Resumen
                <ChevronRight size={10} style={{ transform: showAI ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
              </button>

              <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>
          </div>

          {/* RESUMEN */}
          <div style={rowLabels4Col}>
            <div>Acciones</div><div>Precio avg (USD)</div><div>Capital (USD)</div><div>PnL realizado</div>
          </div>
          <div style={rowValues4Col}>
            <div style={valBoxLarge}>{shares(proj.qty)}</div>
            <div style={valBoxLarge}>{money(avg)}</div>
            <div style={valBoxLarge}>{money(proj.cap)}</div>
            <div style={{ ...valBoxLarge, color: proj.pnl >= 0 ? '#22c55e' : '#ef4444' }}>{money(proj.pnl)}</div>
          </div>

          {/* TARGETS */}
          <div style={{ ...rowLabels4Col, marginTop: 18 }}>
            <div>Stop loss</div><div>TP 1</div><div>TP 2</div><div>TP 3</div>
          </div>
          <div style={rowTargetsExtended}>
            {targets.map(({ val, set, isStop }, i) => (
              <div key={i} style={targetGroup}>
                <input type="number" step="any" min="0" style={input} value={val} placeholder="—" onChange={e => set(e.target.value)} />
                {renderPct(val, isStop)}
              </div>
            ))}
          </div>

          {/* FORMULARIO OPERACIÓN */}
          <div style={{ ...rowLabelsCustom, marginTop: 18 }}>
            <div>Cant.</div><div>Precio ({currency})</div><div>Total ({currency})</div><div>Fecha</div><div>Comisión</div>
          </div>
          <div style={rowValuesCustom}>
            <input style={input} value={actions} onChange={e => setActions(e.target.value)} placeholder="0" type="number" step="0.000001" min="0" readOnly={closingMode} />
            <input style={input} value={price}   onChange={e => setPrice(e.target.value)}   placeholder="0.00" type="number" step="0.01" min="0" />
            <div style={valBox}>{money(totalOp)}</div>
            <input style={input} type="date" value={date} onChange={e => setDate(e.target.value)} />
            <input style={input} value={commission} onChange={e => setCommission(e.target.value)} placeholder="0.00" type="number" step="0.01" min="0" />
          </div>

          {/* BOTONES ACCIÓN */}
          <div style={buttons}>
            {editing ? (
              <>
                <button style={{ ...saveBtn, background: '#eab308', color: '#000', opacity: isSaving ? 0.5 : 1 }} onClick={updateExecution} disabled={isSaving}>
                  {isSaving ? 'Actualizando...' : 'Actualizar registro'}
                </button>
                <button style={exitBtn} onClick={cancelEdit} disabled={isSaving}>Cancelar</button>
              </>
            ) : (
              <>
                <button style={opBtn(buyBtn)}  onClick={recomprar}    disabled={closingMode || isSaving}>Recompra</button>
                <button style={opBtn(sellBtn)} onClick={ventaParcial} disabled={closingMode || isSaving}>Venta parcial</button>
                <button
                  style={{ ...closeBtn, border: closingMode ? '1px solid #f43f5e' : '1px solid #333', color: closingMode ? '#f43f5e' : '#888' }}
                  onClick={() => {
                    if (closingMode) { setClosingMode(false); setActions(""); return }
                    if (!(proj.qty > 0)) return alert('No hay acciones por cerrar')
                    setClosingMode(true)
                    setActions(proj.qty.toString())
                  }}>
                  {closingMode ? 'Cancelar cierre' : 'Cerrar trade'}
                </button>
              </>
            )}
          </div>

          {/* MONEDA + T/C + RAZÓN DE CIERRE */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginTop: 14 }}>
            <div style={{ width: 90 }}>
              <label style={labelStyle}>Moneda</label>
              <select style={input} value={currency} onChange={e => setCurrency(e.target.value as 'USD' | 'MXN')}>
                <option value="USD">USD</option>
                <option value="MXN">MXN</option>
              </select>
            </div>

            {currency === 'MXN' && (
              <div style={{ width: 130 }}>
                <label style={{ ...labelStyle, color: rateOk ? '#eab308' : '#f43f5e' }}>
                  {fxError ? 'T/C (ingrésalo)' : 'Valor dólar (T/C)'}
                </label>
                <input type="number" step="0.01" min="0"
                  style={{ ...input, borderColor: rateOk ? '#eab308' : '#f43f5e' }}
                  value={exchangeRate}
                  onChange={e => { setExchangeRate(e.target.value); setFxError(false) }} />
              </div>
            )}

            {closingMode && (
              <div style={{ flex: 1 }}>
                <label style={{ ...labelStyle, color: '#f43f5e' }}>Razón de cierre</label>
                <select
                  style={{ ...input, color: closeReason ? '#ffffff' : '#555', textAlign: 'left' }}
                  value={closeReason}
                  onChange={e => setCloseReason(e.target.value)}>
                  <option value="">Seleccionar motivo...</option>
                  {CLOSE_REASONS.map(r => <option key={r} value={r} style={{ color: 'white' }}>{r}</option>)}
                </select>
              </div>
            )}

            <div style={{ marginLeft: 'auto', background: '#000', border: '1px solid #1a1a1a', borderRadius: 6, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', minWidth: 160 }}>
              <label style={{ ...labelStyle, color: '#00bfff', marginBottom: 0 }}>Equivalente USD</label>
              <div style={{ color: '#00bfff', fontSize: 15, fontWeight: 'bold', marginLeft: 12 }}>{money(totalOpUSD)}</div>
            </div>
          </div>

          {/* PENDIENTES SIN GUARDAR */}
          {moves.length > 0 && (
            <div style={{ marginTop: 14, background: '#0a0a0a', borderRadius: 8, padding: '10px 14px', border: '1px solid #1a1a1a' }}>
              <div style={{ fontSize: 10, color: '#555', marginBottom: 6, fontWeight: 700, letterSpacing: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Paw color="#555" size={11} /> Pendientes de guardar ({moves.length})
              </div>
              {moves.map((m, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: '#666', padding: '3px 0', borderBottom: '1px solid #111' }}>
                  <span>{m.type} · {shares(m.q)} acc @ {money(m.pr)}{m.closeReason ? ` · ${m.closeReason}` : ''}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ color: m.amount >= 0 ? '#22c55e' : '#f43f5e' }}>{money(m.amount)}</span>
                    <button onClick={() => removeMove(i)} disabled={isSaving} title="Quitar"
                      style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', display: 'flex' }}>
                      <X size={12} />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* HISTORIAL */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 18, marginBottom: 8 }}>
            <Paw color="#333" size={13} />
            <h3 style={{ margin: 0, fontSize: 11, color: '#444', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
              Historial de ejecuciones
            </h3>
          </div>
          <div style={historyBox}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#000' }}>
                  <th style={th}>Fecha</th>
                  <th style={th}>Cant.</th>
                  <th style={th}>Precio</th>
                  <th style={th}>Comisión</th>
                  <th style={th}>Total neto</th>
                  <th style={th}>Tipo</th>
                  <th style={{ ...th, textAlign: 'center' }}>Acc.</th>
                </tr>
              </thead>
              <tbody>
                {history.map(h => (
                  <tr key={h.id} style={{ borderBottom: '1px solid #0a0a0a' }}>
                    <td style={td}>
                      {parseDate(h.date).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                    <td style={td}>{shares(h.actions)}</td>
                    <td style={td}>{money(h.price)}</td>
                    <td style={{ ...td, color: '#555' }}>{h.commission > 0 ? money(h.commission) : '—'}</td>
                    <td style={{ ...td, color: h.type === 'Recompra' || h.type === 'Apertura' ? '#22c55e' : '#ef4444' }}>
                      {money(Math.abs(h.total))}
                    </td>
                    <td style={{ ...td, fontSize: 11, color: '#888' }}>{h.type}</td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                        <button onClick={() => startEdit(h)} disabled={isSaving}
                          style={{ background: 'none', border: 'none', color: '#eab308', cursor: 'pointer' }}>
                          <Pencil size={13} />
                        </button>
                        {h.id !== 'apertura' && (
                          <button onClick={() => deleteExecution(h)} disabled={isSaving}
                            style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* GUARDAR */}
          <div style={{ ...buttons, marginTop: 18 }}>
            <button
              disabled={!canSave}
              style={{ ...saveBtn, opacity: canSave ? 1 : 0.5, cursor: canSave ? 'pointer' : 'not-allowed' }}
              onClick={guardar}>
              {isSaving ? 'Guardando...' : closingMode ? 'Confirmar cierre y guardar' : 'Guardar cambios'}
            </button>
            <button style={exitBtn} onClick={onClose}>Salir</button>
          </div>

        </div>

        {/* Panel IA lateral */}
        {showAI && (
          <AiInsightPanel
            ticker={trade.ticker}
            country={trade.country}
            sector={trade.sector}
            subsector={trade.subsector}
            rsi={trade.rsi}
            entry_price={trade.entry_price}
            quantity={trade.quantity}
            onClose={() => setShowAI(false)}
          />
        )}
      </div>
    </div>
  )
}

// ── Estilos ──────────────────────────────────────────────────────────────────
const overlay: React.CSSProperties = { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.88)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }
const modal: React.CSSProperties = { width: 940, maxHeight: '92vh', overflowY: 'auto', background: '#111', padding: 25, border: '1px solid #333', color: 'white' }

const rowLabels4Col: React.CSSProperties      = { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', fontSize: 9, color: '#555', textTransform: 'uppercase', marginBottom: 6, textAlign: 'center', letterSpacing: 0.5 }
const rowValues4Col: React.CSSProperties      = { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }
const valBoxLarge: React.CSSProperties        = { background: '#000', padding: 14, borderRadius: 6, border: '1px solid #1a1a1a', textAlign: 'center', fontSize: 15, fontWeight: 'bold' }
const rowTargetsExtended: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20 }
const targetGroup: React.CSSProperties        = { display: 'flex', alignItems: 'center', gap: 8 }
const rowLabelsCustom: React.CSSProperties    = { display: 'grid', gridTemplateColumns: '0.8fr 1fr 1.2fr 1.4fr 0.7fr', fontSize: 9, color: '#555', textTransform: 'uppercase', marginBottom: 6, textAlign: 'center', letterSpacing: 0.5 }
const rowValuesCustom: React.CSSProperties    = { display: 'grid', gridTemplateColumns: '0.8fr 1fr 1.2fr 1.4fr 0.7fr', gap: 10 }
const valBox: React.CSSProperties    = { background: '#000', padding: 10, borderRadius: 6, border: '1px solid #1a1a1a', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }
const input: React.CSSProperties     = { background: '#000', border: '1px solid #333', color: 'white', padding: 10, borderRadius: 6, textAlign: 'center', width: '100%', boxSizing: 'border-box', fontSize: 13, outline: 'none' }
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 9, color: '#555', marginBottom: 4, fontWeight: 'bold', letterSpacing: 0.5 }
const buttons: React.CSSProperties   = { display: 'flex', gap: 10, marginTop: 20 }
const buyBtn: React.CSSProperties    = { flex: 1, background: '#1b4332', color: '#22c55e', border: '1px solid #22c55e', padding: 12, borderRadius: 6, fontWeight: 'bold', cursor: 'pointer' }
const sellBtn: React.CSSProperties   = { flex: 1, background: '#3a1a1a', color: '#ef4444', border: '1px solid #ef4444', padding: 12, borderRadius: 6, fontWeight: 'bold', cursor: 'pointer' }
const closeBtn: React.CSSProperties  = { flex: 1, background: '#1a1a1a', color: '#888', border: '1px solid #333', padding: 12, borderRadius: 6, fontWeight: 'bold', cursor: 'pointer' }
const saveBtn: React.CSSProperties   = { flex: 2, background: '#00bfff', color: '#000', border: 'none', padding: 12, borderRadius: 6, fontWeight: 'bold', cursor: 'pointer' }
const exitBtn: React.CSSProperties   = { flex: 1, background: '#1a1a1a', color: '#888', border: '1px solid #222', padding: 12, borderRadius: 6, fontWeight: 'bold', cursor: 'pointer' }
const historyBox: React.CSSProperties = { maxHeight: 200, overflowY: 'auto', background: '#080808', borderRadius: 8, border: '1px solid #1a1a1a', marginTop: 8 }
const th: React.CSSProperties = { padding: '10px 12px', textAlign: 'left', fontSize: 9, color: '#444', borderBottom: '1px solid #1a1a1a', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }
const td: React.CSSProperties = { padding: '10px 12px', fontSize: 12, color: '#ccc' }