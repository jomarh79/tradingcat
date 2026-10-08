'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { usePrivacy } from '@/lib/PrivacyContext'
import { useIsMobile } from '@/lib/useIsMobile'
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts'
import AppShell from '../AppShell'

const dayKey = (d: any) => String(d || '').split('T')[0].split(' ')[0]
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const r2 = (n: number) => parseFloat(n.toFixed(2))
const fmtPct = (v: number, decimals = 2) => `${v >= 0 ? '+' : ''}${v.toFixed(decimals)}%`
const localDayKey = (d: Date) => d.toLocaleDateString('sv-SE') // yyyy-MM-dd en hora local

const C = {
  bg:     '#070709',
  card:   '#0a0a0c',
  border: '#141418',
  accent: '#00bfff',
  gain:   '#22c55e',
  loss:   '#f43f5e',
  gold:   '#eab308',
  purple: '#a78bfa',
  text:   '#e2e8f0',
  muted:  '#64748b',
  dim:    '#0f0f12',
}

const MONTH_ORDER   = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
const SECTOR_COLORS = ['#00bfff','#a78bfa','#22c55e','#eab308','#f472b6','#fb923c','#34d399','#f43f5e','#60a5fa','#c084fc']

const SP_CACHE_KEY = 'sp500'

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

// Costo vigente de una posición abierta: total_invested (el mismo que usa la página de inicio). La suma de compras
// queda de respaldo: no descuenta lo ya vendido en parciales, por eso daba un costo promedio inflado.
function openInvested(t: any): number {
  const ti = Number(t.total_invested)
  if (Number.isFinite(ti) && ti > 0) return ti
  const initialInv = Number(t.initial_entry_price || t.entry_price || 0) * Number(t.initial_quantity || t.quantity || 0)
  const buyExtra = (t.trade_executions || [])
    .filter((e: any) => e.execution_type === 'buy')
    .reduce((a: number, e: any) => a + Number(e.quantity) * Number(e.price) + Number(e.commission || 0), 0)
  return r2(initialInv + buyExtra)
}

// La caché del S&P la escribe la página de inicio. Se aceptan los dos formatos:
// el arreglo de antes y { ts, rows } de ahora.
function readSpCache(): { date: string; close: number }[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SP_CACHE_KEY) || 'null')
    const list = Array.isArray(raw) ? raw : raw?.rows
    if (!Array.isArray(list)) return []
    return list
      .map((d: any) => ({ date: dayKey(d.date), close: Number(d.close) }))
      .filter(d => DAY_RE.test(d.date) && d.close > 0)
      .sort((a, b) => a.date.localeCompare(b.date))
  } catch (e) {
    console.error('SP500 cache:', e)
    return []
  }
}

export default function InformeAbiertos() {
  const { money, visible } = usePrivacy()
  const isMobile = useIsMobile()

  const [trades,       setTrades]       = useState<any[]>([])
  const [portfolios,   setPortfolios]   = useState<any[]>([])
  const [spSeries,     setSpSeries]     = useState<{ date: string; close: number }[]>([])
  const [loading,      setLoading]      = useState(true)
  const [loadError,    setLoadError]    = useState('')
  const [filterWallet, setFilterWallet] = useState('all')

  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const [tData, pData] = await Promise.all([
        fetchAll(() => supabase.from('trades')
          .select('*, trade_executions(quantity, price, commission, execution_type)')
          .eq('user_id', user.id)
          .eq('status', 'open')
          .order('id')),
        fetchAll(() => supabase.from('portfolios').select('id, name, grupo').eq('user_id', user.id).order('id')),
      ])
      if (!alive.current) return
      setTrades(tData)
      setPortfolios(pData)
      setLoadError('')
    } catch (e: any) {
      // Antes un error de Supabase dejaba la página vacía como si no hubiera posiciones
      if (alive.current) setLoadError(e?.message || 'No se pudieron cargar los datos')
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => { setSpSeries(readSpCache()) }, [])

  const filtered = useMemo(
    () => trades.filter(t => filterWallet === 'all' || t.portfolio_id === filterWallet),
    [trades, filterWallet]
  )

  const stats = useMemo(() => {
    if (!filtered.length) return null
    const now = new Date()
    const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()

    const tradesWithCalc = filtered.map(t => {
      const inv      = openInvested(t)
      const qty      = Number(t.quantity || 0)
      const cur      = Number(t.last_price || t.entry_price || 0)
      const avg      = inv > 0 && qty > 0 ? inv / qty : Number(t.entry_price || 0)
      const curValue = cur * qty
      const pnl      = r2((cur - avg) * qty)
      const pnlPct   = avg > 0 ? r2(((cur - avg) / avg) * 100) : 0
      const dayChg   = Number(t.day_change || 0)
      // Lo ganado/perdido HOY: el % del día se aplica sobre el valor de AYER (antes se aplicaba sobre el de hoy)
      const dayAmt   = dayChg > -100 ? curValue - curValue / (1 + dayChg / 100) : 0
      const openMs   = Date.parse(dayKey(t.open_date) + 'T00:00:00')
      const days     = Number.isFinite(openMs) ? Math.max(0, Math.floor((todayMs - openMs) / 86400000)) : 0
      const rsi      = Number(t.rsi || 0)
      return { ...t, inv, qty, cur, avg, curValue, pnl, pnlPct, dayAmt, days, rsi, openKey: dayKey(t.open_date) }
    })

    // ── KPIs ─────────────────────────────────────────────────────────────
    const total       = tradesWithCalc.length
    const totalInv    = r2(tradesWithCalc.reduce((a, t) => a + t.inv, 0))
    const totalCurVal = r2(tradesWithCalc.reduce((a, t) => a + t.curValue, 0))
    const totalPnl    = r2(tradesWithCalc.reduce((a, t) => a + t.pnl, 0))
    const totalPnlPct = totalInv > 0 ? r2((totalPnl / totalInv) * 100) : 0
    const inGain      = tradesWithCalc.filter(t => t.pnl > 0).length
    const gainRate    = parseFloat(((inGain / total) * 100).toFixed(1))
    const avgDays     = parseFloat((tradesWithCalc.reduce((a, t) => a + t.days, 0) / total).toFixed(1))
    const withRsi     = tradesWithCalc.filter(t => t.rsi > 0)
    const avgRsi      = withRsi.length ? parseFloat((withRsi.reduce((a, t) => a + t.rsi, 0) / withRsi.length).toFixed(1)) : 0
    const dayPnl      = r2(tradesWithCalc.reduce((a, t) => a + t.dayAmt, 0))

    // ── Mejor y peor posición ─────────────────────────────────────────────
    const byPnl      = [...tradesWithCalc].sort((a, b) => b.pnl - a.pnl)
    const bestTrade  = byPnl[0]
    const worstTrade = byPnl[byPnl.length - 1]
    // Las listas solo llevan lo que corresponde: antes, con pocas posiciones, "pérdidas" mostraba ganadoras
    // (y la misma posición podía salir en las dos listas)
    const top5Best  = byPnl.filter(t => t.pnl > 0).slice(0, 5)
    const top5Worst = byPnl.filter(t => t.pnl < 0).slice(-5).reverse()

    // ── Por sector ────────────────────────────────────────────────────────
    const sectorMap: Record<string, { inv: number; pnl: number; count: number }> = {}
    tradesWithCalc.forEach(t => {
      const s = (sectorMap[t.sector || 'Sin sector'] ??= { inv: 0, pnl: 0, count: 0 })
      s.inv += t.inv; s.pnl += t.pnl; s.count += 1
    })
    const sectorData = Object.entries(sectorMap)
      .map(([sector, d]) => ({
        sector,
        pnl:    r2(d.pnl),
        inv:    r2(d.inv),
        weight: totalInv > 0 ? parseFloat(((d.inv / totalInv) * 100).toFixed(1)) : 0,
        count:  d.count,
      }))
      .sort((a, b) => b.inv - a.inv)

    // ── Tiempo en posición por rango ──────────────────────────────────────
    const durationMap: Record<string, { count: number; pnl: number }> = {
      '0-30d':    { count: 0, pnl: 0 },
      '31-90d':   { count: 0, pnl: 0 },
      '91-180d':  { count: 0, pnl: 0 },
      '181-365d': { count: 0, pnl: 0 },
      '+1 año':   { count: 0, pnl: 0 },
    }
    tradesWithCalc.forEach(t => {
      const key = t.days <= 30 ? '0-30d' : t.days <= 90 ? '31-90d' : t.days <= 180 ? '91-180d' : t.days <= 365 ? '181-365d' : '+1 año'
      durationMap[key].count++
      durationMap[key].pnl += t.pnl
    })
    const durationData = Object.entries(durationMap)
      .map(([range, d]) => ({ range, count: d.count, pnl: r2(d.pnl) }))
      .filter(d => d.count > 0)

    // ── Evolución mensual (PnL latente por mes de apertura) ───────────────
    const monthly: Record<string, number> = {}
    tradesWithCalc.forEach(t => {
      if (!DAY_RE.test(t.openKey)) return
      const key = t.openKey.slice(0, 7) // 'YYYY-MM'
      monthly[key] = (monthly[key] || 0) + t.pnl
    })
    let cumPnl = 0
    const monthlyData = Object.entries(monthly)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, pnl]) => {
        const [y, m] = key.split('-')
        cumPnl = r2(cumPnl + pnl)
        return { label: `${MONTH_ORDER[Number(m) - 1]} ${y}`, pnl: r2(pnl), cumPnl }
      })

    // ── Rendimiento vs SP500 ──────────────────────────────────────────────
    // Portafolio: PnL / invertido de las posiciones abiertas DENTRO del período. S&P: del inicio del período a hoy.
    const periods = [
      { label: '1 mes',   months: 1  },
      { label: '3 meses', months: 3  },
      { label: '6 meses', months: 6  },
      { label: '1 año',   months: 12 },
      { label: '5 años',  months: 60 },
    ]
    const spEnd = spSeries.length ? spSeries[spSeries.length - 1].close : null
    const periodRows = periods.map(p => {
      const cutoffKey = localDayKey(new Date(now.getFullYear(), now.getMonth() - p.months, now.getDate()))
      const pTrades   = tradesWithCalc.filter(t => t.openKey >= cutoffKey)
      const pInv      = pTrades.reduce((a, t) => a + t.inv, 0)
      const pPnl      = pTrades.reduce((a, t) => a + t.pnl, 0)
      const portRend  = pInv > 0 ? r2((pPnl / pInv) * 100) : null

      // Último cierre del S&P en o antes del inicio del período (búsqueda binaria)
      let lo = 0, hi = spSeries.length - 1, idx = -1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (spSeries[mid].date <= cutoffKey) { idx = mid; lo = mid + 1 } else hi = mid - 1
      }
      const spStart  = idx >= 0 ? spSeries[idx].close : null
      const sp500Rend = spStart && spEnd ? r2(((spEnd - spStart) / spStart) * 100) : null
      const diff = portRend !== null && sp500Rend !== null ? r2(portRend - sp500Rend) : null
      return { label: p.label, portRend, sp500Rend, diff }
    })

    // ── Portfolio Score ───────────────────────────────────────────────────
    const scoreGainRate = Math.min(gainRate, 100)
    const scoreDiversif = Math.min((sectorData.length / 8) * 100, 100)
    const scoreRetorno  = Math.min(Math.max((totalPnlPct + 20) * 2.5, 0), 100)
    const scoreRsi      = avgRsi > 0 ? (avgRsi >= 30 && avgRsi <= 60 ? 100 : avgRsi < 30 || avgRsi > 70 ? 40 : 70) : 50
    const scoreTiempo   = avgDays <= 180 ? 100 : avgDays <= 365 ? 70 : 40
    const portfolioScore = Math.round(
      scoreGainRate * 0.30 + scoreDiversif * 0.20 +
      scoreRetorno  * 0.25 + scoreRsi      * 0.15 + scoreTiempo * 0.10
    )

    return {
      total, totalInv, totalCurVal, totalPnl, totalPnlPct,
      inGain, gainRate, avgDays, avgRsi, dayPnl,
      bestTrade, worstTrade, top5Best, top5Worst,
      sectorData, durationData, monthlyData, periodRows,
      portfolioScore, scoreGainRate, scoreDiversif, scoreRetorno, scoreRsi, scoreTiempo,
    }
  }, [filtered, spSeries])

  const scoreColor = (s: number) => s >= 75 ? C.gain : s >= 50 ? C.gold : C.loss
  const scoreLabel = (s: number) => s >= 75 ? 'Sólido' : s >= 50 ? 'Regular' : 'Mejorable'

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
    background: active ? C.accent : C.dim,
    color: active ? '#000' : C.muted,
    border: `1px solid ${active ? C.accent : C.border}`,
    whiteSpace: 'nowrap', flexShrink: 0,
  })

  // (Era un componente definido dentro de la página: se recreaba en cada render)
  const filterBar = (
    <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: isMobile ? 'nowrap' : 'wrap', overflowX: isMobile ? 'auto' : 'visible', alignItems: 'center' }}>
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
      <div style={{ padding: pagePad, background: C.bg, minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>📈 Informe ejecutivo</div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: C.accent }}>Trades Abiertos</h1>
        </div>
        {errorBanner}
        {filterBar}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40vh', color: C.muted, fontSize: 13, textAlign: 'center' }}>
          Sin trades abiertos para el portafolio seleccionado.
        </div>
      </div>
    </AppShell>
  )

  // Fila de top 5 (ganancias y pérdidas eran dos bloques idénticos salvo el color)
  const rankList = (list: typeof stats.top5Best, color: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {list.map((t, i) => (
        <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${C.border}`, paddingBottom: 7 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 9, color: '#444', fontWeight: 700, minWidth: 14 }}>{i + 1}</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{t.ticker}</div>
              <div style={{ fontSize: 8, color: '#555' }}>{t.days}d · RSI {t.rsi > 0 ? t.rsi.toFixed(0) : '—'}</div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 13, fontWeight: 800, color }}>{money(t.pnl)}</div>
            <div style={{ fontSize: 9, color, opacity: 0.7 }}>{fmtPct(t.pnlPct)}</div>
          </div>
        </div>
      ))}
      {list.length === 0 && <span style={{ fontSize: 11, color: '#444' }}>Ninguna por ahora.</span>}
    </div>
  )

  const card: React.CSSProperties = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: cardPad, minWidth: 0 }

  return (
    <AppShell>
      <div style={{ padding: pagePad, background: C.bg, minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>

        {/* ── Header ── */}
        <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>
              📈 Informe ejecutivo
            </div>
            <h1 style={{ margin: 0, fontSize: isMobile ? 19 : 22, fontWeight: 900, color: C.accent, letterSpacing: -0.5 }}>
              Trades Abiertos
            </h1>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>
              {stats.total} posiciones · {new Date().toLocaleDateString('es-MX', isMobile ? { day: '2-digit', month: 'short', year: 'numeric' } : { day: '2-digit', month: 'long', year: 'numeric' })}
            </div>
          </div>
          <div style={{ textAlign: 'center', background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: isMobile ? '10px 14px' : '14px 24px', flexShrink: 0 }}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>{isMobile ? 'SCORE' : 'PORTFOLIO SCORE'}</div>
            <div style={{ fontSize: isMobile ? 30 : 36, fontWeight: 900, color: scoreColor(stats.portfolioScore), lineHeight: 1 }}>
              {stats.portfolioScore}
            </div>
            <div style={{ fontSize: 9, color: scoreColor(stats.portfolioScore), marginTop: 4 }}>/ 100 · {scoreLabel(stats.portfolioScore)}</div>
          </div>
        </div>

        {errorBanner}
        {filterBar}

        {/* ── Fila 1: KPIs ── */}
        <div style={grid(2, 'repeat(7, 1fr)', 10)}>
          {[
            { label: 'CAPITAL INVERTIDO', value: money(stats.totalInv),    color: C.text,   sub: `${stats.total} posiciones` },
            { label: 'VALOR ACTUAL',      value: money(stats.totalCurVal), color: C.accent, sub: fmtPct(stats.totalPnlPct) },
            { label: 'PnL NO REALIZADO',  value: money(stats.totalPnl),    color: stats.totalPnl >= 0 ? C.gain : C.loss, sub: fmtPct(stats.totalPnlPct) },
            { label: 'VARIACIÓN HOY',     value: money(stats.dayPnl),      color: stats.dayPnl >= 0 ? C.gain : C.loss, sub: 'en tu cartera' },
            { label: 'EN GANANCIA',       value: `${stats.gainRate}%`,     color: stats.gainRate >= 60 ? C.gain : C.gold, sub: `${stats.inGain} de ${stats.total}` },
            { label: 'MEJOR POSICIÓN',    value: stats.bestTrade ? money(stats.bestTrade.pnl) : '—', color: C.gain, sub: stats.bestTrade?.ticker || '—' },
            { label: 'PEOR POSICIÓN',     value: stats.worstTrade ? money(stats.worstTrade.pnl) : '—', color: C.loss, sub: stats.worstTrade?.ticker || '—' },
          ].map(k => (
            <div key={k.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px', minWidth: 0 }}>
              <div style={{ fontSize: 8, color: C.muted, fontWeight: 700, letterSpacing: 0.8, marginBottom: 6 }}>{k.label}</div>
              <div style={{ fontSize: isMobile ? 16 : 17, fontWeight: 900, color: k.color, marginBottom: 3 }}>{k.value}</div>
              <div style={{ fontSize: 9, color: '#555' }}>{k.sub}</div>
            </div>
          ))}
        </div>

        {/* ── Fila 2: Evolución mensual + Rendimiento vs SP500 ── */}
        <div style={grid(1, '1.6fr 1fr')}>

          {/* Evolución mensual PnL latente */}
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 6 : 0, marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8 }}>PnL LATENTE POR MES DE APERTURA</div>
                <div style={{ fontSize: 9, color: '#555', marginTop: 2 }}>Barras = PnL no realizado · Línea = acumulado</div>
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: stats.totalPnl >= 0 ? C.gain : C.loss }}>
                {money(stats.totalPnl)} latente total
              </div>
            </div>
            <ResponsiveContainer width="100%" height={isMobile ? 170 : 180}>
              <ComposedChart data={stats.monthlyData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gainGradA" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor={C.gain} stopOpacity={0.9} />
                    <stop offset="100%" stopColor={C.gain} stopOpacity={0.4} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#111" vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 8 }} axisLine={false} tickLine={false} interval={isMobile ? 'preserveStartEnd' : 0} />
                <YAxis tick={{ fill: C.muted, fontSize: 8 }} axisLine={false} tickLine={false} tickFormatter={axisMoney} width={isMobile ? 34 : 40} />
                <Tooltip
                  contentStyle={{ background: C.dim, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11 }}
                  labelStyle={{ color: C.accent, fontWeight: 700 }}
                  formatter={(v: any, name: any) => [money(Number(v) || 0), name === 'cumPnl' ? 'Acumulado' : 'PnL latente']}
                />
                <Bar dataKey="pnl" name="PnL latente" radius={[4, 4, 0, 0]}>
                  {stats.monthlyData.map((m, i) => <Cell key={i} fill={m.pnl >= 0 ? 'url(#gainGradA)' : C.loss} fillOpacity={0.85} />)}
                </Bar>
                <Line type="monotone" dataKey="cumPnl" name="cumPnl" stroke={C.accent} strokeWidth={2} dot={{ fill: C.accent, r: 3, strokeWidth: 0 }} activeDot={{ r: 5 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Rendimiento vs SP500 */}
          <div style={card}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8, marginBottom: 14 }}>RENDIMIENTO VS S&P 500</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: C.dim }}>
                  {['Período', 'Portafolio', 'S&P 500', 'Alfa'].map(h => (
                    <th key={h} style={{ padding: isMobile ? '7px 6px' : '7px 10px', textAlign: h === 'Período' ? 'left' : 'right', color: '#555', fontSize: 8, fontWeight: 700, letterSpacing: 0.5, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.periodRows.map(row => {
                  const cp = isMobile ? '9px 6px' : '9px 10px'
                  return (
                    <tr key={row.label} style={{ borderBottom: '1px solid #0a0a0a' }}>
                      <td style={{ padding: cp, color: C.muted, fontWeight: 600, fontSize: 11 }}>{row.label}</td>
                      <td style={{ padding: cp, textAlign: 'right', fontWeight: 700, fontSize: 11, color: row.portRend === null ? '#333' : row.portRend >= 0 ? C.gain : C.loss }}>
                        {row.portRend === null ? '—' : fmtPct(row.portRend)}
                      </td>
                      <td style={{ padding: cp, textAlign: 'right', fontWeight: 700, fontSize: 11, color: row.sp500Rend === null ? '#333' : '#60a5fa' }}>
                        {row.sp500Rend === null ? '—' : fmtPct(row.sp500Rend)}
                      </td>
                      <td style={{ padding: cp, textAlign: 'right', fontWeight: 800, fontSize: 12, color: row.diff === null ? '#333' : row.diff >= 0 ? C.gain : C.loss }}>
                        {row.diff === null ? '—' : `${row.diff >= 0 ? '▲' : '▼'} ${Math.abs(row.diff).toFixed(1)}%`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {spSeries.length === 0 && (
              <div style={{ fontSize: 9, color: '#555', marginTop: 10 }}>
                Sin datos del S&P 500: abre la página de inicio para que se descarguen.
              </div>
            )}
          </div>
        </div>

        {/* ── Fila 3: Top posiciones + Sectores + Tiempo ── */}
        <div style={grid(1, '1fr 1fr 1fr 0.7fr')}>

          <div style={card}>
            <div style={{ fontSize: 9, color: C.gain, fontWeight: 700, letterSpacing: 0.8, marginBottom: 12 }}>🏆 TOP 5 GANANCIAS LATENTES</div>
            {rankList(stats.top5Best, C.gain)}
          </div>

          <div style={card}>
            <div style={{ fontSize: 9, color: C.loss, fontWeight: 700, letterSpacing: 0.8, marginBottom: 12 }}>⚠️ TOP 5 PÉRDIDAS LATENTES</div>
            {rankList(stats.top5Worst, C.loss)}
          </div>

          {/* Sectores */}
          <div style={card}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8, marginBottom: 12 }}>DISTRIBUCIÓN POR SECTOR</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {stats.sectorData.slice(0, 7).map((s, i) => (
                <div key={s.sector}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, gap: 8 }}>
                    <span style={{ fontSize: 10, color: C.muted, minWidth: 0 }}>{s.sector} <span style={{ color: '#444', fontSize: 8 }}>({s.count})</span></span>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <span style={{ fontSize: 10, color: SECTOR_COLORS[i % SECTOR_COLORS.length], fontWeight: 700 }}>{s.weight}%</span>
                      <span style={{ fontSize: 9, color: s.pnl >= 0 ? C.gain : C.loss, marginLeft: 6 }}>{money(s.pnl)}</span>
                    </div>
                  </div>
                  <div style={{ height: 3, background: C.dim, borderRadius: 2 }}>
                    <div style={{ width: `${s.weight}%`, height: '100%', background: SECTOR_COLORS[i % SECTOR_COLORS.length], borderRadius: 2, opacity: 0.8 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Tiempo en posición */}
          <div style={card}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8, marginBottom: 12 }}>TIEMPO EN POSICIÓN</div>
            <div style={{ textAlign: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 9, color: '#555', marginBottom: 4 }}>Promedio</div>
              <div style={{ fontSize: 26, fontWeight: 900, color: C.accent }}>{stats.avgDays}</div>
              <div style={{ fontSize: 9, color: C.muted }}>días</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {stats.durationData.map(d => (
                <div key={d.range} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 9, color: C.muted }}>{d.range}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 10, color: C.text, fontWeight: 700 }}>{d.count}</span>
                    <span style={{ fontSize: 9, color: d.pnl >= 0 ? C.gain : C.loss }}>{money(d.pnl)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Fila 4: Portfolio Score desglose (tarjetas) ── */}
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8 }}>PORTFOLIO SCORE — DESGLOSE</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ fontSize: 28, fontWeight: 900, color: scoreColor(stats.portfolioScore) }}>{stats.portfolioScore}</div>
              <div style={{ fontSize: 9, color: scoreColor(stats.portfolioScore) }}>/ 100</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(5, 1fr)', gap: 10 }}>
            {[
              { label: 'En ganancia',     pct: 30, score: Math.round(stats.scoreGainRate) },
              { label: 'Retorno',         pct: 25, score: Math.min(Math.round(stats.scoreRetorno), 100) },
              { label: 'Diversificación', pct: 20, score: Math.round(stats.scoreDiversif) },
              { label: 'RSI',             pct: 15, score: Math.round(stats.scoreRsi) },
              { label: 'Tiempo',          pct: 10, score: Math.round(stats.scoreTiempo) },
            ].map(k => (
              <div key={k.label} style={{ background: C.dim, borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: C.muted, marginBottom: 6 }}>{k.label}</div>
                <div style={{ fontSize: 18, fontWeight: 900, color: scoreColor(k.score) }}>{k.score}</div>
                <div style={{ fontSize: 8, color: '#555', marginTop: 2 }}>peso {k.pct}%</div>
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