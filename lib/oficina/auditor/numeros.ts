import { dec } from '../motor/decimal';

const ESCALA_DEC = 8;
const FACTOR = BigInt(10) ** BigInt(ESCALA_DEC);
/** Resolución del cociente al calcular la raíz (1e-6 del cociente = 1e-4 puntos porcentuales). */
const RESOLUCION_COCIENTE = BigInt(10) ** BigInt(6);
/** Cota superior de la búsqueda de la raíz (cociente máximo 1e6 veces). */
const COTA_RAIZ = BigInt(10) ** BigInt(12);
const MAX_DECIMALES_REDONDEO = 3;
const MESES_POR_ANIO = 12;

export function aDec(valor: unknown): bigint | null {
  if (typeof valor === 'number') valor = String(valor);
  if (typeof valor !== 'string') return null;
  try { return dec(valor); } catch { return null; }
}

export function textoDec(n: bigint): string {
  const signo = n < BigInt(0) ? '-' : '';
  const abs = n < BigInt(0) ? -n : n;
  const entero = abs / FACTOR;
  const frac = (abs % FACTOR).toString().padStart(ESCALA_DEC, '0').replace(/0+$/, '');
  return `${signo}${entero}${frac ? '.' + frac : ''}`;
}

/** División entera hacia −∞ (divisor positivo). */
export function divPiso(a: bigint, b: bigint): bigint {
  const q = a / b;
  return a % b !== BigInt(0) && a < BigInt(0) ? q - BigInt(1) : q;
}

export interface GananciaAnualizada { porcentaje_redondeado: string; supera: boolean }

/**
 * PMP-01: ((valor / precio) ^ (12 / horizonte)) − 1, en porcentaje, redondeado half-up a `decimales`.
 * `supera` = porcentaje redondeado ESTRICTAMENTE mayor que `umbral` (en porcentaje, escala dec). Aritmética entera exacta:
 * el redondeo half-up supera el umbral ⇔ el valor sin redondear ≥ umbral + 0.5 unidad del último decimal; se compara
 * (valor/precio)^12 ≥ x_min^horizonte sin raíces ni flotantes.
 */
export function gananciaAnualizada(valor: bigint, precio: bigint, horizonteMeses: number, umbral: bigint, decimales: number): GananciaAnualizada {
  if (valor <= BigInt(0) || precio <= BigInt(0)) throw new Error('valor y precio deben ser positivos');
  if (!Number.isInteger(horizonteMeses) || horizonteMeses <= 0) throw new Error('horizonte inválido');
  if (!Number.isInteger(decimales) || decimales < 0 || decimales > MAX_DECIMALES_REDONDEO) throw new Error('decimales inválidos');
  const h = BigInt(horizonteMeses);
  const m = BigInt(MESES_POR_ANIO);
  const mitadUnidad = FACTOR / (BigInt(2) * BigInt(10) ** BigInt(decimales));
  const N = BigInt(100) * FACTOR + umbral + mitadUnidad;
  const D = BigInt(100) * FACTOR;
  const supera = valor ** m * D ** h >= N ** h * precio ** m;
  // Porcentaje redondeado: y = piso(RESOLUCION · cociente^(12/h)); q = y − RESOLUCION (en 1e-4 puntos porcentuales).
  const izq = valor ** m * RESOLUCION_COCIENTE ** h;
  const pf = precio ** m;
  let lo = BigInt(0);
  let hi = COTA_RAIZ;
  while (lo < hi) {
    const mid = (lo + hi + BigInt(1)) / BigInt(2);
    if (mid ** h * pf <= izq) lo = mid; else hi = mid - BigInt(1);
  }
  const q = lo - RESOLUCION_COCIENTE;
  const divisor = BigInt(10) ** BigInt(4 - decimales);
  const r = divPiso(q + divisor / BigInt(2), divisor);
  const signo = r < BigInt(0) ? '-' : '';
  const abs = r < BigInt(0) ? -r : r;
  const escala = BigInt(10) ** BigInt(decimales);
  const entero = abs / escala;
  const frac = decimales > 0 ? '.' + (abs % escala).toString().padStart(decimales, '0') : '';
  return { porcentaje_redondeado: `${signo}${entero}${frac}`, supera };
}

/** Suma `anios` a una fecha AAAA-MM-DD (29-feb → 1-mar si el año destino no es bisiesto). */
export function sumarAnios(fecha: string, anios: number): string {
  const [a, m, d] = fecha.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(a + anios, m - 1, d));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

export const REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/;
