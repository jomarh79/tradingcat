import { dec } from './decimal';
import type { SalidaExigida } from './tipos';

export interface CompraPCP { cantidad: string; precio: string }

export interface EntradaSalidaPCP {
  plan: 'una_compra' | 'escalonado';
  compras: CompraPCP[];
  precio_actual: string;
  stop?: string | null;
  senal_salida: boolean;
  primera_salida_realizada: boolean;
}

/** Reglas de salida del PCP (matriz v2, sección 7.D). Código determinista; el Motor solo recibe el resultado.
 *  - Una compra: VENDER 100% con una señal de salida, o al tocar el stop si el plan era de una compra (PCP-07).
 *  - Dos o tres compras: REDUCIR 50% cuando el precio supera el costo promedio ponderado (PCP-06);
 *    VENDER el 50% restante con una señal de salida tras la primera salida.
 *  - En plan escalonado, tocar el stop no vende: es una zona de posible recompra. */
export function evaluarSalidaPCP(e: EntradaSalidaPCP): SalidaExigida | null {
  const n = e.compras.length;
  if (n === 0) return null;
  const precio = dec(e.precio_actual);

  if (n === 1) {
    if (e.senal_salida) {
      return { decision: 'VENDER', porcentaje: 100, regla: 'PCP-06', detalle: 'Señal de salida con una compra: se vende el 100%' };
    }
    if (e.plan === 'una_compra' && e.stop != null && precio <= dec(e.stop)) {
      return { decision: 'VENDER', porcentaje: 100, regla: 'PCP-07', detalle: 'Plan de una compra: el precio tocó el stop' };
    }
    return null;
  }

  if (e.primera_salida_realizada) {
    if (e.senal_salida) {
      return { decision: 'VENDER', porcentaje: 100, regla: 'PCP-06', detalle: 'Señal de salida tras la primera salida: se vende lo que queda' };
    }
    return null;
  }

  // Costo promedio ponderado: Σ(precio·cantidad) / Σ(cantidad). Se compara por producto cruzado, sin dividir.
    let sumaCantidad = BigInt(0);
  let sumaCosto = BigInt(0);
  for (const c of e.compras) {
    const q = dec(c.cantidad);
    sumaCantidad += q;
    sumaCosto += dec(c.precio) * q;
  }
  if (sumaCantidad === BigInt(0)) return null;
  if (precio * sumaCantidad > sumaCosto) {
    return { decision: 'REDUCIR', porcentaje: 50, regla: 'PCP-06', detalle: 'El precio supera el costo promedio ponderado: primera salida del 50%' };
  }
  return null;
}
