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
  hasExecData: boolean
  qtyOriginal: number
  qtyPre: number
  qtyPost: number
  investedPre: number
  investedPost: number
  originalQtyAfter: number
  qtyNew: number
  priceNew: number
  totalInvested: number
  priceOriginalAfter: number
  noOrigin?: boolean
}

export default function SpinoffModal({ onClose, allOpenTickers, portfolios, onApplied }: SpinoffModalProps) {
  const [spinoffType, setSpinoffType] = useState<'with_reduction' | 'without_reduction'>('without_reduction')
  const [spinoffDate, setSpinoffDate] = useState(new Date().toISOString().split('T')[0])
  const [spinoffOriginal, setSpinoffOriginal] = useState('')
  const [spinoffNoOrigin, setSpinoffNoOrigin] = useState(false)
  const [spinoffPortfolio, setSpinoffPortfolio] = useState('')
  const [spinoffNew, setSpinoffNew] = useState('')
  const [spinoffRatio, setSpinoffRatio] = useState('') // acciones nuevas por cada acción original
  const [spinoffQtyReductionRatio, setSpinoffQtyReductionRatio] = useState('') // fracción que conservas de la original (independiente del ratio de arriba)
  const [spinoffNewPrice, setSpinoffNewPrice] = useState('')
  const [spinoffOriginalNewPrice, setSpinoffOriginalNewPrice] = useState('')

  const [preview, setPreview] = useState<PreviewRow[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const inp: React.CSSProperties = { width: '100%', padding: '10px', marginBottom: 14, background: '#000', color: 'white', border: '1px solid #333', borderRadius: 6, outline: 'none', boxSizing: 'border-box', fontSize: 13 }
  const lbl: React.CSSProperties = { display: 'block', fontSize: 10, color: '#888', marginBottom: 5, fontWeight: 700, letterSpacing: 0.5 }

  const previewSpinoff = useCallback(async () => {
    const newTick = spinoffNew.trim().toUpperCase()
    const ratio = parseFloat(spinoffRatio)
    if (!newTick || isNaN(ratio) || ratio <= 0) return
    if (!spinoffNoOrigin && !spinoffDate) { alert('Indica la fecha del spin-off'); return }
    setLoading(true)

    // Caso sin empresa origen — preview sintético
    if (spinoffNoOrigin) {
      setPreview([{
        id: null,
        ticker: '—',
        portfolioId: null,
        hasExecData: false,
        qtyOriginal: 0,
        qtyPre: 0,
        qtyPost: 0,
        investedPre: 0,
        investedPost: 0,
        originalQtyAfter: 0,
        qtyNew: ratio,
        priceNew: parseFloat(spinoffNewPrice || '0'),
        totalInvested: 0,
        priceOriginalAfter: 0,
        noOrigin: true,
      }])
      setLoading(false)
      return
    }

    const original = spinoffOriginal.trim().toUpperCase()
    if (!original) { setLoading(false); return }

    const { data: trades } = await supabase
      .from('trades')
      .select('id,ticker,quantity,entry_price,initial_entry_price,initial_quantity,total_invested,portfolio_id')
      .eq('ticker', original)
      .eq('status', 'open')
    if (!trades?.length) { setPreview([]); setLoading(false); return }

    const cutoff = new Date(spinoffDate + 'T23:59:59').getTime()
    const qtyReductionRatio = spinoffType === 'with_reduction'
      ? (parseFloat(spinoffQtyReductionRatio) || 1)
      : 1

    const rows: PreviewRow[] = []

    for (const tr of trades) {
      const { data: execs } = await supabase
        .from('trade_executions')
        .select('id,execution_type,quantity,price,executed_at')
        .eq('trade_id', tr.id)

      const preBuys = (execs || []).filter(e => e.execution_type === 'buy' && new Date(e.executed_at).getTime() <= cutoff)
      const postBuys = (execs || []).filter(e => e.execution_type === 'buy' && new Date(e.executed_at).getTime() > cutoff)

      const qtyPre = preBuys.reduce((a, e) => a + Number(e.quantity), 0)
      const qtyPost = postBuys.reduce((a, e) => a + Number(e.quantity), 0)
      const investedPre = preBuys.reduce((a, e) => a + Number(e.quantity) * Number(e.price), 0)
      const investedPost = postBuys.reduce((a, e) => a + Number(e.quantity) * Number(e.price), 0)

      // Si no hay ejecuciones o no cuadran con la cantidad actual, se trata todo como "antes"
      const hasExecData = (execs?.length || 0) > 0 && Math.abs((qtyPre + qtyPost) - Number(tr.quantity)) < 0.000001

      const effQtyPre = hasExecData ? qtyPre : Number(tr.quantity)
      const effQtyPost = hasExecData ? qtyPost : 0
      const effInvestedPre = hasExecData ? investedPre : Number(tr.total_invested)
      const effInvestedPost = hasExecData ? investedPost : 0

      rows.push({
        id: tr.id,
        ticker: tr.ticker,
        portfolioId: tr.portfolio_id,
        hasExecData,
        qtyOriginal: parseFloat(Number(tr.quantity).toFixed(6)),
        qtyPre: parseFloat(effQtyPre.toFixed(6)),
        qtyPost: parseFloat(effQtyPost.toFixed(6)),
        investedPre: parseFloat(effInvestedPre.toFixed(2)),
        investedPost: parseFloat(effInvestedPost.toFixed(2)),
        // Cantidad de la empresa ORIGINAL después del spin-off — su PROPIA fracción,
        // independiente del ratio de acciones nuevas.
        originalQtyAfter: parseFloat((effQtyPre * qtyReductionRatio).toFixed(6)),
        // Acciones de la empresa NUEVA — usa el ratio de distribución.
        qtyNew: parseFloat((effQtyPre * ratio).toFixed(6)),
        priceNew: parseFloat(spinoffNewPrice || '0'),
        totalInvested: tr.total_invested,
        priceOriginalAfter: spinoffType === 'with_reduction' && spinoffOriginalNewPrice
          ? parseFloat(parseFloat(spinoffOriginalNewPrice).toFixed(4))
          : Number(tr.entry_price),
      })
    }

    setPreview(rows)
    setLoading(false)
  }, [spinoffOriginal, spinoffNew, spinoffRatio, spinoffNewPrice, spinoffType, spinoffOriginalNewPrice, spinoffDate, spinoffNoOrigin, spinoffQtyReductionRatio])

  const applySpinoff = async () => {
    if (!preview.length) return
    if (!spinoffPortfolio) { alert('Selecciona el portafolio donde registrar la nueva empresa'); return }
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('No autenticado')

      for (const tr of preview) {
        // Caso sin origen — solo crear el nuevo trade
        if (tr.noOrigin) {
          const totalInvNew = parseFloat((tr.qtyNew * tr.priceNew).toFixed(2))
          await supabase.from('trades').insert({
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
            open_date: new Date().toLocaleDateString('sv-SE'),
            notes: `Spin-off recibido — empresa origen no registrada`,
          })
          continue
        }

        // Con reducción: ajustar SOLO la porción comprada antes del spin-off.
        // La porción posterior (recompras) se conserva intacta y se suma de vuelta.
        // initial_quantity / initial_entry_price representan ÚNICAMENTE el lote de
        // "Apertura" ajustado — nunca se mezclan con recompras posteriores.
        if (spinoffType === 'with_reduction' && tr.priceOriginalAfter > 0) {
          const adjustedPreQty = tr.originalQtyAfter
          const adjustedPrePrice = tr.priceOriginalAfter
          const finalQty = parseFloat((adjustedPreQty + tr.qtyPost).toFixed(6))
          const finalInvested = parseFloat((adjustedPreQty * adjustedPrePrice + tr.investedPost).toFixed(2))
          const finalAvgPrice = finalQty > 0 ? parseFloat((finalInvested / finalQty).toFixed(4)) : adjustedPrePrice

          await supabase.from('trades').update({
            entry_price: finalAvgPrice,
            initial_entry_price: adjustedPrePrice,
            quantity: finalQty,
            initial_quantity: adjustedPreQty,
            total_invested: finalInvested,
          }).eq('id', tr.id)
        }

        // Crear el nuevo trade para la empresa spin-off — solo con la porción elegible (pre-fecha)
        if (tr.priceNew > 0 && tr.qtyNew > 0) {
          const totalInvNew = parseFloat((tr.qtyNew * tr.priceNew).toFixed(2))
          await supabase.from('trades').insert({
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
            open_date: new Date().toLocaleDateString('sv-SE'),
            notes: `Spin-off de ${spinoffOriginal.toUpperCase()} — ratio ${spinoffRatio}:1 (fecha del spin-off: ${spinoffDate})`,
          })
        }
      }

      alert(`Spin-off aplicado. ${preview.length} trade(s) de ${spinoffNew.toUpperCase()} creados.`)
      onApplied()
      onClose()
    } catch (err) {
      alert('Error: ' + err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.88)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
      <div style={{ background: '#111', padding: 26, borderRadius: 14, width: 540, maxHeight: '88vh', overflowY: 'auto', border: '1px solid #222' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <GitBranch size={16} color="#a78bfa" />
            <h2 style={{ margin: 0, fontSize: 15 }}>Registrar Spin-off</h2>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>

        {/* Tipo de spin-off */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
          {([
            { value: 'without_reduction', label: 'Sin reducción', desc: 'La empresa original conserva todas sus acciones. Recibes acciones nuevas adicionales.' },
            { value: 'with_reduction', label: 'Con reducción', desc: 'Se reduce la cantidad y/o precio de la empresa original. Ej: HON → HON + HONA.' },
          ] as const).map(t => (
            <button key={t.value} onClick={() => { setSpinoffType(t.value); setPreview([]) }} style={{
              background: spinoffType === t.value ? 'rgba(167,139,250,0.1)' : '#0a0a0a',
              border: `1px solid ${spinoffType === t.value ? '#a78bfa' : '#222'}`,
              color: spinoffType === t.value ? '#a78bfa' : '#888',
              padding: '10px', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 11, textAlign: 'left',
            }}>
              {t.label}
              <div style={{ fontSize: 9, fontWeight: 400, marginTop: 3, opacity: 0.7, lineHeight: 1.4 }}>{t.desc}</div>
            </button>
          ))}
        </div>

        <label style={lbl}>Fecha del spin-off (según el broker/mercado)</label>
        <input type="date" value={spinoffDate}
          onChange={e => { setSpinoffDate(e.target.value); setPreview([]) }} style={inp} disabled={spinoffNoOrigin} />

        <label style={lbl}>Ticker original (empresa que hace spin-off)</label>
        {!spinoffNoOrigin && (
          <select value={spinoffOriginal} onChange={e => { setSpinoffOriginal(e.target.value); setPreview([]) }} style={inp}>
            <option value="">Selecciona ticker...</option>
            {allOpenTickers.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 11, color: '#666', marginBottom: 12 }}>
          <input type="checkbox" checked={spinoffNoOrigin} onChange={e => {
            setSpinoffNoOrigin(e.target.checked)
            setSpinoffOriginal('')
            setPreview([])
          }} />
          Se desconoce la empresa origen
        </label>

        <label style={lbl}>Portafolio donde registrar la nueva empresa</label>
        <select value={spinoffPortfolio} onChange={e => setSpinoffPortfolio(e.target.value)} style={inp}>
          <option value="">Selecciona portafolio...</option>
          {portfolios.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <label style={lbl}>Ticker nuevo (empresa que se separa)</label>
        <input placeholder="Ej: HONA" value={spinoffNew}
          onChange={e => { setSpinoffNew(e.target.value.toUpperCase()); setPreview([]) }} style={inp} />

        <label style={lbl}>
          {spinoffNoOrigin ? 'Cantidad de acciones recibidas' : 'Ratio: acciones nuevas por cada acción original'}
        </label>
        <input type="number" min="0.000001" step="0.000001"
          placeholder={spinoffNoOrigin ? 'Ej: 0.025' : 'Ej: 0.5 (1 nueva por cada 2 originales)'}
          value={spinoffRatio}
          onChange={e => { setSpinoffRatio(e.target.value); setPreview([]) }} style={inp} />

        <label style={lbl}>Precio de apertura de la nueva empresa (USD)</label>
        <input type="number" min="0" step="0.01" placeholder="0.00" value={spinoffNewPrice}
          onChange={e => { setSpinoffNewPrice(e.target.value); setPreview([]) }} style={inp} />

        {spinoffType === 'with_reduction' && !spinoffNoOrigin && (
          <>
            <label style={lbl}>Costo promedio de {spinoffOriginal || 'la empresa original'} después del spin-off (según tu broker)</label>
            <input type="number" min="0" step="0.01" placeholder="Ej: 206.55 (costo promedio según tu broker)"
              value={spinoffOriginalNewPrice}
              onChange={e => { setSpinoffOriginalNewPrice(e.target.value); setPreview([]) }} style={inp} />

            <label style={lbl}>Fracción de {spinoffOriginal || 'la empresa original'} que conservas (según tu broker — puede ser distinta al ratio de acciones nuevas)</label>
            <input type="number" min="0.0001" max="1" step="0.0001" placeholder="Ej: 0.5 (conservas la mitad de tus acciones originales)"
              value={spinoffQtyReductionRatio}
              onChange={e => { setSpinoffQtyReductionRatio(e.target.value); setPreview([]) }} style={inp} />
          </>
        )}

        <button onClick={previewSpinoff}
          disabled={loading || (!spinoffNoOrigin && !spinoffOriginal) || !spinoffNew || !spinoffRatio}
          style={{ width: '100%', padding: 10, background: '#1a1a2e', color: '#a78bfa', border: '1px solid #a78bfa', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: 12, marginBottom: 14, opacity: (!spinoffNoOrigin && !spinoffOriginal) || !spinoffNew || !spinoffRatio ? 0.4 : 1 }}>
          {loading ? 'Calculando...' : 'Previsualizar spin-off'}
        </button>

        {preview.length > 0 && (
          <>
            <div style={{ fontSize: 10, color: '#aaa', fontWeight: 700, marginBottom: 8 }}>
              {preview.length} posición(es) afectada(s)
            </div>
            <div style={{ background: '#050505', border: '1px solid #1a1a1a', borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#0a0a0a' }}>
                    {['Campo', 'Antes', 'Después'].map(h => (
                      <th key={h} style={{ padding: '7px 12px', fontSize: 9, color: '#888', fontWeight: 700, textAlign: 'left', borderBottom: '1px solid #111' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((tr, i) => (
                    <>
                      <tr key={`${i}-orig`} style={{ borderBottom: '1px solid #0a0a0a' }}>
                        <td style={{ padding: '6px 12px', fontSize: 11, color: '#aaa' }}>Cantidad {spinoffOriginal || 'original'}</td>
                        <td style={{ padding: '6px 12px', fontSize: 11, color: '#888' }}>
                          {tr.noOrigin ? '—' : `${tr.qtyPre}`}
                        </td>
                        <td style={{ padding: '6px 12px', fontSize: 11, color: '#eab308', fontWeight: 600 }}>
                          {tr.noOrigin ? '—' : tr.originalQtyAfter}
                        </td>
                      </tr>
                      {spinoffType === 'with_reduction' && !tr.noOrigin && (
                        <tr key={`${i}-p`} style={{ borderBottom: '1px solid #0a0a0a' }}>
                          <td style={{ padding: '6px 12px', fontSize: 11, color: '#aaa' }}>Precio {spinoffOriginal} ajustado</td>
                          <td style={{ padding: '6px 12px', fontSize: 11, color: '#888' }}>—</td>
                          <td style={{ padding: '6px 12px', fontSize: 11, color: '#eab308', fontWeight: 600 }}>${tr.priceOriginalAfter}</td>
                        </tr>
                      )}
                      <tr key={`${i}-new`} style={{ borderBottom: '1px solid #0a0a0a' }}>
                        <td style={{ padding: '6px 12px', fontSize: 11, color: '#aaa' }}>Cantidad {spinoffNew || 'nueva'}</td>
                        <td style={{ padding: '6px 12px', fontSize: 11, color: '#888' }}>—</td>
                        <td style={{ padding: '6px 12px', fontSize: 11, color: '#a78bfa', fontWeight: 600 }}>{tr.qtyNew}</td>
                      </tr>
                      <tr key={`${i}-np`} style={{ borderBottom: '1px solid #0a0a0a' }}>
                        <td style={{ padding: '6px 12px', fontSize: 11, color: '#aaa' }}>Precio apertura {spinoffNew || 'nueva'}</td>
                        <td style={{ padding: '6px 12px', fontSize: 11, color: '#888' }}>—</td>
                        <td style={{ padding: '6px 12px', fontSize: 11, color: '#22c55e', fontWeight: 600 }}>${tr.priceNew}</td>
                      </tr>
                    </>
                  ))}
                </tbody>
              </table>
            </div>
            <button onClick={applySpinoff} disabled={saving} style={{
              width: '100%', padding: 12, background: '#a78bfa', color: '#000',
              border: 'none', borderRadius: 8, fontWeight: 900, cursor: 'pointer', fontSize: 13,
              opacity: saving ? 0.6 : 1,
            }}>
              {saving ? 'Aplicando...' : 'Confirmar spin-off'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}