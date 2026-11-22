// v0.71: alerta informativa de salud financiera para PCP (decisión de Jaime, 21-nov): ¿la empresa genera flujo de caja libre positivo y ganancias?
// NO compra ni bloquea nada; solo ayuda a decidir cuánto invertir. Código puro y determinista: usa los datos ya leídos de Webull (utilidad neta) y de
// Finnhub (flujo de caja libre). Periodo: TTM y último año fiscal. Lo que no se pueda leer queda «sin datos»; nunca se rellena.
import { itemsDesdeFinnhub } from '../agentes-ia/datos-finnhub';

export type EstadoMedida = 'positivo' | 'negativo' | 'mixto' | 'sin_datos';
export type ResumenSalud = 'solida' | 'mixta' | 'debil' | 'sin_datos';

export interface Medida {
  estado: EstadoMedida;
  /** Cifra TTM en la unidad de la fuente (solo para mostrar el signo y el orden de magnitud); null si no hay dato. */
  ttm: number | null;
  /** Último año fiscal; `fy` es su etiqueta (por ejemplo fy2025). */
  anual: number | null;
  fy: string | null;
}
export interface SaludFinanciera {
  ganancias: Medida;
  flujo_caja: Medida;
  resumen: ResumenSalud;
  texto: string;
  avisos: string[];
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const objeto = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function estadoDe(valores: (number | null)[]): EstadoMedida {
  const v = valores.filter((x): x is number => x !== null);
  if (v.length === 0) return 'sin_datos';
  if (v.every(x => x > 0)) return 'positivo';
  if (v.every(x => x <= 0)) return 'negativo';
  return 'mixto';
}

/** Utilidad neta: TTM y último año fiscal del income-statement de Webull. */
function medirGanancias(income: unknown): Medida {
  const inc = objeto(income);
  const ttm = num(objeto(inc?.['ttm'])?.['netIncome']);
  const anuales = (Array.isArray(inc?.['annual']) ? (inc!['annual'] as unknown[]) : []).map(objeto)
    .filter((x): x is Record<string, unknown> => x !== null && num(x['fiscalYear']) !== null && num(x['netIncome']) !== null)
    .sort((a, b) => (num(a['fiscalYear']) as number) - (num(b['fiscalYear']) as number));
  const u = anuales.at(-1);
  const anual = u === undefined ? null : num(u['netIncome']);
  return { estado: estadoDe([ttm, anual]), ttm, anual, fy: u === undefined ? null : `fy${String(u['fiscalYear'])}` };
}

/** Flujo de caja libre: TTM de stock/metric de Finnhub y último año fiscal (operativo − compra de propiedad, planta y equipo del reporte anual; si falta, el anual de stock/metric). */
function medirFlujo(reportado: unknown, metric: unknown, avisos: string[]): Medida {
  const m = objeto(objeto(metric)?.['metric']);
  const ttm = m === null ? null : num(m['freeCashFlowTTM']);
  let anual: number | null = null;
  let fy: string | null = null;
  if (reportado !== undefined && reportado !== null) {
    const r = itemsDesdeFinnhub({ reportado }, { generado_en: new Date().toISOString() });
    if (r.ok) {
      const fcf = r.items.map(i => ({ i, m: /^flujo_caja_libre_(fy(\d{4}))$/.exec(i.id) })).filter(x => x.m !== null && num(x.i.valor) !== null)
        .sort((a, b) => Number(a.m![2]) - Number(b.m![2])).at(-1);
      if (fcf !== undefined) { anual = fcf.i.valor as number; fy = fcf.m![1] as string; }
    } else avisos.push(`flujo de caja del reporte anual no legible: ${r.errores[0] ?? 'error'}`);
  }
  if (anual === null && m !== null) {
    const a = num(m['freeCashFlowAnnual']);
    if (a !== null) { anual = a; fy = 'anual (proveedor)'; }
  }
  return { estado: estadoDe([ttm, anual]), ttm, anual, fy };
}

const FRASE: Record<EstadoMedida, string> = { positivo: 'positivo', negativo: 'negativo', mixto: 'mixto (TTM y último año no coinciden)', sin_datos: 'sin datos' };

export function evaluarSaludFinanciera(fuentes: { income_statement?: unknown; finnhub_reportado?: unknown; finnhub_metric?: unknown }): SaludFinanciera {
  const avisos: string[] = [];
  const ganancias = medirGanancias(fuentes.income_statement);
  const flujo_caja = medirFlujo(fuentes.finnhub_reportado, fuentes.finnhub_metric, avisos);
  const e = [ganancias.estado, flujo_caja.estado];
  const resumen: ResumenSalud = e.every(x => x === 'sin_datos') ? 'sin_datos'
    : e.every(x => x === 'positivo') ? 'solida'
      : e.every(x => x === 'negativo') ? 'debil' : 'mixta';
  const cola = resumen === 'solida' ? 'Genera ganancias y flujo de caja libre.'
    : resumen === 'debil' ? 'No genera ganancias ni flujo de caja libre: es un dato para pensar con cuidado cuánto invertir.'
      : resumen === 'sin_datos' ? 'No hay datos para evaluarla.' : 'Una de las dos medidas no es claramente positiva: revísala antes de decidir el monto.';
  return {
    ganancias, flujo_caja, resumen, avisos,
    texto: `Ganancias (utilidad neta): ${FRASE[ganancias.estado]}. Flujo de caja libre: ${FRASE[flujo_caja.estado]}. ${cola} Es solo informativa: no compra, no vende ni bloquea.`,
  };
}
