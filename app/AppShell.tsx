'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { usePrivacy } from '../lib/PrivacyContext'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Cat, BarChart3, TrendingUp, History, PieChart, Wallet,
  LogOut, Activity, Coins, LayoutDashboard, Eye, EyeOff, SearchCode
} from 'lucide-react'

// ═══════════════════════════════════════════════════════════════════════════
//  CAT SVG DECORATORS
// ═══════════════════════════════════════════════════════════════════════════

const Paw = ({ size = 14, color = '#00bfff', opacity = 1, rotate = 0, style: s = {} }: any) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color}
    style={{ opacity, transform: `rotate(${rotate}deg)`, flexShrink: 0, ...s }}>
    <ellipse cx="6"  cy="5"  rx="2.5" ry="3"/>
    <ellipse cx="11" cy="3"  rx="2.5" ry="3"/>
    <ellipse cx="16" cy="4"  rx="2.5" ry="3"/>
    <ellipse cx="19" cy="9"  rx="2"   ry="2.5"/>
    <path d="M12 22c-5 0-8-3-8-7 0-2.5 1.5-4.5 4-5.5 1-.4 2-.6 4-.6s3 .2 4 .6c2.5 1 4 3 4 5.5 0 4-3 7-8 7z"/>
  </svg>
)

// Gato completo sentado — fondo decorativo del sidebar
const CatSitting = ({ size = 70, color = '#00bfff', opacity = 0.05 }: any) => (
  <svg width={size} height={size * 1.3} viewBox="0 0 50 65" fill={color} style={{ opacity }}>
    <polygon points="8,20 14,4 22,20"/>
    <polygon points="28,20 36,4 42,20"/>
    <ellipse cx="25" cy="26" rx="14" ry="13"/>
    {/* ojos */}
    <ellipse cx="19" cy="24" rx="2" ry="2.5" fill="black" opacity="0.4"/>
    <ellipse cx="31" cy="24" rx="2" ry="2.5" fill="black" opacity="0.4"/>
    {/* nariz */}
    <ellipse cx="25" cy="29" rx="1.5" ry="1" fill="black" opacity="0.3"/>
    {/* cuerpo */}
    <ellipse cx="25" cy="48" rx="13" ry="14"/>
    {/* cola */}
    <path d="M38 57 Q50 48 46 36 Q42 28 38 34" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round"/>
    {/* patas */}
    <ellipse cx="18" cy="60" rx="5" ry="3"/>
    <ellipse cx="32" cy="60" rx="5" ry="3"/>
  </svg>
)

// Orejas puntiagudas
const CatEars = ({ color = '#00bfff', opacity = 0.12, size = 36 }: any) => (
  <svg width={size * 1.6} height={size} viewBox="0 0 58 36" fill={color} style={{ opacity }}>
    <polygon points="0,36 11,0 22,36"/>
    <polygon points="36,36 47,0 58,36"/>
  </svg>
)

// Cola curva lateral
const CatTail = ({ color = '#00bfff', opacity = 0.08, h = 80 }: any) => (
  <svg width={44} height={h} viewBox="0 0 44 80" fill="none"
    stroke={color} strokeWidth="3" strokeLinecap="round" style={{ opacity }}>
    <path d="M36 80 Q42 54 18 42 Q0 30 10 10 Q18 -2 32 4"/>
  </svg>
)

// Bigotes
const Whiskers = ({ color = '#00bfff', opacity = 0.1, w = 80 }: any) => (
  <svg width={w} height={30} viewBox={`0 0 ${w} 30`} stroke={color} strokeWidth="1.2" style={{ opacity }}>
    <line x1="0" y1="6"  x2={w * 0.42} y2="15"/>
    <line x1="0" y1="15" x2={w * 0.42} y2="15"/>
    <line x1="0" y1="24" x2={w * 0.42} y2="15"/>
    <line x1={w} y1="6"  x2={w * 0.58} y2="15"/>
    <line x1={w} y1="15" x2={w * 0.58} y2="15"/>
    <line x1={w} y1="24" x2={w * 0.58} y2="15"/>
  </svg>
)

// ═══════════════════════════════════════════════════════════════════════════

function MenuLink({ href, icon, label, active, isSubItem }: any) {
  return (
    <Link href={href} style={{
      display: 'flex', alignItems: 'center', gap: 10,
      textDecoration: 'none', transition: 'all 0.15s',
      background: active ? 'rgba(0,191,255,0.07)' : 'transparent',
      color: active ? '#00bfff' : isSubItem ? '#888' : '#bbb',
      borderLeft: active ? '2px solid #00bfff' : '2px solid transparent',
      paddingRight: 14,
      paddingLeft: isSubItem ? 38 : 14,
      height: isSubItem ? 28 : 38,
    }}>
      {icon && <span style={{ opacity: active ? 1 : 0.6 }}>{icon}</span>}
      {/* Huella mini solo en items activos */}
      {active && !isSubItem && (
        <Paw size={7} color="#00bfff" opacity={0.5} style={{ marginLeft: -4 }} />
      )}
      <span style={{ fontSize: isSubItem ? 11 : 12.5, fontWeight: active ? 700 : 400 }}>{label}</span>
    </Link>
  )
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { visible, toggle } = usePrivacy()
  const [user,       setUser]       = useState<any>(null)
  const [email,      setEmail]      = useState('')
  const [password,   setPassword]   = useState('')
  const [marketData, setMarketData] = useState<any>({})

  const FINNHUB_API_KEY = process.env.NEXT_PUBLIC_FINNHUB_KEY

  const symbols = [
    { api: 'SPY',             label: 'SPY' },
    { api: 'QQQ',             label: 'QQQ' },
    { api: 'DIA',             label: 'DIA' },
    { api: 'BINANCE:BTCUSDT', label: 'BTC' },
  ]

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user))
  }, [])

  useEffect(() => {
    if (!user) return
    const fetchData = async () => {
      try {
        const stockSymbols = symbols.filter(s => s.api !== 'BINANCE:BTCUSDT')
        const responses = await Promise.all(
          stockSymbols.map(s =>
            fetch(`https://finnhub.io/api/v1/quote?symbol=${s.api}&token=${FINNHUB_API_KEY}`).then(r => r.json())
          )
        )
        const results: any = {}
        stockSymbols.forEach((s, i) => { if (responses[i]?.c) results[s.api] = responses[i] })
        try {
          const btc = await fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT').then(r => r.json())
          results['BINANCE:BTCUSDT'] = { c: parseFloat(btc.lastPrice), dp: parseFloat(btc.priceChangePercent) }
        } catch {}
        setMarketData(results)
      } catch (e) { console.error('Market fetch error:', e) }
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

  // ── Login screen con tema gato ─────────────────────────────────────────
  if (!user) {
    return (
      <div style={loginOverlay}>
        {/* Decoraciones de gato en el login */}
        <div style={{ position: 'absolute', top: '15%', left: '50%', transform: 'translateX(-50%)', pointerEvents: 'none' }}>
          <CatEars color="#00bfff" opacity={0.18} size={60} />
        </div>
        <div style={{ position: 'absolute', bottom: '10%', right: '15%', pointerEvents: 'none' }}>
          <CatSitting size={100} color="#00bfff" opacity={0.06} />
        </div>
        <div style={{ position: 'absolute', bottom: '10%', left: '12%', pointerEvents: 'none' }}>
          <CatTail color="#00bfff" opacity={0.07} h={120} />
        </div>
        {/* Rastro de huellas diagonal */}
        {[{ top: '20%', left: '10%', r: -10 }, { top: '30%', left: '8%', r: 5 }, { top: '40%', left: '12%', r: -5 }].map((pos, i) => (
          <div key={i} style={{ position: 'absolute', top: pos.top, left: pos.left, pointerEvents: 'none' }}>
            <Paw size={16 - i * 2} color="#00bfff" opacity={0.07 - i * 0.01} rotate={pos.r} />
          </div>
        ))}
        {[{ top: '25%', right: '10%', r: 10 }, { top: '35%', right: '8%', r: -5 }, { top: '45%', right: '12%', r: 5 }].map((pos, i) => (
          <div key={i} style={{ position: 'absolute', top: pos.top, right: pos.right, pointerEvents: 'none' }}>
            <Paw size={14 - i * 2} color="#00bfff" opacity={0.06 - i * 0.01} rotate={pos.r} />
          </div>
        ))}

        <div style={loginCard}>
          {/* Header del login */}
          <div style={{ textAlign: 'center', marginBottom: 28, position: 'relative' }}>
            {/* Orejas sobre el logo */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: -8, opacity: 0.7 }}>
              <CatEars color="#00bfff" opacity={0.9} size={22} />
            </div>
            {/* Gato principal */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12, position: 'relative' }}>
              <Cat size={46} color="#00bfff" />
              {/* Bigotes decorativos */}
              <div style={{ position: 'absolute', top: '38%', left: '50%', transform: 'translateX(-50%)', pointerEvents: 'none' }}>
                <Whiskers color="#00bfff" opacity={0.35} w={96} />
              </div>
            </div>
            <h2 style={{ margin: 0, color: 'white', fontSize: 20, fontWeight: 900, letterSpacing: 1 }}>
              TRADER<span style={{ color: '#00bfff' }}>CAT</span>
            </h2>
            <p style={{ margin: '6px 0 0', fontSize: 11, color: '#666', letterSpacing: 2 }}>TERMINAL</p>

            {/* Rastro de huellas en el card */}
            <div style={{ position: 'absolute', top: 0, right: 8, display: 'flex', flexDirection: 'column', gap: 8, opacity: 0.12 }}>
              {[10, 8, 6].map((s, i) => <Paw key={i} size={s} color="#00bfff" opacity={1} rotate={i * 12} />)}
            </div>
          </div>

          <input placeholder="Email" onChange={e => setEmail(e.target.value)} style={inputStyle} />
          <input type="password" placeholder="Contraseña" onChange={e => setPassword(e.target.value)}
            style={inputStyle} onKeyDown={e => e.key === 'Enter' && handleLogin()} />
          <button onClick={handleLogin} style={buttonStyle}>
            <Paw size={13} color="#000" opacity={0.7} />
            Entrar al terminal
          </button>

          {/* Huellas abajo del botón */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16, opacity: 0.2 }}>
            {[12, 9, 7, 9, 12].map((s, i) => <Paw key={i} size={s} color="#00bfff" opacity={1} rotate={(i - 2) * 15} />)}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ background: '#050505', color: 'white', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>

      {/* ── TopBar ── */}
      <div style={topBar}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Huellas mini en el topbar */}
          <div style={{ display: 'flex', gap: 3, marginRight: 6, opacity: 0.15 }}>
            {[8, 6, 5].map((s, i) => <Paw key={i} size={s} color="#00bfff" opacity={1} rotate={i * 10} />)}
          </div>
          {symbols.map(({ api, label }) => {
            const data = marketData[api]
            if (!data) return null
            const isUp = data.dp >= 0
            return (
              <div key={api} style={tickerItem}>
                <span style={{ fontWeight: 800, fontSize: 10, color: '#aaa' }}>{label}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>${data.c?.toFixed(2)}</span>
                <span style={{ fontSize: 10, color: isUp ? '#22c55e' : '#f43f5e' }}>
                  {isUp ? '▲' : '▼'} {Math.abs(data.dp)?.toFixed(2)}%
                </span>
              </div>
            )
          })}
        </div>
        <button onClick={() => supabase.auth.signOut().then(() => window.location.reload())} style={logoutBtn}
          title="Cerrar sesión"
          onMouseEnter={e => (e.currentTarget.style.color = '#f43f5e')}
          onMouseLeave={e => (e.currentTarget.style.color = '#555')}>
          <LogOut size={15} />
        </button>
      </div>

      <div style={{ display: 'flex', flex: 1 }}>

        {/* ── Sidebar con gatos al máximo ── */}
        <aside style={sidebar}>

          {/* Logo */}
          <div style={{ ...logoSection, position: 'relative', overflow: 'hidden' }}>
            {/* Orejas encima del logo */}
            <div style={{ position: 'absolute', top: -4, left: 8, pointerEvents: 'none' }}>
              <CatEars color="#00bfff" opacity={0.4} size={18} />
            </div>
            <Cat size={22} color="#00bfff" />
            <span style={{ fontWeight: 900, fontSize: 15, letterSpacing: 1, color: '#ccc' }}>
              TRADER<span style={{ color: '#00bfff' }}>CAT</span>
            </span>
            {/* Bigotes en el logo */}
            <div style={{ position: 'absolute', right: 6, top: '35%', pointerEvents: 'none' }}>
              <Whiskers color="#00bfff" opacity={0.15} w={50} />
            </div>
          </div>

          {/* Nav */}
          <nav style={{ display: 'flex', flexDirection: 'column', marginTop: 6, flex: 1, overflowY: 'auto', position: 'relative' }}>

            {/* Gato sentado de fondo (a media altura del sidebar) */}
            <div style={{ position: 'absolute', bottom: 80, left: '50%', transform: 'translateX(-50%)', pointerEvents: 'none', zIndex: 0 }}>
              <CatSitting size={80} color="#00bfff" opacity={0.04} />
            </div>
            {/* Cola lateral del sidebar */}
            <div style={{ position: 'absolute', right: -4, top: '40%', pointerEvents: 'none', zIndex: 0 }}>
              <CatTail color="#00bfff" opacity={0.06} h={70} />
            </div>
            {/* Rastro de huellas vertical izquierda */}
            <div style={{ position: 'absolute', left: 3, top: '25%', pointerEvents: 'none', zIndex: 0, display: 'flex', flexDirection: 'column', gap: 28 }}>
              {[7, 6, 5, 4].map((s, i) => <Paw key={i} size={s} color="#00bfff" opacity={0.05} rotate={i * 15} />)}
            </div>

            <div style={{ position: 'relative', zIndex: 1 }}>
              <MenuLink href="/" icon={<LayoutDashboard size={15} />} label="Home" active={pathname === '/'} />

              <div style={sectionLabel}>
                <Paw size={7} color="#555" opacity={0.8} style={{ marginRight: 4 }} />
                TRADING
              </div>
              <MenuLink href="/trades"   icon={<BarChart3   size={15} />} label="Nuevo Trade" active={pathname === '/trades'} />
              <MenuLink href="/abiertos" icon={<TrendingUp  size={15} />} label="Abiertos"    active={pathname === '/abiertos'} />
              <MenuLink href="/cerrados" icon={<History     size={15} />} label="Cerrados"    active={pathname === '/cerrados'} />

              <div style={sectionLabel}>
                <Paw size={7} color="#555" opacity={0.8} style={{ marginRight: 4 }} />
                ANÁLISIS
              </div>
              <MenuLink href="/watchlist" icon={<SearchCode size={15} />} label="Seguimiento" active={pathname === '/watchlist'} />

              <div style={groupHeader}>
                <Activity size={13} color="#555" />
                <span>Estadísticas</span>
              </div>
              <MenuLink href="/estadisticas"  label="Abiertos"  active={pathname === '/estadisticas'}  isSubItem />
              <MenuLink href="/estadisticas2" label="Cerrados"  active={pathname === '/estadisticas2'} isSubItem />

              <div style={groupHeader}>
                <PieChart size={13} color="#555" />
                <span>Gráficos</span>
              </div>
              <MenuLink href="/graficos"  label="Abiertos" active={pathname === '/graficos'}  isSubItem />
              <MenuLink href="/graficos2" label="Cerrados" active={pathname === '/graficos2'} isSubItem />

              <div style={sectionLabel}>
                <Paw size={7} color="#555" opacity={0.8} style={{ marginRight: 4 }} />
                WALLET
              </div>
              <MenuLink href="/portafolios" icon={<Wallet size={15} />} label="Billeteras" active={pathname === '/portafolios'} />
              <MenuLink href="/dividendos"  icon={<Coins  size={15} />} label="Dividendos" active={pathname === '/dividendos'} isSubItem />
            </div>

            {/* ── Botón privacidad + huellas al fondo ── */}
            <div style={{ marginTop: 'auto', borderTop: '1px solid #111', padding: '10px 12px', flexShrink: 0, position: 'relative', zIndex: 1 }}>
              {/* Huellas decorativas sobre el botón */}
              <div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end', marginBottom: 8, opacity: 0.12 }}>
                {[9, 7, 6].map((s, i) => <Paw key={i} size={s} color="#00bfff" opacity={1} rotate={i * 12} />)}
              </div>
              <button onClick={toggle} style={privacyBtn}
                onMouseEnter={e => (e.currentTarget.style.borderColor = '#00bfff33')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = '#1a1a1a')}>
                {visible
                  ? <><Eye size={13} color="#888" /> <span style={{ color: '#aaa' }}>Ocultar valores</span></>
                  : <><EyeOff size={13} color="#00bfff" /> <span style={{ color: '#00bfff' }}>Mostrar valores</span></>
                }
              </button>
              {/* Versión */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 8 }}>
                <Paw size={8} color="#222" opacity={1} />
                <span style={{ fontSize: 9, color: '#222', letterSpacing: 1 }}>TRADERCAT v2.0</span>
                <Paw size={8} color="#222" opacity={1} rotate={180} />
              </div>
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

// ── Estilos ───────────────────────────────────────────────────────────────────

const sidebar: React.CSSProperties = {
  width: 182,
  background: '#080808',
  borderRight: '1px solid #141414',
  height: 'calc(100vh - 40px)',
  position: 'sticky',
  top: 40,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
}

const topBar: React.CSSProperties = {
  height: 40,
  background: '#000',
  borderBottom: '1px solid #141414',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 14px',
  zIndex: 100,
  position: 'sticky',
  top: 0,
}

const tickerItem: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 7,
  background: '#0a0a0a', padding: '3px 10px',
  borderRadius: 4, border: '1px solid #111',
}

const logoSection: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '14px 14px 14px 14px',
  borderBottom: '1px solid #141414',
  minHeight: 52,
}

const sectionLabel: React.CSSProperties = {
  display: 'flex', alignItems: 'center',
  fontSize: 9, color: '#555', fontWeight: 700,
  padding: '14px 14px 5px 14px', letterSpacing: 1,
}

const groupHeader: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  fontSize: 11, color: '#666',
  padding: '8px 14px 2px 14px',
}

const logoutBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: '#555',
  cursor: 'pointer', padding: 5, transition: 'color 0.2s',
  display: 'flex', alignItems: 'center',
}

const privacyBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  background: 'none', border: '1px solid #1a1a1a',
  color: '#888', cursor: 'pointer',
  padding: '7px 10px', borderRadius: 6, fontSize: 11, width: '100%',
  transition: 'border-color 0.2s',
}

const loginOverlay: React.CSSProperties = {
  position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
  background: '#040408', display: 'flex', justifyContent: 'center',
  alignItems: 'center', zIndex: 2000, overflow: 'hidden',
}

const loginCard: React.CSSProperties = {
  background: '#0a0a0a', padding: '28px 28px 20px',
  borderRadius: 18, border: '1px solid #1a1a1a',
  width: '100%', maxWidth: 320, position: 'relative',
  boxShadow: '0 0 40px rgba(0,191,255,0.05)',
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: '#0f0f0f', border: '1px solid #222',
  color: '#ddd', padding: '10px 12px', borderRadius: 8,
  marginBottom: 10, fontSize: 13, outline: 'none', boxSizing: 'border-box',
}

const buttonStyle: React.CSSProperties = {
  width: '100%', background: '#00bfff', color: '#000',
  border: 'none', padding: '11px', borderRadius: 8,
  fontWeight: 900, cursor: 'pointer', fontSize: 13,
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  letterSpacing: 0.5,
}