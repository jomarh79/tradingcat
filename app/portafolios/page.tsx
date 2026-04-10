'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { usePrivacy } from '@/lib/PrivacyContext'
import AppShell from '../AppShell'
import Link from 'next/link'
import { Wallet, Plus, GitBranch, History } from 'lucide-react'

const GRUPOS: Record<string, { label: string, color: string, desc: string }> = {
  largo:   { label: 'Largo plazo + ETFs',        color: '#22c55e', desc: 'El gato paciente acumula la mayor riqueza' },
  mediano: { label: 'Mediano plazo',              color: '#00bfff', desc: 'El gato estratega mueve con precisión' },
  corto:   { label: 'Corto plazo + Especulativo', color: '#f43f5e', desc: 'El gato ágil caza oportunidades rápidas' },
}

// SVG huella — único elemento de tema de gatos
const Paw = ({ size = 14, color = '#444', opacity = 1 }: any) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ opacity, flexShrink: 0 }}>
    <ellipse cx="6"  cy="5"  rx="2.5" ry="3"/>
    <ellipse cx="11" cy="3"  rx="2.5" ry="3"/>
    <ellipse cx="16" cy="4"  rx="2.5" ry="3"/>
    <ellipse cx="19" cy="9"  rx="2"   ry="2.5"/>
    <path d="M12 22c-5 0-8-3-8-7 0-2.5 1.5-4.5 4-5.5 1-.4 2-.6 4-.6s3 .2 4 .6c2.5 1 4 3 4 5.5 0 4-3 7-8 7z"/>
  </svg>
)

export default function PortafoliosPage() {
  const { money } = usePrivacy()

  const [user,        setUser]        = useState<any>(null)
  const [portfolios,  setPortfolios]  = useState<any[]>([])
  const [showModal,   setShowModal]   = useState(false)
  const [newName,     setNewName]     = useState('')
  const [newDate,     setNewDate]     = useState(new Date().toISOString().split('T')[0])
  const [newGrupo,    setNewGrupo]    = useState('mediano')

  const [deleteId,        setDeleteId]        = useState<string | null>(null)
  const [confirmPassword, setConfirmPassword] = useState('')
  const [movementWallet,  setMovementWallet]  = useState<any>(null)
  const [isDividend,      setIsDividend]      = useState(false)
  const [isOtherTicker,   setIsOtherTicker]   = useState(false)
  const [selectedTicker,  setSelectedTicker]  = useState('')
  const [movementAmount,  setMovementAmount]  = useState('')
  const [movementDate,    setMovementDate]    = useState(new Date().toISOString().split('T')[0])
  const [movementNotes,   setMovementNotes]   = useState('')
  const [walletTickers,   setWalletTickers]   = useState<string[]>([])

  const [walletSaldos,      setWalletSaldos]      = useState<Record<string, number>>({})
  const [walletDepositos,   setWalletDepositos]   = useState<Record<string, number>>({})
  const [walletLastMove,    setWalletLastMove]    = useState<Record<string, string>>({})
  const [walletMoveCount,   setWalletMoveCount]   = useState<Record<string, number>>({})

  // Split
  const [showSplit,      setShowSplit]      = useState(false)
  const [splitTicker,    setSplitTicker]    = useState('')
  const [splitType,      setSplitType]      = useState<'split' | 'reverse'>('split')
  const [splitFrom,      setSplitFrom]      = useState('')
  const [splitTo,        setSplitTo]        = useState('')
  const [splitPreview,   setSplitPreview]   = useState<any[]>([])
  const [splitLoading,   setSplitLoading]   = useState(false)
  const [splitSaving,    setSplitSaving]    = useState(false)
  const [allOpenTickers, setAllOpenTickers] = useState<string[]>([])

  const fetchPortfolios = useCallback(async (userId: string) => {
    const { data: pData } = await supabase
      .from('portfolios').select('*').eq('user_id', userId).order('created_at', { ascending: false })
    if (pData) setPortfolios(pData)

    // Paginación completa
    let all: any[] = []
    let from = 0
    while (true) {
      const { data } = await supabase
        .from('wallet_movements')
        .select('wallet_id, amount, movement_type, date')
        .eq('user_id', userId)
        .range(from, from + 999)
      if (!data?.length) break
      all = [...all, ...data]
      if (data.length < 1000) break
      from += 1000
    }

    const saldos:    Record<string, number> = {}
    const depositos: Record<string, number> = {}
    const lastMove:  Record<string, string> = {}
    const counts:    Record<string, number> = {}

    all.forEach(m => {
      const id  = m.wallet_id
      const amt = Number(m.amount)
      saldos[id]  = (saldos[id]  || 0) + amt
      counts[id]  = (counts[id]  || 0) + 1
      if (m.movement_type === 'deposito' || m.movement_type === 'retiro') {
        depositos[id] = (depositos[id] || 0) + amt
      }
      if (!lastMove[id] || m.date > lastMove[id]) lastMove[id] = m.date
    })

    setWalletSaldos(saldos)
    setWalletDepositos(depositos)
    setWalletLastMove(lastMove)
    setWalletMoveCount(counts)

    const { data: tData } = await supabase.from('trades').select('ticker').eq('status', 'open')
    if (tData) setAllOpenTickers(Array.from(new Set(tData.map((t: any) => t.ticker))).sort() as string[])
  }, [])

  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getUser()
      if (data.user) { setUser(data.user); fetchPortfolios(data.user.id) }
    }
    init()
  }, [fetchPortfolios])

  useEffect(() => {
    if (!movementWallet) return
    setMovementDate(new Date().toISOString().split('T')[0])
    supabase.from('trades').select('ticker').eq('portfolio_id', movementWallet.id).eq('status', 'open').then(({ data }) => {
      if (data) setWalletTickers(Array.from(new Set(data.map((t: any) => t.ticker))).sort() as string[])
    })
  }, [movementWallet])

  const grouped = useMemo(() => {
    const map: Record<string, any[]> = { largo: [], mediano: [], corto: [], sin_grupo: [] }
    portfolios.forEach(p => { const g = p.grupo || 'sin_grupo'; if (!map[g]) map[g] = []; map[g].push(p) })
    return map
  }, [portfolios])

  const groupTotals = useMemo(() => {
    const result: Record<string, { saldo: number, deposito: number }> = {}
    Object.entries(grouped).forEach(([g, ps]) => {
      result[g] = {
        saldo:    ps.reduce((a, p) => a + (walletSaldos[p.id]    || 0), 0),
        deposito: ps.reduce((a, p) => a + (walletDepositos[p.id] || 0), 0),
      }
    })
    return result
  }, [grouped, walletSaldos, walletDepositos])

  const totalSaldo    = useMemo(() => portfolios.reduce((a, p) => a + (walletSaldos[p.id]    || 0), 0), [portfolios, walletSaldos])
  const totalDeposito = useMemo(() => portfolios.reduce((a, p) => a + (walletDepositos[p.id] || 0), 0), [portfolios, walletDepositos])

  const handleCreate = async () => {
    if (!newName || !newDate) return alert('Completa todos los campos')
    await supabase.from('portfolios').insert([{ name: newName, created_at: newDate, user_id: user.id, grupo: newGrupo }])
    setShowModal(false); setNewName(''); fetchPortfolios(user.id)
  }

  const resetMovementModal = () => {
    setMovementWallet(null); setMovementAmount(''); setMovementNotes('')
    setIsDividend(false); setIsOtherTicker(false); setSelectedTicker('')
    setMovementDate(new Date().toISOString().split('T')[0])
  }

  const handleMovement = async (type: 'deposito' | 'retiro') => {
    if (!movementWallet || !movementAmount || !movementDate) return alert('Monto y fecha son obligatorios')
    if (isDividend && !selectedTicker) return alert('El ticker es obligatorio para dividendos')
    const rawAmount   = parseFloat(Number(movementAmount).toFixed(2))
    const finalAmount = type === 'retiro' ? -Math.abs(rawAmount) : Math.abs(rawAmount)
    const { error } = await supabase.from('wallet_movements').insert([{
      wallet_id: movementWallet.id, user_id: user.id, amount: finalAmount,
      movement_type: isDividend ? 'dividend' : type, is_dividend: isDividend,
      ticker: isDividend ? selectedTicker.toUpperCase() : null,
      notes: movementNotes || null, date: movementDate,
    }])
    if (error) alert(error.message)
    else { resetMovementModal(); fetchPortfolios(user.id) }
  }

  const handleDelete = async () => {
    const { error: le } = await supabase.auth.signInWithPassword({ email: user.email, password: confirmPassword })
    if (le) return alert('Contraseña incorrecta')
    await supabase.from('portfolios').delete().eq('id', deleteId)
    setDeleteId(null); setConfirmPassword(''); fetchPortfolios(user.id)
  }

  // Split
  const previewSplit = useCallback(async () => {
    const ticker = splitTicker.trim().toUpperCase()
    const f = parseFloat(splitFrom), t = parseFloat(splitTo)
    if (!ticker || isNaN(f) || isNaN(t) || f <= 0 || t <= 0) return
    setSplitLoading(true)
    const { data: trades } = await supabase
      .from('trades').select('id,ticker,quantity,entry_price,initial_entry_price,initial_quantity,stop_loss,take_profit_1,take_profit_2,take_profit_3,total_invested')
      .eq('ticker', ticker).eq('status', 'open')
    if (!trades?.length) { setSplitPreview([]); setSplitLoading(false); return }
    const qR = splitType === 'split' ? t / f : f / t
    const pR = splitType === 'split' ? f / t : t / f
    setSplitPreview(trades.map(tr => ({
      id: tr.id, ticker: tr.ticker,
      qtyBefore: parseFloat(Number(tr.quantity).toFixed(6)),
      priceBefore: parseFloat(Number(tr.entry_price).toFixed(4)),
      qtyAfter:       parseFloat((Number(tr.quantity)            * qR).toFixed(6)),
      priceAfter:     parseFloat((Number(tr.entry_price)         * pR).toFixed(4)),
      initPriceAfter: parseFloat((Number(tr.initial_entry_price) * pR).toFixed(4)),
      initQtyAfter:   parseFloat((Number(tr.initial_quantity)    * qR).toFixed(6)),
      stopAfter:  tr.stop_loss     ? parseFloat((Number(tr.stop_loss)     * pR).toFixed(4)) : null,
      tp1After:   tr.take_profit_1 ? parseFloat((Number(tr.take_profit_1) * pR).toFixed(4)) : null,
      tp2After:   tr.take_profit_2 ? parseFloat((Number(tr.take_profit_2) * pR).toFixed(4)) : null,
      tp3After:   tr.take_profit_3 ? parseFloat((Number(tr.take_profit_3) * pR).toFixed(4)) : null,
      totalInvested: tr.total_invested,
    })))
    setSplitLoading(false)
  }, [splitTicker, splitFrom, splitTo, splitType])

  const applySplit = async () => {
    if (!splitPreview.length) return
    setSplitSaving(true)
    try {
      const f = parseFloat(splitFrom), t = parseFloat(splitTo)
      const qR = splitType === 'split' ? t / f : f / t
      const pR = splitType === 'split' ? f / t : t / f
      for (const tr of splitPreview) {
        await supabase.from('trades').update({
          quantity: tr.qtyAfter, initial_quantity: tr.initQtyAfter,
          entry_price: tr.priceAfter, initial_entry_price: tr.initPriceAfter,
          stop_loss: tr.stopAfter, take_profit_1: tr.tp1After,
          take_profit_2: tr.tp2After, take_profit_3: tr.tp3After,
        }).eq('id', tr.id)
        const { data: execs } = await supabase.from('trade_executions').select('id,price,quantity').eq('trade_id', tr.id)
        if (execs?.length) {
          for (const e of execs) {
            await supabase.from('trade_executions').update({
              price:    parseFloat((Number(e.price)    * pR).toFixed(4)),
              quantity: parseFloat((Number(e.quantity) * qR).toFixed(6)),
            }).eq('id', e.id)
          }
        }
      }
      alert(`Split aplicado a ${splitPreview.length} trade(s) de ${splitTicker.toUpperCase()}.`)
      setShowSplit(false); setSplitPreview([]); setSplitTicker(''); setSplitFrom(''); setSplitTo('')
    } catch (err) { alert('Error: ' + err) }
    finally { setSplitSaving(false) }
  }

  const fmtDate = (d: string) => d
    ? new Date(d + 'T00:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—'

  return (
    <AppShell>
      <div style={{ color: 'white', padding: '28px 36px', maxWidth: 1280, margin: '0 auto' }}>

        {/* ── HEADER ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <Wallet size={20} color="#00bfff" />
              <h1 style={{ fontSize: 20, fontWeight: 900, margin: 0 }}>Gestión de billeteras</h1>
              <Paw size={14} color="#00bfff" opacity={0.4} />
            </div>
            {/* Totales globales */}
            <div style={{ display: 'flex', gap: 24, marginTop: 4 }}>
              <div>
                <div style={{ fontSize: 9, color: '#444', fontWeight: 700, letterSpacing: 0.5, marginBottom: 2 }}>SALDO DISPONIBLE TOTAL</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: totalSaldo >= 0 ? '#22c55e' : '#f43f5e' }}>{money(totalSaldo)}</div>
              </div>
              <div style={{ width: 1, background: '#1a1a1a', margin: '0 4px' }} />
              <div>
                <div style={{ fontSize: 9, color: '#444', fontWeight: 700, letterSpacing: 0.5, marginBottom: 2 }}>CAPITAL DEPOSITADO TOTAL</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: '#00bfff' }}>{money(totalDeposito)}</div>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setShowSplit(true)} style={splitBtn}>
              <GitBranch size={13} /> Registrar Split
            </button>
            <button onClick={() => setShowModal(true)} style={createBtn}>
              <Plus size={14} /> Nueva billetera
            </button>
          </div>
        </div>

        {/* ── TABLAS POR GRUPO ── */}
        {Object.entries(GRUPOS).map(([grupoKey, grupoInfo]) => {
          const ps = grouped[grupoKey] || []
          if (!ps.length) return null
          const gt = groupTotals[grupoKey] || { saldo: 0, deposito: 0 }
          return (
            <div key={grupoKey} style={{ marginBottom: 32 }}>

              {/* Header del grupo con totales */}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginBottom: 10, paddingBottom: 8, borderBottom: `1px solid ${grupoInfo.color}22`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Paw size={13} color={grupoInfo.color} opacity={0.7} />
                  <span style={{ fontSize: 11, fontWeight: 800, color: grupoInfo.color, letterSpacing: 0.8, textTransform: 'uppercase' as const }}>
                    {grupoInfo.label}
                  </span>
                  <span style={{ fontSize: 10, color: '#333' }}>· {ps.length} billetera{ps.length !== 1 ? 's' : ''}</span>
                </div>
                <div style={{ display: 'flex', gap: 20 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 8, color: '#444', letterSpacing: 0.5 }}>SALDO GRUPO</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: gt.saldo >= 0 ? '#22c55e' : '#f43f5e' }}>{money(gt.saldo)}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 8, color: '#444', letterSpacing: 0.5 }}>DEPOSITADO GRUPO</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#00bfff' }}>{money(gt.deposito)}</div>
                  </div>
                </div>
              </div>

              {/* Tabla */}
              <div style={tableWrap}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#0d0d0d' }}>
                      <th style={th}>Billetera</th>
                      <th style={{ ...th, textAlign: 'right' }}>Saldo disponible</th>
                      <th style={{ ...th, textAlign: 'right' }}>Capital depositado</th>
                      <th style={{ ...th, textAlign: 'right' }}>Movimientos</th>
                      <th style={{ ...th, textAlign: 'right' }}>Último movimiento</th>
                      <th style={{ ...th, textAlign: 'right' }}>Creada</th>
                      <th style={{ ...th, textAlign: 'center' }}>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ps.map(p => {
                      const saldo    = walletSaldos[p.id]    || 0
                      const deposito = walletDepositos[p.id] || 0
                      const lastMove = walletLastMove[p.id]
                      const count    = walletMoveCount[p.id] || 0
                      return (
                        <tr key={p.id} style={trStyle}>
                          <td style={td}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                              <Paw size={11} color={grupoInfo.color} opacity={0.5} />
                              <span style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</span>
                            </div>
                          </td>
                          <td style={{ ...td, textAlign: 'right' }}>
                            <div style={{ fontWeight: 700, color: saldo >= 0 ? '#22c55e' : '#f43f5e', fontSize: 14 }}>{money(saldo)}</div>
                            <div style={{ fontSize: 9, color: '#444', marginTop: 1 }}>para operar</div>
                          </td>
                          <td style={{ ...td, textAlign: 'right' }}>
                            <div style={{ fontWeight: 700, color: '#00bfff', fontSize: 13 }}>{money(deposito)}</div>
                            <div style={{ fontSize: 9, color: '#444', marginTop: 1 }}>de tu bolsillo</div>
                          </td>
                          <td style={{ ...td, textAlign: 'right', color: '#555', fontSize: 12 }}>{count}</td>
                          <td style={{ ...td, textAlign: 'right', color: '#555', fontSize: 12 }}>
                            {lastMove ? fmtDate(lastMove) : '—'}
                          </td>
                          <td style={{ ...td, textAlign: 'right', color: '#444', fontSize: 12 }}>
                            {fmtDate(p.created_at)}
                          </td>
                          <td style={{ ...td, textAlign: 'center' }}>
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                              <button onClick={() => setMovementWallet(p)} style={actionBtn('#1b4d20', '#22c55e')}>
                                Movimientos
                              </button>
                              <Link href={`/billeteras/${p.id}/historial`}>
                                <button style={actionBtn('#0d1a2e', '#00bfff')}>
                                  <History size={11} style={{ marginRight: 4 }} />
                                  Historial
                                </button>
                              </Link>
                              <button onClick={() => setDeleteId(p.id)} style={actionBtn('#2d1010', '#f43f5e')}>
                                Eliminar
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })}

        {/* Sin grupo */}
        {(grouped['sin_grupo'] || []).length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 10, color: '#333', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Paw size={10} color="#333" opacity={0.5} />
              Sin grupo asignado
            </div>
            <div style={tableWrap}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#0d0d0d' }}>
                    <th style={th}>Billetera</th>
                    <th style={{ ...th, textAlign: 'right' }}>Saldo disponible</th>
                    <th style={{ ...th, textAlign: 'right' }}>Capital depositado</th>
                    <th style={{ ...th, textAlign: 'right' }}>Movimientos</th>
                    <th style={{ ...th, textAlign: 'center' }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {(grouped['sin_grupo'] || []).map(p => (
                    <tr key={p.id} style={trStyle}>
                      <td style={{ ...td, fontWeight: 600 }}>{p.name}</td>
                      <td style={{ ...td, textAlign: 'right', color: '#22c55e', fontWeight: 700 }}>{money(walletSaldos[p.id] || 0)}</td>
                      <td style={{ ...td, textAlign: 'right', color: '#00bfff', fontWeight: 700 }}>{money(walletDepositos[p.id] || 0)}</td>
                      <td style={{ ...td, textAlign: 'right', color: '#555', fontSize: 12 }}>{walletMoveCount[p.id] || 0}</td>
                      <td style={{ ...td, textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                          <button onClick={() => setMovementWallet(p)} style={actionBtn('#1b4d20', '#22c55e')}>Agregar Movimiento</button>
                          <Link href={`/billeteras/${p.id}/historial`}><button style={actionBtn('#0d1a2e', '#00bfff')}>Historial</button></Link>
                          <button onClick={() => setDeleteId(p.id)} style={actionBtn('#2d1010', '#f43f5e')}>Eliminar</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ════ MODAL SPLIT ════ */}
        {showSplit && (
          <div style={overlay}>
            <div style={{ ...modalBox, width: 520, maxHeight: '88vh', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <GitBranch size={16} color="#eab308" />
                  <h2 style={{ margin: 0, fontSize: 15 }}>Registrar Split</h2>
                </div>
                <button onClick={() => { setShowSplit(false); setSplitPreview([]) }}
                  style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 16 }}>✕</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
                {(['split', 'reverse'] as const).map(t => (
                  <button key={t} onClick={() => { setSplitType(t); setSplitPreview([]) }} style={{
                    background: splitType === t ? (t === 'split' ? 'rgba(34,197,94,0.1)' : 'rgba(244,63,94,0.1)') : '#0a0a0a',
                    border: `1px solid ${splitType === t ? (t === 'split' ? '#22c55e' : '#f43f5e') : '#222'}`,
                    color:  splitType === t ? (t === 'split' ? '#22c55e' : '#f43f5e') : '#555',
                    padding: '10px', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 11,
                  }}>
                    {t === 'split' ? 'Split normal' : 'Reverse split'}
                    <div style={{ fontSize: 9, fontWeight: 400, marginTop: 3, opacity: 0.7 }}>
                      {t === 'split' ? 'Más acciones, menor precio' : 'Menos acciones, mayor precio'}
                    </div>
                  </button>
                ))}
              </div>
              <label style={lbl}>Ticker</label>
              <select value={splitTicker} onChange={e => { setSplitTicker(e.target.value); setSplitPreview([]) }} style={inp}>
                <option value="">Selecciona un ticker...</option>
                {allOpenTickers.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <label style={lbl}>Ratio ({splitType === 'split' ? 'Tenías : Tendrás' : 'Tendrás : Tenías'})</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <input type="number" min="1" placeholder="1" value={splitFrom}
                  onChange={e => { setSplitFrom(e.target.value); setSplitPreview([]) }} style={{ ...inp, marginBottom: 0 }} />
                <span style={{ color: '#444', fontSize: 16 }}>:</span>
                <input type="number" min="1" placeholder="2" value={splitTo}
                  onChange={e => { setSplitTo(e.target.value); setSplitPreview([]) }} style={{ ...inp, marginBottom: 0 }} />
              </div>
              <button onClick={previewSplit} disabled={splitLoading || !splitTicker || !splitFrom || !splitTo}
                style={{ width: '100%', padding: 10, background: '#1a2a1a', color: '#eab308', border: '1px solid #eab308', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: 12, marginBottom: 14, opacity: (!splitTicker || !splitFrom || !splitTo) ? 0.4 : 1 }}>
                {splitLoading ? 'Calculando...' : 'Previsualizar cambios'}
              </button>
              {splitPreview.length > 0 && (
                <>
                  <div style={{ fontSize: 10, color: '#444', fontWeight: 700, marginBottom: 8 }}>
                    {splitPreview.length} trade(s) afectado(s)
                  </div>
                  <div style={{ background: '#050505', border: '1px solid #1a1a1a', borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: '#0a0a0a' }}>
                          {['Campo','Antes','Después'].map(h => (
                            <th key={h} style={{ padding: '7px 12px', fontSize: 9, color: '#444', fontWeight: 700, textAlign: 'left', borderBottom: '1px solid #111' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {splitPreview.flatMap(t => [
                          { label: 'Cantidad',              before: t.qtyBefore,   after: t.qtyAfter },
                          { label: 'Precio entrada',        before: `$${t.priceBefore}`, after: `$${t.priceAfter}` },
                          { label: 'Capital (sin cambio)',  before: `$${Number(t.totalInvested).toFixed(2)}`, after: `$${Number(t.totalInvested).toFixed(2)}` },
                        ].map((row, ri) => (
                          <tr key={`${t.id}-${ri}`} style={{ borderBottom: '1px solid #0a0a0a' }}>
                            <td style={{ padding: '6px 12px', fontSize: 11, color: '#555' }}>{row.label}</td>
                            <td style={{ padding: '6px 12px', fontSize: 11, color: '#888' }}>{row.before}</td>
                            <td style={{ padding: '6px 12px', fontSize: 11, color: '#22c55e', fontWeight: 600 }}>{row.after}</td>
                          </tr>
                        )))}
                      </tbody>
                    </table>
                  </div>
                  <button onClick={applySplit} disabled={splitSaving} style={{
                    width: '100%', padding: 12, background: '#22c55e', color: '#000',
                    border: 'none', borderRadius: 8, fontWeight: 900, cursor: 'pointer', fontSize: 13,
                    opacity: splitSaving ? 0.6 : 1,
                  }}>
                    {splitSaving ? 'Aplicando...' : 'Confirmar y aplicar split'}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* ════ MODAL CREAR BILLETERA ════ */}
        {showModal && (
          <div style={overlay}>
            <div style={modalBox}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                <Paw size={16} color="#00bfff" opacity={0.7} />
                <h2 style={{ margin: 0, fontSize: 15 }}>Nueva billetera</h2>
              </div>
              <label style={lbl}>Nombre</label>
              <input placeholder="Ej: Largo Plazo ETFs" value={newName} onChange={e => setNewName(e.target.value)} style={inp} />
              <label style={lbl}>Fecha de creación</label>
              <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} style={inp} />
              <label style={lbl}>Grupo</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
                {Object.entries(GRUPOS).map(([key, g]) => (
                  <button key={key} onClick={() => setNewGrupo(key)} style={{
                    background: newGrupo === key ? `${g.color}18` : '#000',
                    border: `1px solid ${newGrupo === key ? g.color : '#222'}`,
                    color: newGrupo === key ? g.color : '#555',
                    padding: '8px 6px', borderRadius: 6, cursor: 'pointer', fontSize: 10, fontWeight: 700,
                  }}>
                    {key === 'largo' ? 'Largo / ETF' : key === 'mediano' ? 'Mediano' : 'Corto / Espec.'}
                  </button>
                ))}
              </div>
              <button onClick={handleCreate} style={saveBtn}>Guardar billetera</button>
              <button onClick={() => setShowModal(false)} style={cancelBtn}>Cancelar</button>
            </div>
          </div>
        )}

        {/* ════ MODAL MOVIMIENTOS ════ */}
        {movementWallet && (
          <div style={overlay}>
            <div style={modalBox}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <Paw size={16} color="#22c55e" opacity={0.7} />
                <h2 style={{ margin: 0, fontSize: 15 }}>Movimiento — {movementWallet.name}</h2>
              </div>
              {/* Saldo actual */}
              <div style={{ background: '#050505', border: '1px solid #1a1a1a', borderRadius: 8, padding: '10px 14px', marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 9, color: '#444', fontWeight: 700, letterSpacing: 0.5, marginBottom: 3 }}>SALDO DISPONIBLE</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: (walletSaldos[movementWallet.id] || 0) >= 0 ? '#22c55e' : '#f43f5e' }}>
                    {money(walletSaldos[movementWallet.id] || 0)}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 9, color: '#444', fontWeight: 700, letterSpacing: 0.5, marginBottom: 3 }}>DEPOSITADO</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: '#00bfff' }}>
                    {money(walletDepositos[movementWallet.id] || 0)}
                  </div>
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox" checked={isDividend}
                  onChange={e => { setIsDividend(e.target.checked); if (!e.target.checked) { setIsOtherTicker(false); setSelectedTicker('') } }} />
                Es un dividendo cobrado
              </label>
              {isDividend && (
                <div style={{ marginBottom: 14 }}>
                  {!isOtherTicker ? (
                    <select value={selectedTicker}
                      onChange={e => { if (e.target.value === 'OTRO') { setIsOtherTicker(true); setSelectedTicker('') } else setSelectedTicker(e.target.value) }}
                      style={inp}>
                      <option value="">Selecciona ticker...</option>
                      {walletTickers.map(t => <option key={t} value={t}>{t}</option>)}
                      <option value="OTRO">+ Otro (manual)</option>
                    </select>
                  ) : (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input placeholder="Ticker (ej: META)" value={selectedTicker}
                        onChange={e => setSelectedTicker(e.target.value.toUpperCase())}
                        style={{ ...inp, borderColor: '#00bfff', marginBottom: 0 }} autoFocus />
                      <button onClick={() => { setIsOtherTicker(false); setSelectedTicker('') }}
                        style={{ background: '#222', border: 'none', color: 'white', padding: '0 12px', borderRadius: 6, cursor: 'pointer' }}>✕</button>
                    </div>
                  )}
                </div>
              )}
              <label style={lbl}>Monto (USD)</label>
              <input type="number" placeholder="0.00" value={movementAmount} onChange={e => setMovementAmount(e.target.value)} style={inp} />
              <label style={lbl}>Fecha</label>
              <input type="date" value={movementDate} onChange={e => setMovementDate(e.target.value)} style={inp} />
              <label style={lbl}>Notas (opcional)</label>
              <textarea placeholder="Observaciones..." value={movementNotes} onChange={e => setMovementNotes(e.target.value)}
                style={{ ...inp, height: 64, resize: 'none' }} />
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => handleMovement('deposito')}
                  style={{ ...saveBtn, background: '#1b4332', color: '#4caf50', flex: 1 }}>
                  {isDividend ? 'Registrar dividendo' : 'Depósito'}
                </button>
                {!isDividend && (
                  <button onClick={() => handleMovement('retiro')}
                    style={{ ...saveBtn, background: '#431b1b', color: '#f44336', flex: 1 }}>
                    Retiro
                  </button>
                )}
              </div>
              <button onClick={resetMovementModal} style={cancelBtn}>Cerrar</button>
            </div>
          </div>
        )}

        {/* ════ MODAL ELIMINAR ════ */}
        {deleteId && (
          <div style={overlay}>
            <div style={modalBox}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <Paw size={16} color="#f43f5e" opacity={0.7} />
                <h2 style={{ color: '#ef4444', margin: 0, fontSize: 15 }}>Eliminar billetera</h2>
              </div>
              <p style={{ color: '#555', fontSize: 13, marginBottom: 16 }}>
                Esta acción es irreversible. Confirma tu contraseña para continuar:
              </p>
              <input type="password" placeholder="Tu contraseña" value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleDelete()} style={inp} />
              <button onClick={handleDelete} style={{ ...saveBtn, background: '#7f1d1d', color: '#f87171' }}>
                Confirmar eliminación
              </button>
              <button onClick={() => { setDeleteId(null); setConfirmPassword('') }} style={cancelBtn}>Cancelar</button>
            </div>
          </div>
        )}

      </div>
    </AppShell>
  )
}

// ── Estilos ────────────────────────────────────────────────────────────────

const tableWrap: React.CSSProperties = { background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: 12, overflow: 'hidden' }
const th: React.CSSProperties        = { padding: '10px 14px', textAlign: 'left', color: '#444', fontSize: '0.68rem', textTransform: 'uppercase', borderBottom: '1px solid #1a1a1a', letterSpacing: 0.5, whiteSpace: 'nowrap' }
const td: React.CSSProperties        = { padding: '13px 14px', borderBottom: '1px solid #0f0f0f', fontSize: 13, color: '#ccc', verticalAlign: 'middle' }
const trStyle: React.CSSProperties   = { transition: '0.15s' }
const lbl: React.CSSProperties       = { display: 'block', fontSize: 10, color: '#444', marginBottom: 5, fontWeight: 700, letterSpacing: 0.5 }
const inp: React.CSSProperties       = { width: '100%', padding: '10px', marginBottom: 14, background: '#000', color: 'white', border: '1px solid #222', borderRadius: 6, outline: 'none', boxSizing: 'border-box', fontSize: 13 }
const overlay: React.CSSProperties   = { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.88)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }
const modalBox: React.CSSProperties  = { background: '#111', padding: 26, borderRadius: 14, width: 400, border: '1px solid #222' }
const saveBtn: React.CSSProperties   = { width: '100%', padding: '11px', background: '#2e7d32', color: 'white', border: 'none', cursor: 'pointer', borderRadius: 6, fontWeight: 'bold', fontSize: 12 }
const cancelBtn: React.CSSProperties = { width: '100%', marginTop: 10, background: 'transparent', color: '#555', border: 'none', cursor: 'pointer', fontSize: 13 }
const actionBtn = (bg: string, color: string): React.CSSProperties => ({
  background: bg, border: 'none', color, padding: '5px 10px',
  cursor: 'pointer', borderRadius: 4, fontSize: 10, fontWeight: 'bold',
  display: 'inline-flex', alignItems: 'center',
})
const createBtn: React.CSSProperties = {
  background: '#22c55e', border: 'none', color: '#000', padding: '9px 18px',
  borderRadius: 8, fontWeight: 'bold', fontSize: 11, cursor: 'pointer',
  display: 'flex', alignItems: 'center', gap: 7,
}
const splitBtn: React.CSSProperties = {
  background: 'transparent', border: '1px solid #eab308', color: '#eab308', padding: '9px 18px',
  borderRadius: 8, fontWeight: 'bold', fontSize: 11, cursor: 'pointer',
  display: 'flex', alignItems: 'center', gap: 7,
}