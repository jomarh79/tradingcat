'use client'

import { useEffect, useMemo, useState } from 'react'
import { Calculator, RotateCcw } from 'lucide-react'

const C = {
  accent: '#00bfff', success: '#22c55e', danger: '#f43f5e', warning: '#eab308',
  card: '#080808', border: '#1a1a1a',
}

// Rango razonable para el crecimiento de EPS usado en el estimado genérico (fallback)
// cuando Webull no trae los 4 trimestres de forecast completos.
const FALLBACK_GROWTH_MIN = 0.04
const FALLBACK_GROWTH_MAX = 0.12

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
  const [customEps, setCustomEps] = useState<string>('')

  useEffect(() => {
    if (!ticker) return
    setLoading(true)
    setCustomEps('') // al cambiar de ticker, se limpia el override manual

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

    // P/E histórico promedio — cruza cada 10-K con el precio de esa fecha
    const historicalPEs = history
      .map((h) => {
        const price = findNearestClose(dailyCloses, h.endDate)
        if (!price || !h.eps || h.eps <= 0) return null
        return price / h.eps
      })
      .filter((v): v is number => v != null)
    const historicalPE = historicalPEs.length > 0 ? historicalPEs.reduce((a, b) => a + b, 0) / historicalPEs.length : null

    // Estimado genérico de EPS forward (fallback) — solo se usa si Webull no trae el dato real
    const oldestWithEPS = history.find((h) => h.eps != null && h.eps > 0)
    const newestWithEPS = [...history].reverse().find((h) => h.eps != null && h.eps > 0)
    let fallbackEps: number | null = null
    if (ttmEps && oldestWithEPS && newestWithEPS && oldestWithEPS !== newestWithEPS) {
      const yearsBetween = newestWithEPS.year - oldestWithEPS.year
      const rawGrowth = cagr(oldestWithEPS.eps!, newestWithEPS.eps!, yearsBetween)
      const growth = rawGrowth != null ? clamp(rawGrowth, FALLBACK_GROWTH_MIN, FALLBACK_GROWTH_MAX) : FALLBACK_GROWTH_MIN
      fallbackEps = ttmEps * (1 + growth)
    }

    const isForwardEpsReal = rawForwardEps != null
    const defaultForwardEps = rawForwardEps ?? fallbackEps
    const targetPE = historicalPE || currentPE

    return { ttmEps, historicalPE, currentPE, isForwardEpsReal, defaultForwardEps, targetPE }
  }, [fundamentals, income, dailyCloses])

  const multiplesValue = base.ttmEps && base.historicalPE ? base.ttmEps * base.historicalPE : null

  const activeEps = customEps.trim() !== '' ? parseFloat(customEps) : base.defaultForwardEps
  const forwardValue = activeEps && !isNaN(activeEps) && base.targetPE ? activeEps * base.targetPE : null
  const isCustom = customEps.trim() !== '' && !isNaN(parseFloat(customEps))

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
                <td colSpan={2} style={{ padding: '8px 6px 2px', fontSize: 8, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Objetivo 12 meses (proyección, no es "valor hoy")
                </td>
              </tr>

              <tr>
                <td style={{ padding: '4px 6px', color: '#aaa', verticalAlign: 'middle' }}>
                  EPS a 12 meses
                  <div style={{ fontSize: 8, color: base.isForwardEpsReal ? C.success : C.warning, marginTop: 2 }}>
                    {base.isForwardEpsReal ? 'estimado real (analistas)' : 'estimado genérico (sin dato real de Webull)'}
                  </div>
                </td>
                <td style={{ padding: '4px 6px', textAlign: 'right' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                    <input
                      type="number"
                      step="0.01"
                      placeholder={base.defaultForwardEps != null ? base.defaultForwardEps.toFixed(2) : '—'}
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
                  {fmtMoney(forwardValue)}
                </td>
              </tr>
            </tbody>
          </table>

          <div style={{ fontSize: 8, color: '#444', marginTop: 8, lineHeight: 1.5 }}>
            Precio objetivo = EPS a 12 meses × P/E promedio histórico (o P/E actual si no hay histórico). Puedes editar el EPS para simular tu propio escenario — se restablece al estimado del sistema con el ícono ↺ o al cambiar de ticker. Ninguno de los dos valores es una recomendación.
          </div>
        </>
      )}
    </div>
  )
}