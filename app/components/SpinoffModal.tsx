'use client'

import { Fragment, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { GitBranch } from 'lucide-react'

interface SpinoffModalProps {
  onClose: () => void
  allOpenTickers: string[]
  portfolios: any[]
  onApplied: () => void
}

interface PreviewRow {
  id: string | null
  ticker: string
  portfolioId: string | null

  qtyOriginal: number        // cantidad actual del trade (para detectar cambios entre la vista previa y el guardado)
  qtyPre: number             // acciones que tenías en la fecha del spin-off
  originalQtyAfter: number   // acciones de la empresa original después del spin-off

  avgBefore: number | null   // costo promedio de la original antes
  avgAfter: number | null    // costo promedio de la original después

  qtyNew: number             // acciones nuevas recibidas
  priceNew: number           // costo inicial por acción nueva

  noOrigin?: boolean
}

/* ─────────────────────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────────────────────── */

const r4 = (n: number) => parseFloat(n.toFixed(4)) + 0
const r6 = (n: number) => parseFloat(n.toFixed(6)) + 0

// Fecha local de México (misma convención que el resto de la app); NO toISOString, que cambia de día en UTC
const todayLocal = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' })
const dayKey = (d: any) => String(d || '').split('T')[0].split(' ')[0]

// Supabase devuelve { error } en vez de lanzar: aquí se convierte en excepción
function must<T>(res: { data: T | null; error: { message?: string } | null }): T {
  if (res.error) throw new Error(res.error.message || String(res.error))
  return (res.data ?? ([] as unknown)) as T
}

const lotGross = (e: any) => Number(e.total ?? Number(e.quantity) * Number(e.price))
const lotCost = (e: any) => lotGross(e) + Number(e.commission || 0)

// Reconstruye cantidad, capital y PnL realizado recorriendo las ejecuciones (costo promedio)
function replay(
  initialQty: number,
  initialPrice: number,
  execs: { execution_type: string; quantity: any; price: any; total?: any; commission?: any }[]
) {
  let qty = initialQty
  let cap = initialQty * initialPrice
  let pnl = 0

  for (const e of execs) {
    const q = Number(e.quantity)
    const p = Number(e.price)
    const comm = Number(e.commission || 0)
    const gross = Number(e.total ?? q * p)

    if (e.execution_type === 'buy') {
      qty += q
      cap += gross + comm
    } else {
      const avg = qty > 0 ? cap / qty : 0
      const cost = q * avg
      qty -= q
      cap -= cost
      pnl += (gross - comm) - cost
    }
  }
  return { qty, cap, pnl }
}

// Posición del trade en la fecha del spin-off (misma regla que antes: lo del mismo día cuenta como previo)
function analyzeTrade(trade: any, execs: any[], cutoffDay: string) {
  const initialQty = Number(trade.initial_quantity ?? trade.quantity)
  const initialPrice = Number(trade.initial_entry_price ?? trade.entry_price)

  const preExecs = execs.filter((e) => dayKey(e.executed_at) <= cutoffDay)
  const held = replay(initialQty, initialPrice, preExecs)
  const preSellQty = preExecs
    .filter((e) => e.execution_type !== 'buy')
    .reduce((s, e) => s + Number(e.quantity), 0)

  return { initialQty, initialPrice, preExecs, heldQty: held.qty, heldCost: held.cap, preSellQty }
}

/* ─────────────────────────────────────────────────────────────
   COMPONENTE
───────────────────────────────────────────────────────────── */

export default function SpinoffModal({
  onClose,
  allOpenTickers,
  portfolios,
  onApplied,
}: SpinoffModalProps) {

  const [spinoffType, setSpinoffType] =
    useState<'with_reduction' | 'without_reduction'>('without_reduction')

  const [spinoffDate, setSpinoffDate] = useState(todayLocal())

  const [spinoffOriginal, setSpinoffOriginal] = useState('')
  const [spinoffNoOrigin, setSpinoffNoOrigin] = useState(false)
  const [spinoffPortfolio, setSpinoffPortfolio] = useState('')
  const [spinoffNew, setSpinoffNew] = useState('')

  const [spinoffRatio, setSpinoffRatio] = useState('')
  const [spinoffQtyReductionRatio, setSpinoffQtyReductionRatio] = useState('')
  const [spinoffNewPrice, setSpinoffNewPrice] = useState('')
  const [spinoffOriginalNewPrice, setSpinoffOriginalNewPrice] = useState('')

  const [preview, setPreview] = useState<PreviewRow[]>([])
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const inp: React.CSSProperties = {
    width: '100%',
    padding: '10px',
    marginBottom: 14,
    background: '#000',
    color: 'white',
    border: '1px solid #333',
    borderRadius: 6,
    outline: 'none',
    boxSizing: 'border-box',
    fontSize: 13,
  }

  const lbl: React.CSSProperties = {
    display: 'block',
    fontSize: 10,
    color: '#888',
    marginBottom: 5,
    fontWeight: 700,
    letterSpacing: 0.5,
  }

  const cellLabel: React.CSSProperties = { padding: '6px 12px', fontSize: 11, color: '#aaa' }
  const cellBefore: React.CSSProperties = { padding: '6px 12px', fontSize: 11, color: '#888' }

  // Cualquier cambio en un campo invalida la vista previa
  const edit = (setter: (v: any) => void) => (value: any) => {
    setter(value)
    setPreview([])
    setNotice('')
  }

  const portfolioName = (id: string | null) =>
    portfolios.find((p) => p.id === id)?.name || '—'

  /* =========================================================
     PREVISUALIZAR SPIN-OFF
  ========================================================= */

  const previewSpinoff = async () => {
    const newTick = spinoffNew.trim().toUpperCase()
    const ratio = parseFloat(spinoffRatio)
    const newPrice = parseFloat(spinoffNewPrice)

    setNotice('')
    if (!newTick || isNaN(ratio) || ratio <= 0) return

    // Con precio 0 la nueva posición no se crearía (antes se omitía sin avisar)
    if (isNaN(newPrice) || newPrice <= 0) {
      setNotice('Indica el costo promedio inicial de la nueva empresa (mayor que 0).')
      return
    }
    if (!spinoffNoOrigin && !spinoffDate) {
      setNotice('Indica la fecha del spin-off.')
      return
    }

    setLoading(true)

    try {
      // ── SIN EMPRESA ORIGEN ──
      if (spinoffNoOrigin) {
        setPreview([{
          id: null,
          ticker: '—',
          portfolioId: null,
          qtyOriginal: 0,
          qtyPre: 0,
          originalQtyAfter: 0,
          avgBefore: null,
          avgAfter: null,
          qtyNew: ratio,
          priceNew: newPrice,
          noOrigin: true,
        }])
        return
      }

      const original = spinoffOriginal.trim().toUpperCase()
      if (!original) return

      let keepRatio = 1
      let originalNewPrice = 0
      if (spinoffType === 'with_reduction') {
        keepRatio = parseFloat(spinoffQtyReductionRatio)
        if (isNaN(keepRatio) || keepRatio <= 0 || keepRatio > 1) {
          setNotice('Indica la fracción de acciones originales que conservas (entre 0 y 1).')
          return
        }
        originalNewPrice = parseFloat(spinoffOriginalNewPrice)
        if (isNaN(originalNewPrice) || originalNewPrice <= 0) {
          setNotice('Indica el costo promedio de la empresa original después del spin-off.')
          return
        }
      }

      const trades = must<any[]>(await supabase
        .from('trades')
        .select('id, ticker, quantity, entry_price, initial_entry_price, initial_quantity, total_invested, portfolio_id, open_date')
        .eq('ticker', original)
        .eq('status', 'open'))

      if (!trades.length) {
        setPreview([])
        setNotice(`No hay posiciones abiertas de ${original}.`)
        return
      }

      // Una posición abierta DESPUÉS de la fecha del spin-off no tiene derecho a las acciones nuevas
      const eligible = trades.filter((t) => dayKey(t.open_date) <= spinoffDate)
      const excluded = trades.length - eligible.length
      if (!eligible.length) {
        setPreview([])
        setNotice(`Todas las posiciones de ${original} se abrieron después del ${spinoffDate}: no les corresponde el spin-off.`)
        return
      }

      // Una sola consulta para las ejecuciones de todos los trades (antes: una por trade)
      const allExecs = must<any[]>(await supabase
        .from('trade_executions')
        .select('*')
        .in('trade_id', eligible.map((t) => t.id))
        .order('executed_at', { ascending: true }))

      const rows: PreviewRow[] = []

      for (const tr of eligible) {
        const execs = allExecs.filter((e) => e.trade_id === tr.id)
        const a = analyzeTrade(tr, execs, spinoffDate)

        if (spinoffType === 'with_reduction' && a.preSellQty > 0) {
          setPreview([])
          setNotice(
            `La posición en "${portfolioName(tr.portfolio_id)}" tiene ventas anteriores al spin-off. ` +
            `El modo "Con reducción" todavía no soporta ajustar ventas históricas: usa "Sin reducción" o ajústala a mano.`
          )
          return
        }

        const originalQtyAfter = a.heldQty * keepRatio
        const avgBefore = a.heldQty > 0 ? a.heldCost / a.heldQty : null

        rows.push({
          id: tr.id,
          ticker: tr.ticker,
          portfolioId: tr.portfolio_id,
          qtyOriginal: Number(tr.quantity),
          qtyPre: r6(a.heldQty),
          originalQtyAfter: r6(originalQtyAfter),
          avgBefore: avgBefore != null ? r4(avgBefore) : null,
          avgAfter: spinoffType === 'with_reduction' ? r4(originalNewPrice) : (avgBefore != null ? r4(avgBefore) : null),
          qtyNew: r6(a.heldQty * ratio),
          priceNew: newPrice,
        })
      }

      setPreview(rows)
      if (excluded > 0) {
        setNotice(`${excluded} posición(es) de ${original} se abrieron después del ${spinoffDate} y quedaron fuera.`)
      }

    } catch (err) {
      console.error(err)
      setPreview([])
      setNotice('Error al calcular el spin-off: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setLoading(false)
    }
  }

  /* =========================================================
     APLICAR SPIN-OFF
     Son varias escrituras seguidas: cada una registra cómo deshacerse, y si algo falla a la mitad
     todo se revierte (antes un error dejaba costos y cantidades a medio ajustar).
  ========================================================= */

  const applySpinoff = async () => {
    if (!preview.length || saving) return

    if (!spinoffPortfolio) {
      alert('Selecciona el portafolio donde registrar la nueva empresa')
      return
    }

    setSaving(true)
    const undo: Array<() => Promise<void>> = []

    // UPDATE que guarda su propia reversa
    const update = async (table: string, id: string, values: Record<string, any>, previous: Record<string, any>) => {
      const { error } = await supabase.from(table).update(values).eq('id', id)
      if (error) throw new Error(error.message)
      undo.push(async () => {
        const { error: e } = await supabase.from(table).update(previous).eq('id', id)
        if (e) throw new Error(e.message)
      })
    }

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('No autenticado')

      const newTicker = spinoffNew.trim().toUpperCase()
      const original = spinoffOriginal.trim().toUpperCase()

      // No se crean dos posiciones abiertas del mismo ticker en el mismo portafolio
      const existing = must<any[]>(await supabase
        .from('trades')
        .select('id')
        .eq('portfolio_id', spinoffPortfolio)
        .eq('ticker', newTicker)
        .eq('status', 'open')
        .limit(1))
      if (existing.length) {
        throw new Error(`Ya tienes una posición abierta de ${newTicker} en ese portafolio. Ciérrala o elige otro portafolio.`)
      }

      // ── 1) Nueva empresa: UNA sola posición con la suma de todas las acciones recibidas ──
      // (si la original estaba en varios portafolios antes se creaban varias posiciones duplicadas)
      const totalQtyNew = r6(preview.reduce((s, r) => s + r.qtyNew, 0))
      const priceNew = preview[0].priceNew
      if (!(totalQtyNew > 0) || !(priceNew > 0)) throw new Error('Cantidad o costo de la nueva empresa inválidos')

      const noOrigin = preview[0].noOrigin === true

      const insertRes = await supabase
        .from('trades')
        .insert({
          user_id: user.id,
          portfolio_id: spinoffPortfolio,
          ticker: newTicker,
          type: 'long',
          status: 'open',

          quantity: totalQtyNew,
          entry_price: priceNew,

          initial_quantity: totalQtyNew,
          initial_entry_price: priceNew,

          total_invested: r4(totalQtyNew * priceNew),

          open_date: noOrigin ? todayLocal() : spinoffDate,

          notes: noOrigin
            ? 'Spin-off recibido — empresa origen no registrada'
            : `Spin-off de ${original} — fecha ${spinoffDate}`,
        })
        .select('id')
        .single()
      if (insertRes.error) throw new Error(insertRes.error.message)
      const newTradeId = insertRes.data.id
      undo.push(async () => {
        const { error: e } = await supabase.from('trades').delete().eq('id', newTradeId)
        if (e) throw new Error(e.message)
      })

      // ── 2) Ajuste de la empresa original (solo "Con reducción") ──
      if (!noOrigin && spinoffType === 'with_reduction') {
        const keepRatio = parseFloat(spinoffQtyReductionRatio)
        const originalNewPrice = parseFloat(spinoffOriginalNewPrice)
        if (isNaN(keepRatio) || keepRatio <= 0 || keepRatio > 1 || isNaN(originalNewPrice) || originalNewPrice <= 0) {
          throw new Error('Datos de reducción inválidos')
        }

        const ids = preview.map((r) => r.id as string)

        // Se vuelve a leer todo: si algo cambió desde la vista previa se aborta en vez de ajustar con datos viejos
        const trades = must<any[]>(await supabase.from('trades').select('*').in('id', ids))
        const allExecs = must<any[]>(await supabase
          .from('trade_executions')
          .select('*')
          .in('trade_id', ids)
          .order('executed_at', { ascending: true }))

        for (const row of preview) {
          const trade = trades.find((t) => t.id === row.id)
          if (!trade) throw new Error('Una de las posiciones ya no existe. Vuelve a previsualizar.')
          if (trade.status !== 'open' || Number(trade.quantity) !== row.qtyOriginal) {
            throw new Error(`La posición en "${portfolioName(row.portfolioId)}" cambió desde la vista previa. Vuelve a previsualizar.`)
          }

          const execs = allExecs.filter((e) => e.trade_id === trade.id)
          const a = analyzeTrade(trade, execs, spinoffDate)
          if (a.preSellQty > 0) throw new Error('Hay ventas anteriores al spin-off: no se puede ajustar con reducción.')

          // Costo histórico del tramo previo al spin-off → el costo nuevo que indica el broker
          const newQtyAfter = a.heldQty * keepRatio
          const costFactor = a.heldCost > 0 ? (newQtyAfter * originalNewPrice) / a.heldCost : 1

          // Apertura: cantidad y costo ajustados (se conserva la proporción de cada lote)
          const oldInitialCost = a.initialQty * a.initialPrice
          const newInitialQty = r6(a.initialQty * keepRatio)
          const newInitialCost = oldInitialCost * costFactor
          const newInitialPrice = newInitialQty > 0 ? r6(newInitialCost / newInitialQty) : r6(originalNewPrice)

          // Recompras anteriores al spin-off: se ajustan y se anotan sus valores anteriores para poder revertir
          const adjusted: any[] = []
          for (const e of execs) {
            const isPreBuy = e.execution_type === 'buy' && dayKey(e.executed_at) <= spinoffDate
            if (!isPreBuy) { adjusted.push(e); continue }

            const oldCommission = Number(e.commission || 0)
            const newQty = r6(Number(e.quantity) * keepRatio)
            const newLotCost = lotCost(e) * costFactor
            const newCommission = r4(oldCommission * costFactor)
            const newGross = r4(newLotCost - newCommission)
            const newPrice = newQty > 0 ? r6(newGross / newQty) : 0

            await update(
              'trade_executions',
              e.id,
              { quantity: newQty, price: newPrice, total: newGross, commission: newCommission },
              { quantity: e.quantity, price: e.price, total: e.total, commission: e.commission }
            )
            adjusted.push({ ...e, quantity: newQty, price: newPrice, total: newGross, commission: newCommission })
          }

          // Recalcula el trade completo en memoria con lo ya ajustado (sin volver a consultar)
          const final = replay(newInitialQty, newInitialPrice, adjusted)
          const finalAvg = final.qty > 0 ? final.cap / final.qty : 0

          await update(
            'trades',
            trade.id,
            {
              initial_quantity: newInitialQty,
              initial_entry_price: newInitialPrice,
              quantity: r6(final.qty),
              total_invested: r4(final.cap),
              entry_price: r4(finalAvg),
              realized_pnl: r4(final.pnl),
              status: final.qty > 0 ? 'open' : 'closed',
            },
            {
              initial_quantity: trade.initial_quantity,
              initial_entry_price: trade.initial_entry_price,
              quantity: trade.quantity,
              total_invested: trade.total_invested,
              entry_price: trade.entry_price,
              realized_pnl: trade.realized_pnl,
              status: trade.status,
            }
          )
        }
      }

      alert('Spin-off aplicado correctamente.')
      onApplied()
      onClose()

    } catch (err) {
      console.error(err)

      // Reversa en orden inverso; si alguna reversa falla se avisa claramente
      let failedUndo = 0
      for (const fn of undo.reverse()) {
        try { await fn() } catch (e) { failedUndo++; console.error('Error al revertir:', e) }
      }

      const base = err instanceof Error ? err.message : String(err)
      alert(
        failedUndo === 0
          ? `Error al aplicar el spin-off: ${base}\n\nNo se guardó ningún cambio.`
          : `Error al aplicar el spin-off: ${base}\n\n⚠️ No se pudieron revertir ${failedUndo} cambio(s). Revisa la posición de ${spinoffOriginal} y la de ${spinoffNew} antes de volver a intentar.`
      )

    } finally {
      setSaving(false)
    }
  }

  /* =========================================================
     RENDER
  ========================================================= */

  const noOriginRow = preview[0]?.noOrigin === true
  const totalNew = preview.reduce((s, r) => s + r.qtyNew, 0)

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      background: 'rgba(0,0,0,0.88)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 1000
    }}>

      <div style={{
        background: '#111',
        padding: 26,
        borderRadius: 14,
        width: 'min(540px, 94vw)',
        maxHeight: '88vh',
        overflowY: 'auto',
        border: '1px solid #222'
      }}>

        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20
        }}>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <GitBranch size={16} color="#a78bfa" />
            <h2 style={{ margin: 0, fontSize: 15 }}>
              Registrar Spin-off
            </h2>
          </div>

          <button
            onClick={onClose}
            disabled={saving}
            aria-label="Cerrar"
            style={{
              background: 'none',
              border: 'none',
              color: '#888',
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.4 : 1,
              fontSize: 16
            }}
          >
            ✕
          </button>

        </div>

        {/* TIPO */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
          marginBottom: 16
        }}>
          {([
            {
              value: 'without_reduction',
              label: 'Sin reducción',
              desc: 'La empresa original conserva todas sus acciones.'
            },
            {
              value: 'with_reduction',
              label: 'Con reducción',
              desc: 'Se ajustan cantidades y costos históricos.'
            },
          ] as const).map(t => (
            <button
              key={t.value}
              onClick={() => {
                setSpinoffType(t.value)
                setPreview([])
                setNotice('')
              }}
              style={{
                background: spinoffType === t.value ? 'rgba(167,139,250,0.1)' : '#0a0a0a',
                border: `1px solid ${spinoffType === t.value ? '#a78bfa' : '#222'}`,
                color: spinoffType === t.value ? '#a78bfa' : '#888',
                padding: '10px',
                borderRadius: 8,
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: 11,
                textAlign: 'left',
              }}
            >
              {t.label}
              <div style={{
                fontSize: 9,
                fontWeight: 400,
                marginTop: 3,
                opacity: 0.7,
                lineHeight: 1.4
              }}>
                {t.desc}
              </div>
            </button>
          ))}
        </div>

        <label style={lbl}>Fecha del spin-off</label>
        <input
          type="date"
          value={spinoffDate}
          onChange={e => edit(setSpinoffDate)(e.target.value)}
          style={inp}
          disabled={spinoffNoOrigin}
        />

        {!spinoffNoOrigin && (
          <>
            <label style={lbl}>Ticker original</label>
            <select
              value={spinoffOriginal}
              onChange={e => edit(setSpinoffOriginal)(e.target.value)}
              style={inp}
            >
              <option value="">Selecciona ticker...</option>
              {allOpenTickers.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </>
        )}

        <label style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'pointer',
          fontSize: 11,
          color: '#666',
          marginBottom: 12
        }}>
          <input
            type="checkbox"
            checked={spinoffNoOrigin}
            onChange={e => {
              setSpinoffNoOrigin(e.target.checked)
              setSpinoffOriginal('')
              setPreview([])
              setNotice('')
            }}
          />
          Se desconoce la empresa origen
        </label>

        <label style={lbl}>Portafolio de la nueva empresa</label>
        <select
          value={spinoffPortfolio}
          onChange={e => setSpinoffPortfolio(e.target.value)}
          style={inp}
        >
          <option value="">Selecciona portafolio...</option>
          {portfolios.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <label style={lbl}>Ticker nuevo</label>
        <input
          placeholder="Ej: HONA"
          value={spinoffNew}
          onChange={e => edit(setSpinoffNew)(e.target.value.toUpperCase())}
          style={inp}
        />

        <label style={lbl}>
          {spinoffNoOrigin
            ? 'Cantidad de acciones recibidas'
            : 'Ratio: acciones nuevas por cada acción original'}
        </label>
        <input
          type="number"
          min="0.000001"
          step="0.000001"
          value={spinoffRatio}
          onChange={e => edit(setSpinoffRatio)(e.target.value)}
          style={inp}
        />

        <label style={lbl}>Costo promedio inicial de la nueva empresa (USD)</label>
        <input
          type="number"
          min="0"
          step="0.0001"
          value={spinoffNewPrice}
          onChange={e => edit(setSpinoffNewPrice)(e.target.value)}
          style={inp}
        />

        {spinoffType === 'with_reduction' && !spinoffNoOrigin && (
          <>
            <label style={lbl}>
              Costo promedio de {spinoffOriginal || 'la empresa original'} después del spin-off
            </label>
            <input
              type="number"
              min="0"
              step="0.0001"
              value={spinoffOriginalNewPrice}
              onChange={e => edit(setSpinoffOriginalNewPrice)(e.target.value)}
              style={inp}
            />

            <label style={lbl}>Fracción de acciones originales que conservas</label>
            <input
              type="number"
              min="0.000001"
              max="1"
              step="0.000001"
              value={spinoffQtyReductionRatio}
              onChange={e => edit(setSpinoffQtyReductionRatio)(e.target.value)}
              style={inp}
            />
          </>
        )}

        {notice && (
          <div style={{
            background: 'rgba(234,179,8,0.08)',
            border: '1px solid rgba(234,179,8,0.35)',
            color: '#eab308',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 11,
            lineHeight: 1.5,
            marginBottom: 12,
          }}>
            {notice}
          </div>
        )}

        <button
          onClick={previewSpinoff}
          disabled={
            loading ||
            saving ||
            (!spinoffNoOrigin && !spinoffOriginal) ||
            !spinoffNew ||
            !spinoffRatio ||
            !spinoffNewPrice
          }
          style={{
            width: '100%',
            padding: 10,
            background: '#1a1a2e',
            color: '#a78bfa',
            border: '1px solid #a78bfa',
            borderRadius: 8,
            fontWeight: 700,
            cursor: 'pointer',
            fontSize: 12,
            marginBottom: 14,
          }}
        >
          {loading ? 'Calculando...' : 'Previsualizar spin-off'}
        </button>

        {preview.length > 0 && (
          <>
            <div style={{
              fontSize: 10,
              color: '#aaa',
              fontWeight: 700,
              marginBottom: 8
            }}>
              {noOriginRow
                ? 'Se creará la posición nueva'
                : `${preview.length} posición(es) afectada(s) → se creará 1 posición de ${spinoffNew} con ${r6(totalNew)} acciones`}
            </div>

            <div style={{
              background: '#050505',
              border: '1px solid #1a1a1a',
              borderRadius: 8,
              overflow: 'hidden',
              marginBottom: 12
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#0a0a0a' }}>
                    {['Campo', 'Antes', 'Después'].map(h => (
                      <th
                        key={h}
                        style={{
                          padding: '7px 12px',
                          fontSize: 9,
                          color: '#888',
                          fontWeight: 700,
                          textAlign: 'left',
                          borderBottom: '1px solid #111'
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {preview.map((tr, i) => (
                    <Fragment key={tr.id ?? `row-${i}`}>

                      {!tr.noOrigin && (
                        <tr>
                          <td colSpan={3} style={{
                            padding: '8px 12px 2px',
                            fontSize: 9,
                            color: '#a78bfa',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            letterSpacing: 0.5,
                            borderTop: i > 0 ? '1px solid #111' : undefined,
                          }}>
                            {portfolioName(tr.portfolioId)}
                          </td>
                        </tr>
                      )}

                      {!tr.noOrigin && (
                        <>
                          <tr>
                            <td style={cellLabel}>Cantidad {spinoffOriginal}</td>
                            <td style={cellBefore}>{tr.qtyPre}</td>
                            <td style={{ padding: '6px 12px', fontSize: 11, color: '#eab308', fontWeight: 600 }}>
                              {tr.originalQtyAfter}
                            </td>
                          </tr>

                          <tr>
                            <td style={cellLabel}>Costo promedio {spinoffOriginal}</td>
                            <td style={cellBefore}>{tr.avgBefore != null ? `$${tr.avgBefore}` : '—'}</td>
                            <td style={{ padding: '6px 12px', fontSize: 11, color: '#eab308', fontWeight: 600 }}>
                              {tr.avgAfter != null ? `$${tr.avgAfter}` : '—'}
                            </td>
                          </tr>
                        </>
                      )}

                      <tr>
                        <td style={cellLabel}>Cantidad {spinoffNew}</td>
                        <td style={cellBefore}>—</td>
                        <td style={{ padding: '6px 12px', fontSize: 11, color: '#a78bfa', fontWeight: 600 }}>
                          {tr.qtyNew}
                        </td>
                      </tr>

                      <tr>
                        <td style={cellLabel}>Costo inicial {spinoffNew}</td>
                        <td style={cellBefore}>—</td>
                        <td style={{ padding: '6px 12px', fontSize: 11, color: '#22c55e', fontWeight: 600 }}>
                          ${tr.priceNew}
                        </td>
                      </tr>

                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              onClick={applySpinoff}
              disabled={saving}
              style={{
                width: '100%',
                padding: 12,
                background: '#a78bfa',
                color: '#000',
                border: 'none',
                borderRadius: 8,
                fontWeight: 900,
                cursor: saving ? 'not-allowed' : 'pointer',
                fontSize: 13,
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? 'Aplicando...' : 'Confirmar spin-off'}
            </button>
          </>
        )}

      </div>
    </div>
  )
}