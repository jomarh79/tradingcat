'use client'

import { Suspense, useEffect, useState, Fragment } from 'react'
import { useSearchParams } from 'next/navigation'
import AppShell from '../AppShell'
import { BarChart2 } from 'lucide-react'

import { authedFetch } from "@/lib/authed-fetch";

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
}

interface IncomeApiResponse {
  success: boolean
  symbol?: string
  annual?: IncomeEntry[]
  ttm?: IncomeEntry | null
  forwardEps?: { fiscalYear: number; eps: number; quartersCovered: number } | null
  error?: string
}

interface OwnHistoryEntry {
  year: number
  endDate: string
  depreciationAmortization: number | null
}

interface FundamentalsApiResponse {
  ownHistory?: OwnHistoryEntry[]
  error?: string
}

// Columna genérica — año real, TTM o forward (estimado)
type Column = { key: string; label: string; entry: IncomeEntry | null; isForward?: boolean }

type RowKey = keyof Omit<IncomeEntry, 'fiscalYear' | 'fiscalPeriod' | 'endDate' | 'currency'> | 'ebitda'

interface RowDef {
  label: string
  key: RowKey
  growth?: boolean
  invertGrowth?: boolean // crecer es malo (más acciones = dilución): el color se invierte
  ratioOf?: RowKey
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
    title: 'EBITDA',
    rows: [
      { label: 'EBITDA (Operating Income + D&A)', key: 'ebitda', growth: true, isCurrency: true },
      { label: 'EBITDA Ratio', key: 'ebitda', ratioOf: 'revenue' },
    ],
  },
  {
    title: 'Acciones',
    rows: [
      { label: 'Diluted Avg Shares', key: 'dilutedAvgShares', growth: true, invertGrowth: true, isCurrency: true },
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
      { label: 'Other Net Income', key: 'otherNetIncome', isCurrency: true },
      { label: 'Income Before Tax', key: 'ebt', isCurrency: true },
      { label: 'Income Tax Expense', key: 'incomeTax', isCurrency: true },
    ],
  },
]

/* ─────────────────────────────────────────────────────────────
   FORMATO
───────────────────────────────────────────────────────────── */

// Escala con sufijo (K/M/B) y signo delante del símbolo: -$1.20B, no $-1.20B
function scaled(v: number, prefix: string, plainDecimals: number): string {
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs >= 1e9) return `${sign}${prefix}${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${sign}${prefix}${(abs / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${sign}${prefix}${(abs / 1e3).toFixed(2)}K`
  return `${sign}${prefix}${abs.toFixed(plainDecimals)}`
}
const fmtCurrency = (v: number | null) => (v == null ? '—' : scaled(v, '$', 2))
const fmtShares = (v: number | null) => (v == null ? '—' : scaled(v, '', 0))
const fmtEps = (v: number | null, decimals: number) =>
  v == null ? '—' : `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(decimals)}`
const fmtPercent = (v: number | null) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`)

/* ─────────────────────────────────────────────────────────────
   D&A (Finnhub) ↔ año de Webull
   Los dos proveedores no siempre numeran igual el año fiscal, así que se cruzan primero por la fecha de
   cierre del ejercicio (±45 días) y, solo si no hay coincidencia, por el número de año.
───────────────────────────────────────────────────────────── */

const dayMs = (d: string) => Date.parse(String(d || '').split('T')[0].split(' ')[0] + 'T00:00:00Z')
const MATCH_WINDOW_MS = 45 * 86400000

type DaIndex = { byDate: { ms: number; da: number }[]; byYear: Map<number, number> }
const EMPTY_DA: DaIndex = { byDate: [], byYear: new Map() }

function buildDaIndex(history: OwnHistoryEntry[] | undefined): DaIndex {
  const byDate: DaIndex['byDate'] = []
  const byYear = new Map<number, number>()
  history?.forEach((h) => {
    if (h.depreciationAmortization == null) return
    byYear.set(h.year, h.depreciationAmortization)
    const ms = dayMs(h.endDate)
    if (!Number.isNaN(ms)) byDate.push({ ms, da: h.depreciationAmortization })
  })
  return { byDate, byYear }
}

function findDa(index: DaIndex, entry: IncomeEntry): number | null {
  const target = dayMs(entry.endDate)
  if (!Number.isNaN(target)) {
    let best: { diff: number; da: number } | null = null
    for (const h of index.byDate) {
      const diff = Math.abs(h.ms - target)
      if (diff <= MATCH_WINDOW_MS && (!best || diff < best.diff)) best = { diff, da: h.da }
    }
    if (best) return best.da
  }
  return index.byYear.get(entry.fiscalYear) ?? null
}

/* ─────────────────────────────────────────────────────────────
   PAGE
───────────────────────────────────────────────────────────── */

function FundamentalsPageInner() {
  const searchParams = useSearchParams()
  const ticker = (searchParams.get('ticker') || '').toUpperCase()

  const [incomeData, setIncomeData] = useState<IncomeApiResponse | null>(null)
  const [daIndex, setDaIndex] = useState<DaIndex>(EMPTY_DA)
  const [daLoading, setDaLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setIncomeData(null)
    setDaIndex(EMPTY_DA)
    setError(null)
    if (!ticker) { setLoading(false); setDaLoading(false); return }

    let cancelled = false
    setLoading(true)
    setDaLoading(true)

    // El estado de resultados se muestra en cuanto llega; el D&A (más lento) solo completa el EBITDA después
    authedFetch(`/api/webull/income-statement?symbol=${encodeURIComponent(ticker)}`)
      .then((r) => r.json())
      .then((income: IncomeApiResponse) => {
        if (cancelled) return
        if (!income.success) setError(income.error || 'Error desconocido')
        else setIncomeData(income)
      })
      .catch((e) => { if (!cancelled) setError(String(e?.message ?? e)) })
      .finally(() => { if (!cancelled) setLoading(false) })

    fetch(`/api/fundamentals?symbol=${encodeURIComponent(ticker)}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((fund: FundamentalsApiResponse | null) => {
        if (!cancelled) setDaIndex(buildDaIndex(fund?.ownHistory))
      })
      .finally(() => { if (!cancelled) setDaLoading(false) })

    return () => { cancelled = true }
  }, [ticker])

  const annual = incomeData?.annual || []
  const last10 = annual.slice(-10)

  const columns: Column[] = [
    ...last10.map((e) => ({ key: String(e.fiscalYear), label: String(e.fiscalYear), entry: e })),
    { key: 'ttm', label: 'TTM', entry: incomeData?.ttm ?? null },
    ...(incomeData?.forwardEps
      ? [{ key: 'fwd', label: `${incomeData.forwardEps.fiscalYear}E`, entry: null, isForward: true }]
      : []),
  ]

  const getValue = (col: Column, key: RowKey): number | null => {
    if (key === 'ebitda') {
      if (col.isForward || !col.entry) return null // sin D&A no hay EBITDA para TTM/forward
      const opIncome = col.entry.opIncome
      const da = col.key === 'ttm' ? null : findDa(daIndex, col.entry)
      if (opIncome == null || da == null) return null
      return opIncome + da
    }
    if (col.isForward) {
      return key === 'dilutedEps' ? (incomeData?.forwardEps?.eps ?? null) : null
    }
    return col.entry ? (col.entry[key as keyof IncomeEntry] as number | null) : null
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
    if (row.decimals != null) return fmtEps(v, row.decimals)
    if (row.key === 'dilutedAvgShares') return fmtShares(v)
    if (row.isCurrency) return fmtCurrency(v)
    return v != null ? String(v) : '—'
  }

  const hasAnyEbitda = columns.some((c) => getValue(c, 'ebitda') != null)
  const currency = last10[last10.length - 1]?.currency
  const nonUsd = currency && currency !== 'USD' ? currency : null

  return (
    <AppShell>
      <div style={{ maxWidth: 1200, margin: '20px auto', padding: '0 28px', color: 'white' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <BarChart2 size={20} color="#00bfff" />
          <h1 style={{ fontSize: 18, fontWeight: 900, margin: 0 }}>
            Fundamentales — {ticker || 'Selecciona un ticker'}
          </h1>
        </div>

        {!ticker && (
          <div style={{ padding: 60, textAlign: 'center', color: '#666' }}>
            Abre esta página desde un ticker de tu watchlist o de tus trades — falta <code>?ticker=</code> en la URL.
          </div>
        )}

        {ticker && loading && (
          <div style={{ padding: 60, textAlign: 'center', color: '#666' }}>Cargando estado de resultados...</div>
        )}

        {ticker && error && (
          <div style={{ padding: 40, textAlign: 'center', color: '#f43f5e', background: '#080808', border: '1px solid #1a1a1a', borderRadius: 12 }}>
            {error}
          </div>
        )}

        {ticker && !loading && !error && incomeData && (
          <>
            <div style={{ overflowX: 'auto', background: '#080808', border: '1px solid #1a1a1a', borderRadius: 12, padding: 16 }}>
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
                                {row.key === 'ebitda' && daLoading && !row.ratioOf ? '…' : formatValue(row, c)}
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
                                const good = g != null && (row.invertGrowth ? g <= 0 : g >= 0)
                                return (
                                  <td key={c.key} style={{ ...tdValueStyle, color: g == null ? '#444' : good ? '#22c55e' : '#f43f5e' }}>
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

            <div style={{ fontSize: 9, color: '#444', marginTop: 12, lineHeight: 1.6 }}>
              Fuente: Webull Fundamentals API (estado de resultados) + Finnhub (D&A para EBITDA).
              {' '}TTM = suma de los últimos 4 trimestres consecutivos reportados (acciones diluidas: promedio del trimestre más reciente, no se suma); si falta un trimestre o un dato, esa celda queda en «—».
              {' '}El crecimiento de TTM se compara contra el último año completo, no contra el mismo periodo del año anterior.
              {' '}En «Diluted Avg Shares» el crecimiento positivo (más acciones = dilución) se muestra en rojo.
              {incomeData.forwardEps
                ? ` La columna ${incomeData.forwardEps.fiscalYear}E es EPS estimado por analistas (suma de ${incomeData.forwardEps.quartersCovered} trimestre${incomeData.forwardEps.quartersCovered !== 1 ? 's' : ''} aún no reportado${incomeData.forwardEps.quartersCovered !== 1 ? 's' : ''}) — el resto de las filas no tiene estimado disponible para ese año.`
                : ' No hay estimado de EPS disponible hacia adelante para este símbolo.'}
              {' '}EBITDA = Operating Income (Webull) + Depreciación y Amortización (Finnhub, 10-K), cruzados por fecha de cierre del ejercicio — solo disponible para años anuales con reporte 10-K (no TTM ni forward). No se incluye Basic EPS (Webull solo expone Diluted EPS).
              {!daLoading && !hasAnyEbitda && ' No se encontró D&A para este símbolo — puede ser un ETF u otro caso sin 10-K propio.'}
              {nonUsd && ` Los montos están en ${nonUsd}, no en dólares (el símbolo $ se muestra solo por formato).`}
            </div>
          </>
        )}
      </div>
    </AppShell>
  )
}

export default function FundamentalsPage() {
  return (
    <Suspense fallback={<AppShell><div style={{ padding: 40, color: '#666' }}>Cargando...</div></AppShell>}>
      <FundamentalsPageInner />
    </Suspense>
  )
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