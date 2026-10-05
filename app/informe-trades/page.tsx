'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { usePrivacy } from '@/lib/PrivacyContext'
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts'
import AppShell from '../AppShell'

const dayKey = (d: any) => String(d || '').split('T')[0].split(' ')[0]
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const r2 = (n: number) => parseFloat(n.toFixed(2))
const fmtPct = (v: number, decimals = 2) => `${v >= 0 ? '+' : ''}${v.toFixed(decimals)}%`
const localDayKey = (d: Date) => d.toLocaleDateString('sv-SE') // yyyy-MM-dd en hora local

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

// Lo invertido en un trade cerrado: apertura + recompras (con comisión)
function closedInvested(t: any): number {
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

export default function InformeTrades() {
  const { money, visible } = usePrivacy()

  const [trades,       setTrades]       = useState<any[]>([])
  const [portfolios,   setPortfolios]   = useState<any[]>([])
  const [spSeries,     setSpSeries]     = useState<{ date: string; close: number }[]>([])
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

      const [tData, pData] = await Promise.all([
        fetchAll(() => supabase.from('trades')
          .select('*, trade_executions(quantity, price, commission, execution_type)')
          .eq('user_id', user.id)
          .eq('status', 'closed')
          .order('id')),
        fetchAll(() => supabase.from('portfolios').select('id, name, grupo').eq('user_id', user.id).order('id')),
      ])
      if (!alive.current) return
      setTrades(tData)
      setPortfolios(pData)
      setLoadError('')
    } catch (e: any) {
      // Antes un error de Supabase dejaba la página vacía como si no hubiera trades
      if (alive.current) setLoadError(e?.message || 'No se pudieron cargar los datos')
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => { setSpSeries(readSpCache()) }, [])

  // ── Todos los trades con sus cálculos, una sola vez (antes se recalculaban en varios sitios) ──
  const allCalc = useMemo(() => trades
    .map(t => {
      const inv = closedInvested(t)
      const pnl = Number(t.realized_pnl || 0)
      const openKey  = dayKey(t.open_date)
      const closeKey = dayKey(t.close_date || t.open_date)
      const rawDays = Math.round(Math.abs(Date.parse(closeKey + 'T00:00:00') - Date.parse(openKey + 'T00:00:00')) / 86400000)
      return {
        ...t, inv, pnl,
        pnlPct: inv > 0 ? (pnl / inv) * 100 : 0,
        days: Number.isFinite(rawDays) ? Math.max(1, rawDays) : 1,
        closeKey, year: closeKey.slice(0, 4),
      }
    })
    .sort((a, b) => a.closeKey.localeCompare(b.closeKey))
  , [trades])

  const availableYears = useMemo(() => {
    const years = new Set<string>([new Date().getFullYear().toString()])
    allCalc.forEach(t => { if (/^\d{4}$/.test(t.year)) years.add(t.year) })
    return Array.from(years).sort((a, b) => b.localeCompare(a))
  }, [allCalc])

  // Filtrados solo por billetera: sirven para el PnL anual y la comparación por período
  const walletTrades = useMemo(
    () => allCalc.filter(t => filterWallet === 'all' || t.portfolio_id === filterWallet),
    [allCalc, filterWallet]
  )
  const filtered = useMemo(
    () => walletTrades.filter(t => filterYear === 'all' || t.year === filterYear),
    [walletTrades, filterYear]
  )

  const stats = useMemo(() => {
    if (!filtered.length) return null
    const now = new Date()

    // ── KPIs básicos (filtered ya viene ordenado por fecha de cierre) ────
    let wins = 0, totalWin = 0, totalLoss = 0
    let equity = 0, peak = 0, maxDD = 0
    for (const t of filtered) {
      equity += t.pnl
      if (equity > peak) peak = equity
      const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0
      if (dd > maxDD) maxDD = dd
      if (t.pnl > 0) { wins++; totalWin += t.pnl } else { totalLoss += Math.abs(t.pnl) }
    }

    const total        = filtered.length
    const winRate      = parseFloat(((wins / total) * 100).toFixed(1))
    const pfInfinite   = totalLoss === 0 && totalWin > 0
    const profitFactor = totalLoss > 0 ? r2(totalWin / totalLoss) : totalWin > 0 ? 99 : 0
    const totalPnl     = r2(equity)
    const avgPnl       = r2(totalPnl / total)
    const avgDays      = parseFloat((filtered.reduce((a, t) => a + t.days, 0) / total).toFixed(1))
    const totalInv     = r2(filtered.reduce((a, t) => a + t.inv, 0))
    const retorno      = totalInv > 0 ? r2((totalPnl / totalInv) * 100) : 0

    // ── Top trades ───────────────────────────────────────────────────────
    const byPnl      = [...filtered].sort((a, b) => b.pnl - a.pnl)
    const bestTrade  = byPnl[0]
    const worstTrade = byPnl[byPnl.length - 1]
    // Cada lista solo lleva lo que corresponde: antes, con pocos trades, "peores" mostraba ganadores
    // (y el mismo trade podía salir en las dos listas)
    const top5Best  = byPnl.filter(t => t.pnl > 0).slice(0, 5)
    const top5Worst = byPnl.filter(t => t.pnl < 0).slice(-5).reverse()

    // ── Evolución mensual ────────────────────────────────────────────────
    const monthly: Record<string, { pnl: number; wins: number; trades: number }> = {}
    filtered.forEach(t => {
      if (!DAY_RE.test(t.closeKey)) return
      const m = (monthly[t.closeKey.slice(0, 7)] ??= { pnl: 0, trades: 0, wins: 0 }) // 'YYYY-MM'
      m.pnl += t.pnl; m.trades += 1
      if (t.pnl > 0) m.wins++
    })
    let cumPnl = 0
    const monthlyData = Object.entries(monthly)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, d]) => {
        const [y, m] = key.split('-')
        cumPnl = r2(cumPnl + d.pnl)
        return {
          label:   `${MONTH_ORDER[Number(m) - 1]} ${y}`,
          pnl:     r2(d.pnl),
          cumPnl,
          trades:  d.trades,
          winRate: Math.round((d.wins / d.trades) * 100),
        }
      })

    // ── Por sector ───────────────────────────────────────────────────────
    const sectorMap: Record<string, { pnl: number; inv: number; count: number; wins: number }> = {}
    filtered.forEach(t => {
      const s = (sectorMap[t.sector || 'Sin sector'] ??= { pnl: 0, inv: 0, count: 0, wins: 0 })
      s.pnl += t.pnl; s.inv += t.inv; s.count += 1
      if (t.pnl > 0) s.wins++
    })
    const sectorData = Object.entries(sectorMap)
      .map(([sector, d]) => ({
        sector, count: d.count, winRate: Math.round((d.wins / d.count) * 100),
        pnl:    r2(d.pnl),
        pnlPct: d.inv > 0 ? r2((d.pnl / d.inv) * 100) : 0,
      }))
      .sort((a, b) => b.pnl - a.pnl)

    // ── Razón de cierre ──────────────────────────────────────────────────
    const reasonMap: Record<string, { pnl: number; count: number }> = {}
    filtered.forEach(t => {
      const r = (reasonMap[t.close_reason || 'Sin razón'] ??= { pnl: 0, count: 0 })
      r.pnl += t.pnl; r.count += 1
    })
    const reasonData = Object.entries(reasonMap)
      .map(([reason, d]) => ({
        reason, count: d.count,
        pnl:    r2(d.pnl),
        pnlPct: totalInv > 0 ? r2((d.pnl / totalInv) * 100) : 0,
      }))
      .sort((a, b) => b.pnl - a.pnl)

    // ── Rendimiento por período vs SP500 ─────────────────────────────────
    // Los períodos son relativos a HOY, así que usan los trades de la billetera sin el filtro de año
    // (antes, con un año pasado elegido, casi todas las filas quedaban en "—").
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
      const pTrades   = walletTrades.filter(t => DAY_RE.test(dayKey(t.close_date)) && t.closeKey >= cutoffKey)
      const pInv      = pTrades.reduce((a, t) => a + t.inv, 0)
      const pPnl      = pTrades.reduce((a, t) => a + t.pnl, 0)
      const portRend  = pInv > 0 ? r2((pPnl / pInv) * 100) : null

      // Último cierre del S&P en o antes del inicio del período (búsqueda binaria)
      let lo = 0, hi = spSeries.length - 1, idx = -1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (spSeries[mid].date <= cutoffKey) { idx = mid; lo = mid + 1 } else hi = mid - 1
      }
      const spStart   = idx >= 0 ? spSeries[idx].close : null
      const sp500Rend = spStart && spEnd ? r2(((spEnd - spStart) / spStart) * 100) : null
      const diff = portRend !== null && sp500Rend !== null ? r2(portRend - sp500Rend) : null
      return { label: p.label, portRend, sp500Rend, diff }
    })

    // ── PnL anual histórico: todos los años, respetando la billetera elegida ──
    // (antes ignoraba el filtro de billetera y recorría todos los trades una vez por año)
    const byYear = new Map<string, { pnl: number; inv: number }>()
    walletTrades.forEach(t => {
      const y = byYear.get(t.year) ?? { pnl: 0, inv: 0 }
      y.pnl += t.pnl; y.inv += t.inv
      byYear.set(t.year, y)
    })
    const pnlAnual = Array.from(byYear.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([year, d]) => ({ year, pnl: r2(d.pnl), pct: d.inv > 0 ? r2((d.pnl / d.inv) * 100) : 0 }))

    // ── Trade Score ───────────────────────────────────────────────────────
    const scoreWR      = Math.min(winRate, 100)
    const scorePF      = Math.min((profitFactor / 3) * 100, 100)
    const scoreRetorno = Math.min(Math.max(retorno * 5, 0), 100)
    const scoreSector  = Math.min((sectorData.length / 8) * 100, 100)
    const scoreMeses   = monthlyData.length > 0
      ? Math.min((monthlyData.filter(m => m.pnl > 0).length / monthlyData.length) * 100, 100)
      : 0
    const tradeScore = Math.round(
      scoreWR * 0.30 + scorePF * 0.25 + scoreRetorno * 0.20 + scoreSector * 0.15 + scoreMeses * 0.10
    )

    return {
      total, wins, winRate, totalPnl, avgPnl, avgDays, totalInv, retorno,
      profitFactor, pfInfinite, maxDD: r2(maxDD),
      bestTrade, worstTrade, top5Best, top5Worst,
      monthlyData, sectorData, reasonData,
      periodRows, tradeScore,
      scoreWR, scorePF, scoreRetorno, scoreSector, scoreMeses,
      pnlAnual,
    }
  }, [filtered, walletTrades, spSeries])

  const scoreColor = (s: number) => s >= 75 ? C.gain : s >= 50 ? C.gold : C.loss
  const scoreLabel = (s: number) => s >= 75 ? 'Sólido' : s >= 50 ? 'Regular' : 'Mejorable'

  // Eje en modo privado: oculto (antes mostraba los importes aunque activaras la privacidad)
  const axisMoney = (v: number) => !visible ? '' : Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v}`

  const chipStyle = (active: boolean): React.CSSProperties => ({
    padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer',
    background: active ? C.accent : C.dim,
    color: active ? '#000' : C.muted,
    border: `1px solid ${active ? C.accent : C.border}`,
  })

  // Una sola barra de filtros (estaba copiada dos veces: la del estado vacío y la del informe)
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
          <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>📊 Informe ejecutivo</div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: C.accent }}>Trades Cerrados</h1>
        </div>
        {errorBanner}
        {filterBar}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40vh', color: C.muted, fontSize: 13 }}>
          Sin trades cerrados para el período seleccionado.
        </div>
      </div>
    </AppShell>
  )

  // Top 5 mejores / peores (eran dos bloques idénticos salvo el color)
  const tradeList = (list: typeof stats.top5Best, color: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {list.map((t, i) => (
        <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${C.border}`, paddingBottom: 7 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 9, color: '#444', fontWeight: 700, minWidth: 14 }}>{i + 1}</span>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{t.ticker}</div>
              <div style={{ fontSize: 8, color: '#555' }}>{t.days}d · {t.close_reason || '—'}</div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 15, fontWeight: 900, color }}>{fmtPct(t.pnlPct)}</div>
            <div style={{ fontSize: 10, color, opacity: 0.7 }}>{money(t.pnl)}</div>
          </div>
        </div>
      ))}
      {list.length === 0 && <span style={{ fontSize: 11, color: '#444' }}>Ninguno por ahora.</span>}
    </div>
  )

  const card: React.CSSProperties = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }
  const cardTitle = (color = C.muted): React.CSSProperties => ({ fontSize: 9, color, fontWeight: 700, letterSpacing: 0.8, marginBottom: 12 })
  const rowStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${C.border}`, paddingBottom: 7 }

  return (
    <AppShell>
      <div style={{ padding: '20px 24px', background: C.bg, minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>

        {/* ── Header ── */}
        <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>
              📊 Informe ejecutivo
            </div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: C.accent, letterSpacing: -0.5 }}>
              Trades Cerrados
            </h1>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>
              {filterYear === 'all' ? 'Histórico completo' : filterYear} · {stats.total} operaciones
            </div>
          </div>
          {/* Trade Score */}
          <div style={{ textAlign: 'center', background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '14px 24px' }}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>TRADE SCORE</div>
            <div style={{ fontSize: 36, fontWeight: 900, color: scoreColor(stats.tradeScore), lineHeight: 1 }}>
              {stats.tradeScore}
            </div>
            <div style={{ fontSize: 9, color: scoreColor(stats.tradeScore), marginTop: 4 }}>/ 100 · {scoreLabel(stats.tradeScore)}</div>
          </div>
        </div>

        {errorBanner}
        {filterBar}

        {/* ── Fila 1: KPIs ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 10, marginBottom: 16 }}>
          {[
            { label: 'PnL TOTAL',      value: money(stats.totalPnl),      color: stats.totalPnl >= 0 ? C.gain : C.loss, sub: `${fmtPct(stats.retorno)} retorno` },
            { label: 'WIN RATE',       value: `${stats.winRate}%`,        color: stats.winRate >= 60 ? C.gain : C.gold, sub: `${stats.wins} de ${stats.total} trades` },
            { label: 'PROFIT FACTOR',  value: stats.pfInfinite ? '∞' : stats.profitFactor, color: stats.profitFactor >= 2 ? C.gain : stats.profitFactor >= 1 ? C.gold : C.loss, sub: 'ganancia / pérdida' },
            { label: 'PnL PROMEDIO',   value: money(stats.avgPnl),        color: stats.avgPnl >= 0 ? C.gain : C.loss, sub: 'por trade' },
            { label: 'MEJOR TRADE',    value: stats.bestTrade ? money(stats.bestTrade.pnl) : '—', color: C.gain, sub: stats.bestTrade?.ticker || '—' },
            { label: 'PEOR TRADE',     value: stats.worstTrade ? money(stats.worstTrade.pnl) : '—', color: C.loss, sub: stats.worstTrade?.ticker || '—' },
            { label: 'DRAWDOWN MÁX',   value: `${stats.maxDD.toFixed(1)}%`, color: stats.maxDD < 10 ? C.gain : stats.maxDD < 20 ? C.gold : C.loss, sub: 'caída del PnL acumulado' },
          ].map(k => (
            <div key={k.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px' }}>
              <div style={{ fontSize: 8, color: C.muted, fontWeight: 700, letterSpacing: 0.8, marginBottom: 6 }}>{k.label}</div>
              <div style={{ fontSize: 17, fontWeight: 900, color: k.color as string, marginBottom: 3 }}>{k.value}</div>
              <div style={{ fontSize: 9, color: '#555' }}>{k.sub}</div>
            </div>
          ))}
        </div>

        {/* ── Fila 2: Evolución mensual + Período vs SP500 ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 14, marginBottom: 16 }}>

          {/* Evolución mensual */}
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8 }}>EVOLUCIÓN MENSUAL DEL PnL</div>
                <div style={{ fontSize: 9, color: '#555', marginTop: 2 }}>Barras = PnL mes · Línea = acumulado</div>
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: stats.totalPnl >= 0 ? C.gain : C.loss }}>
                {money(stats.totalPnl)} acumulado
              </div>
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <ComposedChart data={stats.monthlyData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gainGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor={C.gain} stopOpacity={0.9} />
                    <stop offset="100%" stopColor={C.gain} stopOpacity={0.4} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#111" vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 8 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: C.muted, fontSize: 8 }} axisLine={false} tickLine={false} tickFormatter={axisMoney} width={40} />
                <Tooltip
                  contentStyle={{ background: C.dim, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11 }}
                  labelStyle={{ color: C.accent, fontWeight: 700 }}
                  formatter={(v: any, name: any) => [money(Number(v) || 0), name === 'cumPnl' ? 'Acumulado' : 'PnL mes']}
                />
                <Bar dataKey="pnl" name="PnL mes" radius={[4, 4, 0, 0]}>
                  {stats.monthlyData.map((m, i) => <Cell key={i} fill={m.pnl >= 0 ? 'url(#gainGrad)' : C.loss} fillOpacity={0.85} />)}
                </Bar>
                <Line type="monotone" dataKey="cumPnl" name="cumPnl" stroke={C.accent} strokeWidth={2} dot={{ fill: C.accent, r: 3, strokeWidth: 0 }} activeDot={{ r: 5 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Rendimiento por período */}
          <div style={card}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8, marginBottom: 14 }}>RENDIMIENTO VS S&P 500</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: C.dim }}>
                  {['Período', 'Portafolio', 'S&P 500', 'Alfa'].map(h => (
                    <th key={h} style={{ padding: '7px 10px', textAlign: h === 'Período' ? 'left' : 'right', color: '#555', fontSize: 8, fontWeight: 700, letterSpacing: 0.5, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.periodRows.map(row => (
                  <tr key={row.label} style={{ borderBottom: '1px solid #0a0a0a' }}>
                    <td style={{ padding: '9px 10px', color: C.muted, fontWeight: 600, fontSize: 11 }}>{row.label}</td>
                    <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700, fontSize: 11, color: row.portRend === null ? '#333' : row.portRend >= 0 ? C.gain : C.loss }}>
                      {row.portRend === null ? '—' : fmtPct(row.portRend)}
                    </td>
                    <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700, fontSize: 11, color: row.sp500Rend === null ? '#333' : '#60a5fa' }}>
                      {row.sp500Rend === null ? '—' : fmtPct(row.sp500Rend)}
                    </td>
                    <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 800, fontSize: 12, color: row.diff === null ? '#333' : row.diff >= 0 ? C.gain : C.loss }}>
                      {row.diff === null ? '—' : `${row.diff >= 0 ? '▲' : '▼'} ${Math.abs(row.diff).toFixed(1)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {spSeries.length === 0 && (
              <div style={{ fontSize: 9, color: '#555', marginTop: 10 }}>
                Sin datos del S&P 500: abre la página de inicio para que se descarguen.
              </div>
            )}
          </div>
        </div>

        {/* ── Fila 3: Las 5 tarjetas estilo uniforme ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: 14, marginBottom: 16 }}>

          <div style={card}>
            <div style={cardTitle(C.gain)}>🏆 TOP 5 MEJORES</div>
            {tradeList(stats.top5Best, C.gain)}
          </div>

          <div style={card}>
            <div style={cardTitle(C.loss)}>⚠️ TOP 5 PEORES</div>
            {tradeList(stats.top5Worst, C.loss)}
          </div>

          {/* PnL por sector */}
          <div style={card}>
            <div style={cardTitle()}>PnL POR SECTOR</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {stats.sectorData.slice(0, 5).map(s => (
                <div key={s.sector} style={rowStyle}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{s.sector}</div>
                    <div style={{ fontSize: 8, color: '#555' }}>{s.count} trades · WR {s.winRate}%</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 15, fontWeight: 900, color: s.pnl >= 0 ? C.gain : C.loss }}>{fmtPct(s.pnlPct)}</div>
                    <div style={{ fontSize: 10, color: s.pnl >= 0 ? C.gain : C.loss, opacity: 0.7 }}>{money(s.pnl)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* PnL por razón de cierre */}
          <div style={card}>
            <div style={cardTitle()}>PnL POR RAZÓN</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {stats.reasonData.slice(0, 5).map(r => (
                <div key={r.reason} style={rowStyle}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{r.reason}</div>
                    <div style={{ fontSize: 8, color: '#555' }}>{r.count} trades</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 15, fontWeight: 900, color: r.pnl >= 0 ? C.gain : C.loss }}>{fmtPct(r.pnlPct)}</div>
                    <div style={{ fontSize: 10, color: r.pnl >= 0 ? C.gain : C.loss, opacity: 0.7 }}>{money(r.pnl)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* PnL anual */}
          <div style={card}>
            <div style={cardTitle()}>PnL ANUAL</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {stats.pnlAnual.map(y => {
                const isSelected = y.year === filterYear
                return (
                  <div key={y.year} style={{ ...rowStyle, paddingBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: isSelected ? 900 : 600, color: isSelected ? C.accent : C.muted }}>
                      {y.year}{isSelected && <span style={{ fontSize: 8, color: C.accent, marginLeft: 4 }}>●</span>}
                    </span>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 15, fontWeight: 900, color: y.pnl >= 0 ? C.gain : C.loss }}>{fmtPct(y.pct)}</div>
                      <div style={{ fontSize: 10, color: y.pnl >= 0 ? C.gain : C.loss, opacity: 0.7 }}>{y.pnl >= 0 ? '+' : ''}{money(y.pnl)}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

        </div>

        {/* ── Fila 4: Trade Score desglose ── */}
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8 }}>TRADE SCORE — DESGLOSE</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ fontSize: 28, fontWeight: 900, color: scoreColor(stats.tradeScore) }}>{stats.tradeScore}</div>
              <div style={{ fontSize: 9, color: scoreColor(stats.tradeScore) }}>/ 100</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
            {[
              { label: 'Win Rate',     pct: 30, score: Math.round(stats.scoreWR) },
              { label: 'Prof. Factor', pct: 25, score: Math.round(stats.scorePF) },
              { label: 'Retorno',      pct: 20, score: Math.round(stats.scoreRetorno) },
              { label: 'Sectores',     pct: 15, score: Math.round(stats.scoreSector) },
              { label: 'Consistencia', pct: 10, score: Math.min(Math.round(stats.scoreMeses), 100) },
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