'use client'

import { useState, useCallback } from 'react'
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

  qtyOriginal: number
  qtyPre: number
  qtyPost: number

  investedPre: number
  investedPost: number

  initialQtyPre: number
  originalQtyAfter: number

  qtyNew: number
  priceNew: number

  originalCostAfter: number
  priceOriginalAfter: number

  totalInvested: number

  noOrigin?: boolean
}

export default function SpinoffModal({
  onClose,
  allOpenTickers,
  portfolios,
  onApplied,
}: SpinoffModalProps) {

  const [spinoffType, setSpinoffType] =
    useState<'with_reduction' | 'without_reduction'>('without_reduction')

  const [spinoffDate, setSpinoffDate] =
    useState(new Date().toISOString().split('T')[0])

  const [spinoffOriginal, setSpinoffOriginal] = useState('')
  const [spinoffNoOrigin, setSpinoffNoOrigin] = useState(false)
  const [spinoffPortfolio, setSpinoffPortfolio] = useState('')
  const [spinoffNew, setSpinoffNew] = useState('')

  const [spinoffRatio, setSpinoffRatio] = useState('')

  const [spinoffQtyReductionRatio, setSpinoffQtyReductionRatio] =
    useState('')

  const [spinoffNewPrice, setSpinoffNewPrice] = useState('')

  const [spinoffOriginalNewPrice, setSpinoffOriginalNewPrice] =
    useState('')

  const [preview, setPreview] = useState<PreviewRow[]>([])
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

  // =========================================================
  // PREVISUALIZAR SPIN-OFF
  // =========================================================

  const previewSpinoff = useCallback(async () => {

    const newTick = spinoffNew.trim().toUpperCase()
    const ratio = parseFloat(spinoffRatio)

    if (!newTick || isNaN(ratio) || ratio <= 0) return

    if (!spinoffNoOrigin && !spinoffDate) {
      alert('Indica la fecha del spin-off')
      return
    }

    setLoading(true)

    try {

      // =====================================================
      // SIN EMPRESA ORIGEN
      // =====================================================

      if (spinoffNoOrigin) {

        setPreview([{
          id: null,
          ticker: '—',
          portfolioId: null,

          qtyOriginal: 0,
          qtyPre: 0,
          qtyPost: 0,

          investedPre: 0,
          investedPost: 0,

          initialQtyPre: 0,
          originalQtyAfter: 0,

          qtyNew: ratio,
          priceNew: parseFloat(spinoffNewPrice || '0'),

          originalCostAfter: 0,
          priceOriginalAfter: 0,

          totalInvested: 0,

          noOrigin: true,
        }])

        return
      }

      const original = spinoffOriginal.trim().toUpperCase()

      if (!original) return

      const { data: trades, error: tradesError } = await supabase
        .from('trades')
        .select(`
          id,
          ticker,
          quantity,
          entry_price,
          initial_entry_price,
          initial_quantity,
          total_invested,
          portfolio_id,
          open_date
        `)
        .eq('ticker', original)
        .eq('status', 'open')

      if (tradesError) throw tradesError

      if (!trades?.length) {
        setPreview([])
        return
      }

      const cutoff =
        new Date(spinoffDate + 'T23:59:59').getTime()

      const qtyReductionRatio =
        spinoffType === 'with_reduction'
          ? parseFloat(spinoffQtyReductionRatio)
          : 1

      if (
        spinoffType === 'with_reduction' &&
        (
          isNaN(qtyReductionRatio) ||
          qtyReductionRatio <= 0 ||
          qtyReductionRatio > 1
        )
      ) {
        alert('Indica la fracción de acciones originales que conservas')
        return
      }

      const originalNewPrice =
        spinoffType === 'with_reduction'
          ? parseFloat(spinoffOriginalNewPrice)
          : 0

      if (
        spinoffType === 'with_reduction' &&
        (
          isNaN(originalNewPrice) ||
          originalNewPrice <= 0
        )
      ) {
        alert('Indica el costo promedio de la empresa original después del spin-off')
        return
      }

      const rows: PreviewRow[] = []

      for (const tr of trades) {

        const { data: execs, error: execError } = await supabase
          .from('trade_executions')
          .select('*')
          .eq('trade_id', tr.id)
          .order('executed_at', { ascending: true })

        if (execError) throw execError

        const initialQty =
          Number(tr.initial_quantity ?? tr.quantity)

        const initialPrice =
          Number(tr.initial_entry_price ?? tr.entry_price)

        const initialInvested =
          initialQty * initialPrice

        const buysPre = (execs || []).filter(e =>
          e.execution_type === 'buy' &&
          new Date(e.executed_at).getTime() <= cutoff
        )

        const buysPost = (execs || []).filter(e =>
          e.execution_type === 'buy' &&
          new Date(e.executed_at).getTime() > cutoff
        )

        const qtyPreExec = buysPre.reduce(
          (sum, e) => sum + Number(e.quantity),
          0
        )

        const qtyPost = buysPost.reduce(
          (sum, e) => sum + Number(e.quantity),
          0
        )

        const investedPreExec = buysPre.reduce(
          (sum, e) =>
            sum +
            Number(e.total ?? Number(e.quantity) * Number(e.price)) +
            Number(e.commission || 0),
          0
        )

        const investedPost = buysPost.reduce(
          (sum, e) =>
            sum +
            Number(e.total ?? Number(e.quantity) * Number(e.price)) +
            Number(e.commission || 0),
          0
        )

        // -----------------------------------------------------
        // TODO EL CAPITAL ANTERIOR AL SPIN-OFF
        // -----------------------------------------------------

        const qtyPre =
          initialQty + qtyPreExec

        const investedPre =
          initialInvested + investedPreExec

        // -----------------------------------------------------
        // CANTIDAD ORIGINAL DESPUÉS DEL SPIN-OFF
        // -----------------------------------------------------

        const originalQtyAfter =
          spinoffType === 'with_reduction'
            ? qtyPre * qtyReductionRatio
            : qtyPre

        // -----------------------------------------------------
        // NUEVAS ACCIONES RECIBIDAS
        // -----------------------------------------------------

        const qtyNew =
          qtyPre * ratio

        // -----------------------------------------------------
        // COSTO DE HON DESPUÉS DEL SPIN-OFF
        //
        // El precio proporcionado por el broker representa
        // el costo promedio final de la porción anterior.
        // -----------------------------------------------------

        const originalCostAfter =
          spinoffType === 'with_reduction'
            ? originalQtyAfter * originalNewPrice
            : investedPre

        rows.push({

          id: tr.id,
          ticker: tr.ticker,
          portfolioId: tr.portfolio_id,

          qtyOriginal: Number(tr.quantity),

          qtyPre: parseFloat(qtyPre.toFixed(6)),
          qtyPost: parseFloat(qtyPost.toFixed(6)),

          investedPre: parseFloat(investedPre.toFixed(4)),
          investedPost: parseFloat(investedPost.toFixed(4)),

          initialQtyPre: initialQty,

          originalQtyAfter:
            parseFloat(originalQtyAfter.toFixed(6)),

          qtyNew:
            parseFloat(qtyNew.toFixed(6)),

          priceNew:
            parseFloat(spinoffNewPrice || '0'),

          originalCostAfter:
            parseFloat(originalCostAfter.toFixed(4)),

          priceOriginalAfter:
            spinoffType === 'with_reduction'
              ? parseFloat(originalNewPrice.toFixed(4))
              : initialPrice,

          totalInvested:
            Number(tr.total_invested),
        })
      }

      setPreview(rows)

    } catch (err) {

      console.error(err)
      alert('Error al calcular el spin-off')

    } finally {

      setLoading(false)

    }

  }, [
    spinoffOriginal,
    spinoffNew,
    spinoffRatio,
    spinoffNewPrice,
    spinoffType,
    spinoffOriginalNewPrice,
    spinoffDate,
    spinoffNoOrigin,
    spinoffQtyReductionRatio,
  ])


  // =========================================================
  // APLICAR SPIN-OFF
  // =========================================================

  const applySpinoff = async () => {

    if (!preview.length) return

    if (!spinoffPortfolio) {
      alert('Selecciona el portafolio donde registrar la nueva empresa')
      return
    }

    setSaving(true)

    try {

      const {
        data: { user }
      } = await supabase.auth.getUser()

      if (!user) throw new Error('No autenticado')

      const cutoff =
        new Date(spinoffDate + 'T23:59:59').getTime()

      const qtyReductionRatio =
        spinoffType === 'with_reduction'
          ? parseFloat(spinoffQtyReductionRatio)
          : 1


      // =====================================================
      // RECORRER TRADES AFECTADOS
      // =====================================================

      for (const tr of preview) {

        // ===================================================
        // SIN EMPRESA ORIGEN
        // ===================================================

        if (tr.noOrigin) {

          const totalInvNew =
            parseFloat(
              (tr.qtyNew * tr.priceNew).toFixed(4)
            )

          const { data: newTrade, error } =
            await supabase
              .from('trades')
              .insert({
                user_id: user.id,
                portfolio_id: spinoffPortfolio,
                ticker: spinoffNew.trim().toUpperCase(),
                type: 'long',
                status: 'open',

                quantity: tr.qtyNew,
                entry_price: tr.priceNew,

                initial_quantity: tr.qtyNew,
                initial_entry_price: tr.priceNew,

                total_invested: totalInvNew,

                open_date: new Date()
                  .toLocaleDateString('sv-SE'),

                notes:
                  'Spin-off recibido — empresa origen no registrada',
              })
              .select()
              .single()

          if (error) throw error

          continue
        }


        // ===================================================
        // OBTENER TRADE ORIGINAL
        // ===================================================

        const { data: originalTrade, error: tradeError } =
          await supabase
            .from('trades')
            .select('*')
            .eq('id', tr.id)
            .single()

        if (tradeError) throw tradeError


        const { data: executions, error: execError } =
          await supabase
            .from('trade_executions')
            .select('*')
            .eq('trade_id', tr.id)
            .order('executed_at', { ascending: true })

        if (execError) throw execError


        // ===================================================
        // AJUSTAR HON
        // ===================================================

        if (spinoffType === 'with_reduction') {

          const oldInitialQty =
            Number(
              originalTrade.initial_quantity ??
              originalTrade.quantity
            )

          const oldInitialPrice =
            Number(
              originalTrade.initial_entry_price ??
              originalTrade.entry_price
            )

          const oldInitialCost =
            oldInitialQty * oldInitialPrice

          // -------------------------------------------------
          // NUEVA CANTIDAD DE APERTURA
          // -------------------------------------------------

          const newInitialQty =
            oldInitialQty * qtyReductionRatio

          // -------------------------------------------------
          // COSTO HISTÓRICO TOTAL ANTES DEL SPIN-OFF
          // -------------------------------------------------

          const preBuyExecutions =
            (executions || []).filter(e =>
              e.execution_type === 'buy' &&
              new Date(e.executed_at).getTime() <= cutoff
            )

          const oldPreExecCost =
            preBuyExecutions.reduce(
              (sum, e) =>
                sum +
                Number(e.total ?? Number(e.quantity) * Number(e.price)) +
                Number(e.commission || 0),
              0
            )

          const oldTotalPreCost =
            oldInitialCost + oldPreExecCost


          // -------------------------------------------------
          // NUEVO COSTO TOTAL DE HON
          // -------------------------------------------------

          const newTotalPreCost =
            tr.originalCostAfter


          // -------------------------------------------------
          // FACTOR DE REDISTRIBUCIÓN DEL COSTO
          //
          // Conserva proporcionalmente el costo de cada lote.
          // -------------------------------------------------

          const costFactor =
            oldTotalPreCost > 0
              ? newTotalPreCost / oldTotalPreCost
              : 1


          // -------------------------------------------------
          // AJUSTAR PRECIO DE LA APERTURA
          // -------------------------------------------------

          const newInitialCost =
            oldInitialCost * costFactor

          const newInitialPrice =
            newInitialQty > 0
              ? newInitialCost / newInitialQty
              : tr.priceOriginalAfter


          // -------------------------------------------------
          // ACTUALIZAR APERTURA EN TRADES
          // -------------------------------------------------

          const { error: updateTradeError } =
            await supabase
              .from('trades')
              .update({

                initial_quantity:
                  parseFloat(newInitialQty.toFixed(6)),

                initial_entry_price:
                  parseFloat(newInitialPrice.toFixed(4)),

              })
              .eq('id', tr.id)

          if (updateTradeError) throw updateTradeError


          // =================================================
          // AJUSTAR RECOMPRAS ANTERIORES AL SPIN-OFF
          // =================================================

          for (const exec of (executions || [])) {

            if (
              exec.execution_type !== 'buy' ||
              new Date(exec.executed_at).getTime() > cutoff
            ) continue


            const oldQty =
              Number(exec.quantity)

            const oldPrice =
              Number(exec.price)

            const oldCommission =
              Number(exec.commission || 0)

            const oldGross =
              Number(
                exec.total ??
                oldQty * oldPrice
              )

            // -----------------------------------------------
            // NUEVA CANTIDAD
            // -----------------------------------------------

            const newQty =
              oldQty * qtyReductionRatio


            // -----------------------------------------------
            // NUEVO COSTO DEL LOTE
            // -----------------------------------------------

            const oldLotCost =
              oldGross + oldCommission

            const newLotCost =
              oldLotCost * costFactor


            // -----------------------------------------------
            // NUEVO PRECIO
            // -----------------------------------------------

            const newCommission =
              oldCommission * costFactor

            const newGross =
              newLotCost - newCommission

            const newPrice =
              newQty > 0
                ? newGross / newQty
                : 0


            const { error: updateExecError } =
              await supabase
                .from('trade_executions')
                .update({

                  quantity:
                    parseFloat(newQty.toFixed(6)),

                  price:
                    parseFloat(newPrice.toFixed(4)),

                  total:
                    parseFloat(newGross.toFixed(4)),

                  commission:
                    parseFloat(newCommission.toFixed(4)),

                })
                .eq('id', exec.id)

            if (updateExecError) throw updateExecError
          }


          // =================================================
          // RECALCULAR COMPLETAMENTE EL TRADE
          // =================================================

          const { data: adjustedTrade } =
            await supabase
              .from('trades')
              .select('*')
              .eq('id', tr.id)
              .single()

          const { data: adjustedExecs } =
            await supabase
              .from('trade_executions')
              .select('*')
              .eq('trade_id', tr.id)
              .order('executed_at', {
                ascending: true
              })


          let cQty =
            Number(adjustedTrade.initial_quantity)

          let cCap =
            cQty *
            Number(adjustedTrade.initial_entry_price)

          let cPnl = 0


          for (const e of (adjustedExecs || [])) {

            const q =
              Number(e.quantity)

            const p =
              Number(e.price)

            const comm =
              Number(e.commission || 0)

            const gross =
              Number(
                e.total ??
                q * p
              )


            if (e.execution_type === 'buy') {

              cQty += q
              cCap += gross + comm

            } else {

              const avgCost =
                cQty > 0
                  ? cCap / cQty
                  : 0

              const cost =
                q * avgCost

              const net =
                gross - comm

              cQty -= q
              cCap -= cost
              cPnl += net - cost
            }
          }


          const finalAvg =
            cQty > 0
              ? cCap / cQty
              : 0


          const { error: finalUpdateError } =
            await supabase
              .from('trades')
              .update({

                quantity:
                  parseFloat(cQty.toFixed(6)),

                total_invested:
                  parseFloat(cCap.toFixed(4)),

                entry_price:
                  parseFloat(finalAvg.toFixed(4)),

                realized_pnl:
                  parseFloat(cPnl.toFixed(4)),

                status:
                  cQty > 0
                    ? 'open'
                    : 'closed',

              })
              .eq('id', tr.id)

          if (finalUpdateError) throw finalUpdateError
        }


        // ===================================================
        // CREAR LA NUEVA EMPRESA
        // ===================================================

        if (
          tr.qtyNew > 0 &&
          tr.priceNew > 0
        ) {

          const totalInvNew =
            parseFloat(
              (tr.qtyNew * tr.priceNew).toFixed(4)
            )


          const { error: newTradeError } =
            await supabase
              .from('trades')
              .insert({

                user_id:
                  user.id,

                portfolio_id:
                  spinoffPortfolio,

                ticker:
                  spinoffNew
                    .trim()
                    .toUpperCase(),

                type:
                  'long',

                status:
                  'open',

                quantity:
                  tr.qtyNew,

                entry_price:
                  tr.priceNew,

                initial_quantity:
                  tr.qtyNew,

                initial_entry_price:
                  tr.priceNew,

                total_invested:
                  totalInvNew,

                open_date:
                  spinoffDate,

                notes:
                  `Spin-off de ${spinoffOriginal.toUpperCase()} — fecha ${spinoffDate}`,

              })

          if (newTradeError) throw newTradeError
        }
      }


      alert(
        `Spin-off aplicado correctamente.`
      )

      onApplied()
      onClose()

    } catch (err) {

      console.error(err)

      alert(
        'Error al aplicar el spin-off: ' +
        (err instanceof Error
          ? err.message
          : String(err))
      )

    } finally {

      setSaving(false)

    }
  }


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
        width: 540,
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

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}>
            <GitBranch size={16} color="#a78bfa" />
            <h2 style={{ margin: 0, fontSize: 15 }}>
              Registrar Spin-off
            </h2>
          </div>

          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#888',
              cursor: 'pointer',
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
              }}
              style={{
                background:
                  spinoffType === t.value
                    ? 'rgba(167,139,250,0.1)'
                    : '#0a0a0a',

                border:
                  `1px solid ${
                    spinoffType === t.value
                      ? '#a78bfa'
                      : '#222'
                  }`,

                color:
                  spinoffType === t.value
                    ? '#a78bfa'
                    : '#888',

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


        <label style={lbl}>
          Fecha del spin-off
        </label>

        <input
          type="date"
          value={spinoffDate}
          onChange={e => {
            setSpinoffDate(e.target.value)
            setPreview([])
          }}
          style={inp}
          disabled={spinoffNoOrigin}
        />


        <label style={lbl}>
          Ticker original
        </label>

        {!spinoffNoOrigin && (

          <select
            value={spinoffOriginal}
            onChange={e => {
              setSpinoffOriginal(e.target.value)
              setPreview([])
            }}
            style={inp}
          >

            <option value="">
              Selecciona ticker...
            </option>

            {allOpenTickers.map(t => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}

          </select>

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
            }}
          />

          Se desconoce la empresa origen

        </label>


        <label style={lbl}>
          Portafolio de la nueva empresa
        </label>

        <select
          value={spinoffPortfolio}
          onChange={e =>
            setSpinoffPortfolio(e.target.value)
          }
          style={inp}
        >

          <option value="">
            Selecciona portafolio...
          </option>

          {portfolios.map(p => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}

        </select>


        <label style={lbl}>
          Ticker nuevo
        </label>

        <input
          placeholder="Ej: HONA"
          value={spinoffNew}
          onChange={e => {
            setSpinoffNew(
              e.target.value.toUpperCase()
            )
            setPreview([])
          }}
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
          onChange={e => {
            setSpinoffRatio(e.target.value)
            setPreview([])
          }}
          style={inp}
        />


        <label style={lbl}>
          Costo promedio inicial de la nueva empresa (USD)
        </label>

        <input
          type="number"
          min="0"
          step="0.0001"
          value={spinoffNewPrice}
          onChange={e => {
            setSpinoffNewPrice(e.target.value)
            setPreview([])
          }}
          style={inp}
        />


        {spinoffType === 'with_reduction' &&
          !spinoffNoOrigin && (

          <>

            <label style={lbl}>
              Costo promedio de {spinoffOriginal || 'la empresa original'} después del spin-off
            </label>

            <input
              type="number"
              min="0"
              step="0.0001"
              value={spinoffOriginalNewPrice}
              onChange={e => {
                setSpinoffOriginalNewPrice(e.target.value)
                setPreview([])
              }}
              style={inp}
            />


            <label style={lbl}>
              Fracción de acciones originales que conservas
            </label>

            <input
              type="number"
              min="0.000001"
              max="1"
              step="0.000001"
              value={spinoffQtyReductionRatio}
              onChange={e => {
                setSpinoffQtyReductionRatio(e.target.value)
                setPreview([])
              }}
              style={inp}
            />

          </>

        )}


        <button
          onClick={previewSpinoff}

          disabled={
            loading ||
            (!spinoffNoOrigin && !spinoffOriginal) ||
            !spinoffNew ||
            !spinoffRatio
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

          {loading
            ? 'Calculando...'
            : 'Previsualizar spin-off'}

        </button>


        {preview.length > 0 && (

          <>

            <div style={{
              fontSize: 10,
              color: '#aaa',
              fontWeight: 700,
              marginBottom: 8
            }}>
              {preview.length} posición(es) afectada(s)
            </div>


            <div style={{
              background: '#050505',
              border: '1px solid #1a1a1a',
              borderRadius: 8,
              overflow: 'hidden',
              marginBottom: 12
            }}>

              <table style={{
                width: '100%',
                borderCollapse: 'collapse'
              }}>

                <thead>

                  <tr style={{
                    background: '#0a0a0a'
                  }}>

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

                    <>

                      <tr key={`${i}-orig`}>

                        <td style={{
                          padding: '6px 12px',
                          fontSize: 11,
                          color: '#aaa'
                        }}>
                          Cantidad {spinoffOriginal}
                        </td>

                        <td style={{
                          padding: '6px 12px',
                          fontSize: 11,
                          color: '#888'
                        }}>
                          {tr.qtyPre}
                        </td>

                        <td style={{
                          padding: '6px 12px',
                          fontSize: 11,
                          color: '#eab308',
                          fontWeight: 600
                        }}>
                          {tr.originalQtyAfter}
                        </td>

                      </tr>


                      <tr key={`${i}-price`}>

                        <td style={{
                          padding: '6px 12px',
                          fontSize: 11,
                          color: '#aaa'
                        }}>
                          Costo promedio {spinoffOriginal}
                        </td>

                        <td style={{
                          padding: '6px 12px',
                          fontSize: 11,
                          color: '#888'
                        }}>
                          —
                        </td>

                        <td style={{
                          padding: '6px 12px',
                          fontSize: 11,
                          color: '#eab308',
                          fontWeight: 600
                        }}>
                          ${tr.priceOriginalAfter}
                        </td>

                      </tr>


                      <tr key={`${i}-new`}>

                        <td style={{
                          padding: '6px 12px',
                          fontSize: 11,
                          color: '#aaa'
                        }}>
                          Cantidad {spinoffNew}
                        </td>

                        <td style={{
                          padding: '6px 12px',
                          fontSize: 11,
                          color: '#888'
                        }}>
                          —
                        </td>

                        <td style={{
                          padding: '6px 12px',
                          fontSize: 11,
                          color: '#a78bfa',
                          fontWeight: 600
                        }}>
                          {tr.qtyNew}
                        </td>

                      </tr>


                      <tr key={`${i}-newprice`}>

                        <td style={{
                          padding: '6px 12px',
                          fontSize: 11,
                          color: '#aaa'
                        }}>
                          Costo inicial {spinoffNew}
                        </td>

                        <td style={{
                          padding: '6px 12px',
                          fontSize: 11,
                          color: '#888'
                        }}>
                          —
                        </td>

                        <td style={{
                          padding: '6px 12px',
                          fontSize: 11,
                          color: '#22c55e',
                          fontWeight: 600
                        }}>
                          ${tr.priceNew}
                        </td>

                      </tr>

                    </>

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
                cursor: 'pointer',
                fontSize: 13,
                opacity: saving ? 0.6 : 1,
              }}
            >

              {saving
                ? 'Aplicando...'
                : 'Confirmar spin-off'}

            </button>

          </>

        )}

      </div>

    </div>

  )
}