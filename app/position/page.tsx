'use client' 
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase' 
import AppShell from '../AppShell'
import { Activity, Building2, Calendar, DollarSign, TrendingUp, TrendingDown, } from 'lucide-react'

const C = {
  accent: '#00bfff',
  success: '#22c55e',
  danger: '#f43f5e',
  warning: '#eab308',
  card: '#080808',
  border: '#1a1a1a',
}

interface PositionDetail {
  success: boolean
  symbol?: string

  profile?: {
    companyName: string | null
    establishDate: string | null
    exchange: string | null
    description: string | null
    employees: number | null
    address: string | null
    ceo: string | null
    industries: string[]
  } | null

  nextEarnings?: {
    fiscalYear: number
    fiscalPeriod: number
    expectedDate: string
    epsEst: number | null
    revEst: number | null
  } | null

  nextDividend?: {
    amount: number | null
    exDivDate: string
    payDate: string
  } | null

  analystTarget?: {
    mean: number | null
    low: number | null
    high: number | null
    median: number | null
  } | null

  performance?: {
    periods: {
      label: string
      stockReturn: number | null
      spyReturn: number | null
      alpha: number | null
    }[]
    dataCoverageYears: number
  }

  error?: string
}

/* ─────────────────────────────────────────────────────────────
   FORMATEADORES
───────────────────────────────────────────────────────────── */

function fmtMoney(v: number | null | undefined): string {
  if (v == null || Number.isNaN(Number(v))) return '—'

  return `$${Number(v).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function fmtPercent(v: number | null | undefined): string {
  if (v == null || Number.isNaN(Number(v))) return '—'

  return `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(2)}%`
}

/*
 * Convierte fechas de distintos formatos sin producir
 * "Invalid Date".
 *
 * Soporta:
 * 2026-08-21
 * 2026-08-21 15:30:00
 * 2026-08-21T15:30:00
 * 2026-08-21T15:30:00+00:00
 * 08/21/2026
 */
function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'

  try {
    const raw = String(d).trim()

    if (!raw) return '—'

    // ── YYYY-MM-DD ─────────────────────────────────────────────
    const matchYMD = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)

    if (matchYMD) {
      const [, year, month, day] = matchYMD

      const date = new Date(
        Number(year),
        Number(month) - 1,
        Number(day)
      )

      if (isNaN(date.getTime())) return '—'

      return date.toLocaleDateString('es-MX', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    }

    // ── MM/DD/YYYY ─────────────────────────────────────────────
    const matchMDY = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)

    if (matchMDY) {
      const [, month, day, year] = matchMDY

      const date = new Date(
        Number(year),
        Number(month) - 1,
        Number(day)
      )

      if (isNaN(date.getTime())) return '—'

      return date.toLocaleDateString('es-MX', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    }

    // ── ISO / timestamp ────────────────────────────────────────
    const date = new Date(raw)

    if (isNaN(date.getTime())) return '—'

    return date.toLocaleDateString('es-MX', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return '—'
  }
}

/* ─────────────────────────────────────────────────────────────
   CARD
───────────────────────────────────────────────────────────── */

function Card({
  title,
  icon,
  children,
  gridColumn = 'span 4',
}: {
  title: string
  icon?: React.ReactNode
  children: React.ReactNode
  gridColumn?: string
}) {
  return (
    <div
      style={{
        gridColumn,
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: 16,
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 12,
        }}
      >
        {icon}

        <div
          style={{
            fontSize: 11,
            color: '#888',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          }}
        >
          {title}
        </div>
      </div>

      {children}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
   STAT ROW
───────────────────────────────────────────────────────────── */

function StatRow({
  label,
  value,
  color,
}: {
  label: string
  value: string
  color?: string
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 10,
        padding: '5px 0',
        borderTop: '1px solid #151515',
        fontSize: 12,
      }}
    >
      <span
        style={{
          color: '#888',
          minWidth: 0,
        }}
      >
        {label}
      </span>

      <span
        style={{
          color: color || '#ddd',
          fontWeight: 700,
          textAlign: 'right',
        }}
      >
        {value}
      </span>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
   PAGE
───────────────────────────────────────────────────────────── */

function PositionPageInner() {
  const searchParams = useSearchParams()

  const ticker = (searchParams.get('ticker') || '').toUpperCase()
  const tradeId = searchParams.get('tradeId')

  const [trade, setTrade] = useState<any | null>(null)
  const [executions, setExecutions] = useState<any[]>([])
  const [detail, setDetail] = useState<PositionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  /* ───────────────────────────────────────────────────────────
     CARGAR TRADE
  ─────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (!ticker) return

    const loadTrade = tradeId
      ? supabase
          .from('trades')
          .select('*, portfolios(name)')
          .eq('id', tradeId)
          .single()
      : supabase
          .from('trades')
          .select('*, portfolios(name)')
          .eq('ticker', ticker)
          .eq('status', 'open')
          .order('open_date', { ascending: false })
          .limit(1)
          .single()

    loadTrade.then(({ data }) => {
      setTrade(data || null)

      if (data?.id) {
        supabase
          .from('trade_executions')
          .select('*')
          .eq('trade_id', data.id)
          .order('executed_at', { ascending: true })
          .then(({ data: execs }) => {
            setExecutions(execs || [])
          })
      }
    })
  }, [ticker, tradeId])

  /* ───────────────────────────────────────────────────────────
     CARGAR DATOS WEBULL
  ─────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (!ticker) return

    setLoading(true)
    setError(null)

    fetch(
      `/api/webull/position-detail?symbol=${encodeURIComponent(ticker)}`
    )
      .then((r) => r.json())
      .then((json: PositionDetail) => {
        if (!json.success) {
          setError(json.error || 'Error desconocido')
          return
        }

        setDetail(json)
      })
      .catch((e) => {
        setError(String(e?.message ?? e))
      })
      .finally(() => {
        setLoading(false)
      })
  }, [ticker])

  /* ───────────────────────────────────────────────────────────
     SIN TICKER
  ─────────────────────────────────────────────────────────── */

  if (!ticker) {
    return (
      <AppShell>
        <div
          style={{
            padding: 60,
            textAlign: 'center',
            color: '#666',
          }}
        >
          Abre esta página desde un trade abierto — falta{' '}
          <code>?ticker=</code> en la URL.
        </div>
      </AppShell>
    )
  }

  /* ───────────────────────────────────────────────────────────
     CÁLCULOS
  ─────────────────────────────────────────────────────────── */

  const qty = Number(trade?.quantity || 0)

  const invested = Number(trade?.total_invested || 0)

  const curPrice = Number(
    trade?.last_price ||
      trade?.entry_price ||
      0
  )

  const avgPrice =
    qty > 0
      ? invested / qty
      : Number(trade?.entry_price || 0)

  const curValue = curPrice * qty

  const unrealizedPnl = curValue - invested

  const unrealizedPnlPct =
    avgPrice > 0
      ? ((curPrice - avgPrice) / avgPrice) * 100
      : 0

  const realizedPnl = Number(
    trade?.realized_pnl || 0
  )

  const distTo = (
    target: number | null | undefined
  ) =>
    target && curPrice > 0
      ? ((target - curPrice) / curPrice) * 100
      : null

  /* ───────────────────────────────────────────────────────────
     RENDER
  ─────────────────────────────────────────────────────────── */

  return (
    <AppShell>
      <div
        style={{
          maxWidth: 1300,
          margin: '20px auto',
          padding: '0 28px',
          color: 'white',
        }}
      >

        {/* ─────────────────────────────────────────────────────
            HEADER
        ───────────────────────────────────────────────────── */}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 20,
            flexWrap: 'wrap',
          }}
        >
          <Activity
            size={20}
            color={C.accent}
          />

          <h1
            style={{
              fontSize: 18,
              fontWeight: 900,
              margin: 0,
            }}
          >
            {ticker}
          </h1>

          {detail?.profile?.companyName && (
            <span
              style={{
                fontSize: 13,
                color: '#888',
                fontWeight: 500,
              }}
            >
              {detail.profile.companyName}
            </span>
          )}

          <span
            style={{
              fontSize: 15,
              color: '#fff',
              fontWeight: 700,
            }}
          >
            {fmtMoney(curPrice)}
          </span>

          {trade?.day_change != null && (
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                padding: '3px 8px',
                borderRadius: 5,
                color:
                  Number(trade.day_change) >= 0
                    ? C.success
                    : C.danger,
                background:
                  Number(trade.day_change) >= 0
                    ? 'rgba(34,197,94,0.1)'
                    : 'rgba(244,63,94,0.1)',
              }}
            >
              {Number(trade.day_change) >= 0
                ? '+'
                : ''}
              {Number(trade.day_change).toFixed(2)}%
            </span>
          )}

          {detail?.profile?.exchange && (
            <span
              style={{
                fontSize: 10,
                color: '#555',
                border: '1px solid #222',
                borderRadius: 5,
                padding: '2px 8px',
              }}
            >
              {detail.profile.exchange}
            </span>
          )}

          {trade?.portfolios?.name && (
            <span
              style={{
                fontSize: 10,
                color: '#555',
                border: '1px solid #222',
                borderRadius: 5,
                padding: '2px 8px',
              }}
            >
              {trade.portfolios.name}
            </span>
          )}
        </div>

        {/* ─────────────────────────────────────────────────────
            ERROR
        ───────────────────────────────────────────────────── */}

        {error && (
          <div
            style={{
              padding: 20,
              marginBottom: 16,
              textAlign: 'center',
              color: C.danger,
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 12,
            }}
          >
            {error}
          </div>
        )}

        {/* =====================================================
            GRID PRINCIPAL

            FILA 1:
            Posición | Stop Loss / TP | Analistas

            FILA 2:
            Earnings | Dividendo | Empresa | S&P 500

            FILA 3:
            Descripción

            FILA 4:
            Historial
        ===================================================== */}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns:
              'repeat(12, minmax(0, 1fr))',
            gap: 14,
          }}
        >

          {/* ═══════════════════════════════════════════════════
              FILA 1 — POSICIÓN
          ═══════════════════════════════════════════════════ */}

          <Card
            title="Posición"
            icon={
              <DollarSign
                size={14}
                color={C.accent}
              />
            }
            gridColumn="span 4"
          >
            <StatRow
              label="Invertido"
              value={fmtMoney(invested)}
            />

            <StatRow
              label="Cantidad de acciones"
              value={qty.toLocaleString(
                'en-US',
                {
                  maximumFractionDigits: 4,
                }
              )}
            />

            <StatRow
              label="Precio promedio"
              value={fmtMoney(avgPrice)}
            />

            <StatRow
              label="Valor actual"
              value={fmtMoney(curValue)}
            />

            <StatRow
              label="PnL no realizado"
              value={`${fmtMoney(
                unrealizedPnl
              )} (${fmtPercent(
                unrealizedPnlPct
              )})`}
              color={
                unrealizedPnl >= 0
                  ? C.success
                  : C.danger
              }
            />

            <StatRow
              label="PnL realizado"
              value={fmtMoney(realizedPnl)}
              color={
                realizedPnl >= 0
                  ? C.success
                  : C.danger
              }
            />
          </Card>

          {/* ═══════════════════════════════════════════════════
              FILA 1 — STOP LOSS / TAKE PROFITS
          ═══════════════════════════════════════════════════ */}

          <Card
            title="Stop Loss / Take Profits"
            icon={
              <TrendingDown
                size={14}
                color={C.danger}
              />
            }
            gridColumn="span 4"
          >
            <StatRow
              label={`Stop Loss (${fmtMoney(
                trade?.stop_loss
              )})`}
              value={fmtPercent(
                distTo(trade?.stop_loss)
              )}
              color={
                trade?.stop_hit
                  ? '#555'
                  : C.danger
              }
            />

            <StatRow
              label={`TP 1 (${fmtMoney(
                trade?.take_profit_1
              )})`}
              value={
                trade?.tp1_hit
                  ? '✓ Vendido'
                  : fmtPercent(
                      distTo(
                        trade?.take_profit_1
                      )
                    )
              }
              color={
                trade?.tp1_hit
                  ? '#555'
                  : C.success
              }
            />

            <StatRow
              label={`TP 2 (${fmtMoney(
                trade?.take_profit_2
              )})`}
              value={
                trade?.tp2_hit
                  ? '✓ Vendido'
                  : fmtPercent(
                      distTo(
                        trade?.take_profit_2
                      )
                    )
              }
              color={
                trade?.tp2_hit
                  ? '#555'
                  : C.success
              }
            />

            <StatRow
              label={`TP 3 (${fmtMoney(
                trade?.take_profit_3
              )})`}
              value={
                trade?.tp3_hit
                  ? '✓ Vendido'
                  : fmtPercent(
                      distTo(
                        trade?.take_profit_3
                      )
                    )
              }
              color={
                trade?.tp3_hit
                  ? '#555'
                  : C.success
              }
            />
          </Card>

          {/* ═══════════════════════════════════════════════════
              FILA 1 — ANALISTAS
          ═══════════════════════════════════════════════════ */}

          <Card
            title="Analistas"
            icon={
              <TrendingUp
                size={14}
                color={C.warning}
              />
            }
            gridColumn="span 4"
          >
            {loading ? (
              <div
                style={{
                  color: '#555',
                  fontSize: 12,
                }}
              >
                Cargando...
              </div>
            ) : (
              <>
                <StatRow
                  label="Promedio (consenso)"
                  value={fmtMoney(
                    detail?.analystTarget
                      ?.mean
                  )}
                />

                <StatRow
                  label="Más alto"
                  value={fmtMoney(
                    detail?.analystTarget
                      ?.high
                  )}
                />

                <StatRow
                  label="Más bajo"
                  value={fmtMoney(
                    detail?.analystTarget
                      ?.low
                  )}
                />

                <StatRow
                  label="Mediana"
                  value={fmtMoney(
                    detail?.analystTarget
                      ?.median
                  )}
                />

                <StatRow
                  label="Distancia al consenso"
                  value={fmtPercent(
                    distTo(
                      detail?.analystTarget
                        ?.mean
                    )
                  )}
                  color={
                    distTo(
                      detail?.analystTarget
                        ?.mean
                    ) != null &&
                    distTo(
                      detail?.analystTarget
                        ?.mean
                    )! >= 0
                      ? C.success
                      : C.danger
                  }
                />
              </>
            )}
          </Card>

          {/* ═══════════════════════════════════════════════════
              FILA 2 — EARNINGS
          ═══════════════════════════════════════════════════ */}

          <Card
            title="Próximo reporte de resultados"
            icon={
              <Calendar
                size={14}
                color={C.accent}
              />
            }
            gridColumn="span 3"
          >
            {loading ? (
              <div
                style={{
                  color: '#555',
                  fontSize: 12,
                }}
              >
                Cargando...
              </div>
            ) : detail?.nextEarnings ? (
              <>
                <StatRow
                  label="Fecha estimada"
                  value={fmtDate(
                    detail.nextEarnings
                      .expectedDate
                  )}
                />

                <StatRow
                  label="EPS estimado"
                  value={
                    detail.nextEarnings
                      .epsEst != null
                      ? `$${detail.nextEarnings.epsEst.toFixed(
                          2
                        )}`
                      : '—'
                  }
                />

                <StatRow
                  label="Ingresos estimados"
                  value={
                    detail.nextEarnings
                      .revEst != null
                      ? `${fmtMoney(
                          detail.nextEarnings
                            .revEst / 1e9
                        )}B`
                      : '—'
                  }
                />
              </>
            ) : (
              <div
                style={{
                  color: '#555',
                  fontSize: 12,
                }}
              >
                Sin datos de earnings para este
                símbolo.
              </div>
            )}
          </Card>

          {/* ═══════════════════════════════════════════════════
              FILA 2 — DIVIDENDO
          ═══════════════════════════════════════════════════ */}

          <Card
            title="Próximo dividendo"
            icon={
              <DollarSign
                size={14}
                color={C.success}
              />
            }
            gridColumn="span 3"
          >
            {loading ? (
              <div
                style={{
                  color: '#555',
                  fontSize: 12,
                }}
              >
                Cargando...
              </div>
            ) : detail?.nextDividend ? (
              <>
                <StatRow
                  label="Monto por acción"
                  value={fmtMoney(
                    detail.nextDividend
                      .amount
                  )}
                />

                <StatRow
                  label="Fecha ex-dividendo"
                  value={fmtDate(
                    detail.nextDividend
                      .exDivDate
                  )}
                />

                <StatRow
                  label="Fecha de pago"
                  value={fmtDate(
                    detail.nextDividend
                      .payDate
                  )}
                />

                <StatRow
                  label="Ingreso estimado (tu posición)"
                  value={fmtMoney(
                    (detail.nextDividend
                      .amount || 0) * qty
                  )}
                />
              </>
            ) : (
              <div
                style={{
                  color: '#555',
                  fontSize: 12,
                }}
              >
                Sin dividendos programados para
                este símbolo.
              </div>
            )}
          </Card>

          {/* ═══════════════════════════════════════════════════
              FILA 2 — EMPRESA
          ═══════════════════════════════════════════════════ */}

          <Card
            title="Empresa"
            icon={
              <Building2
                size={14}
                color={C.accent}
              />
            }
            gridColumn="span 3"
          >
            {loading ? (
              <div
                style={{
                  color: '#555',
                  fontSize: 12,
                }}
              >
                Cargando...
              </div>
            ) : detail?.profile ? (
              <>
                <StatRow
                  label="CEO"
                  value={
                    detail.profile.ceo || '—'
                  }
                />

                <StatRow
                  label="Empleados"
                  value={
                    detail.profile
                      .employees != null
                      ? detail.profile.employees.toLocaleString(
                          'en-US'
                        )
                      : '—'
                  }
                />

                <StatRow
                  label="Fundada"
                  value={
                    detail.profile
                      .establishDate
                      ? fmtDate(
                          detail.profile
                            .establishDate
                        )
                      : '—'
                  }
                />

                <StatRow
                  label="País"
                  value={
                    detail.profile.address
                      ?.split(',')
                      .pop()
                      ?.trim() || '—'
                  }
                />

                <StatRow
                  label="Industria"
                  value={
                    detail.profile
                      .industries?.[0] || '—'
                  }
                />
              </>
            ) : (
              <div
                style={{
                  color: '#555',
                  fontSize: 12,
                }}
              >
                Sin perfil disponible.
              </div>
            )}
          </Card>

          {/* ═══════════════════════════════════════════════════
              FILA 2 — RENDIMIENTO VS S&P 500
          ═══════════════════════════════════════════════════ */}

          <div
            style={{
              gridColumn: 'span 3',
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 12,
              padding: 16,
              minWidth: 0,
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: '#888',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                marginBottom: 12,
              }}
            >
              Rendimiento vs S&amp;P 500
            </div>

            {loading ? (
              <div
                style={{
                  color: '#555',
                  fontSize: 12,
                  padding: 20,
                  textAlign: 'center',
                }}
              >
                Cargando...
              </div>
            ) : (
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 12,
                }}
              >
                <thead>
                  <tr>
                    {[
                      'Periodo',
                      ticker,
                      'S&P 500',
                      'Alfa',
                    ].map((h, i) => (
                      <th
                        key={i}
                        style={{
                          textAlign:
                            i === 0
                              ? 'left'
                              : 'right',
                          color: '#555',
                          fontSize: 10,
                          fontWeight: 700,
                          padding:
                            '4px 4px',
                          textTransform:
                            'uppercase',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {detail?.performance?.periods.map(
                    (p) => (
                      <tr
                        key={p.label}
                        style={{
                          borderTop:
                            '1px solid #151515',
                        }}
                      >
                        <td
                          style={{
                            padding:
                              '6px 4px',
                            color: '#aaa',
                          }}
                        >
                          {p.label}
                        </td>

                        <td
                          style={{
                            padding:
                              '6px 4px',
                            textAlign:
                              'right',
                            color:
                              p.stockReturn !=
                                null &&
                              p.stockReturn >=
                                0
                                ? C.success
                                : C.danger,
                            fontWeight: 700,
                          }}
                        >
                          {fmtPercent(
                            p.stockReturn
                          )}
                        </td>

                        <td
                          style={{
                            padding:
                              '6px 4px',
                            textAlign:
                              'right',
                            color:
                              p.spyReturn !=
                                null &&
                              p.spyReturn >=
                                0
                                ? C.success
                                : C.danger,
                          }}
                        >
                          {fmtPercent(
                            p.spyReturn
                          )}
                        </td>

                        <td
                          style={{
                            padding:
                              '6px 4px',
                            textAlign:
                              'right',
                            fontWeight: 700,
                            color:
                              p.alpha == null
                                ? '#444'
                                : p.alpha >= 0
                                ? C.success
                                : C.danger,
                          }}
                        >
                          {p.alpha == null ? (
                            '—'
                          ) : (
                            <>
                              {p.alpha >= 0
                                ? '▲'
                                : '▼'}{' '}
                              {Math.abs(
                                p.alpha
                              ).toFixed(1)}
                              %
                            </>
                          )}
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            )}

            {detail?.performance &&
              detail.performance
                .dataCoverageYears < 4.8 && (
                <div
                  style={{
                    fontSize: 9,
                    color: '#444',
                    marginTop: 8,
                  }}
                >
                  Nota: solo hay{' '}
                  {detail.performance
                    .dataCoverageYears.toFixed(
                      1
                    )}{' '}
                  años de historial disponible
                  para este símbolo — los
                  periodos más largos pueden no
                  estar completos.
                </div>
              )}
          </div>

          {/* ═══════════════════════════════════════════════════
              FILA 3 — DESCRIPCIÓN
          ═══════════════════════════════════════════════════ */}

          {detail?.profile?.description && (
            <div
              style={{
                gridColumn: '1 / -1',
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 12,
                padding: 16,
                minWidth: 0,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: '#888',
                  fontWeight: 700,
                  textTransform:
                    'uppercase',
                  letterSpacing: 0.5,
                  marginBottom: 8,
                }}
              >
                Descripción
              </div>

              <p
                style={{
                  fontSize: 12,
                  color: '#bbb',
                  lineHeight: 1.6,
                  margin: 0,
                }}
              >
                {detail.profile.description}
              </p>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════
              FILA 4 — HISTORIAL DE OPERACIONES
          ═══════════════════════════════════════════════════ */}

          {executions.length > 0 && ( <div style={{ gridColumn: '1 / -1', background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, minWidth: 0, }} > <div style={{ fontSize: 11, color: '#888', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12, }} > Historial de operaciones </div> <div style={{ overflowX: 'auto', }} > <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, }} > <thead> <tr> {[ 'Fecha', 'Tipo', 'Cantidad', 'Precio', 'Total', ].map((h, i) => ( <th key={i} style={{ textAlign: i === 0 ? 'left' : 'right', color: '#555', fontSize: 10, fontWeight: 700, padding: '4px 8px', textTransform: 'uppercase', }} > {h} </th> ))} </tr> </thead> <tbody> {executions.map((e) => ( <tr key={e.id} style={{ borderTop: '1px solid #151515', }} > <td style={{ padding: '6px 8px', color: '#aaa', }} > {fmtDate( e.executed_at )} </td> <td style={{ padding: '6px 8px', textAlign: 'right', color: e.execution_type === 'buy' ? C.success : C.danger, fontWeight: 700, }} > {e.execution_type === 'buy' ? 'Compra' : 'Venta'} </td> <td style={{ padding: '6px 8px', textAlign: 'right', color: '#ddd', }} > {Number( e.quantity ).toLocaleString( 'en-US', { maximumFractionDigits: 4, } )} </td> <td style={{ padding: '6px 8px', textAlign: 'right', color: '#ddd', }} > {fmtMoney( Number(e.price) )} </td> <td style={{ padding: '6px 8px', textAlign: 'right', color: '#ddd', fontWeight: 700, }} > {fmtMoney( Number(e.price) * Number( e.quantity ) )} </td> </tr> ))} </tbody> </table> </div> </div> )} </div> </div> </AppShell> ) } /* ───────────────────────────────────────────────────────────── EXPORT ───────────────────────────────────────────────────────────── */ export default function PositionPage() { return ( <Suspense fallback={ <AppShell> <div style={{ padding: 40, color: '#666', }} > Cargando... </div> </AppShell> } > <PositionPageInner /> </Suspense> ) }