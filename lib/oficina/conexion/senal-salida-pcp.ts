// Señal de salida / zona de recompra de una posición PCP abierta (v0.69), para las alertas. Usa EXACTAMENTE lo mismo que la corrida de la Oficina: el Técnico
// (`senal_salida` con el cierre de la última vela CERRADA) y el plan de salidas del Motor (motor/salida-pcp.ts). Solo lectura: no guarda nada, no manda correos, no vende.
// La Edge Function lee el trade, sus ejecuciones y la ficha de la base y se los pasa; aquí se validan (construirDatosSalidaPcp) y se calcula.
import { obtenerVelas } from '../agentes-ia/datos-velas';
import type { DepsDatosReales } from '../agentes-ia/datos-reales';
import { evaluarPlanSalidaPCP } from '../motor';
import { prepararTecnico } from '../orquestador/preparar-tecnico';
import { limpiarTicker } from './corridas-lectura';
import type { FilaEjecucion } from './hechos-bd';
import { construirDatosSalidaPcp } from './salida-pcp-bd';

export interface SalidaPcpTicker {
  ticker: string;
  fecha_vela: string;
  cierre: number;
  /** VENDER / REDUCIR si el plan exige salir; null si no. */
  decision: 'VENDER' | 'REDUCIR' | null;
  porcentaje: number | null;
  motivo: 'senal_salida' | 'nivel_planeado' | 'costo_promedio' | 'stop' | null;
  nivel: string | null;
  detalle: string | null;
  zona_recompra: boolean;
  recompras_restantes: number | null;
  /** v0.85: etapa PCP = take profit con valor (la siguiente recompra es de 25 si hay 1 compra y de 50 si hay 2). */
  compras: number;
  /** v0.80: señales de recompra de hoy (detonante recompra_pcp: RSI, Koncorde, Mogalef inferior, nivel pasado); null si el Técnico no las pudo evaluar. */
  senal_recompra: { confirmada: boolean; cumplidas: string[] } | null;
  costo_promedio: string | null;
  stop: string | null;
  faltantes: string[];
  avisos: string[];
}
export type ResultadoSalidaPcpTicker = { ok: true; datos: SalidaPcpTicker } | { ok: false; http: number; error: string };

const esObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export async function evaluarSalidaPcpTicker(deps: DepsDatosReales, e: { ticker: unknown; trade: unknown; ejecuciones: unknown; ficha: unknown }, ahora: string): Promise<ResultadoSalidaPcpTicker> {
  const ticker = limpiarTicker(e.ticker);
  if (ticker === '') return { ok: false, http: 400, error: 'Ticker inválido' };
  if (!esObj(e.trade)) return { ok: false, http: 400, error: 'Falta el trade de la posición' };
  const ejecuciones = (Array.isArray(e.ejecuciones) ? e.ejecuciones : []).filter(esObj) as unknown as FilaEjecucion[];

  const d = construirDatosSalidaPcp(e.trade, ejecuciones, e.ficha, ticker);
  if (!d.ok) return { ok: false, http: 422, error: d.problemas.slice(0, 3).join('; ') };

  const v = await obtenerVelas(deps, ticker);
  if (!v.ok) return { ok: false, http: 502, error: v.error };
  const t = prepararTecnico({ ticker, mercado: 'US', evaluado_en: ahora, fuente: v.velas.fuente, velas_diarias: v.velas.diarias, velas_semanales: v.velas.semanales });
  const u = t.snapshot?.ultima_vela_diaria ?? null;
  // Una señal de salida no evaluable nunca se toma como «no hay señal» (igual que en la corrida)
  if (u === null || t.senal_salida === null) return { ok: false, http: 422, error: `El Técnico no pudo evaluar la señal de salida (${t.estado}): ${t.motivos.slice(0, 3).join(', ')}` };

  const r = evaluarPlanSalidaPCP({ ...d.datos, precio_actual: String(u.cierre), senal_salida: t.senal_salida });
  return {
    ok: true,
    datos: {
      ticker, fecha_vela: u.fecha, cierre: Number(u.cierre),
      decision: r.exigida === null ? null : (r.exigida.decision === 'VENDER' || r.exigida.decision === 'REDUCIR' ? r.exigida.decision : null),
      porcentaje: r.exigida?.porcentaje ?? null, motivo: r.motivo, nivel: r.nivel_alcanzado, detalle: r.exigida?.detalle ?? null,
      zona_recompra: r.zona_recompra, recompras_restantes: r.recompras_restantes, compras: r.etapas,
      senal_recompra: t.detonantes === null ? null : { confirmada: t.detonantes.recompra_pcp.detonante_confirmado, cumplidas: t.detonantes.recompra_pcp.senales_cumplidas.map(String) },
      costo_promedio: r.costo_promedio, stop: r.stop,
      faltantes: r.faltantes, avisos: [...d.avisos, ...v.avisos],
    },
  };
}
