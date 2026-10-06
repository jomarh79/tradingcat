'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { usePrivacy } from '@/lib/PrivacyContext'
import AppShell from './AppShell'
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine,
} from 'recharts'

// ── Fechas ───────────────────────────────────────────────────────────────────
// 'yyyy-MM-dd[...]' → medianoche LOCAL. Inválida → NaN
const dayMs = (d: any): number => Date.parse(String(d || '').split('T')[0].split(' ')[0] + 'T00:00:00')
const parseDate = (d: any): Date => new Date(dayMs(d))

const PORT_COLORS = ['#00bfff', '#a78bfa', '#34d399', '#fb923c', '#f472b6']
const SECTOR_COLORS = ['#00bfff', '#a78bfa', '#34d399', '#fb923c', '#f472b6', '#eab308', '#22c55e', '#f43f5e']
const GREEN = '#22c55e'
const RED = '#f43f5e'

type Period = 'YTD' | '1Y' | '5Y' | 'MAX'
const PERIODS: Period[] = ['YTD', '1Y', '5Y', 'MAX']

const getMondayOfWeek = (d: Date): Date => {
  const date = new Date(d)
  const diff = date.getDay() === 0 ? -6 : 1 - date.getDay()
  date.setDate(date.getDate() + diff)
  date.setHours(0, 0, 0, 0)
  return date
}

const periodCutoff = (p: Period): number => {
  const now = new Date()
  if (p === 'YTD') return new Date(now.getFullYear(), 0, 1).getTime()
  if (p === '1Y')  return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).getTime()
  if (p === '5Y')  return new Date(now.getFullYear() - 5, now.getMonth(), now.getDate()).getTime()
  return new Date(2000, 0, 1).getTime()
}

const r2 = (n: number) => parseFloat(n.toFixed(2))
const pnlColor = (n: number) => (n >= 0 ? GREEN : RED)

// ── Datos ────────────────────────────────────────────────────────────────────
// Supabase devuelve como máximo 1000 filas por consulta (aunque pongas .limit(5000)). Antes los movimientos
// se cortaban en 1000, y con ellos el total depositado y la gráfica comparativa. Aquí se pide por páginas.
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

// ── S&P 500 (SPY) ────────────────────────────────────────────────────────────
type SpPoint = { t: number; close: number }
const SP_CACHE_KEY = 'sp500'
const SP_TTL_MS = 12 * 60 * 60 * 1000 // el plan gratuito de TwelveData tiene pocos créditos al día

function readSpCache(): { ts: number; rows: SpPoint[] } | null {
  try {
    const raw = JSON.parse(localStorage.getItem(SP_CACHE_KEY) || 'null')
    const list = Array.isArray(raw) ? raw : raw?.rows // formato anterior: solo el arreglo (se considera vencido)
    if (!Array.isArray(list)) return null
    const rows = list
      .map((d: any) => ({ t: dayMs(d.date), close: Number(d.close) }))
      .filter((d: SpPoint) => Number.isFinite(d.t) && d.close > 0)
    return { ts: Array.isArray(raw) ? 0 : Number(raw?.ts) || 0, rows }
  } catch {
    return null
  }
}

// Índice del último elemento con t <= x (arreglo ascendente); -1 si no hay
function lastOnOrBefore(arr: SpPoint[], x: number): number {
  let lo = 0, hi = arr.length - 1, ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid].t <= x) { ans = mid; lo = mid + 1 } else hi = mid - 1
  }
  return ans
}

// ═══════════════════════════════════════════════════════════════════════════
//  CAT SVG COMPONENTS — máximo temático
// ═══════════════════════════════════════════════════════════════════════════

const Paw = ({ size = 16, color = '#00bfff', opacity = 1, rotate = 0 }: any) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color}
    style={{ opacity, transform: `rotate(${rotate}deg)`, flexShrink: 0 }}>
    <ellipse cx="6"  cy="5"  rx="2.5" ry="3"/>
    <ellipse cx="11" cy="3"  rx="2.5" ry="3"/>
    <ellipse cx="16" cy="4"  rx="2.5" ry="3"/>
    <ellipse cx="19" cy="9"  rx="2"   ry="2.5"/>
    <path d="M12 22c-5 0-8-3-8-7 0-2.5 1.5-4.5 4-5.5 1-.4 2-.6 4-.6s3 .2 4 .6c2.5 1 4 3 4 5.5 0 4-3 7-8 7z"/>
  </svg>
)

// Gato completo sentado con detalles
const CatFull = ({ size = 80, color = '#00bfff', opacity = 0.08 }: any) => (
  <svg width={size} height={size * 1.35} viewBox="0 0 60 81" fill={color} style={{ opacity }}>
    {/* orejas */}
    <polygon points="8,22 15,4 24,22"/>
    <polygon points="36,22 45,4 52,22"/>
    {/* cabeza */}
    <ellipse cx="30" cy="30" rx="17" ry="15"/>
    {/* nariz */}
    <ellipse cx="30" cy="33" rx="2" ry="1.5" fill="white" opacity="0.3"/>
    {/* bigotes izq */}
    <line x1="5" y1="30" x2="22" y2="32" stroke="white" strokeWidth="0.8" opacity="0.2"/>
    <line x1="5" y1="34" x2="22" y2="34" stroke="white" strokeWidth="0.8" opacity="0.2"/>
    {/* bigotes der */}
    <line x1="55" y1="30" x2="38" y2="32" stroke="white" strokeWidth="0.8" opacity="0.2"/>
    <line x1="55" y1="34" x2="38" y2="34" stroke="white" strokeWidth="0.8" opacity="0.2"/>
    {/* cuerpo */}
    <ellipse cx="30" cy="58" rx="16" ry="18"/>
    {/* cola */}
    <path d="M46 68 Q58 55 54 42 Q50 32 46 38" fill="none" stroke={color} strokeWidth="3.5" strokeLinecap="round"/>
    {/* patas delanteras */}
    <ellipse cx="20" cy="74" rx="5" ry="3"/>
    <ellipse cx="40" cy="74" rx="5" ry="3"/>
  </svg>
)

// Orejas de gato (para header)
const CatEars = ({ color = '#00bfff', opacity = 0.12, size = 44 }: any) => (
  <svg width={size * 1.6} height={size} viewBox="0 0 70 44" fill={color} style={{ opacity }}>
    <polygon points="0,44 14,0 28,44"/>
    <polygon points="42,44 56,0 70,44"/>
  </svg>
)

// Cola de gato (lateral)
const CatTail = ({ color = '#00bfff', opacity = 0.08, height = 90 }: any) => (
  <svg width={50} height={height} viewBox="0 0 50 90" fill="none"
    stroke={color} strokeWidth="3.5" strokeLinecap="round" style={{ opacity }}>
    <path d="M42 90 Q48 60 22 48 Q0 36 12 12 Q22 -4 40 6"/>
  </svg>
)

// Bigotes horizontales
const Whiskers = ({ color = '#888', opacity = 0.12, width = 100 }: any) => (
  <svg width={width} height={36} viewBox={`0 0 ${width} 36`}
    stroke={color} strokeWidth="1.5" style={{ opacity }}>
    <line x1="0" y1="8"  x2={width * 0.42} y2="18"/>
    <line x1="0" y1="18" x2={width * 0.42} y2="18"/>
    <line x1="0" y1="28" x2={width * 0.42} y2="18"/>
    <line x1={width} y1="8"  x2={width * 0.58} y2="18"/>
    <line x1={width} y1="18" x2={width * 0.58} y2="18"/>
    <line x1={width} y1="28" x2={width * 0.58} y2="18"/>
  </svg>
)

// Rastro de huellas diagonal
const PawTrail = ({ color = '#00bfff', opacity = 0.06, count = 4, size = 14, gap = 26 }: any) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap, transform: 'rotate(-15deg)', pointerEvents: 'none' }}>
    {Array.from({ length: count }).map((_, i) => (
      <Paw key={i} size={size - i * 1.5} color={color} opacity={opacity - i * 0.01} rotate={i * 5} />
    ))}
  </div>
)

// Selector de período (reutilizable)
const PeriodSelector = ({ period, onChange }: { period: Period; onChange: (p: Period) => void }) => (
  <div style={{ display: 'flex', gap: 2, background: '#050505', padding: 3, borderRadius: 8, border: '1px solid #111' }}>
    {PERIODS.map(p => (
      <button key={p} onClick={() => onChange(p)} style={{
        background:    period === p ? '#1a1a1a' : 'transparent',
        border:        period === p ? '1px solid #2a2a2a' : '1px solid transparent',
        color:         period === p ? '#fff' : '#444',
        padding:       '4px 10px', borderRadius: 6, cursor: 'pointer',
        fontSize: 11, fontWeight: period === p ? 700 : 400,
        transition: 'all 0.15s', letterSpacing: 0.3,
      }}>
        {p}
      </button>
    ))}
  </div>
)

// ── Tarjetas reutilizables ───────────────────────────────────────────────────

// Top ganancias / top pérdidas (eran dos bloques casi idénticos)
function RankCard({ title, color, rows, emptyMsg }: {
  title: string; color: string; rows: { id: any; ticker: string; pnlPct: number }[]; emptyMsg: string
}) {
  return (
    <div style={{ ...card, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <Paw size={10} color={color} opacity={0.7} />
        <span style={cardLabel}>{title}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map(t => (
          <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#00bfff' }}>{t.ticker}</span>
            <span style={{ fontSize: 13, fontWeight: 800, color }}>
              {t.pnlPct >= 0 ? '+' : ''}{t.pnlPct.toFixed(2)}%
            </span>
          </div>
        ))}
        {rows.length === 0 && <span style={{ fontSize: 10, color: '#333' }}>{emptyMsg}</span>}
      </div>
    </div>
  )
}

// Resumen del mes / del año (eran dos bloques casi idénticos)
function SummaryCard({ title, subtitle, accent, cells, closedCount, wins, winRate, pnl, invested, prevLabel, prevPnl, money }: {
  title: string; subtitle: string; accent: string
  cells: { label: string; value: string | number; color: string }[]
  closedCount: number; wins: number; winRate: number; pnl: number; invested: number
  prevLabel: string; prevPnl: number; money: (v: number) => string
}) {
  const box: React.CSSProperties = { background: '#050505', borderRadius: 8, padding: '10px 12px', border: '1px solid #111' }
  const boxLabel: React.CSSProperties = { fontSize: 8, color: '#444', fontWeight: 700, letterSpacing: 0.5, marginBottom: 6 }
  return (
    <div style={{ ...card, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', bottom: -10, right: -8, pointerEvents: 'none' }}>
        <CatFull size={60} color={accent} opacity={0.04} />
      </div>
      <div style={{ ...cardHeader, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Paw size={11} color={accent} opacity={0.6} />
          <span style={cardLabel}>{title}</span>
        </div>
        <span style={{ fontSize: 9, color: '#444' }}>{subtitle}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        {cells.map(k => (
          <div key={k.label} style={box}>
            <div style={{ ...boxLabel, marginBottom: 5 }}>{k.label.toUpperCase()}</div>
            <div style={{ fontSize: 16, fontWeight: 900, color: k.color }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* rendimiento real */}
      <div style={{ ...box, marginBottom: 10 }}>
        <div style={boxLabel}>RENDIMIENTO REAL</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#666' }}>
            {closedCount} trades · {wins} ganadores {winRate}%
          </span>
          <span style={{ fontSize: 13, fontWeight: 800, color: pnlColor(pnl) }}>
            {invested > 0 ? `${((pnl / invested) * 100).toFixed(2)}%` : '—'}
          </span>
        </div>
      </div>

      {/* vs período anterior */}
      <div style={box}>
        <div style={boxLabel}>{prevLabel.toUpperCase()}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#666' }}>{prevLabel.replace('VS ', '').replace(/^./, c => c.toUpperCase())}: {money(prevPnl)}</span>
          {prevPnl !== 0 ? (
            <span style={{ fontSize: 11, fontWeight: 700, color: pnl >= prevPnl ? GREEN : RED }}>
              {pnl >= prevPnl ? '▲' : '▼'}{' '}
              {Math.abs(((pnl - prevPnl) / Math.abs(prevPnl)) * 100).toFixed(1)}%
            </span>
          ) : (
            <span style={{ fontSize: 11, color: '#444' }}>Sin datos</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════

export default function HomePage() {
  const { money, visible } = usePrivacy()

  const [allTrades,  setAllTrades]  = useState<any[]>([])
  const [portfolios, setPortfolios] = useState<any[]>([])
  const [movements,  setMovements]  = useState<any[]>([])
  const [loading,    setLoading]    = useState(true)
  const [loadError,  setLoadError]  = useState('')
  const [period,     setPeriod]     = useState<Period>('YTD')
  const [equityPeriod, setEquityPeriod] = useState<Period>('YTD')
  const [sp500Data, setSp500Data] = useState<SpPoint[]>([])

  // Carga de datos de la cuenta. Con bandera de cancelación: si sales de la página a mitad de la carga,
  // no se actualiza un componente ya desmontado.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [t, p, m] = await Promise.all([
          fetchAll(() => supabase.from('trades').select('*, trade_executions(quantity, price, commission, execution_type)').order('id')),
          fetchAll(() => supabase.from('portfolios').select('*').order('id')),
          fetchAll(() => supabase.from('wallet_movements').select('id, amount, date, wallet_id, is_dividend, movement_type').order('date').order('id')),
        ])
        if (cancelled) return
        setAllTrades(t); setPortfolios(p); setMovements(m)
      } catch (e: any) {
        // Antes un error de Supabase se ignoraba y la página mostraba todo en ceros como si no hubiera datos
        if (!cancelled) setLoadError(e?.message || 'No se pudieron cargar los datos')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // S&P 500: primero la caché; solo se vuelve a pedir si tiene más de 12 horas (antes, 5000 velas en cada visita)
  useEffect(() => {
    let cancelled = false
    const cached = readSpCache()
    if (cached?.rows.length) setSp500Data(cached.rows)
    if (cached && cached.rows.length && Date.now() - cached.ts < SP_TTL_MS) return

    const apiKey = process.env.NEXT_PUBLIC_TWELVEDATA_API_KEY
    if (!apiKey) { console.error('Falta NEXT_PUBLIC_TWELVEDATA_API_KEY'); return }

    ;(async () => {
      try {
        const res = await fetch(
          `https://api.twelvedata.com/time_series?symbol=SPY&interval=1day&outputsize=5000&apikey=${apiKey}`,
          { signal: AbortSignal.timeout(15_000) }
        )
        const json = await res.json()
        if (!Array.isArray(json?.values)) { console.error('Error SP500:', json); return }

        const rows: SpPoint[] = json.values
          .map((d: any) => ({ t: dayMs(d.datetime), close: Number(d.close) }))
          .filter((d: SpPoint) => Number.isFinite(d.t) && d.close > 0)
          .sort((a: SpPoint, b: SpPoint) => a.t - b.t)
        if (!rows.length || cancelled) return

        setSp500Data(rows)
        try {
          localStorage.setItem(SP_CACHE_KEY, JSON.stringify({
            ts: Date.now(),
            rows: rows.map(r => ({ date: new Date(r.t).toLocaleDateString('sv-SE'), close: r.close })),
          }))
        } catch { /* almacenamiento lleno o bloqueado: solo se pierde la caché */ }
      } catch (e) {
        console.error('Error SP500 fetch:', e) // se queda con la caché que ya se cargó
      }
    })()
    return () => { cancelled = true }
  }, [])

  // ── Posiciones abiertas con su rendimiento (una sola vez; antes se recalculaba en cinco sitios) ──
  const openPositions = useMemo(() =>
    allTrades.filter(t => t.status === 'open').map(t => {
      const qty = Number(t.quantity || 0)
      const inv = Number(t.total_invested || 0)
      const cur = Number(t.last_price || t.entry_price || 0)
      const avg = inv > 0 && qty > 0 ? inv / qty : Number(t.entry_price || 0)
      return {
        ...t,
        inv,
        pnlAmt: (cur - avg) * qty,
        pnlPct: avg > 0 ? ((cur - avg) / avg) * 100 : 0,
      }
    })
  , [allTrades])

  // Dividendos: salen de los mismos movimientos (antes era una segunda consulta paginada a la misma tabla)
  const dividends = useMemo(
    () => movements.filter(m => m.is_dividend === true || m.movement_type === 'dividend'),
    [movements]
  )

  // ── Stats globales ────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const now = new Date()
    const closed = allTrades.filter(t => t.status === 'closed')
    const closedAt = (t: any) => parseDate(t.close_date || t.open_date)
    const sumPnl = (list: any[]) => r2(list.reduce((a, t) => a + Number(t.realized_pnl || 0), 0))
    const winsOf = (list: any[]) => list.filter(t => Number(t.realized_pnl) > 0).length
    const rate = (w: number, n: number) => (n ? parseFloat(((w / n) * 100).toFixed(1)) : 0)
    const sumAmt = (list: any[]) => r2(list.reduce((a, m) => a + Number(m.amount), 0))

    const sameMonth = (d: Date, y: number, m: number) => d.getFullYear() === y && d.getMonth() === m
    const prevM = new Date(now.getFullYear(), now.getMonth() - 1, 1)

    const closedMonth = closed.filter(t => sameMonth(closedAt(t), now.getFullYear(), now.getMonth()))
    const closedPrevMonth = closed.filter(t => sameMonth(closedAt(t), prevM.getFullYear(), prevM.getMonth()))
    const closedYear = closed.filter(t => closedAt(t).getFullYear() === now.getFullYear())
    const closedPrevYear = closed.filter(t => closedAt(t).getFullYear() === now.getFullYear() - 1)

    const divDate = (m: any) => (m.date ? parseDate(String(m.date)) : null)
    const dividendsMonth = sumAmt(dividends.filter(m => { const d = divDate(m); return !!d && sameMonth(d, now.getFullYear(), now.getMonth()) }))
    const dividendsYear  = sumAmt(dividends.filter(m => { const d = divDate(m); return !!d && d.getFullYear() === now.getFullYear() }))

    const deposited = movements.reduce((a, m) => a + Number(m.amount), 0)
    const invested  = openPositions.reduce((a, t) => a + t.inv, 0)
    const pnl       = sumPnl(closed)

    return {
      capital: r2(deposited + invested),
      pnl,
      wins: winsOf(closed),
      winRate: rate(winsOf(closed), closed.length),
      avgPnl: closed.length ? r2(pnl / closed.length) : 0,
      openCount:   openPositions.length,
      closedCount: closed.length,
      invested:    r2(invested),
      openPnl:     r2(openPositions.reduce((a, t) => a + t.pnlAmt, 0)),
      dividendsMonth,
      dividendsYear,
      pnlMonth: sumPnl(closedMonth),
      winsMonth: winsOf(closedMonth),
      winRateMonth: rate(winsOf(closedMonth), closedMonth.length),
      closedMonthCount: closedMonth.length,
      pnlPrevMonth: sumPnl(closedPrevMonth),
      pnlYear: sumPnl(closedYear),
      pnlPrevYear: sumPnl(closedPrevYear),
      winsYear: winsOf(closedYear),
      winRateYear: rate(winsOf(closedYear), closedYear.length),
      closedYearCount: closedYear.length,
    }
  }, [allTrades, movements, dividends, openPositions])

  // Top 5: solo ganadoras en "ganancias" y solo perdedoras en "pérdidas".
  // Antes, con pocas posiciones, la misma operación podía salir en las dos listas (o una ganadora en "pérdidas").
  const { top5, bottom5 } = useMemo(() => ({
    top5:    openPositions.filter(t => t.pnlPct > 0).sort((a, b) => b.pnlPct - a.pnlPct).slice(0, 5),
    bottom5: openPositions.filter(t => t.pnlPct < 0).sort((a, b) => a.pnlPct - b.pnlPct).slice(0, 5),
  }), [openPositions])

  const sectorDistribution = useMemo(() => {
    const totalInv = openPositions.reduce((a, t) => a + t.inv, 0)
    const map: Record<string, number> = {}
    openPositions.forEach(t => {
      const s = t.sector || 'Sin sector'
      map[s] = (map[s] || 0) + t.inv
    })
    return Object.entries(map)
      .map(([sector, amount]) => ({
        sector,
        amount: r2(amount),
        pct: totalInv > 0 ? parseFloat(((amount / totalInv) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.amount - a.amount)
  }, [openPositions])

  const lastClosedTrades = useMemo(() =>
    allTrades
      .filter(t => t.status === 'closed' && t.close_date)
      .sort((a, b) => dayMs(b.close_date) - dayMs(a.close_date))
      .slice(0, 5)
      .map(t => {
        const pnl = Number(t.realized_pnl || 0)
        const initialInv = Number(t.initial_entry_price || t.entry_price || 0) * Number(t.initial_quantity || t.quantity || 0)
        const buyExtraInv = (t.trade_executions || [])
          .filter((e: any) => e.execution_type === 'buy')
          .reduce((a: number, e: any) => a + Number(e.quantity) * Number(e.price) + Number(e.commission || 0), 0)
        const inv = r2(initialInv + buyExtraInv)
        return { ...t, pnl, pct: inv > 0 ? (pnl / inv) * 100 : 0 }
      })
  , [allTrades])

  // ── Curva de equity global con filtro de período ──────────────────────────
  const equityCurveAll = useMemo(() => {
    let cum = 0
    return allTrades
      .filter(t => t.status === 'closed' && Number.isFinite(dayMs(t.close_date)))
      .sort((a, b) => dayMs(a.close_date) - dayMs(b.close_date))
      .map(t => {
        cum += Number(t.realized_pnl || 0)
        const d = parseDate(t.close_date)
        return {
          ts: d.getTime(),
          dateStr:  d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }),
          dateFull: d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: '2-digit' }),
          pnl: r2(cum),
        }
      })
  }, [allTrades])

  const equityCurve = useMemo(() => {
    const cutoff = periodCutoff(equityPeriod)
    const first = equityCurveAll.findIndex(d => d.ts >= cutoff)
    // Antes, si no había cierres en el período, se mostraba toda la historia con la etiqueta del período
    if (first < 0) return []
    // La base es lo acumulado ANTES del período (antes era el primer cierre del período, que quedaba fuera de la suma)
    const base = first > 0 ? equityCurveAll[first - 1].pnl : 0
    const full = equityPeriod === '5Y' || equityPeriod === 'MAX'
    return equityCurveAll.slice(first).map(d => ({
      date: full ? d.dateFull : d.dateStr,
      pnl:  r2(d.pnl - base),
    }))
  }, [equityCurveAll, equityPeriod])

  // ── Comparativo semanal por portafolio ────────────────────────────────────
  // Mismo cálculo de antes, pero con los datos ya convertidos y un puntero por portafolio: antes cada semana
  // volvía a filtrar y a parsear fechas de TODOS los movimientos y trades (semanas × portafolios × movimientos).
  const compChartAll = useMemo(() => {
    if (!movements.length || !portfolios.length) return []

    const moves = movements
      .map(m => ({ t: dayMs(m.date), wallet: m.wallet_id, amount: Number(m.amount) || 0 }))
      .filter(m => Number.isFinite(m.t))
      .sort((a, b) => a.t - b.t)
    if (!moves.length) return []

    const states = portfolios.map(p => ({
      name: p.name as string,
      moves: moves.filter(m => m.wallet === p.id),
      idx: 0,
      cum: 0,
      trades: allTrades
        .filter(t => t.portfolio_id === p.id)
        .map(t => ({
          open:  dayMs(t.open_date),
          close: t.status === 'open' ? Infinity : dayMs(t.close_date),
          value: Number(t.quantity || 0) * Number(t.last_price || t.entry_price || 0),
        })),
    }))

    const lastMonday = getMondayOfWeek(new Date())
    const out: any[] = []
    for (let monday = getMondayOfWeek(new Date(moves[0].t)); monday <= lastMonday; ) {
      const mondayMs = monday.getTime()
      const next = new Date(monday)
      next.setDate(next.getDate() + 7)
      const nextMs = next.getTime()

      const point: any = {
        label:     monday.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }),
        labelFull: monday.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: '2-digit' }),
        ts: mondayMs,
      }

      for (const s of states) {
        while (s.idx < s.moves.length && s.moves[s.idx].t < nextMs) s.cum += s.moves[s.idx++].amount
        // El saldo acumulado ya incluye depósitos + retiros + ganancias de trades cerrados;
        // solo se agrega el valor de los abiertos en esa fecha para no doble-contar
        let openValue = 0
        for (const t of s.trades) {
          if (Number.isFinite(t.open) && t.open <= mondayMs && t.close > mondayMs) openValue += t.value
        }
        point[s.name] = s.cum + openValue
      }

      out.push(point)
      monday = next
    }
    return out
  }, [movements, portfolios, allTrades])

  const compChart = useMemo(() => {
    if (!compChartAll.length) return []
    const cutoff = periodCutoff(period)
    const data = compChartAll.filter(row => row.ts >= cutoff)
    if (!data.length) return []

    // sp500Data ya viene ordenado de menor a mayor; antes se reordenaba (dos veces) en cada cálculo
    const idxBase = lastOnOrBefore(sp500Data, cutoff)
    const spBase = idxBase >= 0 ? sp500Data[idxBase].close : sp500Data.length ? sp500Data[0].close : null
    const full = period === '5Y' || period === 'MAX'

    return data.map(row => {
      const point: any = { label: full ? row.labelFull : row.label }
      if (spBase) {
        const i = lastOnOrBefore(sp500Data, row.ts)
        const price = i >= 0 ? sp500Data[i].close : spBase
        point['S&P 500'] = r2(((price - spBase) / spBase) * 100)
      } else {
        point['S&P 500'] = 0
      }
      portfolios.forEach(p => {
        const firstVal = data[0][p.name] || 0
        const currentVal = row[p.name] || 0
        point[p.name] = firstVal === 0 ? 0 : r2(((currentVal - firstVal) / firstVal) * 100)
      })
      return point
    })
  }, [compChartAll, period, portfolios, sp500Data])

  const lastValues = useMemo(() => {
    if (!compChart.length) return {} as Record<string, number>
    const last = compChart[compChart.length - 1]
    const result: Record<string, number> = { 'S&P 500': last['S&P 500'] ?? 0 }
    portfolios.forEach(p => { result[p.name] = last[p.name] ?? 0 })
    return result
  }, [compChart, portfolios])

  const tt = { background: '#0a0a0a', border: '1px solid #1a1a1a', fontSize: 11, borderRadius: 8 }

  if (loading) return (
    <AppShell>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '70vh', gap: 16 }}>
        <CatFull size={70} color="#00bfff" opacity={0.5} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {[0,1,2,3].map(i => (
            <Paw key={i} size={12 - i * 1.5} color="#00bfff" opacity={0.4 - i * 0.08} rotate={i * 10} />
          ))}
        </div>
        <span style={{ fontSize: 11, letterSpacing: 3, color: '#333' }}>CARGANDO...</span>
      </div>
    </AppShell>
  )

  const lastEquityPt = equityCurve[equityCurve.length - 1]
  const currentYear = new Date().getFullYear()
  const spLast = lastValues['S&P 500'] ?? 0

  return (
    <AppShell>
      <div style={{ color: 'white', padding: '20px 28px', maxWidth: 1400, margin: '0 auto', position: 'relative', overflow: 'hidden' }}>

        {/* ── DECORACIONES GLOBALES DE GATO ── */}
        <div style={{ position: 'absolute', top: 0, right: 60, pointerEvents: 'none', zIndex: 0 }}>
          <CatEars color="#00bfff" opacity={0.1} size={52} />
        </div>
        <div style={{ position: 'absolute', right: -10, top: '18%', pointerEvents: 'none', zIndex: 0 }}>
          <CatTail color="#a78bfa" opacity={0.07} height={110} />
        </div>
        <div style={{ position: 'absolute', left: -10, top: '55%', pointerEvents: 'none', zIndex: 0 }}>
          <CatTail color="#00bfff" opacity={0.05} height={90} />
        </div>
        <div style={{ position: 'absolute', top: 80, right: 100, pointerEvents: 'none', zIndex: 0 }}>
          <PawTrail color="#00bfff" opacity={0.05} count={5} size={15} gap={20} />
        </div>
        <div style={{ position: 'absolute', bottom: 80, left: 20, pointerEvents: 'none', zIndex: 0 }}>
          <PawTrail color="#a78bfa" opacity={0.04} count={4} size={12} gap={18} />
        </div>

        {loadError && (
          <div style={{
            position: 'relative', zIndex: 1, marginBottom: 14, padding: '10px 14px', borderRadius: 10,
            background: 'rgba(244,63,94,0.06)', border: '1px solid rgba(244,63,94,0.25)', color: RED, fontSize: 12,
          }}>
            No se pudieron cargar los datos ({loadError}). Lo que ves abajo puede estar incompleto; recarga la página.
          </div>
        )}

        {/* ═══ FILA 1 — TOP GANANCIAS / PÉRDIDAS + KPIs ══════════════════ */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 160px 160px 160px 160px',
          gap: 12,
          marginBottom: 16,
          position: 'relative',
          zIndex: 1,
        }}>
          <RankCard title="TOP GANANCIAS" color={GREEN} rows={top5} emptyMsg="Sin ganancias abiertas" />
          <RankCard title="TOP PÉRDIDAS"  color={RED}   rows={bottom5} emptyMsg="Sin pérdidas abiertas" />

          {[
            { label: 'INVERTIDO',    value: money(stats.invested), color: '#fff', sub: `${stats.openCount} posiciones` },
            { label: 'PnL ABIERTOS', value: money(stats.openPnl),  color: pnlColor(stats.openPnl), sub: stats.openPnl >= 0 ? 'en positivo' : 'en negativo' },
            { label: 'PnL CERRADOS', value: money(stats.pnl),      color: pnlColor(stats.pnl),     sub: `${stats.closedCount} trades` },
            { label: 'DIVIDENDOS',   value: `${money(stats.dividendsMonth)} / ${money(stats.dividendsYear)}`, color: '#eab308', sub: 'mes / año' },
          ].map(k => (
            <div key={k.label} style={{ ...kpiGroup, borderColor: '#1a1a1a', justifyContent: 'center' }}>
              <div style={{ fontSize: 9, color: '#555', fontWeight: 700, letterSpacing: 0.8, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                <Paw size={8} color={k.color} opacity={0.6} />
                {k.label}
              </div>
              <div style={{ fontSize: 20, fontWeight: 900, color: k.color, marginBottom: 4 }}>{k.value}</div>
              <div style={{ fontSize: 9, color: '#444' }}>{k.sub}</div>
            </div>
          ))}
        </div>

        {/* ═══ FILA 2 — EQUITY + COMPARATIVO ══════════════════════════════ */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16, position: 'relative', zIndex: 1 }}>

          {/* Curva de equity CON filtro de período */}
          <div style={{ ...card, position: 'relative', overflow: 'hidden', gridColumn: '1' }}>
            <div style={{ position: 'absolute', bottom: 0, right: -8, pointerEvents: 'none' }}>
              <CatFull size={55} color="#00bfff" opacity={0.04} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <Paw size={11} color="#00bfff" opacity={0.6} />
                <span style={cardLabel}>EQUITY</span>
                {lastEquityPt && (
                  <span style={{ fontSize: 12, fontWeight: 800, color: pnlColor(lastEquityPt.pnl), marginLeft: 6 }}>
                    {lastEquityPt.pnl >= 0 ? '+' : ''}{money(lastEquityPt.pnl)}
                  </span>
                )}
              </div>
              <PeriodSelector period={equityPeriod} onChange={setEquityPeriod} />
            </div>

            {equityCurve.length > 1 ? (
              <ResponsiveContainer width="100%" height={210}>
                <AreaChart data={equityCurve} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#00bfff" stopOpacity={0.22} />
                      <stop offset="95%" stopColor="#00bfff" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#0d0d0d" vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fill: '#888', fontSize: 9 }} tickLine={false} axisLine={false} />
                  {/* Con los montos ocultos el eje también: antes mostraba los importes aunque activaras la privacidad */}
                  <YAxis tick={{ fill: '#888', fontSize: 9 }} tickLine={false} axisLine={false} tickFormatter={v => (visible ? `$${v}` : '')} />
                  <Tooltip contentStyle={tt} formatter={(v: any) => [money(v), 'PnL']} />
                  <ReferenceLine y={0} stroke="#222" strokeDasharray="3 3" />
                  <Area type="monotone" dataKey="pnl" stroke="#00bfff" fill="url(#eqGrad)" strokeWidth={2.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState msg="Cierra trades para ver la curva" height={210} />
            )}
          </div>

          {/* Comparativo vs SP500 */}
          <div style={{ ...card, position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 8, right: 120, pointerEvents: 'none' }}>
              <Whiskers color="#a78bfa" opacity={0.08} width={80} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <Paw size={11} color="#a78bfa" opacity={0.6} />
                <span style={cardLabel}>CRECIMIENTO % VS S&P 500</span>
              </div>
              <PeriodSelector period={period} onChange={setPeriod} />
            </div>

            {/* Mini badges de rendimiento */}
            {compChart.length > 0 && (
              <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                {portfolios.map((p, i) => {
                  const val = lastValues[p.name] ?? 0
                  return (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 9, height: 9, borderRadius: '50%', background: PORT_COLORS[i % PORT_COLORS.length], display: 'inline-block' }} />
                      <span style={{ fontSize: 10, color: '#666' }}>{p.name}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: pnlColor(val) }}>
                        {val >= 0 ? '+' : ''}{val.toFixed(2)}%
                      </span>
                    </div>
                  )
                })}
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 12, height: 1, background: '#6366f1', display: 'inline-block' }} />
                  <span style={{ fontSize: 10, color: '#666' }}>S&P 500</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: pnlColor(spLast) }}>
                    {spLast >= 0 ? '+' : ''}{spLast.toFixed(2)}%
                  </span>
                </div>
              </div>
            )}

            {compChart.length > 1 ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={compChart} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#0d0d0d" vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fill: '#888', fontSize: 9 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: '#888', fontSize: 9 }} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} />
                  <Tooltip contentStyle={tt} formatter={(v: any, n?: any) => [`${parseFloat(v) >= 0 ? '+' : ''}${parseFloat(v).toFixed(2)}%`, n]} />
                  <ReferenceLine y={0} stroke="#222" strokeDasharray="3 3" />
                  <Line type="monotone" dataKey="S&P 500" stroke="#6366f1" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
                  {portfolios.map((p, i) => (
                    <Line key={p.id} type="monotone" dataKey={p.name}
                      stroke={PORT_COLORS[i % PORT_COLORS.length]} strokeWidth={2} dot={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState msg="Sin datos en este período" height={186} />
            )}
          </div>
        </div>

        {/* ═══ FILA 3 — RESUMEN MES + AÑO + ÚLTIMOS CERRADOS + SECTORES ═══ */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 14, marginBottom: 16, position: 'relative', zIndex: 1 }}>

          <SummaryCard
            title="RESUMEN DEL MES"
            subtitle={new Date().toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })}
            accent="#a78bfa"
            cells={[
              { label: 'PnL del mes',     value: money(stats.pnlMonth),        color: pnlColor(stats.pnlMonth) },
              { label: 'Trades cerrados', value: stats.closedMonthCount,       color: '#fff' },
              { label: 'Win rate mes',    value: `${stats.winRateMonth}%`,     color: stats.winRateMonth >= 50 ? GREEN : RED },
              { label: 'Dividendos',      value: money(stats.dividendsMonth),  color: '#eab308' },
            ]}
            closedCount={stats.closedMonthCount} wins={stats.winsMonth} winRate={stats.winRateMonth}
            pnl={stats.pnlMonth} invested={stats.invested}
            prevLabel="VS MES ANTERIOR" prevPnl={stats.pnlPrevMonth} money={money}
          />

          <SummaryCard
            title="RESUMEN DEL AÑO"
            subtitle={String(currentYear)}
            accent={GREEN}
            cells={[
              { label: 'PnL del año',     value: money(stats.pnlYear),        color: pnlColor(stats.pnlYear) },
              { label: 'Trades cerrados', value: stats.closedYearCount,       color: '#fff' },
              { label: 'Win rate año',    value: `${stats.winRateYear}%`,     color: stats.winRateYear >= 50 ? GREEN : RED },
              { label: 'Dividendos año',  value: money(stats.dividendsYear),  color: '#eab308' },
            ]}
            closedCount={stats.closedYearCount} wins={stats.winsYear} winRate={stats.winRateYear}
            pnl={stats.pnlYear} invested={stats.invested}
            prevLabel="VS AÑO ANTERIOR" prevPnl={stats.pnlPrevYear} money={money}
          />

          {/* ── Últimos 5 trades cerrados ── */}
          <div style={{ ...card, overflow: 'hidden' }}>
            <div style={{ ...cardHeader, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <Paw size={11} color="#00bfff" opacity={0.6} />
                <span style={cardLabel}>ÚLTIMOS CIERRES</span>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {lastClosedTrades.length === 0 && (
                <span style={{ fontSize: 11, color: '#333' }}>Sin trades cerrados aún.</span>
              )}
              {lastClosedTrades.map(t => (
                <div key={t.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  background: '#050505', borderRadius: 8, padding: '8px 12px',
                  border: `1px solid ${t.pnl >= 0 ? 'rgba(34,197,94,0.1)' : 'rgba(244,63,94,0.1)'}`,
                }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#00bfff' }}>{t.ticker}</div>
                    <div style={{ fontSize: 9, color: '#444', marginTop: 2 }}>
                      {parseDate(t.close_date).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: '2-digit' })}
                      {t.close_reason ? ` · ${t.close_reason}` : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: pnlColor(t.pnl) }}>
                      {t.pnl >= 0 ? '+' : ''}{money(t.pnl)}
                    </div>
                    <div style={{ fontSize: 9, color: pnlColor(t.pnl), opacity: 0.7 }}>
                      {t.pct >= 0 ? '+' : ''}{t.pct.toFixed(2)}%
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Distribución por sector ── */}
          <div style={{ ...card, overflow: 'hidden' }}>
            <div style={{ ...cardHeader, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <Paw size={11} color="#fb923c" opacity={0.6} />
                <span style={cardLabel}>CARTERA POR SECTOR</span>
              </div>
              <span style={{ fontSize: 9, color: '#444' }}>{sectorDistribution.length} sectores</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sectorDistribution.map((s, i) => {
                const color = SECTOR_COLORS[i % SECTOR_COLORS.length]
                return (
                  <div key={s.sector}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: '#aaa' }}>{s.sector}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color }}>
                        {s.pct}% · {money(s.amount)}
                      </span>
                    </div>
                    <div style={{ height: 4, background: '#111', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ width: `${s.pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.6s ease' }} />
                    </div>
                  </div>
                )
              })}
              {sectorDistribution.length === 0 && (
                <span style={{ fontSize: 11, color: '#333' }}>Sin posiciones abiertas.</span>
              )}
            </div>
          </div>

        </div>

        {/* Rastro de huellas decorativo al fondo de la página */}
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 8, opacity: 0.06, pointerEvents: 'none' }}>
          {[18, 14, 11, 8, 6].map((s, i) => (
            <Paw key={i} size={s} color="#00bfff" opacity={1} rotate={i * 12} />
          ))}
        </div>

      </div>
    </AppShell>
  )
}

// ── Sub-componentes ──────────────────────────────────────────────────────────

function EmptyState({ msg, height }: { msg: string; height: number }) {
  return (
    <div style={{
      height, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 10, color: '#1a1a1a', fontSize: 11,
      border: '1px dashed #111', borderRadius: 10, marginTop: 8,
    }}>
      <Paw size={22} color="#1a1a1a" opacity={0.5} />
      {msg}
    </div>
  )
}

// ── Estilos ──────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: '#080808', border: '1px solid #141414', borderRadius: 16, padding: '18px 22px',
}
const cardHeader: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16,
}
const cardLabel: React.CSSProperties = {
  fontSize: 9, color: '#555', fontWeight: 700, letterSpacing: 1.2,
}
const kpiGroup: React.CSSProperties = {
  background: '#080808', border: '1px solid #1a1a1a', borderRadius: 14,
  padding: '10px 13px', display: 'flex', flexDirection: 'column', gap: 6,
}