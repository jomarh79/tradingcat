// Selector de proveedor de IA según el entorno. PROVEEDOR_IA es obligatorio (sin valor por omisión: así no se gasta en un proveedor sin querer).
// En los errores solo van NOMBRES de variables, nunca valores.
import { ENV_PROVEEDOR_IA, PROVEEDORES_IA, PROVEEDOR_GEMINI, PROVEEDOR_OPENAI } from './constantes';
import { conReintentoTransitorio, crearLlamadaGemini, leerConfigGemini } from './cliente-gemini';
import { crearLlamadaOpenAi, leerConfigOpenAi } from './cliente-openai';
import type { LlamadaModelo, OpcionesClienteOpenAi } from './cliente-openai';

export type ProveedorIa =
  | { ok: true; proveedor: string; llamar: LlamadaModelo; modelo_analista: string; modelo_director: string }
  | { ok: false; faltan: string[] };

export function resolverProveedorIa(env: Record<string, string | undefined>, fetchFn?: OpcionesClienteOpenAi['fetchFn']): ProveedorIa {
  const nombre = (env[ENV_PROVEEDOR_IA] ?? '').trim().toLowerCase();
  const extra = fetchFn === undefined ? {} : { fetchFn };
  if (nombre === PROVEEDOR_OPENAI) {
    const c = leerConfigOpenAi(env);
    if (!c.ok) return c;
    return { ok: true, proveedor: PROVEEDOR_OPENAI, llamar: crearLlamadaOpenAi({ api_key: c.api_key, ...extra }), modelo_analista: c.modelo_analista, modelo_director: c.modelo_director };
  }
  if (nombre === PROVEEDOR_GEMINI) {
    const c = leerConfigGemini(env);
    if (!c.ok) return c;
    return { ok: true, proveedor: PROVEEDOR_GEMINI, llamar: conReintentoTransitorio(crearLlamadaGemini({ api_key: c.api_key, ...extra })), modelo_analista: c.modelo_analista, modelo_director: c.modelo_director };
  }
  return { ok: false, faltan: [`${ENV_PROVEEDOR_IA} (valores válidos: ${PROVEEDORES_IA.join(' o ')})`] };
}
