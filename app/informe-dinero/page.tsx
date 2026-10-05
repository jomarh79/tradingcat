'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { usePrivacy } from '@/lib/PrivacyContext'
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area } from 'recharts'
import AppShell from '../AppShell'

const dayKey = (d: any) => String(d || '').split('T')[0].split(' ')[0]
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const r2 = (n: number) => parseFloat(n.toFixed(2))
const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`

const C = {
  bg:     '#070709', card:   '#0a0a0c', border: '#141418',
  accent: '#00bfff', gain:   '#22c55e', loss:   '#f43f5e',
  gold:   '#eab308', purple: '#a78bfa', text:   '#e2e8f0',
  muted:  '#64748b', dim:    '#0f0f12',
}

const MONTH_ORDER = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']

// 'YYYY-MM' → 'ene 2025' / 'ene 25'
const monthLabel = (key: string, shortYear = false) => {
  const [y, m] = key.split('-')
  return `${MONTH_ORDER[Number(m) - 1]} ${shortYear ? y.slice(2) : y}`
}
const nextMonth = (key: string) => {
  const [y, m] = key.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

// Clasificadores — solo dinero real, excluye movement_type='trade'
const isDividend = (m: any) => m.movement_type === 'dividend' || m.is_dividend === true
const isDeposit  = (m: any) => m.movement_type === 'deposito'
const isWithdraw = (m: any) => m.movement_type === 'retiro'
const isReal     = (m: any) => isDeposit(m) || isWithdraw(m) || isDividend(m)

// Máximo 1000 filas por consulta en Supabase: se pide por páginas. Antes eran 20 páginas como tope y un error
// cortaba la carga en silencio; los trades ni siquiera se paginaban.
const PAGE = 1000
async function fetchAll(make: () => any): Promise<any[]> {
  const rows: any[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await make().range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    if (!data?.length) break
    rows.push(...data)
    if (data.length < PAGE) break
  }
  return rows
}

type Kind = 'dep' | 'wd' | 'div'

// Lo que se invirtió en una posición ABIERTA. Preferimos total_invested (costo vigente, el mismo que usa la página
// de inicio); la suma de compras solo queda de respaldo: no descuenta lo ya vendido en parciales.
function openInvested(t: any): number {
  const ti = Number(t.total_invested)
  if (Number.isFinite(ti) && ti > 0) return ti
  const initialInv = Number(t.initial_entry_price || t.entry_price || 0) * Number(t.initial_quantity || t.quantity || 0)
  const buyExtra = (t.trade_executions || [])
    .filter((e: any) => e.execution_type === 'buy')
    .reduce((a: number, e: any) => a + Number(e.quantity) * Number(e.price) + Number(e.commission || 0), 0)
  return r2(initialInv + buyExtra)
}

export default function InformeDinero() {
  const { money, visible } = usePrivacy()

  const [movements,    setMovements]    = useState<any[]>([])
  const [portfolios,   setPortfolios]   = useState<any[]>([])
  const [trades,       setTrades]       = useState<any[]>([])
  const [loading,      setLoading]      = useState(true)
  const [loadError,    setLoadError]    = useState('')
  const [filterWallet, setFilterWallet] = useState('all')
  const [filterYear,   setFilterYear]   = useState<string>(new Date().getFullYear().toString())

  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const [mv, p, t] = await Promise.all([
        fetchAll(() => supabase.from('wallet_movements')
          .select('id, amount, date, movement_type, is_dividend, wallet_id')
          .eq('user_id', user.id).order('date').order('id')),
        fetchAll(() => supabase.from('portfolios').select('id, name, grupo').eq('user_id', user.id).order('id')),
        fetchAll(() => supabase.from('trades')
          .select('id, portfolio_id, realized_pnl, status, close_date, total_invested, initial_entry_price, initial_quantity, entry_price, quantity, trade_executions(quantity, price, commission, execution_type)')
          .eq('user_id', user.id).order('id')),
      ])
      if (!alive.current) return
      setMovements(mv); setPortfolios(p); setTrades(t); setLoadError('')
    } catch (err: any) {
      // Antes un error de Supabase dejaba el informe en ceros sin avisar
      if (alive.current) setLoadError(err?.message || 'No se pudieron cargar los datos')
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // ── Movimientos reales y trades ya normalizados (las fechas se leen una sola vez) ──
  const real = useMemo(() => movements
    .filter(isReal)
    .map(m => {
      const date = dayKey(m.date)
      const kind: Kind = isDividend(m) ? 'div' : isDeposit(m) ? 'dep' : 'wd'
      const amount = Number(m.amount) || 0
      // Los retiros se manejan como magnitud (antes unos sitios usaban el valor con signo y otros el absoluto)
      return { date, month: date.slice(0, 7), year: date.slice(0, 4), wallet: m.wallet_id, kind, amount: kind === 'wd' ? Math.abs(amount) : amount }
    })
    .filter(m => DAY_RE.test(m.date))
  , [movements])

  const closedTrades = useMemo(() => trades
    .filter(t => t.status === 'closed' && DAY_RE.test(dayKey(t.close_date)))
    .map(t => {
      const date = dayKey(t.close_date)
      return { wallet: t.portfolio_id, month: date.slice(0, 7), year: date.slice(0, 4), pnl: Number(t.realized_pnl || 0) }
    })
  , [trades])

  const availableYears = useMemo(() => {
    const years = new Set<string>([new Date().getFullYear().toString()])
    real.forEach(m => years.add(m.year))
    closedTrades.forEach(t => years.add(t.year))
    return Array.from(years).sort((a, b) => b.localeCompare(a))
  }, [real, closedTrades])

  const stats = useMemo(() => {
    const now = new Date()
    const inWallet = (w: any) => filterWallet === 'all' || w === filterWallet

    const rm = real.filter(m => inWallet(m.wallet))
    const sumKind = (list: typeof rm, k: Kind) => list.filter(m => m.kind === k).reduce((a, m) => a + m.amount, 0)

    const totalDeposited = r2(sumKind(rm, 'dep'))
    const totalWithdrawn = r2(sumKind(rm, 'wd'))
    const totalDividends = r2(sumKind(rm, 'div'))

    const wTrades = trades.filter(t => inWallet(t.portfolio_id))
    const totalInvested = r2(wTrades.filter(t => t.status === 'open').reduce((a, t) => a + openInvested(t), 0))
    const wClosed = closedTrades.filter(t => inWallet(t.wallet))
    const totalPnlReal = r2(wClosed.reduce((a, t) => a + t.pnl, 0))

    const capitalNeto = r2(totalDeposited - totalWithdrawn)
    const patrimonio  = r2(capitalNeto + totalPnlReal + totalDividends)
    const rendimiento = capitalNeto > 0 ? r2(((totalPnlReal + totalDividends) / capitalNeto) * 100) : 0

    if (totalDeposited === 0 && portfolios.length === 0) return null

    // ── Flujo mensual (del año elegido, o de todos los meses con actividad) ──
    const monthly: Record<string, { depositos: number; retiros: number; dividendos: number; pnl: number }> = {}
    const ensure = (k: string) => (monthly[k] ??= { depositos: 0, retiros: 0, dividendos: 0, pnl: 0 })
    if (filterYear !== 'all') for (let i = 1; i <= 12; i++) ensure(`${filterYear}-${String(i).padStart(2, '0')}`)

    rm.filter(m => filterYear === 'all' || m.year === filterYear).forEach(m => {
      const row = ensure(m.month)
      if (m.kind === 'div') row.dividendos += m.amount
      else if (m.kind === 'dep') row.depositos += m.amount
      else row.retiros += m.amount
    })
    // PnL de trades cerrados, en el mes de cierre
    wClosed.filter(t => filterYear === 'all' || t.year === filterYear).forEach(t => { ensure(t.month).pnl += t.pnl })

    const monthlyData = Object.entries(monthly)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, d]) => ({
        label:      monthLabel(key),
        depositos:  r2(d.depositos),
        retiros:    r2(d.retiros),
        dividendos: r2(d.dividendos),
        pnl:        r2(d.pnl),
        neto:       r2(d.depositos - d.retiros + d.dividendos + d.pnl),
      }))

    // ── Crecimiento del patrimonio: una línea de tiempo mensual continua, acumulando mes a mes ──
    // Antes el PnL y los dividendos solo se reflejaban en los meses que tenían un depósito o retiro, y los meses
    // con solo cierres de trades no aparecían.
    const delta: Record<string, { cap: number; pnl: number; div: number }> = {}
    const dEnsure = (k: string) => (delta[k] ??= { cap: 0, pnl: 0, div: 0 })
    rm.forEach(m => {
      const d = dEnsure(m.month)
      if (m.kind === 'dep') d.cap += m.amount
      else if (m.kind === 'wd') d.cap -= m.amount
      else d.div += m.amount
    })
    wClosed.forEach(t => { dEnsure(t.month).pnl += t.pnl })

    const growthData: { label: string; capital: number; patrimonio: number }[] = []
    const keys = Object.keys(delta).sort()
    if (keys.length) {
      const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
      const end = keys[keys.length - 1] > currentKey ? keys[keys.length - 1] : currentKey
      let cap = 0, pnl = 0, div = 0
      for (let k = keys[0]; k <= end; k = nextMonth(k)) {
        const d = delta[k]
        if (d) { cap += d.cap; pnl += d.pnl; div += d.div }
        growthData.push({ label: monthLabel(k, true), capital: r2(cap), patrimonio: r2(cap + pnl + div) })
      }
    }

    // ── Por billetera (siempre todas, sin los filtros de arriba) ──
    const walletAgg = new Map<any, { dep: number; wd: number; div: number }>()
    real.forEach(m => {
      const a = walletAgg.get(m.wallet) ?? { dep: 0, wd: 0, div: 0 }
      if (m.kind === 'dep') a.dep += m.amount
      else if (m.kind === 'wd') a.wd += m.amount
      else a.div += m.amount
      walletAgg.set(m.wallet, a)
    })
    const walletStats = portfolios.map(p => {
      const a = walletAgg.get(p.id) ?? { dep: 0, wd: 0, div: 0 }
      const pTrades = trades.filter(t => t.portfolio_id === p.id)
      const invertido = r2(pTrades.filter(t => t.status === 'open').reduce((s, t) => s + openInvested(t), 0))
      const pnl = r2(closedTrades.filter(t => t.wallet === p.id).reduce((s, t) => s + t.pnl, 0))
      const neto = r2(a.dep - a.wd)
      return {
        name: p.name as string,
        depositado: r2(a.dep), retirado: r2(a.wd), invertido, dividendos: r2(a.div), pnl, neto,
        rendimiento: neto > 0 ? r2(((pnl + a.div) / neto) * 100) : 0,
      }
    }).filter(w => w.depositado > 0 || w.invertido > 0 || w.pnl !== 0)

    // ── Historial anual (histórico completo, solo filtrado por billetera) ──
    const byYear: Record<string, { depositos: number; retiros: number; dividendos: number }> = {}
    rm.forEach(m => {
      const y = (byYear[m.year] ??= { depositos: 0, retiros: 0, dividendos: 0 })
      if (m.kind === 'div') y.dividendos += m.amount
      else if (m.kind === 'dep') y.depositos += m.amount
      else y.retiros += m.amount
    })
    const historialAnual = Object.entries(byYear)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([year, d]) => ({
        year, depositos: r2(d.depositos), retirado: r2(d.retiros),
        neto: r2(d.depositos - d.retiros), dividendos: r2(d.dividendos),
      }))

    // ── Money Score ──
    const scoreRendimiento = Math.min(Math.max(rendimiento * 5, 0), 100)
    const scoreDiversif    = Math.min((walletStats.length / 4) * 100, 100)
    const mesesConDeposito = monthlyData.filter(m => m.depositos > 0).length
    // Meses que "debieron" tener depósito. Antes, al elegir un año pasado se dividía entre el mes en curso (p. ej. 10)
    // en vez de 12, y con "todos los años" solo se contaban los meses que tenían actividad.
    const totalMeses = Math.max(
      filterYear === 'all'
        ? growthData.length
        : Number(filterYear) === now.getFullYear() ? now.getMonth() + 1 : 12,
      1
    )
    const scoreConsistencia = Math.min((mesesConDeposito / totalMeses) * 100, 100)
    const scoreAhorro = (capitalNeto + totalWithdrawn) > 0
      ? Math.min((capitalNeto / (capitalNeto + totalWithdrawn)) * 150, 100) : 0
    const gain = totalPnlReal + totalDividends
    const scorePatrimonio = gain > 0 ? 100 : gain === 0 ? 50 : 20
    const moneyScore = Math.round(
      scoreRendimiento * 0.30 + scoreDiversif * 0.20 +
      scoreConsistencia * 0.20 + scoreAhorro * 0.15 + scorePatrimonio * 0.15
    )

    return {
      totalDeposited, totalWithdrawn, totalDividends, totalInvested, totalPnlReal,
      capitalNeto, patrimonio, rendimiento,
      monthlyData, growthData, walletStats, historialAnual,
      moneyScore, scoreRendimiento, scoreDiversif, scoreConsistencia, scoreAhorro, scorePatrimonio,
    }
  }, [real, closedTrades, trades, portfolios, filterWallet, filterYear])

  const scoreColor = (s: number) => s >= 75 ? C.gain : s >= 50 ? C.gold : C.loss
  const scoreLabel = (s: number) => s >= 75 ? 'Sólido' : s >= 50 ? 'Regular' : 'Mejorable'

  // Ejes y tooltips respetan el modo privacidad global (antes la página tenía su propio botón de ocultar
  // y los ejes seguían mostrando los importes)
  const axisMoney = (v: number) => !visible ? '' : Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v}`
  const tooltipMoney = (v: any, name: any) => [money(Number(v) || 0), name || '']
  const tooltipStyle = { background: C.dim, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11 }

  const chipStyle = (active: boolean): React.CSSProperties => ({
    padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer',
    background: active ? C.accent : C.dim,
    color: active ? '#000' : C.muted,
    border: `1px solid ${active ? C.accent : C.border}`,
  })

  // (Era un componente definido dentro de la página: se recreaba en cada render)
  const filterBar = (
    <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
      <div style={{ position: 'relative' }}>
        <select value={filterYear} onChange={e => setFilterYear(e.target.value)} style={{
          background: C.dim, border: `1px solid ${C.border}`, color: C.text,
          padding: '6px 32px 6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700,
          cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none', outline: 'none',
        }}>
          <option value="all">Todos los años</option>
          {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: C.muted, fontSize: 10 }}>▼</span>
      </div>
      <div style={{ width: 1, background: C.border, height: 28 }} />
      <button onClick={() => setFilterWallet('all')} style={chipStyle(filterWallet === 'all')}>Todas</button>
      {portfolios.map(p => (
        <button key={p.id} onClick={() => setFilterWallet(p.id)} style={chipStyle(filterWallet === p.id)}>{p.name}</button>
      ))}
    </div>
  )

  const errorBanner = loadError && (
    <div style={{
      marginBottom: 14, padding: '10px 14px', borderRadius: 10, fontSize: 12,
      background: 'rgba(244,63,94,0.06)', border: '1px solid rgba(244,63,94,0.25)', color: C.loss,
    }}>
      No se pudieron cargar los datos ({loadError}). El informe puede estar incompleto; recarga la página.
    </div>
  )

  if (loading) return (
    <AppShell>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: C.muted, fontSize: 13 }}>
        Cargando informe...
      </div>
    </AppShell>
  )

  if (!stats) return (
    <AppShell>
      <div style={{ padding: '20px 24px', background: C.bg, minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>💵 Informe ejecutivo</div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: C.gain }}>Dinero</h1>
        </div>
        {errorBanner}
        {filterBar}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40vh', color: C.muted, fontSize: 13 }}>
          Sin movimientos de dinero registrados.
        </div>
      </div>
    </AppShell>
  )

  const maxNeto = Math.max(...stats.historialAnual.map(x => Math.abs(x.neto)), 1)

  return (
    <AppShell>
      <div style={{ padding: '20px 24px', background: C.bg, minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>

        {/* ── Header ── */}
        <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>💵 Informe ejecutivo</div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: C.gain, letterSpacing: -0.5 }}>Dinero</h1>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>
              {filterYear === 'all' ? 'Histórico completo' : filterYear} · {portfolios.length} billeteras
            </div>
          </div>
          <div style={{ textAlign: 'center', background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '14px 24px' }}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>MONEY SCORE</div>
            <div style={{ fontSize: 36, fontWeight: 900, color: scoreColor(stats.moneyScore), lineHeight: 1 }}>{stats.moneyScore}</div>
            <div style={{ fontSize: 9, color: scoreColor(stats.moneyScore), marginTop: 4 }}>/ 100 · {scoreLabel(stats.moneyScore)}</div>
          </div>
        </div>

        {errorBanner}
        {filterBar}

        {/* ── Fila 1: KPIs ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 16 }}>
          {[
            { label: 'CAPITAL DEPOSITADO',  value: money(stats.totalDeposited), color: C.accent, sub: 'dinero de tu bolsillo' },
            { label: 'RETIRADO',            value: money(stats.totalWithdrawn), color: C.muted,  sub: 'dinero sacado' },
            { label: 'CAPITAL NETO',        value: money(stats.capitalNeto),    color: C.text,   sub: 'depositado − retirado' },
            { label: 'INVERTIDO EN TRADES', value: money(stats.totalInvested),  color: C.purple, sub: 'posiciones abiertas' },
            { label: 'PnL REALIZADO',       value: money(stats.totalPnlReal),   color: stats.totalPnlReal >= 0 ? C.gain : C.loss, sub: 'trades cerrados' },
            { label: 'DIVIDENDOS COBRADOS', value: money(stats.totalDividends), color: C.gold,   sub: 'ingreso pasivo' },
          ].map(k => (
            <div key={k.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px' }}>
              <div style={{ fontSize: 8, color: C.muted, fontWeight: 700, letterSpacing: 0.8, marginBottom: 6 }}>{k.label}</div>
              <div style={{ fontSize: 17, fontWeight: 900, color: k.color, marginBottom: 3 }}>{k.value}</div>
              <div style={{ fontSize: 9, color: '#555' }}>{k.sub}</div>
            </div>
          ))}
        </div>

        {/* ── Banner patrimonio ── */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 20px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8, marginBottom: 4 }}>PATRIMONIO TOTAL ESTIMADO</div>
            <div style={{ fontSize: 26, fontWeight: 900, color: stats.patrimonio >= 0 ? C.gain : C.loss }}>{money(stats.patrimonio)}</div>
            <div style={{ fontSize: 9, color: '#555', marginTop: 3 }}>Capital neto + PnL realizado + Dividendos</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8, marginBottom: 4 }}>RENDIMIENTO SOBRE CAPITAL</div>
            <div style={{ fontSize: 26, fontWeight: 900, color: stats.rendimiento >= 0 ? C.gain : C.loss }}>{fmtPct(stats.rendimiento)}</div>
            <div style={{ fontSize: 9, color: '#555', marginTop: 3 }}>(PnL realizado + Dividendos) / Capital neto</div>
          </div>
        </div>

        {/* ── Fila 2: Flujo mensual + Crecimiento ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8, marginBottom: 14 }}>FLUJO MENSUAL DE DINERO REAL</div>
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={stats.monthlyData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#111" vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 8 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: C.muted, fontSize: 8 }} axisLine={false} tickLine={false} tickFormatter={axisMoney} width={44} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: C.accent, fontWeight: 700 }} formatter={tooltipMoney} />
                <Bar dataKey="depositos"  name="Depósitos"  fill={C.gain}   fillOpacity={0.8} radius={[3,3,0,0]} />
                <Bar dataKey="retiros"    name="Retiros"    fill={C.loss}   fillOpacity={0.7} radius={[3,3,0,0]} />
                <Bar dataKey="dividendos" name="Dividendos" fill={C.gold}   fillOpacity={0.8} radius={[3,3,0,0]} />
                <Bar dataKey="pnl"        name="PnL trades" fill={C.purple} fillOpacity={0.8} radius={[3,3,0,0]} />
                <Line type="monotone" dataKey="neto" name="Neto" stroke={C.accent} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
            <div style={{ display: 'flex', gap: 16, marginTop: 8, justifyContent: 'center' }}>
              {[{c:C.gain,l:'Depósitos'},{c:C.loss,l:'Retiros'},{c:C.gold,l:'Dividendos'},{c:C.purple,l:'PnL trades'},{c:C.accent,l:'Neto'}].map(x => (
                <span key={x.l} style={{ fontSize: 9, color: x.c, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: x.c, display: 'inline-block' }} />{x.l}
                </span>
              ))}
            </div>
          </div>

          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8, marginBottom: 14 }}>CRECIMIENTO DEL PATRIMONIO</div>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={stats.growthData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="capGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={C.accent} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={C.accent} stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="patGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={C.gain} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={C.gain} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#111" vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 8 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: C.muted, fontSize: 8 }} axisLine={false} tickLine={false} tickFormatter={axisMoney} width={44} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: C.accent, fontWeight: 700 }} formatter={tooltipMoney} />
                <Area type="monotone" dataKey="capital"    name="Capital depositado"  stroke={C.accent} strokeWidth={2} fill="url(#capGrad)" dot={false} />
                <Area type="monotone" dataKey="patrimonio" name="Patrimonio estimado" stroke={C.gain}   strokeWidth={2} fill="url(#patGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
            <div style={{ display: 'flex', gap: 16, marginTop: 8, justifyContent: 'center' }}>
              {[{c:C.accent,l:'Capital depositado'},{c:C.gain,l:'Patrimonio estimado'}].map(x => (
                <span key={x.l} style={{ fontSize: 9, color: x.c, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: x.c, display: 'inline-block' }} />{x.l}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ── Fila 3: Por billetera + Flujo anual ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.8fr', gap: 14, marginBottom: 16 }}>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8, marginBottom: 12 }}>RESUMEN POR BILLETERA</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ background: C.dim }}>
                  {['Billetera','Depositado','Retirado','Invertido','Dividendos','PnL','Rend.'].map(h => (
                    <th key={h} style={{ padding: '6px 8px', textAlign: h === 'Billetera' ? 'left' : 'right', color: '#555', fontSize: 8, fontWeight: 700, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.walletStats.map(w => (
                  <tr key={w.name} style={{ borderBottom: '1px solid #0a0a0a' }}>
                    <td style={{ padding: '8px 8px', color: C.text, fontWeight: 600 }}>{w.name}</td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', color: C.accent }}>{money(w.depositado)}</td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', color: C.muted }}>{w.retirado > 0 ? money(w.retirado) : '—'}</td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', color: C.purple }}>{money(w.invertido)}</td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', color: C.gold }}>{w.dividendos > 0 ? money(w.dividendos) : '—'}</td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', color: w.pnl >= 0 ? C.gain : C.loss, fontWeight: 700 }}>{money(w.pnl)}</td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', color: w.rendimiento >= 0 ? C.gain : C.loss, fontWeight: 700 }}>{fmtPct(w.rendimiento)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8, marginBottom: 12 }}>FLUJO ANUAL</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {stats.historialAnual.map(y => {
                const width      = Math.abs(y.neto) / maxNeto * 100
                const isSelected = y.year === filterYear
                return (
                  <div key={y.year}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                      <span style={{ fontSize: 11, fontWeight: isSelected ? 900 : 600, color: isSelected ? C.gain : C.muted }}>
                        {y.year}{isSelected && <span style={{ fontSize: 8, color: C.gain, marginLeft: 4 }}>●</span>}
                      </span>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: y.neto >= 0 ? C.gain : C.loss }}>{money(y.neto)}</div>
                        {y.dividendos > 0 && <div style={{ fontSize: 8, color: C.gold }}>+{money(y.dividendos)} div.</div>}
                      </div>
                    </div>
                    <div style={{ height: 3, background: C.dim, borderRadius: 2 }}>
                      <div style={{ width: `${width}%`, height: '100%', borderRadius: 2, background: y.neto >= 0 ? C.gain : C.loss, opacity: isSelected ? 1 : 0.4 }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* ── Money Score desglose ── */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8 }}>MONEY SCORE — DESGLOSE</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ fontSize: 28, fontWeight: 900, color: scoreColor(stats.moneyScore) }}>{stats.moneyScore}</div>
              <div style={{ fontSize: 9, color: scoreColor(stats.moneyScore) }}>/ 100</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
            {[
              { label: 'Rendimiento',     pct: 30, score: Math.round(stats.scoreRendimiento),  desc: `${fmtPct(stats.rendimiento)} sobre capital` },
              { label: 'Diversificación', pct: 20, score: Math.round(stats.scoreDiversif),     desc: `${stats.walletStats.length} billeteras activas` },
              { label: 'Consistencia',    pct: 20, score: Math.round(stats.scoreConsistencia), desc: 'depósitos regulares' },
              { label: 'Ahorro',          pct: 15, score: Math.round(stats.scoreAhorro),       desc: 'capital retenido' },
              { label: 'Patrimonio',      pct: 15, score: Math.round(stats.scorePatrimonio),   desc: 'PnL + dividendos' },
            ].map(k => (
              <div key={k.label} style={{ background: C.dim, borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: C.muted, marginBottom: 6 }}>{k.label}</div>
                <div style={{ fontSize: 18, fontWeight: 900, color: scoreColor(k.score) }}>{k.score}</div>
                <div style={{ fontSize: 8, color: '#555', marginTop: 2 }}>peso {k.pct}%</div>
                <div style={{ fontSize: 7, color: '#444', marginTop: 2 }}>{k.desc}</div>
                <div style={{ height: 3, background: C.border, borderRadius: 2, marginTop: 6 }}>
                  <div style={{ width: `${Math.min(k.score, 100)}%`, height: '100%', background: scoreColor(k.score), borderRadius: 2 }} />
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </AppShell>
  )
}
