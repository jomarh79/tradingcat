import { dec, mayorOIgual } from './decimal';
import type { NivelSalidaPMP } from './salida-pmp';
import type { SalidaExigida } from './tipos';

const FACTOR_DECIMAL = BigInt('100000000');   // escala interna de `dec` (1e8); sin literales bigint por el target de tsconfig

/** Texto decimal de un valor en la escala interna de `dec`, sin ceros finales. Solo para mostrar el costo promedio. */
function textoDeEscala(n: bigint): string {
  const negativo = n < BigInt(0);
  const abs = negativo ? -n : n;
  const frac = (abs % FACTOR_DECIMAL).toString().padStart(8, '0').replace(/0+$/, '');
  return `${negativo ? '-' : ''}${abs / FACTOR_DECIMAL}${frac ? '.' + frac : ''}`;
}

export interface CompraPCP { cantidad: string; precio: string }
/** TP1..TP3 del trade con su casilla «cumplido» (mismo formato que PMP). */
export type NivelSalidaPCP = NivelSalidaPMP;
export type PlanPCP = 'una_compra' | 'escalonado';

/** Con 3 compras ya no hay más recompras (PCP-03): el plan escalonado admite hasta 2 recompras tras la apertura. */
export const MAX_COMPRAS_PCP = 3;
export const REGLA_SALIDA_PCP = 'PCP-06';
/** La venta por stop del plan de una compra se registra con PCP-07 (como antes de v0.65). */
export const REGLA_STOP_PCP = 'PCP-07';

export interface EntradaSalidaPCP {
  /** Plan declarado en la ficha (PCP-07). null = no declarado: el stop no se evalúa y se avisa. */
  plan: PlanPCP | null;
  compras: CompraPCP[];
  precio_actual: string;
  stop?: string | null;
  /** v0.65: TP1, TP2 y TP3 de `trades`. Ausente = solo cuentan las señales (comportamiento anterior). */
  niveles?: readonly [NivelSalidaPCP, NivelSalidaPCP, NivelSalidaPCP];
  senal_salida: boolean;
  primera_salida_realizada: boolean;
}

export interface ResultadoSalidaPCP {
  exigida: SalidaExigida | null;
  precio_actual: string;
  compras: number;
  /** v0.85: etapa de la posición = take profit con valor (TP1 apertura, TP2 1.ª recompra, TP3 2.ª recompra); si no hay ninguno, el número de compras. */
  etapas: number;
  costo_promedio: string | null;
  primera_salida_realizada: boolean;
  motivo: 'senal_salida' | 'nivel_planeado' | 'costo_promedio' | 'stop' | null;
  /** Texto del nivel que disparó la salida (p. ej. «TP2 = 120»); null si no fue un nivel. */
  nivel_alcanzado: string | null;
  niveles: NivelSalidaPCP[];
  stop: string | null;
  /** Plan escalonado con el precio en o bajo el stop y recompras disponibles: solo un aviso, nunca una venta. */
  zona_recompra: boolean;
  recompras_restantes: number | null;
  senal_salida: boolean;
  faltantes: string[];
}

/** Reglas de salida del PCP (matriz v2, sección 7.D; v0.65 añade los TP de `trades`, aprobado el 18-nov). Código determinista.
 *  - Una compra: VENDER 100% con una señal de salida o al alcanzar TP1; o al tocar el stop si el plan era de una compra (PCP-07).
 *  - Dos o tres compras: REDUCIR 50% cuando el precio supera el costo promedio ponderado (PCP-06) y, si el trade tiene TP1 sin cumplir, también alcanza TP1 (la señal sola no adelanta la primera salida);
 *    después VENDER el resto con una señal de salida o al alcanzar TP2 o TP3. Un nivel ya marcado «cumplido» no vuelve a disparar.
 *  - En plan escalonado, tocar el stop no vende: es una zona de posible recompra (hasta 2). La Oficina nunca vende sola. */
export function evaluarPlanSalidaPCP(e: EntradaSalidaPCP): ResultadoSalidaPCP {
  const n = e.compras.length;
  const niveles: NivelSalidaPCP[] = e.niveles ? e.niveles.map(x => ({ ...x })) : [];
  const stop = e.stop != null && e.stop !== '' ? e.stop : null;
  // v0.85 (decisión de Jaime, 24-nov): la etapa la marcan los TP con valor, no el historial de compras (con ventas parciales y nuevas compras el historial se desfasa)
  const llenos = niveles.filter(x => x.nivel !== null).length;
  const ne = llenos > 0 ? llenos : n;
  const faltantes: string[] = [];
  const base = {
    precio_actual: e.precio_actual, compras: n, etapas: ne, costo_promedio: null as string | null, primera_salida_realizada: e.primera_salida_realizada,
    niveles, stop, zona_recompra: false, recompras_restantes: null as number | null, senal_salida: e.senal_salida, faltantes,
  };
  const sin = (): ResultadoSalidaPCP => ({ ...base, exigida: null, motivo: null, nivel_alcanzado: null });
  if (n === 0) return sin();

  const precio = dec(e.precio_actual);
  let sumaCantidad = BigInt(0);
  let sumaCosto = BigInt(0);
  for (const c of e.compras) {
    const q = dec(c.cantidad);
    sumaCantidad += q;
    sumaCosto += dec(c.precio) * q;
  }
  if (sumaCantidad > BigInt(0)) base.costo_promedio = textoDeEscala(sumaCosto / sumaCantidad);

  if (e.plan === null && stop !== null) faltantes.push('plan_pcp: la posición no declara su plan; el stop no se evalúa (ni como venta ni como zona de recompra)');
  if (e.plan === 'escalonado' && stop !== null && precio <= dec(stop) && ne < MAX_COMPRAS_PCP) {
    base.zona_recompra = true;
    base.recompras_restantes = MAX_COMPRAS_PCP - ne;
  } else if (e.plan === 'escalonado') {
    base.recompras_restantes = Math.max(0, MAX_COMPRAS_PCP - ne);
  }

  const alcanzado = (i: number): string | null => {
    const x = niveles[i];
    return x !== undefined && !x.cumplido && x.nivel !== null && mayorOIgual(e.precio_actual, x.nivel) ? `TP${i + 1} = ${x.nivel}` : null;
  };
  const vender = (motivo: NonNullable<ResultadoSalidaPCP['motivo']>, detalle: string, nivel: string | null): ResultadoSalidaPCP =>
    ({ ...base, exigida: { decision: 'VENDER', porcentaje: 100, regla: motivo === 'stop' ? REGLA_STOP_PCP : REGLA_SALIDA_PCP, detalle }, motivo, nivel_alcanzado: nivel });

  // v0.85: etapa final (los 3 TP llenos = apertura y 2 recompras) y el cierre en o bajo el stop: se propone salir del activo (100%). Nunca vende sola.
  if (e.plan === 'escalonado' && stop !== null && precio <= dec(stop) && ne >= MAX_COMPRAS_PCP) {
    return vender('stop', 'Etapa final (apertura y 2 recompras) y el precio tocó el stop: se sale del activo', null);
  }

  if (ne === 1) {
    if (e.senal_salida) return vender('senal_salida', 'Señal de salida con una compra: se vende el 100%', null);
    const tp1 = alcanzado(0);
    if (tp1 !== null) return vender('nivel_planeado', `El precio ${e.precio_actual} llegó a ${tp1} con una compra: se vende el 100%`, tp1);
    if (e.plan === 'una_compra' && stop !== null && precio <= dec(stop)) {
      return vender('stop', 'Plan de una compra: el precio tocó el stop', null);
    }
    return sin();
  }

  if (e.primera_salida_realizada) {
    if (e.senal_salida) return vender('senal_salida', 'Señal de salida tras la primera salida: se vende lo que queda', null);
    const tp = alcanzado(1) ?? alcanzado(2);
    if (tp !== null) return vender('nivel_planeado', `El precio ${e.precio_actual} llegó a ${tp} tras la primera salida: se vende lo que queda`, tp);
    return sin();
  }

  if (sumaCantidad === BigInt(0)) return sin();
  // Costo promedio ponderado: Σ(precio·cantidad) / Σ(cantidad). Se compara por producto cruzado, sin dividir.
  // 18-nov: si el trade tiene TP1 sin cumplir, la primera salida espera también a TP1 (por lo regular TP1 = costo promedio; si queda por encima, manda TP1).
  const tp1 = alcanzado(0);
  const tp1Pendiente = niveles[0] !== undefined && niveles[0].nivel !== null && !niveles[0].cumplido;
  if (precio * sumaCantidad > sumaCosto && (!tp1Pendiente || tp1 !== null)) {
    const por = tp1 !== null ? ` (también llegó a ${tp1})` : e.senal_salida ? ' (también hay señal de salida)' : '';
    return {
      ...base,
      exigida: { decision: 'REDUCIR', porcentaje: 50, regla: REGLA_SALIDA_PCP, detalle: `El precio supera el costo promedio ponderado${por}: primera salida del 50%` },
      motivo: tp1 !== null ? 'nivel_planeado' : e.senal_salida ? 'senal_salida' : 'costo_promedio', nivel_alcanzado: tp1,
    };
  }
  return sin();
}

/** Compatibilidad: solo la salida exigida. */
export function evaluarSalidaPCP(e: EntradaSalidaPCP): SalidaExigida | null {
  return evaluarPlanSalidaPCP(e).exigida;
}
