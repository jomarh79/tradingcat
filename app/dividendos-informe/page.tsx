'use client'
import { useEffect, useMemo, useState, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'
import AppShell from '../AppShell'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const parseDate = (d: string) => new Date((d || '').split('T')[0] + 'T00:00:00')
const money = (v: number) => `$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const C = {
  bg:       '#070709',
  card:     '#0a0a0c',
  border:   '#141418',
  gold:     '#eab308',
  goldDim:  '#78611a',
  gain:     '#22c55e',
  loss:     '#f43f5e',
  accent:   '#a78bfa',
  text:     '#e2e8f0',
  muted:    '#64748b',
  dim:      '#1e1e24',
}

const MESES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
const MESES_FULL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

export default function DividendosInforme() {
  const [dividends,    setDividends]    = useState<any[]>([])
  const [trades,       setTrades]       = useState<any[]>([])
  const [portfolios,   setPortfolios]   = useState<any[]>([])
  const [loading,      setLoading]      = useState(true)
  const [filterWallet, setFilterWallet] = useState('all')
  const [filterYear,   setFilterYear]   = useState<string>('all')

  const fetchData = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    // Traer TODOS los dividendos con paginación
    let allDivs: any[] = []
    let from = 0
    while (true) {
      const { data: chunk } = await supabase
        .from('wallet_movements')
        .select('ticker, amount, date, wallet_id')
        .or('is_dividend.eq.true,movement_type.eq.dividend')
        .eq('user_id', user.id)
        .order('date', { ascending: true })
        .range(from, from + 999)
      if (!chunk?.length) break
      allDivs = [...allDivs, ...chunk]
      if (chunk.length < 1000) break
      from += 1000
    }
    setDividends(allDivs)

    const { data: pData } = await supabase
      .from('portfolios')
      .select('id, name')
      .eq('user_id', user.id)
    setPortfolios(pData || [])

    // Trades abiertos para capital invertido
    const { data: tData } = await supabase
      .from('trades')
      .select('ticker, total_invested, status, quantity, entry_price, initial_quantity, initial_entry_price, trade_executions(quantity, price, commission, execution_type)')
      .eq('user_id', user.id)
    setTrades(tData || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const calcInvested = (t: any): number => {
    const initialInv = Number(t.initial_entry_price || t.entry_price || 0) * Number(t.initial_quantity || t.quantity || 0)
    const buyExtra = (t.trade_executions || [])
      .filter((e: any) => e.execution_type === 'buy')
      .reduce((a: number, e: any) => a + Number(e.quantity) * Number(e.price) + Number(e.commission || 0), 0)
    return parseFloat((initialInv + buyExtra).toFixed(2))
  }

  const filteredDividends = useMemo(() => {
    return dividends.filter(d => {
      const matchWallet = filterWallet === 'all' || d.wallet_id === filterWallet
      const matchYear   = filterYear === 'all' || parseDate(d.date).getFullYear().toString() === filterYear
      return matchWallet && matchYear
    })
  }, [dividends, filterWallet, filterYear])

  const availableYears = useMemo(() => {
    const years = new Set(dividends.map(d => parseDate(d.date).getFullYear().toString()))
    return Array.from(years).sort((a, b) => b.localeCompare(a))
  }, [dividends])

  const stats = useMemo(() => {
    if (!filteredDividends.length) return null
    const now   = new Date()
    const year  = now.getFullYear()
    const month = now.getMonth()

    // ── YTD ──────────────────────────────────────────────────────────────
    const ytd = filteredDividends.filter(d => {
      const dt = parseDate(d.date)
      return dt.getFullYear() === year
    })
    const ytdTotal = ytd.reduce((a, d) => a + Number(d.amount), 0)

    // ── Mes actual ───────────────────────────────────────────────────────
    const thisMonth = filteredDividends.filter(d => {
      const dt = parseDate(d.date)
      return dt.getFullYear() === year && dt.getMonth() === month
    })
    const monthTotal = thisMonth.reduce((a, d) => a + Number(d.amount), 0)

    // ── Capital invertido total ───────────────────────────────────────────
    const totalInvested = trades.reduce((a, t) => a + calcInvested(t), 0)

    // ── Retorno por dividendos ────────────────────────────────────────────
    const retorno = totalInvested > 0 ? (ytdTotal / totalInvested * 100) : 0

    // ── YOC por ticker ───────────────────────────────────────────────────
    // Dividendos anualizados / costo base por ticker
    const divByTicker: Record<string, number> = {}
    ytd.forEach(d => { divByTicker[d.ticker] = (divByTicker[d.ticker] || 0) + Number(d.amount) })
    const costByTicker: Record<string, number> = {}
    trades.forEach(t => { costByTicker[t.ticker] = (costByTicker[t.ticker] || 0) + calcInvested(t) })
    let yocSum = 0, yocCount = 0
    Object.entries(divByTicker).forEach(([ticker, div]) => {
      const cost = costByTicker[ticker] || 0
      if (cost > 0) { yocSum += (div / cost * 100); yocCount++ }
    })
    const yoc = yocCount > 0 ? yocSum / yocCount : 0

    // ── Proyección anual ─────────────────────────────────────────────────
    const mesesTranscurridos = month + 1
    const promMensual = mesesTranscurridos > 0 ? ytdTotal / mesesTranscurridos : 0
    const proyeccion = promMensual * 12

    // ── Meta = promedio histórico anual ──────────────────────────────────
    const byYear: Record<number, number> = {}
    filteredDividends.forEach(d => {
      const y = parseDate(d.date).getFullYear()
      byYear[y] = (byYear[y] || 0) + Number(d.amount)
    })
    const years = Object.values(byYear)
    const meta = years.length > 0 ? years.reduce((a, b) => a + b, 0) / years.length : proyeccion
    const metaPct = meta > 0 ? Math.min((ytdTotal / meta * 100), 100) : 0

    // ── Evolución mensual (últimos 12 meses) ─────────────────────────────
    const monthly: Record<string, number> = {}
    for (let i = 11; i >= 0; i--) {
      const d = new Date(year, month - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`
      monthly[key] = 0
    }
    filteredDividends.forEach(d => {
      const dt  = parseDate(d.date)
      const key = `${dt.getFullYear()}-${String(dt.getMonth()).padStart(2, '0')}`
      if (key in monthly) monthly[key] += Number(d.amount)
    })
    const monthlyData = Object.entries(monthly).map(([key, total]) => {
      const [y, m] = key.split('-')
      return {
        key,
        label: `${MESES[parseInt(m)]} ${y}`,
        total: parseFloat(total.toFixed(2)),
      }
    })

    // ── Top pagadores ────────────────────────────────────────────────────
    const allByTicker: Record<string, number> = {}
    filteredDividends.forEach(d => {
      allByTicker[d.ticker] = (allByTicker[d.ticker] || 0) + Number(d.amount)
    })
    const totalDivAll = Object.values(allByTicker).reduce((a, b) => a + b, 0)
    const topPagadores = Object.entries(allByTicker)
      .map(([ticker, total]) => ({ ticker, total: parseFloat(total.toFixed(2)), pct: totalDivAll > 0 ? (total / totalDivAll * 100) : 0 }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)

    // ── Empresas que pagan ────────────────────────────────────────────────
    const tickersPagan = new Set(filteredDividends.map(d => d.ticker)).size
    const tickersTotal = new Set(trades.map(t => t.ticker)).size

    // ── Tiempo para recuperar inversión ──────────────────────────────────
    const aniosRecuperacion = proyeccion > 0 ? totalInvested / proyeccion : null

    // ── Crecimiento YTD vs año anterior ──────────────────────────────────
    const prevYear     = year - 1
    const prevYtd = filteredDividends.filter(d => {
      const dt = parseDate(d.date)
      return dt.getFullYear() === prevYear && dt.getMonth() <= month
    }).reduce((a, d) => a + Number(d.amount), 0)
    const crecimiento  = prevYtd > 0 ? ((ytdTotal - prevYtd) / prevYtd * 100) : null
    const semaforo     = crecimiento === null ? 'nuevo' : crecimiento > 5 ? 'verde' : crecimiento >= -5 ? 'amarillo' : 'rojo'

    // ── Dividend Score ────────────────────────────────────────────────────
    // 1. Crecimiento YTD vs año anterior (25%)
    const scoreCrec = crecimiento === null ? 50 : Math.min(Math.max(50 + crecimiento * 2, 0), 100)
    // 2. YOC (25%) — ideal > 4%
    const scoreYoc = Math.min((yoc / 8) * 100, 100)
    // 3. Diversificación (20%) — ideal > 10 pagadores
    const scoreDiv = Math.min((tickersPagan / 15) * 100, 100)
    // 4. Proyección vs meta (20%)
    const scoreMeta = Math.min(metaPct, 100)
    // 5. Consistencia mensual (10%) — meses con dividendo / meses transcurridos
    const mesesConDiv = monthlyData.filter(m => m.total > 0).length
    const scoreConsistencia = mesesTranscurridos > 0 ? (mesesConDiv / mesesTranscurridos) * 100 : 0
    const dividendScore = Math.round(
      scoreCrec * 0.25 +
      scoreYoc  * 0.25 +
      scoreDiv  * 0.20 +
      scoreMeta * 0.20 +
      scoreConsistencia * 0.10
    )

    // ── Mejor mes histórico ───────────────────────────────────────────────
    const mejorMes = monthlyData.reduce((a, b) => b.total > a.total ? b : a, { label: '—', total: 0 })

    // Crecimiento anual histórico
    const byYearData: Record<string, number> = {}
    filteredDividends.forEach(d => {
      const y = parseDate(d.date).getFullYear().toString()
      byYearData[y] = (byYearData[y] || 0) + Number(d.amount)
    })
    const crecimientoAnual = Object.entries(byYearData)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([year, total]) => ({ year, total: parseFloat(total.toFixed(2)) }))

    // ── Frecuencia por ticker (simplificada) ─────────────────────────────
    const freqByTicker: Record<string, number> = {}
    filteredDividends.forEach(d => {
      freqByTicker[d.ticker] = (freqByTicker[d.ticker] || 0) + 1
    })

    return {
      ytdTotal: parseFloat(ytdTotal.toFixed(2)),
      monthTotal: parseFloat(monthTotal.toFixed(2)),
      retorno: parseFloat(retorno.toFixed(2)),
      yoc: parseFloat(yoc.toFixed(2)),
      proyeccion: parseFloat(proyeccion.toFixed(2)),
      meta: parseFloat(meta.toFixed(2)),
      metaPct: parseFloat(metaPct.toFixed(1)),
      promMensual: parseFloat(promMensual.toFixed(2)),
      mesesTranscurridos,
      monthlyData,
      topPagadores,
      tickersPagan,
      tickersTotal,
      totalInvested: parseFloat(totalInvested.toFixed(2)),
      aniosRecuperacion,
      crecimiento,
      semaforo,
      dividendScore,
      mejorMes,
      prevYtd: parseFloat(prevYtd.toFixed(2)),
      year,
      crecimientoAnual,
    }
  }, [filteredDividends, trades])

  // ── Score color ──────────────────────────────────────────────────────────
  const scoreColor = (s: number) => s >= 75 ? C.gain : s >= 50 ? C.gold : C.loss
  const scoreLabel = (s: number) => s >= 75 ? 'Excelente' : s >= 50 ? 'Regular' : 'Necesita atención'

  // ── Semáforo ──────────────────────────────────────────────────────────────
  const semColorMap: Record<string, string> = { verde: C.gain, amarillo: C.gold, rojo: C.loss, nuevo: C.accent }
  const semLabelMap: Record<string, string> = { verde: '🟢 Creciendo', amarillo: '🟡 Estable', rojo: '🔴 Disminuyendo', nuevo: '🔵 Sin histórico' }

  // ── Bar máx para gráfica mensual ─────────────────────────────────────────
  const maxMonthly = stats ? Math.max(...stats.monthlyData.map(m => m.total), 1) : 1

  if (loading) return (
    <AppShell>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: C.muted, fontSize: 13 }}>
        Cargando informe de dividendos...
      </div>
    </AppShell>
  )

  if (!stats || !dividends.length) return (
    <AppShell>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: C.muted, fontSize: 13 }}>
        Sin dividendos registrados aún.
      </div>
    </AppShell>
  )

  return (
    <AppShell>
      <div style={{ padding: '20px 24px', background: C.bg, minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>

        {/* ── Header ── */}
        <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>
              💰 Informe ejecutivo
            </div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: C.gold, letterSpacing: -0.5 }}>
              Dividendos
            </h1>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>
              {stats.year} · {stats.mesesTranscurridos} meses transcurridos
            </div>
          </div>
          {/* Dividend Score */}
          <div style={{ textAlign: 'center', background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '14px 24px' }}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>DIVIDEND SCORE</div>
            <div style={{ fontSize: 36, fontWeight: 900, color: scoreColor(stats.dividendScore), lineHeight: 1 }}>
              {stats.dividendScore}
            </div>
            <div style={{ fontSize: 9, color: scoreColor(stats.dividendScore), marginTop: 4 }}>/ 100 · {scoreLabel(stats.dividendScore)}</div>
          </div>
        </div>

        {/* ── Filtros ── */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          {/* Billeteras */}
          <button onClick={() => setFilterWallet('all')} style={{
            padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer',
            background: filterWallet === 'all' ? C.gold : C.dim,
            color: filterWallet === 'all' ? '#000' : C.muted,
            border: `1px solid ${filterWallet === 'all' ? C.gold : C.border}`,
          }}>Todas</button>
          {portfolios.map(p => (
            <button key={p.id} onClick={() => setFilterWallet(p.id)} style={{
              padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer',
              background: filterWallet === p.id ? C.gold : C.dim,
              color: filterWallet === p.id ? '#000' : C.muted,
              border: `1px solid ${filterWallet === p.id ? C.gold : C.border}`,
            }}>{p.name}</button>
          ))}
          <div style={{ width: 1, background: C.border, margin: '0 4px' }} />
          {/* Años */}
          <button onClick={() => setFilterYear('all')} style={{
            padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer',
            background: filterYear === 'all' ? C.accent : C.dim,
            color: filterYear === 'all' ? '#000' : C.muted,
            border: `1px solid ${filterYear === 'all' ? C.accent : C.border}`,
          }}>Todos los años</button>
          {availableYears.map(y => (
            <button key={y} onClick={() => setFilterYear(y)} style={{
              padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer',
              background: filterYear === y ? C.accent : C.dim,
              color: filterYear === y ? '#000' : C.muted,
              border: `1px solid ${filterYear === y ? C.accent : C.border}`,
            }}>{y}</button>
          ))}
        </div>

        {/* ── Fila 1: KPIs ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 16 }}>
          {[
            { label: 'COBRADOS YTD',   value: money(stats.ytdTotal),       color: C.gold,   sub: `vs ${money(stats.prevYtd)} año anterior` },
            { label: 'DIVIDENDO MES',  value: money(stats.monthTotal),      color: C.text,   sub: MESES_FULL[new Date().getMonth()] },
            { label: 'YIELD ON COST',  value: `${stats.yoc}%`,             color: C.accent, sub: 'sobre costo base' },
            { label: 'RETORNO REAL',   value: `${stats.retorno}%`,         color: stats.retorno >= 3 ? C.gain : C.gold, sub: `÷ $${(stats.totalInvested/1000).toFixed(1)}k invertido` },
            { label: 'PROYECCIÓN AÑO', value: money(stats.proyeccion),      color: C.gain,   sub: `${money(stats.promMensual)}/mes promedio` },
            { label: 'META ANUAL',     value: money(stats.meta),            color: C.muted,  sub: 'media histórica' },
          ].map(k => (
            <div key={k.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px' }}>
              <div style={{ fontSize: 8, color: C.muted, fontWeight: 700, letterSpacing: 0.8, marginBottom: 6 }}>{k.label}</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: k.color, marginBottom: 3 }}>{k.value}</div>
              <div style={{ fontSize: 9, color: '#3a3a4a' }}>{k.sub}</div>
            </div>
          ))}
        </div>

        {/* ── Progreso meta ── */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 18px', marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div>
              <span style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8 }}>PROGRESO HACIA META ANUAL</span>
              <span style={{ fontSize: 11, color: C.gold, fontWeight: 700, marginLeft: 12 }}>{stats.metaPct}%</span>
            </div>
            <div style={{ fontSize: 11, color: C.muted }}>
              {stats.proyeccion >= stats.meta
                ? <span style={{ color: C.gain }}>Excederás la meta en {money(stats.proyeccion - stats.meta)}</span>
                : <span style={{ color: C.gold }}>Faltan {money(stats.meta - stats.ytdTotal)} para la meta</span>
              }
            </div>
          </div>
          <div style={{ height: 8, background: C.dim, borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              width: `${stats.metaPct}%`, height: '100%',
              background: `linear-gradient(90deg, ${C.goldDim}, ${C.gold})`,
              borderRadius: 4, transition: 'width 0.8s ease',
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
            <span style={{ fontSize: 9, color: '#666' }}>$0</span>
            <span style={{ fontSize: 9, color: C.muted }}>{money(stats.ytdTotal)} cobrados</span>
            <span style={{ fontSize: 9, color: '#666' }}>{money(stats.meta)}</span>
          </div>
        </div>

        {/* ── Fila 2: Evolución mensual + Top pagadores + Crecimiento anual ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 0.8fr', gap: 14, marginBottom: 16 }}>

          {/* Evolución mensual */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8 }}>EVOLUCIÓN MENSUAL</div>
                <div style={{ fontSize: 9, color: '#666', marginTop: 2 }}>Últimos 12 meses</div>
              </div>
              <div style={{ fontSize: 11, color: C.muted }}>
                Mejor: <span style={{ color: C.gold, fontWeight: 700 }}>{stats.mejorMes.label} {money(stats.mejorMes.total)}</span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 140 }}>
              {stats.monthlyData.map((m, i) => {
                const h = maxMonthly > 0 ? (m.total / maxMonthly * 100) : 0
                const isCurrentMonth = i === stats.monthlyData.length - 1
                return (
                  <div key={m.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div style={{ fontSize: 8, color: m.total > 0 ? C.gold : '#666', fontWeight: 700, minHeight: 14 }}>
                      {m.total > 0 ? `$${m.total.toFixed(0)}` : ''}
                    </div>
                    <div style={{
                      width: '100%', height: `${Math.max(h, m.total > 0 ? 4 : 0)}%`,
                      background: isCurrentMonth
                        ? `linear-gradient(180deg, ${C.gold}, ${C.goldDim})`
                        : m.total > 0
                          ? `rgba(234,179,8,0.35)`
                          : C.dim,
                      borderRadius: '4px 4px 0 0',
                      minHeight: m.total > 0 ? 4 : 0,
                      border: isCurrentMonth ? `1px solid ${C.gold}` : 'none',
                    }} />
                    <div style={{ fontSize: 7, color: C.muted, whiteSpace: 'nowrap', transform: 'rotate(-35deg)', transformOrigin: 'top center', marginTop: 4 }}>
                      {m.label}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Top pagadores */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8, marginBottom: 14 }}>TOP PAGADORES HISTÓRICO</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {stats.topPagadores.map((t, i) => (
                <div key={t.ticker}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 9, color: '#666', fontWeight: 700, minWidth: 14 }}>{i + 1}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{t.ticker}</span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: C.gold }}>{money(t.total)}</span>
                      <span style={{ fontSize: 9, color: C.muted, marginLeft: 6 }}>{t.pct.toFixed(1)}%</span>
                    </div>
                  </div>
                  <div style={{ height: 3, background: C.dim, borderRadius: 2 }}>
                    <div style={{ width: `${t.pct}%`, height: '100%', background: C.gold, borderRadius: 2, opacity: 0.6 + (i === 0 ? 0.4 : 0) }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

            {/* Crecimiento anual */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8, marginBottom: 14 }}>INGRESO PASIVO ANUAL</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 140 }}>
              {stats.crecimientoAnual.map((y, i) => {
                const maxVal = Math.max(...stats.crecimientoAnual.map(x => x.total), 1)
                const h = (y.total / maxVal * 100)
                const isCurrentYear = y.year === stats.year.toString()
                return (
                  <div key={y.year} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div style={{ fontSize: 9, color: C.gold, fontWeight: 700, minHeight: 14, textAlign: 'center' }}>
                      {money(y.total)}
                    </div>
                    <div style={{
                      width: '100%', height: `${Math.max(h, 4)}%`,
                      background: isCurrentYear
                        ? `linear-gradient(180deg, ${C.gold}, ${C.goldDim})`
                        : 'rgba(234,179,8,0.25)',
                      borderRadius: '4px 4px 0 0',
                      border: isCurrentYear ? `1px solid ${C.gold}` : 'none',
                    }} />
                    <div style={{ fontSize: 10, color: isCurrentYear ? C.gold : C.muted, fontWeight: isCurrentYear ? 700 : 400 }}>
                      {y.year}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

        </div>

        {/* ── Fila 3: Indicadores + Proyección + Recuperación ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 16 }}>

          {/* Indicadores */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8, marginBottom: 14 }}>INDICADORES</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { label: 'Dividendos cobrados YTD',     value: money(stats.ytdTotal),         color: C.gold },
                { label: 'Yield on Cost promedio',       value: `${stats.yoc}%`,               color: C.accent },
                { label: 'Retorno por dividendos',       value: `${stats.retorno}%`,           color: stats.retorno >= 3 ? C.gain : C.gold },
                { label: 'Empresas que pagan',           value: `${stats.tickersPagan} de ${stats.tickersTotal}`, color: C.text },
                { label: 'Promedio mensual YTD',         value: money(stats.promMensual),       color: C.muted },
              ].map(k => (
                <div key={k.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${C.border}`, paddingBottom: 8 }}>
                  <span style={{ fontSize: 11, color: C.muted }}>{k.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: k.color }}>{k.value}</span>
                </div>
              ))}
              {/* Semáforo */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: C.muted }}>Tendencia vs año anterior</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: semColorMap[stats.semaforo] }}>
                  {semLabelMap[stats.semaforo]}
                  {stats.crecimiento !== null && (
                    <span style={{ fontSize: 9, marginLeft: 4, opacity: 0.7 }}>
                      ({stats.crecimiento >= 0 ? '+' : ''}{stats.crecimiento.toFixed(1)}%)
                    </span>
                  )}
                </span>
              </div>
            </div>
          </div>

          {/* Proyección inteligente */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8, marginBottom: 14 }}>PROYECCIÓN DEL AÑO</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { label: 'Dividendos cobrados',    value: money(stats.ytdTotal) },
                { label: 'Meses transcurridos',    value: `${stats.mesesTranscurridos} de 12` },
                { label: 'Promedio mensual',        value: money(stats.promMensual) },
                { label: 'Proyección anual',        value: money(stats.proyeccion), bold: true, color: C.gain },
              ].map(k => (
                <div key={k.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${C.border}`, paddingBottom: 8 }}>
                  <span style={{ fontSize: 11, color: C.muted }}>{k.label}</span>
                  <span style={{ fontSize: (k as any).bold ? 15 : 13, fontWeight: 700, color: (k as any).color || C.text }}>{k.value}</span>
                </div>
              ))}
              <div style={{ marginTop: 6, padding: '10px 12px', background: C.dim, borderRadius: 8, border: `1px solid ${C.border}` }}>
                {stats.proyeccion >= stats.meta
                  ? <div style={{ fontSize: 11, color: C.gain, fontWeight: 700 }}>
                      ✅ Excederás la meta en <span style={{ color: C.gain }}>{money(stats.proyeccion - stats.meta)}</span>
                    </div>
                  : <div style={{ fontSize: 11, color: C.gold, fontWeight: 700 }}>
                      📌 Faltan <span style={{ color: C.gold }}>{money(stats.meta - stats.ytdTotal)}</span> para la meta
                    </div>
                }
                <div style={{ fontSize: 9, color: C.muted, marginTop: 4 }}>
                  Meta basada en media histórica de {money(stats.meta)}/año
                </div>
              </div>
            </div>
          </div>

          {/* Tiempo para recuperar inversión */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8, marginBottom: 14 }}>RECUPERACIÓN POR DIVIDENDOS</div>
            <div style={{ textAlign: 'center', padding: '10px 0 14px' }}>
              <div style={{ fontSize: 9, color: C.muted, marginBottom: 6 }}>Capital invertido total</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: C.text, marginBottom: 12 }}>{money(stats.totalInvested)}</div>
              <div style={{ fontSize: 9, color: C.muted, marginBottom: 6 }}>Dividendos proyectados / año</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: C.gold, marginBottom: 16 }}>{money(stats.proyeccion)}</div>
              <div style={{ width: '100%', height: 1, background: C.border, marginBottom: 16 }} />
              <div style={{ fontSize: 9, color: C.muted, marginBottom: 6 }}>Tiempo estimado de recuperación</div>
              <div style={{ fontSize: 32, fontWeight: 900, color: C.accent, lineHeight: 1 }}>
                {stats.aniosRecuperacion ? `${stats.aniosRecuperacion.toFixed(1)}` : '—'}
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>años</div>
              <div style={{ fontSize: 9, color: '#666', marginTop: 8 }}>
                Solo contando dividendos, sin venta de acciones
              </div>
            </div>
          </div>
        </div>

        {/* ── Dividend Score detalle ── */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8 }}>DIVIDEND SCORE — DESGLOSE</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 28, fontWeight: 900, color: scoreColor(stats.dividendScore) }}>{stats.dividendScore}</div>
              <div style={{ fontSize: 9, color: scoreColor(stats.dividendScore) }}>/ 100</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
            {[
              { label: 'Crecimiento',    pct: 25, score: Math.round(stats.crecimiento === null ? 50 : Math.min(Math.max(50 + stats.crecimiento * 2, 0), 100)) },
              { label: 'YOC',            pct: 25, score: Math.round(Math.min((stats.yoc / 8) * 100, 100)) },
              { label: 'Diversificación',pct: 20, score: Math.round(Math.min((stats.tickersPagan / 15) * 100, 100)) },
              { label: 'Meta',           pct: 20, score: Math.round(Math.min(stats.metaPct, 100)) },
              { label: 'Consistencia',   pct: 10, score: Math.round(stats.monthlyData.filter(m => m.total > 0).length / stats.mesesTranscurridos * 100) },
            ].map(k => (
              <div key={k.label} style={{ background: C.dim, borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: C.muted, marginBottom: 6 }}>{k.label}</div>
                <div style={{ fontSize: 18, fontWeight: 900, color: scoreColor(k.score) }}>{k.score}</div>
                <div style={{ fontSize: 8, color: '#666', marginTop: 2 }}>peso {k.pct}%</div>
                <div style={{ height: 3, background: C.border, borderRadius: 2, marginTop: 6 }}>
                  <div style={{ width: `${k.score}%`, height: '100%', background: scoreColor(k.score), borderRadius: 2 }} />
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </AppShell>
  )
}