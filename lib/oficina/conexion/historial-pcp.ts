// PCP-01 (v0.67): historial del gráfico en años, calculado de las velas diarias ya leídas (TwelveData vía /api/chart-data). Función pura.
// La ruta pide 5000 velas diarias y devuelve las últimas 2500 (~9.9 años): si llegan menos, la fuente entregó todo lo que existe
// (`historial_grafico_completo` = true); si llegan 2500 el historial pudo truncarse, pero entonces supera los 5 años de la regla.
// Sin velas no se declara nada: PCP-01 queda NO_EVALUABLE (nunca se supone el historial).
import type { DatoFuente } from '../auditor';
import { CAMPO_HISTORIAL_ANIOS, CAMPO_HISTORIAL_COMPLETO } from '../auditor/evaluadores';

/** Velas diarias máximas que devuelve la ruta chart-data (confirmado el 22-oct). */
export const LIMITE_VELAS_DIARIAS = 2500;
const SEGUNDOS_POR_ANIO = 365.25 * 86400;

export function datosHistorialPcp(velas: { diarias: { time: number }[]; fuente: string } | null | undefined, fecha: string): DatoFuente[] {
  if (!velas || velas.diarias.length < 2) return [];
  const primera = velas.diarias[0]!.time;
  const ultima = velas.diarias[velas.diarias.length - 1]!.time;
  if (!Number.isFinite(primera) || !Number.isFinite(ultima) || ultima <= primera) return [];
  // Se TRUNCA a dos decimales (no se redondea): 4.9993 años no debe pasar como 5.00 el mínimo de 5 años.
  const anios = (Math.floor(((ultima - primera) / SEGUNDOS_POR_ANIO) * 100) / 100).toFixed(2);
  const fuente = velas.fuente !== '' ? velas.fuente : 'velas diarias (chart-data)';
  return [
    { id: 'historial:anios', campo: CAMPO_HISTORIAL_ANIOS, categoria: 'precio', valor: anios, unidad: 'años', fuente, fecha_dato: fecha },
    { id: 'historial:completo', campo: CAMPO_HISTORIAL_COMPLETO, categoria: 'precio', valor: velas.diarias.length < LIMITE_VELAS_DIARIAS, unidad: null, fuente, fecha_dato: fecha },
  ];
}
