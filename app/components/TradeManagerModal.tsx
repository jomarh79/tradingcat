"use client"

import { useState, useEffect, useCallback } from "react"
import { supabase } from "@/lib/supabase"
import { usePrivacy } from "@/lib/PrivacyContext"
import { Trash2, Pencil, X } from "lucide-react"

const parseDate = (d: string) => new Date((d || '').split('T')[0] + 'T00:00:00')

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
// Huella de gato SVG pequeña
const Paw = ({ color = '#555', size = 14 }: any) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
    <ellipse cx="6"  cy="5"  rx="2.5" ry="3"/>
    <ellipse cx="11" cy="3"  rx="2.5" ry="3"/>
    <ellipse cx="16" cy="4"  rx="2.5" ry="3"/>
    <ellipse cx="19" cy="9"  rx="2"   ry="2.5"/>
    <path d="M12 22c-5 0-8-3-8-7 0-2.5 1.5-4.5 4-5.5 1-.4 2-.6 4-.6s3 .2 4 .6c2.5 1 4 3 4 5.5 0 4-3 7-8 7z"/>
  </svg>
)

export default function TradeManagerModal({ trade, onClose, onRefresh }: any) {
  const today = new Date().toLocaleDateString('sv-SE')
  const { money, shares } = usePrivacy()

  const [qty,     setQty]     = useState(parseFloat(Number(trade.quantity      || 0).toFixed(6)))
  const [avg,     setAvg]     = useState(parseFloat(Number(trade.entry_price   || 0).toFixed(2)))
  const [capital, setCapital] = useState(parseFloat(Number(trade.total_invested || 0).toFixed(2)))
  const [pnl,     setPnl]     = useState(parseFloat(Number(trade.realized_pnl  || 0).toFixed(2)))

  const [actions,     setActions]     = useState("")
  const [price,       setPrice]       = useState("")
  const [date,        setDate]        = useState(today)
  const [commission,  setCommission]  = useState("0")
  const [closeReason, setCloseReason] = useState("")
  const [isSaving,    setIsSaving]    = useState(false)
  const [editingId,   setEditingId]   = useState<string | null>(null)
  const [closingMode, setClosingMode] = useState(false)

  const [stop, setStop] = useState(trade.stop_loss     || 0)
  const [tp1,  setTp1]  = useState(trade.take_profit_1 || 0)
  const [tp2,  setTp2]  = useState(trade.take_profit_2 || 0)
  const [tp3,  setTp3]  = useState(trade.take_profit_3 || 0)

  const [currency,     setCurrency]     = useState('USD')
  const [exchangeRate, setExchangeRate] = useState('1')
  const [history,      setHistory]      = useState<any[]>([])
  const [moves,        setMoves]        = useState<any[]>([])

  // Ref para acceder al qty actual dentro de cerrarTrade sin depender del cierre
  const qtyRef     = { current: qty }
  const capitalRef = { current: capital }
  const avgRef     = { current: avg }
  const pnlRef     = { current: pnl }

  const fetchExchangeRate = useCallback(async (selectedDate: string, targetCurrency: string) => {
    if (targetCurrency === 'USD') { setExchangeRate('1'); return }
    const key = `${selectedDate}-MXN`
    if (fxCache[key]) { setExchangeRate(fxCache[key]); return }
    try {
      const res  = await fetch(`https://api.frankfurter.app/${selectedDate}?from=USD&to=MXN`)
      const data = await res.json()
      let rate   = data?.rates?.MXN
      if (!rate) {
        const latest = await fetch('https://api.frankfurter.app/latest?from=USD&to=MXN')
        rate = (await latest.json()).rates.MXN
      }
      const fixed = rate.toFixed(4)
      fxCache[key] = fixed
      setExchangeRate(fixed)
    } catch (err) { console.error(err) }
  }, [])

  useEffect(() => {
    if (currency === 'MXN') fetchExchangeRate(date, currency)
    else setExchangeRate('1')
  }, [date, currency, fetchExchangeRate])

  const tCambio    = parseFloat(exchangeRate) || 1
  const priceUSD   = currency === 'MXN' ? parseFloat((Number(price) / tCambio).toFixed(2)) : parseFloat(Number(price).toFixed(2))
  const commUSD    = parseFloat((parseFloat(commission || '0') / tCambio).toFixed(2))
  const actionsNum = parseFloat(actions || '0')
  const totalOp    = parseFloat((actionsNum * Number(price || 0)).toFixed(2))
  const totalOpUSD = parseFloat((actionsNum * priceUSD).toFixed(2))

  const loadHistory = useCallback(async () => {
  const { data: freshTrade } = await supabase
    .from("trades").select("*").eq("id", trade.id).single()
  const { data: executions } = await supabase
    .from("trade_executions").select("*")
    .eq("trade_id", trade.id).order('executed_at', { ascending: true })

  // 🔥 CAMBIO: Usar los valores iniciales fijos
  const initialPrice = parseFloat(Number(freshTrade?.initial_entry_price || trade.entry_price).toFixed(2))
  const initialQty   = parseFloat(Number(freshTrade?.initial_quantity || trade.quantity).toFixed(6))

  const opening = {
    id: 'apertura', 
    date: freshTrade?.open_date || trade.open_date,
    actions: initialQty, 
    price: initialPrice,
    total: parseFloat((initialQty * initialPrice).toFixed(2)),
    commission: 0, 
    type: 'Apertura',
  }

  const execHistory = (executions || []).map(e => ({
    id: e.id, 
    date: e.executed_at,
    actions: parseFloat(Number(e.quantity).toFixed(6)),
    price: parseFloat(Number(e.price).toFixed(2)),
    total: parseFloat(Number(e.total).toFixed(2)),
    commission: parseFloat(Number(e.commission || 0).toFixed(2)),
    type: e.execution_type === 'buy' ? 'Recompra' : e.execution_type === 'sell' ? 'Venta parcial' : 'Cierre',
  }))

  setHistory([opening, ...execHistory].sort((a, b) =>
    new Date(b.date).getTime() - new Date(a.date).getTime()
  ))
}, [trade])


  useEffect(() => { loadHistory() }, [loadHistory])

  const recalculateTrade = useCallback(async () => {
  const { data: t }  = await supabase.from("trades").select("*").eq("id", trade.id).single()
  const { data: ex } = await supabase.from("trade_executions").select("*")
    .eq("trade_id", trade.id).order('executed_at', { ascending: true })

  // 🔥 Empezar siempre con la base inmutable
  let cQty = parseFloat(Number(t.initial_quantity || t.quantity).toFixed(6))
  let cCap = parseFloat((cQty * Number(t.initial_entry_price || t.entry_price)).toFixed(2))
  let cPnl = 0

  if (ex) {
    ex.forEach(e => {
      const q = parseFloat(Number(e.quantity).toFixed(6))
      const p = parseFloat(Number(e.price).toFixed(2))
      const comm = parseFloat(Number(e.commission || 0).toFixed(2))
      const gross = parseFloat((q * p).toFixed(2))

      if (e.execution_type === 'buy') {
        cQty = parseFloat((cQty + q).toFixed(6))
        cCap = parseFloat((cCap + gross + comm).toFixed(2))
      } else {
        const avgM = cQty > 0 ? cCap / cQty : 0
        const cost = parseFloat((q * avgM).toFixed(2))
        const netIn = parseFloat((gross - comm).toFixed(2))
        cQty = parseFloat((cQty - q).toFixed(6))
        cCap = parseFloat((cCap - cost).toFixed(2))
        cPnl = parseFloat((cPnl + (netIn - cost)).toFixed(2))
      }
    })
  }

  const avgPrice = cQty > 0 ? parseFloat((cCap / cQty).toFixed(2)) : t.initial_entry_price

  setQty(cQty); setCapital(cCap); setAvg(avgPrice); setPnl(cPnl)

  await supabase.from("trades").update({
    quantity: cQty,
    total_invested: parseFloat(cCap.toFixed(2)),
    entry_price: avgPrice, // El promedio para la tabla principal
    realized_pnl: parseFloat(cPnl.toFixed(2)),
    status: cQty <= 0 ? 'closed' : 'open',
  }).eq("id", trade.id)
}, [trade])


  const recomprar = () => {
    if (!actionsNum || !priceUSD) return
    const gross   = parseFloat((actionsNum * priceUSD).toFixed(2))
    const wallOut = parseFloat((gross + commUSD).toFixed(2))
    setMoves(prev => [...prev, {
      type: `Recompra (${currency})`, amount: -wallOut,
      pureTradeAmount: gross, commission: commUSD,
      date, q: parseFloat(actionsNum.toFixed(6)), pr: priceUSD,
      exType: "buy", mType: "trade", noteExt: `T/C: ${tCambio}`,
    }])
    const nQty = parseFloat((qty + actionsNum).toFixed(6))
    const nCap = parseFloat((capital + gross + commUSD).toFixed(2))
    setQty(nQty); setCapital(nCap); setAvg(parseFloat((nCap / nQty).toFixed(2)))
    setActions(""); setPrice(""); setCommission("0")
    setClosingMode(false)
  }

  const ventaParcial = () => {
    if (!actionsNum || !priceUSD || actionsNum > qty) return
    const gross  = parseFloat((actionsNum * priceUSD).toFixed(2))
    const wallIn = parseFloat((gross - commUSD).toFixed(2))
    const cost   = parseFloat((actionsNum * avg).toFixed(2))
    setMoves(prev => [...prev, {
      type: `Venta parcial (${currency})`, amount: wallIn,
      pureTradeAmount: gross, commission: commUSD,
      date, q: parseFloat(actionsNum.toFixed(6)), pr: priceUSD,
      exType: "sell", mType: "trade", noteExt: `T/C: ${tCambio}`,
    }])
    setQty(parseFloat((qty - actionsNum).toFixed(6)))
    setCapital(parseFloat((capital - cost).toFixed(2)))
    setPnl(parseFloat((pnl + (wallIn - cost)).toFixed(2)))
    setActions(""); setPrice(""); setCommission("0")
    setClosingMode(false)
  }

  // Retorna el move de cierre sin modificar estado — lo usa guardar() directamente
  const buildCloseMove = () => {
    if (!priceUSD) return null
    const gross  = parseFloat((qty * priceUSD).toFixed(2))
    const wallIn = parseFloat((gross - commUSD).toFixed(2))
    return {
      type: `Cierre total (${currency})`, amount: wallIn,
      pureTradeAmount: gross, commission: commUSD,
      date, q: parseFloat(qty.toFixed(6)), pr: priceUSD,
      exType: "close", mType: "trade", noteExt: `T/C: ${tCambio}`,
      closeReason,
    }
  }

  const startEdit = (h: any) => {
    setEditingId(h.id)
    setActions(h.actions.toString())
    setPrice(h.price.toString())
    setDate(typeof h.date === 'string' ? h.date.split('T')[0] : h.date)
    setCurrency('USD')
    setCommission(h.commission?.toString() || '0')
    setClosingMode(false)
  }

  const deleteExecution = async (h: any) => {
    if (h.id === 'apertura' || !confirm('¿Eliminar esta ejecución?')) return
    await supabase.from("trade_executions").delete().eq("id", h.id)
    await supabase.from("wallet_movements").delete().eq("execution_id", h.id)
    await recalculateTrade(); loadHistory(); onRefresh()
  }

  const updateExecution = async () => {
    if (!editingId || isSaving) return
    setIsSaving(true)
    try {
      // Dentro de updateExecution, en el bloque de 'apertura':
      if (editingId === 'apertura') {
        await supabase.from("trades").update({
          initial_quantity: parseFloat(actionsNum.toFixed(6)),
          initial_entry_price: parseFloat(priceUSD.toFixed(2)),
          open_date: date,
        }).eq("id", trade.id)

    } else {
      // Obtener el tipo de ejecución para calcular el monto correcto
      const { data: execData } = await supabase
        .from("trade_executions")
        .select("execution_type")
        .eq("id", editingId)
        .single()

      const isBuy = execData?.execution_type === 'buy'
      const gross = parseFloat((actionsNum * priceUSD).toFixed(2))

      // Buy: salida de dinero (negativo) = -(gross + comisión)
      // Sell/Close: entrada de dinero (positivo) = gross - comisión
      const walletAmount = isBuy
        ? parseFloat((-(gross + commUSD)).toFixed(2))
        : parseFloat((gross - commUSD).toFixed(2))

      await supabase.from("trade_executions").update({
        quantity:    parseFloat(actionsNum.toFixed(6)),
        price:       parseFloat(priceUSD.toFixed(2)),
        total:       gross,
        commission:  commUSD,
        executed_at: date,
      }).eq("id", editingId)

    await supabase.from("wallet_movements")
      .update({
        date,
        amount: walletAmount,
      })
      .eq("execution_id", editingId)
    } catch (err) {
        console.error("Error actualizando ejecución:", err)
    } finally {
      setIsSaving(false)
  }
}
  
  async function guardar() {
    if (isSaving) {
      console.warn("Ya se está guardando, ignorado")
      return
    }

    // Si está en modo cierre, validar precio antes de proceder
    if (closingMode && !priceUSD) return alert('Ingresa el precio de cierre')
    if (closingMode && !closeReason) return alert('Selecciona la razón de cierre')

    setIsSaving(true)
    try {
      // Construir lista final de movimientos
      // Si closingMode está activo, agregar el cierre al final sin pasar por estado
      const allMoves = closingMode
        ? [...moves, buildCloseMove()].filter(Boolean)
        : moves

      const lastClose    = [...allMoves].reverse().find((m: any) => m.exType === 'close')
      const reasonToSave = lastClose?.closeReason || null

      // Calcular qty final para saber si queda cerrado
      let finalQty = qty
      if (closingMode) finalQty = 0  // cierre total siempre deja en 0

      await supabase.from("trades").update({
        stop_loss:     parseFloat(Number(stop).toFixed(2)) || null,
        take_profit_1: parseFloat(Number(tp1).toFixed(2))  || null,
        take_profit_2: parseFloat(Number(tp2).toFixed(2))  || null,
        take_profit_3: parseFloat(Number(tp3).toFixed(2))  || null,
        status:        finalQty <= 0 ? "closed" : "open",
        close_date:    finalQty <= 0 ? date : null,
        close_reason:  reasonToSave,
      }).eq("id", trade.id)

      for (const m of allMoves) {
        const { data: exec } = await supabase.from("trade_executions").insert({
          trade_id:       trade.id,
          execution_type: m.exType,
          quantity:       parseFloat(m.q.toFixed(6)),
          price:          parseFloat(m.pr.toFixed(2)),
          total:          parseFloat(m.pureTradeAmount.toFixed(2)),
          commission:     parseFloat(m.commission.toFixed(2)),
          executed_at:    m.date,
        }).select().single()

        await supabase.from("wallet_movements").insert({
          wallet_id:     trade.portfolio_id,
          user_id:       trade.user_id,
          ticker:        trade.ticker,
          amount:        parseFloat(m.amount.toFixed(2)),
          movement_type: m.mType,
          notes:         `${m.type} ${m.noteExt || ''}`,
          date:          m.date,
          execution_id:  exec?.id ?? null,
        })
      }

      await recalculateTrade(); onRefresh(); onClose()
    } finally { setIsSaving(false) }
  }

  const renderPct = (val: number, isStop = false) => {
    if (!avg || !val) return <span style={{ color: '#333', fontSize: 12 }}>—</span>
    const pct   = ((val - avg) / avg) * 100
    const color = isStop
      ? (val < avg ? '#ef4444' : '#22c55e')
      : (val > avg ? '#22c55e' : '#ef4444')
    return <span style={{ color, fontSize: 12, fontWeight: 900 }}>{pct > 0 ? '+' : ''}{pct.toFixed(2)}%</span>
  }

  const canSave = !isSaving && (!closingMode || (priceUSD > 0 && closeReason !== ''))

  return (
    <div style={overlay}>
      <div style={modal}>

        {/* HEADER */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #1a1a1a', paddingBottom: 12, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Paw color="#00bfff" size={16} />
            <h2 style={{ margin: 0, fontSize: 18 }}>
              Gestión: <span style={{ color: '#00bfff' }}>{trade.ticker}</span>
            </h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {editingId    && <span style={{ color: '#eab308', fontWeight: 'bold', fontSize: 11 }}>Modo edición</span>}
            
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer' }}><X size={18} /></button>
          </div>
        </div>

        {/* RESUMEN */}
        <div style={rowLabels4Col}>
          <div>Acciones</div><div>Precio avg (USD)</div><div>Capital (USD)</div><div>PnL realizado</div>
        </div>
        <div style={rowValues4Col}>
          <div style={valBoxLarge}>{shares(qty)}</div>
          <div style={valBoxLarge}>{money(avg)}</div>
          <div style={valBoxLarge}>{money(capital)}</div>
          <div style={{ ...valBoxLarge, color: pnl >= 0 ? '#22c55e' : '#ef4444' }}>{money(pnl)}</div>
        </div>

        {/* TARGETS */}
        <div style={{ ...rowLabels4Col, marginTop: 18 }}>
          <div>Stop loss</div><div>TP 1</div><div>TP 2</div><div>TP 3</div>
        </div>
        <div style={rowTargetsExtended}>
          {[
            { val: stop, set: setStop, isStop: true },
            { val: tp1,  set: setTp1,  isStop: false },
            { val: tp2,  set: setTp2,  isStop: false },
            { val: tp3,  set: setTp3,  isStop: false },
          ].map(({ val, set, isStop }, i) => (
            <div key={i} style={targetGroup}>
              <input type="number" step="any" style={input} value={val} onChange={e => set(e.target.value)} />
              {renderPct(Number(val), isStop)}
            </div>
          ))}
        </div>

        {/* FORMULARIO OPERACIÓN */}
        <div style={{ ...rowLabelsCustom, marginTop: 18 }}>
          <div>Cant.</div><div>Precio ({currency})</div><div>Total ({currency})</div><div>Fecha</div><div>Comisión</div>
        </div>
        <div style={rowValuesCustom}>
          <input style={input} value={actions} onChange={e => setActions(e.target.value)} placeholder="0" type="number" step="0.000001" />
          <input style={input} value={price}   onChange={e => setPrice(e.target.value)}   placeholder="0.00" type="number" step="0.01" />
          <div style={valBox}>{money(totalOp)}</div>
          <input style={input} type="date" value={date} onChange={e => setDate(e.target.value)} />
          <input style={input} value={commission} onChange={e => setCommission(e.target.value)} placeholder="0.00" type="number" step="0.01" />
        </div>

        {/* BOTONES ACCIÓN */}
        <div style={buttons}>
          {editingId ? (
            <>
              <button style={{ ...saveBtn, background: '#eab308', color: '#000' }} onClick={updateExecution} disabled={isSaving}>
                Actualizar registro
              </button>
              <button style={exitBtn} onClick={() => { setEditingId(null); setActions(''); setPrice(''); setCommission('0'); setClosingMode(false) }}>
                Cancelar
              </button>
            </>
          ) : (
            <>
              <button style={buyBtn}  onClick={recomprar}>Recompra</button>
              <button style={sellBtn} onClick={ventaParcial}>Venta parcial</button>
              <button
                style={{ ...closeBtn, border: closingMode ? '1px solid #f43f5e' : '1px solid #333', color: closingMode ? '#f43f5e' : '#888' }}
                onClick={() => {
                  setClosingMode(v => !v)
                  if (!closingMode) setActions(qty.toString())
                }}>
                {closingMode ? 'Cancelar cierre' : 'Cerrar trade'}
              </button>
            </>
          )}
        </div>

        {/* MONEDA + T/C + RAZÓN DE CIERRE en una fila */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginTop: 14 }}>
          <div style={{ width: 90 }}>
            <label style={labelStyle}>Moneda</label>
            <select style={input} value={currency} onChange={e => setCurrency(e.target.value)}>
              <option value="USD">USD</option>
              <option value="MXN">MXN</option>
            </select>
          </div>

          {currency === 'MXN' && (
            <div style={{ width: 130 }}>
              <label style={{ ...labelStyle, color: '#eab308' }}>Valor dólar (T/C)</label>
              <input type="number" step="0.01" style={{ ...input, borderColor: '#eab308' }}
                value={exchangeRate} onChange={e => setExchangeRate(e.target.value)} />
            </div>
          )}

          {/* Razón de cierre — solo aparece en modo cierre */}
          {closingMode && (
            <div style={{ flex: 1 }}>
              <label style={{ ...labelStyle, color: '#f43f5e' }}>Razón de cierre</label>
              <select
                style={{ ...input, borderColor: closeReason ? '#333' : '#333', color: closeReason ? '#ffffff' : '#555', textAlign: 'left' }}
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
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#666', padding: '3px 0', borderBottom: '1px solid #111' }}>
                <span>{m.type} · {m.q} acc @ {money(m.pr)}{m.closeReason ? ` · ${m.closeReason}` : ''}</span>
                <span style={{ color: m.amount >= 0 ? '#22c55e' : '#f43f5e' }}>{money(m.amount)}</span>
              </div>
            ))}
          </div>
        )}

        {/* HISTORIAL */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 18, marginBottom: 8 }}>
          <Paw color="#333" size={13} />
          <h3 style={{ margin: 0, fontSize: 11, color: '#444', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' as const }}>
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
                    {parseDate(typeof h.date === 'string' ? h.date.split('T')[0] : h.date)
                      .toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}
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
                      <button onClick={() => startEdit(h)}
                        style={{ background: 'none', border: 'none', color: '#eab308', cursor: 'pointer' }}>
                        <Pencil size={13} />
                      </button>
                      {h.id !== 'apertura' && (
                        <button onClick={() => deleteExecution(h)}
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
    </div>
  )
}

const overlay: React.CSSProperties = { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.88)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }
const modal: React.CSSProperties   = { width: 940, maxHeight: '92vh', overflowY: 'auto', background: '#111', padding: 25, borderRadius: 12, border: '1px solid #333', color: 'white' }
const rowLabels4Col: React.CSSProperties     = { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', fontSize: 9, color: '#555', textTransform: 'uppercase', marginBottom: 6, textAlign: 'center', letterSpacing: 0.5 }
const rowValues4Col: React.CSSProperties     = { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }
const valBoxLarge: React.CSSProperties       = { background: '#000', padding: 14, borderRadius: 6, border: '1px solid #1a1a1a', textAlign: 'center', fontSize: 15, fontWeight: 'bold' }
const rowTargetsExtended: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20 }
const targetGroup: React.CSSProperties       = { display: 'flex', alignItems: 'center', gap: 8 }
const rowLabelsCustom: React.CSSProperties   = { display: 'grid', gridTemplateColumns: '0.8fr 1fr 1.2fr 1.4fr 0.7fr', fontSize: 9, color: '#555', textTransform: 'uppercase', marginBottom: 6, textAlign: 'center', letterSpacing: 0.5 }
const rowValuesCustom: React.CSSProperties   = { display: 'grid', gridTemplateColumns: '0.8fr 1fr 1.2fr 1.4fr 0.7fr', gap: 10 }
const valBox: React.CSSProperties   = { background: '#000', padding: 10, borderRadius: 6, border: '1px solid #1a1a1a', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }
const input: React.CSSProperties    = { background: '#000', border: '1px solid #333', color: 'white', padding: 10, borderRadius: 6, textAlign: 'center', width: '100%', boxSizing: 'border-box', fontSize: 13, outline: 'none' }
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 9, color: '#555', marginBottom: 4, fontWeight: 'bold', letterSpacing: 0.5 }
const buttons: React.CSSProperties  = { display: 'flex', gap: 10, marginTop: 20 }
const buyBtn: React.CSSProperties   = { flex: 1, background: '#1b4332', color: '#22c55e', border: '1px solid #22c55e', padding: 12, borderRadius: 6, fontWeight: 'bold', cursor: 'pointer' }
const sellBtn: React.CSSProperties  = { flex: 1, background: '#3a1a1a', color: '#ef4444', border: '1px solid #ef4444', padding: 12, borderRadius: 6, fontWeight: 'bold', cursor: 'pointer' }
const closeBtn: React.CSSProperties = { flex: 1, background: '#1a1a1a', color: '#888', border: '1px solid #333', padding: 12, borderRadius: 6, fontWeight: 'bold', cursor: 'pointer' }
const saveBtn: React.CSSProperties  = { flex: 2, background: '#00bfff', color: '#000', border: 'none', padding: 12, borderRadius: 6, fontWeight: 'bold', cursor: 'pointer' }
const exitBtn: React.CSSProperties  = { flex: 1, background: '#1a1a1a', color: '#888', border: '1px solid #222', padding: 12, borderRadius: 6, fontWeight: 'bold', cursor: 'pointer' }
const historyBox: React.CSSProperties = { maxHeight: 200, overflowY: 'auto', background: '#080808', borderRadius: 8, border: '1px solid #1a1a1a', marginTop: 8 }
const th: React.CSSProperties = { padding: '10px 12px', textAlign: 'left', fontSize: 9, color: '#444', borderBottom: '1px solid #1a1a1a', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' as const }
const td: React.CSSProperties = { padding: '10px 12px', fontSize: 12, color: '#ccc' }