// Señales de salida de PMP tal como estaban en la última vela cerrada ANTES de una fecha (la de la venta anterior).
// Sirve para saber si una confirmación de salida es NUEVA o ya se cumplía cuando se hizo la salida anterior. Sin base de datos, determinista.
// Reconstruye con el mismo Técnico: velas diarias y semanales hasta el día anterior a la venta; la última semanal se descarta (puede estar en formación).

import { calcularTecnico, detonantePara } from '../tecnico';
import type { Candle } from '../tecnico';

const fechaVela = (v: Candle): string => new Date(v.time * 1000).toISOString().slice(0, 10);

export function senalesDeSalidaAntesDe(
  velas: { diarias: Candle[]; semanales: Candle[] },
  fecha_venta: string,
  ticker: string,
  fuente: string,
): string[] | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha_venta)) return null;
  const diarias = velas.diarias.filter(v => fechaVela(v) < fecha_venta);
  const semanales = velas.semanales.filter(v => fechaVela(v) < fecha_venta);
  const ultima = diarias[diarias.length - 1];
  if (ultima === undefined) return null;
  const snapshot = calcularTecnico({
    ticker, fecha_evaluacion: fechaVela(ultima), fuente,
    velas_diarias: diarias, velas_semanales: semanales,
    ultima_vela_diaria_cerrada: true, ultima_vela_semanal_cerrada: false,
  });
  if (snapshot.estado === 'NO_EVALUABLE') return null;
  return detonantePara(snapshot, 'salida_pmp').senales_cumplidas.slice();
}
