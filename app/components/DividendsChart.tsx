'use client'

import { useEffect, useRef, useState } from 'react'
import { createChart, LineSeries, ColorType } from 'lightweight-charts'

const C = {
  accent: '#00bfff', success: '#22c55e', danger: '#f43f5e',
  card: '#080808', border: '#1a1a1a',
}

interface DividendPoint {
  date: string
  amount: number
}

export default function DividendsChart({ ticker, years = 10 }: { ticker: string; years?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [dividends, setDividends] = useState<DividendPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ticker) return
    setLoading(true)
    setError(null)
    fetch(`/api/dividends?symbol=${encodeURIComponent(ticker)}&years=${years}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError(data.error); return }
        setDividends(data.dividends || [])
      })
      .catch(e => setError(String(e?.message ?? e)))
      .finally(() => setLoading(false))
  }, [ticker, years])

  useEffect(() => {
    if (!ref.current || dividends.length === 0) return

    const chart = createChart(ref.current, {
      layout: { background: { type: ColorType.Solid, color: '#080808' }, textColor: '#999' },
      grid: { vertLines: { color: '#141414' }, horzLines: { color: '#141414' } },
      width: ref.current.clientWidth,
      height: 260,
      rightPriceScale: { borderColor: '#222' },
      timeScale: { borderColor: '#222' },
    })

    const line = chart.addSeries(LineSeries, {
      color: C.success, lineWidth: 2,
      pointMarkersVisible: true, pointMarkersRadius: 3,
      lastValueVisible: true, priceLineVisible: false,
    })
    line.setData(dividends.map(d => ({ time: d.date, value: d.amount })) as any)

    chart.timeScale().fitContent()

    const handleResize = () => { if (ref.current) chart.applyOptions({ width: ref.current.clientWidth }) }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
    }
  }, [dividends])

  const totalPaid = dividends.reduce((sum, d) => sum + d.amount, 0)
  const latest = dividends[dividends.length - 1]
  const earliest = dividends[0]

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 10, color: '#888', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Historial de dividendos — últimos {years} años
        </div>
        {latest && (
          <div style={{ fontSize: 11, color: '#666' }}>
            Último: <span style={{ color: C.success, fontWeight: 700 }}>${latest.amount.toFixed(3)}</span>
            {' '}({new Date(latest.date).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })})
          </div>
        )}
      </div>

      {loading && <div style={{ padding: 40, textAlign: 'center', color: '#555', fontSize: 12 }}>Cargando...</div>}
      {error && <div style={{ padding: 20, textAlign: 'center', color: C.danger, fontSize: 12 }}>{error}</div>}

      {!loading && !error && dividends.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: '#444', fontSize: 12 }}>
          Sin dividendos registrados para este símbolo en los últimos {years} años.
        </div>
      )}

      {!loading && !error && dividends.length > 0 && (
        <>
          <div ref={ref} style={{ width: '100%', height: 260 }} />
          <div style={{ fontSize: 9, color: '#444', marginTop: 8 }}>
            {dividends.length} pagos registrados · total acumulado ${totalPaid.toFixed(2)} por acción
            {earliest && ` · desde ${new Date(earliest.date).toLocaleDateString('es-MX', { month: 'short', year: 'numeric' })}`}
          </div>
        </>
      )}
    </div>
  )
}