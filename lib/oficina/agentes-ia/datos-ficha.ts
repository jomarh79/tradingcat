// Reúne los datos extra de la ficha PMP-09 (dividendos, velas de los índices de referencia y resumen de fundamentales). Nada de esto bloquea la corrida:
// lo que no se pueda leer queda como null con su motivo y la ficha lo declara como «no propuesto». Solo lectura.
import { INDICES_REFERENCIA, resumenFundamentalPmp } from '../conexion/ficha-propuesta';
import type { DatosFichaExtra } from '../conexion/ficha-propuesta';
import { obtenerDividendos } from './datos-dividendos';
import { obtenerVelasDiariasDe } from './datos-velas';
import type { DepsDatosReales } from './datos-reales';

const VELAS_POR_INDICE = 400;

export async function reunirDatosFicha(deps: DepsDatosReales, ticker: string, fuentes: { income_statement?: unknown; finnhub_metric?: unknown }): Promise<DatosFichaExtra> {
  const [div, ...idx] = await Promise.all([
    obtenerDividendos(deps, ticker),
    ...INDICES_REFERENCIA.map(s => obtenerVelasDiariasDe(deps, s)),
  ]);
  const indices: DatosFichaExtra['indices'] = {};
  INDICES_REFERENCIA.forEach((s, i) => {
    const r = idx[i]!;
    indices[s] = r.ok ? r.velas.slice(-VELAS_POR_INDICE) : null;
  });
  return {
    dividendos: div.ok ? div.dividendos : null,
    ...(div.ok ? {} : { dividendos_error: div.error }),
    fundamentales: resumenFundamentalPmp(fuentes.income_statement, fuentes.finnhub_metric),
    indices,
  };
}
