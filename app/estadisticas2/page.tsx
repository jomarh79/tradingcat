'use client'

import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { usePrivacy } from '@/lib/PrivacyContext'
import { useIsMobile } from '@/lib/useIsMobile'
import AppShell from '../AppShell'
import { TrendingUp } from 'lucide-react'
import {
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  BarChart, Bar, PieChart, Pie, Cell,
  AreaChart, Area, LineChart, Line, ReferenceLine, ComposedChart,
  ScatterChart, Scatter, ZAxis,
} from 'recharts'

const dayKey = (d: any) => String(d || '').split('T')[0].split(' ')[0]
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const dayMs = (k: string) => new Date(k + 'T00:00:00').getTime()
const localDayKey = (d: Date) => d.toLocaleDateString('sv-SE') // yyyy-MM-dd en hora local
const r2 = (n: number) => parseFloat(n.toFixed(2))
const MESES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']

const C = {
  gain:    '#22c55e',
  loss:    '#f43f5e',
  accent:  '#00bfff',
  sp500:   '#a78bfa',
  warning: '#eab308',
  card:    '#080808',
  border:  '#1a1a1a',
  muted:   '#888',
}

const PIE_COLORS = ['#00bfff','#6366f1','#22c55e','#eab308','#f43f5e','#a855f7','#ec4899','#14b8a6','#f97316','#84cc16']

type Period = 'YTD' | '1Y' | '5Y' | 'MAX'

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

// Capital con el que se abrió y se fue aumentando un trade (para trades cerrados)
function closedInvested(t: any): number {
  const initialInv = Number(t.initial_entry_price || t.entry_price || 0) * Number(t.initial_quantity || t.quantity || 0)
  const buyExtra = (t.trade_executions || [])
    .filter((e: any) => e.execution_type === 'buy')
    .reduce((a: number, e: any) => a + Number(e.quantity) * Number(e.price) + Number(e.commission || 0), 0)
  return r2(initialInv + buyExtra)
}

function normSector(s: any): string {
  const v = String(s || '').trim()
  if (!v) return 'ETFs'
  return v.charAt(0).toUpperCase() + v.slice(1).toLowerCase()
}

// ── Cat decorators ─────────────────────────────────────────────────────────
const Paw = ({ size = 14, color = '#666', opacity = 1, style: s = {} }: any) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ opacity, flexShrink: 0, ...s }}>
    <ellipse cx="6"  cy="5"  rx="2.5" ry="3"/>
    <ellipse cx="11" cy="3"  rx="2.5" ry="3"/>
    <ellipse cx="16" cy="4"  rx="2.5" ry="3"/>
    <ellipse cx="19" cy="9"  rx="2"   ry="2.5"/>
    <path d="M12 22c-5 0-8-3-8-7 0-2.5 1.5-4.5 4-5.5 1-.4 2-.6 4-.6s3 .2 4 .6c2.5 1 4 3 4 5.5 0 4-3 7-8 7z"/>
  </svg>
)
const CatEars = ({ color = '#00bfff', opacity = 0.1, size = 40 }: any) => (
  <svg width={size * 1.5} height={size} viewBox="0 0 60 40" fill={color} style={{ opacity }}>
    <polygon points="0,40 12,0 24,40"/>
    <polygon points="36,40 48,0 60,40"/>
  </svg>
)
const Whiskers = ({ color = '#888', opacity = 0.1, width = 90 }: any) => (
  <svg width={width} height={32} viewBox={`0 0 ${width} 32`} stroke={color} strokeWidth="1.5" style={{ opacity }}>
    <line x1="0" y1="8"  x2={width * 0.44} y2="16"/>
    <line x1="0" y1="16" x2={width * 0.44} y2="16"/>
    <line x1="0" y1="24" x2={width * 0.44} y2="16"/>
    <line x1={width} y1="8"  x2={width * 0.56} y2="16"/>
    <line x1={width} y1="16" x2={width * 0.56} y2="16"/>
    <line x1={width} y1="24" x2={width * 0.56} y2="16"/>
  </svg>
)
const CatTail = ({ color = '#00bfff', opacity = 0.07 }: any) => (
  <svg width={46} height={76} viewBox="0 0 50 80" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" style={{ opacity }}>
    <path d="M40 80 Q45 50 20 40 Q0 30 10 10 Q20 -5 35 5"/>
  </svg>
)
const CatSitting = ({ size = 60, color = '#00bfff', opacity = 0.06 }: any) => (
  <svg width={size} height={size * 1.3} viewBox="0 0 50 65" fill={color} style={{ opacity }}>
    <polygon points="10,18 15,5 22,18"/>
    <polygon points="28,18 35,5 40,18"/>
    <ellipse cx="25" cy="24" rx="14" ry="12"/>
    <ellipse cx="25" cy="46" rx="13" ry="14"/>
    <path d="M38 56 Q50 48 46 38 Q42 30 38 36" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round"/>
  </svg>
)

const CatTooltip = ({ active, payload, label, formatter, labelFormatter }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#0a0a0a', border: '1px solid #333', borderRadius: 8, padding: '10px 14px', fontSize: 11 }}>
      {label && <div style={{ color: '#aaa', marginBottom: 6, fontWeight: 600 }}>
        {labelFormatter ? labelFormatter(label) : label}
      </div>}
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, display: 'inline-block' }} />
          <span style={{ color: '#888' }}>{p.name}:</span>
          <span style={{ color: '#fff', fontWeight: 700 }}>
            {formatter ? formatter(p.value, p.name) : p.value}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function EstadisticasCerradosPage() {
  const { money, visible } = usePrivacy()
  const isMobile = useIsMobile()

  const [trades,            setTrades]            = useState<any[]>([])
  const [portfolios,        setPortfolios]        = useState<any[]>([])
  const [selectedPortfolio, setSelectedPortfolio] = useState('all')
  const [selectedYear,      setSelectedYear]      = useState(new Date().getFullYear().toString())
  const [loading,           setLoading]           = useState(true)
  const [loadError,         setLoadError]         = useState('')
  const [spSeries,          setSpSeries]          = useState<{ dates: string[]; closes: number[] }>({ dates: [], closes: [] })
  const [equityPeriod,      setEquityPeriod]      = useState<Period>('YTD')

  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const fetchData = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const [pData, tData] = await Promise.all([
        fetchAll(() => supabase.from('portfolios').select('id, name').eq('user_id', user.id).order('id')),
        fetchAll(() => supabase.from('trades')
          .select('*, portfolios(name, id), trade_executions(quantity, price, commission, execution_type)')
          .eq('user_id', user.id).eq('status', 'closed').order('close_date').order('id')),
      ])
      if (!alive.current) return
      setPortfolios(pData); setTrades(tData); setLoadError('')
    } catch (e: any) {
      if (alive.current) setLoadError(e?.message || 'No se pudieron cargar los datos')
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    // Caché del S&P 500: acepta el formato viejo [{date,close}] y el nuevo {ts,rows}
    // (con el nuevo, el código anterior fallaba al hacer forEach sobre un objeto)
    try {
      const cached = localStorage.getItem('sp500')
      if (cached) {
        const parsed = JSON.parse(cached)
        const rows: { date: string; close: number }[] = Array.isArray(parsed) ? parsed : (parsed?.rows || [])
        const clean = rows
          .map(d => ({ date: dayKey(d.date), close: Number(d.close) }))
          .filter(d => DAY_RE.test(d.date) && d.close > 0)
          .sort((a, b) => a.date.localeCompare(b.date))
        setSpSeries({ dates: clean.map(d => d.date), closes: clean.map(d => d.close) })
      }
    } catch (e) { console.error('SP500 cache:', e) }
  }, [fetchData])

  const hasSp = spSeries.dates.length > 0

  // Cierre del S&P 500 en o antes de una fecha (búsqueda binaria)
  const spAt = useCallback((k: string): number | null => {
    const { dates, closes } = spSeries
    let lo = 0, hi = dates.length - 1, idx = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (dates[mid] <= k) { idx = mid; lo = mid + 1 } else hi = mid - 1
    }
    return idx >= 0 ? closes[idx] : null
  }, [spSeries])

  // Trades cerrados con todos los campos derivados calculados UNA vez
  const enriched = useMemo(() => trades
    .map(t => {
      const closeKey = dayKey(t.close_date || t.open_date)
      const openKey  = dayKey(t.open_date || t.close_date)
      if (!DAY_RE.test(closeKey) || !DAY_RE.test(openKey)) return null
      const invested = closedInvested(t)
      const pnl      = Number(t.realized_pnl) || 0
      const days     = Math.max(1, Math.ceil(Math.abs(dayMs(closeKey) - dayMs(openKey)) / 86400000))
      // Lo que habría ganado ese mismo capital en el S&P 500 entre las mismas fechas
      const spO = spAt(openKey), spC = spAt(closeKey)
      const bench = spO && spC && invested > 0 ? invested * (spC / spO - 1) : null
      return {
        ...t, closeKey, openKey, invested, pnl, days, bench,
        pct: invested > 0 ? (pnl / invested) * 100 : 0,
        sectorN: normSector(t.sector),
      }
    })
    .filter((t): t is NonNullable<typeof t> => t !== null)
    .sort((a, b) => a.closeKey.localeCompare(b.closeKey) || String(a.id).localeCompare(String(b.id)))
  , [trades, spAt])

  const availableYears = useMemo(() => {
    const years = new Set<string>([new Date().getFullYear().toString()])
    enriched.forEach(t => years.add(t.closeKey.slice(0, 4)))
    return Array.from(years).sort((a, b) => b.localeCompare(a))
  }, [enriched])

  // Billetera elegida (sin filtro de año): base de la tabla por período
  const portRows = useMemo(
    () => enriched.filter(t => selectedPortfolio === 'all' || t.portfolio_id === selectedPortfolio),
    [enriched, selectedPortfolio]
  )
  const rows = useMemo(
    () => portRows.filter(t => selectedYear === 'all' || t.closeKey.startsWith(selectedYear)),
    [portRows, selectedYear]
  )

  // ── Métricas y tarjetas ───────────────────────────────────────────────────
  const stats = useMemo(() => {
    if (!rows.length) return null

    const total   = rows.length
    const wins    = rows.filter(t => t.pnl > 0)
    const losses  = rows.filter(t => t.pnl < 0)
    const breakEven = total - wins.length - losses.length

    const totalPnL = r2(rows.reduce((a, t) => a + t.pnl, 0))
    const totalInv = rows.reduce((a, t) => a + t.invested, 0)
    const totalPnLPct = totalInv > 0 ? r2((totalPnL / totalInv) * 100) : 0
    const totalWin  = r2(wins.reduce((a, t) => a + t.pnl, 0))
    const totalLoss = r2(losses.reduce((a, t) => a + Math.abs(t.pnl), 0))

    const winRate      = parseFloat(((wins.length / total) * 100).toFixed(1))
    const avgWin       = wins.length   ? r2(totalWin  / wins.length)   : 0
    const avgLoss      = losses.length ? r2(totalLoss / losses.length) : 0
    const winLossRatio = avgLoss > 0 ? r2(avgWin / avgLoss) : 0
    // Sin pérdidas el factor no existe (antes se mostraba "100")
    const profitFactor: number | null = totalLoss > 0 ? r2(totalWin / totalLoss) : null
    // Expectativa exacta = PnL medio por trade (antes se calculaba con el win rate ya redondeado)
    const expectancy = r2(totalPnL / total)
    const avgDuration = parseFloat((rows.reduce((a, t) => a + t.days, 0) / total).toFixed(1))
    const avgReturnPct = r2(rows.reduce((a, t) => a + t.pct, 0) / total)

    // Rachas y drawdown (en $, desde el pico del PnL acumulado; el pico parte de 0).
    // Un trade en cero no corta ni suma racha (antes contaba como perdido).
    let equity = 0, peak = 0, maxDD = 0
    let winStrk = 0, maxWinStrk = 0, lossStrk = 0, maxLossStrk = 0
    rows.forEach(t => {
      equity += t.pnl
      if (equity > peak) peak = equity
      if (peak - equity > maxDD) maxDD = peak - equity
      if (t.pnl > 0)      { winStrk++; lossStrk = 0; if (winStrk > maxWinStrk) maxWinStrk = winStrk }
      else if (t.pnl < 0) { lossStrk++; winStrk = 0; if (lossStrk > maxLossStrk) maxLossStrk = lossStrk }
    })
    const recoveryFactor = maxDD > 0 ? r2(totalPnL / maxDD) : null

    const bestTradePct  = rows.reduce((a, b) => (b.pct > a.pct ? b : a), rows[0])
    const worstTradePct = rows.reduce((a, b) => (b.pct < a.pct ? b : a), rows[0])

    // Mes a mes (clave yyyy-MM: ordena bien y evita parsear textos como "sep." / "sept.")
    const monthlyMap: Record<string, { pnl: number; wins: number; losses: number; trades: number }> = {}
    rows.forEach(t => {
      const k = t.closeKey.slice(0, 7)
      const m = (monthlyMap[k] ||= { pnl: 0, wins: 0, losses: 0, trades: 0 })
      m.pnl += t.pnl; m.trades++
      if (t.pnl > 0) m.wins++
      else if (t.pnl < 0) m.losses++
    })
    const monthKeys = Object.keys(monthlyMap).sort()
    const monthLabel = (k: string) => `${MESES[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`
    const monthlyTable = monthKeys.map(k => {
      const m = monthlyMap[k]
      return {
        key: k, month: monthLabel(k), pnl: r2(m.pnl), trades: m.trades, wins: m.wins, losses: m.losses,
        winRate: m.trades > 0 ? Math.round((m.wins / m.trades) * 100) : 0,
      }
    })
    const bestMonth  = monthlyTable.reduce((a, b) => (b.pnl > a.pnl ? b : a), monthlyTable[0])
    const worstMonth = monthlyTable.reduce((a, b) => (b.pnl < a.pnl ? b : a), monthlyTable[0])

    // Acumulado mensual como cascada: cada barra flota entre el acumulado anterior y el nuevo
    // (el apilado con base transparente se rompía cuando el acumulado cruzaba el cero)
    let cum = 0
    const monthlyWaterfall = monthlyTable.map(m => {
      const from = cum, to = cum + m.pnl
      cum = to
      return {
        month: m.month, value: m.pnl, cumPnl: r2(to),
        range: [r2(Math.min(from, to)), r2(Math.max(from, to))] as [number, number],
        fill: m.pnl >= 0 ? C.gain : C.loss,
      }
    })

    // Sector: PnL (con signo) → barras horizontales. Con negativos una dona no tiene sentido.
    const sectorMap: Record<string, { pnl: number; count: number }> = {}
    rows.forEach(t => { const s = (sectorMap[t.sectorN] ||= { pnl: 0, count: 0 }); s.pnl += t.pnl; s.count++ })
    const sectorData = Object.entries(sectorMap)
      .map(([name, d]) => ({ name, value: r2(d.pnl), count: d.count }))
      .sort((a, b) => b.value - a.value)

    const reasonMap: Record<string, { pnl: number; count: number }> = {}
    rows.forEach(t => { const r = String(t.close_reason || '').trim() || 'Sin especificar'; const o = (reasonMap[r] ||= { pnl: 0, count: 0 }); o.pnl += t.pnl; o.count++ })
    const closeReasonData = Object.entries(reasonMap)
      .map(([reason, d]) => ({ reason, pnl: r2(d.pnl), count: d.count }))
      .sort((a, b) => b.count - a.count)

    const buckets = { '1-7 días': 0, '8-30 días': 0, '31-90 días': 0, '+90 días': 0 }
    rows.forEach(t => {
      if (t.days <= 7) buckets['1-7 días']++
      else if (t.days <= 30) buckets['8-30 días']++
      else if (t.days <= 90) buckets['31-90 días']++
      else buckets['+90 días']++
    })
    const durationData = Object.entries(buckets).map(([bucket, count]) => ({ bucket, count }))

    const scatterData = rows.map(t => ({
      ticker: t.ticker, days: t.days, pnlPct: r2(t.pct), pnl: r2(t.pnl), color: t.pnl >= 0 ? C.gain : C.loss,
    }))

    return {
      totalTrades: total, totalPnL, totalPnLPct, winRate, profitFactor, expectancy,
      avgWin, avgLoss, winLossRatio, maxDD: r2(maxDD),
      maxWinStrk, maxLossStrk, avgDuration, bestMonth, worstMonth,
      // solo ganadores / solo perdedores reales (antes, con pocos trades, el "top" podía traer del lado contrario)
      topWinners: wins.slice().sort((a, b) => b.pnl - a.pnl).slice(0, 5),
      topLosers:  losses.slice().sort((a, b) => a.pnl - b.pnl).slice(0, 5),
      recoveryFactor, avgReturnPct, bestTradePct, worstTradePct,
      winsCount: wins.length, lossesCount: losses.length, breakEvenCount: breakEven,
      monthlyTable, monthlyWaterfall, sectorData, closeReasonData, durationData, scatterData,
    }
  }, [rows])

  // ── Curvas del período elegido (drawdown y vs S&P 500), reiniciadas al inicio del período ──
  const curves = useMemo(() => {
    const now = new Date()
    let cutoffKey = ''
    if (equityPeriod === 'YTD') cutoffKey = `${now.getFullYear()}-01-01`
    else if (equityPeriod === '1Y') cutoffKey = localDayKey(new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()))
    else if (equityPeriod === '5Y') cutoffKey = localDayKey(new Date(now.getFullYear() - 5, now.getMonth(), now.getDate()))

    const inPeriod = rows.filter(t => !cutoffKey || t.closeKey >= cutoffKey)
    // Si hay datos del S&P, solo se usan trades que tengan precio de referencia (en ambas líneas)
    const usable = hasSp ? inPeriod.filter(t => t.bench !== null) : inPeriod
    const skipped = inPeriod.length - usable.length

    let equity = 0, peak = 0, bench = 0
    const drawdown: any[] = []
    const vs: any[] = []
    usable.forEach(t => {
      equity += t.pnl
      if (equity > peak) peak = equity
      bench += t.bench ?? 0
      const label = new Date(t.closeKey + 'T00:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: '2-digit' })
      drawdown.push({ date: label, drawdown: r2(equity - peak) })
      vs.push({ date: label, Portafolio: r2(equity), 'S&P 500': hasSp ? r2(bench) : null })
    })
    return { drawdown, vs, skipped }
  }, [rows, equityPeriod, hasSp])

  // ── Rendimiento por período vs S&P (mismo capital y mismas fechas) ────────
  const periodRows = useMemo(() => {
    const now = new Date()
    const periods = [
      { label: '1 mes', months: 1 }, { label: '3 meses', months: 3 }, { label: '6 meses', months: 6 },
      { label: '1 año', months: 12 }, { label: '3 años', months: 36 }, { label: '5 años', months: 60 },
    ]
    return periods.map(p => {
      const cutoff = localDayKey(new Date(now.getFullYear(), now.getMonth() - p.months, now.getDate()))
      const set = portRows.filter(t => t.closeKey >= cutoff && (!hasSp || t.bench !== null))
      const inv = set.reduce((a, t) => a + t.invested, 0)
      const pnl = set.reduce((a, t) => a + t.pnl, 0)
      const bench = set.reduce((a, t) => a + (t.bench ?? 0), 0)
      const portRend = inv > 0 ? r2((pnl / inv) * 100) : null
      const sp500Rend = hasSp && inv > 0 ? r2((bench / inv) * 100) : null
      const diff = portRend !== null && sp500Rend !== null ? r2(portRend - sp500Rend) : null
      return { label: p.label, portRend, sp500Rend, diff }
    }).reverse()
  }, [portRows, hasSp])

  const fmtMoney = (v: number) => money(v)
  // En modo privado el eje de importes se oculta
  const axisMoney = (v: number) => !visible ? '' : Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v}`

  const periodSelector = (
    <div style={{ display: 'flex', gap: 2, background: '#050505', padding: 3, borderRadius: 8, border: '1px solid #111' }}>
      {(['YTD', '1Y', '5Y', 'MAX'] as const).map(p => (
        <button key={p} onClick={() => setEquityPeriod(p)} style={{
          background: equityPeriod === p ? '#1a1a1a' : 'transparent',
          border: equityPeriod === p ? '1px solid #2a2a2a' : '1px solid transparent',
          color: equityPeriod === p ? '#fff' : '#666',
          padding: isMobile ? '7px 12px' : '4px 10px', borderRadius: 6, cursor: 'pointer',
          fontSize: isMobile ? 12 : 11, fontWeight: equityPeriod === p ? 700 : 400,
        }}>{p}</button>
      ))}
    </div>
  )

  if (loading) return (
    <AppShell>
      <div style={{ padding: 40, color: '#888', display: 'flex', alignItems: 'center', gap: 10 }}>
        <Paw size={16} color="#888" opacity={0.5} /> Cargando análisis...
      </div>
    </AppShell>
  )

  const benchNote = curves.skipped > 0 ? ` · ${curves.skipped} trade(s) sin precio del S&P omitidos` : ''

  // Rejillas que cambian en el celular (en escritorio quedan como antes)
  const grid = (mobileCols: number, desktop: string, gap = 14): React.CSSProperties => ({
    display: 'grid',
    gridTemplateColumns: isMobile ? `repeat(${mobileCols}, minmax(0, 1fr))` : desktop,
    gap: isMobile ? 10 : gap,
  })
  const boxM: React.CSSProperties = isMobile ? { padding: '14px 14px', minWidth: 0 } : {}
  const full: React.CSSProperties = isMobile ? { gridColumn: '1 / -1' } : {}
  const cellPad = isMobile ? '9px 6px' : '10px 14px'

  return (
    <AppShell>
      <div style={{ maxWidth: 1400, margin: isMobile ? '10px auto' : '20px auto', padding: isMobile ? '0 2px' : '0 28px', color: 'white', position: 'relative' }}>

        {/* ── Gatos decorativos ── */}
        {!isMobile && (
          <>
            <div style={{ position: 'absolute', top: -4, right: 50, pointerEvents: 'none' }}>
              <CatEars color="#00bfff" opacity={0.14} size={46} />
            </div>
            <div style={{ position: 'absolute', right: -8, top: '20%', pointerEvents: 'none' }}>
              <CatTail color="#22c55e" opacity={0.09} />
            </div>
            <div style={{ position: 'absolute', left: 0, top: '60%', pointerEvents: 'none' }}>
              <CatSitting size={70} color="#00bfff" opacity={0.05} />
            </div>
          </>
        )}

        {/* ── HEADER ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: isMobile ? 14 : 22 }}>
          <Paw size={22} color="#22c55e" opacity={0.7} />
          {!isMobile && <Paw size={16} color="#22c55e" opacity={0.4} />}
          {!isMobile && <Paw size={10} color="#22c55e" opacity={0.2} />}
          <TrendingUp size={20} color="#00bfff" />
          <h1 style={{ fontSize: isMobile ? 16 : 18, fontWeight: 900, margin: 0 }}>{isMobile ? 'Performance · cerrados' : 'Performance histórico — trades cerrados'}</h1>
        </div>

        {loadError && (
          <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 10, fontSize: 12, background: 'rgba(244,63,94,0.06)', border: '1px solid rgba(244,63,94,0.25)', color: C.loss }}>
            No se pudieron cargar los datos ({loadError}). Recarga la página.
          </div>
        )}

        {/* ── FILTROS ── */}
        <div style={{ display: 'flex', gap: 8, marginBottom: isMobile ? 16 : 26, flexWrap: isMobile ? 'nowrap' : 'wrap', overflowX: isMobile ? 'auto' : 'visible', alignItems: 'center', borderBottom: '1px solid #1a1a1a', paddingBottom: 14 }}>
          <select value={selectedYear} onChange={e => setSelectedYear(e.target.value)}
            style={{ ...selectStyle, ...(isMobile ? { padding: '9px 10px', fontSize: 12, flexShrink: 0 } : {}) }}>
            <option value="all">Todos los años</option>
            {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          {[{ id: 'all', name: 'Todos' }, ...portfolios].map(p => (
            <button key={p.id} onClick={() => setSelectedPortfolio(p.id)}
              style={{ ...filterBtn(selectedPortfolio === p.id), ...(isMobile ? { padding: '9px 14px', fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 } : {}) }}>
              {p.name}
            </button>
          ))}
        </div>

        {!stats ? (
          <div style={{ textAlign: 'center', padding: isMobile ? 40 : 80, color: '#666', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <CatSitting size={60} color="#444" opacity={0.4} />
            <Paw size={24} color="#333" opacity={0.5} />
            <span>No hay trades cerrados para este filtro.</span>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: isMobile ? 12 : 14 }}>

            {/* ── F1: KPIs principales ── */}
            <div style={grid(2, 'repeat(7, 1fr)', 12)}>
              <StatCard
                label="PnL total acumulado / %"
                value={`${money(stats.totalPnL)} / ${stats.totalPnLPct.toFixed(1)}%`}
                color={stats.totalPnL > 0 ? '#22c55e' : stats.totalPnL < 0 ? '#f43f5e' : '#00bfff'}
                pawColor={stats.totalPnL > 0 ? '#22c55e' : stats.totalPnL < 0 ? '#f43f5e' : '#00bfff'}
                wide
              />
              <StatCard label="Win rate" value={`${stats.winRate}%`}
                desc={`${stats.winsCount} ganados · ${stats.lossesCount} perdidos${stats.breakEvenCount ? ` · ${stats.breakEvenCount} BE` : ''}`}
                color="#fff" bar={stats.winRate} pawColor="#fff" />
              <StatCard label="Profit factor" value={stats.profitFactor === null ? '∞' : String(stats.profitFactor)}
                desc={stats.profitFactor === null ? 'Sin pérdidas' : stats.profitFactor >= 1.5 ? 'Sistema rentable' : stats.profitFactor >= 1 ? 'Marginalmente rentable' : 'Sistema con pérdidas'}
                color={stats.profitFactor === null || stats.profitFactor >= 1.5 ? '#22c55e' : stats.profitFactor >= 1 ? '#eab308' : '#f43f5e'}
                pawColor="#eab308" />
              <StatCard label="Expectativa por trade" value={money(stats.expectancy)}
                desc={stats.expectancy >= 0 ? `Ganas en promedio ${money(Math.abs(stats.expectancy))} por operación` : `Pierdes en promedio ${money(Math.abs(stats.expectancy))} por operación`}
                color={stats.expectancy >= 0 ? '#00bfff' : '#f43f5e'} pawColor="#00bfff" />
              <StatCard label="Rendimiento % promedio / trade" value={`${stats.avgReturnPct}%`}
                desc="Por trade vs capital invertido"
                color={stats.avgReturnPct >= 0 ? '#22c55e' : '#f43f5e'} pawColor="#a78bfa" />
              <StatCard
                label="Recovery Factor"
                value={stats.recoveryFactor !== null ? String(stats.recoveryFactor) : '—'}
                desc={
                  stats.recoveryFactor !== null
                    ? stats.recoveryFactor >= 5 ? 'Excelente recuperación'
                    : stats.recoveryFactor >= 3 ? 'Muy buena recuperación'
                    : stats.recoveryFactor >= 2 ? 'Buena recuperación'
                    : stats.recoveryFactor >= 1 ? 'Recuperación aceptable'
                    : 'Recuperación deficiente'
                    : 'Sin drawdown registrado'
                }
                color={stats.recoveryFactor !== null ? (stats.recoveryFactor >= 2 ? '#22c55e' : stats.recoveryFactor >= 1 ? '#eab308' : '#f43f5e') : '#888'}
                pawColor="#a78bfa"
              />
              <StatCard label="Duración promedio" value={`${stats.avgDuration} días`}
                desc="En cerrar una posición" color="#888" pawColor="#888" />
            </div>

            {/* ── F2: Eficiencia + Drawdown máx + Rachas ── */}
            <div style={grid(2, 'repeat(6, 1fr)', 12)}>

              <div style={{ ...box, ...boxM, position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', bottom: -8, right: -8, pointerEvents: 'none' }}>
                  <Paw size={56} color="#00bfff" opacity={0.04} />
                </div>
                <div style={boxTitle}>
                  <Paw size={10} color="#00bfff" opacity={0.7} style={{ marginRight: 6 }} />
                  Eficiencia de trade
                </div>
                <Row label="Ganancia promedio"  value={money(stats.avgWin)}  color="#22c55e" />
                <Row label="Pérdida promedio"   value={money(stats.avgLoss)} color="#f43f5e" />
                <Row label="Ratio Win/Loss"     value={`${stats.winLossRatio}x`}
                  color={stats.winLossRatio >= 1 ? '#22c55e' : '#f43f5e'} />
                <div style={{ marginTop: 10, fontSize: 9, color: '#888' }}>
                  {stats.winLossRatio >= 1 ? 'Ganas más de lo que pierdes' : 'Pierdes más de lo que ganas'}
                </div>
              </div>

              <div style={{ ...box, ...boxM, position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', bottom: -8, right: -8, pointerEvents: 'none' }}>
                  <Paw size={56} color="#f43f5e" opacity={0.04} />
                </div>
                <div style={boxTitle}>
                  <Paw size={10} color="#f43f5e" opacity={0.7} style={{ marginRight: 6 }} />
                  Drawdown máximo
                </div>
                <div style={{ fontSize: 22, fontWeight: 900, color: '#f43f5e' }}>{money(stats.maxDD)}</div>
                <div style={{ fontSize: 10, color: '#888', marginTop: 4 }}>Caída máxima desde el pico de equity</div>
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 9, color: '#888', fontWeight: 700, textTransform: 'uppercase' as const, marginBottom: 4, letterSpacing: 0.5 }}>
                    Mejor trade (%)
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#22c55e' }}>
                    {stats.bestTradePct.ticker} · {stats.bestTradePct.pct >= 0 ? '+' : ''}{stats.bestTradePct.pct.toFixed(1)}%
                  </div>
                  <div style={{ fontSize: 9, color: '#888', fontWeight: 700, textTransform: 'uppercase' as const, marginBottom: 4, marginTop: 8, letterSpacing: 0.5 }}>
                    Peor trade (%)
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#f43f5e' }}>
                    {stats.worstTradePct.ticker} · {stats.worstTradePct.pct.toFixed(1)}%
                  </div>
                </div>
              </div>

              <div style={{ ...box, ...boxM, borderColor: 'rgba(34,197,94,0.2)', position: 'relative', overflow: 'hidden' }}>
                {!isMobile && (
                  <div style={{ position: 'absolute', top: 8, right: 8, pointerEvents: 'none' }}>
                    <Whiskers color="#22c55e" opacity={0.12} width={70} />
                  </div>
                )}
                <div style={{ ...boxTitle, color: '#22c55e' }}>
                  <Paw size={10} color="#22c55e" opacity={0.7} style={{ marginRight: 6 }} />
                  Racha ganadora máx.
                </div>
                <div style={{ fontSize: 36, fontWeight: 900, color: '#22c55e' }}>{stats.maxWinStrk}</div>
                <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>trades ganados consecutivos</div>
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 9, color: '#888', fontWeight: 700, textTransform: 'uppercase' as const, marginBottom: 4, letterSpacing: 0.5 }}>Mejor mes</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#22c55e', textTransform: 'capitalize' as const }}>{stats.bestMonth.month}</div>
                  <div style={{ fontSize: 13, color: '#22c55e' }}>{money(stats.bestMonth.pnl)}</div>
                </div>
              </div>

              <div style={{ ...box, ...boxM, borderColor: 'rgba(244,63,94,0.2)', position: 'relative', overflow: 'hidden' }}>
                {!isMobile && (
                  <div style={{ position: 'absolute', top: 8, right: 8, pointerEvents: 'none' }}>
                    <Whiskers color="#f43f5e" opacity={0.12} width={70} />
                  </div>
                )}
                <div style={{ ...boxTitle, color: '#f43f5e' }}>
                  <Paw size={10} color="#f43f5e" opacity={0.7} style={{ marginRight: 6 }} />
                  Racha perdedora máx.
                </div>
                <div style={{ fontSize: 36, fontWeight: 900, color: '#f43f5e' }}>{stats.maxLossStrk}</div>
                <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>trades perdidos consecutivos</div>
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 9, color: '#888', fontWeight: 700, textTransform: 'uppercase' as const, marginBottom: 4, letterSpacing: 0.5 }}>Peor mes</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#f43f5e', textTransform: 'capitalize' as const }}>{stats.worstMonth.month}</div>
                  <div style={{ fontSize: 13, color: '#f43f5e' }}>{money(stats.worstMonth.pnl)}</div>
                </div>
              </div>

              <div style={{ ...box, ...boxM, ...full, borderColor: 'rgba(34,197,94,0.18)', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', bottom: -8, right: -8, pointerEvents: 'none' }}>
                  <Paw size={56} color="#22c55e" opacity={0.04} />
                </div>
                <div style={{ ...boxTitle, color: '#22c55e' }}>
                  <Paw size={10} color="#22c55e" opacity={0.7} style={{ marginRight: 6 }} />
                  Mejores cierres
                </div>
                {stats.topWinners.length === 0 && <div style={{ color: '#555', fontSize: 11 }}>Sin ganadores</div>}
                {stats.topWinners.map((t, i) => (
                  <div key={t.id} style={listRow}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {i === 0 && <Paw size={9} color="#ffd700" opacity={0.8} />}
                      <span style={{ color: '#00bfff', fontWeight: 700 }}>{t.ticker}</span>
                    </span>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ color: '#22c55e', fontWeight: 700, fontSize: 12 }}>+{money(t.pnl)}</div>
                      {t.invested > 0 && (
                        <div style={{ color: '#22c55e', fontSize: 10, opacity: 0.8 }}>+{t.pct.toFixed(2)}%</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ ...box, ...boxM, ...full, borderColor: 'rgba(244,63,94,0.18)', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', bottom: -8, right: -8, pointerEvents: 'none' }}>
                  <Paw size={56} color="#f43f5e" opacity={0.04} />
                </div>
                <div style={{ ...boxTitle, color: '#f43f5e' }}>
                  <Paw size={10} color="#f43f5e" opacity={0.7} style={{ marginRight: 6 }} />
                  Peores cierres
                </div>
                {stats.topLosers.length === 0 && <div style={{ color: '#555', fontSize: 11 }}>Sin perdedores</div>}
                {stats.topLosers.map(t => (
                  <div key={t.id} style={listRow}>
                    <span style={{ color: '#00bfff', fontWeight: 700 }}>{t.ticker}</span>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ color: '#f43f5e', fontWeight: 700, fontSize: 12 }}>{money(t.pnl)}</div>
                      {t.invested > 0 && (
                        <div style={{ color: '#f43f5e', fontSize: 10, opacity: 0.8 }}>{t.pct.toFixed(2)}%</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── F3: Scatter días vs PnL % ── */}
            <ChartCard title="Scatter: días en posición vs PnL %" sub="Cada punto = un trade · izquierda = rápido · derecha = lento" mb={0}>
              <ResponsiveContainer width="100%" height={isMobile ? 220 : 240}>
                <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid stroke="#151515" strokeDasharray="3 3" />
                  <XAxis type="number" dataKey="days" name="Días" domain={[0, 'dataMax']} tick={{ fill: '#888', fontSize: 9 }}
                    axisLine={false} tickLine={false} tickFormatter={v => `${v}d`} />
                  <YAxis type="number" dataKey="pnlPct" name="PnL %" tick={{ fill: '#888', fontSize: 9 }}
                    axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} width={isMobile ? 38 : 44} />
                  <ZAxis range={[70, 70]} />
                  <ReferenceLine y={0} stroke="#333" strokeDasharray="4 4" />
                  <Tooltip cursor={{ stroke: '#333', strokeDasharray: '3 3' }} content={({ active, payload }: any) => {
                    if (!active || !payload?.length) return null
                    const d = payload[0].payload
                    return (
                      <div style={{ background: '#0a0a0a', border: '1px solid #333', borderRadius: 8, padding: '8px 12px', fontSize: 11 }}>
                        <div style={{ color: '#00bfff', fontWeight: 700, marginBottom: 3 }}>{d.ticker}</div>
                        <div style={{ color: '#aaa' }}>{d.days} días · <span style={{ color: d.color, fontWeight: 700 }}>{d.pnlPct >= 0 ? '+' : ''}{d.pnlPct}%</span></div>
                        <div style={{ color: d.color, fontWeight: 700 }}>{money(d.pnl)}</div>
                      </div>
                    )
                  }} />
                  <Scatter data={stats.scatterData}>
                    {stats.scatterData.map((d, i) => <Cell key={i} fill={d.color} fillOpacity={0.75} stroke={d.color} />)}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* ── F4: Sector + Duración + Win/Loss ── */}
            <div style={grid(1, '1fr 1fr 1fr')}>
              <ChartCard title="PnL por sector" sub="Suma de PnL realizado (verde = ganancia, rojo = pérdida)" mb={0}>
                <ResponsiveContainer width="100%" height={Math.max(190, Math.min(stats.sectorData.length * 30, 320))}>
                  <BarChart data={stats.sectorData} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
                    <CartesianGrid stroke="#151515" horizontal={false} strokeDasharray="3 3" />
                    <XAxis type="number" tick={{ fill: '#888', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={axisMoney} />
                    <YAxis type="category" dataKey="name" tick={{ fill: '#aaa', fontSize: 9 }} axisLine={false} tickLine={false} width={isMobile ? 70 : 80} />
                    <Tooltip content={<CatTooltip formatter={fmtMoney} />} />
                    <ReferenceLine x={0} stroke="#333" />
                    <Bar dataKey="value" name="PnL" radius={[0, 4, 4, 0]}>
                      {stats.sectorData.map((e, i) => <Cell key={i} fill={e.value >= 0 ? C.gain : C.loss} fillOpacity={0.8} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Duración de trades" sub="Histograma por rango de días en posición" mb={0}>
                <ResponsiveContainer width="100%" height={210}>
                  <BarChart data={stats.durationData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid stroke="#151515" vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="bucket" tick={{ fill: '#aaa', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#888', fontSize: 9 }} axisLine={false} tickLine={false} allowDecimals={false} width={isMobile ? 28 : 60} />
                    <Tooltip content={<CatTooltip formatter={(v: number) => `${v} trades`} />} />
                    <Bar dataKey="count" name="Trades" radius={[6,6,0,0]}>
                      {stats.durationData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} fillOpacity={0.8} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Win vs Loss" sub={`${stats.winsCount} ganados · ${stats.lossesCount} perdidos${stats.breakEvenCount ? ` · ${stats.breakEvenCount} BE` : ''}`} mb={0}>
                <ResponsiveContainer width="100%" height={190}>
                  <PieChart>
                    <Pie
                      data={[
                        { name: 'Ganados',  value: stats.winsCount,      color: C.gain },
                        { name: 'Perdidos', value: stats.lossesCount,    color: C.loss },
                        { name: 'BE',       value: stats.breakEvenCount, color: '#666' },
                      ].filter(d => d.value > 0)}
                      cx="50%" cy="50%" innerRadius={46} outerRadius={72}
                      paddingAngle={6} dataKey="value" startAngle={90} endAngle={-270}>
                      {[C.gain, C.loss, '#666'].map((c, i) => <Cell key={i} fill={c} stroke="none" />)}
                    </Pie>
                    <Tooltip content={<CatTooltip formatter={(v: number) => `${v} trades`} />} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginTop: 6 }}>
                  <span style={{ fontSize: 11, color: C.gain, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Paw size={10} color={C.gain} opacity={0.7} /> {stats.winsCount} ganados
                  </span>
                  <span style={{ fontSize: 11, color: C.loss, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Paw size={10} color={C.loss} opacity={0.7} /> {stats.lossesCount} perdidos
                  </span>
                </div>
              </ChartCard>
            </div>

            {/* ── F5: Drawdown + Portafolio vs S&P 500 + tabla por período ── */}
            <div style={grid(1, '1fr 1fr 1fr')}>
              <ChartCard title="Drawdown" sub="Caída en $ desde el pico del PnL acumulado del período" mb={0} extra={periodSelector}>
                <ResponsiveContainer width="100%" height={210}>
                  <AreaChart data={curves.drawdown} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <defs>
                      <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={C.loss} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={C.loss} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#151515" vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fill: '#aaa', fontSize: 9 }} axisLine={false} tickLine={false} minTickGap={isMobile ? 40 : 24} />
                    <YAxis tick={{ fill: '#888', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={axisMoney} width={isMobile ? 38 : 60} />
                    <Tooltip content={<CatTooltip formatter={fmtMoney} />} />
                    <ReferenceLine y={0} stroke="#333" />
                    <Area type="monotone" dataKey="drawdown" name="Drawdown" stroke={C.loss} fill="url(#ddGrad)" strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Portafolio vs S&P 500" sub={`PnL acumulado real vs. los mismos importes y fechas en el S&P 500${benchNote}`} mb={0} extra={periodSelector}>
                {!hasSp && <div style={{ fontSize: 9, color: C.warning, marginBottom: 6 }}>Sin datos del S&P 500 en caché — abre Inicio una vez para cargarlos</div>}
                <ResponsiveContainer width="100%" height={210}>
                  <LineChart data={curves.vs} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid stroke="#151515" vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fill: '#aaa', fontSize: 9 }} axisLine={false} tickLine={false} minTickGap={isMobile ? 40 : 24} />
                    <YAxis tick={{ fill: '#888', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={axisMoney} width={isMobile ? 38 : 60} />
                    <Tooltip content={<CatTooltip formatter={fmtMoney} />} />
                    <ReferenceLine y={0} stroke="#333" strokeDasharray="3 3" />
                    <Line type="monotone" dataKey="Portafolio" stroke={C.accent} strokeWidth={2.5} dot={false} />
                    <Line type="monotone" dataKey="S&P 500" stroke={C.sp500} strokeWidth={1.5} dot={false} strokeDasharray="5 5" connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Rendimiento por período vs S&P 500" sub="Trades cerrados en cada período (con la billetera elegida, sin filtro de año) vs. los mismos importes y fechas en el S&P 500" mb={0}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#050505' }}>
                      {(isMobile ? ['Período', 'Tú', 'S&P 500', 'Dif.'] : ['Período', 'Tu portafolio', 'S&P 500', 'Diferencia']).map((h, hi) => (
                        <th key={h} style={{
                          padding: isMobile ? '8px 6px' : '8px 14px', textAlign: hi === 0 ? 'left' : 'right',
                          color: '#555', fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
                          borderBottom: '1px solid #111'
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {periodRows.map(row => (
                      <tr key={row.label} style={{ borderBottom: '1px solid #0a0a0a' }}>
                        <td style={{ padding: cellPad, color: '#aaa', fontWeight: 600 }}>{row.label}</td>
                        <td style={{ padding: cellPad, textAlign: 'right', fontWeight: 700,
                          color: row.portRend === null ? '#333' : row.portRend >= 0 ? C.gain : C.loss }}>
                          {row.portRend === null ? '—' : `${row.portRend >= 0 ? '+' : ''}${row.portRend.toFixed(2)}%`}
                        </td>
                        <td style={{ padding: cellPad, textAlign: 'right', fontWeight: 700,
                          color: row.sp500Rend === null ? '#333' : row.sp500Rend >= 0 ? '#60a5fa' : C.loss }}>
                          {row.sp500Rend === null ? '—' : `${row.sp500Rend >= 0 ? '+' : ''}${row.sp500Rend.toFixed(2)}%`}
                        </td>
                        <td style={{ padding: cellPad, textAlign: 'right', fontWeight: 800, fontSize: 13,
                          color: row.diff === null ? '#333' : row.diff >= 0 ? C.gain : C.loss }}>
                          {row.diff === null ? '—' : (
                            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                              {row.diff >= 0 ? '▲' : '▼'} {Math.abs(row.diff).toFixed(2)}%
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ChartCard>
            </div>

            {/* ── F6: Razones de cierre + Resumen por mes ── */}
            <div style={grid(1, '0.5fr 1fr')}>

              <ChartCard title="PnL por razón de cierre" sub="Suma de PnL agrupado por cómo cerraste" mb={0}>
                <ResponsiveContainer width="100%" height={Math.max(200, Math.min(stats.closeReasonData.length * 34, 340))}>
                  <BarChart data={stats.closeReasonData} layout="vertical" margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid stroke="#151515" horizontal={false} strokeDasharray="3 3" />
                    <XAxis type="number" tick={{ fill: '#888', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={axisMoney} />
                    <YAxis type="category" dataKey="reason" tick={{ fill: '#aaa', fontSize: 9 }} axisLine={false} tickLine={false} width={isMobile ? 80 : 90} />
                    <Tooltip content={<CatTooltip formatter={(v: number) => fmtMoney(v)} />} />
                    <ReferenceLine x={0} stroke="#333" />
                    <Bar dataKey="pnl" name="PnL" radius={[0,4,4,0]}>
                      {stats.closeReasonData.map((e, i) => <Cell key={i} fill={e.pnl >= 0 ? C.gain : C.loss} fillOpacity={0.8} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Resumen por mes" sub="Mejores y peores meses ordenados por PnL" mb={0}>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : '1fr 1fr', gap: 14 }}>
                  {[
                    { title: 'MEJORES MESES', color: C.gain, list: stats.monthlyTable.filter(m => m.pnl >= 0).sort((a, b) => b.pnl - a.pnl).slice(0, 6) },
                    { title: 'PEORES MESES',  color: C.loss, list: stats.monthlyTable.filter(m => m.pnl < 0).sort((a, b) => a.pnl - b.pnl).slice(0, 6) },
                  ].map(block => (
                    <div key={block.title} style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 9, color: block.color, fontWeight: 700, letterSpacing: 0.5, marginBottom: 8 }}>{block.title}</div>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                        <thead>
                          <tr style={{ background: '#050505' }}>
                            {['Mes', 'PnL', 'Trades', 'Gan.', 'Perd.', 'WR%'].map(h => (
                              <th key={h} style={{ padding: isMobile ? '5px 4px' : '5px 8px', textAlign: h === 'Mes' ? 'left' : 'right', color: '#555', fontSize: 9, fontWeight: 700, borderBottom: '1px solid #111' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {block.list.map(m => (
                            <tr key={m.key} style={{ borderBottom: '1px solid #0a0a0a' }}>
                              <td style={{ padding: isMobile ? '5px 4px' : '5px 8px', color: '#aaa', textTransform: 'capitalize' }}>{m.month}</td>
                              <td style={{ padding: isMobile ? '5px 4px' : '5px 8px', textAlign: 'right', color: block.color, fontWeight: 700 }}>{fmtMoney(m.pnl)}</td>
                              <td style={{ padding: isMobile ? '5px 4px' : '5px 8px', textAlign: 'right', color: '#666' }}>{m.trades}</td>
                              <td style={{ padding: isMobile ? '5px 4px' : '5px 8px', textAlign: 'right', color: C.gain }}>{m.wins}</td>
                              <td style={{ padding: isMobile ? '5px 4px' : '5px 8px', textAlign: 'right', color: C.loss }}>{m.losses}</td>
                              <td style={{ padding: isMobile ? '5px 4px' : '5px 8px', textAlign: 'right', color: m.winRate >= 50 ? C.gain : C.loss, fontWeight: 700 }}>{m.winRate}%</td>
                            </tr>
                          ))}
                          {block.list.length === 0 && (
                            <tr><td colSpan={6} style={{ padding: '8px', color: '#555', fontSize: 10 }}>—</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              </ChartCard>
            </div>

            {/* ── F7: Acumulado mensual ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 14 }}>
              <ChartCard title="Acumulado mensual de PnL" sub="Cada barra flota entre el acumulado anterior y el nuevo — verde sube, rojo baja" mb={0}>
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={stats.monthlyWaterfall} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid stroke="#151515" vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="month" tick={{ fill: '#aaa', fontSize: 9 }} axisLine={false} tickLine={false} interval={isMobile ? 'preserveStartEnd' : 0} />
                    <YAxis tick={{ fill: '#888', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={axisMoney} width={isMobile ? 38 : 60} />
                    <Tooltip content={({ active, payload, label }: any) => {
                      if (!active || !payload?.length) return null
                      const d = payload[0].payload
                      return (
                        <div style={{ background: '#0a0a0a', border: '1px solid #333', borderRadius: 8, padding: '10px 14px', fontSize: 11 }}>
                          <div style={{ color: '#aaa', marginBottom: 6, fontWeight: 600, textTransform: 'capitalize' }}>{label}</div>
                          <div><span style={{ color: '#888' }}>PnL mes: </span><span style={{ color: d.value >= 0 ? C.gain : C.loss, fontWeight: 700 }}>{fmtMoney(d.value)}</span></div>
                          <div><span style={{ color: '#888' }}>Acumulado: </span><span style={{ color: C.accent, fontWeight: 700 }}>{fmtMoney(d.cumPnl)}</span></div>
                        </div>
                      )
                    }} />
                    <ReferenceLine y={0} stroke="#333" strokeDasharray="3 3" />
                    <Bar dataKey="range" name="PnL mes" radius={[3,3,3,3]}>
                      {stats.monthlyWaterfall.map((e, i) => <Cell key={i} fill={e.fill} fillOpacity={0.85} />)}
                    </Bar>
                    <Line type="monotone" dataKey="cumPnl" name="Acumulado" stroke={C.accent} strokeWidth={2} dot={{ fill: C.accent, r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

          </div>
        )}
      </div>
    </AppShell>
  )
}

function StatCard({ label, value, desc, color = 'white', bar, pawColor = '#666', wide }: any) {
  const isMobile = useIsMobile()
  return (
    <div style={{ background: '#080808', border: '1px solid #1a1a1a', padding: isMobile ? '12px 12px' : '16px 18px', borderRadius: 10, position: 'relative', overflow: 'hidden', minWidth: 0, ...(isMobile && wide ? { gridColumn: '1 / -1' } : {}) }}>
      <div style={{ position: 'absolute', bottom: -10, right: -10, pointerEvents: 'none' }}>
        <Paw size={50} color={pawColor} opacity={0.04} />
      </div>
      <div style={{ fontSize: 9, color: '#888', marginBottom: 8, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 5 }}>
        <Paw size={9} color={pawColor} opacity={0.5} />
        {label}
      </div>
      <div style={{ fontSize: isMobile ? 18 : 21, fontWeight: 900, color }}>{value}</div>
      {desc && <div style={{ fontSize: 10, color: '#888', marginTop: 5 }}>{desc}</div>}
      {bar !== undefined && (
        <div style={{ height: 3, background: '#111', borderRadius: 2, marginTop: 10 }}>
          <div style={{ height: '100%', width: `${Math.min(bar, 100)}%`, background: bar >= 50 ? '#22c55e' : '#f43f5e', borderRadius: 2 }} />
        </div>
      )}
    </div>
  )
}

function Row({ label, value, color = '#ccc' }: any) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0', borderBottom: '1px solid #111', fontSize: 11 }}>
      <span style={{ color: '#aaa' }}>{label}</span>
      <span style={{ fontWeight: 700, color }}>{value}</span>
    </div>
  )
}

function ChartCard({ title, sub, children, mb = 14, extra }: any) {
  const isMobile = useIsMobile()
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: isMobile ? '14px 12px' : '18px 20px', marginBottom: mb, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 14, gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: '#888', letterSpacing: 0.8, textTransform: 'uppercase' as const, display: 'flex', alignItems: 'center', gap: 7 }}>
            <Paw size={10} color="#666" opacity={0.5} />
            {title}
          </div>
          {sub && <div style={{ fontSize: 9, color: '#555', marginTop: 3 }}>{sub}</div>}
        </div>
        {extra && <div>{extra}</div>}
      </div>
      {children}
    </div>
  )
}

const filterBtn = (active: boolean): React.CSSProperties => ({
  padding: '6px 14px', borderRadius: 6, border: 'none',
  background: active ? '#00bfff' : '#111',
  color: active ? '#000' : '#aaa',
  cursor: 'pointer', fontSize: 10, fontWeight: 'bold',
})
const selectStyle: React.CSSProperties = { background: '#080808', color: '#ccc', border: '1px solid #222', padding: '6px 10px', borderRadius: 6, fontSize: 11, outline: 'none' }
const box: React.CSSProperties      = { background: '#080808', border: '1px solid #1a1a1a', padding: '16px 18px', borderRadius: 10 }
const boxTitle: React.CSSProperties = { fontSize: 9, color: '#888', marginBottom: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', display: 'flex', alignItems: 'center' }
const listRow: React.CSSProperties  = { display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #0f0f0f', fontSize: 11, alignItems: 'center' }