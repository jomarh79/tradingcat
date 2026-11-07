// Índice de Miedo y Codicia propio de TradingCat (0 = miedo extremo · 100 = codicia extrema).
// Mismo método que el de CNN (varios indicadores llevados a 0-100 y promediados), pero con datos
// que TwelveData sí entrega (ETFs diarios). NO es el número de CNN: se parece y se mueve en la misma dirección.
// Los umbrales de cada indicador son aproximaciones y están juntos aquí para poder ajustarlos.

export type Bar = { date: string; close: number }          // cronológico: la más antigua primero
export interface FGComponent { key: string; label: string; score: number; detail: string }
export interface FGResult { value: number; label: string; components: FGComponent[]; missing: string[]; asOf: string }

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
// Lleva x al rango 0-100: x = a → 0, x = b → 100 (a puede ser mayor que b para invertir)
const lin = (x: number, a: number, b: number) => clamp(((x - a) / (b - a)) * 100, 0, 100)
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const smaLast = (xs: number[], n: number) => avg(xs.slice(-n))
const ret = (xs: number[], n: number) => (xs[xs.length - 1] / xs[xs.length - 1 - n] - 1) * 100
const sign = (x: number, d = 1) => `${x >= 0 ? '+' : ''}${x.toFixed(d)}`

// Une dos series por fecha (solo fechas comunes)
function align(a: Bar[], b: Bar[]): { date: string; a: number; b: number }[] {
  const mb = new Map(b.map(x => [x.date, x.close]))
  return a.filter(x => mb.has(x.date)).map(x => ({ date: x.date, a: x.close, b: mb.get(x.date)! }))
}

export const fearGreedLabel = (v: number) =>
  v < 25 ? 'Miedo extremo' : v < 45 ? 'Miedo' : v <= 55 ? 'Neutral' : v < 75 ? 'Codicia' : 'Codicia extrema'

export interface FGInput { spy: Bar[] | null; vix: Bar[] | null; tlt: Bar[] | null; hyg: Bar[] | null; lqd: Bar[] | null }

export function computeFearGreed(inp: FGInput): FGResult | null {
  const comps: FGComponent[] = []
  const missing: string[] = []
  const miss = (label: string) => missing.push(label)

  const spy = inp.spy?.map(b => b.close) ?? null

  // 1) Momentum: S&P 500 (SPY) contra su media de 125 días. -10 % → miedo · +10 % → codicia
  if (spy && spy.length >= 125) {
    const pct = (spy[spy.length - 1] / smaLast(spy, 125) - 1) * 100
    comps.push({ key: 'momentum', label: 'Momentum S&P 500', score: lin(pct, -10, 10), detail: `${sign(pct)}% vs media de 125 días` })
  } else miss('Momentum S&P 500')

  // 2) Fuerza de precios: posición del SPY dentro de su rango de 52 semanas
  if (spy && spy.length >= 200) {
    const y = spy.slice(-252)
    const hi = Math.max(...y), lo = Math.min(...y)
    const c = y[y.length - 1]
    comps.push({ key: 'fuerza', label: 'Rango de 52 semanas', score: hi > lo ? lin(c, lo, hi) : 50, detail: `${(((c - lo) / (hi - lo)) * 100).toFixed(0)}% del rango anual` })
  } else miss('Rango de 52 semanas')

  // 3) Volatilidad: VIX contra su media de 50 días. +40 % → miedo · -25 % → codicia
  const vix = inp.vix?.map(b => b.close) ?? null
  if (vix && vix.length >= 50) {
    const pct = (vix[vix.length - 1] / smaLast(vix, 50) - 1) * 100
    comps.push({ key: 'vix', label: 'Volatilidad (VIX)', score: lin(pct, 40, -25), detail: `VIX ${vix[vix.length - 1].toFixed(1)} (${sign(pct, 0)}% vs media de 50 días)` })
  } else miss('Volatilidad (VIX)')

  // 4) Refugio seguro: rendimiento de 20 días de acciones (SPY) menos bonos largos (TLT)
  if (inp.spy && inp.tlt) {
    const al = align(inp.spy, inp.tlt)
    if (al.length > 21) {
      const diff = ret(al.map(x => x.a), 20) - ret(al.map(x => x.b), 20)
      comps.push({ key: 'refugio', label: 'Acciones vs bonos (20d)', score: lin(diff, -8, 8), detail: `acciones ${sign(diff)} pts vs bonos` })
    } else miss('Acciones vs bonos (20d)')
  } else miss('Acciones vs bonos (20d)')

  // 5) Demanda de bonos basura: HYG/LQD contra su media de 50 días (riesgo de crédito)
  if (inp.hyg && inp.lqd) {
    const al = align(inp.hyg, inp.lqd)
    if (al.length >= 50) {
      const ratio = al.map(x => x.a / x.b)
      const pct = (ratio[ratio.length - 1] / smaLast(ratio, 50) - 1) * 100
      comps.push({ key: 'credito', label: 'Bonos basura (HYG/LQD)', score: lin(pct, -1.5, 1.5), detail: `${sign(pct, 2)}% vs media de 50 días` })
    } else miss('Bonos basura (HYG/LQD)')
  } else miss('Bonos basura (HYG/LQD)')

  if (comps.length < 3) return null
  const value = Math.round(avg(comps.map(c => c.score)))
  return {
    value, label: fearGreedLabel(value),
    components: comps.map(c => ({ ...c, score: Math.round(c.score) })),
    missing,
    asOf: inp.spy?.[inp.spy.length - 1]?.date ?? '',
  }
}