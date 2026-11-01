// Arma `snapshot.datos.items` del Fundamental a partir del estado de resultados de Webull (la misma respuesta que usa FundamentalsModal:
// GET /api/webull/income-statement → { success, annual[], ttm, forwardEps }). Código puro: no llama a ninguna API.
// Reglas: un valor nulo NO se rellena (se omite y se avisa); una fecha ilegible NO se inventa (se omite el item); los márgenes y el crecimiento los
// calcula el código (el modelo no calcula). Solo estado de resultados: Webull no trae balance ni flujo de caja.
import {
  ANIOS_ANUALES_FUNDAMENTAL, CONTRATO_ENTRADA, DECIMALES_RATIO, FUENTE_CALCULO_CODIGO, FUENTE_WEBULL_INCOME, MONEDA_POR_OMISION, PERIODO_TTM,
  UNIDAD_ACCIONES, UNIDAD_EPS, UNIDAD_RATIO, AGENTE_FUNDAMENTAL,
} from './constantes';
import { esFechaIso, esNumeroFinito, esObjeto, textoNoVacio } from './utilidades';
import type { ItemDato } from './validar-fundamental';

type Tipo = 'dinero' | 'eps' | 'acciones';
interface CampoBruto { clave: string; campo: string; tipo: Tipo }
/** Campos del estado de resultados que se pasan al agente (los demás de Webull no se usan en esta versión). */
const CAMPOS_BRUTOS: readonly CampoBruto[] = [
  { clave: 'revenue', campo: 'ingresos', tipo: 'dinero' },
  { clave: 'grossProfit', campo: 'utilidad_bruta', tipo: 'dinero' },
  { clave: 'opIncome', campo: 'utilidad_operativa', tipo: 'dinero' },
  { clave: 'netIncome', campo: 'utilidad_neta', tipo: 'dinero' },
  { clave: 'dilutedEps', campo: 'eps_diluido', tipo: 'eps' },
  { clave: 'dilutedAvgShares', campo: 'acciones_diluidas', tipo: 'acciones' },
];
const MARGENES: readonly { clave: string; campo: string }[] = [
  { clave: 'grossProfit', campo: 'margen_bruto' },
  { clave: 'opIncome', campo: 'margen_operativo' },
  { clave: 'netIncome', campo: 'margen_neto' },
];
const CRECIMIENTOS: readonly { clave: string; campo: string }[] = [
  { clave: 'revenue', campo: 'crecimiento_ingresos' },
  { clave: 'netIncome', campo: 'crecimiento_utilidad_neta' },
  { clave: 'dilutedEps', campo: 'crecimiento_eps_diluido' },
];

export interface ResultadoItems { ok: true; items: ItemDato[]; avisos: string[] }
export type ResultadoItemsOError = ResultadoItems | { ok: false; errores: string[] };

const redondear = (x: number): number => Math.round(x * Math.pow(10, DECIMALES_RATIO)) / Math.pow(10, DECIMALES_RATIO);
const numero = (x: unknown): number | null => (esNumeroFinito(x) ? x : null);
/** AAAA-MM-DD desde un texto que empiece con esa fecha (admite «2025-12-31T00:00:00»). null si no es una fecha real. */
export function fechaDe(x: unknown): string | null {
  if (typeof x !== 'string') return null;
  const f = x.slice(0, 10);
  return esFechaIso(f) ? f : null;
}

interface Periodo { etiqueta: string; fecha: string; moneda: string; datos: Record<string, unknown> }

function leerPeriodo(e: unknown, etiqueta: string, avisos: string[]): Periodo | null {
  if (!esObjeto(e)) { avisos.push(`${etiqueta}: entrada inválida, se omite`); return null; }
  const fecha = fechaDe(e['endDate']);
  if (fecha === null) { avisos.push(`${etiqueta}: endDate ilegible, se omite el periodo (no se inventa la fecha)`); return null; }
  return { etiqueta, fecha, moneda: textoNoVacio(e['currency']) ? e['currency'] : MONEDA_POR_OMISION, datos: e };
}

export function itemsDesdeIncomeStatement(resp: unknown, opciones: { generado_en: string; anios?: number }): ResultadoItemsOError {
  if (!esObjeto(resp) || resp['success'] !== true) return { ok: false, errores: ['la respuesta de income-statement no es exitosa (success !== true)'] };
  if (!Array.isArray(resp['annual'])) return { ok: false, errores: ['la respuesta de income-statement no trae `annual`'] };
  const avisos: string[] = [];
  const anios = opciones.anios ?? ANIOS_ANUALES_FUNDAMENTAL;
  const crudos = resp['annual'].slice(-anios);
  const periodos: Periodo[] = [];
  crudos.forEach(e => {
    const fy = esObjeto(e) ? e['fiscalYear'] : undefined;
    const p = leerPeriodo(e, `fy${String(fy)}`, avisos);
    if (p !== null) periodos.push(p);
  });
  const ttm = resp['ttm'] === null || resp['ttm'] === undefined ? null : leerPeriodo(resp['ttm'], PERIODO_TTM, avisos);
  if (ttm === null && (resp['ttm'] === null || resp['ttm'] === undefined)) avisos.push('ttm: sin datos en la respuesta');
  const todos = ttm === null ? periodos : [...periodos, ttm];
  if (todos.length === 0) return { ok: false, errores: ['no hay ningún periodo con fecha legible'] };

  const items: ItemDato[] = [];
  const unidadDe = (t: Tipo, moneda: string): string => (t === 'dinero' ? moneda : t === 'eps' ? `${moneda} ${UNIDAD_EPS}` : UNIDAD_ACCIONES);
  for (const p of todos) {
    for (const c of CAMPOS_BRUTOS) {
      const v = numero(p.datos[c.clave]);
      if (v === null) { avisos.push(`${p.etiqueta}: ${c.campo} sin dato (se omite, no se rellena)`); continue; }
      items.push({ id: `${c.campo}_${p.etiqueta}`, campo: `${c.campo}_${p.etiqueta}`, valor: v, unidad: unidadDe(c.tipo, p.moneda), fuente: FUENTE_WEBULL_INCOME, fecha_dato: p.fecha });
    }
    const ingresos = numero(p.datos['revenue']);
    for (const m of MARGENES) {
      const v = numero(p.datos[m.clave]);
      if (v === null || ingresos === null || ingresos === 0) continue;
      items.push({ id: `${m.campo}_${p.etiqueta}`, campo: `${m.campo}_${p.etiqueta}`, valor: redondear(v / ingresos), unidad: UNIDAD_RATIO, fuente: FUENTE_CALCULO_CODIGO, fecha_dato: p.fecha });
    }
  }
  // crecimiento interanual: solo entre años fiscales consecutivos de la lista (no incluye TTM)
  for (let i = 1; i < periodos.length; i++) {
    const act = periodos[i] as Periodo; const ant = periodos[i - 1] as Periodo;
    for (const g of CRECIMIENTOS) {
      const a = numero(act.datos[g.clave]); const b = numero(ant.datos[g.clave]);
      if (a === null || b === null || b === 0) continue;
      items.push({ id: `${g.campo}_${act.etiqueta}`, campo: `${g.campo}_${act.etiqueta}`, valor: redondear((a - b) / Math.abs(b)), unidad: UNIDAD_RATIO, fuente: FUENTE_CALCULO_CODIGO, fecha_dato: act.fecha });
    }
  }
  // EPS estimado por analistas: no trae fecha propia; se usa la fecha de consulta del snapshot y el nombre lo dice
  const fe = resp['forwardEps'];
  if (esObjeto(fe) && esNumeroFinito(fe['eps']) && esNumeroFinito(fe['fiscalYear'])) {
    const consulta = fechaDe(opciones.generado_en);
    if (consulta === null) avisos.push('forwardEps: generado_en ilegible, se omite el EPS estimado');
    else {
      const campo = `eps_estimado_fy${fe['fiscalYear']}_a_fecha_de_consulta`;
      items.push({ id: campo, campo, valor: fe['eps'], unidad: `${MONEDA_POR_OMISION} ${UNIDAD_EPS}`, fuente: FUENTE_WEBULL_INCOME, fecha_dato: consulta });
    }
  }
  return { ok: true, items, avisos };
}

export interface ArgumentosSobre {
  run_id: string; snapshot_id: string; generado_en: string; ticker: string; mercado: string;
  items: ItemDato[];
  tesis_vigente: { texto: string; version: number; origen: string } | null;
}
export function armarSobreFundamental(a: ArgumentosSobre): unknown {
  return {
    contrato: CONTRATO_ENTRADA, run_id: a.run_id, agente: AGENTE_FUNDAMENTAL, ticker: a.ticker, mercado: a.mercado,
    snapshot: { id: a.snapshot_id, generado_en: a.generado_en, datos: { items: a.items } },
    tesis_vigente: a.tesis_vigente,
  };
}
