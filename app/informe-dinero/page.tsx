'use client'
import { useEffect, useMemo, useState, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, AreaChart, Area } from 'recharts'
import AppShell from '../AppShell'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const parseDate = (d: string) => new Date((d || '').split('T')[0] + 'T00:00:00')
const money     = (v: number) => `$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtPct    = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`

const C = {
  bg:      '#070709',
  card:    '#0a0a0c',
  border:  '#141418',
  accent:  '#00bfff',
  gain:    '#22c55e',
  loss:    '#f43f5e',
  gold:    '#eab308',
  purple:  '#a78bfa',
  text:    '#e2e8f0',
  muted:   '#64748b',
  dim:     '#0f0f12',
}

const MONTH_ORDER = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']

export default function InformeDinero() {
  const [movements,    setMovements]    = useState<any[]>([])
  const [portfolios,   setPortfolios]   = useState<any[]>([])
  const [trades,       setTrades]       = useState<any[]>([])
  const [loading,      setLoading]      = useState(true)
  const [filterWallet, setFilterWallet] = useState('all')
  const [filterYear,   setFilterYear]   = useState<string>(new Date().getFullYear().toString())
  const [hideValues,   setHideValues]   = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    // Traer TODOS los movimientos con paginación
    let allMov: any[] = []
    let from = 0
    while (true) {
      const { data: chunk } = await supabase
        .from('wallet_movements')
        .select('id, amount, date, movement_type, is_dividend, wallet_id, ticker, notes')
        .eq('user_id', user.id)
        .order('date', { ascending: true })
        .range(from, from + 999)
      if (!chunk?.length) break
      allMov = [...allMov, ...chunk]
      if (chunk.length < 1000) break
      from += 1000
    }
    setMovements(allMov)

    const [{ data: pData }, { data: tData }] = await Promise.all([
      supabase.from('portfolios').select('id, name, grupo').eq('user_id', user.id),
      supabase.from('trades').select('portfolio_id, total_invested, realized_pnl, status, initial_entry_price, initial_quantity, entry_price, quantity, trade_executions(quantity, price, commission, execution_type)').eq('user_id', user.id),
    ])
    setPortfolios(pData || [])
    setTrades(tData || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const calcInvested = useCallback((t: any): number => {
    const initialInv = Number(t.initial_entry_price || t.entry_price || 0) * Number(t.initial_quantity || t.quantity || 0)
    const buyExtra   = (t.trade_executions || [])
      .filter((e: any) => e.execution_type === 'buy')
      .reduce((a: number, e: any) => a + Number(e.quantity) * Number(e.price) + Number(e.commission || 0), 0)
    return parseFloat((initialInv + buyExtra).toFixed(2))
  }, [])

  const availableYears = useMemo(() => {
    const years = new Set(movements.map(m => parseDate(m.date).getFullYear().toString()))
    return Array.from(years).sort((a, b) => b.localeCompare(a))
  }, [movements])

  const filteredMovements = useMemo(() => {
    return movements.filter(m => {
      const matchWallet = filterWallet === 'all' || m.wallet_id === filterWallet
      const matchYear   = filterYear === 'all' || parseDate(m.date).getFullYear().toString() === filterYear
      return matchWallet && matchYear
    })
  }, [movements, filterWallet, filterYear])

  const stats = useMemo(() => {
    if (!filteredMovements.length && !portfolios.length) return null
    const now   = new Date()
    const year  = filterYear === 'all' ? now.getFullYear() : parseInt(filterYear)
    const month = now.getMonth()

    const isDividend  = (m: any) => m.is_dividend === true || m.movement_type === 'dividend'
    const isDeposit   = (m: any) => !isDividend(m) && Number(m.amount) > 0
    const isWithdraw  = (m: any) => !isDividend(m) && Number(m.amount) < 0

    // ── KPIs globales (todos los movimientos sin filtro de año para totales) ──
    const allDeposits   = movements.filter(m => filterWallet === 'all' || m.wallet_id === filterWallet).filter(isDeposit)
    const allWithdraws  = movements.filter(m => filterWallet === 'all' || m.wallet_id === filterWallet).filter(isWithdraw)
    const allDividends  = movements.filter(m => filterWallet === 'all' || m.wallet_id === filterWallet).filter(isDividend)

    const totalDeposited = parseFloat(allDeposits.reduce((a, m) => a + Number(m.amount), 0).toFixed(2))
    const totalWithdrawn = parseFloat(Math.abs(allWithdraws.reduce((a, m) => a + Number(m.amount), 0)).toFixed(2))
    const totalDividends = parseFloat(allDividends.reduce((a, m) => a + Number(m.amount), 0).toFixed(2))

    const filteredTrades = trades.filter(t => filterWallet === 'all' || t.portfolio_id === filterWallet)
    const totalInvested  = parseFloat(filteredTrades.filter(t => t.status === 'open').reduce((a, t) => a + calcInvested(t), 0).toFixed(2))
    const totalPnlReal   = parseFloat(filteredTrades.filter(t => t.status === 'closed').reduce((a, t) => a + Number(t.realized_pnl || 0), 0).toFixed(2))

    const capitalNeto    = parseFloat((totalDeposited - totalWithdrawn).toFixed(2))
    const patrimonio     = parseFloat((capitalNeto + totalPnlReal + totalDividends).toFixed(2))
    const rendimiento    = capitalNeto > 0 ? parseFloat(((totalPnlReal + totalDividends) / capitalNeto * 100).toFixed(2)) : 0

    // ── Flujo mensual (filtrado por año seleccionado) ─────────────────────
    const monthly: Record<string, { depositos: number, retiros: number, dividendos: number }> = {}
    // Inicializar 12 meses si hay año seleccionado
    if (filterYear !== 'all') {
      for (let i = 0; i < 12; i++) {
        const key = `${year}-${String(i).padStart(2,'0')}`
        monthly[key] = { depositos: 0, retiros: 0, dividendos: 0 }
      }
    }
    filteredMovements.forEach(m => {
      const d   = parseDate(m.date)
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2,'0')}`
      if (!monthly[key]) monthly[key] = { depositos: 0, retiros: 0, dividendos: 0 }
      if (isDividend(m))     monthly[key].dividendos += Number(m.amount)
      else if (Number(m.amount) > 0) monthly[key].depositos += Number(m.amount)
      else                           monthly[key].retiros   += Math.abs(Number(m.amount))
    })

    const monthlyData = Object.entries(monthly)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, d]) => {
        const [y, mo] = key.split('-')
        return {
          label:      `${MONTH_ORDER[parseInt(mo)]} ${y}`,
          depositos:  parseFloat(d.depositos.toFixed(2)),
          retiros:    parseFloat(d.retiros.toFixed(2)),
          dividendos: parseFloat(d.dividendos.toFixed(2)),
          neto:       parseFloat((d.depositos - d.retiros + d.dividendos).toFixed(2)),
        }
      })

    // ── Crecimiento acumulado (todos los movimientos sin filtro de año) ───
    let cumDeposit = 0, cumPnl = 0
    const growthData = allDeposits.concat(allWithdraws).concat(allDividends)
      .sort((a, b) => parseDate(a.date).getTime() - parseDate(b.date).getTime())
      .reduce((acc: any[], m) => {
        if (isDividend(m)) cumPnl += Number(m.amount)
        else cumDeposit += Number(m.amount)
        const last = acc[acc.length - 1]
        const d = parseDate(m.date)
        const label = `${MONTH_ORDER[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`
        if (last?.label === label) {
          last.capital    = parseFloat(cumDeposit.toFixed(2))
          last.patrimonio = parseFloat((cumDeposit + cumPnl).toFixed(2))
        } else {
          acc.push({ label, capital: parseFloat(cumDeposit.toFixed(2)), patrimonio: parseFloat((cumDeposit + cumPnl).toFixed(2)) })
        }
        return acc
      }, [])

    // ── Por billetera ─────────────────────────────────────────────────────
    const walletStats = portfolios.map(p => {
      const wMov      = movements.filter(m => m.wallet_id === p.id)
      const wDep      = wMov.filter(isDeposit).reduce((a, m) => a + Number(m.amount), 0)
      const wWit      = Math.abs(wMov.filter(isWithdraw).reduce((a, m) => a + Number(m.amount), 0))
      const wDiv      = wMov.filter(isDividend).reduce((a, m) => a + Number(m.amount), 0)
      const wTrades   = trades.filter(t => t.portfolio_id === p.id)
      const wInv      = wTrades.filter(t => t.status === 'open').reduce((a, t) => a + calcInvested(t), 0)
      const wPnl      = wTrades.filter(t => t.status === 'closed').reduce((a, t) => a + Number(t.realized_pnl || 0), 0)
      const wNeto     = wDep - wWit
      const wRend     = wNeto > 0 ? parseFloat(((wPnl + wDiv) / wNeto * 100).toFixed(2)) : 0
      return {
        name:       p.name,
        depositado: parseFloat(wDep.toFixed(2)),
        retirado:   parseFloat(wWit.toFixed(2)),
        invertido:  parseFloat(wInv.toFixed(2)),
        dividendos: parseFloat(wDiv.toFixed(2)),
        pnl:        parseFloat(wPnl.toFixed(2)),
        rendimiento: wRend,
      }
    }).filter(w => w.depositado > 0 || w.invertido > 0)

    // ── Distribución ──────────────────────────────────────────────────────
    const saldoDisponible = parseFloat((totalDeposited - totalWithdrawn - totalInvested - totalPnlReal).toFixed(2))
    const distribucion = [
      { label: 'Invertido',   value: totalInvested,  color: C.accent,  pct: patrimonio > 0 ? parseFloat((totalInvested / Math.abs(patrimonio) * 100).toFixed(1)) : 0 },
      { label: 'Disponible',  value: Math.max(saldoDisponible, 0), color: C.gold, pct: patrimonio > 0 ? parseFloat((Math.max(saldoDisponible, 0) / Math.abs(patrimonio) * 100).toFixed(1)) : 0 },
      { label: 'PnL Cerrados',value: totalPnlReal,   color: totalPnlReal >= 0 ? C.gain : C.loss, pct: patrimonio > 0 ? parseFloat((totalPnlReal / Math.abs(patrimonio) * 100).toFixed(1)) : 0 },
      { label: 'Dividendos',  value: totalDividends, color: '#eab308', pct: patrimonio > 0 ? parseFloat((totalDividends / Math.abs(patrimonio) * 100).toFixed(1)) : 0 },
    ]

    // ── Historial anual (sin filtro de año) ───────────────────────────────
    const byYear: Record<string, { depositos: number, retiros: number, dividendos: number, pnl: number }> = {}
    movements.filter(m => filterWallet === 'all' || m.wallet_id === filterWallet).forEach(m => {
      const y = parseDate(m.date).getFullYear().toString()
      if (!byYear[y]) byYear[y] = { depositos: 0, retiros: 0, dividendos: 0, pnl: 0 }
      if (isDividend(m))           byYear[y].dividendos += Number(m.amount)
      else if (Number(m.amount) > 0) byYear[y].depositos += Number(m.amount)
      else                           byYear[y].retiros   += Math.abs(Number(m.amount))
    })
    trades.filter(t => t.status === 'closed' && (filterWallet === 'all' || t.portfolio_id === filterWallet)).forEach(t => {
      // Usar close_date si existe
    })
    const historialAnual = Object.entries(byYear)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([y, d]) => ({
        year:       y,
        depositos:  parseFloat(d.depositos.toFixed(2)),
        retirado:   parseFloat(d.retiros.toFixed(2)),
        neto:       parseFloat((d.depositos - d.retiros).toFixed(2)),
        dividendos: parseFloat(d.dividendos.toFixed(2)),
      }))

    // ── Money Score ───────────────────────────────────────────────────────
    const scoreRendimiento   = Math.min(Math.max(rendimiento * 5, 0), 100)
    const scoreDiversif      = Math.min((portfolios.filter(p => walletStats.find(w => w.name === p.name && w.depositado > 0)).length / 4) * 100, 100)
    const scoreConsistencia  = (() => {
      const mesesConDeposito = monthlyData.filter(m => m.depositos > 0).length
      const total = filterYear !== 'all' ? month + 1 : monthlyData.length
      return total > 0 ? Math.min((mesesConDeposito / total) * 100, 100) : 0
    })()
    const scoreAhorro        = capitalNeto > 0 ? Math.min((capitalNeto / (capitalNeto + totalWithdrawn)) * 100 * 1.5, 100) : 0
    const scorePatrimonio    = totalPnlReal + totalDividends > 0 ? 100 : totalPnlReal + totalDividends === 0 ? 50 : 20
    const moneyScore = Math.round(
      scoreRendimiento  * 0.30 +
      scoreDiversif     * 0.20 +
      scoreConsistencia * 0.20 +
      scoreAhorro       * 0.15 +
      scorePatrimonio   * 0.15
    )

    return {
      totalDeposited, totalWithdrawn, totalDividends, totalInvested, totalPnlReal,
      capitalNeto, patrimonio, rendimiento,
      monthlyData, growthData, walletStats, distribucion, historialAnual,
      moneyScore, scoreRendimiento, scoreDiversif, scoreConsistencia, scoreAhorro, scorePatrimonio,
    }
  }, [filteredMovements, movements, portfolios, trades, calcInvested, filterWallet, filterYear])

  const scoreColor = (s: number) => s >= 75 ? C.gain : s >= 50 ? C.gold : C.loss
  const scoreLabel = (s: number) => s >= 75 ? 'Sólido' : s >= 50 ? 'Regular' : 'Mejorable'
  const hide = (v: string) => hideValues ? '••••' : v

  const FilterBar = () => (
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
      <button onClick={() => setFilterWallet('all')} style={{
        padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer',
        background: filterWallet === 'all' ? C.accent : C.dim,
        color: filterWallet === 'all' ? '#000' : C.muted,
        border: `1px solid ${filterWallet === 'all' ? C.accent : C.border}`,
      }}>Todas</button>
      {portfolios.map(p => (
        <button key={p.id} onClick={() => setFilterWallet(p.id)} style={{
          padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer',
          background: filterWallet === p.id ? C.accent : C.dim,
          color: filterWallet === p.id ? '#000' : C.muted,
          border: `1px solid ${filterWallet === p.id ? C.accent : C.border}`,
        }}>{p.name}</button>
      ))}
      <div style={{ marginLeft: 'auto' }}>
        <button onClick={() => setHideValues(v => !v)} style={{
          padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer',
          background: C.dim, color: C.muted, border: `1px solid ${C.border}`,
        }}>{hideValues ? '👁 Mostrar' : '🙈 Ocultar'} valores</button>
      </div>
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
        <FilterBar />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40vh', color: C.muted, fontSize: 13 }}>
          Sin movimientos registrados.
        </div>
      </div>
    </AppShell>
  )

  return (
    <AppShell>
      <div style={{ padding: '20px 24px', background: C.bg, minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>

        {/* ── Header ── */}
        <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>
              💵 Informe ejecutivo
            </div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: C.gain, letterSpacing: -0.5 }}>
              Dinero
            </h1>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>
              {filterYear === 'all' ? 'Histórico completo' : filterYear} · {portfolios.length} billeteras
            </div>
          </div>
          {/* Money Score */}
          <div style={{ textAlign: 'center', background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '14px 24px' }}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>MONEY SCORE</div>
            <div style={{ fontSize: 36, fontWeight: 900, color: scoreColor(stats.moneyScore), lineHeight: 1 }}>
              {stats.moneyScore}
            </div>
            <div style={{ fontSize: 9, color: scoreColor(stats.moneyScore), marginTop: 4 }}>/ 100 · {scoreLabel(stats.moneyScore)}</div>
          </div>
        </div>

        {/* ── Filtros ── */}
        <FilterBar />

        {/* ── Fila 1: KPIs ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 16 }}>
          {[
            { label: 'CAPITAL DEPOSITADO', value: hide(money(stats.totalDeposited)), color: C.accent,  sub: 'de tu bolsillo' },
            { label: 'RETIRADO',           value: hide(money(stats.totalWithdrawn)), color: C.muted,   sub: 'dinero sacado' },
            { label: 'CAPITAL NETO',       value: hide(money(stats.capitalNeto)),    color: C.text,    sub: 'depositado - retirado' },
            { label: 'INVERTIDO EN TRADES',value: hide(money(stats.totalInvested)),  color: C.purple,  sub: 'en acciones abiertas' },
            { label: 'PnL REALIZADO',      value: hide(money(stats.totalPnlReal)),   color: stats.totalPnlReal >= 0 ? C.gain : C.loss, sub: 'de trades cerrados' },
            { label: 'DIVIDENDOS COBRADOS',value: hide(money(stats.totalDividends)), color: C.gold,    sub: 'ingreso pasivo' },
          ].map(k => (
            <div key={k.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px' }}>
              <div style={{ fontSize: 8, color: C.muted, fontWeight: 700, letterSpacing: 0.8, marginBottom: 6 }}>{k.label}</div>
              <div style={{ fontSize: 17, fontWeight: 900, color: k.color, marginBottom: 3 }}>{k.value}</div>
              <div style={{ fontSize: 9, color: '#555' }}>{k.sub}</div>
            </div>
          ))}
        </div>

        {/* ── Patrimonio + Rendimiento banner ── */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 20px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8, marginBottom: 4 }}>PATRIMONIO TOTAL ESTIMADO</div>
            <div style={{ fontSize: 26, fontWeight: 900, color: stats.patrimonio >= 0 ? C.gain : C.loss }}>
              {hide(money(stats.patrimonio))}
            </div>
            <div style={{ fontSize: 9, color: '#555', marginTop: 3 }}>Capital neto + PnL realizado + Dividendos</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8, marginBottom: 4 }}>RENDIMIENTO SOBRE CAPITAL</div>
            <div style={{ fontSize: 26, fontWeight: 900, color: stats.rendimiento >= 0 ? C.gain : C.loss }}>
              {fmtPct(stats.rendimiento)}
            </div>
            <div style={{ fontSize: 9, color: '#555', marginTop: 3 }}>(PnL + Dividendos) / Capital neto</div>
          </div>
        </div>

        {/* ── Fila 2: Flujo mensual + Crecimiento patrimonio ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>

          {/* Flujo mensual */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8, marginBottom: 14 }}>FLUJO MENSUAL DE DINERO</div>
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={stats.monthlyData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#111" vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 8 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: C.muted, fontSize: 8 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `$${v}`} width={36} />
                <Tooltip
                  contentStyle={{ background: C.dim, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11 }}
                  labelStyle={{ color: C.accent, fontWeight: 700 }}
                  formatter={(v: number | undefined, name: string | undefined) => [hideValues ? '••••' : money(v || 0), name || '']}
                />
                <Bar dataKey="depositos"  name="Depósitos"  fill={C.gain}   fillOpacity={0.8} radius={[3,3,0,0]} />
                <Bar dataKey="retiros"    name="Retiros"    fill={C.loss}   fillOpacity={0.7} radius={[3,3,0,0]} />
                <Bar dataKey="dividendos" name="Dividendos" fill={C.gold}   fillOpacity={0.8} radius={[3,3,0,0]} />
                <Line type="monotone" dataKey="neto" name="Neto" stroke={C.accent} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
            <div style={{ display: 'flex', gap: 16, marginTop: 8, justifyContent: 'center' }}>
              {[{c: C.gain, l: 'Depósitos'}, {c: C.loss, l: 'Retiros'}, {c: C.gold, l: 'Dividendos'}, {c: C.accent, l: 'Neto'}].map(x => (
                <span key={x.l} style={{ fontSize: 9, color: x.c, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: x.c, display: 'inline-block' }} />
                  {x.l}
                </span>
              ))}
            </div>
          </div>

          {/* Crecimiento patrimonio */}
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
                <YAxis tick={{ fill: C.muted, fontSize: 8 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `$${v}`} width={36} />
                <Tooltip
                  contentStyle={{ background: C.dim, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11 }}
                  labelStyle={{ color: C.accent, fontWeight: 700 }}
                  formatter={(v: number | undefined, name: string | undefined) => [hideValues ? '••••' : money(v || 0), name || '']}
                />
                <Area type="monotone" dataKey="capital"    name="Capital depositado" stroke={C.accent} strokeWidth={2} fill="url(#capGrad)" dot={false} />
                <Area type="monotone" dataKey="patrimonio" name="Patrimonio estimado" stroke={C.gain}   strokeWidth={2} fill="url(#patGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
            <div style={{ display: 'flex', gap: 16, marginTop: 8, justifyContent: 'center' }}>
              {[{c: C.accent, l: 'Capital depositado'}, {c: C.gain, l: 'Patrimonio estimado'}].map(x => (
                <span key={x.l} style={{ fontSize: 9, color: x.c, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: x.c, display: 'inline-block' }} />
                  {x.l}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ── Fila 3: Por billetera + Distribución + Historial anual ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.8fr 0.8fr', gap: 14, marginBottom: 16 }}>

          {/* Por billetera */}
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
                  <tr key={w.name} style={{ borderBottom: `1px solid #0a0a0a` }}>
                    <td style={{ padding: '8px 8px', color: C.text, fontWeight: 600, fontSize: 11 }}>{w.name}</td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', color: C.accent }}>{hide(money(w.depositado))}</td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', color: C.muted }}>{hide(w.retirado > 0 ? money(w.retirado) : '—')}</td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', color: C.purple }}>{hide(money(w.invertido))}</td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', color: C.gold }}>{hide(w.dividendos > 0 ? money(w.dividendos) : '—')}</td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', color: w.pnl >= 0 ? C.gain : C.loss, fontWeight: 700 }}>{hide(money(w.pnl))}</td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', color: w.rendimiento >= 0 ? C.gain : C.loss, fontWeight: 700 }}>{fmtPct(w.rendimiento)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Distribución */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8, marginBottom: 12 }}>DÓNDE ESTÁ TU DINERO</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {stats.distribucion.map(d => (
                <div key={d.label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: C.muted }}>{d.label}</span>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: d.color }}>{d.pct}%</span>
                      <span style={{ fontSize: 9, color: '#555', marginLeft: 6 }}>{hide(money(d.value))}</span>
                    </div>
                  </div>
                  <div style={{ height: 4, background: C.dim, borderRadius: 2 }}>
                    <div style={{ width: `${Math.min(Math.abs(d.pct), 100)}%`, height: '100%', background: d.color, borderRadius: 2, opacity: 0.8 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Historial anual */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8, marginBottom: 12 }}>FLUJO ANUAL</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {stats.historialAnual.map(y => {
                const isSelected = y.year === filterYear
                const maxNeto = Math.max(...stats.historialAnual.map(x => Math.abs(x.neto)), 1)
                const width   = Math.abs(y.neto) / maxNeto * 100
                return (
                  <div key={y.year}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                      <span style={{ fontSize: 11, fontWeight: isSelected ? 900 : 600, color: isSelected ? C.gain : C.muted }}>
                        {y.year}{isSelected && <span style={{ fontSize: 8, color: C.gain, marginLeft: 4 }}>●</span>}
                      </span>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: y.neto >= 0 ? C.gain : C.loss }}>{hide(money(y.neto))}</div>
                        {y.dividendos > 0 && <div style={{ fontSize: 8, color: C.gold }}>+{hide(money(y.dividendos))} div.</div>}
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
              { label: 'Rendimiento',   pct: 30, score: Math.round(stats.scoreRendimiento), desc: `${fmtPct(stats.rendimiento)} sobre capital` },
              { label: 'Diversificación',pct: 20, score: Math.round(stats.scoreDiversif),   desc: `${portfolios.length} billeteras` },
              { label: 'Consistencia',  pct: 20, score: Math.round(stats.scoreConsistencia), desc: 'depósitos regulares' },
              { label: 'Ahorro',        pct: 15, score: Math.round(stats.scoreAhorro),       desc: 'capital retenido' },
              { label: 'Patrimonio',    pct: 15, score: Math.round(stats.scorePatrimonio),   desc: 'PnL + dividendos' },
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