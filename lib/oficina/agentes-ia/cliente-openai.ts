// Cliente del modelo (OpenAI Chat Completions con salida JSON estricta), detrás de un puerto `LlamadaModelo` inyectable.
// Seguridad: la clave solo se usa en la cabecera Authorization; NUNCA aparece en errores, respuestas ni logs. Los errores del proveedor se reducen
// a su tipo/código (el mensaje del proveedor puede citar partes de la clave). Solo servidor.
import {
  ENV_API_KEY, ENV_MODELO_ANALISTA, ENV_MODELO_DIRECTOR, ESTADO_HTTP_NO_AUTORIZADO, ESTADO_HTTP_PROHIBIDO, OPENAI_RUTA_CHAT,
  OPENAI_URL_BASE, TIMEOUT_MODELO_MS,
} from './constantes';
import { esObjeto, textoNoVacio } from './utilidades';

export interface MensajeModelo { role: 'system' | 'user' | 'assistant'; content: string }
export interface PeticionModelo { modelo: string; mensajes: MensajeModelo[]; esquema_nombre: string; esquema: Record<string, unknown> }
export type RespuestaModelo =
  | { ok: true; texto: string; json: unknown; modelo: string; tokens_in?: number; tokens_out?: number }
  | { ok: false; error: string };
export type LlamadaModelo = (p: PeticionModelo) => Promise<RespuestaModelo>;

export type ConfigOpenAi =
  | { ok: true; api_key: string; modelo_analista: string; modelo_director: string }
  | { ok: false; faltan: string[] };

/** Lee la configuración del entorno. En el error solo van los NOMBRES de las variables que faltan, nunca valores. */
export function leerConfigOpenAi(env: Record<string, string | undefined>): ConfigOpenAi {
  const faltan = [ENV_API_KEY, ENV_MODELO_ANALISTA, ENV_MODELO_DIRECTOR].filter(n => !textoNoVacio(env[n]));
  if (faltan.length > 0) return { ok: false, faltan };
  return { ok: true, api_key: (env[ENV_API_KEY] as string).trim(), modelo_analista: (env[ENV_MODELO_ANALISTA] as string).trim(), modelo_director: (env[ENV_MODELO_DIRECTOR] as string).trim() };
}

export interface OpcionesClienteOpenAi {
  api_key: string;
  fetchFn?: (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
  url_base?: string;
  timeout_ms?: number;
}

/** Solo códigos con la forma de los del proveedor (minúsculas y guion bajo): cualquier otro texto se descarta, así no puede colarse una clave. */
const CODIGO_PROVEEDOR = /^[a-z][a-z0-9_]{0,59}$/;
const limpiarCodigo = (s: unknown): string => (typeof s === 'string' && CODIGO_PROVEEDOR.test(s) ? s : '');
const limpiarModelo = (s: unknown): string => (typeof s === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:\-]{0,79}$/.test(s) && !/^sk-/i.test(s) ? s : '');

export function crearLlamadaOpenAi(o: OpcionesClienteOpenAi): LlamadaModelo {
  const fetchFn = o.fetchFn ?? ((url, init) => fetch(url, init));
  const url = `${o.url_base ?? OPENAI_URL_BASE}${OPENAI_RUTA_CHAT}`;
  const timeout = o.timeout_ms ?? TIMEOUT_MODELO_MS;
  return async (p: PeticionModelo): Promise<RespuestaModelo> => {
    if (!textoNoVacio(o.api_key)) return { ok: false, error: 'falta la clave del proveedor' };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${o.api_key}` },
        body: JSON.stringify({
          model: p.modelo, messages: p.mensajes,
          response_format: { type: 'json_schema', json_schema: { name: p.esquema_nombre, strict: true, schema: p.esquema } },
        }),
        signal: ctl.signal,
      });
      let cuerpo: unknown;
      try { cuerpo = await r.json(); } catch { return { ok: false, error: `proveedor: respuesta HTTP ${r.status} sin JSON válido` }; }
      if (!r.ok) {
        if (r.status === ESTADO_HTTP_NO_AUTORIZADO || r.status === ESTADO_HTTP_PROHIBIDO) return { ok: false, error: `proveedor: HTTP ${r.status} (revisar clave y permisos)` };
        const err = esObjeto(cuerpo) && esObjeto(cuerpo['error']) ? cuerpo['error'] : {};
        const detalle = [limpiarCodigo(err['type']), limpiarCodigo(err['code'])].filter(x => x !== '').join('/');
        return { ok: false, error: `proveedor: HTTP ${r.status}${detalle === '' ? '' : ` (${detalle})`}` };
      }
      const choices = esObjeto(cuerpo) ? cuerpo['choices'] : undefined;
      const c0 = Array.isArray(choices) ? choices[0] : undefined;
      const msg = esObjeto(c0) && esObjeto(c0['message']) ? c0['message'] : undefined;
      if (msg === undefined) return { ok: false, error: 'proveedor: respuesta sin mensaje' };
      if (textoNoVacio(msg['refusal'])) return { ok: false, error: 'proveedor: el modelo rechazó la solicitud' };
      if (esObjeto(c0) && c0['finish_reason'] === 'length') return { ok: false, error: 'proveedor: respuesta truncada (límite de longitud)' };
      const contenido = msg['content'];
      if (!textoNoVacio(contenido)) return { ok: false, error: 'proveedor: respuesta vacía' };
      let json: unknown;
      try { json = JSON.parse(contenido); } catch { return { ok: false, error: 'proveedor: la respuesta no es JSON' }; }
      const uso = esObjeto(cuerpo) && esObjeto(cuerpo['usage']) ? cuerpo['usage'] : {};
      const reportado = esObjeto(cuerpo) ? limpiarModelo(cuerpo['model']) : '';
      const modelo = reportado !== '' ? reportado : p.modelo;
      return {
        ok: true, texto: contenido, json, modelo,
        ...(typeof uso['prompt_tokens'] === 'number' ? { tokens_in: uso['prompt_tokens'] } : {}),
        ...(typeof uso['completion_tokens'] === 'number' ? { tokens_out: uso['completion_tokens'] } : {}),
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error && e.name === 'AbortError' ? 'proveedor: tiempo de espera agotado' : 'proveedor: error de red' };
    } finally {
      clearTimeout(timer);
    }
  };
}
