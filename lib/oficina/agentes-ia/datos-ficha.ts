// Reúne los datos extra de la ficha PMP-09 (dividendos, velas de los índices de referencia y resumen de fundamentales). Nada de esto bloquea la corrida:
// lo que no se pueda leer queda como null con su motivo y la ficha lo declara como «no propuesto». Solo lectura.
import { INDICES_REFERENCIA, resumenFundamentalPmp } from '../conexion/ficha-propuesta';
import type { DatosFichaExtra } from '../conexion/ficha-propuesta';
import { obtenerDividendos } from './datos-dividendos';
import { obtenerVelasDiariasDe } from './datos-velas';
import type { DepsDatosReales } from './datos-reales';

const VELAS_POR_INDICE = 400;

export async function reunirDatosFicha(deps: DepsDatosReales, ticker: string, fuentes: { income_statement?: unknown; finnhub_metric?: unknown }): Promise<DatosFichaExtra> {
  // v0.57: los índices se piden de uno en uno (antes los 4 a la vez, junto con las velas del ticker, y el límite de 8 consultas por minuto dejaba sin velas a los últimos).
  const divP = obtenerDividendos(deps, ticker);
  const idx: Awaited<ReturnType<typeof obtenerVelasDiariasDe>>[] = [];
  for (const s of INDICES_REFERENCIA) idx.push(await obtenerVelasDiariasDe(deps, s));
  const div = await divP;
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
