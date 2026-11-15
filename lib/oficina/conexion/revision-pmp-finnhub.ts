// Lo que la revisión PMP-11 necesita y los items del Fundamental no traen: flujo de caja libre por TRIMESTRE y deterioro de activos del último año fiscal.
// Los reportes trimestrales de Finnhub traen el flujo de caja ACUMULADO del año fiscal (Q1, Q1+Q2, Q1+Q2+Q3); el trimestre suelto sale por diferencia
// y el cuarto trimestre = anual − acumulado de Q3. Si falta cualquier pieza, ese trimestre no se calcula (nunca se rellena).
import { TRIMESTRE_ANUAL, TRIMESTRES_PARCIALES } from '../agentes-ia/constantes';
import { esUnidadUsdFinnhub } from '../agentes-ia/datos-finnhub';

const esObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const OPERATIVO = ['us-gaap_NetCashProvidedByUsedInOperatingActivities'];
const CAPEX = ['us-gaap_PaymentsToAcquirePropertyPlantAndEquipment'];
/** Partidas de deterioro que aparecen en el flujo de caja (se suman las que existan en USD). */
export const CONCEPTOS_DETERIORO = [
  'us-gaap_AssetImpairmentCharges', 'us-gaap_ImpairmentOfLongLivedAssetsHeldForUse', 'us-gaap_GoodwillImpairmentLoss',
  'us-gaap_ImpairmentOfIntangibleAssetsExcludingGoodwill', 'us-gaap_ImpairmentOfLongLivedAssetsToBeDisposedOf',
] as const;

interface Rep { year: number; quarter: number; fin: string; cf: Record<string, unknown>[] }

function reportes(resp: unknown): Rep[] {
  if (!esObj(resp) || !Array.isArray(resp['data'])) return [];
  const out: Rep[] = [];
  for (const r of resp['data']) {
    if (!esObj(r) || typeof r['year'] !== 'number' || typeof r['quarter'] !== 'number' || !esObj(r['report'])) continue;
    const cf = r['report']['cf'];
    const fin = typeof r['endDate'] === 'string' ? r['endDate'].slice(0, 10) : '';
    out.push({ year: r['year'], quarter: r['quarter'], fin, cf: Array.isArray(cf) ? cf.filter(esObj) : [] });
  }
  return out;
}

function concepto(cf: Record<string, unknown>[], conceptos: readonly string[]): number | null {
  for (const c of conceptos) {
    const it = cf.find(x => x['concept'] === c);
    if (it !== undefined && esUnidadUsdFinnhub(it['unit']) && typeof it['value'] === 'number' && Number.isFinite(it['value'])) return it['value'];
  }
  return null;
}
/** Flujo de caja libre acumulado de un reporte (operativo − inversión en activos fijos); null si falta alguna de las dos piezas. */
function fcfAcumulado(r: Rep | undefined): number | null {
  if (r === undefined) return null;
  const fo = concepto(r.cf, OPERATIVO); const px = concepto(r.cf, CAPEX);
  return fo !== null && px !== null ? fo - px : null;
}

export interface DatosFinnhubRevision {
  /** Flujo de caja libre de los últimos trimestres CONSECUTIVOS (más reciente al final); null si no se pudieron reconstruir 4. */
  fcf_trimestres: number[] | null;
  /** Deterioro de activos del último año fiscal. 0 solo si el flujo de caja de ese año está completo (trae flujo operativo) y no trae ninguna partida de deterioro. */
  deterioro: { fy: number; valor: number } | null;
  avisos: string[];
}

export function datosFinnhubRevision(reportado: unknown, trimestral: unknown): DatosFinnhubRevision {
  const avisos: string[] = [];
  const anuales = reportes(reportado).filter(r => r.quarter === TRIMESTRE_ANUAL).sort((a, b) => b.year - a.year);
  const parciales = reportes(trimestral).filter(r => (TRIMESTRES_PARCIALES as readonly number[]).includes(r.quarter));

  // trimestres sueltos por año fiscal: clave `${año}-${q}` → FCF del trimestre
  const q = new Map<string, number>();
  const anios = Array.from(new Set([...anuales.map(a => a.year), ...parciales.map(p => p.year)]));
  for (const y of anios) {
    const y1 = fcfAcumulado(parciales.find(p => p.year === y && p.quarter === 1));
    const y2 = fcfAcumulado(parciales.find(p => p.year === y && p.quarter === 2));
    const y3 = fcfAcumulado(parciales.find(p => p.year === y && p.quarter === 3));
    const an = fcfAcumulado(anuales.find(a => a.year === y));
    if (y1 !== null) q.set(`${y}-1`, y1);
    if (y1 !== null && y2 !== null) q.set(`${y}-2`, y2 - y1);
    if (y2 !== null && y3 !== null) q.set(`${y}-3`, y3 - y2);
    if (y3 !== null && an !== null) q.set(`${y}-4`, an - y3);
  }
  // los 4 trimestres consecutivos más recientes
  const orden: string[] = [];
  for (const y of anios) for (const n of [1, 2, 3, 4]) orden.push(`${y}-${n}`);
  orden.sort((a, b) => { const [ay, an] = a.split('-').map(Number) as [number, number]; const [by, bn] = b.split('-').map(Number) as [number, number]; return ay !== by ? ay - by : an - bn; });
  let fcf: number[] | null = null;
  for (let i = orden.length - 1; i >= 3; i--) {
    const vent = orden.slice(i - 3, i + 1);
    // consecutivos: sin saltos de trimestre entre ellos (los trimestres que faltan en el mapa rompen la ventana)
    if (vent.every(k => q.has(k)) && esConsecutiva(vent)) { fcf = vent.map(k => q.get(k) as number); break; }
  }
  if (fcf === null) avisos.push('Finnhub: no se pudieron reconstruir 4 trimestres consecutivos de flujo de caja libre');

  // deterioro del último año fiscal
  let deterioro: DatosFinnhubRevision['deterioro'] = null;
  const ult = anuales[0];
  if (ult === undefined) avisos.push('Finnhub: sin reporte anual para leer el deterioro de activos');
  else if (concepto(ult.cf, OPERATIVO) === null) avisos.push(`Finnhub: el flujo de caja de FY${ult.year} no está completo; el deterioro de activos no se evalúa`);
  else {
    let total = 0;
    for (const c of CONCEPTOS_DETERIORO) { const v = concepto(ult.cf, [c]); if (v !== null) total += Math.abs(v); }
    deterioro = { fy: ult.year, valor: total };
  }
  return { fcf_trimestres: fcf, deterioro, avisos };
}

function esConsecutiva(claves: string[]): boolean {
  const idx = claves.map(k => { const [y, n] = k.split('-').map(Number) as [number, number]; return y * 4 + (n - 1); });
  return idx.every((v, i) => i === 0 || v === idx[i - 1]! + 1);
}
