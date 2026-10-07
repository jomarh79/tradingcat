'use client'

import { Suspense, useEffect, useState, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { usePrivacy } from '@/lib/PrivacyContext'

import AppShell from '../AppShell'
import {
  Activity,
  Building2,
  Calendar,
  DollarSign,
  TrendingUp,
  TrendingDown,
} from 'lucide-react'
import ValuationModelsCard from '../components/ValuationModelsCard'

import { authedFetch } from "@/lib/authed-fetch";

const C = {
  accent: '#00bfff',
  success: '#22c55e',
  danger: '#f43f5e',
  warning: '#eab308',
  card: '#080808',
  border: '#1a1a1a',
}

interface PositionDetail {
  success: boolean
  symbol?: string

  profile?: {
    companyName: string | null
    establishDate: string | null
    exchange: string | null
    description: string | null
    employees: number | null
    address: string | null
    ceo: string | null
    industries: string[]
  } | null

  nextEarnings?: {
    fiscalYear: number
    fiscalPeriod: number
    expectedDate: string
    epsEst: number | null
    revEst: number | null
  } | null

  nextDividend?: {
    amount: number | null
    exDivDate: string
    payDate: string
  } | null

  analystTarget?: {
    mean: number | null
    low: number | null
    high: number | null
    median: number | null
  } | null

  performance?: {
    periods: {
      label: string
      stockReturn: number | null
      spyReturn: number | null
      alpha: number | null
    }[]
    dataCoverageYears: number
  }

  error?: string
}

/* ─────────────────────────────────────────────────────────────
   FORMATEADORES Y FECHAS
───────────────────────────────────────────────────────────── */

const isNum = (v: any): v is number => v != null && !Number.isNaN(Number(v))

// Precios de mercado (analistas, dividendo por acción, estimados). Lo tuyo usa `money` (respeta el modo privado).
function fmtMoney(v: number | null | undefined): string {
  if (!isNum(v)) return '—'
  return `$${Number(v).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function fmtPercent(v: number | null | undefined): string {
  if (!isNum(v)) return '—'
  return `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(2)}%`
}

const dayKey = (d: any) => String(d || '').split('T')[0].split(' ')[0]
const todayLocal = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' })

// Días completos desde una fecha (null si la fecha no existe o no es válida)
function daysSince(d: any): number | null {
  const k = dayKey(d)
  if (!k) return null
  const diff = (Date.parse(todayLocal() + 'T00:00:00Z') - Date.parse(k + 'T00:00:00Z')) / 86400000
  return Number.isNaN(diff) ? null : Math.max(0, Math.floor(diff))
}

/*
 * Convierte fechas de distintos formatos sin producir "Invalid Date".
 * Soporta: 2026-08-21 · 2026-08-21 15:30:00 · 2026-08-21T15:30:00(+00:00) · 08/21/2026
 */
function parseDay(d: string | null | undefined): Date | null {
  const raw = String(d ?? '').trim()
  if (!raw) return null

  let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))

  m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]))

  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date
}

function fmtDate(d: string | null | undefined): string {
  const date = parseDay(d)
  return date
    ? date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—'
}

const EXEC_LABEL: Record<string, string> = {
  apertura: 'Apertura',
  buy: 'Compra',
  sell: 'Venta parcial',
  close: 'Cierre',
}

/* ─────────────────────────────────────────────────────────────
   COMPONENTES
───────────────────────────────────────────────────────────── */

const cardTitle: React.CSSProperties = {
  fontSize: 11,
  color: '#888',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
}

function Card({
  title,
  icon,
  children,
  gridColumn = 'span 4',
}: {
  title: string
  icon?: React.ReactNode
  children: React.ReactNode
  gridColumn?: string
}) {
  return (
    <div
      style={{
        gridColumn,
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: 16,
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        {icon}
        <div style={cardTitle}>{title}</div>
      </div>
      {children}
    </div>
  )
}

function StatRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 10,
        padding: '5px 0',
        borderTop: '1px solid #151515',
        fontSize: 12,
      }}
    >
      <span style={{ color: '#888', minWidth: 0 }}>{label}</span>
      <span style={{ color: color || '#ddd', fontWeight: 700, textAlign: 'right' }}>{value}</span>
    </div>
  )
}

const Muted = ({ children }: { children: React.ReactNode }) => (
  <div style={{ color: '#555', fontSize: 12 }}>{children}</div>
)

const chip: React.CSSProperties = {
  fontSize: 10,
  color: '#555',
  border: '1px solid #222',
  borderRadius: 5,
  padding: '2px 8px',
}

/* ─────────────────────────────────────────────────────────────
   PAGE
───────────────────────────────────────────────────────────── */

function PositionPageInner() {
  const { money, shares } = usePrivacy()

  const searchParams = useSearchParams()
  const ticker = (searchParams.get('ticker') || '').toUpperCase()
  const tradeId = searchParams.get('tradeId')

  const [trade, setTrade] = useState<any | null>(null)
  const [tradeLoading, setTradeLoading] = useState(true)
  const [executions, setExecutions] = useState<any[]>([])
  const [detail, setDetail] = useState<PositionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [editingNotes, setEditingNotes] = useState(false)
  const [notesValue, setNotesValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const skipBlurRef = useRef(false)   // Enter/Escape ya resolvieron la edición: el blur posterior no debe guardar
  const savingNotesRef = useRef(false)

  const adjustTextareaHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
    }
  }

  useEffect(() => {
    if (editingNotes) adjustTextareaHeight()
  }, [editingNotes, notesValue])

  /* ───────────────────────────────────────────────────────────
     CARGAR TRADE + EJECUCIONES
  ─────────────────────────────────────────────────────────── */

  useEffect(() => {
    setTrade(null)
    setExecutions([])
    setEditingNotes(false)
    if (!ticker) { setTradeLoading(false); return }

    let cancelled = false
    setTradeLoading(true)

    ;(async () => {
      const query = supabase.from('trades').select('*, portfolios(name)')
      const { data, error: tErr } = tradeId
        ? await query.eq('id', tradeId).maybeSingle()
        : await query.eq('ticker', ticker).eq('status', 'open')
            .order('open_date', { ascending: false }).limit(1).maybeSingle()

      if (cancelled) return
      if (tErr) console.error('Error cargando trade:', tErr)
      setTrade(data || null)
      setTradeLoading(false)
      if (!data?.id) return

      const { data: execs, error: eErr } = await supabase
        .from('trade_executions')
        .select('*')
        .eq('trade_id', data.id)
        .order('executed_at', { ascending: true })
      if (cancelled) return
      if (eErr) console.error('Error cargando ejecuciones:', eErr)

      // "Apertura" no vive en trade_executions — se reconstruye desde
      // trade.initial_quantity / initial_entry_price / open_date,
      // igual que hace TradeManagerModal.
      const rows = [
        {
          id: 'apertura',
          executed_at: data.open_date,
          execution_type: 'apertura',
          quantity: data.initial_quantity ?? data.quantity,
          price: data.initial_entry_price ?? data.entry_price,
          seq: 0,
        },
        ...(execs || []).map((e, i) => ({ ...e, seq: i + 1 })),
      ]

      // Más reciente primero; el mismo día se desempata por orden de captura
      rows.sort((a, b) => {
        const da = dayKey(a.executed_at), db = dayKey(b.executed_at)
        return da === db ? b.seq - a.seq : da < db ? 1 : -1
      })
      setExecutions(rows)
    })()

    return () => { cancelled = true }
  }, [ticker, tradeId])

  /* ───────────────────────────────────────────────────────────
     OBSERVACIONES
  ─────────────────────────────────────────────────────────── */

  const saveNotes = async () => {
    if (!trade?.id || savingNotesRef.current) return
    if (notesValue === (trade.notes || '')) { setEditingNotes(false); return }

    savingNotesRef.current = true
    const { error: nErr } = await supabase.from('trades').update({ notes: notesValue }).eq('id', trade.id)
    savingNotesRef.current = false

    if (nErr) {
      skipBlurRef.current = false
      alert('No se pudieron guardar las observaciones: ' + nErr.message)
      return // se queda en edición para no perder el texto
    }
    setTrade((prev: any) => (prev ? { ...prev, notes: notesValue } : prev))
    setEditingNotes(false)
  }

  /* ───────────────────────────────────────────────────────────
     CARGAR DATOS WEBULL
  ─────────────────────────────────────────────────────────── */

  useEffect(() => {
    setDetail(null)
    setError(null)
    if (!ticker) return

    let cancelled = false
    setLoading(true)

    authedFetch(`/api/webull/position-detail?symbol=${encodeURIComponent(ticker)}`)
      .then((r) => r.json())
      .then((json: PositionDetail) => {
        if (cancelled) return
        if (!json.success) {
          setError(json.error || 'Error desconocido')
          return
        }
        setDetail(json)
      })
      .catch((e) => { if (!cancelled) setError(String(e?.message ?? e)) })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [ticker])

  /* ───────────────────────────────────────────────────────────
     SIN TICKER
  ─────────────────────────────────────────────────────────── */

  if (!ticker) {
    return (
      <AppShell>
        <div style={{ padding: 60, textAlign: 'center', color: '#666' }}>
          Abre esta página desde un trade abierto — falta <code>?ticker=</code> en la URL.
        </div>
      </AppShell>
    )
  }

  /* ───────────────────────────────────────────────────────────
     CÁLCULOS
  ─────────────────────────────────────────────────────────── */

  const hasTrade = !!trade
  // Sin trade cargado no se muestran ceros engañosos
  const mine = (v: string) => (hasTrade ? v : '—')

  const qty = Number(trade?.quantity || 0)
  const invested = Number(trade?.total_invested || 0)
  const curPrice = Number(trade?.last_price || trade?.entry_price || 0)
  const avgPrice = qty > 0 ? invested / qty : Number(trade?.entry_price || 0)
  const curValue = curPrice * qty
  const unrealizedPnl = curValue - invested
  const unrealizedPnlPct = avgPrice > 0 ? ((curPrice - avgPrice) / avgPrice) * 100 : 0
  const realizedPnl = Number(trade?.realized_pnl || 0)

  const distTo = (target: number | null | undefined) =>
    target && curPrice > 0 ? ((target - curPrice) / curPrice) * 100 : null

  const stop = trade?.stop_loss ? Number(trade.stop_loss) : null
  // Pérdida (negativa) o ganancia asegurada (positiva) si salta el stop
  const stopImpact = stop != null ? (stop - avgPrice) * qty : null
  const risk = stop != null && avgPrice > stop ? avgPrice - stop : null // riesgo por acción (solo si el stop está bajo el costo)

  const targets = [
    { label: 'Stop Loss',     price: stop,                  hit: !!trade?.stop_hit, sold: false, color: C.danger },
    { label: 'Take Profit 1', price: trade?.take_profit_1,  hit: !!trade?.tp1_hit,  sold: true,  color: C.success },
    { label: 'Take Profit 2', price: trade?.take_profit_2,  hit: !!trade?.tp2_hit,  sold: true,  color: C.success },
    { label: 'Take Profit 3', price: trade?.take_profit_3,  hit: !!trade?.tp3_hit,  sold: true,  color: C.success },
  ]

  const rr = (tp: number | null | undefined) =>
    tp && risk ? `1 : ${((Number(tp) - avgPrice) / risk).toFixed(2)}` : '—'

  const held = daysSince(trade?.open_date)
  const analystDist = distTo(detail?.analystTarget?.mean)
  const dividendAmount = detail?.nextDividend?.amount

  /* ───────────────────────────────────────────────────────────
     RENDER
  ─────────────────────────────────────────────────────────── */

  return (
    <AppShell>
      <div style={{ maxWidth: 1300, margin: '20px auto', padding: '0 28px', color: 'white' }}>

        {/* ── HEADER ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
          <Activity size={20} color={C.accent} />

          <h1 style={{ fontSize: 18, fontWeight: 900, margin: 0 }}>{ticker}</h1>

          {detail?.profile?.companyName && (
            <span style={{ fontSize: 13, color: '#888', fontWeight: 500 }}>
              {detail.profile.companyName}
            </span>
          )}

          <span style={{ fontSize: 15, color: '#fff', fontWeight: 700 }}>
            {hasTrade ? money(curPrice) : '—'}
          </span>

          {trade?.day_change != null && (
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                padding: '3px 8px',
                borderRadius: 5,
                color: Number(trade.day_change) >= 0 ? C.success : C.danger,
                background: Number(trade.day_change) >= 0 ? 'rgba(34,197,94,0.1)' : 'rgba(244,63,94,0.1)',
              }}
            >
              {Number(trade.day_change) >= 0 ? '+' : ''}
              {Number(trade.day_change).toFixed(2)}%
            </span>
          )}

          {detail?.profile?.exchange && <span style={chip}>{detail.profile.exchange}</span>}
          {trade?.portfolios?.name && <span style={chip}>{trade.portfolios.name}</span>}
        </div>

        {/* ── ERROR / SIN TRADE ── */}
        {error && (
          <div
            style={{
              padding: 20,
              marginBottom: 16,
              textAlign: 'center',
              color: C.danger,
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 12,
            }}
          >
            {error}
          </div>
        )}

        {!tradeLoading && !hasTrade && (
          <div
            style={{
              padding: 14,
              marginBottom: 16,
              textAlign: 'center',
              color: C.warning,
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 12,
              fontSize: 12,
            }}
          >
            No se encontró un trade abierto de {ticker}. Se muestran solo los datos de mercado.
          </div>
        )}

        {/* =====================================================
            GRID PRINCIPAL
            FILA 1: Posición | Stop Loss / TP | Riesgo / beneficio | S&P 500
            FILA 2: Analistas | Valuación | Earnings | Dividendo
            FILA 3: Empresa | Descripción
            FILA 4: Observaciones
            FILA 5: Historial
        ===================================================== */}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: 14 }}>

          {/* ── POSICIÓN ── */}
          <Card title="Posición" icon={<DollarSign size={14} color={C.accent} />} gridColumn="span 3">
            <StatRow label="Invertido" value={mine(money(invested))} />
            <StatRow label="Cantidad de acciones" value={mine(shares(qty))} />
            <StatRow label="Precio promedio" value={mine(money(avgPrice))} />
            <StatRow label="Valor actual" value={mine(money(curValue))} />
            <StatRow
              label="PnL no realizado"
              value={mine(`(${fmtPercent(unrealizedPnlPct)}) ${money(unrealizedPnl)}`)}
              color={unrealizedPnl >= 0 ? C.success : C.danger}
            />
            <StatRow
              label="PnL realizado"
              value={mine(money(realizedPnl))}
              color={realizedPnl >= 0 ? C.success : C.danger}
            />
          </Card>

          {/* ── STOP LOSS / TAKE PROFITS ── */}
          <Card title="Stop Loss / Take Profits" icon={<TrendingDown size={14} color={C.danger} />} gridColumn="span 3">
            {targets.map(t => (
              <StatRow
                key={t.label}
                label={`${t.label} (${t.price ? money(Number(t.price)) : '—'})`}
                value={t.hit && t.sold ? '✓ Vendido' : fmtPercent(distTo(t.price ? Number(t.price) : null))}
                color={t.hit ? '#555' : t.color}
              />
            ))}
          </Card>

          {/* ── RIESGO ── */}
          <Card title="Gestión de Riesgo & Eficiencia" icon={<TrendingUp size={14} color={C.accent} />} gridColumn="span 3">
            <StatRow
              label={stopImpact != null && stopImpact >= 0 ? 'Ganancia asegurada (SL)' : 'Pérdida Máx. Potencial (SL)'}
              value={stopImpact != null ? money(stopImpact) : '—'}
              color={stopImpact != null && stopImpact >= 0 ? C.success : C.danger}
            />
            {[1, 2, 3].map(n => (
              <StatRow
                key={n}
                label={`Riesgo / Beneficio a TP ${n}`}
                value={mine(rr(trade?.[`take_profit_${n}`]))}
                color={C.accent}
              />
            ))}
            <StatRow label="Días en Posición" value={held != null ? `${held} días` : '—'} />
            <StatRow
              label="Yield sobre Costo (est.)"
              value={
                dividendAmount && avgPrice > 0
                  ? `${((dividendAmount * 4 / avgPrice) * 100).toFixed(2)}%`
                  : '—'
              }
              color={C.success}
            />
          </Card>

          {/* ── RENDIMIENTO VS S&P 500 ── */}
          <Card title="Rendimiento vs S&P 500" gridColumn="span 3">
            {loading ? (
              <div style={{ color: '#555', fontSize: 12, padding: 20, textAlign: 'center' }}>Cargando...</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    {['Periodo', ticker, 'S&P 500', 'Alfa'].map((h, i) => (
                      <th
                        key={i}
                        style={{
                          textAlign: i === 0 ? 'left' : 'right',
                          color: '#555',
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '4px 4px',
                          textTransform: 'uppercase',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {detail?.performance?.periods.map((p) => (
                    <tr key={p.label} style={{ borderTop: '1px solid #151515' }}>
                      <td style={{ padding: '6px 4px', color: '#aaa' }}>{p.label}</td>
                      <td style={{ padding: '6px 4px', textAlign: 'right', fontWeight: 700, color: p.stockReturn != null && p.stockReturn >= 0 ? C.success : C.danger }}>
                        {fmtPercent(p.stockReturn)}
                      </td>
                      <td style={{ padding: '6px 4px', textAlign: 'right', color: p.spyReturn != null && p.spyReturn >= 0 ? C.success : C.danger }}>
                        {fmtPercent(p.spyReturn)}
                      </td>
                      <td style={{ padding: '6px 4px', textAlign: 'right', fontWeight: 700, color: p.alpha == null ? '#444' : p.alpha >= 0 ? C.success : C.danger }}>
                        {p.alpha == null ? '—' : <>{p.alpha >= 0 ? '▲' : '▼'} {Math.abs(p.alpha).toFixed(1)}%</>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          {/* ── ANALISTAS ── */}
          <Card title="Analistas" icon={<TrendingUp size={14} color={C.warning} />} gridColumn="span 3">
            {loading ? (
              <Muted>Cargando...</Muted>
            ) : (
              <>
                <StatRow label="Promedio (consenso)" value={fmtMoney(detail?.analystTarget?.mean)} />
                <StatRow label="Más alto" value={fmtMoney(detail?.analystTarget?.high)} />
                <StatRow label="Más bajo" value={fmtMoney(detail?.analystTarget?.low)} />
                <StatRow label="Mediana" value={fmtMoney(detail?.analystTarget?.median)} />
                <StatRow
                  label="Distancia al consenso"
                  value={fmtPercent(analystDist)}
                  color={analystDist != null && analystDist >= 0 ? C.success : C.danger}
                />
              </>
            )}
          </Card>

          {/* ── VALUACIONES ── */}
          <div style={{ gridColumn: 'span 3' }}>
            <ValuationModelsCard ticker={ticker} currentPrice={curPrice} />
          </div>

          {/* ── EARNINGS ── */}
          <Card title="Próximo reporte de resultados" icon={<Calendar size={14} color={C.accent} />} gridColumn="span 3">
            {loading ? (
              <Muted>Cargando...</Muted>
            ) : detail?.nextEarnings ? (
              <>
                <StatRow label="Fecha estimada" value={fmtDate(detail.nextEarnings.expectedDate)} />
                <StatRow
                  label="EPS estimado"
                  value={isNum(detail.nextEarnings.epsEst) ? `$${Number(detail.nextEarnings.epsEst).toFixed(2)}` : '—'}
                />
                <StatRow
                  label="Ingresos estimados"
                  value={isNum(detail.nextEarnings.revEst) ? `${fmtMoney(Number(detail.nextEarnings.revEst) / 1e9)}B` : '—'}
                />
              </>
            ) : (
              <Muted>Sin datos de earnings para este símbolo.</Muted>
            )}
          </Card>

          {/* ── DIVIDENDO ── */}
          <Card title="Próximo dividendo" icon={<DollarSign size={14} color={C.success} />} gridColumn="span 3">
            {loading ? (
              <Muted>Cargando...</Muted>
            ) : detail?.nextDividend ? (
              <>
                <StatRow label="Monto por acción" value={fmtMoney(detail.nextDividend.amount)} />
                <StatRow label="Fecha ex-dividendo" value={fmtDate(detail.nextDividend.exDivDate)} />
                <StatRow label="Fecha de pago" value={fmtDate(detail.nextDividend.payDate)} />
                <StatRow
                  label="Ingreso estimado (tu posición)"
                  value={mine(money((dividendAmount || 0) * qty))}
                />
              </>
            ) : (
              <Muted>Sin dividendos programados para este símbolo.</Muted>
            )}
          </Card>

          {/* ── EMPRESA ── */}
          <Card title="Empresa" icon={<Building2 size={14} color={C.accent} />} gridColumn="span 3">
            {loading ? (
              <Muted>Cargando...</Muted>
            ) : detail?.profile ? (
              <>
                <StatRow label="CEO" value={detail.profile.ceo || '—'} />
                <StatRow
                  label="Empleados"
                  value={detail.profile.employees != null ? detail.profile.employees.toLocaleString('en-US') : '—'}
                />
                <StatRow label="Fundada" value={fmtDate(detail.profile.establishDate)} />
                <StatRow label="País" value={detail.profile.address?.split(',').pop()?.trim() || '—'} />
                <StatRow label="Industria" value={detail.profile.industries?.[0] || '—'} />
              </>
            ) : (
              <Muted>Sin perfil disponible.</Muted>
            )}
          </Card>

          {/* ── DESCRIPCIÓN ── */}
          {detail?.profile?.description && (
            <div
              style={{
                gridColumn: 'span 9',
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 12,
                padding: 16,
                minWidth: 0,
              }}
            >
              <div style={{ ...cardTitle, marginBottom: 8 }}>Descripción</div>
              <p style={{ fontSize: 12, color: '#bbb', lineHeight: 1.6, margin: 0 }}>
                {detail.profile.description}
              </p>
            </div>
          )}

          {/* ── OBSERVACIONES ── */}
          {trade && (
            <div
              style={{
                gridColumn: '1 / -1',
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 12,
                padding: 16,
                minWidth: 0,
              }}
            >
              <div style={{ ...cardTitle, marginBottom: 8 }}>Observaciones</div>

              {editingNotes ? (
                <textarea
                  ref={textareaRef}
                  autoFocus
                  value={notesValue}
                  onChange={(e) => {
                    setNotesValue(e.target.value)
                    adjustTextareaHeight()
                  }}
                  onBlur={() => {
                    if (skipBlurRef.current) { skipBlurRef.current = false; return }
                    saveNotes()
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      skipBlurRef.current = true
                      saveNotes()
                    }
                    if (e.key === 'Escape') {
                      skipBlurRef.current = true   // Escape descarta: no debe guardar al perder el foco
                      setEditingNotes(false)
                    }
                  }}
                  style={{
                    width: '100%',
                    minHeight: 40,
                    height: 'auto',
                    overflow: 'hidden',
                    background: '#000',
                    color: 'white',
                    border: '1px solid #333',
                    borderRadius: 6,
                    padding: 10,
                    fontSize: 12,
                    lineHeight: 1.6,
                    outline: 'none',
                    resize: 'none',
                    boxSizing: 'border-box',
                    fontFamily: 'inherit',
                  }}
                />
              ) : (
                <p
                  onClick={() => {
                    skipBlurRef.current = false
                    setNotesValue(trade.notes || '')
                    setEditingNotes(true)
                  }}
                  title="Clic para editar"
                  style={{
                    fontSize: 12,
                    color: trade.notes ? '#bbb' : '#444',
                    lineHeight: 1.6,
                    margin: 0,
                    cursor: 'pointer',
                    minHeight: 18,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {trade.notes || 'Sin observaciones — clic para agregar'}
                </p>
              )}
            </div>
          )}

          {/* ── HISTORIAL DE OPERACIONES ── */}
          {executions.length > 0 && (
            <div
              style={{
                gridColumn: '1 / -1',
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 12,
                padding: 16,
                minWidth: 0,
              }}
            >
              <div style={{ ...cardTitle, marginBottom: 12 }}>Historial de operaciones</div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr>
                      {['Fecha', 'Tipo', 'Cantidad', 'Precio', 'Total'].map((h, i) => (
                        <th
                          key={i}
                          style={{
                            textAlign: i === 0 ? 'left' : 'right',
                            color: '#555',
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '4px 8px',
                            textTransform: 'uppercase',
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>

                  <tbody>
                    {executions.map((e) => {
                      const isBuy = e.execution_type === 'buy' || e.execution_type === 'apertura'
                      return (
                        <tr key={e.id} style={{ borderTop: '1px solid #151515' }}>
                          <td style={{ padding: '6px 8px', color: '#aaa' }}>{fmtDate(e.executed_at)}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', color: isBuy ? C.success : C.danger, fontWeight: 700 }}>
                            {EXEC_LABEL[e.execution_type] || 'Venta'}
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', color: '#ddd' }}>
                            {shares(Number(e.quantity))}
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', color: '#ddd' }}>
                            {money(Number(e.price))}
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', color: '#ddd', fontWeight: 700 }}>
                            {money(Number(e.price) * Number(e.quantity))}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}

/* ─────────────────────────────────────────────────────────────
   EXPORT
───────────────────────────────────────────────────────────── */

export default function PositionPage() {
  return (
    <Suspense fallback={<AppShell><div style={{ padding: 40, color: '#666' }}>Cargando...</div></AppShell>}>
      <PositionPageInner />
    </Suspense>
  )
}