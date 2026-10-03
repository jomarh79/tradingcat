'use client'

import { useEffect, useMemo, useState } from 'react'
import { Calculator, RotateCcw } from 'lucide-react'

const C = {
  accent: '#00bfff', success: '#22c55e', danger: '#f43f5e', warning: '#eab308',
  card: '#080808', border: '#1a1a1a',
}

const FALLBACK_GROWTH_MIN = 0.04
const FALLBACK_GROWTH_MAX = 0.12
const DEFAULT_YEARS = 1
const MIN_YEARS = 1
const MAX_YEARS = 10

interface OwnHistoryEntry {
  year: number
  endDate: string
  eps: number | null
}

interface FundamentalsApiResponse {
  pe?: number | null
  ownHistory?: OwnHistoryEntry[]
  error?: string
}

interface IncomeApiResponse {
  success: boolean
  ttm?: { dilutedEps: number | null } | null
  forwardEps?: { eps: number } | null
}

type DailyClose = { date: string; close: number }

interface ChartDataPostResponse {
  dailyCloses?: DailyClose[]
  error?: string
}

/* ─────────────────────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────────────────────── */

function cagr(startValue: number, endValue: number, periods: number): number | null {
  if (startValue <= 0 || endValue <= 0 || periods <= 0) return null
  return Math.pow(endValue / startValue, 1 / periods) - 1
}
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}
function fmtMoney(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtPercent(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
}

// Fecha 'yyyy-MM-dd' (con o sin hora) → ms UTC
const toMs = (d: string) => Date.parse(String(d || '').split('T')[0].split(' ')[0] + 'T00:00:00Z')

// Cierre más cercano a la fecha (máx. 10 días de diferencia).
// dailyCloses viene en orden cronológico desde /api/chart-data, así que se usa búsqueda binaria.
function findNearestClose(dailyCloses: DailyClose[], targetDate: string): number | null {
  if (!dailyCloses.length) return null
  const target = toMs(targetDate)
  if (Number.isNaN(target)) return null

  let lo = 0
  let hi = dailyCloses.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (toMs(dailyCloses[mid].date) < target) lo = mid + 1
    else hi = mid
  }
  let best = dailyCloses[lo]
  if (lo > 0 && Math.abs(toMs(dailyCloses[lo - 1].date) - target) <= Math.abs(toMs(best.date) - target)) {
    best = dailyCloses[lo - 1]
  }
  const diff = Math.abs(toMs(best.date) - target)
  return Number.isNaN(diff) || diff > 10 * 86400000 ? null : best.close
}

// Una respuesta con error HTTP se trata como "sin datos"
const getJson = <T,>(url: string, init?: RequestInit): Promise<T | null> =>
  fetch(url, init).then((r) => (r.ok ? (r.json() as Promise<T>) : null)).catch(() => null)

interface ValuationModelsCardProps {
  ticker: string
  currentPrice?: number | null // opcional — si no se pasa (o es 0), usa el último cierre diario como aproximación
}

/* ─────────────────────────────────────────────────────────────
   COMPONENTE
───────────────────────────────────────────────────────────── */

export default function ValuationModelsCard({ ticker, currentPrice }: ValuationModelsCardProps) {
  const [loading, setLoading] = useState(true)
  const [fundamentals, setFundamentals] = useState<FundamentalsApiResponse | null>(null)
  const [income, setIncome] = useState<IncomeApiResponse | null>(null)
  const [dailyCloses, setDailyCloses] = useState<DailyClose[]>([])
  const [customEps, setCustomEps] = useState<string>('')
  const [years, setYears] = useState<number>(DEFAULT_YEARS)

  useEffect(() => {
    setFundamentals(null)
    setIncome(null)
    setDailyCloses([])
    setCustomEps('')
    if (!ticker) { setLoading(false); return }

    let cancelled = false
    setLoading(true)

    Promise.all([
      getJson<FundamentalsApiResponse>(`/api/fundamentals?symbol=${encodeURIComponent(ticker)}`),
      getJson<IncomeApiResponse>(`/api/webull/income-statement?symbol=${encodeURIComponent(ticker)}`),
      getJson<ChartDataPostResponse>('/api/chart-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: ticker }),
      }),
    ]).then(([fund, inc, chart]) => {
      if (cancelled) return // el ticker cambió mientras llegaba la respuesta
      setFundamentals(fund)
      setIncome(inc)
      setDailyCloses(chart?.dailyCloses || [])
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [ticker])

  const base = useMemo(() => {
    const ttmEps = income?.ttm?.dilutedEps ?? null
    const rawForwardEps = income?.forwardEps?.eps ?? null
    const currentPE = fundamentals?.pe ?? null

    const history = (fundamentals?.ownHistory || []).slice().sort((a, b) => a.year - b.year)

    const historicalPEs = history
      .map((h) => {
        const price = findNearestClose(dailyCloses, h.endDate)
        if (!price || !h.eps || h.eps <= 0) return null
        return price / h.eps
      })
      .filter((v): v is number => v != null)
    const historicalPE = historicalPEs.length > 0 ? historicalPEs.reduce((a, b) => a + b, 0) / historicalPEs.length : null

    const oldestWithEPS = history.find((h) => h.eps != null && h.eps > 0)
    const newestWithEPS = [...history].reverse().find((h) => h.eps != null && h.eps > 0)
    let epsGrowthRate = FALLBACK_GROWTH_MIN
    if (oldestWithEPS && newestWithEPS && oldestWithEPS !== newestWithEPS) {
      const yearsBetween = newestWithEPS.year - oldestWithEPS.year
      const rawGrowth = cagr(oldestWithEPS.eps!, newestWithEPS.eps!, yearsBetween)
      epsGrowthRate = rawGrowth != null ? clamp(rawGrowth, FALLBACK_GROWTH_MIN, FALLBACK_GROWTH_MAX) : FALLBACK_GROWTH_MIN
    }

    // Origen del P/E objetivo (se muestra en la tarjeta para que se vea qué múltiplo se está usando)
    const targetPE = historicalPE || currentPE
    const targetPESource = historicalPE ? 'histórico' : currentPE ? 'actual' : null

    // currentPrice puede llegar como 0 (la página no tiene trade cargado): se trata como "sin precio"
    const lastClose = dailyCloses.length ? dailyCloses[dailyCloses.length - 1].close : null
    const effectivePrice = currentPrice && currentPrice > 0 ? currentPrice : lastClose

    return { ttmEps, historicalPE, currentPE, rawForwardEps, epsGrowthRate, targetPE, targetPESource, effectivePrice }
  }, [fundamentals, income, dailyCloses, currentPrice])

  // Un EPS negativo o cero no produce un precio con sentido
  const multiplesValue = base.ttmEps != null && base.ttmEps > 0 && base.historicalPE ? base.ttmEps * base.historicalPE : null

  // EPS proyectado a "years" — si years=1 y Webull dio un forward real, se usa tal cual (más preciso);
  // para cualquier otro horizonte, se compone el crecimiento histórico de EPS sobre el TTM.
  const isForwardEpsReal = years === 1 && base.rawForwardEps != null
  const defaultProjectedEps = isForwardEpsReal
    ? base.rawForwardEps
    : (base.ttmEps != null ? base.ttmEps * Math.pow(1 + base.epsGrowthRate, years) : null)

  const customVal = customEps.trim() !== '' ? parseFloat(customEps) : NaN
  const isCustom = Number.isFinite(customVal)
  const activeEps = isCustom ? customVal : defaultProjectedEps

  const targetPrice = activeEps != null && activeEps > 0 && base.targetPE ? activeEps * base.targetPE : null

  const totalGainPct = targetPrice != null && base.effectivePrice
    ? ((targetPrice - base.effectivePrice) / base.effectivePrice) * 100
    : null
  const annualizedGainPct = targetPrice != null && base.effectivePrice
    ? (Math.pow(targetPrice / base.effectivePrice, 1 / years) - 1) * 100
    : null

  const noData = !loading && base.ttmEps == null && base.rawForwardEps == null && !base.targetPE
  const yearsLabel = years === 1 ? 'año' : 'años'

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <Calculator size={12} color={C.warning} />
        <div style={{ fontSize: 9, color: '#666', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>
          Modelos de valuación
        </div>
      </div>

      {loading ? (
        <div style={{ color: '#555', fontSize: 11 }}>Cargando...</div>
      ) : noData ? (
        <div style={{ color: '#555', fontSize: 11 }}>Sin datos suficientes para valuar {ticker}.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <tbody>
            <tr style={{ borderTop: '1px solid #151515' }}>
              <td style={{ padding: '4px 6px', color: '#aaa' }}>Múltiplos históricos (P/E Prom.)</td>
              <td style={{ padding: '4px 6px', textAlign: 'right', color: '#fff', fontWeight: 700 }}>
                {fmtMoney(multiplesValue)}
              </td>
            </tr>

            <tr style={{ borderTop: '1px solid #151515' }}>
              <td style={{ padding: '4px 6px', color: '#aaa' }}>
                P/E objetivo
                {base.targetPESource && (
                  <div style={{ fontSize: 8, color: '#555', marginTop: 2 }}>{base.targetPESource}</div>
                )}
              </td>
              <td style={{ padding: '4px 6px', textAlign: 'right', color: '#ddd', fontWeight: 700 }}>
                {base.targetPE ? `${base.targetPE.toFixed(1)}x` : '—'}
              </td>
            </tr>

            <tr style={{ borderTop: '2px solid #222' }}>
              <td colSpan={2} style={{ padding: '8px 6px 2px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 8, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Objetivo a {years} {yearsLabel} (proyección, no es "valor hoy")
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button
                      type="button"
                      aria-label="Menos años"
                      disabled={years <= MIN_YEARS}
                      onClick={() => setYears((y) => clamp(y - 1, MIN_YEARS, MAX_YEARS))}
                      style={{ ...yearBtn, opacity: years <= MIN_YEARS ? 0.35 : 1 }}
                    >−</button>
                    <span style={{ fontSize: 10, color: C.accent, fontWeight: 700, minWidth: 14, textAlign: 'center' }}>{years}</span>
                    <button
                      type="button"
                      aria-label="Más años"
                      disabled={years >= MAX_YEARS}
                      onClick={() => setYears((y) => clamp(y + 1, MIN_YEARS, MAX_YEARS))}
                      style={{ ...yearBtn, opacity: years >= MAX_YEARS ? 0.35 : 1 }}
                    >+</button>
                  </div>
                </div>
              </td>
            </tr>

            <tr>
              <td style={{ padding: '4px 6px', color: '#aaa', verticalAlign: 'middle' }}>
                EPS a {years} {yearsLabel}
                <div style={{ fontSize: 8, color: isForwardEpsReal ? C.success : C.warning, marginTop: 2 }}>
                  {isForwardEpsReal ? 'estimado real (analistas)' : `proyectado (crecimiento histórico ${(base.epsGrowthRate * 100).toFixed(1)}%/año)`}
                </div>
              </td>
              <td style={{ padding: '4px 6px', textAlign: 'right' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    aria-label="EPS propio"
                    placeholder={defaultProjectedEps != null ? defaultProjectedEps.toFixed(2) : '—'}
                    value={customEps}
                    onChange={(e) => setCustomEps(e.target.value)}
                    style={{
                      width: 70, background: '#000', color: isCustom ? C.accent : '#fff',
                      border: `1px solid ${isCustom ? C.accent : '#333'}`, borderRadius: 4,
                      padding: '3px 6px', fontSize: 11, textAlign: 'right', outline: 'none',
                    }}
                  />
                  {isCustom && (
                    <button
                      type="button"
                      onClick={() => setCustomEps('')}
                      title="Volver al estimado del sistema"
                      aria-label="Volver al estimado del sistema"
                      style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: 2, display: 'flex' }}
                    >
                      <RotateCcw size={11} />
                    </button>
                  )}
                </div>
              </td>
            </tr>

            <tr style={{ borderTop: '1px solid #151515' }}>
              <td style={{ padding: '4px 6px', color: '#aaa' }}>
                Precio objetivo {isCustom ? '(con tu EPS)' : ''}
              </td>
              <td style={{ padding: '4px 6px', textAlign: 'right', color: isCustom ? C.accent : C.warning, fontWeight: 700 }}>
                {fmtMoney(targetPrice)}
              </td>
            </tr>

            <tr>
              <td style={{ padding: '4px 6px', color: '#aaa' }}>Ganancia total ({years}a)</td>
              <td style={{ padding: '4px 6px', textAlign: 'right', color: totalGainPct != null && totalGainPct >= 0 ? C.success : C.danger, fontWeight: 700 }}>
                {fmtPercent(totalGainPct)}
              </td>
            </tr>

            <tr style={{ borderTop: '1px solid #151515' }}>
              <td style={{ padding: '4px 6px', color: '#aaa', fontWeight: 700 }}>Ganancia anualizada</td>
              <td style={{ padding: '4px 6px', textAlign: 'right', color: annualizedGainPct != null && annualizedGainPct >= 0 ? C.success : C.danger, fontWeight: 900 }}>
                {fmtPercent(annualizedGainPct)}
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  )
}

const yearBtn: React.CSSProperties = {
  background: '#111', border: '1px solid #333', color: '#aaa', borderRadius: 4,
  width: 18, height: 18, fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
}