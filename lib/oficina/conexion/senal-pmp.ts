// Señal técnica de entrada de PMP de un ticker (v0.59), calculada con la misma preparación del Técnico que usa la Oficina (cierre de la última vela CERRADA, ≥ 2 de 5
// señales). Solo lectura y sin base de datos: la Edge Function guarda el estado y manda el correo. No compra ni vende.
import { obtenerVelas } from '../agentes-ia/datos-velas';
import type { DepsDatosReales } from '../agentes-ia/datos-reales';
import { prepararTecnico } from '../orquestador/preparar-tecnico';
import { limpiarTicker } from './corridas-lectura';

export interface SenalPmp {
  ticker: string;
  confirmada: boolean;
  senales_cumplidas: string[];
  senales_minimas: number;
  cierre: number;
  fecha_vela: string;
  avisos: string[];
}
export type ResultadoSenalPmp = { ok: true; datos: SenalPmp } | { ok: false; http: number; error: string };

export async function evaluarSenalPmp(deps: DepsDatosReales, tickerCrudo: unknown, ahora: string): Promise<ResultadoSenalPmp> {
  const ticker = limpiarTicker(tickerCrudo);
  if (ticker === '') return { ok: false, http: 400, error: 'Ticker inválido' };
  const v = await obtenerVelas(deps, ticker);
  if (!v.ok) return { ok: false, http: 502, error: v.error };
  const t = prepararTecnico({ ticker, mercado: 'US', evaluado_en: ahora, fuente: v.velas.fuente, velas_diarias: v.velas.diarias, velas_semanales: v.velas.semanales });
  const u = t.snapshot?.ultima_vela_diaria ?? null;
  const d = t.detonantes?.apertura_pmp;
  if (u === null || d === undefined || (t.estado !== 'completo' && t.estado !== 'parcial')) {
    return { ok: false, http: 422, error: `El Técnico no se pudo calcular (${t.estado}): ${t.motivos.slice(0, 3).join(', ')}` };
  }
  return {
    ok: true,
    datos: { ticker, confirmada: d.detonante_confirmado, senales_cumplidas: d.senales_cumplidas.map(String), senales_minimas: d.senales_minimas, cierre: Number(u.cierre), fecha_vela: u.fecha, avisos: v.avisos },
  };
}
