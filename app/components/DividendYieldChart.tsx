'use client'

import { useEffect, useRef, useState } from 'react'
import { createChart, LineSeries, ColorType } from 'lightweight-charts'

const C = {
  accent: '#00bfff', success: '#22c55e', danger: '#f43f5e', warning: '#eab308',
  card: '#080808', border: '#1a1a1a',
}

interface YieldPoint {
  date: string
  amount: number
  price: number
  yieldPct: number
}

// Cierre más cercano a una fecha dada (± hasta 10 días)
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

export default function DividendYieldChart({ ticker, years = 10 }: { ticker: string; years?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [points, setPoints] = useState<YieldPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ticker) return
    setLoading(true)
    setError(null)

    Promise.all([
      fetch(`/api/dividends?symbol=${encodeURIComponent(ticker)}&years=${years}`).then(r => r.json()),
      fetch('/api/chart-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: ticker }),
      }).then(r => r.json()),
    ])
      .then(([divData, priceData]) => {
        if (divData.error) { setError(divData.error); return }
        if (priceData.error) { setError(priceData.error); return }

        const dailyCloses = priceData.dailyCloses || []
        const dividends = divData.dividends || []

        const computed: YieldPoint[] = dividends
          .map((d: { date: string; amount: number }) => {
            const price = findNearestClose(dailyCloses, d.date)
            if (!price || price <= 0) return null
            return { date: d.date, amount: d.amount, price, yieldPct: (d.amount / price) * 100 }
          })
          .filter((p: YieldPoint | null): p is YieldPoint => p !== null)

        setPoints(computed)
      })
      .catch(e => setError(String(e?.message ?? e)))
      .finally(() => setLoading(false))
  }, [ticker, years])

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

    const line = chart.addSeries(LineSeries, {
      color: C.warning, lineWidth: 2,
      pointMarkersVisible: true, pointMarkersRadius: 3,
      lastValueVisible: true, priceLineVisible: false,
      priceFormat: { type: 'custom', formatter: (v: number) => `${v.toFixed(2)}%` },
    })
    line.setData(points.map(p => ({ time: p.date, value: p.yieldPct })) as any)

    // Línea punteada en el promedio histórico — referencia rápida de "alto vs bajo"
    const avg = points.reduce((sum, p) => sum + p.yieldPct, 0) / points.length
    line.createPriceLine({
      price: avg, color: C.accent, lineWidth: 1, lineStyle: 2,
      axisLabelVisible: true, title: 'Promedio',
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
  const avg = points.length ? points.reduce((sum, p) => sum + p.yieldPct, 0) / points.length : null

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 10, color: '#888', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Dividendo vs precio — últimos {years} años (por pago, sin anualizar)
        </div>
        {latest && (
          <div style={{ fontSize: 11, color: '#666' }}>
            Último: <span style={{ color: latest.yieldPct >= (avg || 0) ? C.success : C.danger, fontWeight: 700 }}>
              {latest.yieldPct.toFixed(2)}%
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
            Cada punto = dividendo pagado ÷ precio de la acción en ese momento (no es el yield anualizado que reportan otros sitios). Línea punteada azul = promedio del periodo — por encima sugiere dividendo relativamente alto vs el precio de ese momento; por debajo, relativamente bajo.
          </div>
        </>
      )}
    </div>
  )
}