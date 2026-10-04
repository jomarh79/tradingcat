'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createChart, LineSeries, ColorType, type Time } from 'lightweight-charts'

const C = {
  accent: '#00bfff', success: '#22c55e', danger: '#f43f5e',
  card: '#080808', border: '#1a1a1a',
}

interface DividendPoint {
  date: string
  amount: number
}

const dayKey = (d: any) => String(d || '').split('T')[0].split(' ')[0]
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

// 'yyyy-MM-dd' → fecha LOCAL. new Date('2026-08-15') se interpreta como UTC y en México mostraba el día anterior.
function fmtDay(d: string, opts: Intl.DateTimeFormatOptions): string {
  const m = dayKey(d).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return '—'
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('es-MX', opts)
}

export default function DividendsChart({ ticker, years = 10 }: { ticker: string; years?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [dividends, setDividends] = useState<DividendPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDividends([])
    setError(null)
    if (!ticker) { setLoading(false); return }

    let cancelled = false
    setLoading(true)

    fetch(`/api/dividends?symbol=${encodeURIComponent(ticker)}&years=${years}`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return // el ticker cambió mientras llegaba la respuesta
        if (data.error) { setError(data.error); return }
        setDividends(data.dividends || [])
      })
      .catch(e => { if (!cancelled) setError(String(e?.message ?? e)) })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [ticker, years])

  // La librería exige fechas únicas y en orden ascendente (si no, lanza error y la gráfica no se dibuja).
  // Aquí se ordena, se descartan fechas inválidas y los pagos del mismo día se suman (regular + especial).
  const { points, count } = useMemo(() => {
    const byDay = new Map<string, number>()
    let valid = 0
    for (const d of dividends) {
      const key = dayKey(d.date)
      const amount = Number(d.amount)
      if (!DAY_RE.test(key) || !Number.isFinite(amount)) continue
      byDay.set(key, (byDay.get(key) ?? 0) + amount)
      valid++
    }
    const sorted = Array.from(byDay.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([date, amount]) => ({ date, amount: parseFloat(amount.toFixed(6)) }))
    return { points: sorted, count: valid }
  }, [dividends])

  const hasChart = !loading && !error && points.length > 0

  // Depende de hasChart: el contenedor solo existe cuando hay datos, y la gráfica se crea justo entonces
  // (antes dependía solo de los datos y se apoyaba en que React agrupara dos actualizaciones en un render).
  useEffect(() => {
    if (!hasChart || !ref.current) return

    const chart = createChart(ref.current, {
      layout: { background: { type: ColorType.Solid, color: '#080808' }, textColor: '#999' },
      grid: { vertLines: { color: '#141414' }, horzLines: { color: '#141414' } },
      autoSize: true, // sigue el tamaño del contenedor (ventana, barra lateral, etc.), sin listener de resize
      rightPriceScale: { borderColor: '#222' },
      timeScale: { borderColor: '#222' },
    })

    const line = chart.addSeries(LineSeries, {
      color: C.success, lineWidth: 2,
      pointMarkersVisible: true, pointMarkersRadius: 3,
      lastValueVisible: true, priceLineVisible: false,
      // Los dividendos se pagan con 3 decimales ($0.255); con el formato por defecto el eje los redondeaba a 2
      priceFormat: { type: 'price', precision: 3, minMove: 0.001 },
    })
    line.setData(points.map(d => ({ time: d.date as Time, value: d.amount })))

    chart.timeScale().fitContent()

    return () => { chart.remove() }
  }, [hasChart, points])

  const totalPaid = points.reduce((sum, d) => sum + d.amount, 0)
  const latest = points[points.length - 1]
  const earliest = points[0]

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 10, color: '#888', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Historial de dividendos — últimos {years} años
        </div>
        {hasChart && latest && (
          <div style={{ fontSize: 11, color: '#666' }}>
            Último: <span style={{ color: C.success, fontWeight: 700 }}>${latest.amount.toFixed(3)}</span>
            {' '}({fmtDay(latest.date, { day: '2-digit', month: 'short', year: 'numeric' })})
          </div>
        )}
      </div>

      {loading && <div style={{ padding: 40, textAlign: 'center', color: '#555', fontSize: 12 }}>Cargando...</div>}
      {error && <div style={{ padding: 20, textAlign: 'center', color: C.danger, fontSize: 12 }}>{error}</div>}

      {!loading && !error && points.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: '#444', fontSize: 12 }}>
          Sin dividendos registrados para este símbolo en los últimos {years} años.
        </div>
      )}

      {hasChart && (
        <>
          <div ref={ref} style={{ width: '100%', height: 260 }} />
          <div style={{ fontSize: 9, color: '#444', marginTop: 8 }}>
            {count} pagos registrados · total acumulado ${totalPaid.toFixed(2)} por acción
            {earliest && ` · desde ${fmtDay(earliest.date, { month: 'short', year: 'numeric' })}`}
          </div>
        </>
      )}
    </div>
  )
}