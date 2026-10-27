'use client'

import { useEffect, useState } from 'react'
import { Calculator } from 'lucide-react'

const C = {
  accent: '#00bfff', success: '#22c55e', danger: '#f43f5e', warning: '#eab308',
  card: '#080808', border: '#1a1a1a',
}

// ── Supuestos fijos del DCF simplificado — declarados aquí para que sean fáciles de ajustar ──
const DCF_DISCOUNT_RATE = 0.09       // tasa de descuento (proxy de costo de capital)
const DCF_TERMINAL_GROWTH = 0.025    // crecimiento terminal a perpetuidad
const DCF_PROJECTION_YEARS = 5
const DCF_GROWTH_MIN = 0             // piso de la tasa de crecimiento proyectada de FCF
const DCF_GROWTH_MAX = 0.12          // techo de la tasa de crecimiento proyectada de FCF
const GRAHAM_GROWTH_MIN = 0          // piso de la tasa de crecimiento de EPS usada en Graham
const GRAHAM_GROWTH_MAX = 0.15       // techo de la tasa de crecimiento de EPS usada en Graham

interface OwnHistoryEntry {
  year: number
  eps: number | null
  operatingCashFlow: number | null
  sharesOutstanding: number | null
}

interface ValuationModelsCardProps {
  ticker: string
  fundamentals: { pe: number | null } | null
  ownFiveYearAvg: { pe: number | null } | null
  ownHistory: OwnHistoryEntry[] | undefined
}

interface IncomeApiResponse {
  success: boolean
  ttm?: { dilutedEps: number | null; dilutedAvgShares: number | null } | null
  forwardEps?: { eps: number } | null
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

export default function ValuationModelsCard({ ticker, fundamentals, ownFiveYearAvg, ownHistory }: ValuationModelsCardProps) {
  const [income, setIncome] = useState<IncomeApiResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!ticker) return
    setLoading(true)
    fetch(`/api/webull/income-statement?symbol=${encodeURIComponent(ticker)}`)
      .then((r) => r.json())
      .then((json: IncomeApiResponse) => setIncome(json))
      .catch(() => setIncome(null))
      .finally(() => setLoading(false))
  }, [ticker])

  const ttmEps = income?.ttm?.dilutedEps ?? null
  const ttmShares = income?.ttm?.dilutedAvgShares ?? null
  const forwardEps = income?.forwardEps?.eps ?? null
  const currentPE = fundamentals?.pe ?? null
  const historicalPE = ownFiveYearAvg?.pe ?? null

  // Historial ordenado ascendente por año (más viejo primero) — necesario para CAGR
  const history = (ownHistory || []).slice().sort((a, b) => a.year - b.year)
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

  const validValues = models.map((m) => m.value).filter((v): v is number => v != null && v > 0)
  const suggested = validValues.length > 0 ? validValues.reduce((a, b) => a + b, 0) / validValues.length : null

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 14px', maxWidth: 320 }}>
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
              {models.map((m) => (
                <tr key={m.label} style={{ borderTop: '1px solid #151515' }}>
                  <td style={{ padding: '4px 6px', color: '#aaa' }}>{m.label}</td>
                  <td style={{ padding: '4px 6px', textAlign: 'right', color: '#fff', fontWeight: 700 }}>
                    {fmtMoney(m.value)}
                  </td>
                </tr>
              ))}
              {suggested != null && (
                <tr style={{ borderTop: '2px solid #222' }}>
                  <td style={{ padding: '5px 6px', color: C.accent, fontWeight: 700 }}>Precio sugerido (promedio)</td>
                  <td style={{ padding: '5px 6px', textAlign: 'right', color: C.accent, fontWeight: 900 }}>
                    {fmtMoney(suggested)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div style={{ fontSize: 8, color: '#444', marginTop: 8, lineHeight: 1.5 }}>
            DCF: tasa de descuento {(DCF_DISCOUNT_RATE * 100).toFixed(0)}%, crecimiento terminal {(DCF_TERMINAL_GROWTH * 100).toFixed(1)}%, proyección {DCF_PROJECTION_YEARS} años — usa FCF ≈ flujo de caja operativo (sin restar capex, por falta de dato). Graham y múltiplos usan crecimiento/histórico de hasta 5 años (Finnhub, 10-K). Ninguno es una recomendación — son estimaciones con supuestos simplificados.
          </div>
        </>
      )}
    </div>
  )
}