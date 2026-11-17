// Lógica pura de las alertas de la Oficina (v0.59): revisión PMP-11 vencida y señal técnica nueva. SIN dependencias: este mismo archivo se copia tal cual a
// supabase/functions/update-ia/alertas-oficina.ts (la Edge Function corre en Deno y no puede importar de lib/). Una prueba comprueba que las dos copias son idénticas.

/** Primera revisión formal de PMP-11 según la regla (catálogo de reglas). */
export const PRIMERA_REVISION_PMP11 = '2027-04-06';
export const MESES_ENTRE_REVISIONES_PMP11 = 6;
/** Mientras la revisión siga vencida, el aviso se repite como máximo cada tantos días (no a diario). */
export const DIAS_ENTRE_AVISOS_PMP11 = 7;

const REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const esObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function sumarMeses(fecha: string, meses: number): string {
  const [y, m, d] = fecha.split('-').map(Number) as [number, number, number];
  const total = (m - 1) + meses;
  const ny = y + Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  const ultimo = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`;
}

export function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400000);
}

/** Fecha de la última revisión guardada en `ficha.revisiones_pmp11` (null si no hay ninguna válida). */
export function ultimaRevisionPmp11(ficha: unknown): string | null {
  if (!esObj(ficha) || !Array.isArray(ficha['revisiones_pmp11'])) return null;
  const fechas = (ficha['revisiones_pmp11'] as unknown[])
    .map(x => (esObj(x) && typeof x['fecha'] === 'string' && REGEX_FECHA.test(x['fecha']) ? x['fecha'] : null))
    .filter((x): x is string => x !== null)
    .sort();
  return fechas.length === 0 ? null : fechas[fechas.length - 1]!;
}

export interface EstadoPmp11 { vencida: boolean; vence: string; ultima: string | null; dias_atraso: number }

/** Vence 6 meses después de la última revisión; si nunca se revisó, en la primera fecha formal de la regla. */
export function estadoPmp11(ficha: unknown, hoy: string): EstadoPmp11 {
  const ultima = ultimaRevisionPmp11(ficha);
  const vence = ultima === null ? PRIMERA_REVISION_PMP11 : sumarMeses(ultima, MESES_ENTRE_REVISIONES_PMP11);
  const vencida = hoy >= vence;
  return { vencida, vence, ultima, dias_atraso: vencida ? diasEntre(vence, hoy) : 0 };
}

/** ¿Toca avisar hoy? Nunca avisado, o pasaron al menos `cadaDias` desde el último aviso. */
export function debeAvisarPmp11(ultimoAviso: string | null, hoy: string, cadaDias: number = DIAS_ENTRE_AVISOS_PMP11): boolean {
  if (ultimoAviso === null || !REGEX_FECHA.test(ultimoAviso)) return true;
  return diasEntre(ultimoAviso, hoy) >= cadaDias;
}

/** `sin_dato`: la consulta falló ese día; cuenta como revisado hoy (no se reintenta hasta mañana) pero NO como observación (no sirve para decidir una señal «nueva»). */
export interface EstadoSenal { fecha_revisada: string; confirmada: boolean; sin_dato?: boolean }

/** Lee el estado guardado de un ticker (jsonb); null si no hay o es inválido. */
export function leerEstadoSenal(valor: unknown): EstadoSenal | null {
  if (!esObj(valor) || typeof valor['fecha_revisada'] !== 'string' || !REGEX_FECHA.test(valor['fecha_revisada']) || typeof valor['confirmada'] !== 'boolean') return null;
  return { fecha_revisada: valor['fecha_revisada'], confirmada: valor['confirmada'], ...(valor['sin_dato'] === true ? { sin_dato: true } : {}) };
}

/** Una sola revisión por ticker y día. */
export function tocaRevisarSenal(previo: EstadoSenal | null, hoy: string): boolean {
  return previo === null || previo.fecha_revisada !== hoy;
}

export type AccionSenal = 'alertar' | 'guardar' | 'omitir';

/** «Nueva» = pasa de no confirmada a confirmada (≥ señales mínimas). La primera observación de un ticker solo se guarda (no avisa, para no inundar al activar).
 *  Con `alertar` el estado se guarda SOLO si el correo salió; si falla se reintenta en la siguiente corrida. */
export function decidirSenal(previo: EstadoSenal | null, confirmadaAhora: boolean, hoy: string): { accion: AccionSenal; estado: EstadoSenal } {
  const estado: EstadoSenal = { fecha_revisada: hoy, confirmada: confirmadaAhora };
  if (previo !== null && previo.fecha_revisada === hoy) return { accion: 'omitir', estado: previo };
  if (previo === null || previo.sin_dato === true) return { accion: 'guardar', estado };
  if (!previo.confirmada && confirmadaAhora) return { accion: 'alertar', estado };
  return { accion: 'guardar', estado };
}

// ---------------------------------------------------------------- orquestación (con dependencias inyectadas: la Edge Function pone fetch, base de datos y correo)
export const MAX_SENALES_POR_CORRIDA = 2;
export const ESPERA_ENTRE_SENALES_MS = 15000; // cada ticker son 2 consultas de velas y TwelveData permite 8 por minuto
export const PRESUPUESTO_ALERTAS_MS = 50000;
export const TIPO_ALERTA_PMP11 = '📋 REVISIÓN PMP-11 VENCIDA';
export const TIPO_ALERTA_SENAL = '🟢 SEÑAL TÉCNICA NUEVA';

export type RespuestaSenal =
  | { ok: true; confirmada: boolean; senales_cumplidas: string[]; senales_minimas: number; cierre: number; fecha_vela: string }
  | { ok: false; error: string };

export interface DepsAlertas {
  hoy: string;
  mercadoAbierto: boolean;
  leer(ruta: string): Promise<unknown[] | null>;
  guardarEstado(clave: string, valor: unknown): Promise<boolean>;
  enviar(payload: Record<string, unknown>): Promise<boolean>;
  consultarSenal(ticker: string): Promise<RespuestaSenal>;
  esperar(ms: number): Promise<void>;
  ahoraMs(): number;
  log(mensaje: string): void;
}
export interface ResumenAlertas { pmp11_avisadas: string[]; senales_revisadas: string[]; senales_avisadas: string[]; omitido?: string }

const filas = (v: unknown[] | null): Record<string, unknown>[] => (v ?? []).filter(esObj);
const texto = (v: unknown): string => (typeof v === 'string' ? v : '');

export async function ejecutarAlertasOficina(deps: DepsAlertas, tickersWatchlist: readonly string[]): Promise<ResumenAlertas> {
  const resumen: ResumenAlertas = { pmp11_avisadas: [], senales_revisadas: [], senales_avisadas: [] };
  if (!deps.mercadoAbierto) return { ...resumen, omitido: 'mercado cerrado' };
  const inicio = deps.ahoraMs();

  // ---- 1) Revisión PMP-11 vencida (sin consultas externas: solo la base)
  try {
    const cfg = filas(await deps.leer('oficina_portafolios_config?select=portfolio_id,codigo&codigo=eq.PMP'));
    const idsPmp = new Set(cfg.map(c => texto(c['portfolio_id'])).filter(x => x !== ''));
    const posiciones = filas(await deps.leer('oficina_v_posiciones?select=portfolio_id,ticker'));
    const abiertas = Array.from(new Set(posiciones.filter(p => idsPmp.has(texto(p['portfolio_id']))).map(p => texto(p['ticker']).toUpperCase()).filter(t => t !== ''))).sort();
    if (abiertas.length > 0) {
      const exps = filas(await deps.leer('oficina_expedientes?select=ticker,ficha&portafolio_codigo=eq.PMP'));
      const previos = new Map(filas(await deps.leer('oficina_alertas_estado?select=clave,valor&clave=like.pmp11:*')).map(f => [texto(f['clave']), f['valor']] as const));
      for (const t of abiertas) {
        // varios expedientes del mismo ticker: vale la revisión más reciente de cualquiera
        const ultimas = exps.filter(e => texto(e['ticker']).toUpperCase() === t).map(e => ultimaRevisionPmp11(e['ficha'])).filter((x): x is string => x !== null).sort();
        const ultima = ultimas.length === 0 ? null : ultimas[ultimas.length - 1]!;
        const est = estadoPmp11(ultima === null ? {} : { revisiones_pmp11: [{ fecha: ultima }] }, deps.hoy);
        if (!est.vencida) continue;
        const prev = previos.get(`pmp11:${t}`);
        const avisada = esObj(prev) && typeof prev['avisada'] === 'string' ? prev['avisada'] : null;
        if (!debeAvisarPmp11(avisada, deps.hoy)) continue;
        const detalle = ultima === null
          ? `Nunca se ha revisado y la primera revisión formal era el ${est.vence} (${est.dias_atraso} días de atraso). Abre /oficina y pulsa Revisar.`
          : `Última revisión: ${ultima}. Tocaba el ${est.vence} (${est.dias_atraso} días de atraso). Abre /oficina y pulsa Revisar.`;
        const ok = await deps.enviar({ ticker: t, type: TIPO_ALERTA_PMP11, currentPrice: 0, targetPrice: 0, detalle });
        if (ok && await deps.guardarEstado(`pmp11:${t}`, { avisada: deps.hoy })) resumen.pmp11_avisadas.push(t);
      }
    }
  } catch (e) {
    deps.log(`alertas PMP-11: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ---- 2) Señal técnica nueva en la watchlist (como mucho MAX_SENALES_POR_CORRIDA tickers por corrida, uno por día cada uno)
  try {
    const estados = new Map<string, EstadoSenal | null>();
    for (const f of filas(await deps.leer('oficina_alertas_estado?select=clave,valor&clave=like.senal:*'))) estados.set(texto(f['clave']), leerEstadoSenal(f['valor']));
    const candidatos = Array.from(new Set(tickersWatchlist.map(t => t.toUpperCase().trim()).filter(t => /^[A-Z0-9.\-]{1,10}$/.test(t))))
      .filter(t => tocaRevisarSenal(estados.get(`senal:${t}`) ?? null, deps.hoy))
      .sort((a, b) => (estados.get(`senal:${a}`)?.fecha_revisada ?? '').localeCompare(estados.get(`senal:${b}`)?.fecha_revisada ?? '') || a.localeCompare(b))
      .slice(0, MAX_SENALES_POR_CORRIDA);
    for (let i = 0; i < candidatos.length; i++) {
      if (deps.ahoraMs() - inicio > PRESUPUESTO_ALERTAS_MS) { deps.log('alertas: presupuesto de tiempo agotado; el resto queda para la siguiente corrida'); break; }
      if (i > 0) await deps.esperar(ESPERA_ENTRE_SENALES_MS);
      const t = candidatos[i]!;
      const previo = estados.get(`senal:${t}`) ?? null;
      const r = await deps.consultarSenal(t);
      resumen.senales_revisadas.push(t);
      if (!r.ok) {
        deps.log(`señal ${t}: ${r.error}`);
        await deps.guardarEstado(`senal:${t}`, { fecha_revisada: deps.hoy, confirmada: previo?.confirmada ?? false, sin_dato: true });
        continue;
      }
      const d = decidirSenal(previo, r.confirmada, deps.hoy);
      if (d.accion === 'alertar') {
        const detalle = `Cumple ${r.senales_cumplidas.length} de las señales de entrada de PMP (mínimo ${r.senales_minimas}): ${r.senales_cumplidas.join(', ')}. Cierre del ${r.fecha_vela}. Es solo una señal técnica: no autoriza una compra por sí sola; corre el análisis en la Oficina.`;
        const ok = await deps.enviar({ ticker: t, type: TIPO_ALERTA_SENAL, currentPrice: r.cierre, targetPrice: 0, detalle });
        if (ok && await deps.guardarEstado(`senal:${t}`, d.estado)) resumen.senales_avisadas.push(t); // si el correo no salió, no se guarda y se reintenta
      } else if (d.accion === 'guardar') {
        await deps.guardarEstado(`senal:${t}`, d.estado);
      }
    }
  } catch (e) {
    deps.log(`alertas señales: ${e instanceof Error ? e.message : String(e)}`);
  }
  return resumen;
}
