// Puertos de IA del Orquestador: Analista Fundamental y Director IA. Implementan `Puertos.analista` y `Puertos.director`.
// Flujo de cada llamada: valida la entrada (sin datos obligatorios NO se llama al modelo) → modelo con salida JSON estricta → validador en código
// → reintento UNA vez con el error (contrato, sección 3) → guarda en `oficina_analisis` → devuelve la salida validada.
// Errores de transporte del modelo: sin reintento aquí (el Orquestador ya reintenta el puerto). Un análisis que no valida nunca se guarda ni llega al Director.
import {
  AGENTE_FUNDAMENTAL, CONTRATO_INTEGRACION, CONTRATO_SALIDA, ESQUEMA_NOMBRE_DIRECTOR, ESQUEMA_NOMBRE_FUNDAMENTAL,
  INTENTOS_POR_VALIDACION, MAX_ERRORES_EN_MENSAJE, PROVEEDOR_OPENAI, VERSION_PROMPT_DIRECTOR, VERSION_PROMPT_FUNDAMENTAL,
} from './constantes';
import type { LlamadaModelo, MensajeModelo } from './cliente-openai';
import { ESQUEMA_DIRECTOR, ESQUEMA_FUNDAMENTAL } from './esquemas-json';
import { PROMPT_DIRECTOR, PROMPT_FUNDAMENTAL } from './prompts';
import type { TrazabilidadIa } from './persistencia-ia';
import { resumirErrores } from './utilidades';
import type { Validacion } from './validar-fundamental';
import { validarSalidaFundamental, validarSobreFundamental } from './validar-fundamental';
import { validarContextoDirector, validarSalidaDirector } from './validar-director';
import type { ContextoDirector, Puertos, RespuestaAgente } from '../orquestador/corrida';
import type { Agente } from '../motor/tipos';

/** Guarda el análisis validado y devuelve su id (en producción: `guardarAnalisisIa` con el expediente de la corrida). */
export type GuardarAnalisisIa = (salida: Record<string, unknown>, trazabilidad: TrazabilidadIa) => Promise<{ ok: true; analisis_id: string } | { ok: false; error: string }>;

export interface OpcionesPuertosIa {
  llamar: LlamadaModelo;
  modelo_analista: string;
  modelo_director: string;
  /** Instante actual ISO 8601 con zona (el mismo reloj del Orquestador). */
  ahora: () => string;
  guardar_analista: GuardarAnalisisIa;
  guardar_director: GuardarAnalisisIa;
  /** Proveedor que queda en la trazabilidad; por omisión 'openai'. */
  proveedor?: string;
}

interface ParamsEjecucion<T> {
  llamar: LlamadaModelo; modelo: string; mensajes: MensajeModelo[]; esquema_nombre: string; esquema: Record<string, unknown>;
  validar: (json: unknown) => Validacion<T>;
}
type ResultadoEjecucion<T> = { ok: true; valor: T; modelo: string; intentos: number; tokens_in: number; tokens_out: number } | { ok: false; error: string };

async function ejecutarConValidacion<T>(p: ParamsEjecucion<T>): Promise<ResultadoEjecucion<T>> {
  const mensajes = p.mensajes.slice();
  let tin = 0; let tout = 0; let modelo = p.modelo;
  let ultimosErrores: string[] = [];
  for (let intento = 1; intento <= INTENTOS_POR_VALIDACION; intento++) {
    const r = await p.llamar({ modelo: p.modelo, mensajes, esquema_nombre: p.esquema_nombre, esquema: p.esquema });
    if (!r.ok) return { ok: false, error: r.error };
    tin += r.tokens_in ?? 0; tout += r.tokens_out ?? 0; modelo = r.modelo;
    const v = p.validar(r.json);
    if (v.ok) return { ok: true, valor: v.valor, modelo, intentos: intento, tokens_in: tin, tokens_out: tout };
    ultimosErrores = v.errores;
    mensajes.push({ role: 'assistant', content: r.texto });
    mensajes.push({ role: 'user', content: `Tu respuesta fue rechazada por el validador: ${resumirErrores(v.errores, MAX_ERRORES_EN_MENSAJE)}. Corrige SOLO esos problemas, sin inventar datos, y responde de nuevo el objeto JSON completo.` });
  }
  return { ok: false, error: `la salida no pasó la validación tras ${INTENTOS_POR_VALIDACION} intentos: ${resumirErrores(ultimosErrores, MAX_ERRORES_EN_MENSAJE)}` };
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function crearPuertoAnalista(o: OpcionesPuertosIa): Puertos['analista'] {
  return async (agente: Agente, sobre: unknown): Promise<RespuestaAgente> => {
    if (agente !== AGENTE_FUNDAMENTAL) return { estado: 'error', error: `analista ${agente}: no implementado todavía` };
    const s = validarSobreFundamental(sobre);
    if (!s.ok) return { estado: 'error', error: `sobre del Fundamental inválido: ${resumirErrores(s.errores, MAX_ERRORES_EN_MENSAJE)}` };
    const ejec = await ejecutarConValidacion({
      llamar: o.llamar, modelo: o.modelo_analista, esquema_nombre: ESQUEMA_NOMBRE_FUNDAMENTAL, esquema: ESQUEMA_FUNDAMENTAL,
      mensajes: [{ role: 'system', content: PROMPT_FUNDAMENTAL }, { role: 'user', content: JSON.stringify(s.valor) }],
      validar: json => validarSalidaFundamental(json, s.valor),
    }).catch((e: unknown) => ({ ok: false as const, error: msg(e) }));
    if (!ejec.ok) return { estado: 'error', error: ejec.error, proveedor: o.proveedor ?? PROVEEDOR_OPENAI, modelo: o.modelo_analista };
    const tra: TrazabilidadIa = {
      proveedor: o.proveedor ?? PROVEEDOR_OPENAI, modelo: ejec.modelo, contrato: CONTRATO_SALIDA, version_prompt: VERSION_PROMPT_FUNDAMENTAL,
      run_id: s.valor.run_id, snapshot_id: s.valor.snapshot.id, intentos: ejec.intentos, generado_en: o.ahora(),
    };
    const g = await o.guardar_analista(ejec.valor, tra).catch((e: unknown) => ({ ok: false as const, error: msg(e) }));
    if (!g.ok) return { estado: 'error', error: `no se pudo guardar el análisis: ${g.error}`, proveedor: o.proveedor ?? PROVEEDOR_OPENAI, modelo: ejec.modelo };
    return {
      estado: 'ok', analisis_id: g.analisis_id, veredicto: ejec.valor.veredicto, salida: ejec.valor,
      proveedor: o.proveedor ?? PROVEEDOR_OPENAI, modelo: ejec.modelo, tokens_in: ejec.tokens_in, tokens_out: ejec.tokens_out,
    };
  };
}

export function crearPuertoDirector(o: OpcionesPuertosIa): Puertos['director'] {
  return async (contexto: ContextoDirector): Promise<RespuestaAgente> => {
    const c = validarContextoDirector(contexto);
    if (!c.ok) return { estado: 'error', error: `contexto del Director inválido: ${resumirErrores(c.errores, MAX_ERRORES_EN_MENSAJE)}` };
    const ejec = await ejecutarConValidacion({
      llamar: o.llamar, modelo: o.modelo_director, esquema_nombre: ESQUEMA_NOMBRE_DIRECTOR, esquema: ESQUEMA_DIRECTOR,
      mensajes: [{ role: 'system', content: PROMPT_DIRECTOR }, { role: 'user', content: JSON.stringify(c.valor) }],
      validar: json => validarSalidaDirector(json, c.valor),
    }).catch((e: unknown) => ({ ok: false as const, error: msg(e) }));
    if (!ejec.ok) return { estado: 'error', error: ejec.error, proveedor: o.proveedor ?? PROVEEDOR_OPENAI, modelo: o.modelo_director };
    const tra: TrazabilidadIa = {
      proveedor: o.proveedor ?? PROVEEDOR_OPENAI, modelo: ejec.modelo, contrato: CONTRATO_INTEGRACION, version_prompt: VERSION_PROMPT_DIRECTOR,
      run_id: c.valor.run_id, snapshot_id: c.valor.snapshot_id, intentos: ejec.intentos, generado_en: o.ahora(),
    };
    const g = await o.guardar_director(ejec.valor, tra).catch((e: unknown) => ({ ok: false as const, error: msg(e) }));
    if (!g.ok) return { estado: 'error', error: `no se pudo guardar el análisis: ${g.error}`, proveedor: o.proveedor ?? PROVEEDOR_OPENAI, modelo: ejec.modelo };
    return {
      estado: 'ok', analisis_id: g.analisis_id, veredicto: String(ejec.valor['recomendacion_para_motor']), salida: ejec.valor,
      proveedor: o.proveedor ?? PROVEEDOR_OPENAI, modelo: ejec.modelo, tokens_in: ejec.tokens_in, tokens_out: ejec.tokens_out,
    };
  };
}

