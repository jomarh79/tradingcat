// v0.73 (decisión de Jaime, 22-nov): en PMP todas las empresas pagan dividendos. Si no pagan, se sugiere pasarla a PCP. Si pagan, se compara el rendimiento por
// dividendo de hoy con su promedio de los últimos 5 años (la gráfica «Dividendo vs precio» de /chart: último dividendo conocido ÷ cierre del día, sin anualizar):
// del lado verde (hoy ≥ promedio) = barata, se puede comprar; del lado rojo (hoy < promedio) = cara, no se compra. Código puro y determinista; nada se rellena.
export const ANIOS_PROMEDIO_DIVIDENDO = 5;
/** «Paga dividendos» = hay al menos un pago en los últimos 400 días (cubre pagos anuales con margen). */
export const DIAS_PAGO_RECIENTE = 400;
/** Cobertura mínima para confiar en el promedio: al menos 3 años de historial con dividendo conocido y 250 cierres. */
export const MINIMO_ANIOS_COBERTURA = 3;
export const MINIMO_CIERRES = 250;

export type EstadoDividendoPmp = 'paga_verde' | 'paga_rojo' | 'no_paga' | 'sin_datos';
export interface DividendoPmp {
  estado: EstadoDividendoPmp;
  rendimiento_actual: number | null;
  rendimiento_promedio: number | null;
  puntos: number;
  anios_cubiertos: number | null;
  ultimo_dividendo: { fecha: string; monto: number } | null;
  texto: string;
}

const DIA = 86400;
const dia = (d: string): string => String(d || '').split('T')[0]!.split(' ')[0]!;
const aSegundos = (d: string): number | null => { const ms = Date.parse(`${dia(d)}T00:00:00Z`); return Number.isNaN(ms) ? null : ms / 1000; };

export function evaluarDividendoPmp(e: {
  dividendos: readonly { date: string; amount: number }[] | null;
  cierres: readonly { time: number; close: number }[] | null;
  /** Fecha y hora de la corrida (ISO). */
  ahora: string;
}): DividendoPmp {
  const vacio = (estado: EstadoDividendoPmp, texto: string, extra: Partial<DividendoPmp> = {}): DividendoPmp =>
    ({ estado, rendimiento_actual: null, rendimiento_promedio: null, puntos: 0, anios_cubiertos: null, ultimo_dividendo: null, texto, ...extra });
  if (e.dividendos === null) return vacio('sin_datos', 'No se pudieron consultar los dividendos: no se puede comprobar si paga.');
  const ahoraSec = Date.parse(e.ahora) / 1000;
  if (Number.isNaN(ahoraSec)) return vacio('sin_datos', 'Fecha de la corrida ilegible: no se puede evaluar el dividendo.');
  const divs = e.dividendos.map(d => ({ sec: aSegundos(d.date), fecha: dia(d.date), monto: Number(d.amount) }))
    .filter((d): d is { sec: number; fecha: string; monto: number } => d.sec !== null && Number.isFinite(d.monto) && d.monto > 0)
    .sort((a, b) => a.sec - b.sec);
  const ultimo = divs.at(-1);
  const ultimoDiv = ultimo === undefined ? null : { fecha: ultimo.fecha, monto: ultimo.monto };
  if (ultimo === undefined || ahoraSec - ultimo.sec > DIAS_PAGO_RECIENTE * DIA) {
    return vacio('no_paga', `No paga dividendos${ultimo === undefined ? ' (sin pagos registrados)' : ` (el último pago fue el ${ultimo.fecha})`}. PMP exige que paguen: se sugiere pasarla a PCP.`, { ultimo_dividendo: ultimoDiv });
  }
  if (e.cierres === null || e.cierres.length === 0) return vacio('sin_datos', 'Sin cierres diarios para calcular el rendimiento por dividendo.', { ultimo_dividendo: ultimoDiv });

  const corte = ahoraSec - ANIOS_PROMEDIO_DIVIDENDO * 365 * DIA;
  const porDia = new Map<number, number>();
  for (const c of e.cierres) {
    const t = Math.floor(c.time / DIA) * DIA;
    if (Number.isFinite(t) && c.close > 0 && t >= corte && t <= ahoraSec) porDia.set(t, c.close);
  }
  const cierres = Array.from(porDia.entries()).sort(([a], [b]) => a - b);
  const puntos: { t: number; v: number }[] = [];
  let idx = -1;
  for (const [t, close] of cierres) {
    while (idx + 1 < divs.length && divs[idx + 1]!.sec <= t) idx++;
    if (idx < 0) continue;
    puntos.push({ t, v: (divs[idx]!.monto / close) * 100 });
  }
  const cubiertos = puntos.length >= 2 ? (puntos.at(-1)!.t - puntos[0]!.t) / (365 * DIA) : 0;
  if (puntos.length < MINIMO_CIERRES || cubiertos < MINIMO_ANIOS_COBERTURA) {
    return vacio('sin_datos', `Historial insuficiente para el promedio de ${ANIOS_PROMEDIO_DIVIDENDO} años del dividendo: ${puntos.length} cierres con dividendo conocido y ${cubiertos.toFixed(1)} años (se piden ${MINIMO_CIERRES} y ${MINIMO_ANIOS_COBERTURA}).`,
      { puntos: puntos.length, anios_cubiertos: Math.round(cubiertos * 10) / 10, ultimo_dividendo: ultimoDiv });
  }
  const promedio = puntos.reduce((a, p) => a + p.v, 0) / puntos.length;
  const actual = puntos.at(-1)!.v;
  const verde = actual >= promedio;   // igual que la gráfica: verde si el punto es ≥ promedio
  const redondo = Math.round(cubiertos * 10) / 10;
  return {
    estado: verde ? 'paga_verde' : 'paga_rojo', rendimiento_actual: actual, rendimiento_promedio: promedio, puntos: puntos.length, anios_cubiertos: redondo, ultimo_dividendo: ultimoDiv,
    texto: `Dividendo vs precio (diario, sin anualizar): hoy ${actual.toFixed(3)}% ${verde ? 'en o sobre' : 'bajo'} el promedio de ${ANIOS_PROMEDIO_DIVIDENDO} años ${promedio.toFixed(3)}%: lado ${verde ? 'verde, barata, se puede comprar' : 'rojo, cara, no se compra'}.`,
  };
}
