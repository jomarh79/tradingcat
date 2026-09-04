'use client'

import { useEffect, useState } from 'react'
import { Calculator } from 'lucide-react'

const C = {
  accent: '#00bfff', success: '#22c55e', danger: '#f43f5e', warning: '#eab308',
  card: '#080808', border: '#1a1a1a',
}

// ── Supuestos fijos del DCF simplificado ──
const DCF_DISCOUNT_RATE = 0.09
const DCF_TERMINAL_GROWTH = 0.025
const DCF_PROJECTION_YEARS = 5
const DCF_GROWTH_MIN = 0
const DCF_GROWTH_MAX = 0.12
const GRAHAM_GROWTH_MIN = 0
const GRAHAM_GROWTH_MAX = 0.15

interface OwnHistoryEntry {
  year: number
  endDate: string
  eps: number | null
  revenue: number | null
  sharesOutstanding: number | null
  operatingCashFlow: number | null
}

interface FundamentalsApiResponse {
  pe?: number | null
  ownHistory?: OwnHistoryEntry[]
  error?: string
}

interface IncomeApiResponse {
  success: boolean
  ttm?: { dilutedEps: number | null; dilutedAvgShares: number | null } | null
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

// Cierre más cercano a una fecha dada (± hasta 10 días) — para cruzar cada 10-K con el precio de esa fecha
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

export default function ValuationModelsCard({ ticker }: { ticker: string }) {
  const [loading, setLoading] = useState(true)
  const [fundamentals, setFundamentals] = useState<FundamentalsApiResponse | null>(null)
  const [income, setIncome] = useState<IncomeApiResponse | null>(null)
  const [dailyCloses, setDailyCloses] = useState<{ date: string; close: number }[]>([])

  useEffect(() => {
    if (!ticker) return
    setLoading(true)

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

  const ttmEps = income?.ttm?.dilutedEps ?? null
  const ttmShares = income?.ttm?.dilutedAvgShares ?? null
  const forwardEps = income?.forwardEps?.eps ?? null
  const currentPE = fundamentals?.pe ?? null

  const history = (fundamentals?.ownHistory || []).slice().sort((a, b) => a.year - b.year)

  // ── P/E histórico promedio (mismo criterio que ownFiveYearAvg en chart page) ──
  const historicalPEs = history
    .map((h) => {
      const price = findNearestClose(dailyCloses, h.endDate)
      if (!price || !h.eps || h.eps === 0) return null
      return price / h.eps
    })
    .filter((v): v is number => v != null)
  const historicalPE = historicalPEs.length > 0 ? historicalPEs.reduce((a, b) => a + b, 0) / historicalPEs.length : null

  const oldestWithFCF = history.find((h) => h.operatingCashFlow != null && h.operatingCashFlow > 0)
  const newestWithFCF = [...history].reverse().find((h) => h.operatingCashFlow != null && h.operatingCashFlow > 0)
  const oldestWithEPS = history.find((h) => h.eps != null && h.eps > 0)
  const newestWithEPS = [...history].reverse().find((h) => h.eps != null && h.eps > 0)
  const latestShares = [...history].reverse().find((h) => h.sharesOutstanding != null)?.sharesOutstanding ?? ttmShares

  // ── Modelo 1: DCF simplificado ──
  let dcfValue: number | null = null
  if (oldestWithFCF && newestWithFCF && oldestWithFCF !== newestWithFCF && latestShares) {
    const yearsBetween = newestWithFCF.year - oldestWithFCF.year
    const rawGrowth = cagr(oldestWithFCF.operatingCashFlow!, newestWithFCF.operatingCashFlow!, yearsBetween)
    const growth = rawGrowth != null ? clamp(rawGrowth, DCF_GROWTH_MIN, DCF_GROWTH_MAX) : 0.05
    const baseFCF = newestWithFCF.operatingCashFlow!

    let sumPV = 0
    let fcfT = baseFCF
    for (let t = 1; t <= DCF_PROJECTION_YEARS; t++) {
      fcfT = fcfT * (1 + growth)
      sumPV += fcfT / Math.pow(1 + DCF_DISCOUNT_RATE, t)
    }
    const terminalValue = (fcfT * (1 + DCF_TERMINAL_GROWTH)) / (DCF_DISCOUNT_RATE - DCF_TERMINAL_GROWTH)
    const pvTerminal = terminalValue / Math.pow(1 + DCF_DISCOUNT_RATE, DCF_PROJECTION_YEARS)
    const equityValue = sumPV + pvTerminal
    dcfValue = equityValue / latestShares
  }

  // ── Modelo 2: Benjamin Graham (crecimiento de EPS) ──
  let grahamValue: number | null = null
  if (ttmEps && ttmEps > 0 && oldestWithEPS && newestWithEPS && oldestWithEPS !== newestWithEPS) {
    const yearsBetween = newestWithEPS.year - oldestWithEPS.year
    const rawGrowth = cagr(oldestWithEPS.eps!, newestWithEPS.eps!, yearsBetween)
    const growthPct = rawGrowth != null ? clamp(rawGrowth, GRAHAM_GROWTH_MIN, GRAHAM_GROWTH_MAX) * 100 : 5
    grahamValue = ttmEps * (8.5 + 2 * growthPct)
  }

  // ── Modelo 3: Múltiplos históricos ──
  const multiplesValue = ttmEps && historicalPE ? ttmEps * historicalPE : null

  // ── Modelo 4: Objetivo 12 meses (forward EPS × P/E actual) ──
  const forwardValue = forwardEps && currentPE ? forwardEps * currentPE : null

  const models = [
    { label: 'DCF (Flujo de caja descontado)', value: dcfValue },
    { label: 'Graham (Crecimiento EPS)', value: grahamValue },
    { label: 'Múltiplos históricos', value: multiplesValue },
    { label: 'Objetivo 12 meses (Forward EPS)', value: forwardValue },
  ]

    // Promedio SOLO de los modelos de valor intrínseco actual (DCF, Graham, Múltiplos) —
  // Forward EPS queda fuera porque responde una pregunta distinta (dónde podría estar
  // el precio en 12 meses, no cuánto vale hoy) y mezclarlos distorsiona el promedio.
  const intrinsicValues = [dcfValue, grahamValue, multiplesValue].filter((v): v is number => v != null && v > 0)
  const suggested = intrinsicValues.length > 0 ? intrinsicValues.reduce((a, b) => a + b, 0) / intrinsicValues.length : null

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <Calculator size={12} color={C.warning} />
        <div style={{ fontSize: 9, color: '#666', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>
          Modelos
        </div>
      </div>

      {loading ? (
        <div style={{ color: '#555', fontSize: 11 }}>Cargando...</div>
      ) : (
        <>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <tbody>
              {models.slice(0, 3).map((m) => (
                <tr key={m.label} style={{ borderTop: '1px solid #151515' }}>
                  <td style={{ padding: '4px 6px', color: '#aaa' }}>{m.label}</td>
                  <td style={{ padding: '4px 6px', textAlign: 'right', color: '#fff', fontWeight: 700 }}>
                    {fmtMoney(m.value)}
                  </td>
                </tr>
              ))}
              {suggested != null && (
                <tr style={{ borderTop: '2px solid #222' }}>
                  <td style={{ padding: '5px 6px', color: C.accent, fontWeight: 700 }}>Valor intrínseco (promedio)</td>
                  <td style={{ padding: '5px 6px', textAlign: 'right', color: C.accent, fontWeight: 900 }}>
                    {fmtMoney(suggested)}
                  </td>
                </tr>
              )}
              <tr style={{ borderTop: '1px solid #222' }}>
                <td colSpan={2} style={{ padding: '8px 6px 2px', fontSize: 8, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Proyección a 12 meses (no es "valor hoy")
                </td>
              </tr>
              <tr>
                <td style={{ padding: '4px 6px', color: '#aaa' }}>{models[3].label}</td>
                <td style={{ padding: '4px 6px', textAlign: 'right', color: C.warning, fontWeight: 700 }}>
                  {fmtMoney(models[3].value)}
                </td>
              </tr>
            </tbody>
          </table>

          <div style={{ fontSize: 8, color: '#444', marginTop: 8, lineHeight: 1.5 }}>
            DCF: tasa de descuento {(DCF_DISCOUNT_RATE * 100).toFixed(0)}%, crecimiento terminal {(DCF_TERMINAL_GROWTH * 100).toFixed(1)}%, proyección {DCF_PROJECTION_YEARS} años — usa FCF ≈ flujo de caja operativo (sin restar capex). Graham y múltiplos usan hasta 5 años de historial (Finnhub, 10-K). Ninguno es una recomendación — son estimaciones con supuestos simplificados.
          </div>
        </>
      )}
    </div>
  )
}