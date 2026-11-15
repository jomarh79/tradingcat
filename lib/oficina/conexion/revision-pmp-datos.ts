// Convierte los items de Webull y Finnhub (los mismos del Fundamental) en los datos que pide la revisión semestral PMP-11.
// Compara los DOS ÚLTIMOS años fiscales consecutivos (el TTM no tiene un TTM previo comparable). Lo que no existe queda null: nunca se rellena ni se supone cero.
import type { DatosFundamentalesPMP } from '../motor/revision-pmp';
import type { ItemDato } from '../agentes-ia/validar-fundamental';

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export interface ResultadoDatosRevision { datos: DatosFundamentalesPMP; periodo: string | null; avisos: string[] }

export function datosFundamentalesDeItems(items: readonly ItemDato[]): ResultadoDatosRevision {
  const valor = (campo: string, fy: number): number | null => num(items.find(i => i.campo === `${campo}_fy${fy}`)?.valor);
  const anios = Array.from(new Set(items.map(i => /_fy(\d{4})$/.exec(i.campo)?.[1]).filter((x): x is string => x !== undefined).map(Number))).sort((a, b) => b - a);
  const avisos: string[] = [];
  // último año fiscal con ingresos y el inmediato anterior (consecutivo)
  const act = anios.find(a => valor('ingresos', a) !== null && valor('ingresos', a - 1) !== null) ?? null;
  if (act === null) avisos.push('Sin dos años fiscales consecutivos con ingresos: ingresos, márgenes y deuda no se pueden comparar');
  const prev = act === null ? null : act - 1;
  const deuda = (fy: number | null): number | null => {
    if (fy === null) return null;
    const l = valor('deuda_largo_plazo', fy); const c = valor('deuda_corriente', fy);
    return l !== null && c !== null ? l + c : null;
  };
  // FCF anual: los dos últimos años fiscales consecutivos con flujo de caja libre
  const anFcf = anios.find(a => valor('flujo_caja_libre', a) !== null && valor('flujo_caja_libre', a - 1) !== null) ?? null;
  const fcfAnuales = anFcf === null ? null : [valor('flujo_caja_libre', anFcf - 1), valor('flujo_caja_libre', anFcf)];
  if (anFcf === null) avisos.push('Sin dos años fiscales consecutivos con flujo de caja libre');
  avisos.push('Flujo de caja libre por trimestre y deterioro de activos aún no se leen de las fuentes: esos criterios quedan sin datos');
  return {
    periodo: act === null ? null : `FY${act} vs FY${prev}`,
    avisos,
    datos: {
      ingresos_actual: act === null ? null : valor('ingresos', act),
      ingresos_previo: prev === null ? null : valor('ingresos', prev),
      margen_operativo_actual: act === null ? null : valor('margen_operativo', act),
      margen_operativo_previo: prev === null ? null : valor('margen_operativo', prev),
      deuda_total: deuda(act), deuda_total_previa: deuda(prev),
      fcf_trimestres: null, fcf_anuales: fcfAnuales,
      deterioro_activos: null, activos_totales: act === null ? null : valor('activos_totales', act),
    },
  };
}
