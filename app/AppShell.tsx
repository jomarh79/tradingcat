'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { usePrivacy } from '../lib/PrivacyContext'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Cat, BarChart3, TrendingUp, History, PieChart, Wallet,
  LogOut, Activity, Coins, LayoutDashboard, Eye, EyeOff
} from 'lucide-react'

function MenuLink({ href, icon, label, active, isSubItem }: any) {
  return (
    <Link href={href} style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      textDecoration: 'none',
      transition: '0.2s',
      background: active ? 'rgba(0, 191, 255, 0.05)' : 'transparent',
      color: active ? '#00bfff' : isSubItem ? '#555' : '#888',
      borderLeft: active ? '2px solid #00bfff' : '2px solid transparent',
      paddingRight: '15px',
      paddingLeft: isSubItem ? '40px' : '15px',
      height: isSubItem ? '28px' : '38px',
    }}>
      {icon && <span style={{ opacity: active ? 1 : 0.7 }}>{icon}</span>}
      <span style={{ fontSize: isSubItem ? 11 : 12.5, fontWeight: active ? '600' : '400' }}>{label}</span>
    </Link>
  )
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { visible, toggle } = usePrivacy()
  const [user, setUser] = useState<any>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [marketData, setMarketData] = useState<any>({})

  const FINNHUB_API_KEY = process.env.NEXT_PUBLIC_FINNHUB_KEY

  const symbols = [
    { api: 'SPY',             label: 'SPY' },
    { api: 'QQQ',             label: 'QQQ' },
    { api: 'DIA',             label: 'DIA' },
    { api: 'BINANCE:BTCUSDT', label: 'BTC' },
  ]

  useEffect(() => {
    const getUser = async () => {
      const { data } = await supabase.auth.getUser()
      setUser(data.user)
    }
    getUser()
  }, [])

  useEffect(() => {
    if (!user) return

    const fetchData = async () => {
      try {
        // Acciones: Finnhub
        const stockSymbols = symbols.filter(s => s.api !== 'BINANCE:BTCUSDT')
        const promises = stockSymbols.map(s =>
          fetch(`https://finnhub.io/api/v1/quote?symbol=${s.api}&token=${FINNHUB_API_KEY}`)
            .then(res => res.json())
        )
        const responses = await Promise.all(promises)
        const results: any = {}
        stockSymbols.forEach((s, i) => {
          if (responses[i]?.c !== undefined) results[s.api] = responses[i]
        })

        // BTC: Binance pública, sin key
        try {
          const btcRes = await fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT')
          const btc = await btcRes.json()
          results['BINANCE:BTCUSDT'] = {
            c: parseFloat(btc.lastPrice),
            dp: parseFloat(btc.priceChangePercent),
          }
        } catch (e) {
          console.warn('BTC fetch failed:', e)
        }

        setMarketData(results)
      } catch (e) {
        console.error('Market fetch error:', e)
      }
    }

    fetchData()
    const interval = setInterval(fetchData, 60000)
    return () => clearInterval(interval)
  }, [user])

  const handleLogin = async () => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) alert(error.message)
    else window.location.reload()
  }

  if (!user) {
    return (
      <div style={loginOverlay}>
        <div style={loginCard}>
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <Cat size={40} color="#00bfff" />
            <h2 style={{ marginTop: 10, color: 'white', fontSize: 18 }}>TraderCat Terminal</h2>
          </div>
          <input placeholder="Email" onChange={e => setEmail(e.target.value)} style={inputStyle} />
          <input type="password" placeholder="Password" onChange={e => setPassword(e.target.value)}
            style={inputStyle} onKeyDown={e => e.key === 'Enter' && handleLogin()} />
          <button onClick={handleLogin} style={buttonStyle}>Entrar</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ background: '#050505', color: 'white', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>

      {/* TopBar */}
      <div style={topBar}>
        <div style={{ display: 'flex', gap: 10 }}>
          {symbols.map(({ api, label }) => {
            const data = marketData[api]
            if (!data) return null
            const isUp = data.dp >= 0
            return (
              <div key={api} style={tickerItem}>
                <span style={{ fontWeight: '800', fontSize: 10, color: '#666' }}>{label}</span>
                <span style={{ fontSize: 12, fontWeight: 'bold' }}>${data.c?.toFixed(2)}</span>
                <span style={{ fontSize: 10, color: isUp ? 'lime' : '#ff4444' }}>
                  {isUp ? '▲' : '▼'} {Math.abs(data.dp)?.toFixed(2)}%
                </span>
              </div>
            )
          })}
        </div>
        <button
          onClick={() => supabase.auth.signOut().then(() => window.location.reload())}
          style={logoutBtn}>
          <LogOut size={16} />
        </button>
      </div>

      <div style={{ display: 'flex', flex: 1 }}>
        {/* Sidebar */}
        <aside style={sidebar}>
          <div style={logoSection}>
            <Cat size={24} color="#00bfff" />
            <span style={{ fontWeight: 'bold', fontSize: 16, letterSpacing: 0.5 }}>
              TRADER<span style={{ color: '#00bfff' }}>CAT</span>
            </span>
          </div>

          <nav style={{ 
            display: 'flex', 
            flexDirection: 'column', 
            marginTop: 10,
            //flex: 1,           // ← ocupa todo el espacio disponible
            //overflowY: 'auto'  // ← por si el menú es muy largo
          }}>
            <MenuLink href="/" icon={<LayoutDashboard size={16} />} label="Home" active={pathname === '/'} />

            <div style={sectionLabel}>TRADING</div>
            <MenuLink href="/trades" icon={<BarChart3 size={16} />} label="Nuevo Trade" active={pathname === '/trades'} />
            <MenuLink href="/abiertos" icon={<TrendingUp size={16} />} label="Abiertos" active={pathname === '/abiertos'} />
            <MenuLink href="/cerrados" icon={<History size={16} />} label="Cerrados" active={pathname === '/cerrados'} />

            <div style={sectionLabel}>ANÁLISIS</div>
            <MenuLink href="/watchlist" icon={<Eye size={16} />} label="Watchlist" active={pathname === '/watchlist'} />

            <div style={sectionLabel}>ANÁLISIS</div>
            <MenuLink href="/ia" icon={<brain size={16} />} label="IA" active={pathname === '/ia'} />

            <div style={groupHeader}><Activity size={14} color="#444" /> Estadísticas</div>
            <MenuLink href="/estadisticas" label="Abiertos" active={pathname === '/estadisticas'} isSubItem />
            <MenuLink href="/estadisticas2" label="Cerrados" active={pathname === '/estadisticas2'} isSubItem />

            <div style={groupHeader}><PieChart size={14} color="#444" /> Gráficos</div>
            <MenuLink href="/graficos" label="Abiertos" active={pathname === '/graficos'} isSubItem />
            <MenuLink href="/graficos2" label="Cerrados" active={pathname === '/graficos2'} isSubItem />

            <div style={sectionLabel}>WALLET</div>
            <MenuLink href="/portafolios" icon={<Wallet size={16} />} label="Billeteras" active={pathname === '/portafolios'} />
            <MenuLink href="/dividendos" icon={<Coins size={16} />} label="Dividendos" active={pathname === '/dividendos'} isSubItem />

            {/* BOTÓN PRIVACIDAD */}
            <div style={{ 
              marginTop: 'auto',        // ← se pega al fondo
              borderTop: '1px solid #151515', 
              padding: '12px 15px',
              flexShrink: 0             // ← no se comprime
            }}>
              <button onClick={toggle} style={privacyBtn}>
                {visible
                  ? <><Eye size={14} /> <span>Ocultar valores</span></>
                  : <><EyeOff size={14} color="#00bfff" /> <span style={{ color: '#00bfff' }}>Mostrar valores</span></>
                }
              </button>
            </div>
          </nav>
        </aside>

        <main style={{ flex: 1, padding: '15px', overflowY: 'auto' }}>
          {children}
        </main>
      </div>
    </div>
  )
}

const sidebar: React.CSSProperties = {
  width: '180px',
  background: '#080808',
  borderRight: '1px solid #151515',
  height: 'calc(100vh - 40px)',
  position: 'sticky',
  top: '40px',
  display: 'flex',
  flexDirection: 'column',
}

const topBar: React.CSSProperties = {
  height: '40px',
  background: '#000',
  borderBottom: '1px solid #151515',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 15px',
  zIndex: 100,
}

const tickerItem: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  background: '#0a0a0a',
  padding: '4px 10px',
  borderRadius: '4px',
  border: '1px solid #111',
}

const logoSection: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '15px',
  borderBottom: '1px solid #151515',
}

const sectionLabel: React.CSSProperties = {
  fontSize: '9px',
  color: '#444',
  fontWeight: 'bold',
  padding: '15px 15px 5px 15px',
  letterSpacing: 1,
}

const groupHeader: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  fontSize: '11px',
  color: '#555',
  padding: '8px 15px 2px 15px',
}

const logoutBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#444',
  cursor: 'pointer',
  padding: '5px',
}

const privacyBtn: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  background: 'none',
  border: '1px solid #1a1a1a',
  color: '#555',
  cursor: 'pointer',
  padding: '7px 10px',
  borderRadius: 6,
  fontSize: 11,
  width: '100%',
}

const loginOverlay: React.CSSProperties = {
  position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
  background: '#050505', display: 'flex', justifyContent: 'center',
  alignItems: 'center', zIndex: 2000,
}
const loginCard: React.CSSProperties = {
  background: '#0a0a0a', padding: 30, borderRadius: 15,
  border: '1px solid #151515', width: '100%', maxWidth: '320px',
}
const inputStyle: React.CSSProperties = {
  width: '100%', background: '#111', border: '1px solid #222',
  color: 'white', padding: '10px', borderRadius: 8, marginBottom: 10, fontSize: 13,
}
const buttonStyle: React.CSSProperties = {
  width: '100%', background: '#00bfff', color: 'black',
  border: 'none', padding: '10px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer',
}