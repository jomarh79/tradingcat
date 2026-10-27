'use client'

import { useEffect, useState, Fragment } from 'react'
import { X } from 'lucide-react'

interface IncomeEntry {
  fiscalYear: number
  fiscalPeriod: number
  endDate: string
  currency: string
  revenue: number | null
  costOfRevenue: number | null
  grossProfit: number | null
  opex: number | null
  sgaExp: number | null
  rndExp: number | null
  opIncome: number | null
  otherNetIncome: number | null
  ebt: number | null
  incomeTax: number | null
  netIncome: number | null
  dilutedAvgShares: number | null
  dilutedEps: number | null
  interestNet: number | null
}

interface ApiResponse {
  success: boolean
  symbol?: string
  annual?: IncomeEntry[]
  ttm?: IncomeEntry | null
  forwardEps?: { fiscalYear: number; eps: number; quartersCovered: number } | null
  error?: string
}

// Columna genérica — puede ser un año real (IncomeEntry) o una columna sintética (TTM/forward)
type Column = { key: string; label: string; entry: IncomeEntry | null; isForward?: boolean }

type RowKey = keyof Omit<IncomeEntry, 'fiscalYear' | 'fiscalPeriod' | 'endDate' | 'currency'>

interface RowDef {
  label: string
  key: RowKey
  growth?: boolean
  ratioOf?: RowKey // si está presente, la fila se muestra como % de otra fila (ej. Gross Profit / Revenue)
  decimals?: number
  isCurrency?: boolean
}

interface Section {
  title: string
  rows: RowDef[]
}

const SECTIONS: Section[] = [
  {
    title: 'Ingresos',
    rows: [
      { label: 'Revenue', key: 'revenue', growth: true, isCurrency: true },
      { label: 'Cost Of Revenue', key: 'costOfRevenue', isCurrency: true },
      { label: 'Gross Profit', key: 'grossProfit', isCurrency: true },
      { label: 'Gross Profit Ratio', key: 'grossProfit', ratioOf: 'revenue' },
    ],
  },
  {
    title: 'Utilidad Neta',
    rows: [
      { label: 'Net Income', key: 'netIncome', growth: true, isCurrency: true },
      { label: 'Net Income Ratio', key: 'netIncome', ratioOf: 'revenue' },
    ],
  },
  {
    title: 'EPS',
    rows: [
      { label: 'Diluted EPS', key: 'dilutedEps', growth: true, decimals: 2 },
    ],
  },
  {
    title: 'Acciones',
    rows: [
      { label: 'Diluted Avg Shares', key: 'dilutedAvgShares', growth: true, isCurrency: true },
    ],
  },
  {
    title: 'Gastos e Ingresos Operativos',
    rows: [
      { label: 'SG&A', key: 'sgaExp', isCurrency: true },
      { label: 'R&D', key: 'rndExp', isCurrency: true },
      { label: 'Operating Expenses', key: 'opex', isCurrency: true },
      { label: 'Operating Income', key: 'opIncome', isCurrency: true },
      { label: 'Operating Income Ratio', key: 'opIncome', ratioOf: 'revenue' },
    ],
  },
  {
    title: 'Resultado Final',
    rows: [
      { label: 'Interest (Expense)/Income, Net', key: 'interestNet', isCurrency: true },
      { label: 'Other Net Income', key: 'otherNetIncome', isCurrency: true },
      { label: 'Income Before Tax', key: 'ebt', isCurrency: true },
      { label: 'Income Tax Expense', key: 'incomeTax', isCurrency: true },
    ],
  },
]

function fmtCurrency(v: number | null): string {
  if (v == null) return '—'
  const abs = Math.abs(v)
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(2)}K`
  return `$${v.toFixed(2)}`
}

function fmtShares(v: number | null): string {
  if (v == null) return '—'
  const abs = Math.abs(v)
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${(v / 1e3).toFixed(2)}K`
  return v.toFixed(0)
}

function fmtNumber(v: number | null, decimals = 2): string {
  if (v == null) return '—'
  return v.toFixed(decimals)
}

function fmtPercent(v: number | null): string {
  if (v == null) return '—'
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

export default function FundamentalsModal({ ticker, onClose }: { ticker: string; onClose: () => void }) {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/webull/income-statement?symbol=${encodeURIComponent(ticker)}`)
      .then((r) => r.json())
      .then((json: ApiResponse) => {
        if (!json.success) { setError(json.error || 'Error desconocido'); return }
        setData(json)
      })
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => setLoading(false))
  }, [ticker])

  const annual = data?.annual || []
  const last10 = annual.slice(-10)

  const columns: Column[] = [
    ...last10.map((e) => ({ key: String(e.fiscalYear), label: String(e.fiscalYear), entry: e })),
    { key: 'ttm', label: 'TTM', entry: data?.ttm ?? null },
    ...(data?.forwardEps
      ? [{ key: 'fwd', label: `${data.forwardEps.fiscalYear}E`, entry: null, isForward: true }]
      : []),
  ]

  const getValue = (col: Column, key: RowKey): number | null => {
    if (col.isForward) {
      // Solo tenemos EPS estimado hacia adelante — el resto de filas queda vacío en esa columna
      return key === 'dilutedEps' ? (data?.forwardEps?.eps ?? null) : null
    }
    return col.entry ? col.entry[key] : null
  }

  const getGrowth = (colIdx: number, key: RowKey): number | null => {
    if (colIdx === 0) return null
    const curr = getValue(columns[colIdx], key)
    const prev = getValue(columns[colIdx - 1], key)
    if (curr == null || prev == null || prev === 0) return null
    return ((curr - prev) / Math.abs(prev)) * 100
  }

  const formatValue = (row: RowDef, col: Column): string => {
    if (row.ratioOf) {
      const numV = getValue(col, row.key)
      const den = getValue(col, row.ratioOf)
      if (numV == null || den == null || den === 0) return '—'
      return `${((numV / den) * 100).toFixed(2)}%`
    }
    const v = getValue(col, row.key)
    if (row.decimals != null) return v != null ? `$${fmtNumber(v, row.decimals)}` : '—'
    if (row.key === 'dilutedAvgShares') return fmtShares(v)
    if (row.isCurrency) return fmtCurrency(v)
    return v != null ? String(v) : '—'
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 900, margin: 0, color: '#fff' }}>
            Fundamentales — {ticker}
          </h2>
          <button onClick={onClose} style={closeBtnStyle}>
            <X size={18} />
          </button>
        </div>

        {loading && <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>Cargando estado de resultados...</div>}
        {error && <div style={{ padding: 40, textAlign: 'center', color: '#f43f5e' }}>{error}</div>}

        {!loading && !error && data && (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: 900 }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, textAlign: 'left', position: 'sticky', left: 0, background: '#0a0a0a' }}></th>
                    {columns.map((c) => (
                      <th key={c.key} style={{ ...thStyle, color: c.isForward ? '#00bfff' : '#888' }}>
                        {c.label}{c.isForward ? ' (est.)' : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SECTIONS.map((section) => (
                    <Fragment key={section.title}>
                      <tr>
                        <td colSpan={columns.length + 1} style={sectionTitleStyle}>
                          {section.title}
                        </td>
                      </tr>
                      {section.rows.map((row) => (
                        <Fragment key={row.label}>
                          <tr style={{ borderTop: '1px solid #151515' }}>
                            <td style={{ ...tdLabelStyle, position: 'sticky', left: 0, background: '#050505' }}>
                              {row.label}
                            </td>
                            {columns.map((c) => (
                              <td key={c.key} style={tdValueStyle}>
                                {formatValue(row, c)}
                              </td>
                            ))}
                          </tr>
                          {row.growth && (
                            <tr>
                              <td style={{ ...tdLabelStyle, position: 'sticky', left: 0, background: '#050505', color: '#555', fontStyle: 'italic' }}>
                                Growth
                              </td>
                              {columns.map((c, i) => {
                                const g = getGrowth(i, row.key)
                                return (
                                  <td key={c.key} style={{ ...tdValueStyle, color: g == null ? '#444' : g >= 0 ? '#22c55e' : '#f43f5e' }}>
                                    {fmtPercent(g)}
                                  </td>
                                )
                              })}
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ fontSize: 9, color: '#444', marginTop: 12, lineHeight: 1.5 }}>
              Fuente: Webull Fundamentals API. TTM = suma de los últimos 4 trimestres reportados (acciones diluidas: promedio del trimestre más reciente, no se suma).
              {data.forwardEps
                ? ` La columna ${data.forwardEps.fiscalYear}E es EPS estimado por analistas (suma de ${data.forwardEps.quartersCovered} trimestre${data.forwardEps.quartersCovered !== 1 ? 's' : ''} aún no reportado${data.forwardEps.quartersCovered !== 1 ? 's' : ''}) — el resto de las filas no tiene estimado disponible en Webull para ese año.`
                : ' No hay estimado de EPS disponible hacia adelante para este símbolo.'}
              {' '}No se incluyen Basic EPS ni EBITDA real (Webull no expone depreciación/amortización desglosada).
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20,
}
const modalStyle: React.CSSProperties = {
  background: '#080808', border: '1px solid #1a1a1a', borderRadius: 12,
  padding: 20, maxWidth: 1100, width: '100%', maxHeight: '85vh', overflowY: 'auto',
}
const closeBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: 4,
}
const thStyle: React.CSSProperties = {
  padding: '6px 10px', textAlign: 'right', fontSize: 10, fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap', borderBottom: '1px solid #1a1a1a',
}
const sectionTitleStyle: React.CSSProperties = {
  padding: '10px 6px 4px', fontSize: 10, fontWeight: 900, color: '#00bfff',
  textTransform: 'uppercase', letterSpacing: 0.5,
}
const tdLabelStyle: React.CSSProperties = {
  padding: '4px 10px', color: '#aaa', whiteSpace: 'nowrap', fontSize: 11,
}
const tdValueStyle: React.CSSProperties = {
  padding: '4px 10px', textAlign: 'right', color: '#ddd', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
}
