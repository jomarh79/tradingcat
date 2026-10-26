// Agrupación de alertas repetidas (contrato Orquestador/Director v0.4, sección 1.2 paso 2; decidido el 14-oct y confirmado el 22-oct).
// Ventana de 24 h (parámetro `orquestador.ventana_alertas`), agrupando por ticker, tipo de alerta y condición que la originó.
// La agrupación es SOLO un mecanismo de notificación: no retrasa una revisión financiera ni impide una corrida nueva por cambio material o datos vencidos.
// Función pura: recibe los grupos vigentes y la alerta, devuelve la decisión y los grupos actualizados. No toca la base.
//
// Del contrato:
//   - Una repetida dentro de la ventana se agrega al grupo, sin notificación idéntica (O-08).
//   - Cambia la severidad, el estado de la posición o la acción requerida: actualización inmediata (O-14).
//   - Las alertas críticas (reglas obligatorias, riesgo o bloqueos) no se retrasan por la agrupación (O-15).
//   - Una repetida con datos vencidos o cambio material permite una corrida nueva (O-26).
//   - Al terminar la ventana, una nueva ocurrencia inicia otro grupo.
// [PROPUESTA] (el contrato no lo precisa; confirma o corrige):
//   P1. La ventana es fija desde la PRIMERA ocurrencia del grupo (no se desliza). Exactamente a las 24 h ya terminó: la ocurrencia inicia otro grupo.
//   P2. «Cambia la severidad» es cualquier cambio (sube o baja), no solo un aumento.
//   P3. Estado de la posición y acción requerida: hay cambio solo si ambos valores (el del grupo y el nuevo) se conocen y difieren. Un valor desconocido
//       (null) nunca cuenta como cambio y nunca borra el último valor conocido.
//   P4. Una alerta crítica notifica siempre, aunque ya haya un grupo vigente (no se suprime ninguna), y permite corrida nueva.
//   P5. Ticker sin distinción de mayúsculas/espacios en la clave; tipo y condición se comparan exactos (sin espacios en los extremos).
//   P6. Si la ventana no está definida o es inválida, NO se agrupa: cada alerta notifica. Un fallo de configuración nunca oculta una alerta.
//   P7. Una ocurrencia anterior al inicio del grupo vigente (entrada desordenada) se rechaza como inválida; no se reordena en silencio.

export type SeveridadAlerta = 'baja' | 'media' | 'alta';
export const SEVERIDADES_ALERTA: readonly SeveridadAlerta[] = ['baja', 'media', 'alta'];

/** Milisegundos por hora; la ventana llega en horas desde `orquestador.ventana_alertas`. */
export const MS_POR_HORA = 3_600_000;

export interface AlertaEntrante {
  ticker: string;
  tipo: string;
  /** Condición que originó la alerta (columna `condicion` de `oficina_alertas`). */
  condicion: string;
  severidad: SeveridadAlerta;
  /** Estado de la posición (p. ej. VIGILAR, ABIERTA). null si no se conoce. */
  estado_posicion: string | null;
  /** Acción requerida. null si no se conoce. */
  accion_requerida: string | null;
  /** Regla obligatoria, riesgo o bloqueo. Lo decide quien genera la alerta, no este módulo. */
  critica: boolean;
  /** Instante ISO 8601 con zona. */
  ocurrida_en: string;
  /** Cambio material o datos vencidos (los define el módulo de eventos materiales y el de frescura; aquí solo se reciben). */
  cambio_material?: boolean;
  datos_vencidos?: boolean;
}

export interface GrupoAlerta {
  /** ticker|tipo|condicion normalizados. */
  clave: string;
  ticker: string;
  tipo: string;
  condicion: string;
  /** Primera ocurrencia (ISO UTC). La ventana corre desde aquí. */
  inicio: string;
  /** inicio + ventana (ISO UTC). */
  fin_ventana: string;
  ultima_ocurrencia: string;
  ocurrencias: number;
  /** Última severidad / estado / acción conocidos del grupo. */
  severidad: SeveridadAlerta;
  estado_posicion: string | null;
  accion_requerida: string | null;
}

export type DecisionAlerta =
  | 'grupo_nuevo'               // sin grupo vigente: se notifica y se abre el grupo
  | 'agregada_al_grupo'         // repetida: sin notificación idéntica
  | 'actualizacion_inmediata'   // cambió severidad, estado o acción: se notifica ya
  | 'critica'                   // crítica: no se retrasa ni se suprime
  | 'sin_agrupar'               // ventana sin definir o inválida: se notifica sin agrupar
  | 'invalida';                 // entrada inválida: no se toca ningún grupo

export type CambioAlerta = 'severidad' | 'estado_posicion' | 'accion_requerida';

export interface ResultadoAlerta {
  decision: DecisionAlerta;
  notificar: boolean;
  /** Qué cambió respecto del grupo (solo con `actualizacion_inmediata`, o con `critica` si además cambió algo). */
  cambios: CambioAlerta[];
  /** true si el Orquestador puede abrir una corrida: grupo nuevo, crítica, cambio material o datos vencidos. Es una autorización de no-bloqueo, no una orden. */
  permite_corrida_nueva: boolean;
  /** Grupo al que pertenece la alerta tras procesarla; null si es inválida o no se agrupó. */
  grupo: GrupoAlerta | null;
  /** Todos los grupos (los anteriores intactos). */
  grupos: GrupoAlerta[];
  motivos: string[];
}

export function claveGrupoAlerta(a: Pick<AlertaEntrante, 'ticker' | 'tipo' | 'condicion'>): string {
  return `${a.ticker.trim().toUpperCase()}|${a.tipo.trim()}|${a.condicion.trim()}`;
}

function instante(iso: unknown): number | null {
  if (typeof iso !== 'string' || !/(Z|[+-]\d{2}:?\d{2})$/.test(iso.trim())) return null;
  const t = Date.parse(iso);
  return isNaN(t) ? null : t;
}

function textoValido(s: unknown): s is string {
  return typeof s === 'string' && s.trim() !== '';
}

function invalida(grupos: GrupoAlerta[], motivo: string): ResultadoAlerta {
  return { decision: 'invalida', notificar: false, cambios: [], permite_corrida_nueva: false, grupo: null, grupos, motivos: [motivo] };
}

function cambiado(previo: string | null, nuevo: string | null): boolean {
  return previo !== null && nuevo !== null && previo !== nuevo;
}

/**
 * Procesa una alerta contra los grupos conocidos.
 * @param ventana_horas `orquestador.ventana_alertas` en horas; null si no está definido o es inválido (P6: no se agrupa).
 */
export function procesarAlerta(grupos: GrupoAlerta[], alerta: AlertaEntrante, ventana_horas: number | null): ResultadoAlerta {
  if (!textoValido(alerta.ticker) || !textoValido(alerta.tipo) || !textoValido(alerta.condicion)) {
    return invalida(grupos, 'entrada_invalida: ticker, tipo y condicion son obligatorios');
  }
  if (!SEVERIDADES_ALERTA.includes(alerta.severidad)) return invalida(grupos, `entrada_invalida: severidad desconocida (${String(alerta.severidad)})`);
  const t = instante(alerta.ocurrida_en);
  if (t === null) return invalida(grupos, `entrada_invalida: ocurrida_en debe ser un instante ISO 8601 con zona: ${String(alerta.ocurrida_en)}`);

  const critica = alerta.critica === true;
  const material = alerta.cambio_material === true || alerta.datos_vencidos === true;

  if (ventana_horas === null || !isFinite(ventana_horas) || ventana_horas < 0) {
    return {
      decision: 'sin_agrupar', notificar: true, cambios: [], permite_corrida_nueva: true, grupo: null, grupos,
      motivos: ['ventana_alertas sin definir o inválida: no se agrupa; la alerta se notifica'],
    };
  }

  const clave = claveGrupoAlerta(alerta);
  const ventana_ms = ventana_horas * MS_POR_HORA;
  // El grupo vigente es el más reciente de la clave cuya ventana todavía no terminó.
  let idx = -1;
  for (let i = 0; i < grupos.length; i++) {
    const g = grupos[i]!;
    if (g.clave !== clave) continue;
    const ini = Date.parse(g.inicio);
    if (idx === -1 || ini > Date.parse(grupos[idx]!.inicio)) idx = i;
  }
  const previo = idx === -1 ? null : grupos[idx]!;
  const vigente = previo !== null && t < Date.parse(previo.inicio) + ventana_ms;

  if (previo !== null && t < Date.parse(previo.inicio)) {
    return invalida(grupos, `ocurrencia_desordenada: ${alerta.ocurrida_en} es anterior al inicio del grupo vigente (${previo.inicio})`);
  }

  if (!vigente) {
    const grupo: GrupoAlerta = {
      clave, ticker: alerta.ticker.trim().toUpperCase(), tipo: alerta.tipo.trim(), condicion: alerta.condicion.trim(),
      inicio: new Date(t).toISOString(), fin_ventana: new Date(t + ventana_ms).toISOString(), ultima_ocurrencia: new Date(t).toISOString(),
      ocurrencias: 1, severidad: alerta.severidad, estado_posicion: alerta.estado_posicion, accion_requerida: alerta.accion_requerida,
    };
    return {
      decision: critica ? 'critica' : 'grupo_nuevo', notificar: true, cambios: [], permite_corrida_nueva: true,
      grupo, grupos: [...grupos, grupo], motivos: [critica ? 'alerta crítica: se notifica sin demora' : 'sin grupo vigente: grupo nuevo'],
    };
  }

  const p = previo!;
  const cambios: CambioAlerta[] = [];
  if (alerta.severidad !== p.severidad) cambios.push('severidad');
  if (cambiado(p.estado_posicion, alerta.estado_posicion)) cambios.push('estado_posicion');
  if (cambiado(p.accion_requerida, alerta.accion_requerida)) cambios.push('accion_requerida');

  const actualizado: GrupoAlerta = {
    ...p,
    ultima_ocurrencia: new Date(t).toISOString(),
    ocurrencias: p.ocurrencias + 1,
    severidad: alerta.severidad,
    estado_posicion: alerta.estado_posicion ?? p.estado_posicion,
    accion_requerida: alerta.accion_requerida ?? p.accion_requerida,
  };
  const nuevos = grupos.map((g, i) => (i === idx ? actualizado : g));

  if (critica) {
    return { decision: 'critica', notificar: true, cambios, permite_corrida_nueva: true, grupo: actualizado, grupos: nuevos,
      motivos: ['alerta crítica dentro de la ventana: no se retrasa ni se agrupa'] };
  }
  if (cambios.length > 0) {
    return { decision: 'actualizacion_inmediata', notificar: true, cambios, permite_corrida_nueva: material, grupo: actualizado, grupos: nuevos,
      motivos: [`cambio de ${cambios.join(', ')}: actualización inmediata sin esperar a que termine la ventana`] };
  }
  return { decision: 'agregada_al_grupo', notificar: false, cambios: [], permite_corrida_nueva: material, grupo: actualizado, grupos: nuevos,
    motivos: [material ? 'repetida en la ventana, pero con cambio material o datos vencidos: se permite una corrida nueva' : 'repetida en la ventana: se agrega al grupo sin notificación idéntica'] };
}
