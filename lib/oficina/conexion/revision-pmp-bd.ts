// Revisión semestral PMP-11 de un ticker: solo lectura. Trae el valor estimado vigente (ficha.valuacion_base del expediente PMP), el cierre de la última vela
// cerrada y los fundamentales (Webull + Finnhub), y calcula con `revisionSemestralPMP`. No guarda nada, no compra ni vende: devuelve una tarea de revisión.
import { itemsDesdeFinnhub } from '../agentes-ia/datos-finnhub';
import { itemsDesdeIncomeStatement } from '../agentes-ia/datos-fundamental';
import { obtenerVelasDiariasDe } from '../agentes-ia/datos-velas';
import { obtenerDatosFundamental } from '../agentes-ia/datos-reales';
import type { DepsDatosReales } from '../agentes-ia/datos-reales';
import type { ItemDato } from '../agentes-ia/validar-fundamental';
import { revisionSemestralPMP } from '../motor/revision-pmp';
import type { ResultadoRevisionPMP } from '../motor/revision-pmp';
import { fechaDeVela } from './ficha-propuesta';
import { limpiarTicker } from './corridas-lectura';
import type { ClienteLectura, ResultadoLectura } from './corridas-lectura';
import { datosFundamentalesDeItems } from './revision-pmp-datos';

const esObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface ValuacionVigente { valor: number; fecha: string; horizonte_meses: number; fuente: string }

/** `ficha.valuacion_base` declarada por el usuario; null si no está declarada o no es válida. */
export function valuacionVigente(ficha: unknown): ValuacionVigente | null {
  if (!esObj(ficha) || !esObj(ficha['valuacion_base'])) return null;
  const v = ficha['valuacion_base'];
  const valor = typeof v['valor_estimado_base'] === 'number' ? v['valor_estimado_base'] : typeof v['valor_estimado_base'] === 'string' ? Number(v['valor_estimado_base']) : NaN;
  const h = v['horizonte_meses'];
  if (v['estado'] !== 'declarado' || !Number.isFinite(valor) || valor <= 0 || typeof h !== 'number' || !Number.isInteger(h) || h <= 0) return null;
  return { valor, fecha: typeof v['fecha'] === 'string' ? v['fecha'] : '', horizonte_meses: h, fuente: typeof v['fuente'] === 'string' ? v['fuente'] : '' };
}

export interface RevisionPmpResumen extends ResultadoRevisionPMP {
  ticker: string; fecha: string;
  valuacion: ValuacionVigente | null;
  cierre: { valor: number; fecha: string } | null;
  periodo_fundamentales: string | null;
  avisos: string[];
}

export async function ejecutarRevisionPmp(deps: DepsDatosReales, cliente: ClienteLectura, tickerCrudo: unknown, ahora: string): Promise<ResultadoLectura<RevisionPmpResumen>> {
  const ticker = limpiarTicker(tickerCrudo);
  if (ticker === '') return { ok: false, http: 400, error: 'Ticker inválido' };
  const hoy = ahora.slice(0, 10);
  const avisos: string[] = [];

  const re = await cliente.from('oficina_expedientes').select('id,ficha').eq('ticker', ticker).eq('portafolio_codigo', 'PMP');
  if (re.error) return { ok: false, http: 500, error: 'No se pudo leer el expediente' };
  const exps = Array.isArray(re.data) ? re.data.filter(esObj) : [];
  if (exps.length > 1) return { ok: false, http: 409, error: `${ticker} tiene ${exps.length} expedientes en PMP (ambiguo)` };
  const valuacion = exps.length === 1 ? valuacionVigente(exps[0]!['ficha']) : null;
  if (exps.length === 0) avisos.push('El ticker no tiene expediente en PMP: no hay valor estimado declarado');
  else if (valuacion === null) avisos.push('Falta declarar el valor estimado (ficha.valuacion_base): el 14% no se puede calcular');

  const velas = await obtenerVelasDiariasDe(deps, ticker);
  let cierre: RevisionPmpResumen['cierre'] = null;
  if (!velas.ok) avisos.push(`No se pudo leer el precio: ${velas.error}`);
  else {
    const cerradas = velas.velas.filter(v => Number.isFinite(v.close) && v.close > 0 && fechaDeVela(v.time) < hoy);
    const ultima = cerradas[cerradas.length - 1];
    if (ultima === undefined) avisos.push('Sin velas cerradas para tomar el cierre');
    else cierre = { valor: ultima.close, fecha: fechaDeVela(ultima.time) };
  }

  let items: ItemDato[] = [];
  const dr = await obtenerDatosFundamental(deps, ticker);
  if (!dr.ok) avisos.push(`No se pudieron leer los fundamentales: ${dr.error}`);
  else {
    avisos.push(...dr.datos.avisos_obtencion);
    const inc = itemsDesdeIncomeStatement(dr.datos.income_statement, { generado_en: ahora });
    if (inc.ok) items = items.concat(inc.items); else avisos.push(...inc.errores);
    const fin = itemsDesdeFinnhub({ reportado: dr.datos.finnhub_reportado, reportado_trimestral: dr.datos.finnhub_reportado_trimestral, metric: dr.datos.finnhub_metric }, { generado_en: ahora });
    if (fin.ok) items = items.concat(fin.items); else avisos.push(...fin.errores);
  }
  const f = datosFundamentalesDeItems(items);
  avisos.push(...f.avisos);

  const r = revisionSemestralPMP({ valor_estimado: valuacion?.valor ?? null, cierre: cierre?.valor ?? null, horizonte_meses: valuacion?.horizonte_meses, fundamentales: f.datos });
  return { ok: true, datos: { ...r, ticker, fecha: hoy, valuacion, cierre, periodo_fundamentales: f.periodo, avisos } };
}
