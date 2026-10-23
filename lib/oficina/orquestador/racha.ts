// Registro de la racha de MOGALEF_BANDA_SUPERIOR (módulo 3). La regla de una señal por racha es SOLO para la banda superior (21-22 oct);
// MOGALEF_BANDA_INFERIOR no se toca. El Técnico no guarda estado: deduce la racha de las velas. Esta función compara con lo que quedó
// registrado en la corrida anterior para saber si la activación es nueva o ya se había registrado (por ejemplo, una segunda corrida el mismo día).
// No cambia la señal ni `senal_salida`: solo informa y devuelve lo que se guarda en `referencias` de `oficina_corridas_historial`.
// No agrupa ni envía alertas (la agrupación de 24 h espera aprobación).

import type { SnapshotTecnico } from '../tecnico';

export interface RachaRegistrada {
  /** Fecha de la vela de la primera ruptura de la racha. */
  fecha_inicio: string;
  dias: number;
  /** true si la activación (primera ruptura) quedó registrada como señal; false si la racha se vio ya empezada y la activación no se registró. */
  activacion_registrada: boolean;
}

export type EstadoRachaRegistro =
  | 'nueva_activacion'          // primera ruptura de la racha y no estaba registrada
  | 'ya_registrada'             // primera ruptura ya registrada en una corrida anterior (mismo día)
  | 'racha_en_curso'            // ruptura repetida: la señal no se repite
  | 'sin_racha'                 // la última vela no rompe la banda: la racha termina
  | 'no_determinable'           // la racha empieza antes de los datos disponibles, o faltan datos
  | 'no_evaluable';             // sin snapshot

export interface ResultadoRacha {
  estado: EstadoRachaRegistro;
  /** Lo que se guarda para la próxima corrida; null si no hay racha en curso. */
  registro: RachaRegistrada | null;
  detalle: string;
}

export function registrarRachaMogalefSuperior(snapshot: SnapshotTecnico | null, previa: RachaRegistrada | null): ResultadoRacha {
  if (snapshot === null || snapshot.estado === 'NO_EVALUABLE') {
    return { estado: 'no_evaluable', registro: null, detalle: 'Sin snapshot del Técnico: no se puede registrar la racha' };
  }
  const s = snapshot.senales.find(x => x.id === 'MOGALEF_BANDA_SUPERIOR');
  if (s === undefined || s.cumplida === null) {
    return { estado: 'no_determinable', registro: null, detalle: s ? s.detalle : 'La señal MOGALEF_BANDA_SUPERIOR no está en el snapshot' };
  }
  const r = s.racha;
  if (r === undefined) return { estado: 'no_determinable', registro: null, detalle: 'La señal no trae el estado de la racha' };
  if (!r.en_curso || r.fecha_inicio === null) {
    return { estado: 'sin_racha', registro: null, detalle: 'La última vela no rompe la banda superior: no hay racha en curso' };
  }
  const mismaRacha = previa !== null && previa.fecha_inicio === r.fecha_inicio;
  if (s.cumplida) {
    return {
      estado: mismaRacha && previa.activacion_registrada ? 'ya_registrada' : 'nueva_activacion',
      registro: { fecha_inicio: r.fecha_inicio, dias: r.dias, activacion_registrada: true },
      detalle: mismaRacha && previa.activacion_registrada
        ? `La activación del ${r.fecha_inicio} ya estaba registrada`
        : `Primera ruptura de la racha (${r.fecha_inicio}): activación nueva`,
    };
  }
  const activada = mismaRacha && previa.activacion_registrada;
  return {
    estado: 'racha_en_curso',
    registro: { fecha_inicio: r.fecha_inicio, dias: r.dias, activacion_registrada: activada },
    detalle: activada
      ? `Ruptura nº ${r.dias} de la racha iniciada el ${r.fecha_inicio}: la señal no se repite`
      : `Ruptura nº ${r.dias} de una racha iniciada el ${r.fecha_inicio} cuya activación NO quedó registrada: no hay señal vigente`,
  };
}

/** Lee la racha registrada de la columna `referencias` (jsonb) de una corrida anterior: referencias.tecnico.racha_mogalef_superior. Forma inválida = null. */
export function rachaPreviaDeReferencias(referencias: unknown): RachaRegistrada | null {
  if (typeof referencias !== 'object' || referencias === null) return null;
  const tec = (referencias as { tecnico?: unknown }).tecnico;
  if (typeof tec !== 'object' || tec === null) return null;
  const r = (tec as { racha_mogalef_superior?: unknown }).racha_mogalef_superior;
  if (typeof r !== 'object' || r === null) return null;
  const x = r as { fecha_inicio?: unknown; dias?: unknown; activacion_registrada?: unknown };
  if (typeof x.fecha_inicio !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x.fecha_inicio)) return null;
  if (typeof x.dias !== 'number' || !Number.isInteger(x.dias) || x.dias < 1) return null;
  if (typeof x.activacion_registrada !== 'boolean') return null;
  return { fecha_inicio: x.fecha_inicio, dias: x.dias, activacion_registrada: x.activacion_registrada };
}
