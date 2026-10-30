// Corrida real de la ruta determinista (aporte semanal de ETFs): arma los datos, ejecuta el flujo con el Auditor y registra la corrida.
// Solo analiza y registra: no opera, no escribe en TradingCat. La respuesta es un resumen sin tokens ni claves.
// Cliente inyectado (sesión del usuario; RLS activo). Requiere `rpc` para `oficina_registrar_corrida` (escritura atómica de corrida y ejecuciones).
import { almacenSupabase, persistirResultado } from '../orquestador';
import type { ClienteSupabaseMinimo, Puertos, RespuestaAgente } from '../orquestador';
import { armarDatosAporteEtf, PORTAFOLIO_ETF, TIPO_APORTE_PERIODICO } from './datos-aporte-etf';
import { ejecutarCorridaConAuditoria } from './flujo-auditoria';
import type { ClienteOficina } from './flujo-auditoria';

export type ClienteCorridaEtf = ClienteOficina & ClienteSupabaseMinimo;
export const TICKER_ETF_RE = /^[A-Z0-9][A-Z0-9.\- ]{0,19}$/;
export const MERCADO_ETF = 'US';
export const DISPARADOR_RUTA = 'usuario';

export interface DependenciasCorrida { nuevoId(): string; ahora(): string }
export interface RespuestaCorridaEtf {
  http: number;
  cuerpo: Record<string, unknown>;
}

const noSeUsa = async (): Promise<RespuestaAgente> => ({ estado: 'error', error: 'ruta determinista: este agente no se usa' });

export async function correrAporteEtf(cliente: ClienteCorridaEtf, entrada: unknown, dep: DependenciasCorrida): Promise<RespuestaCorridaEtf> {
  const body = typeof entrada === 'object' && entrada !== null && !Array.isArray(entrada) ? (entrada as Record<string, unknown>) : {};
  const ticker = typeof body['ticker'] === 'string' ? body['ticker'].trim().toUpperCase() : '';
  if (!TICKER_ETF_RE.test(ticker)) return { http: 400, cuerpo: { ok: false, error: 'ticker inválido' } };
  const extra = Object.keys(body).filter((k) => k !== 'ticker');
  if (extra.length > 0) return { http: 400, cuerpo: { ok: false, error: `campos no admitidos: ${extra.join(', ')}` } };

  const ahora = dep.ahora();
  const armado = await armarDatosAporteEtf(cliente, { ticker, ahora, snapshot_id: dep.nuevoId() });
  if (!armado.ok) return { http: 422, cuerpo: { ok: false, error: 'no se pudo armar la corrida con los datos reales', problemas: armado.problemas, registrada: false } };

  const solicitud = {
    contrato: 'solicitud.v1', disparador: DISPARADOR_RUTA, ticker, mercado: MERCADO_ETF, portafolio_codigo: PORTAFOLIO_ETF, tipo_evaluacion: TIPO_APORTE_PERIODICO,
    origen: { watchlist_id: null, alerta_id: null }, solicitado_en: ahora,
  };
  const base: Omit<Puertos, 'auditor'> = { nuevoId: dep.nuevoId, ahora: dep.ahora, analista: noSeUsa, director: noSeUsa };
  const flujo = await ejecutarCorridaConAuditoria(cliente, solicitud, armado.datos, base);
  const persistencia = await persistirResultado(flujo.corrida, almacenSupabase(cliente));

  const c = flujo.corrida;
  const resumen: Record<string, unknown> = {
    ok: persistencia.estado === 'guardada', ticker, aporte: armado.resumen, resultado: c.resultado,
    preparacion_auditor: flujo.preparacion === null ? null : flujo.preparacion.ok ? { ok: true, expediente_id: flujo.preparacion.expediente_id, expediente_creado: flujo.preparacion.expediente_creado } : { ok: false, etapa: flujo.preparacion.etapa, problemas: flujo.preparacion.problemas },
    persistencia,
  };
  if (c.resultado === 'corrida') {
    const f = c.fila_historial;
    Object.assign(resumen, {
      corrida_id: c.corrida_id, estado_final: f.estado_final, decision: f.decision, auditoria_veredicto: f.auditoria_veredicto, auditoria_analisis_id: f.auditoria_analisis_id,
      motivos: f.motivos, referencias: f.referencias,
    });
  }
  return { http: persistencia.estado === 'guardada' ? 200 : 500, cuerpo: resumen };
}
