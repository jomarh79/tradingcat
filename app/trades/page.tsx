'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { usePrivacy } from '@/lib/PrivacyContext'
import AppShell from '../AppShell'
import { TrendingUp, Star } from 'lucide-react'

// Cache fuera del componente para que persista entre renders
const exchangeCache: Record<string, string> = {}

const SECTORES_DATA: Record<string, string[]> = {
  "ETF (Indexados)":          ["ETF"],
  "Criptomonedas":            ["Bitcoin", "Ethereum", "Altcoins", "Stablecoins", "Especulativas"],
  "Tecnología":               ["Software", "Hardware", "Semiconductores", "IA", "Ciberseguridad", "Telecomunicaciones", "Aerospacial"],
  "Salud":                    ["Farmacéuticas", "Biotecnología", "Dispositivos Médicos"],
  "Consumo Cíclico":          ["Automotriz", "E-commerce", "Lujo", "Turismo", "Ropa y Calzado", "Bebidas No Alcohólicas", "Comercio minorista", "Restaurantes","Resorts y casinos", "Construcción", "Textiles", "Juguetes"],
  "Consumo Defensivo":        ["Bebidas", "Alimentos", "Supermercados", "Comercio minorista", "Tabaco", "Cuidado personal", "Ocio","Dulces"],
  "Financiero":               ["Bancos", "Seguros", "Fintech", "Pagos", "Publicidad", "Fideicomiso"],
  "Energía":                  ["Petróleo", "Gas", "Solar", "Eólica"],
  "Industrial":               ["Aeroespacial", "Logística", "Maquinaria", "Productos agrícolas", "Productos electricos", "Materiales de construcción", "Quimicos", "Contenedores", "Aerolineas","Construcción","Ferrocarriles", "Medioambiente", "Metales","Fabricacion de productos"],
  "Materiales básicos":       ["Minería", "Litio", "Química", "Agricultura"],
  "Servicios Públicos":       ["Electricidad", "Agua"],
  "Bienes Raíces":            ["REIT Residencial", "REIT Industrial", "Data Centers"],
  "Servicios de comunicación":["Internet", "Telecomunicaciones", "Multimedia", "Entretenimiento"],
}

const PAISES = ["Estados Unidos", "México", "España", "Japón", "Argentina", "Brasil", "Canadá", "China", "Reino Unido", "Dinamarca", "India", "Irlanda", "Taiwan", "Bermudas", "Luxemburgo", "Suiza", "Italia", "Alemania", "Francia"]

export default function RegistroInicialTrade() {
  const router = useRouter()
  const { money, shares } = usePrivacy()
  const today = new Date().toISOString().split('T')[0]

  const [wallets, setWallets]               = useState<any[]>([])
  const [selectedWallet, setSelectedWallet] = useState('')
  const [available, setAvailable]           = useState(0)
  const [user, setUser]                     = useState<any>(null)
  const [loading, setLoading]               = useState(false)

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
      const res = await fetch(`https://api.frankfurter.app/${selectedDate}?from=USD&to=MXN`)
      const data = await res.json()
      let rate = data?.rates?.MXN
      if (!rate) {
        const latest = await fetch(`https://api.frankfurter.app/latest?from=USD&to=MXN`)
        rate = (await latest.json()).rates.MXN
      }
      const fixed = rate.toFixed(4)
      exchangeCache[cacheKey] = fixed
      setExchangeRate(fixed)
    } catch (err) {
      console.error('Error obteniendo T/C histórico:', err)
    }
  }, [])

  useEffect(() => {
    const timeout = setTimeout(() => fetchExchangeRate(date, currency), 400)
    return () => clearTimeout(timeout)
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

  useEffect(() => {
    if (!selectedWallet) { setAvailable(0); return }
    const fetchBalance = async () => {
      const { data } = await supabase.from('wallet_movements').select('amount').eq('wallet_id', selectedWallet)
      setAvailable(data?.reduce((acc, m) => acc + Number(m.amount), 0) || 0)
    }
    fetchBalance()
  }, [selectedWallet])

  // --- CÁLCULOS DERIVADOS ---
  const qty        = parseFloat(quantity)  || 0
  const entry      = parseFloat(price)     || 0
  const comm       = parseFloat(commission)|| 0
  const tCambio    = parseFloat(exchangeRate) || 1
  const stopVal    = parseFloat(stop)  || 0
  const tp1Val     = parseFloat(tp1)   || 0
  const tp2Val     = parseFloat(tp2)   || 0
  const tp3Val     = parseFloat(tp3)   || 0

  const totalOriginal = parseFloat((qty * entry + comm).toFixed(2))
  const totalUSD      = currency === 'MXN' ? parseFloat((totalOriginal / tCambio).toFixed(2)) : totalOriginal
  const entryUSD      = currency === 'MXN' ? parseFloat((entry / tCambio).toFixed(2))         : entry

  const toUSD = (v: number) => currency === 'MXN' ? parseFloat((v / tCambio).toFixed(2)) : parseFloat(v.toFixed(2))

  const stopUSD = stopVal > 0 ? toUSD(stopVal) : 0
  const tp1USD  = tp1Val  > 0 ? toUSD(tp1Val)  : 0
  const tp2USD  = tp2Val  > 0 ? toUSD(tp2Val)  : 0
  const tp3USD  = tp3Val  > 0 ? toUSD(tp3Val)  : 0

  // Riesgo en USD
  const riskPerShare   = stopUSD > 0 && entryUSD > 0 ? Math.abs(entryUSD - stopUSD) : 0
  const riskTotal      = parseFloat((riskPerShare * qty).toFixed(2))
  const riskPercent    = available > 0 ? parseFloat(((riskTotal / available) * 100).toFixed(2)) : 0
  const portfolioPct   = available > 0 ? parseFloat(((totalUSD / available) * 100).toFixed(2)) : 0

  // R/R por TP
  const rr = (tpUSD: number) => {
    if (!riskPerShare || !entryUSD || !tpUSD) return null
    return parseFloat(((tpUSD - entryUSD) / riskPerShare).toFixed(2))
  }

  const overBudget = totalUSD > available && available > 0

  const guardarTrade = async () => {
    if (!ticker || !qty || !entry || !selectedWallet || !sector)
      return alert('Faltan datos obligatorios')
    if (overBudget)
      return alert(`Saldo insuficiente. El trade cuesta ${money(totalUSD)} y solo tienes ${money(available)} disponibles.`)

    setLoading(true)
    try {
      const { data: existing } = await supabase
        .from('trades')
        .select('id')
        .eq('portfolio_id', selectedWallet)
        .eq('ticker', ticker.toUpperCase())
        .eq('status', 'open')
        .maybeSingle()

      if (existing) {
        alert(`Ya existe un trade abierto con ${ticker.toUpperCase()} en esta billetera.`)
        setLoading(false)
        return
      }

      const { error: tErr } = await supabase.from('trades').insert({
        user_id:          user.id,
        portfolio_id:     selectedWallet,
        ticker:           ticker.toUpperCase(),
        type:             'long',
        quantity:         parseFloat(qty.toFixed(6)),
        initial_quantity: parseFloat(qty.toFixed(6)),
        entry_price:      parseFloat(entryUSD.toFixed(2)),
        total_invested:   parseFloat(totalUSD.toFixed(2)),
        open_date:        date,
        stop_loss:        stopUSD  || null,
        take_profit_1:    tp1USD   || null,
        take_profit_2:    tp2USD   || null,
        take_profit_3:    tp3USD   || null,
        status:           'open',
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
        ticker:        ticker.toUpperCase(),
        notes:         `Compra ${ticker.toUpperCase()} (${totalOriginal} ${currency}) T/C: ${tCambio}`,
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

        {/* HEADER */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 25 }}>
          <h2 style={{ fontSize: 22, margin: 0, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
            <TrendingUp size={22} color="#00bfff" /> Nuevo trade
          </h2>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: priority ? '#ffd700' : '#555' }}>
            <Star size={16} fill={priority ? '#ffd700' : 'none'} color={priority ? '#ffd700' : '#555'} />
            Prioritario
            <input type="checkbox" checked={priority} onChange={e => setPriority(e.target.checked)} style={{ display: 'none' }} />
          </label>
        </div>

        {/* BILLETERA */}
        <div style={sectionBox}>
          <div style={{ flex: 2 }}>
            <label style={labelStyle}>Billetera</label>
            <select style={{ ...inputSmall, width: '100%' }} value={selectedWallet} onChange={e => setSelectedWallet(e.target.value)}>
              <option value="">Seleccionar...</option>
              {wallets.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div style={{ textAlign: 'right' }}>
            <label style={labelStyle}>Disponible</label>
            <div style={{ color: '#22c55e', fontSize: 20, fontWeight: 'bold' }}>{money(available)}</div>
          </div>
          {portfolioPct > 0 && (
            <div style={{ textAlign: 'right' }}>
              <label style={labelStyle}>% del portafolio</label>
              <div style={{ color: portfolioPct > 20 ? '#f43f5e' : '#ffd700', fontSize: 18, fontWeight: 'bold' }}>
                {portfolioPct}%
              </div>
            </div>
          )}
        </div>

        {/* IDENTIFICACIÓN */}
        <div style={{ display: 'flex', gap: 15, flexWrap: 'wrap', marginBottom: 25 }}>
          <div style={{ width: 120 }}>
            <label style={labelStyle}>Ticker</label>
            <input
              style={{ ...inputSmall, fontSize: 18, fontWeight: 'bold', color: '#00bfff', width: '100%' }}
              value={ticker}
              onChange={e => setTicker(e.target.value.toUpperCase())}
              placeholder="AAPL"
            />
          </div>
          <div style={{ width: 160 }}>
            <label style={labelStyle}>País</label>
            <select style={{ ...inputSmall, width: '100%' }} value={country} onChange={e => setCountry(e.target.value)}>
              {PAISES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div style={{ width: 210 }}>
            <label style={labelStyle}>Sector</label>
            <select style={{ ...inputSmall, width: '100%' }} value={sector} onChange={e => { setSector(e.target.value); setSubsector('') }}>
              <option value="">Seleccionar...</option>
              {Object.keys(SECTORES_DATA).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label style={labelStyle}>Subsector</label>
            <input
              list="subsectors-list"
              style={{ ...inputSmall, width: '100%' }}
              value={subsector}
              onChange={e => setSubsector(e.target.value)}
              placeholder="Escribe o elige..."
            />
            <datalist id="subsectors-list">
              {sector && SECTORES_DATA[sector]?.map(sub => <option key={sub} value={sub} />)}
            </datalist>
          </div>
        </div>

        {/* FINANCIERA */}
        <div style={grid4}>
          <div style={inputContainer}>
            <label style={labelStyle}>Cantidad</label>
            <input type="number" step="0.000001" style={inputSmall} value={quantity} onChange={e => setQuantity(e.target.value)} />
            
          </div>
          <div style={inputContainer}>
            <label style={labelStyle}>Precio ({currency})</label>
            <input type="number" step="0.01" style={inputSmall} value={price} onChange={e => setPrice(e.target.value)} />
          </div>
          <div style={inputContainer}>
            <label style={labelStyle}>Fecha</label>
            <input type="date" style={inputSmall} value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div style={inputContainer}>
            <label style={labelStyle}>Comisión ({currency})</label>
            <input type="number" step="0.01" style={inputSmall} value={commission} onChange={e => setCommission(e.target.value)} />
          </div>
        </div>

        {/* GESTIÓN DE RIESGO */}
        <div style={grid4}>
          <div style={inputContainer}>
            <label style={labelStyle}>Stop loss</label>
            <input type="number" step="0.01" style={{ ...inputSmall, borderColor: stopVal ? '#f43f5e' : '#222' }} value={stop} onChange={e => setStop(e.target.value)} />
            {stopUSD > 0 && entryUSD > 0 && (
              <div style={{ ...hint, color: '#f43f5e' }}>
                Riesgo: {money(riskTotal)} ({riskPercent}% portafolio)
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
              <div key={label} style={inputContainer}>
                <label style={labelStyle}>{label}</label>
                <input
                  type="number" step="0.01"
                  style={{ ...inputSmall, borderColor: val ? '#22c55e' : '#222' }}
                  value={val}
                  onChange={e => set(e.target.value)}
                />
                {rrVal !== null && (
                  <div style={{ ...hint, color: '#22c55e' }}>R/R: {rrVal}R</div>
                )}
              </div>
            )
          })}
        </div>

        {/* NOTAS */}
        <div style={{ marginTop: 10, marginBottom: 20 }}>
          <label style={labelStyle}>Notas</label>
          <textarea
            style={{ ...inputSmall, height: 70, resize: 'none', textAlign: 'left' }}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Tesis de inversión, catalizadores, contexto..."
          />
        </div>

        {/* MONEDA Y TOTALES */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 15 }}>
          <div style={{ display: 'flex', gap: 15, alignItems: 'flex-end' }}>
            <div style={{ width: 100 }}>
              <label style={labelStyle}>Moneda</label>
              <select style={inputSmall} value={currency} onChange={e => setCurrency(e.target.value)}>
                <option value="USD">USD</option>
                <option value="MXN">MXN</option>
              </select>
            </div>
            {currency === 'MXN' && (
              <div style={{ width: 150 }}>
                <label style={{ ...labelStyle, color: '#eab308' }}>Valor dólar (T/C)</label>
                <input
                  type="number" step="0.01"
                  style={{ ...inputSmall, borderColor: '#eab308' }}
                  value={exchangeRate}
                  onChange={e => setExchangeRate(e.target.value)}
                />
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-end' }}>
            {currency === 'MXN' && (
              <div style={{ textAlign: 'right' }}>
                <label style={labelStyle}>Total en {currency}</label>
                <div style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>{money(totalOriginal)}</div>
              </div>
            )}
            <div style={{ textAlign: 'right' }}>
              <label style={{ ...labelStyle, color: overBudget ? '#f43f5e' : '#00bfff' }}>
                Total en USD {overBudget ? '· saldo insuficiente' : ''}
              </label>
              <div style={{ color: overBudget ? '#f43f5e' : '#00bfff', fontSize: 20, fontWeight: 'bold' }}>
                {money(totalUSD)}
              </div>
            </div>
          </div>
        </div>

        {/* BOTÓN */}
        <button
          onClick={guardarTrade}
          disabled={loading || overBudget}
          style={{
            ...saveBtn,
            background: overBudget ? '#3a1a1a' : loading ? '#1a3a1a' : '#2e7d32',
            cursor: overBudget || loading ? 'not-allowed' : 'pointer',
            opacity: overBudget ? 0.7 : 1,
          }}>
          {loading ? 'Procesando...' : overBudget ? 'Saldo insuficiente' : 'Abrir posición'}
        </button>

      </div>
    </AppShell>
  )
}

const formWrap: React.CSSProperties = {
  maxWidth: 860, margin: '20px auto',
  background: '#121212', padding: 35,
  borderRadius: 15, color: 'white', border: '1px solid #222',
}
const sectionBox: React.CSSProperties = {
  display: 'flex', gap: 20, marginBottom: 25,
  alignItems: 'center', background: '#0a0a0a',
  padding: 15, borderRadius: 10, flexWrap: 'wrap',
}
const grid4: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
  gap: 15, marginBottom: 20,
}
const inputContainer: React.CSSProperties = {
  display: 'flex', flexDirection: 'column',
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 10, color: '#555',
  marginBottom: 8, fontWeight: 600,
  letterSpacing: 0.8, textTransform: 'uppercase',
}
const inputSmall: React.CSSProperties = {
  width: '100%', padding: 12,
  background: '#000', border: '1px solid #222',
  color: '#fff', borderRadius: 8, fontSize: 14,
  textAlign: 'center', outline: 'none',
  boxSizing: 'border-box',
}
const hint: React.CSSProperties = {
  fontSize: 10, color: '#555', marginTop: 5, textAlign: 'center',
}
const saveBtn: React.CSSProperties = {
  width: '100%', marginTop: 25, padding: 16,
  color: 'white', border: 'none',
  borderRadius: 10, fontWeight: 'bold',
  fontSize: 16, transition: 'background 0.2s',
}