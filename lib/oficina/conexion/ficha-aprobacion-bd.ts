// Lectura y aprobación de la ficha de PMP-09 con la sesión del usuario (cliente inyectado; el RLS aplica, nunca la clave de servicio).
// Solo toca `oficina_expedientes.ficha.ficha_pmp` del expediente PMP del ticker; no escribe en ninguna otra tabla.
import { APARTADOS_PROPIOS, APARTADOS_PROPUESTOS, construirAprobacion, mezclarFicha, textosAprobados } from './ficha-aprobacion';
import { limpiarTicker, textoCorto } from './corridas-lectura';
import type { ClienteLectura, ResultadoLectura } from './corridas-lectura';

const esObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export interface EstadoFicha {
  ticker: string;
  /** Falta alguna corrida de PMP con borrador. */
  corrida: { corrida_id: string; iniciada_at: string } | null;
  propuesta: Array<{ apartado: string; texto: string; fuente: string; aprobado: boolean; texto_aprobado: string | null }>;
  no_propuestos: string[];
  /** Apartados que escribe el usuario, con su texto aprobado si ya lo hay. */
  propios: Array<{ apartado: string; texto_aprobado: string | null }>;
  /** Cuántos de los 11 apartados están aprobados (incluye los que vienen de la watchlist solo si están en la ficha del expediente). */
  aprobados: string[];
}

interface Contexto { expediente: { id: string; ficha: unknown }; corrida: { corrida_id: string; iniciada_at: string; propuesta: Record<string, { texto: string; fuente: string }>; no_propuestos: string[] } | null }

async function cargar(cliente: ClienteLectura, tickerCrudo: unknown): Promise<ResultadoLectura<Contexto & { ticker: string }>> {
  const ticker = limpiarTicker(tickerCrudo);
  if (ticker === '') return { ok: false, http: 400, error: 'Ticker inválido' };
  const re = await cliente.from('oficina_expedientes').select('id,ficha').eq('ticker', ticker).eq('portafolio_codigo', 'PMP');
  if (re.error) return { ok: false, http: 500, error: 'No se pudo leer el expediente' };
  const exps = arr(re.data).filter(esObj);
  if (exps.length === 0) return { ok: false, http: 404, error: `${ticker} no tiene expediente en PMP: corre primero el análisis de PMP` };
  if (exps.length > 1) return { ok: false, http: 409, error: `${ticker} tiene ${exps.length} expedientes en PMP (ambiguo)` };
  const exp = exps[0]!;
  const rc = await cliente.from('oficina_corridas_historial').select('corrida_id,iniciada_at,referencias').eq('ticker', ticker).eq('portafolio_codigo', 'PMP').order('iniciada_at', { ascending: false }).limit(5);
  if (rc.error) return { ok: false, http: 500, error: 'No se pudieron leer las corridas' };
  let corrida: Contexto['corrida'] = null;
  for (const f of arr(rc.data).filter(esObj)) {
    const ref = esObj(f['referencias']) ? (f['referencias'] as Record<string, unknown>) : {};
    const fp = ref['ficha_propuesta'];
    if (!esObj(fp)) continue;
    const prop: Record<string, { texto: string; fuente: string }> = {};
    for (const [k, v] of Object.entries(esObj(fp['propuesta']) ? (fp['propuesta'] as Record<string, unknown>) : {})) {
      if (esObj(v) && typeof v['texto'] === 'string') prop[k] = { texto: v['texto'], fuente: typeof v['fuente'] === 'string' ? v['fuente'] : '' };
    }
    corrida = { corrida_id: String(f['corrida_id'] ?? ''), iniciada_at: String(f['iniciada_at'] ?? ''), propuesta: prop, no_propuestos: arr(fp['no_propuestos']).map(textoCorto) };
    break;
  }
  return { ok: true, datos: { ticker, expediente: { id: String(exp['id']), ficha: exp['ficha'] }, corrida } };
}

export async function leerEstadoFicha(cliente: ClienteLectura, ticker: unknown): Promise<ResultadoLectura<EstadoFicha>> {
  const c = await cargar(cliente, ticker);
  if (!c.ok) return c;
  const aprobados = textosAprobados(c.datos.expediente.ficha);
  const corrida = c.datos.corrida;
  return {
    ok: true,
    datos: {
      ticker: c.datos.ticker,
      corrida: corrida === null ? null : { corrida_id: corrida.corrida_id, iniciada_at: corrida.iniciada_at },
      propuesta: (APARTADOS_PROPUESTOS as readonly string[]).filter(a => corrida?.propuesta[a] !== undefined).map(a => ({
        apartado: a, texto: textoCorto(corrida!.propuesta[a]!.texto), fuente: textoCorto(corrida!.propuesta[a]!.fuente), aprobado: aprobados[a] !== undefined, texto_aprobado: aprobados[a] ?? null,
      })),
      no_propuestos: corrida?.no_propuestos ?? [],
      propios: (APARTADOS_PROPIOS as readonly string[]).map(a => ({ apartado: a, texto_aprobado: aprobados[a] ?? null })),
      aprobados: Object.keys(aprobados),
    },
  };
}

export async function aprobarFicha(cliente: ClienteLectura, body: unknown, ahora: string): Promise<ResultadoLectura<{ aprobados: string[] }>> {
  if (!esObj(body)) return { ok: false, http: 400, error: 'Cuerpo inválido' };
  const c = await cargar(cliente, body['ticker']);
  if (!c.ok) return c;
  const propuesta = c.datos.corrida?.propuesta ?? {};
  const a = construirAprobacion({ propuesta, aprobar: body['aprobar'], textos: body['textos'], ahora });
  if (!a.ok) return { ok: false, http: 400, error: a.error };
  const ficha = mezclarFicha(c.datos.expediente.ficha, a.nuevos);
  const r = await cliente.from('oficina_expedientes').update({ ficha }).eq('id', c.datos.expediente.id).select('id');
  if (r.error) return { ok: false, http: 500, error: 'No se pudo guardar la ficha' };
  if (arr(r.data).length !== 1) return { ok: false, http: 403, error: 'La base no permitió guardar la ficha (revisa el permiso de actualización de oficina_expedientes)' };
  return { ok: true, datos: { aprobados: Object.keys(a.nuevos) } };
}
