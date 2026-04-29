'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { usePrivacy } from '@/lib/PrivacyContext'
import AppShell from '../AppShell'
import { Star } from 'lucide-react'

const exchangeCache: Record<string, string> = {}

// Solo positivos
const pos = (v: string) => v.replace(/[^0-9.]/g, '').replace(/^(\d*\.?\d*).*$/, '$1')

const SECTORES_DATA: Record<string, string[]> = {
  "ETF (Indexados)":           ["ETF"],
  "Criptomonedas":             ["Bitcoin", "Ethereum", "Altcoins", "Stablecoins", "Especulativas"],
  "Tecnología":                ["Software", "Hardware", "Semiconductores", "IA", "Ciberseguridad", "Telecomunicaciones", "Aerospacial"],
  "Salud":                     ["Farmacéuticas", "Biotecnología", "Dispositivos Médicos"],
  "Consumo Cíclico":           ["Automotriz", "E-commerce", "Lujo", "Turismo", "Ropa y Calzado", "Bebidas No Alcohólicas", "Comercio minorista", "Restaurantes", "Resorts y casinos", "Construcción", "Textiles", "Juguetes"],
  "Consumo Defensivo":         ["Bebidas", "Alimentos", "Supermercados", "Comercio minorista", "Tabaco", "Cuidado personal", "Ocio", "Dulces"],
  "Financiero":                ["Bancos", "Seguros", "Fintech", "Pagos", "Publicidad", "Fideicomiso", "Brokers"],
  "Energía":                   ["Petróleo", "Gas", "Solar", "Eólica"],
  "Industrial":                ["Aeroespacial", "Logística", "Maquinaria", "Productos agrícolas", "Productos eléctricos", "Materiales de construcción", "Químicos", "Contenedores", "Aerolíneas", "Construcción", "Ferrocarriles", "Medioambiente", "Metales", "Fabricación de productos"],
  "Materiales básicos":        ["Minería", "Litio", "Química", "Agricultura"],
  "Servicios Públicos":        ["Electricidad", "Agua"],
  "Bienes Raíces":             ["REIT Residencial", "REIT Industrial", "Data Centers"],
  "Servicios de comunicación": ["Internet", "Telecomunicaciones", "Multimedia", "Entretenimiento"],
}

const PAISES = ["Estados Unidos", "México", "España", "Japón", "Argentina", "Brasil", "Canadá", "China", "Reino Unido", "Dinamarca", "India", "Irlanda", "Taiwan", "Bermudas", "Luxemburgo", "Suiza", "Italia", "Alemania", "Francia", "Singapur"]

// ── Elementos decorativos ─────────────────────────────────────────────────
const Paw = ({ size = 14, color = '#444', opacity = 1, style: s = {} }: any) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ opacity, flexShrink: 0, ...s }}>
    <ellipse cx="6"  cy="5"  rx="2.5" ry="3"/>
    <ellipse cx="11" cy="3"  rx="2.5" ry="3"/>
    <ellipse cx="16" cy="4"  rx="2.5" ry="3"/>
    <ellipse cx="19" cy="9"  rx="2"   ry="2.5"/>
    <path d="M12 22c-5 0-8-3-8-7 0-2.5 1.5-4.5 4-5.5 1-.4 2-.6 4-.6s3 .2 4 .6c2.5 1 4 3 4 5.5 0 4-3 7-8 7z"/>
  </svg>
)

const CatEars = ({ color = '#00bfff', opacity = 0.12, size = 40 }: any) => (
  <svg width={size * 1.5} height={size} viewBox="0 0 60 40" fill={color} style={{ opacity }}>
    <polygon points="0,40 12,0 24,40" />
    <polygon points="36,40 48,0 60,40" />
  </svg>
)

const Whiskers = ({ color = '#00bfff', opacity = 0.1 }: any) => (
  <svg width={80} height={30} viewBox="0 0 80 30" stroke={color} strokeWidth="1.5" style={{ opacity }}>
    <line x1="0"  y1="10" x2="35" y2="15" />
    <line x1="0"  y1="20" x2="35" y2="15" />
    <line x1="0"  y1="28" x2="35" y2="15" />
    <line x1="80" y1="10" x2="45" y2="15" />
    <line x1="80" y1="20" x2="45" y2="15" />
    <line x1="80" y1="28" x2="45" y2="15" />
  </svg>
)

const CatTail = ({ color = '#00bfff', opacity = 0.08 }: any) => (
  <svg width={50} height={80} viewBox="0 0 50 80" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" style={{ opacity }}>
    <path d="M40 80 Q45 50 20 40 Q0 30 10 10 Q20 -5 35 5" />
  </svg>
)

export default function RegistroInicialTrade() {
  const router = useRouter()
  const { money } = usePrivacy()
  const today = new Date().toISOString().split('T')[0]

  const [wallets,        setWallets]        = useState<any[]>([])
  const [selectedWallet, setSelectedWallet] = useState('')
  const [available,      setAvailable]      = useState(0)
  const [user,           setUser]           = useState<any>(null)
  const [loading,        setLoading]        = useState(false)

  const [ticker,     setTicker]     = useState('')
  const [country,    setCountry]    = useState('Estados Unidos')
  const [sector,     setSector]     = useState('')
  const [subsector,  setSubsector]  = useState('')
  const [quantity,   setQuantity]   = useState('')
  const [price,      setPrice]      = useState('')
  const [date,       setDate]       = useState(today)
  const [commission, setCommission] = useState('0')
  const [stop,       setStop]       = useState('')
  const [tp1,        setTp1]        = useState('')
  const [tp2,        setTp2]        = useState('')
  const [tp3,        setTp3]        = useState('')
  const [notes,      setNotes]      = useState('')
  const [priority,   setPriority]   = useState(false)

  const [currency,     setCurrency]     = useState('USD')
  const [exchangeRate, setExchangeRate] = useState('1')

  const fetchExchangeRate = useCallback(async (selectedDate: string, targetCurrency: string) => {
    if (targetCurrency === 'USD') { setExchangeRate('1'); return }
    const cacheKey = `${selectedDate}-MXN`
    if (exchangeCache[cacheKey]) { setExchangeRate(exchangeCache[cacheKey]); return }
    try {
      const res  = await fetch(`https://api.frankfurter.app/${selectedDate}?from=USD&to=MXN`)
      const data = await res.json()
      let rate   = data?.rates?.MXN
      if (!rate) {
        const latest = await fetch('https://api.frankfurter.app/latest?from=USD&to=MXN')
        rate = (await latest.json()).rates.MXN
      }
      const fixed = rate.toFixed(4)
      exchangeCache[cacheKey] = fixed
      setExchangeRate(fixed)
    } catch (err) { console.error('Error T/C:', err) }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => fetchExchangeRate(date, currency), 400)
    return () => clearTimeout(t)
  }, [date, currency, fetchExchangeRate])

  useEffect(() => {
    const fetchData = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)
      if (user) {
        const { data } = await supabase.from('portfolios').select('*').eq('user_id', user.id)
        setWallets(data || [])
      }
    }
    fetchData()
  }, [])

  // ── Saldo con paginación completa — misma lógica que portafolios e historial ──
  useEffect(() => {
    if (!selectedWallet) { setAvailable(0); return }
    const fetchBalance = async () => {
      let all: any[] = []
      let from = 0
      while (true) {
        const { data } = await supabase
          .from('wallet_movements')
          .select('amount')
          .eq('wallet_id', selectedWallet)
          .range(from, from + 999)
        if (!data?.length) break
        all = [...all, ...data]
        if (data.length < 1000) break
        from += 1000
      }
      const saldo = all.reduce((acc, m) => acc + Number(m.amount), 0)
      setAvailable(parseFloat(saldo.toFixed(2)))
    }
    fetchBalance()
  }, [selectedWallet])

  // ── Cálculos ──────────────────────────────────────────────────────────────
  const qty     = parseFloat(quantity)   || 0
  const entry   = parseFloat(price)      || 0
  const comm    = parseFloat(commission) || 0
  const tCambio = parseFloat(exchangeRate) || 1
  const stopVal = parseFloat(stop) || 0
  const tp1Val  = parseFloat(tp1)  || 0
  const tp2Val  = parseFloat(tp2)  || 0
  const tp3Val  = parseFloat(tp3)  || 0

  const totalOriginal = parseFloat((qty * entry + comm).toFixed(2))
  const totalUSD      = currency === 'MXN' ? parseFloat((totalOriginal / tCambio).toFixed(2)) : totalOriginal
  const entryUSD      = currency === 'MXN' ? parseFloat((entry  / tCambio).toFixed(2)) : entry

  const toUSD = (v: number) => currency === 'MXN' ? parseFloat((v / tCambio).toFixed(2)) : parseFloat(v.toFixed(2))

  const stopUSD = stopVal > 0 ? toUSD(stopVal) : 0
  const tp1USD  = tp1Val  > 0 ? toUSD(tp1Val)  : 0
  const tp2USD  = tp2Val  > 0 ? toUSD(tp2Val)  : 0
  const tp3USD  = tp3Val  > 0 ? toUSD(tp3Val)  : 0

  const riskPerShare = stopUSD > 0 && entryUSD > 0 ? Math.abs(entryUSD - stopUSD) : 0
  const riskTotal    = parseFloat((riskPerShare * qty).toFixed(2))
  const riskPercent  = available > 0 ? parseFloat(((riskTotal / available) * 100).toFixed(2)) : 0
  const portfolioPct = available > 0 ? parseFloat(((totalUSD / available) * 100).toFixed(2)) : 0
  const overBudget   = totalUSD > available && available > 0

  const rr = (tpUSD: number) => {
    if (!riskPerShare || !entryUSD || !tpUSD) return null
    return parseFloat(((tpUSD - entryUSD) / riskPerShare).toFixed(2))
  }

  const guardarTrade = async () => {
    if (!ticker.trim() || !qty || !entry || !selectedWallet || !sector)
      return alert('Faltan datos obligatorios: billetera, ticker, sector, cantidad y precio')
    if (overBudget)
      return alert(`Saldo insuficiente. El trade cuesta ${money(totalUSD)} y solo tienes ${money(available)} disponibles`)

    setLoading(true)
    try {
      // Verificar duplicado
      const { data: existing } = await supabase
        .from('trades').select('id')
        .eq('portfolio_id', selectedWallet)
        .eq('ticker', ticker.trim().toUpperCase())
        .eq('status', 'open')
        .maybeSingle()

      if (existing) {
        alert(`Ya existe un trade abierto con ${ticker.toUpperCase()} en esta billetera.`)
        setLoading(false)
        return
      }

      const entryFinal = parseFloat(entryUSD.toFixed(2))

      const { error: tErr } = await supabase.from('trades').insert({
        user_id:             user.id,
        portfolio_id:        selectedWallet,
        ticker:              ticker.trim().toUpperCase(),
        type:                'long',
        quantity:            parseFloat(qty.toFixed(6)),
        initial_quantity:    parseFloat(qty.toFixed(6)),
        entry_price:         entryFinal,
        initial_entry_price: entryFinal,
        total_invested:      parseFloat(totalUSD.toFixed(2)),
        open_date:           date,
        stop_loss:           stopUSD  || null,
        take_profit_1:       tp1USD   || null,
        take_profit_2:       tp2USD   || null,
        take_profit_3:       tp3USD   || null,
        status:              'open',
        notes,
        country,
        sector,
        subsector,
        priority,
      })
      if (tErr) throw tErr

      await supabase.from('wallet_movements').insert({
        wallet_id:     selectedWallet,
        user_id:       user.id,
        amount:        -parseFloat(totalUSD.toFixed(2)),
        movement_type: 'trade',
        ticker:        ticker.trim().toUpperCase(),
        notes:         `Apertura ${ticker.trim().toUpperCase()} · ${qty} acc @ ${entryFinal} USD · T/C: ${tCambio}`,
        date,
        is_dividend:   false,
      })

      router.push('/abiertos')
    } catch (error: any) {
      alert('Error: ' + error.message)
      setLoading(false)
    }
  }

  return (
    <AppShell>
      <div style={formWrap}>

        {/* Orejas de gato — esquina superior derecha */}
        <div style={{ position: 'absolute', top: -2, right: 28, pointerEvents: 'none' }}>
          <CatEars color="#00bfff" opacity={0.14} size={44} />
        </div>
        {/* Cola de gato — lateral derecho */}
        <div style={{ position: 'absolute', right: -8, top: '32%', pointerEvents: 'none' }}>
          <CatTail color="#00bfff" opacity={0.09} />
        </div>
        {/* Huella grande de fondo */}
        <div style={{ position: 'absolute', bottom: 40, left: 30, pointerEvents: 'none' }}>
          <Paw size={90} color="#00bfff" opacity={0.025} />
        </div>

        {/* ── HEADER ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 26 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Paw size={20} color="#00bfff" opacity={0.55} />
            <Paw size={14} color="#00bfff" opacity={0.3} />
            <Paw size={9}  color="#00bfff" opacity={0.15} />
            <h2 style={{ fontSize: 20, margin: 0, fontWeight: 800, color: 'white' }}>Nuevo trade</h2>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: priority ? '#ffd700' : '#666' }}>
            <Star size={16} fill={priority ? '#ffd700' : 'none'} color={priority ? '#ffd700' : '#666'} />
            Prioritario
            <input type="checkbox" checked={priority} onChange={e => setPriority(e.target.checked)} style={{ display: 'none' }} />
          </label>
        </div>

        {/* ── BILLETERA ── */}
        <div style={{ ...sectionBox, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', right: 10, bottom: 6, pointerEvents: 'none' }}>
            <Whiskers color="#22c55e" opacity={0.13} />
          </div>
          <div style={{ flex: 2 }}>
            <label style={lbl}>Billetera</label>
            <select style={{ ...inp, width: '100%' }} value={selectedWallet} onChange={e => setSelectedWallet(e.target.value)}>
              <option value="">Seleccionar...</option>
              {wallets.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div style={{ textAlign: 'right' }}>
            <label style={lbl}>Saldo disponible</label>
            <div style={{ color: available >= 0 ? '#22c55e' : '#f43f5e', fontSize: 22, fontWeight: 900 }}>
              {money(available)}
            </div>
            <div style={{ fontSize: 9, color: '#666', marginTop: 2 }}>todos los movimientos</div>
          </div>
          {portfolioPct > 0 && (
            <div style={{ textAlign: 'right' }}>
              <label style={lbl}>% del saldo</label>
              <div style={{ color: portfolioPct > 20 ? '#f43f5e' : '#eab308', fontSize: 20, fontWeight: 900 }}>
                {portfolioPct}%
              </div>
            </div>
          )}
        </div>

        {/* ── IDENTIFICACIÓN ── */}
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 22 }}>
          <div style={{ width: 120 }}>
            <label style={lbl}>Ticker</label>
            <input
              style={{ ...inp, fontSize: 18, fontWeight: 'bold', color: '#00bfff', width: '100%' }}
              value={ticker}
              onChange={e => setTicker(e.target.value.toUpperCase().replace(/\s/g, ''))}
              placeholder="AAPL"
            />
          </div>
          <div style={{ width: 165 }}>
            <label style={lbl}>País</label>
            <select style={{ ...inp, width: '100%' }} value={country} onChange={e => setCountry(e.target.value)}>
              {PAISES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div style={{ width: 215 }}>
            <label style={lbl}>Sector</label>
            <select style={{ ...inp, width: '100%' }} value={sector} onChange={e => { setSector(e.target.value); setSubsector('') }}>
              <option value="">Seleccionar...</option>
              {Object.keys(SECTORES_DATA).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label style={lbl}>Subsector</label>
            <input
              list="subsectors-list"
              style={{ ...inp, width: '100%' }}
              value={subsector}
              onChange={e => setSubsector(e.target.value)}
              placeholder="Escribe o elige..."
            />
            <datalist id="subsectors-list">
              {sector && SECTORES_DATA[sector]?.map(sub => <option key={sub} value={sub} />)}
            </datalist>
          </div>
        </div>

        {/* ── FINANCIERA ── */}
        <div style={grid4}>
          <div style={inputBox}>
            <label style={lbl}>Cantidad</label>
            <input type="number" min="0" step="0.000001" style={inp}
              value={quantity} onChange={e => setQuantity(pos(e.target.value))} placeholder="0" />
          </div>
          <div style={inputBox}>
            <label style={lbl}>Precio ({currency})</label>
            <input type="number" min="0" step="0.01" style={inp}
              value={price} onChange={e => setPrice(pos(e.target.value))} placeholder="0.00" />
          </div>
          <div style={inputBox}>
            <label style={lbl}>Fecha</label>
            <input type="date" style={inp} value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div style={inputBox}>
            <label style={lbl}>Comisión ({currency})</label>
            <input type="number" min="0" step="0.01" style={inp}
              value={commission} onChange={e => setCommission(pos(e.target.value))} placeholder="0.00" />
          </div>
        </div>

        {/* ── GESTIÓN DE RIESGO ── */}
        <div style={{ marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
            <Paw size={11} color="#f43f5e" opacity={0.6} />
            <span style={{ fontSize: 9, color: '#888', fontWeight: 700, letterSpacing: 1 }}>GESTIÓN DE RIESGO</span>
            <Paw size={9}  color="#22c55e" opacity={0.45} />
            <Paw size={7}  color="#22c55e" opacity={0.25} />
          </div>
          <div style={grid4}>
            <div style={inputBox}>
              <label style={{ ...lbl, color: stopVal ? '#f43f5e' : '#888' }}>Stop loss</label>
              <input type="number" min="0" step="0.01"
                style={{ ...inp, borderColor: stopVal ? '#f43f5e55' : '#222' }}
                value={stop} onChange={e => setStop(pos(e.target.value))} placeholder="0.00" />
              {stopUSD > 0 && entryUSD > 0 && (
                <div style={{ fontSize: 10, color: '#f43f5e', marginTop: 5, textAlign: 'center' }}>
                  Riesgo: {money(riskTotal)} ({riskPercent}% saldo)
                </div>
              )}
            </div>
            {[
              { label: 'TP 1', val: tp1, set: setTp1, usd: tp1USD },
              { label: 'TP 2', val: tp2, set: setTp2, usd: tp2USD },
              { label: 'TP 3', val: tp3, set: setTp3, usd: tp3USD },
            ].map(({ label, val, set, usd }) => {
              const rrVal = rr(usd)
              return (
                <div key={label} style={inputBox}>
                  <label style={{ ...lbl, color: parseFloat(val) ? '#22c55e' : '#888' }}>{label}</label>
                  <input type="number" min="0" step="0.01"
                    style={{ ...inp, borderColor: parseFloat(val) ? '#22c55e55' : '#222' }}
                    value={val} onChange={e => set(pos(e.target.value))} placeholder="0.00" />
                  {rrVal !== null && (
                    <div style={{ fontSize: 10, color: '#22c55e', marginTop: 5, textAlign: 'center' }}>
                      R/R: {rrVal}R
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* ── NOTAS ── */}
        <div style={{ marginBottom: 20 }}>
          <label style={lbl}>Notas · tesis de inversión</label>
          <textarea
            style={{ ...inp, height: 68, resize: 'none', textAlign: 'left' }}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Tesis de inversión, catalizadores, contexto del mercado..."
          />
        </div>

        {/* ── MONEDA Y TOTALES ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 14 }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end' }}>
            <div style={{ width: 100 }}>
              <label style={lbl}>Moneda</label>
              <select style={inp} value={currency} onChange={e => setCurrency(e.target.value)}>
                <option value="USD">USD</option>
                <option value="MXN">MXN</option>
              </select>
            </div>
            {currency === 'MXN' && (
              <div style={{ width: 150 }}>
                <label style={{ ...lbl, color: '#eab308' }}>Valor dólar (T/C)</label>
                <input type="number" min="0" step="0.01"
                  style={{ ...inp, borderColor: '#eab308' }}
                  value={exchangeRate}
                  onChange={e => setExchangeRate(pos(e.target.value))}
                />
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 20, alignItems: 'flex-end' }}>
            {currency === 'MXN' && (
              <div style={{ textAlign: 'right' }}>
                <label style={lbl}>Total en {currency}</label>
                <div style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>{money(totalOriginal)}</div>
              </div>
            )}
            <div style={{ textAlign: 'right' }}>
              <label style={{ ...lbl, color: overBudget ? '#f43f5e' : '#00bfff' }}>
                Total en USD{overBudget ? ' · saldo insuficiente' : ''}
              </label>
              <div style={{ color: overBudget ? '#f43f5e' : '#00bfff', fontSize: 22, fontWeight: 900 }}>
                {money(totalUSD)}
              </div>
            </div>
          </div>
        </div>

        {/* ── BOTÓN ── */}
        <div style={{ position: 'relative', marginTop: 24 }}>
          <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', pointerEvents: 'none' }}>
            <Paw size={56} color="#00bfff" opacity={0.03} />
          </div>
          <button
            onClick={guardarTrade}
            disabled={loading || overBudget}
            style={{
              ...saveBtn,
              background: overBudget ? '#3a1a1a' : loading ? '#1a3a1a' : '#2e7d32',
              cursor:     overBudget || loading ? 'not-allowed' : 'pointer',
              opacity:    overBudget ? 0.7 : 1,
            }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              <Paw size={15} color={overBudget ? '#f43f5e' : '#22c55e'} opacity={0.8} />
              {loading ? 'Procesando...' : overBudget ? 'Saldo insuficiente' : 'Abrir posición'}
              <Paw size={15} color={overBudget ? '#f43f5e' : '#22c55e'} opacity={0.8} />
            </div>
          </button>
        </div>

      </div>
    </AppShell>
  )
}

const formWrap: React.CSSProperties  = { maxWidth: 860, margin: '20px auto', background: '#0d0d0d', padding: 35, borderRadius: 16, color: 'white', border: '1px solid #1a1a1a', position: 'relative', overflow: 'hidden' }
const sectionBox: React.CSSProperties = { display: 'flex', gap: 20, marginBottom: 24, alignItems: 'center', background: '#070707', padding: 16, borderRadius: 12, border: '1px solid #1a1a1a', flexWrap: 'wrap' }
const grid4: React.CSSProperties     = { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 18 }
const inputBox: React.CSSProperties  = { display: 'flex', flexDirection: 'column' }
const lbl: React.CSSProperties       = { display: 'block', fontSize: 9, color: '#888', marginBottom: 7, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase' }
const inp: React.CSSProperties       = { width: '100%', padding: 11, background: '#000', border: '1px solid #222', color: '#fff', borderRadius: 8, fontSize: 13, textAlign: 'center', outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.2s' }
const saveBtn: React.CSSProperties   = { width: '100%', padding: 16, color: 'white', border: 'none', borderRadius: 12, fontWeight: 'bold', fontSize: 16, transition: 'background 0.2s', position: 'relative' }