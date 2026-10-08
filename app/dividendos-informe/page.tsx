'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { usePrivacy } from '@/lib/PrivacyContext'
import { useIsMobile } from '@/lib/useIsMobile'
import AppShell from '../AppShell'
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

const dayKey = (d: any) => String(d || '').split('T')[0].split(' ')[0]
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const r2 = (n: number) => parseFloat(n.toFixed(2))
const localDayKey = (d: Date) => d.toLocaleDateString('sv-SE') // yyyy-MM-dd en hora local

const C = {
  bg:       '#070709',
  card:     '#0a0a0c',
  border:   '#141418',
  gold:     '#eab308',
  goldDim:  '#78611a',
  gain:     '#22c55e',
  loss:     '#f43f5e',
  accent:   '#a78bfa',
  text:     '#e2e8f0',
  muted:    '#64748b',
  dim:      '#1e1e24',
}

const MESES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
const MESES_FULL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

// Máximo 1000 filas por consulta en Supabase: se pide por páginas
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

// Costo vigente de una posición abierta: total_invested (el mismo que usa la página de inicio);
// la suma de compras queda de respaldo
function openInvested(t: any): number {
  const ti = Number(t.total_invested)
  if (Number.isFinite(ti) && ti > 0) return ti
  const initialInv = Number(t.initial_entry_price || t.entry_price || 0) * Number(t.initial_quantity || t.quantity || 0)
  const buyExtra = (t.trade_executions || [])
    .filter((e: any) => e.execution_type === 'buy')
    .reduce((a: number, e: any) => a + Number(e.quantity) * Number(e.price) + Number(e.commission || 0), 0)
  return r2(initialInv + buyExtra)
}

const monthKey = (year: number, monthIdx: number) => `${year}-${String(monthIdx + 1).padStart(2, '0')}`

export default function DividendosInforme() {
  const { money, visible } = usePrivacy()
  const isMobile = useIsMobile()

  const [dividends,    setDividends]    = useState<any[]>([])
  const [trades,       setTrades]       = useState<any[]>([])
  const [portfolios,   setPortfolios]   = useState<any[]>([])
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

      const [divs, pData, tData] = await Promise.all([
        fetchAll(() => supabase.from('wallet_movements')
          .select('id, ticker, amount, date, wallet_id')
          .or('is_dividend.eq.true,movement_type.eq.dividend')
          .eq('user_id', user.id)
          .order('date', { ascending: true })
          .order('id')),
        fetchAll(() => supabase.from('portfolios').select('id, name').eq('user_id', user.id).order('id')),
        // Solo posiciones ABIERTAS: es el costo sobre el que se mide el rendimiento por dividendos.
        // Antes se traían también los trades cerrados y su costo histórico entraba en todos los porcentajes.
        fetchAll(() => supabase.from('trades')
          .select('ticker, total_invested, quantity, entry_price, initial_quantity, initial_entry_price, portfolio_id, trade_executions(quantity, price, commission, execution_type)')
          .eq('user_id', user.id)
          .eq('status', 'open')
          .order('id')),
      ])
      if (!alive.current) return
      setDividends(divs); setPortfolios(pData); setTrades(tData)
      setLoadError('')
    } catch (e: any) {
      if (alive.current) setLoadError(e?.message || 'No se pudieron cargar los datos')
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Dividendos con fechas ya convertidas (una vez)
  const divRows = useMemo(() => dividends
    .map(d => {
      const key = dayKey(d.date)
      return {
        key, year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) - 1,
        ticker: String(d.ticker || ''), amount: Number(d.amount) || 0, wallet: d.wallet_id,
      }
    })
    .filter(d => DAY_RE.test(d.key))
  , [dividends])

  // Solo por billetera (para histórico anual, meta, año anterior) y además por año (para el período elegido)
  const walletDivs = useMemo(
    () => divRows.filter(d => filterWallet === 'all' || d.wallet === filterWallet),
    [divRows, filterWallet]
  )
  const filteredDividends = useMemo(
    () => walletDivs.filter(d => filterYear === 'all' || String(d.year) === filterYear),
    [walletDivs, filterYear]
  )

  const availableYears = useMemo(() => {
    const years = new Set<string>([new Date().getFullYear().toString()])
    divRows.forEach(d => years.add(String(d.year)))
    return Array.from(years).sort((a, b) => b.localeCompare(a))
  }, [divRows])

  const stats = useMemo(() => {
    if (!filteredDividends.length) return null
    const now         = new Date()
    const currentYear = now.getFullYear()
    const curMonth    = now.getMonth()
    const year        = filterYear === 'all' ? currentYear : parseInt(filterYear)
    const isCurrent   = year === currentYear
    // Antes se usaba SIEMPRE el mes en curso: al elegir un año pasado se dividía entre 10 meses (no 12) y el
    // "dividendo del mes" mostraba el mes actual de aquel año.
    const monthsElapsed = isCurrent ? curMonth + 1 : 12
    const refMonth      = isCurrent ? curMonth : 11

    // ── Cobrado en el año y en el mes de referencia ──────────────────────
    const ytd = walletDivs.filter(d => d.year === year)
    const ytdTotal = ytd.reduce((a, d) => a + d.amount, 0)
    const monthTotal = ytd.filter(d => d.month === refMonth).reduce((a, d) => a + d.amount, 0)

    // ── Capital invertido hoy (posiciones abiertas de la billetera elegida) ──
    const openTrades = trades.filter(t => filterWallet === 'all' || t.portfolio_id === filterWallet)
    const costByTicker: Record<string, number> = {}
    openTrades.forEach(t => { costByTicker[t.ticker] = (costByTicker[t.ticker] || 0) + openInvested(t) })
    const totalInvested = Object.values(costByTicker).reduce((a, b) => a + b, 0)
    const retorno = totalInvested > 0 ? (ytdTotal / totalInvested) * 100 : 0

    // ── YOC: dividendos de 12 meses (o del año elegido, si es pasado) entre el costo de los tickers que pagan ──
    // Antes era el promedio simple de (cobrado en lo que va del año / costo) por ticker: un año a medias
    // subestimaba el rendimiento y todos los tickers pesaban igual. También incluía el costo de trades ya cerrados.
    const todayKey = localDayKey(now)
    const fromKey  = localDayKey(new Date(currentYear, curMonth - 11, now.getDate()))
    const yocDivs = isCurrent
      ? walletDivs.filter(d => d.key > fromKey && d.key <= todayKey)
      : ytd
    const yocByTicker: Record<string, number> = {}
    yocDivs.forEach(d => { if (costByTicker[d.ticker] > 0) yocByTicker[d.ticker] = (yocByTicker[d.ticker] || 0) + d.amount })
    const yocNum = Object.values(yocByTicker).reduce((a, b) => a + b, 0)
    const yocDen = Object.keys(yocByTicker).reduce((a, t) => a + costByTicker[t], 0)
    const yoc = yocDen > 0 ? (yocNum / yocDen) * 100 : 0

    // ── Proyección anual ─────────────────────────────────────────────────
    const promMensual = ytdTotal / monthsElapsed
    const proyeccion = promMensual * 12

    // ── Meta = promedio de los años anteriores completos ─────────────────
    // Antes se promediaban los años del filtro actual: con un año elegido era solo ese año,
    // la meta salía igual a lo cobrado y el progreso siempre marcaba 100%.
    const byYear: Record<number, number> = {}
    walletDivs.forEach(d => { byYear[d.year] = (byYear[d.year] || 0) + d.amount })
    const prevYearsTotals = Object.entries(byYear).filter(([y]) => Number(y) < year).map(([, v]) => v)
    const meta = prevYearsTotals.length ? prevYearsTotals.reduce((a, b) => a + b, 0) / prevYearsTotals.length : proyeccion
    const metaPct = meta > 0 ? Math.min((ytdTotal / meta) * 100, 100) : 0

    // ── Serie mensual (con acumulado) ────────────────────────────────────
    const totals: Record<string, number> = {}
    filteredDividends.forEach(d => { const k = monthKey(d.year, d.month); totals[k] = (totals[k] || 0) + d.amount })

    const keys: string[] = []
    if (filterYear !== 'all') {
      for (let i = 0; i < 12; i++) keys.push(monthKey(year, i))
    } else {
      // Todos los años: continuo desde el primer dividendo hasta hoy (antes solo salían los meses con dividendo)
      const first = filteredDividends.reduce((a, d) => (d.key < a ? d.key : a), filteredDividends[0].key)
      let y = Number(first.slice(0, 4)), m = Number(first.slice(5, 7)) - 1
      while (y < currentYear || (y === currentYear && m <= curMonth)) {
        keys.push(monthKey(y, m))
        if (++m > 11) { m = 0; y++ }
      }
    }
    let cum = 0
    const monthlyData = keys.map(k => {
      const total = r2(totals[k] || 0)
      cum = r2(cum + total)
      const [y, m] = k.split('-')
      return { key: k, label: `${MESES[Number(m) - 1]} ${y}`, total, cumTotal: cum }
    })
    const mejorMes = monthlyData.reduce((a, b) => (b.total > a.total ? b : a), { key: '', label: '—', total: 0, cumTotal: 0 })

    // ── Top pagadores ────────────────────────────────────────────────────
    const byTicker: Record<string, number> = {}
    filteredDividends.forEach(d => { if (d.ticker) byTicker[d.ticker] = (byTicker[d.ticker] || 0) + d.amount })
    const totalDivAll = Object.values(byTicker).reduce((a, b) => a + b, 0)
    const topPagadores = Object.entries(byTicker)
      .map(([ticker, total]) => ({ ticker, total: r2(total), pct: totalDivAll > 0 ? (total / totalDivAll) * 100 : 0 }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)

    // ── Empresas que pagan (el total incluye las que pagan y las abiertas, así nunca sale "5 de 3") ──
    const payers = new Set(Object.keys(byTicker))
    const allTickers = new Set<string>([...Object.keys(costByTicker), ...payers])
    const tickersPagan = payers.size
    const tickersTotal = allTickers.size

    const aniosRecuperacion = proyeccion > 0 ? totalInvested / proyeccion : null

    // ── Año anterior, al mismo punto del año ─────────────────────────────
    // Antes, con el año en curso elegido se comparaba contra el año anterior COMPLETO (mes 11)
    const prevYtd = walletDivs
      .filter(d => d.year === year - 1 && d.month <= refMonth)
      .reduce((a, d) => a + d.amount, 0)
    const crecimiento = prevYtd > 0 ? ((ytdTotal - prevYtd) / prevYtd) * 100 : null
    const semaforo = crecimiento === null ? 'nuevo' : crecimiento > 5 ? 'verde' : crecimiento >= -5 ? 'amarillo' : 'rojo'

    // ── Dividend Score (los componentes se calculan una vez y se reutilizan en el desglose) ──
    const monthsWithDiv = new Set(ytd.map(d => d.month)).size
    const scoreCrec = crecimiento === null ? 50 : Math.min(Math.max(50 + crecimiento * 2, 0), 100)
    const scoreYoc  = Math.min((yoc / 8) * 100, 100)
    const scoreDiv  = Math.min((tickersPagan / 15) * 100, 100)
    const scoreMeta = Math.min(metaPct, 100)
    const scoreConsistencia = Math.min((monthsWithDiv / monthsElapsed) * 100, 100)
    const dividendScore = Math.round(
      scoreCrec * 0.25 + scoreYoc * 0.25 + scoreDiv * 0.20 + scoreMeta * 0.20 + scoreConsistencia * 0.10
    )
    const scoreParts = [
      { label: 'Crecimiento',     pct: 25, score: Math.round(scoreCrec) },
      { label: 'YOC',             pct: 25, score: Math.round(scoreYoc) },
      { label: 'Diversificación', pct: 20, score: Math.round(scoreDiv) },
      { label: 'Meta',            pct: 20, score: Math.round(scoreMeta) },
      { label: 'Consistencia',    pct: 10, score: Math.round(scoreConsistencia) },
    ]

    // ── Ingreso pasivo anual (toda la historia de la billetera elegida) ──
    // (antes ignoraba el filtro de billetera)
    const crecimientoAnual = Object.entries(byYear)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([y, total]) => ({ year: y, total: r2(total) }))

    return {
      ytdTotal: r2(ytdTotal), monthTotal: r2(monthTotal), retorno: r2(retorno), yoc: r2(yoc),
      proyeccion: r2(proyeccion), meta: r2(meta), metaPct: parseFloat(metaPct.toFixed(1)),
      promMensual: r2(promMensual), monthsElapsed, refMonth,
      monthlyData, mejorMes, topPagadores, tickersPagan, tickersTotal,
      totalInvested: r2(totalInvested), aniosRecuperacion,
      crecimiento, semaforo, dividendScore, scoreParts,
      prevYtd: r2(prevYtd), year, crecimientoAnual,
    }
  }, [filteredDividends, walletDivs, trades, filterWallet, filterYear])

  const scoreColor = (s: number) => s >= 75 ? C.gain : s >= 50 ? C.gold : C.loss
  const scoreLabel = (s: number) => s >= 75 ? 'Excelente' : s >= 50 ? 'Regular' : 'Necesita atención'

  const semColorMap: Record<string, string> = { verde: C.gain, amarillo: C.gold, rojo: C.loss, nuevo: C.accent }
  const semLabelMap: Record<string, string> = { verde: '🟢 Creciendo', amarillo: '🟡 Estable', rojo: '🔴 Disminuyendo', nuevo: '🔵 Sin histórico' }

  // Eje en modo privado: oculto (antes mostraba los importes aunque activaras la privacidad)
  const axisMoney = (v: number) => !visible ? '' : Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v}`

  // Espaciados y rejillas que cambian en el celular (en escritorio quedan como antes)
  const pagePad = isMobile ? '12px 6px' : '20px 24px'
  const cardPad = isMobile ? '12px 12px' : '16px 18px'
  const grid = (mobileCols: number, desktop: string, gap = 14): React.CSSProperties => ({
    display: 'grid',
    gridTemplateColumns: isMobile ? `repeat(${mobileCols}, minmax(0, 1fr))` : desktop,
    gap: isMobile ? 10 : gap,
    marginBottom: 16,
  })

  const chipStyle = (active: boolean): React.CSSProperties => ({
    padding: isMobile ? '8px 14px' : '6px 14px', borderRadius: 8, fontSize: isMobile ? 12 : 11, fontWeight: 700, cursor: 'pointer',
    background: active ? C.gold : C.dim,
    color: active ? '#000' : C.muted,
    border: `1px solid ${active ? C.gold : C.border}`,
    whiteSpace: 'nowrap', flexShrink: 0,
  })

  // Una sola barra de filtros (estaba copiada dos veces: la del estado vacío y la del informe)
  const filterBar = (
    <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: isMobile ? 'nowrap' : 'wrap', overflowX: isMobile ? 'auto' : 'visible', alignItems: 'center' }}>
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <select value={filterYear} onChange={e => setFilterYear(e.target.value)} style={{
          background: C.dim, border: `1px solid ${C.border}`, color: C.text,
          padding: isMobile ? '8px 32px 8px 14px' : '6px 32px 6px 14px', borderRadius: 8, fontSize: isMobile ? 12 : 11, fontWeight: 700,
          cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none', outline: 'none',
        }}>
          <option value="all">Todos los años</option>
          {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: C.muted, fontSize: 10 }}>▼</span>
      </div>
      <div style={{ width: 1, background: C.border, height: 28, flexShrink: 0 }} />
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
        Cargando informe de dividendos...
      </div>
    </AppShell>
  )

  if (!stats) return (
    <AppShell>
      <div style={{ padding: pagePad, background: C.bg, minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>💰 Informe ejecutivo</div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: C.gold }}>Dividendos</h1>
        </div>
        {errorBanner}
        {filterBar}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40vh', color: C.muted, fontSize: 13, textAlign: 'center' }}>
          Sin dividendos registrados para el período seleccionado.
        </div>
      </div>
    </AppShell>
  )

  const maxAnnual = Math.max(...stats.crecimientoAnual.map(x => x.total), 1)
  const card: React.CSSProperties = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: cardPad, minWidth: 0 }
  const cardTitle: React.CSSProperties = { fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8, marginBottom: 14 }
  const lineRow: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, borderBottom: `1px solid ${C.border}`, paddingBottom: 8 }

  return (
    <AppShell>
      <div style={{ padding: pagePad, background: C.bg, minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>

        {/* ── Header ── */}
        <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>
              💰 Informe ejecutivo
            </div>
            <h1 style={{ margin: 0, fontSize: isMobile ? 19 : 22, fontWeight: 900, color: C.gold, letterSpacing: -0.5 }}>
              Dividendos
            </h1>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>
              {filterYear === 'all' ? `Histórico (indicadores de ${stats.year})` : stats.year} · {stats.monthsElapsed} meses
            </div>
          </div>
          {/* Dividend Score */}
          <div style={{ textAlign: 'center', background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: isMobile ? '10px 14px' : '14px 24px', flexShrink: 0 }}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>{isMobile ? 'SCORE' : 'DIVIDEND SCORE'}</div>
            <div style={{ fontSize: isMobile ? 30 : 36, fontWeight: 900, color: scoreColor(stats.dividendScore), lineHeight: 1 }}>
              {stats.dividendScore}
            </div>
            <div style={{ fontSize: 9, color: scoreColor(stats.dividendScore), marginTop: 4 }}>/ 100 · {isMobile && stats.dividendScore < 50 ? 'Atención' : scoreLabel(stats.dividendScore)}</div>
          </div>
        </div>

        {errorBanner}
        {filterBar}

        {/* ── Fila 1: KPIs ── */}
        <div style={grid(2, 'repeat(6, 1fr)', 10)}>
          {[
            { label: 'COBRADOS YTD',   value: money(stats.ytdTotal),   color: C.gold,   sub: `vs ${money(stats.prevYtd)} año anterior` },
            { label: 'DIVIDENDO MES',  value: money(stats.monthTotal), color: C.text,   sub: MESES_FULL[stats.refMonth] },
            { label: 'YIELD ON COST',  value: `${stats.yoc}%`,         color: C.accent, sub: 'últimos 12 meses / costo' },
            { label: 'RETORNO REAL',   value: `${stats.retorno}%`,     color: stats.retorno >= 3 ? C.gain : C.gold, sub: visible ? `÷ $${(stats.totalInvested / 1000).toFixed(1)}k invertido` : '÷ $*** invertido' },
            { label: 'PROYECCIÓN AÑO', value: money(stats.proyeccion), color: C.gain,   sub: `${money(stats.promMensual)}/mes promedio` },
            { label: 'META ANUAL',     value: money(stats.meta),       color: C.muted,  sub: 'media de años anteriores' },
          ].map(k => (
            <div key={k.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px', minWidth: 0 }}>
              <div style={{ fontSize: 8, color: C.muted, fontWeight: 700, letterSpacing: 0.8, marginBottom: 6 }}>{k.label}</div>
              <div style={{ fontSize: isMobile ? 16 : 18, fontWeight: 900, color: k.color, marginBottom: 3 }}>{k.value}</div>
              <div style={{ fontSize: 9, color: '#3a3a4a' }}>{k.sub}</div>
            </div>
          ))}
        </div>

        {/* ── Progreso meta ── */}
        <div style={{ ...card, padding: isMobile ? '12px 12px' : '14px 18px', marginBottom: 16 }}>
          <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', gap: isMobile ? 4 : 0, marginBottom: 10 }}>
            <div>
              <span style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8 }}>PROGRESO HACIA META ANUAL</span>
              <span style={{ fontSize: 11, color: C.gold, fontWeight: 700, marginLeft: 12 }}>{stats.metaPct}%</span>
            </div>
            <div style={{ fontSize: 11, color: C.muted }}>
              {stats.proyeccion >= stats.meta
                ? <span style={{ color: C.gain }}>Excederás la meta en {money(stats.proyeccion - stats.meta)}</span>
                : <span style={{ color: C.gold }}>Faltan {money(stats.meta - stats.ytdTotal)} para la meta</span>
              }
            </div>
          </div>
          <div style={{ height: 8, background: C.dim, borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              width: `${stats.metaPct}%`, height: '100%',
              background: `linear-gradient(90deg, ${C.goldDim}, ${C.gold})`,
              borderRadius: 4, transition: 'width 0.8s ease',
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, gap: 6 }}>
            <span style={{ fontSize: 9, color: '#666' }}>$0</span>
            <span style={{ fontSize: 9, color: C.muted }}>{money(stats.ytdTotal)} cobrados</span>
            <span style={{ fontSize: 9, color: '#666' }}>{money(stats.meta)}</span>
          </div>
        </div>

        {/* ── Fila 2: Evolución mensual + Top pagadores + Ingreso anual ── */}
        <div style={grid(1, '2fr 0.5fr 0.5fr')}>

          {/* Evolución mensual */}
          <div style={card}>
            <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', gap: isMobile ? 6 : 0, marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8 }}>EVOLUCIÓN MENSUAL</div>
                <div style={{ fontSize: 9, color: '#666', marginTop: 2 }}>{filterYear === 'all' ? 'Histórico completo' : `Año ${stats.year}`}</div>
              </div>
              <div style={{ fontSize: 11, color: C.muted }}>
                Mejor: <span style={{ color: C.gold, fontWeight: 700 }}>{stats.mejorMes.label} {money(stats.mejorMes.total)}</span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={isMobile ? 170 : 160}>
              <ComposedChart data={stats.monthlyData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.9} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0.4} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#1a1a1a" vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 9 }} axisLine={false} tickLine={false} interval={isMobile ? 'preserveStartEnd' : 0} />
                <YAxis tick={{ fill: C.muted, fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={axisMoney} width={isMobile ? 34 : 40} />
                <Tooltip
                  contentStyle={{ background: '#0f0f12', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11 }}
                  labelStyle={{ color: C.gold, fontWeight: 700 }}
                  formatter={(v: any, name: any) => [money(Number(v) || 0), name === 'cumTotal' ? 'Acumulado' : 'Mes']}
                />
                <Bar dataKey="total" name="Mes" fill="url(#barGrad)" radius={[4, 4, 0, 0]} />
                <Line type="monotone" dataKey="cumTotal" name="cumTotal" stroke="#00bfff" strokeWidth={2} dot={{ fill: '#00bfff', r: 3, strokeWidth: 0 }} activeDot={{ r: 5 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Top pagadores */}
          <div style={card}>
            <div style={cardTitle}>TOP PAGADORES · {filterYear === 'all' ? 'HISTÓRICO' : stats.year}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {stats.topPagadores.map((t, i) => (
                <div key={t.ticker}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 9, color: '#666', fontWeight: 700, minWidth: 14 }}>{i + 1}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{t.ticker}</span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: C.gold }}>{money(t.total)}</span>
                      <span style={{ fontSize: 9, color: C.muted, marginLeft: 6 }}>{t.pct.toFixed(1)}%</span>
                    </div>
                  </div>
                  <div style={{ height: 3, background: C.dim, borderRadius: 2 }}>
                    <div style={{ width: `${t.pct}%`, height: '100%', background: C.gold, borderRadius: 2, opacity: 0.6 + (i === 0 ? 0.4 : 0) }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Ingreso pasivo anual */}
          <div style={card}>
            <div style={cardTitle}>INGRESO PASIVO ANUAL</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[...stats.crecimientoAnual].reverse().map(y => {
                const isCurrentYear = y.year === String(stats.year)
                return (
                  <div key={y.year}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: isCurrentYear ? 900 : 600, color: isCurrentYear ? C.gold : C.muted }}>
                        {y.year} {isCurrentYear && <span style={{ fontSize: 8, color: C.goldDim }}>● actual</span>}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: isCurrentYear ? C.gold : C.text }}>
                        {money(y.total)}
                      </span>
                    </div>
                    <div style={{ height: 3, background: C.dim, borderRadius: 2 }}>
                      <div style={{ width: `${(y.total / maxAnnual) * 100}%`, height: '100%', borderRadius: 2,
                        background: isCurrentYear ? C.gold : 'rgba(234,179,8,0.25)' }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

        </div>

        {/* ── Fila 3: Indicadores + Proyección + Recuperación ── */}
        <div style={grid(1, '1fr 1fr 1fr')}>

          {/* Indicadores */}
          <div style={card}>
            <div style={cardTitle}>INDICADORES</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { label: 'Dividendos cobrados YTD', value: money(stats.ytdTotal),   color: C.gold },
                { label: 'Yield on Cost (12 meses)', value: `${stats.yoc}%`,        color: C.accent },
                { label: 'Retorno por dividendos',  value: `${stats.retorno}%`,     color: stats.retorno >= 3 ? C.gain : C.gold },
                { label: 'Empresas que pagan',      value: `${stats.tickersPagan} de ${stats.tickersTotal}`, color: C.text },
                { label: 'Promedio mensual YTD',    value: money(stats.promMensual), color: C.muted },
              ].map(k => (
                <div key={k.label} style={lineRow}>
                  <span style={{ fontSize: 11, color: C.muted }}>{k.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: k.color }}>{k.value}</span>
                </div>
              ))}
              {/* Semáforo */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: C.muted }}>Tendencia vs año anterior</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: semColorMap[stats.semaforo], textAlign: 'right' }}>
                  {semLabelMap[stats.semaforo]}
                  {stats.crecimiento !== null && (
                    <span style={{ fontSize: 9, marginLeft: 4, opacity: 0.7 }}>
                      ({stats.crecimiento >= 0 ? '+' : ''}{stats.crecimiento.toFixed(1)}%)
                    </span>
                  )}
                </span>
              </div>
            </div>
          </div>

          {/* Proyección */}
          <div style={card}>
            <div style={cardTitle}>PROYECCIÓN DEL AÑO</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { label: 'Dividendos cobrados', value: money(stats.ytdTotal), bold: false, color: undefined as string | undefined },
                { label: 'Meses transcurridos', value: `${stats.monthsElapsed} de 12`, bold: false, color: undefined },
                { label: 'Promedio mensual',    value: money(stats.promMensual), bold: false, color: undefined },
                { label: 'Proyección anual',    value: money(stats.proyeccion), bold: true, color: C.gain },
              ].map(k => (
                <div key={k.label} style={lineRow}>
                  <span style={{ fontSize: 11, color: C.muted }}>{k.label}</span>
                  <span style={{ fontSize: k.bold ? 15 : 13, fontWeight: 700, color: k.color || C.text }}>{k.value}</span>
                </div>
              ))}
              <div style={{ marginTop: 6, padding: '10px 12px', background: C.dim, borderRadius: 8, border: `1px solid ${C.border}` }}>
                {stats.proyeccion >= stats.meta
                  ? <div style={{ fontSize: 11, color: C.gain, fontWeight: 700 }}>
                      ✅ Excederás la meta en <span style={{ color: C.gain }}>{money(stats.proyeccion - stats.meta)}</span>
                    </div>
                  : <div style={{ fontSize: 11, color: C.gold, fontWeight: 700 }}>
                      📌 Faltan <span style={{ color: C.gold }}>{money(stats.meta - stats.ytdTotal)}</span> para la meta
                    </div>
                }
                <div style={{ fontSize: 9, color: C.muted, marginTop: 4 }}>
                  Meta = media de los años anteriores: {money(stats.meta)}/año
                </div>
              </div>
            </div>
          </div>

          {/* Tiempo para recuperar inversión */}
          <div style={card}>
            <div style={cardTitle}>RECUPERACIÓN POR DIVIDENDOS</div>
            <div style={{ textAlign: 'center', padding: '10px 0 14px' }}>
              <div style={{ fontSize: 9, color: C.muted, marginBottom: 6 }}>Capital invertido hoy</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: C.text, marginBottom: 12 }}>{money(stats.totalInvested)}</div>
              <div style={{ fontSize: 9, color: C.muted, marginBottom: 6 }}>Dividendos proyectados / año</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: C.gold, marginBottom: 16 }}>{money(stats.proyeccion)}</div>
              <div style={{ width: '100%', height: 1, background: C.border, marginBottom: 16 }} />
              <div style={{ fontSize: 9, color: C.muted, marginBottom: 6 }}>Tiempo estimado de recuperación</div>
              <div style={{ fontSize: 32, fontWeight: 900, color: C.accent, lineHeight: 1 }}>
                {stats.aniosRecuperacion ? stats.aniosRecuperacion.toFixed(1) : '—'}
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>años</div>
              <div style={{ fontSize: 9, color: '#666', marginTop: 8 }}>
                Solo contando dividendos, sin venta de acciones
              </div>
            </div>
          </div>
        </div>

        {/* ── Dividend Score detalle ── */}
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8 }}>DIVIDEND SCORE — DESGLOSE</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 28, fontWeight: 900, color: scoreColor(stats.dividendScore) }}>{stats.dividendScore}</div>
              <div style={{ fontSize: 9, color: scoreColor(stats.dividendScore) }}>/ 100</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(5, 1fr)', gap: 10 }}>
            {stats.scoreParts.map(k => (
              <div key={k.label} style={{ background: C.dim, borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: C.muted, marginBottom: 6 }}>{k.label}</div>
                <div style={{ fontSize: 18, fontWeight: 900, color: scoreColor(k.score) }}>{k.score}</div>
                <div style={{ fontSize: 8, color: '#666', marginTop: 2 }}>peso {k.pct}%</div>
                <div style={{ height: 3, background: C.border, borderRadius: 2, marginTop: 6 }}>
                  <div style={{ width: `${k.score}%`, height: '100%', background: scoreColor(k.score), borderRadius: 2 }} />
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </AppShell>
  )
}