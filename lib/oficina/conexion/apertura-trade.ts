// Compra inicial de un trade de TradingCat. La apertura NO crea fila en `trade_executions` (solo guarda ahí recompras y ventas): vive en `trades`
// como entry_price × initial_quantity (confirmado con el trade abierto de META: 615.755 × 0.08099 = 49.87 USD, sin ejecuciones).
// Función pura. Si algún dato falta o no es válido devuelve null (no se estima). Si una ejecución de compra ya tiene la cantidad inicial,
// se entiende que esa ejecución ES la apertura y no se suma dos veces.
import { aDec } from '../auditor/numeros';

export const COLUMNAS_TRADE_APERTURA = 'id,entry_price,initial_quantity';
const CERO = BigInt(0);
const FACTOR = BigInt(10) ** BigInt(8);
const CENTAVO = BigInt(10) ** BigInt(6);   // 0.01 en la escala interna (1e8)

export interface CompraApertura { precio: bigint; cantidad: bigint; total: bigint }

export function compraDeApertura(trade: unknown, compras: { quantity: unknown }[]): CompraApertura | null {
  if (typeof trade !== 'object' || trade === null || Array.isArray(trade)) return null;
  const t = trade as Record<string, unknown>;
  const precio = aDec(t['entry_price']);
  const cantidad = aDec(t['initial_quantity']);
  if (precio === null || cantidad === null || precio <= CERO || cantidad <= CERO) return null;
  if (compras.some(c => aDec(c.quantity) === cantidad)) return null;
  // total en USD redondeado al centavo (half-up): precio × cantidad tiene escala 1e16
  const bruto = precio * cantidad;                  // 1e16
  const centavos = (bruto + (FACTOR * CENTAVO) / BigInt(2)) / (FACTOR * CENTAVO);
  return { precio, cantidad, total: centavos * CENTAVO };
}
