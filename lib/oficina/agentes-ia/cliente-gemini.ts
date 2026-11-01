// Cliente del modelo para Gemini (Google AI Studio, generateContent con salida JSON y esquema), detrás del mismo puerto `LlamadaModelo`.
// Seguridad: la clave solo viaja en la cabecera x-goog-api-key (nunca en la URL) y NUNCA aparece en errores, respuestas ni logs.
// Los errores del proveedor se reducen a códigos con forma de enumeración (MAYÚSCULAS_Y_GUION_BAJO); su mensaje libre puede citar la clave y se descarta.
// El esquema ayuda al modelo, pero la autoridad es el validador del código: si Google ignora el esquema, el validador lo detecta.
import {
  ENV_GEMINI_API_KEY, ENV_GEMINI_MODELO_ANALISTA, ENV_GEMINI_MODELO_DIRECTOR, ESTADO_HTTP_NO_AUTORIZADO, ESTADO_HTTP_PROHIBIDO,
  GEMINI_CABECERA_CLAVE, GEMINI_CAMPO_ESQUEMA, GEMINI_CAMPO_MIME, GEMINI_FIN_NORMAL, GEMINI_FIN_TRUNCADO, GEMINI_ROL_MODELO, GEMINI_ROL_USUARIO,
  GEMINI_RUTA_MODELOS, GEMINI_SUFIJO_GENERAR, GEMINI_URL_BASE, MIME_JSON, TIMEOUT_MODELO_MS,
} from './constantes';
import type { LlamadaModelo, OpcionesClienteOpenAi, PeticionModelo, RespuestaModelo } from './cliente-openai';
import { esObjeto, textoNoVacio } from './utilidades';

export type ConfigGemini =
  | { ok: true; api_key: string; modelo_analista: string; modelo_director: string }
  | { ok: false; faltan: string[] };

/** Lee la configuración del entorno. En el error solo van los NOMBRES de las variables que faltan, nunca valores. */
export function leerConfigGemini(env: Record<string, string | undefined>): ConfigGemini {
  const faltan = [ENV_GEMINI_API_KEY, ENV_GEMINI_MODELO_ANALISTA, ENV_GEMINI_MODELO_DIRECTOR].filter(n => !textoNoVacio(env[n]));
  if (faltan.length > 0) return { ok: false, faltan };
  return {
    ok: true, api_key: (env[ENV_GEMINI_API_KEY] as string).trim(),
    modelo_analista: (env[ENV_GEMINI_MODELO_ANALISTA] as string).trim(), modelo_director: (env[ENV_GEMINI_MODELO_DIRECTOR] as string).trim(),
  };
}

export type OpcionesClienteGemini = OpcionesClienteOpenAi;

/** El nombre del modelo va dentro de la URL: solo caracteres de un identificador (sin '/', '?', '#', ':' ni espacios). */
const MODELO_VALIDO = /^[A-Za-z0-9][A-Za-z0-9._\-]{0,79}$/;
/** Códigos de Google: enumeraciones en mayúsculas (INVALID_ARGUMENT, API_KEY_INVALID, SAFETY...). Cualquier otro texto se descarta. */
const CODIGO_ENUM = /^[A-Z][A-Z0-9_]{0,59}$/;
const limpiarEnum = (s: unknown): string => (typeof s === 'string' && CODIGO_ENUM.test(s) ? s : '');
const limpiarModelo = (s: unknown): string => (typeof s === 'string' && MODELO_VALIDO.test(s) && !/^AIza/.test(s) ? s : '');
const numero = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : undefined);

function detalleError(cuerpo: unknown): string {
  const err = esObjeto(cuerpo) && esObjeto(cuerpo['error']) ? cuerpo['error'] : {};
  const razones = Array.isArray(err['details']) ? err['details'].map(d => (esObjeto(d) ? limpiarEnum(d['reason']) : '')) : [];
  return [limpiarEnum(err['status']), ...razones].filter(x => x !== '').join('/');
}

export function crearLlamadaGemini(o: OpcionesClienteGemini): LlamadaModelo {
  const fetchFn = o.fetchFn ?? ((url, init) => fetch(url, init));
  const base = o.url_base ?? GEMINI_URL_BASE;
  const timeout = o.timeout_ms ?? TIMEOUT_MODELO_MS;
  return async (p: PeticionModelo): Promise<RespuestaModelo> => {
    if (!textoNoVacio(o.api_key)) return { ok: false, error: 'falta la clave del proveedor' };
    if (!MODELO_VALIDO.test(p.modelo)) return { ok: false, error: 'nombre de modelo inválido' };
    const sistema = p.mensajes.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
    const contents = p.mensajes.filter(m => m.role !== 'system')
      .map(m => ({ role: m.role === 'assistant' ? GEMINI_ROL_MODELO : GEMINI_ROL_USUARIO, parts: [{ text: m.content }] }));
    if (contents.length === 0) return { ok: false, error: 'la petición no trae mensajes de usuario' };
    const url = `${base}${GEMINI_RUTA_MODELOS}${p.modelo}${GEMINI_SUFIJO_GENERAR}`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [GEMINI_CABECERA_CLAVE]: o.api_key },
        body: JSON.stringify({
          ...(sistema === '' ? {} : { systemInstruction: { parts: [{ text: sistema }] } }),
          contents,
          generationConfig: { [GEMINI_CAMPO_MIME]: MIME_JSON, [GEMINI_CAMPO_ESQUEMA]: p.esquema },
        }),
        signal: ctl.signal,
      });
      let cuerpo: unknown;
      try { cuerpo = await r.json(); } catch { return { ok: false, error: `proveedor: respuesta HTTP ${r.status} sin JSON válido` }; }
      if (!r.ok) {
        if (r.status === ESTADO_HTTP_NO_AUTORIZADO || r.status === ESTADO_HTTP_PROHIBIDO) return { ok: false, error: `proveedor: HTTP ${r.status} (revisar clave y permisos)` };
        const d = detalleError(cuerpo);
        return { ok: false, error: `proveedor: HTTP ${r.status}${d === '' ? '' : ` (${d})`}` };
      }
      const raiz = esObjeto(cuerpo) ? cuerpo : {};
      const bloqueo = esObjeto(raiz['promptFeedback']) ? limpiarEnum(raiz['promptFeedback']['blockReason']) : '';
      if (bloqueo !== '') return { ok: false, error: `proveedor: solicitud bloqueada (${bloqueo})` };
      const c0 = Array.isArray(raiz['candidates']) ? raiz['candidates'][0] : undefined;
      if (!esObjeto(c0)) return { ok: false, error: 'proveedor: respuesta sin candidatos' };
      const fin = c0['finishReason'];
      if (fin === GEMINI_FIN_TRUNCADO) return { ok: false, error: 'proveedor: respuesta truncada (límite de longitud)' };
      if (fin !== undefined && fin !== GEMINI_FIN_NORMAL) {
        const f = limpiarEnum(fin);
        return { ok: false, error: `proveedor: respuesta no completada${f === '' ? '' : ` (${f})`}` };
      }
      const partes = esObjeto(c0['content']) && Array.isArray(c0['content']['parts']) ? c0['content']['parts'] : [];
      const texto = partes.filter(x => esObjeto(x) && x['thought'] !== true && typeof x['text'] === 'string').map(x => (x as { text: string }).text).join('');
      if (!textoNoVacio(texto)) return { ok: false, error: 'proveedor: respuesta vacía' };
      let json: unknown;
      try { json = JSON.parse(texto); } catch { return { ok: false, error: 'proveedor: la respuesta no es JSON' }; }
      const uso = esObjeto(raiz['usageMetadata']) ? raiz['usageMetadata'] : {};
      const tin = numero(uso['promptTokenCount']);
      const cand = numero(uso['candidatesTokenCount']);
      const pens = numero(uso['thoughtsTokenCount']);
      const tout = cand === undefined && pens === undefined ? undefined : (cand ?? 0) + (pens ?? 0);
      const reportado = limpiarModelo(raiz['modelVersion']);
      return { ok: true, texto, json, modelo: reportado !== '' ? reportado : p.modelo, ...(tin !== undefined ? { tokens_in: tin } : {}), ...(tout !== undefined ? { tokens_out: tout } : {}) };
    } catch (e) {
      return { ok: false, error: e instanceof Error && e.name === 'AbortError' ? 'proveedor: tiempo de espera agotado' : 'proveedor: error de red' };
    } finally {
      clearTimeout(timer);
    }
  };
}
