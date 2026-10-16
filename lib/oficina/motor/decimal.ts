// Aritmética decimal exacta con enteros grandes (escala 1e8). Los montos y precios nunca pasan por
// números binarios: "el código calcula" sin errores de redondeo.

const ESCALA = 8;
const FACTOR = BigInt('1' + '0'.repeat(ESCALA));
const CERO = BigInt(0);

export function dec(valor: string): bigint {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(valor.trim());
  if (!m) throw new Error(`Decimal inválido: "${valor}"`);
  const [, signo, entero, fraccion = ''] = m;
  if (fraccion.length > ESCALA) throw new Error(`Más de ${ESCALA} decimales: "${valor}"`);
  const n = BigInt(entero!) * FACTOR + BigInt(fraccion.padEnd(ESCALA, '0'));
  return signo === '-' ? -n : n;
}

/** a * b, en escala doble (1e16). Sirve para comparar sin dividir. */
export function mulEscalaDoble(a: bigint, b: bigint): bigint {
  return a * b;
}

export function menorQue(a: string, b: string): boolean {
  return dec(a) < dec(b);
}
export function mayorOIgual(a: string, b: string): boolean {
  return dec(a) >= dec(b);
}
export function restar(a: string, b: string): string {
  const r = dec(a) - dec(b);
  const signo = r < CERO ? '-' : '';
  const abs = r < CERO ? -r : r;
  const entero = abs / FACTOR;
  const frac = (abs % FACTOR).toString().padStart(ESCALA, '0').replace(/0+$/, '');
  return `${signo}${entero}${frac ? '.' + frac : ''}`;
}