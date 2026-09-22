'use client'

import { useEffect, useRef, useState } from 'react'
import { createChart, LineSeries, ColorType } from 'lightweight-charts'

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

function computeDailyYieldSeries(
  dividends: { date: string; amount: number }[],
  dailyCloses: DailyClose[],
  years: number
) {
  type Point = { time: number; value: number }
  const out: Point[] = []
  if (!dividends.length || !dailyCloses.length) return out

  const sortedDividends = [...dividends].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  )

  const cutoff = Date.now() - years * 365 * 86400000

  const closes = dailyCloses
    .map(c => {
      const ms = new Date(c.date.split(' ')[0] + 'T00:00:00').getTime()
      return { time: Math.floor(ms / 1000), close: c.close, ms }
    })
    .filter(c => !isNaN(c.close) && c.ms >= cutoff)
    .sort((a, b) => a.time - b.time)

  let idx = -1

  for (const day of closes) {
    while (
      idx + 1 < sortedDividends.length &&
      new Date(sortedDividends[idx + 1].date).getTime() <= day.ms
    ) idx++

    if (idx < 0) continue
    if (day.close <= 0) continue

    const amount = sortedDividends[idx].amount
    out.push({ time: day.time, value: (amount / day.close) * 100 })
  }

  return out
}

export default function DividendYieldChart({ ticker, years = 10, dailyCloses }: DividendYieldChartProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [points, setPoints] = useState<{ time: number; value: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ticker || !dailyCloses || dailyCloses.length === 0) { setLoading(false); return }
    setLoading(true)
    setError(null)

    fetch(`/api/dividends?symbol=${encodeURIComponent(ticker)}&years=${years}`)
      .then(r => r.json())
      .then(divData => {
        if (divData.error) { setError(divData.error); return }
        const series = computeDailyYieldSeries(divData.dividends || [], dailyCloses, years)
        setPoints(series)
      })
      .catch(e => setError(String(e?.message ?? e)))
      .finally(() => setLoading(false))
  }, [ticker, years, dailyCloses])

  useEffect(() => {
    if (!ref.current || points.length === 0) return

    const chart = createChart(ref.current, {
      layout: { background: { type: ColorType.Solid, color: '#080808' }, textColor: '#999' },
      grid: { vertLines: { color: '#141414' }, horzLines: { color: '#141414' } },
      width: ref.current.clientWidth,
      height: 260,
      rightPriceScale: { borderColor: '#222' },
      timeScale: { borderColor: '#222' },
    })

    // Calcular el promedio histórico
    const avg = points.reduce((sum, p) => sum + p.value, 0) / points.length

    // Crear una sola serie donde cada punto lleva su propio color según el promedio
    const coloredData = points.map(p => ({
      time: p.time,
      value: p.value,
      color: p.value >= avg ? C.success : C.danger, // Verde si está arriba, rojo si está abajo
    }))

    const lineSeries = chart.addSeries(LineSeries, {
      lineWidth: 2,
      lastValueVisible: true,
      priceLineVisible: false,
      priceFormat: { type: 'custom', formatter: (v: number) => `${v.toFixed(2)}%` },
    })
    lineSeries.setData(coloredData as any)

    // ── Línea de Promedio (sin etiqueta en el eje) ──
    lineSeries.createPriceLine({
      price: avg,
      color: C.accent, // color azul
      lineWidth: 1,
      lineStyle: 2,    // punteada
      axisLabelVisible: false, // <-- Esto quita la etiqueta flotante del eje derecho
      title: 'Promedio',
    })

    // Encontrar el punto más alto y más bajo para las líneas blancas
    const maxPoint = points.reduce((max, p) => p.value > max.value ? p : max, points[0])
    const minPoint = points.reduce((min, p) => p.value < min.value ? p : min, points[0])

    // Línea blanca en el punto más alto
    lineSeries.createPriceLine({
      price: maxPoint.value, color: '#ffffff', lineWidth: 1, lineStyle: 2,
      axisLabelVisible: true, title: 'Máx',
    })

    // Línea blanca en el punto más bajo
    lineSeries.createPriceLine({
      price: minPoint.value, color: '#ffffff', lineWidth: 1, lineStyle: 2,
      axisLabelVisible: true, title: 'Mín',
    })

    chart.timeScale().fitContent()

    const handleResize = () => { if (ref.current) chart.applyOptions({ width: ref.current.clientWidth }) }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
    }
  }, [points])

  const latest = points[points.length - 1]
  const avg = points.length ? points.reduce((sum, p) => sum + p.value, 0) / points.length : null

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 10, color: '#888', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Dividendo vs precio — últimos {years} años (diario, sin anualizar)
        </div>
        {latest && (
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

      {!loading && !error && points.length > 0 && (
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