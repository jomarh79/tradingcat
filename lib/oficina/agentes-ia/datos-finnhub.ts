// Convierte respuestas de Finnhub en items del snapshot del Fundamental: balance y flujo de caja (financials-reported, estados presentados ante la SEC)
// y ratios del proveedor (stock/metric). Código puro: no llama a ninguna API.
// El estado de resultados NO se toma de aquí: viene de Webull (las cifras del SEC clasifican el deterioro de intangibles distinto y darían dos utilidades brutas).
// Reglas: un concepto ausente se omite y se avisa (nunca se asume cero ni se infiere); la unidad debe ser USD; lo calculado lleva fuente de cálculo.
import {
  ANIOS_REPORTADOS_FINNHUB, FUENTE_CALCULO_FCF, FUENTE_CALCULO_RAZON_CORRIENTE, FUENTE_FINNHUB_METRIC, FUENTE_FINNHUB_REPORTADO,
  PREFIJO_UNIDAD_USD_FINNHUB, TRIMESTRE_ANUAL, TRIMESTRES_PARCIALES, UNIDAD_RATIO, UNIDAD_USD, UNIDAD_USD_FINNHUB,
} from './constantes';
import { fechaDe, redondear } from './datos-fundamental';
import type { ResultadoItemsOError } from './datos-fundamental';
import { esNumeroFinito, esObjeto, textoNoVacio } from './utilidades';
import type { ItemDato } from './validar-fundamental';

interface CampoConcepto { campo: string; conceptos: readonly string[] }

/** Conceptos us-gaap del balance. El primero que exista con valor numérico en USD gana. */
export const CAMPOS_BALANCE: readonly CampoConcepto[] = [
  { campo: 'efectivo', conceptos: ['us-gaap_CashAndCashEquivalentsAtCarryingValue'] },
  { campo: 'inversiones_corto_plazo', conceptos: ['us-gaap_AvailableForSaleSecuritiesDebtSecurities', 'us-gaap_MarketableSecuritiesCurrent', 'us-gaap_ShortTermInvestments'] },
  { campo: 'activos_corrientes', conceptos: ['us-gaap_AssetsCurrent'] },
  { campo: 'activos_totales', conceptos: ['us-gaap_Assets'] },
  { campo: 'pasivos_corrientes', conceptos: ['us-gaap_LiabilitiesCurrent'] },
  { campo: 'pasivos_totales', conceptos: ['us-gaap_Liabilities'] },
  { campo: 'patrimonio', conceptos: ['us-gaap_StockholdersEquity', 'us-gaap_StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'] },
  { campo: 'deuda_largo_plazo', conceptos: ['us-gaap_LongTermDebtNoncurrent', 'us-gaap_LongTermDebt'] },
  { campo: 'deuda_corriente', conceptos: ['us-gaap_LongTermDebtCurrent', 'us-gaap_DebtCurrent'] },
  { campo: 'pasivo_arrendamiento_financiero_no_corriente', conceptos: ['us-gaap_FinanceLeaseLiabilityNoncurrent'] },
];
export const CAMPOS_FLUJO: readonly CampoConcepto[] = [
  { campo: 'flujo_operativo', conceptos: ['us-gaap_NetCashProvidedByUsedInOperatingActivities'] },
  { campo: 'pagos_propiedad_planta_equipo', conceptos: ['us-gaap_PaymentsToAcquirePropertyPlantAndEquipment'] },
  { campo: 'flujo_inversion', conceptos: ['us-gaap_NetCashProvidedByUsedInInvestingActivities'] },
  { campo: 'flujo_financiamiento', conceptos: ['us-gaap_NetCashProvidedByUsedInFinancingActivities'] },
  { campo: 'compensacion_en_acciones', conceptos: ['us-gaap_ShareBasedCompensation'] },
];
/** Ratios de stock/metric (ya vienen como razón, no como porcentaje). */
export const CAMPOS_METRIC: readonly { clave: string; campo: string }[] = [
  { clave: 'currentRatioAnnual', campo: 'razon_corriente_anual_proveedor' },
  { clave: 'currentRatioQuarterly', campo: 'razon_corriente_trimestral_proveedor' },
  { clave: 'quickRatioAnnual', campo: 'prueba_acida_anual_proveedor' },
  { clave: 'quickRatioQuarterly', campo: 'prueba_acida_trimestral_proveedor' },
  { clave: 'totalDebt/totalEquityAnnual', campo: 'deuda_total_sobre_patrimonio_anual_proveedor' },
  { clave: 'totalDebt/totalEquityQuarterly', campo: 'deuda_total_sobre_patrimonio_trimestral_proveedor' },
  { clave: 'longTermDebt/equityAnnual', campo: 'deuda_largo_plazo_sobre_patrimonio_anual_proveedor' },
  { clave: 'longTermDebt/equityQuarterly', campo: 'deuda_largo_plazo_sobre_patrimonio_trimestral_proveedor' },
];
export const SUFIJO_FECHA_CONSULTA = 'a_fecha_de_consulta';

interface Reporte { year: number; quarter: number; form: string; fin: string; presentado: string | null; informe: Record<string, unknown> }
export interface EntradaFinnhub { reportado?: unknown; reportado_trimestral?: unknown; metric?: unknown }

function leerReportes(resp: unknown, nombre: string, avisos: string[]): Reporte[] | string {
  if (!esObjeto(resp) || !Array.isArray(resp['data'])) return `${nombre}: falta la lista \`data\``;
  const salida: Reporte[] = [];
  resp['data'].forEach((r, i) => {
    if (!esObjeto(r) || !esNumeroFinito(r['year']) || !esNumeroFinito(r['quarter']) || !esObjeto(r['report'])) { avisos.push(`${nombre}: reporte ${i} inválido, se omite`); return; }
    const fin = fechaDe(r['endDate']);
    if (fin === null) { avisos.push(`${nombre}: reporte ${i} con endDate ilegible, se omite (no se inventa la fecha)`); return; }
    salida.push({ year: r['year'], quarter: r['quarter'], form: textoNoVacio(r['form']) ? r['form'] : '', fin, presentado: fechaDe(r['filedDate']), informe: r['report'] });
  });
  salida.sort((a, b) => (a.fin < b.fin ? 1 : a.fin > b.fin ? -1 : (b.presentado ?? '') < (a.presentado ?? '') ? -1 : 1));
  return salida;
}

/** Unidad USD de Finnhub: `u_usd` exacta, o el prefijo `unit_standard_usd_` seguido de un código no vacío. */
export function esUnidadUsdFinnhub(u: unknown): boolean {
  if (typeof u !== 'string') return false;
  return u === UNIDAD_USD_FINNHUB || (u.startsWith(PREFIJO_UNIDAD_USD_FINNHUB) && u.length > PREFIJO_UNIDAD_USD_FINNHUB.length);
}

/** Primer concepto de la lista con valor numérico en USD; si existe con otra unidad se avisa y se sigue con el siguiente. */
function buscar(seccion: unknown[], conceptos: readonly string[], etiqueta: string, avisos: string[]): number | null {
  for (const c of conceptos) {
    const it = seccion.find(x => esObjeto(x) && x['concept'] === c);
    if (it === undefined || !esObjeto(it)) continue;
    if (!esUnidadUsdFinnhub(it['unit'])) { avisos.push(`${etiqueta}: ${c} con unidad inesperada, se omite`); continue; }
    if (esNumeroFinito(it['value'])) return it['value'];
  }
  return null;
}

function fuenteReporte(r: Reporte, extra: string): string {
  return `${FUENTE_FINNHUB_REPORTADO}: formulario ${r.form === '' ? 'sin dato' : r.form}${r.presentado === null ? '' : ` presentado ${r.presentado}`}${extra}`;
}
const sumaItem = (campo: string, etiqueta: string, valor: number, fuente: string, fecha: string): ItemDato =>
  ({ id: `${campo}_${etiqueta}`, campo: `${campo}_${etiqueta}`, valor, unidad: UNIDAD_USD, fuente, fecha_dato: fecha });

function leerSeccion(r: Reporte, nombre: 'bs' | 'cf', campos: readonly CampoConcepto[], etiqueta: string, avisos: string[]): Record<string, number> {
  const seccion = r.informe[nombre];
  const salida: Record<string, number> = {};
  if (!Array.isArray(seccion) || seccion.length === 0) {
    avisos.push(`${etiqueta}: ${nombre === 'bs' ? 'balance' : 'flujo de caja'} sin datos en la fuente (formulario ${r.form === '' ? 'sin dato' : r.form}, cierre ${r.fin})`);
    return salida;
  }
  for (const c of campos) {
    const v = buscar(seccion, c.conceptos, etiqueta, avisos);
    if (v === null) { avisos.push(`${etiqueta}: sin concepto para ${c.campo} (se omite; no se asume cero)`); continue; }
    salida[c.campo] = v;
  }
  return salida;
}

function itemsDeReporte(r: Reporte, etiqueta: string, acumulado: boolean, avisos: string[]): ItemDato[] {
  const items: ItemDato[] = [];
  const sufijo = acumulado ? `acum_${etiqueta}` : etiqueta;
  const nota = acumulado ? '; flujo de caja acumulado del año fiscal hasta el cierre del trimestre' : '';
  if (!acumulado || (Array.isArray(r.informe['bs']) && r.informe['bs'].length > 0)) {
    const bs = leerSeccion(r, 'bs', CAMPOS_BALANCE, etiqueta, avisos);
    for (const c of CAMPOS_BALANCE) { const v = bs[c.campo]; if (v !== undefined) items.push(sumaItem(c.campo, etiqueta, v, fuenteReporte(r, '; balance'), r.fin)); }
    const ac = bs['activos_corrientes']; const pc = bs['pasivos_corrientes'];
    if (ac !== undefined && pc !== undefined && pc !== 0) {
      items.push({ id: `razon_corriente_${etiqueta}`, campo: `razon_corriente_${etiqueta}`, valor: redondear(ac / pc), unidad: UNIDAD_RATIO, fuente: FUENTE_CALCULO_RAZON_CORRIENTE, fecha_dato: r.fin });
    }
  } else {
    avisos.push(`${etiqueta}: el balance de este reporte no viene en la fuente (formulario ${r.form === '' ? 'sin dato' : r.form}, cierre ${r.fin}); el balance más reciente disponible es el anual`);
  }
  const cf = leerSeccion(r, 'cf', CAMPOS_FLUJO, etiqueta, avisos);
  for (const c of CAMPOS_FLUJO) { const v = cf[c.campo]; if (v !== undefined) items.push(sumaItem(c.campo, sufijo, v, fuenteReporte(r, `; flujo de caja${nota}`), r.fin)); }
  const fo = cf['flujo_operativo']; const px = cf['pagos_propiedad_planta_equipo'];
  if (fo !== undefined && px !== undefined) {
    items.push({ id: `flujo_caja_libre_${sufijo}`, campo: `flujo_caja_libre_${sufijo}`, valor: fo - px, unidad: UNIDAD_USD, fuente: FUENTE_CALCULO_FCF, fecha_dato: r.fin });
  }
  return items;
}

export function itemsDesdeFinnhub(e: EntradaFinnhub, o: { generado_en: string; anios?: number }): ResultadoItemsOError {
  const avisos: string[] = [];
  const items: ItemDato[] = [];
  const anios = o.anios ?? ANIOS_REPORTADOS_FINNHUB;
  let ultimoAnual: string | null = null;
  if (e.reportado !== undefined) {
    const rs = leerReportes(e.reportado, 'finnhub financials-reported anual', avisos);
    if (typeof rs === 'string') return { ok: false, errores: [rs] };
    const anuales: Reporte[] = [];
    for (const r of rs.filter(x => x.quarter === TRIMESTRE_ANUAL)) {
      if (anuales.some(a => a.fin === r.fin)) { avisos.push(`fy${r.year}: reporte repetido para el cierre ${r.fin}, se conserva el más reciente presentado`); continue; }
      anuales.push(r);
    }
    if (anuales.length === 0) return { ok: false, errores: ['finnhub financials-reported anual: no hay ningún reporte anual con fecha legible'] };
    ultimoAnual = anuales[0]!.fin;
    for (const r of anuales.slice(0, anios)) items.push(...itemsDeReporte(r, `fy${r.year}`, false, avisos));
  }
  if (e.reportado_trimestral !== undefined) {
    const rs = leerReportes(e.reportado_trimestral, 'finnhub financials-reported trimestral', avisos);
    if (typeof rs === 'string') return { ok: false, errores: [rs] };
    const parciales = rs.filter(x => (TRIMESTRES_PARCIALES as readonly number[]).includes(x.quarter));
    const nuevo = parciales.find(x => ultimoAnual === null || x.fin > ultimoAnual);
    if (nuevo === undefined) avisos.push('finnhub financials-reported trimestral: no hay un reporte trimestral posterior al último anual');
    else items.push(...itemsDeReporte(nuevo, `t${nuevo.quarter}_${nuevo.year}`, true, avisos));
  }
  if (e.metric !== undefined) {
    if (!esObjeto(e.metric) || !esObjeto(e.metric['metric'])) return { ok: false, errores: ['finnhub metric: falta `metric`'] };
    const consulta = fechaDe(o.generado_en);
    if (consulta === null) avisos.push('finnhub metric: generado_en ilegible, se omiten los ratios del proveedor');
    else {
      for (const m of CAMPOS_METRIC) {
        const v = e.metric['metric'][m.clave];
        if (!esNumeroFinito(v)) { avisos.push(`finnhub metric: ${m.clave} sin dato (se omite, no se rellena)`); continue; }
        items.push({ id: `${m.campo}_${SUFIJO_FECHA_CONSULTA}`, campo: `${m.campo}_${SUFIJO_FECHA_CONSULTA}`, valor: v, unidad: UNIDAD_RATIO, fuente: FUENTE_FINNHUB_METRIC, fecha_dato: consulta });
      }
    }
  }
  return { ok: true, items, avisos };
}
