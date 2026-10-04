'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createChart,
  LineSeries,
  ColorType,
  LineStyle,
  type LineData,
  type UTCTimestamp,
} from 'lightweight-charts'

const C = {
  accent: '#00bfff', success: '#22c55e', danger: '#f43f5e', warning: '#eab308',
  card: '#080808', border: '#1a1a1a',
}

interface DailyClose {
  date: string
  close: number
}

interface DividendYieldChartProps {
  ticker: string
  years?: number
  dailyCloses: DailyClose[]
}

type YieldPoint = { time: number; value: number }

const dayKey = (d: any) => String(d || '').split('T')[0].split(' ')[0]

// 'yyyy-MM-dd' → segundos UTC. Todo el cálculo usa UTC (antes mezclaba hora local y UTC, lo que desfasaba
// un día el cruce entre fechas de dividendo y de precio fuera de zonas como México).
function toUtcSec(d: string): number | null {
  const ms = Date.parse(dayKey(d) + 'T00:00:00Z')
  return Number.isNaN(ms) ? null : ms / 1000
}

function computeDailyYieldSeries(
  dividends: { date: string; amount: number }[],
  dailyCloses: DailyClose[],
  years: number
): YieldPoint[] {
  if (!dividends.length || !dailyCloses.length) return []

  const divs = dividends
    .map(d => ({ sec: toUtcSec(d.date), amount: Number(d.amount) }))
    .filter((d): d is { sec: number; amount: number } => d.sec != null && Number.isFinite(d.amount))
    .sort((a, b) => a.sec - b.sec)
  if (!divs.length) return []

  const cutoffSec = Date.now() / 1000 - years * 365 * 86400

  // Un cierre por fecha y en orden ascendente (la librería lanza error con fechas repetidas)
  const byTime = new Map<number, number>()
  for (const c of dailyCloses) {
    const time = toUtcSec(c.date)
    const close = Number(c.close)
    if (time == null || !(close > 0) || time < cutoffSec) continue
    byTime.set(time, close)
  }
  const closes = Array.from(byTime.entries()).sort(([a], [b]) => a - b)

  const out: YieldPoint[] = []
  let idx = -1

  for (const [time, close] of closes) {
    while (idx + 1 < divs.length && divs[idx + 1].sec <= time) idx++
    if (idx < 0) continue // todavía no había ningún dividendo conocido
    out.push({ time, value: (divs[idx].amount / close) * 100 })
  }

  return out
}

export default function DividendYieldChart({ ticker, years = 10, dailyCloses }: DividendYieldChartProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [dividends, setDividends] = useState<{ date: string; amount: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Solo los dividendos se piden a la API. Antes dailyCloses también estaba en las dependencias:
  // si el padre pasaba un arreglo nuevo en cada render, se volvía a llamar a /api/dividends cada vez.
  useEffect(() => {
    setDividends([])
    setError(null)
    if (!ticker) { setLoading(false); return }

    let cancelled = false
    setLoading(true)

    fetch(`/api/dividends?symbol=${encodeURIComponent(ticker)}&years=${years}`)
      .then(r => r.json())
      .then(divData => {
        if (cancelled) return // el ticker cambió mientras llegaba la respuesta
        if (divData.error) { setError(divData.error); return }
        setDividends(divData.dividends || [])
      })
      .catch(e => { if (!cancelled) setError(String(e?.message ?? e)) })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [ticker, years])

  const points = useMemo(
    () => computeDailyYieldSeries(dividends, dailyCloses || [], years),
    [dividends, dailyCloses, years]
  )

  // Promedio, máximo, mínimo y último valor: una sola pasada (antes se calculaban dos veces en sitios distintos)
  const stats = useMemo(() => {
    if (!points.length) return null
    let sum = 0
    let max = points[0]
    let min = points[0]
    for (const p of points) {
      sum += p.value
      if (p.value > max.value) max = p
      if (p.value < min.value) min = p
    }
    return { avg: sum / points.length, max, min, latest: points[points.length - 1] }
  }, [points])

  const hasChart = !loading && !error && points.length > 0

  // Si el padre entrega un arreglo nuevo con los mismos datos, la gráfica no se destruye ni se vuelve a crear
  const pointsKey = points.length
    ? `${points.length}|${points[0].time}|${stats!.latest.time}|${stats!.latest.value.toFixed(4)}`
    : ''
  const pointsRef = useRef(points)
  pointsRef.current = points

  useEffect(() => {
    const data = pointsRef.current
    if (!hasChart || !ref.current || data.length === 0) return

    const chart = createChart(ref.current, {
      layout: { background: { type: ColorType.Solid, color: '#080808' }, textColor: '#999' },
      grid: { vertLines: { color: '#141414' }, horzLines: { color: '#141414' } },
      autoSize: true, // sigue el tamaño del contenedor, sin listener de resize
      rightPriceScale: { borderColor: '#222' },
      timeScale: { borderColor: '#222' },
    })

    // Promedio histórico
    const avg = data.reduce((sum, p) => sum + p.value, 0) / data.length

    // Una sola serie donde cada punto lleva su propio color según el promedio (verde arriba, rojo abajo)
    const coloredData: LineData<UTCTimestamp>[] = data.map(p => ({
      time: p.time as UTCTimestamp,
      value: p.value,
      color: p.value >= avg ? C.success : C.danger,
    }))

    const lineSeries = chart.addSeries(LineSeries, {
      lineWidth: 2,
      lastValueVisible: true,
      priceLineVisible: false,
      priceFormat: { type: 'custom', formatter: (v: number) => `${v.toFixed(2)}%`, minMove: 0.01 },
    })
    lineSeries.setData(coloredData)

    // ── Línea de Promedio (sin etiqueta en el eje) ──
    lineSeries.createPriceLine({
      price: avg,
      color: C.accent,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: false, // quita la etiqueta flotante del eje derecho
      title: 'Promedio',
    })

    // Líneas blancas en el punto más alto y más bajo
    const maxPoint = data.reduce((max, p) => (p.value > max.value ? p : max), data[0])
    const minPoint = data.reduce((min, p) => (p.value < min.value ? p : min), data[0])

    lineSeries.createPriceLine({
      price: maxPoint.value, color: '#ffffff', lineWidth: 1, lineStyle: LineStyle.Dashed,
      axisLabelVisible: false, title: 'Máx',
    })
    lineSeries.createPriceLine({
      price: minPoint.value, color: '#ffffff', lineWidth: 1, lineStyle: LineStyle.Dashed,
      axisLabelVisible: false, title: 'Mín',
    })

    chart.timeScale().fitContent()

    return () => { chart.remove() }
  }, [hasChart, pointsKey])

  const latest = stats?.latest
  const avg = stats?.avg ?? null

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 10, color: '#888', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Dividendo vs precio — últimos {years} años (diario, sin anualizar)
        </div>
        {hasChart && latest && (
          <div style={{ fontSize: 11, color: '#666' }}>
            Hoy: <span style={{ color: latest.value >= (avg || 0) ? C.success : C.danger, fontWeight: 700 }}>
              {latest.value.toFixed(2)}%
            </span>
            {avg != null && <span> · promedio {avg.toFixed(2)}%</span>}
          </div>
        )}
      </div>

      {loading && <div style={{ padding: 40, textAlign: 'center', color: '#555', fontSize: 12 }}>Cargando...</div>}
      {error && <div style={{ padding: 20, textAlign: 'center', color: C.danger, fontSize: 12 }}>{error}</div>}

      {!loading && !error && points.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: '#444', fontSize: 12 }}>
          Sin datos suficientes para este símbolo.
        </div>
      )}

      {hasChart && (
        <>
          <div ref={ref} style={{ width: '100%', height: 260 }} />
          <div style={{ fontSize: 9, color: '#444', marginTop: 8 }}>
            El dividendo se mantiene fijo entre pagos (último trimestre conocido); el precio se mueve a diario — por eso la línea cambia todos los días, no solo en las fechas de pago. Líneas blancas = Máximo y Mínimo del periodo.
          </div>
        </>
      )}
    </div>
  )
}