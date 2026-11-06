// Utilidades puras de validación compartidas por los validadores de Fundamental y Director.
import { ENTERO_MAXIMO_SIN_FUENTE, EPSILON_CIFRA, ESCALAS_CIFRA } from './constantes';

export type Obj = Record<string, unknown>;
export const esObjeto = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
export const textoNoVacio = (x: unknown): x is string => typeof x === 'string' && x.trim() !== '';
export const esNumeroFinito = (x: unknown): x is number => typeof x === 'number' && isFinite(x);
export const enRango = (x: unknown, min: number, max: number): x is number => esNumeroFinito(x) && x >= min && x <= max;
export const esEntero = (x: unknown): x is number => esNumeroFinito(x) && Number.isInteger(x);

/** AAAA-MM-DD que existe en el calendario. */
export function esFechaIso(x: unknown): x is string {
  if (typeof x !== 'string') return false;
  const d = new Date(`${x}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === x;
}

export function enumDe<T extends string>(x: unknown, valores: readonly T[]): x is T {
  return typeof x === 'string' && (valores as readonly string[]).includes(x);
}

/** Recoge todos los textos (valores string) de una estructura, en profundidad. `omitir` salta claves (ids, evidencias). */
export function recolectarTextos(x: unknown, omitir: readonly string[] = [], salida: string[] = []): string[] {
  if (typeof x === 'string') salida.push(x);
  else if (Array.isArray(x)) for (const e of x) recolectarTextos(e, omitir, salida);
  else if (esObjeto(x)) for (const k of Object.keys(x)) if (!omitir.includes(k)) recolectarTextos(x[k], omitir, salida);
  return salida;
}

// ---- instrucciones de compra o venta dirigidas al usuario (contrato, sección 3, punto 7). Heurística: ver LEEME.
const VERBOS_ORDEN = '(?:comprar|vender|recomprar|reducir|cerrar|liquidar|acumular|entrar|salir)';
const PATRONES_ORDEN: RegExp[] = [
  new RegExp(`\\b(?:debes|deber[ií]as|recomiendo|sugiero|te sugiero|te recomiendo|conviene|hay que|vale la pena|es momento de|es hora de)\\s+${VERBOS_ORDEN}\\b`, 'i'),
  /(?:^|[.;:!?\n]\s*)(?:compra|vende|recompra|compre|venda|recompre|liquida)\s+(?:ya|ahora|m[aá]s|todo|toda|tu|tus|esta|este|estas|estos|(?:la|las|el|los)\s+(?:acci|ticker|posici|etf|t[ií]tulo))/i,
  /(?:^|[.;:!?\n]\s*)(?:[Cc]ompra|[Vv]ende|[Rr]ecompra|[Cc]ompre|[Vv]enda|[Rr]ecompre|[Ll]iquida)\s+[A-Z][A-Z0-9.]{0,9}\b/,
  /\b(?:you should|i recommend|i suggest|we recommend)\s+(?:buy|buying|sell|selling|to buy|to sell)\b/i,
  /(?:^|[.;:!?\n]\s*)(?:buy|sell)\s+(?:now|more|all|the|your|this)\b/i,
  /(?:^|[.;:!?\n]\s*)(?:[Bb]uy|[Ss]ell)\s+[A-Z]{1,6}\b/,
];
export function contieneOrden(texto: string): boolean {
  return PATRONES_ORDEN.some(p => p.test(texto));
}

// ---- cifras
const CODIGOS_Y_IDS = /\b[A-Z]{2,6}-\d{1,3}\b|\b10-[KQ]\b/g;
const TOKEN_CIFRA = /(?<![A-Za-z0-9_])\d[\d.,]*/g;

export interface CifraEnTexto {
  token: string;
  /** Entero de un solo dígito sin decimales ni porcentaje (por ejemplo «2 analistas»): se toma como conteo y no exige fuente. */
  conteo: boolean;
}

/** Cifras de un texto, sin códigos de regla (PMP-01), formularios (10-K) ni ids (fundamental:h1). */
export function cifrasEnTexto(texto: string): CifraEnTexto[] {
  const limpio = texto.replace(CODIGOS_Y_IDS, ' ');
  const re = new RegExp(TOKEN_CIFRA.source, 'g');
  const salida: CifraEnTexto[] = [];
  let m: RegExpExecArray | null = re.exec(limpio);
  while (m !== null) {
    const token = m[0].replace(/[.,]+$/, '');
    const siguiente = limpio.charAt(m.index + m[0].length);
    salida.push({ token, conteo: /^\d+$/.test(token) && Number(token) <= ENTERO_MAXIMO_SIN_FUENTE && siguiente !== '%' });
    m = re.exec(limpio);
  }
  return salida;
}
export const cifrasDe = (texto: string): string[] => cifrasEnTexto(texto).map(c => c.token);
/** Forma comparable de una cifra: solo dígitos (se ignoran separadores de miles y decimales; límite documentado en el LEEME). */
export const canonCifra = (t: string): string => t.replace(/[.,]/g, '').replace(/^0+(?=\d)/, '');
export const tieneCifra = (texto: string): boolean => cifrasDe(texto).length > 0;

const FECHA_ISO = /\b\d{4}-\d{2}-\d{2}\b/g;

/** Lecturas posibles de una cifra escrita (el separador puede ser de miles o decimal): valor y número de decimales de cada una. */
export function lecturasDeCifra(token: string): { valor: number; decimales: number }[] {
  const lecturas: { valor: number; decimales: number }[] = [];
  const agregar = (entera: string, decimal: string): void => {
    const v = Number(decimal === '' ? entera : `${entera}.${decimal}`);
    if (isFinite(v)) lecturas.push({ valor: v, decimales: decimal.length });
  };
  if (/^\d+$/.test(token)) { agregar(token, ''); return lecturas; }
  const ultima = Math.max(token.lastIndexOf('.'), token.lastIndexOf(','));
  // 1) el último separador es decimal y los anteriores son de miles
  agregar(token.slice(0, ultima).replace(/[.,]/g, ''), token.slice(ultima + 1));
  // 2) todos los separadores son de miles (solo si los grupos son de 3 dígitos)
  if (/^\d{1,3}([.,]\d{3})+$/.test(token)) agregar(token.replace(/[.,]/g, ''), '');
  return lecturas;
}

/** Números enteros que aparecen dentro de textos (por ejemplo los 8, 21 y 200 de `ind_ema8`, `ind_ema21`, `ind_ema200_diaria`): son parámetros, no cifras. */
export function numerosEnTextos(textos: readonly string[]): number[] {
  const out = new Set<number>();
  for (const t of textos) for (const m of t.match(/\d+/g) ?? []) out.add(Number(m));
  return Array.from(out);
}

/** Cifras del texto que no coinciden con ningún valor dado: tal cual, como porcentaje o en miles, millones o miles de millones, redondeadas al número de decimales con que se escribió
 *  (62.01 NO respalda 62.0196: esa cifra se redondea a 62.02). Se ignoran las fechas ISO, los conteos de un dígito y los `permitidos` (parámetros de indicadores). */
export function cifrasSinRespaldo(texto: string, valores: readonly number[], permitidos: readonly number[] = []): string[] {
  const sin = texto.replace(FECHA_ISO, ' ');
  const base = valores.map(Math.abs);
  const sueltas: string[] = [];
  for (const c of cifrasEnTexto(sin)) {
    if (c.conteo) continue;
    const ok = lecturasDeCifra(c.token).some(l =>
      permitidos.includes(l.valor)
      || base.some(v => ESCALAS_CIFRA.some(k => Math.abs(l.valor - v * k) <= 0.5 * Math.pow(10, -l.decimales) + EPSILON_CIFRA * Math.max(1, Math.abs(l.valor)))));
    if (!ok) sueltas.push(c.token);
  }
  return sueltas;
}

export function resumirErrores(errores: readonly string[], max: number): string {
  const vistos = errores.slice(0, max);
  return vistos.join('; ') + (errores.length > max ? `; (+${errores.length - max} más)` : '');
}
