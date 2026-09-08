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

interface ChartDataPostResponse {
  dailyCloses?: { date: string; close: number }[]
  error?: string
}

function cagr(startValue: number, endValue: number, periods: number): number | null {
  if (startValue <= 0 || endValue <= 0 || periods <= 0) return null
  return Math.pow(endValue / startValue, 1 / periods) - 1
}
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}
function fmtMoney(v: number | null): string {
  if (v == null || isNaN(v)) return '—'
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtPercent(v: number | null): string {
  if (v == null || isNaN(v)) return '—'
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
}

function findNearestClose(dailyCloses: { date: string; close: number }[], targetDate: string): number | null {
  if (!dailyCloses?.length) return null
  const target = new Date(targetDate.split(' ')[0]).getTime()
  let best: { close: number; diff: number } | null = null
  for (const d of dailyCloses) {
    const diff = Math.abs(new Date(d.date).getTime() - target)
    if (!best || diff < best.diff) best = { close: d.close, diff }
  }
  return best && best.diff <= 10 * 86400000 ? best.close : null
}

interface ValuationModelsCardProps {
  ticker: string
  currentPrice?: number | null // opcional — si no se pasa, usa el último cierre diario como aproximación
}

export default function ValuationModelsCard({ ticker, currentPrice }: ValuationModelsCardProps) {
  const [loading, setLoading] = useState(true)
  const [fundamentals, setFundamentals] = useState<FundamentalsApiResponse | null>(null)
  const [income, setIncome] = useState<IncomeApiResponse | null>(null)
  const [dailyCloses, setDailyCloses] = useState<{ date: string; close: number }[]>([])
  const [customEps, setCustomEps] = useState<string>('')
  const [years, setYears] = useState<number>(DEFAULT_YEARS)

  useEffect(() => {
    if (!ticker) return
    setLoading(true)
    setCustomEps('')

    Promise.all([
      fetch(`/api/fundamentals?symbol=${encodeURIComponent(ticker)}`).then((r) => r.json()).catch(() => null),
      fetch(`/api/webull/income-statement?symbol=${encodeURIComponent(ticker)}`).then((r) => r.json()).catch(() => null),
      fetch('/api/chart-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: ticker }),
      }).then((r) => r.json()).catch(() => null),
    ]).then(([fund, inc, chart]: [FundamentalsApiResponse | null, IncomeApiResponse | null, ChartDataPostResponse | null]) => {
      setFundamentals(fund)
      setIncome(inc)
      setDailyCloses(chart?.dailyCloses || [])
    }).finally(() => setLoading(false))
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

    const targetPE = historicalPE || currentPE
    const effectivePrice = currentPrice ?? (dailyCloses.length ? dailyCloses[dailyCloses.length - 1].close : null)

    return { ttmEps, historicalPE, currentPE, rawForwardEps, epsGrowthRate, targetPE, effectivePrice }
  }, [fundamentals, income, dailyCloses, currentPrice])

  const multiplesValue = base.ttmEps && base.historicalPE ? base.ttmEps * base.historicalPE : null

  // EPS proyectado a "years" — si years=1 y Webull dio un forward real, se usa tal cual (más preciso);
  // para cualquier otro horizonte, se compone el crecimiento histórico de EPS sobre el TTM.
  const isForwardEpsReal = years === 1 && base.rawForwardEps != null
  const defaultProjectedEps = isForwardEpsReal
    ? base.rawForwardEps
    : (base.ttmEps != null ? base.ttmEps * Math.pow(1 + base.epsGrowthRate, years) : null)

  const activeEps = customEps.trim() !== '' && !isNaN(parseFloat(customEps)) ? parseFloat(customEps) : defaultProjectedEps
  const isCustom = customEps.trim() !== '' && !isNaN(parseFloat(customEps))

  const targetPrice = activeEps != null && base.targetPE ? activeEps * base.targetPE : null

  const totalGainPct = targetPrice != null && base.effectivePrice
    ? ((targetPrice - base.effectivePrice) / base.effectivePrice) * 100
    : null
  const annualizedGainPct = targetPrice != null && base.effectivePrice && years > 0
    ? (Math.pow(targetPrice / base.effectivePrice, 1 / years) - 1) * 100
    : null

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
      ) : (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <tbody>
              <tr style={{ borderTop: '1px solid #151515' }}>
                <td style={{ padding: '4px 6px', color: '#aaa' }}>Múltiplos históricos (P/E Prom.)</td>
                <td style={{ padding: '4px 6px', textAlign: 'right', color: '#fff', fontWeight: 700 }}>
                  {fmtMoney(multiplesValue)}
                </td>
              </tr>

              <tr style={{ borderTop: '2px solid #222' }}>
                <td colSpan={2} style={{ padding: '8px 6px 2px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 8, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      Objetivo a {years} {years === 1 ? 'año' : 'años'} (proyección, no es "valor hoy")
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <button
                        onClick={() => setYears((y) => clamp(y - 1, MIN_YEARS, MAX_YEARS))}
                        style={yearBtn}
                      >−</button>
                      <span style={{ fontSize: 10, color: C.accent, fontWeight: 700, minWidth: 14, textAlign: 'center' }}>{years}</span>
                      <button
                        onClick={() => setYears((y) => clamp(y + 1, MIN_YEARS, MAX_YEARS))}
                        style={yearBtn}
                      >+</button>
                    </div>
                  </div>
                </td>
              </tr>

              <tr>
                <td style={{ padding: '4px 6px', color: '#aaa', verticalAlign: 'middle' }}>
                  EPS a {years} {years === 1 ? 'año' : 'años'}
                  <div style={{ fontSize: 8, color: isForwardEpsReal ? C.success : C.warning, marginTop: 2 }}>
                    {isForwardEpsReal ? 'estimado real (analistas)' : `proyectado (crecimiento histórico ${(base.epsGrowthRate * 100).toFixed(1)}%/año)`}
                  </div>
                </td>
                <td style={{ padding: '4px 6px', textAlign: 'right' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                    <input
                      type="number"
                      step="0.01"
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
                        onClick={() => setCustomEps('')}
                        title="Volver al estimado del sistema"
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
        </>
      )}
    </div>
  )
}

const yearBtn: React.CSSProperties = {
  background: '#111', border: '1px solid #333', color: '#aaa', borderRadius: 4,
  width: 18, height: 18, fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
}