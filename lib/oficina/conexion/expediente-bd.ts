// Recuperar o crear el Expediente Maestro (oficina_expedientes) antes de guardar un análisis. Esquema y restricciones pegados el 28-oct:
//   id uuid (default gen_random_uuid), user_id*, ticker*, mercado* CHECK ('US','BMV'), tesis_vigente, tesis_version* (default 1),
//   tesis_origen* CHECK ('al_entrar','reconstruida') (default 'al_entrar'), ficha* jsonb (default '{}'), portfolio_id, portafolio_codigo (7 códigos),
//   índice único oficina_expedientes_unico (user_id, ticker, mercado, COALESCE(portfolio_id, 0)); RLS "propias": user_id = auth.uid().
// `user_id` es OPCIONAL: en sesión de usuario se omite (la base lo pone con auth.uid() y el RLS "propias" limita las filas); si viene, se valida y se usa
// en filtros y filas (proceso sin sesión con clave de servicio: sale de una variable fija de entorno, nunca de la petición).
// Reglas: nunca se inventa un id (solo el que devuelve la base); si el expediente no se puede recuperar ni crear, devuelve problemas y el llamador
// NO guarda `oficina_analisis` (registra la corrida como bloqueada o incompleta). El error de la base va tal cual. No se sobrescribe nada existente.
// [PROPUESTA] tesis_origen al crear: 'reconstruida' si la posición ya existía (anterior a la Oficina), 'al_entrar' si es una posición nueva;
// tesis_vigente queda null y ficha vacía (sin plan_pcp) hasta que exista una tesis o un plan declarado. tesis_version y ficha usan el default de la base.
// La única reconsulta es la de la carrera: si el insert choca con el índice único (23505) alguien lo creó entre la lectura y la escritura; se lee una vez más.
import { esUuid } from '../orquestador/persistencia';
import type { ConsultaFiltrable } from './hechos-bd';

export const TABLA_EXPEDIENTES_BD = 'oficina_expedientes';
export const COLUMNAS_EXPEDIENTE_ID = 'id,ticker,mercado,portfolio_id';
export const MERCADOS_EXPEDIENTE = ['US', 'BMV'] as const;
export const PORTAFOLIOS_OPERATIVOS = ['PMP', 'PCP', 'PLP', 'ETF', 'SEMILLA'] as const;
export const ORIGEN_RECONSTRUIDA = 'reconstruida';
export const ORIGEN_AL_ENTRAR = 'al_entrar';
export const CODIGO_VIOLACION_UNICA = '23505';

export interface ParametrosExpediente {
  user_id?: string | null;
  ticker: string;
  mercado: string;
  portfolio_id: string;
  portafolio_codigo: string;
  posicion_existe: boolean;
}
export type ResultadoExpediente =
  | { ok: true; expediente_id: string; creado: boolean }
  | { ok: false; problemas: string[]; error_bd?: string };

export interface ClienteExpediente {
  from(tabla: string): {
    select(columnas: string): ConsultaFiltrable;
    insert(fila: Record<string, unknown>): {
      select(columnas: string): { single(): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> };
    };
  };
}

export function verificarParametrosExpediente(p: ParametrosExpediente): string[] {
  const m: string[] = [];
  if (p.user_id !== undefined && p.user_id !== null && !esUuid(p.user_id)) m.push('user_id inválido');
  if (typeof p.ticker !== 'string' || p.ticker.trim() === '') m.push('ticker vacío');
  if (!(MERCADOS_EXPEDIENTE as readonly string[]).includes(p.mercado)) m.push(`mercado inválido: ${String(p.mercado)}`);
  if (!esUuid(p.portfolio_id)) m.push('portfolio_id inválido');
  if (!(PORTAFOLIOS_OPERATIVOS as readonly string[]).includes(p.portafolio_codigo)) m.push(`portafolio sin expediente en la Oficina: ${String(p.portafolio_codigo)}`);
  return m;
}

export async function obtenerOCrearExpediente(cliente: ClienteExpediente, p: ParametrosExpediente): Promise<ResultadoExpediente> {
  const malos = verificarParametrosExpediente(p);
  if (malos.length > 0) return { ok: false, problemas: malos };
  const usuario = p.user_id ?? null;
  const falla = (m: string): ResultadoExpediente => ({ ok: false, problemas: [`${TABLA_EXPEDIENTES_BD}: ${m}`], error_bd: m });
  try {
    const buscar = async (): Promise<{ id: string | null } | { error: string; problemas?: string[] }> => {
      let q = cliente.from(TABLA_EXPEDIENTES_BD).select(COLUMNAS_EXPEDIENTE_ID);
      if (usuario !== null) q = q.eq('user_id', usuario);
      const r = await q.eq('ticker', p.ticker).eq('mercado', p.mercado).eq('portfolio_id', p.portfolio_id);
      if (r.error) return { error: r.error.message };
      if (!Array.isArray(r.data)) return { error: 'la consulta no devolvió filas' };
      if (r.data.length > 1) return { error: `hay ${r.data.length} expedientes del mismo ticker y portafolio (ambiguo)`, problemas: [`${p.ticker}: hay ${r.data.length} expedientes del mismo portafolio (ambiguo)`] };
      const id = (r.data[0] as { id?: unknown } | undefined)?.id;
      if (r.data.length === 1 && !esUuid(id)) return { error: 'el expediente existente no trae un id válido' };
      return { id: r.data.length === 1 ? (id as string) : null };
    };
    const a = await buscar();
    if ('error' in a) return a.problemas ? { ok: false, problemas: a.problemas } : falla(a.error);
    if (a.id !== null) return { ok: true, expediente_id: a.id, creado: false };

    const fila = {
      ...(usuario !== null ? { user_id: usuario } : {}),
      ticker: p.ticker, mercado: p.mercado, portfolio_id: p.portfolio_id, portafolio_codigo: p.portafolio_codigo,
      tesis_origen: p.posicion_existe ? ORIGEN_RECONSTRUIDA : ORIGEN_AL_ENTRAR,
    };
    const ins = await cliente.from(TABLA_EXPEDIENTES_BD).insert(fila).select('id').single();
    if (ins.error) {
      if (ins.error.code !== CODIGO_VIOLACION_UNICA) return falla(ins.error.message);
      const b = await buscar();
      if ('error' in b) return b.problemas ? { ok: false, problemas: b.problemas } : falla(b.error);
      if (b.id === null) return falla(ins.error.message);
      return { ok: true, expediente_id: b.id, creado: false };
    }
    const id = (ins.data as { id?: unknown } | null)?.id;
    if (!esUuid(id)) return falla('la creación no devolvió un id válido');
    return { ok: true, expediente_id: id, creado: true };
  } catch (e) {
    return falla(e instanceof Error ? e.message : String(e));
  }
}
