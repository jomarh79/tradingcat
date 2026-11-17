// Lectura y aprobación de la tesis propuesta por el Director (v0.58). Usa la sesión del usuario (RLS «propias»); nunca la clave de servicio.
// Solo escribe en `oficina_expedientes` del expediente de la corrida (tesis_vigente, tesis_version y ficha.tesis_historial). Verifica que se actualice EXACTAMENTE 1 fila
// y usa la versión leída como condición (si otra aprobación se coló en medio, no pisa: 409). No cambia ninguna decisión ni opera.
import { esUuid } from '../orquestador/persistencia';
import { limpiarTicker } from './corridas-lectura';
import type { ClienteLectura, ResultadoLectura } from './corridas-lectura';
import { agregarTesis, leerHistorialTesis, propuestaDeDirector, textoDeTesisVigente, MAX_LARGO_TESIS } from './tesis-aprobacion';
import type { ClasificacionAprobable, EntradaTesis } from './tesis-aprobacion';
import { TESIS_CAMBIO, TESIS_PRIMERA_PROPUESTA } from '../agentes-ia/constantes';

const esObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export interface EstadoTesis {
  corrida_id: string; ticker: string; portafolio_codigo: string;
  /** null si el Director no propuso tesis en esta corrida. */
  propuesta: { texto: string; clasificacion: ClasificacionAprobable } | null;
  vigente: { texto: string | null; version: number } | null;
  /** Si esta propuesta ya fue aprobada (queda en el historial con esta corrida). */
  aprobada: EntradaTesis | null;
}
interface Cargado { estado: EstadoTesis; expediente_id: string; version: number; ficha: unknown }

async function cargar(cliente: ClienteLectura, corridaCruda: unknown): Promise<ResultadoLectura<Cargado>> {
  if (!esUuid(corridaCruda)) return { ok: false, http: 400, error: 'Identificador de corrida inválido' };
  const rc = await cliente.from('oficina_corridas_historial').select('corrida_id,ticker,portafolio_codigo,director_analisis_id,version').eq('corrida_id', corridaCruda).order('version', { ascending: false }).limit(1);
  if (rc.error) return { ok: false, http: 500, error: 'No se pudo leer la corrida' };
  const fila = arr(rc.data).filter(esObj)[0];
  if (fila === undefined) return { ok: false, http: 404, error: 'Corrida no encontrada' };
  const ticker = limpiarTicker(fila['ticker']);
  const portafolio = typeof fila['portafolio_codigo'] === 'string' ? fila['portafolio_codigo'] : '';
  if (ticker === '' || portafolio === '') return { ok: false, http: 422, error: 'La corrida no tiene ticker o portafolio' };

  let propuesta: EstadoTesis['propuesta'] = null;
  if (esUuid(fila['director_analisis_id'])) {
    const ra = await cliente.from('oficina_analisis').select('id,salida').eq('id', fila['director_analisis_id'] as string);
    if (ra.error) return { ok: false, http: 500, error: 'No se pudo leer el análisis del Director' };
    const sal = arr(ra.data).filter(esObj)[0];
    const p = sal === undefined ? null : propuestaDeDirector(sal['salida']);
    if (p !== null && p.clasificacion !== null) propuesta = { texto: p.texto.slice(0, MAX_LARGO_TESIS), clasificacion: p.clasificacion };
  }

  const re = await cliente.from('oficina_expedientes').select('id,tesis_vigente,tesis_version,ficha').eq('ticker', ticker).eq('portafolio_codigo', portafolio);
  if (re.error) return { ok: false, http: 500, error: 'No se pudo leer el expediente' };
  const exps = arr(re.data).filter(esObj);
  if (exps.length !== 1) return { ok: false, http: exps.length === 0 ? 404 : 409, error: exps.length === 0 ? `${ticker} no tiene expediente en ${portafolio}` : `${ticker} tiene ${exps.length} expedientes en ${portafolio} (ambiguo)` };
  const e = exps[0]!;
  const version = typeof e['tesis_version'] === 'number' && Number.isInteger(e['tesis_version']) ? e['tesis_version'] : null;
  if (version === null) return { ok: false, http: 500, error: 'El expediente no trae una versión de tesis válida' };
  const textoVigente = textoDeTesisVigente(e['tesis_vigente']);
  const hayVigente = e['tesis_vigente'] !== null && e['tesis_vigente'] !== undefined && e['tesis_vigente'] !== '';
  const aprobada = leerHistorialTesis(e['ficha']).find(x => x.corrida_id === corridaCruda) ?? null;
  return {
    ok: true,
    datos: {
      estado: { corrida_id: corridaCruda, ticker, portafolio_codigo: portafolio, propuesta, vigente: hayVigente ? { texto: textoVigente, version } : null, aprobada },
      expediente_id: String(e['id']), version, ficha: e['ficha'],
    },
  };
}

export async function leerEstadoTesis(cliente: ClienteLectura, corridaCruda: unknown): Promise<ResultadoLectura<EstadoTesis>> {
  const c = await cargar(cliente, corridaCruda);
  return c.ok ? { ok: true, datos: c.datos.estado } : c;
}

export async function aprobarTesis(cliente: ClienteLectura, body: unknown, ahora: string): Promise<ResultadoLectura<{ version: number; clasificacion: ClasificacionAprobable }>> {
  if (!esObj(body)) return { ok: false, http: 400, error: 'Cuerpo inválido' };
  const c = await cargar(cliente, body['corrida_id']);
  if (!c.ok) return c;
  const { estado, expediente_id, version, ficha } = c.datos;
  if (estado.propuesta === null) return { ok: false, http: 422, error: 'El Director no propuso ninguna tesis en esta corrida' };
  if (estado.aprobada !== null) return { ok: false, http: 409, error: `Esta propuesta ya fue aprobada (versión ${estado.aprobada.version})` };
  const nueva = version + 1;
  const anterior = estado.vigente === null ? null : estado.vigente.texto;
  const clasificacion = estado.vigente === null ? TESIS_PRIMERA_PROPUESTA : TESIS_CAMBIO; // la clasificación la decide la base al aprobar, no la de la corrida
  const entrada: EntradaTesis = { version: nueva, texto: estado.propuesta.texto, aprobada_en: ahora, corrida_id: estado.corrida_id, clasificacion, anterior };
  const r = await cliente.from('oficina_expedientes')
    .update({ tesis_vigente: estado.propuesta.texto, tesis_version: nueva, ficha: agregarTesis(ficha, entrada) })
    .eq('id', expediente_id).eq('tesis_version', version).select('id');
  if (r.error) return { ok: false, http: 500, error: 'No se pudo guardar la tesis' };
  if (arr(r.data).length !== 1) return { ok: false, http: 409, error: 'La tesis cambió mientras la aprobabas o la base no permitió guardar (revisa el permiso de oficina_expedientes); vuelve a abrir la corrida' };
  return { ok: true, datos: { version: nueva, clasificacion } };
}
