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
import { velasDiariasCerradas } from './velas-cerradas';
import { calcularValuacion, leerEntradaValuacion } from './valuacion-modelos';
import type { ResultadoValuacion } from './valuacion-modelos';
import { limpiarTicker } from './corridas-lectura';
import type { ClienteLectura, ResultadoLectura } from './corridas-lectura';
import { datosFundamentalesDeItems } from './revision-pmp-datos';
import { agregarRevision, sumarMeses, MESES_ENTRE_REVISIONES } from './revision-pmp-historial';
import type { EntradaRevision } from './revision-pmp-historial';
import { datosFinnhubRevision } from './revision-pmp-finnhub';
import type { DatosFinnhubRevision } from './revision-pmp-finnhub';

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
  /** Modelo de valuación de /position (P/E objetivo × EPS); null si no se pudo calcular. */
  modelo: ResultadoValuacion | null;
  cierre: { valor: number; fecha: string } | null;
  periodo_fundamentales: string | null;
  avisos: string[];
  /** true si la revisión quedó guardada en el historial del expediente PMP. */
  guardada: boolean;
  guardada_motivo: string | null;
  proxima_revision: string | null;
}

export async function ejecutarRevisionPmp(deps: DepsDatosReales, cliente: ClienteLectura, tickerCrudo: unknown, ahora: string, aniosCrudo?: unknown, guardar = false): Promise<ResultadoLectura<RevisionPmpResumen>> {
  const ticker = limpiarTicker(tickerCrudo);
  if (ticker === '') return { ok: false, http: 400, error: 'Ticker inválido' };
  const hoy = ahora.slice(0, 10);
  const avisos: string[] = [];

  const re = await cliente.from('oficina_expedientes').select('id,ficha').eq('ticker', ticker).eq('portafolio_codigo', 'PMP');
  if (re.error) return { ok: false, http: 500, error: 'No se pudo leer el expediente' };
  const exps = Array.isArray(re.data) ? re.data.filter(esObj) : [];
  if (exps.length > 1) return { ok: false, http: 409, error: `${ticker} tiene ${exps.length} expedientes en PMP (ambiguo)` };
  const fichaVal = exps.length === 1 ? valuacionVigente(exps[0]!['ficha']) : null;

  const velas = await obtenerVelasDiariasDe(deps, ticker);
  let cierre: RevisionPmpResumen['cierre'] = null;
  if (!velas.ok) avisos.push(`No se pudo leer el precio: ${velas.error}`);
  else {
    const cerradas = velasDiariasCerradas(velas.velas, ahora);
    const ultima = cerradas[cerradas.length - 1];
    if (ultima === undefined) avisos.push('Sin velas cerradas para tomar el cierre');
    else cierre = { valor: ultima.close, fecha: fechaDeVela(ultima.time) };
  }

  // Valor estimado = precio objetivo del modelo de valuación de /position (P/E objetivo × EPS a N años). Si el modelo no se puede calcular, cae a ficha.valuacion_base.
  const ev = await leerEntradaValuacion(deps, ticker);
  avisos.push(...ev.avisos);
  const modelo = calcularValuacion({ ...ev.entrada, precio: cierre?.valor ?? null, anios: typeof aniosCrudo === 'number' ? aniosCrudo : undefined });
  let valuacion: ValuacionVigente | null = null;
  if (modelo.precio_objetivo !== null) {
    valuacion = { valor: modelo.precio_objetivo, fecha: hoy, horizonte_meses: modelo.anios * 12, fuente: `Modelo de valuación: P/E ${modelo.pe_objetivo?.toFixed(1)}x (${modelo.origen_pe}) × EPS a ${modelo.anios} año(s) ${modelo.eps?.toFixed(2)} (${modelo.origen_eps})` };
  } else {
    avisos.push(`Modelo de valuación no calculable: ${modelo.motivo}`);
    valuacion = fichaVal;
    if (valuacion === null) avisos.push('Sin modelo de valuación ni valuacion_base declarada en la ficha: el 14% no se puede calcular');
    else avisos.push('Valor estimado tomado de ficha.valuacion_base (el modelo no se pudo calcular)');
  }

  let items: ItemDato[] = [];
  let extra: DatosFinnhubRevision | undefined;
  const dr = await obtenerDatosFundamental(deps, ticker);
  if (!dr.ok) avisos.push(`No se pudieron leer los fundamentales: ${dr.error}`);
  else {
    avisos.push(...dr.datos.avisos_obtencion);
    extra = datosFinnhubRevision(dr.datos.finnhub_reportado, dr.datos.finnhub_reportado_trimestral);
    const inc = itemsDesdeIncomeStatement(dr.datos.income_statement, { generado_en: ahora });
    if (inc.ok) items = items.concat(inc.items); else avisos.push(...inc.errores);
    const fin = itemsDesdeFinnhub({ reportado: dr.datos.finnhub_reportado, reportado_trimestral: dr.datos.finnhub_reportado_trimestral, metric: dr.datos.finnhub_metric }, { generado_en: ahora });
    if (fin.ok) items = items.concat(fin.items); else avisos.push(...fin.errores);
  }
  const f = datosFundamentalesDeItems(items, extra);
  avisos.push(...f.avisos);

  const r = revisionSemestralPMP({ valor_estimado: valuacion?.valor ?? null, cierre: cierre?.valor ?? null, horizonte_meses: valuacion?.horizonte_meses, fundamentales: f.datos });
  // Historial: solo con `guardar` y si el ticker tiene UN expediente PMP (no se crea nada). Si la base no deja escribir, se dice.
  let guardada = false; let guardada_motivo: string | null = null; let proxima: string | null = null;
  if (guardar) {
    if (exps.length !== 1) guardada_motivo = 'El ticker no tiene expediente en PMP: la consulta no se guarda';
    else {
      const entrada: EntradaRevision = {
        fecha: hoy, resultado: r.resultado, anios: modelo.precio_objetivo !== null ? modelo.anios : null,
        anualizada_pct: r.rendimiento.anualizado_pct, precio_objetivo: modelo.precio_objetivo, cierre: cierre?.valor ?? null,
        deterioros: r.fundamentales.deterioros, sin_datos: r.fundamentales.sin_datos, motivos: r.motivos.slice(0, 5).map(m => m.slice(0, 200)),
      };
      const w = await cliente.from('oficina_expedientes').update({ ficha: agregarRevision(exps[0]!['ficha'], entrada) }).eq('id', String(exps[0]!['id'])).select('id');
      if (w.error) guardada_motivo = 'No se pudo guardar la revisión';
      else if (!Array.isArray(w.data) || w.data.length !== 1) guardada_motivo = 'La base no permitió guardar (revisa el permiso de actualización de oficina_expedientes)';
      else { guardada = true; proxima = sumarMeses(hoy, MESES_ENTRE_REVISIONES); }
    }
  }
  return { ok: true, datos: { ...r, ticker, fecha: hoy, valuacion, modelo, cierre, periodo_fundamentales: f.periodo, avisos, guardada, guardada_motivo, proxima_revision: proxima } };
}
