// Orquestador, módulo 2: prepara las velas de chart-data (TwelveData), confirma el cierre, llama al Técnico y entrega lo que el Motor necesita.
// Sin base de datos. Determinista: el instante de evaluación llega como dato.
//
// Formato de vela (chart-data): { time (segundos Unix; hora local del exchange leída como UTC), open, high, low, close, volume }, de la más
// antigua a la más reciente. chart-data NO filtra ni marca la vela del día en curso: la descarta esta capa, con la regla de cierre
// de `confirmarCierreVelas` (calendario NYSE + margen), nunca por suposición.
//
// El descarte lo hace el Técnico a partir de las banderas (si `ultima_vela_*_cerrada` es false quita la última vela): aquí NO se quita
// nada por separado, para no descartar dos velas. Esta capa solo decide qué banderas entregar y deja constancia de lo descartado.
//
// Política:
//   - Diaria confirmada o en formación: se calcula (en formación = el Técnico quita la última vela).
//   - Diaria `no_evaluable` (el calendario no cubre la fecha) o `pendiente` (sin vela, fecha incoherente, entrada inválida, serie inválida):
//     NO se calcula nada y se declara en `datos_faltantes`. No se calcula con una vela que no se pudo validar.
//   - Semanal que no se pueda confirmar (en formación, pendiente o no_evaluable): se descarta su última vela y se sigue con lo demás.
//     [PROPUESTA] una semanal dudosa degrada el análisis a parcial; no bloquea el cálculo diario.
//   - Serie semanal inválida: se calcula sin velas semanales y queda declarado en `motivos`.

import { calcularTecnico, detonantePara, validarVelas } from '../tecnico';
import type { Candle, SnapshotTecnico } from '../tecnico';
import type { Detonante, UsoSenales } from '../tecnico/detonantes';
import { CALENDARIO_NYSE, ZONA_OFICINA, fechaEnZona } from './calendario';
import type { CalendarioNYSE } from './calendario';
import { MARGEN_CIERRE_MINUTOS, confirmarCierreVelas, instanteEvaluacion } from './cierre-velas';
import type { Mercado, OpcionesCierreVelas, ResultadoCierre, ResultadoCierreVelas } from './cierre-velas';
import { evaluarFrescuraPrecio } from './frescura';
import type { ResultadoFrescura } from './frescura';
import { registrarRachaMogalefSuperior } from './racha';
import type { RachaRegistrada, ResultadoRacha } from './racha';

/** Usos del detonante que se calculan en cada corrida. */
export const USOS_DETONANTE = ['apertura_pcp', 'recompra_pcp', 'dca_plp', 'salida_pcp'] as const satisfies readonly UsoSenales[];
export type UsoDetonante = (typeof USOS_DETONANTE)[number];
/** Usos que alimentan `momento.detonante_confirmado` del Motor (la salida del PCP va por `senal_salida`). */
export const USOS_MOMENTO = ['apertura_pcp', 'recompra_pcp', 'dca_plp'] as const satisfies readonly UsoDetonante[];
export type UsoMomento = (typeof USOS_MOMENTO)[number];
/** Uso cuyo detonante equivale a `senal_salida` de la entrada del Motor. */
export const USO_SENAL_SALIDA = 'salida_pcp' as const satisfies UsoDetonante;

export interface EntradaPrepararTecnico {
  ticker: string;
  mercado: Mercado;
  /** Instante de la evaluación, ISO 8601 con zona. */
  evaluado_en: string;
  /** Por ejemplo "TwelveData". */
  fuente: string;
  velas_diarias: Candle[];
  velas_semanales: Candle[];
}

export type EstadoPreparacion = 'completo' | 'parcial' | 'NO_EVALUABLE' | 'pendiente';

export interface OpcionesPrepararTecnico extends OpcionesCierreVelas {
  /** Límite de frescura del precio (`frescura.precio`, en días hábiles). null o ausente: sin definir, no se evalúa la frescura. */
  frescura_precio_dias_habiles?: number | null;
  /** Racha de MOGALEF_BANDA_SUPERIOR registrada en la corrida anterior del ticker (referencias.tecnico.racha_mogalef_superior). */
  racha_previa?: RachaRegistrada | null;
}

export interface DescarteVela {
  /** Fecha de la vela que el Técnico quita. */
  fecha: string;
  estado: ResultadoCierre['estado'];
  motivos: string[];
}

export interface ResultadoPrepararTecnico {
  /** completo | parcial | NO_EVALUABLE: lo que dice el Técnico (o NO_EVALUABLE si el calendario no cubre la fecha). `pendiente`: no se pudo validar la vela. */
  estado: EstadoPreparacion;
  ticker: string;
  /** Fecha de la evaluación en America/Mexico_City; null si el instante es inválido. */
  fecha_evaluacion: string | null;
  cierre: ResultadoCierreVelas | null;
  descartes: { diaria: DescarteVela | null; semanal: DescarteVela | null };
  /** null si no se calculó (estado NO_EVALUABLE por calendario o pendiente). */
  snapshot: SnapshotTecnico | null;
  /** null si no hay snapshot evaluable. */
  detonantes: Record<UsoDetonante, Detonante> | null;
  /** `momento` de la entrada del Motor, por uso. Solo `detonante_confirmado`: las confirmaciones visuales NO se conectan sin aprobación. */
  momento: Record<UsoMomento, { detonante_confirmado: boolean }> | null;
  /** `senal_salida` de la entrada del Motor para el PCP. null si no se pudo evaluar: nunca se rellena con false. */
  senal_salida: boolean | null;
  /** Para mezclar con `datos_faltantes` de la entrada del Motor (el Técnico es agente requerido). */
  datos_faltantes: string[];
  /** Para mezclar con `datos_vencidos` de la entrada del Motor: precio diario con más antigüedad que `frescura.precio`. */
  datos_vencidos: string[];
  /** null si no hubo snapshot evaluable. */
  frescura: ResultadoFrescura | null;
  /** Registro de la racha de MOGALEF_BANDA_SUPERIOR (solo la banda superior). null si no hubo snapshot evaluable. */
  racha_mogalef_superior: ResultadoRacha | null;
  /** Fragmento para la columna `referencias` (jsonb) de `oficina_corridas_historial`. */
  referencias: { tecnico: ReferenciaTecnico };
  /** Lo que se descartó o no se pudo usar, en texto. */
  motivos: string[];
}

export interface ReferenciaTecnico {
  estado: EstadoPreparacion;
  fecha_evaluacion: string | null;
  margen_cierre_minutos: number;
  ultima_vela_diaria: string | null;
  ultima_vela_semanal: string | null;
  cierre: { diaria: { estado: string; motivos: string[] }; semanal: { estado: string; motivos: string[] } } | null;
  descartes: { diaria: DescarteVela | null; semanal: DescarteVela | null };
  frescura: ResultadoFrescura | null;
  /** Lo que se lee en la corrida siguiente (`rachaPreviaDeReferencias`). null si no hay racha en curso. */
  racha_mogalef_superior: RachaRegistrada | null;
}

function descarte(fecha: string | null, r: ResultadoCierre): DescarteVela | null {
  if (r.cerrada || fecha === null) return null;
  return { fecha, estado: r.estado, motivos: r.motivos.map(m => m.codigo) };
}

function fechaDeUltima(velas: Candle[]): string | null {
  const u = velas[velas.length - 1];
  return u === undefined ? null : new Date(u.time * 1000).toISOString().slice(0, 10);
}

type ResultadoSinReferencias = Omit<ResultadoPrepararTecnico, 'referencias'>;

function prepararSinReferencias(
  entrada: EntradaPrepararTecnico, calendario: CalendarioNYSE, opciones: OpcionesPrepararTecnico,
): ResultadoSinReferencias {
  const base = (estado: EstadoPreparacion, motivos: string[], extra: Partial<ResultadoSinReferencias> = {}): ResultadoSinReferencias => ({
    estado, ticker: entrada.ticker, fecha_evaluacion: null, cierre: null,
    descartes: { diaria: null, semanal: null }, snapshot: null, detonantes: null, momento: null, senal_salida: null,
    datos_faltantes: estado === 'completo' || estado === 'parcial' ? [] : [`tecnico: ${motivos.join('; ')}`],
    datos_vencidos: [], frescura: null, racha_mogalef_superior: null,
    motivos, ...extra,
  });

  const ahora = instanteEvaluacion(entrada.evaluado_en);
  if (ahora === null) return base('pendiente', [`entrada_invalida: evaluado_en debe ser un instante ISO 8601 con zona: ${String(entrada.evaluado_en)}`]);
  const fecha_evaluacion = fechaEnZona(ahora, ZONA_OFICINA);

  const motivos: string[] = [];
  const errDia = validarVelas(entrada.velas_diarias);
  if (errDia) return base('pendiente', [`velas_diarias_invalidas: ${errDia}`], { fecha_evaluacion });
  let semanales = entrada.velas_semanales;
  const errSem = validarVelas(semanales);
  if (errSem) {
    motivos.push(`velas_semanales_invalidas: ${errSem}`);
    semanales = [];
  }

  const fechaDia = fechaDeUltima(entrada.velas_diarias);
  const fechaSem = fechaDeUltima(semanales);
  const cierre = confirmarCierreVelas({
    mercado: entrada.mercado, evaluado_en: entrada.evaluado_en,
    diaria: fechaDia === null ? null : { fecha: fechaDia },
    semanal: fechaSem === null ? null : { fecha: fechaSem },
  }, calendario, opciones);

  const dia = cierre.diaria;
  if (dia.estado === 'no_evaluable' || dia.estado === 'pendiente') {
    const causa = dia.motivos.map(m => `${m.codigo}: ${m.detalle}`);
    return base(dia.estado === 'no_evaluable' ? 'NO_EVALUABLE' : 'pendiente', [...motivos, ...causa], { fecha_evaluacion, cierre });
  }

  const descDia = descarte(fechaDia, dia);
  const descSem = descarte(fechaSem, cierre.semanal);
  if (descDia) motivos.push(`vela diaria ${descDia.fecha} descartada (${descDia.estado}): ${descDia.motivos.join(', ')}`);
  if (descSem) motivos.push(`vela semanal ${descSem.fecha} descartada (${descSem.estado}): ${descSem.motivos.join(', ')}`);

  const snapshot = calcularTecnico({
    ticker: entrada.ticker, fecha_evaluacion, fuente: entrada.fuente,
    velas_diarias: entrada.velas_diarias, velas_semanales: semanales,
    ultima_vela_diaria_cerrada: cierre.ultima_vela_diaria_cerrada,
    ultima_vela_semanal_cerrada: cierre.ultima_vela_semanal_cerrada,
  });
  const descartes = { diaria: descDia, semanal: descSem };

  if (snapshot.estado === 'NO_EVALUABLE') {
    return base('NO_EVALUABLE', [...motivos, ...snapshot.motivos], { fecha_evaluacion, cierre, descartes, snapshot });
  }

  const detonantes = {} as Record<UsoDetonante, Detonante>;
  for (const uso of USOS_DETONANTE) detonantes[uso] = detonantePara(snapshot, uso);
  const momento = {} as Record<UsoMomento, { detonante_confirmado: boolean }>;
  for (const uso of USOS_MOMENTO) momento[uso] = { detonante_confirmado: detonantes[uso].detonante_confirmado };

  const frescura = evaluarFrescuraPrecio({
    ultima_vela_diaria: snapshot.ultima_vela_diaria === null ? null : snapshot.ultima_vela_diaria.fecha,
    fecha_evaluacion, limite_dias_habiles: opciones.frescura_precio_dias_habiles ?? null, calendario,
  });
  const racha = registrarRachaMogalefSuperior(snapshot, opciones.racha_previa ?? null);

  return {
    estado: snapshot.estado, ticker: entrada.ticker, fecha_evaluacion, cierre, descartes, snapshot, detonantes, momento,
    senal_salida: detonantes[USO_SENAL_SALIDA].detonante_confirmado,
    datos_faltantes: [],
    datos_vencidos: frescura.vencida === true ? [`precio_diario: ${frescura.detalle}`] : [],
    frescura, racha_mogalef_superior: racha,
    motivos: [...motivos, ...snapshot.motivos],
  };
}

function resumenCierre(r: ResultadoCierre): { estado: string; motivos: string[] } {
  return { estado: r.estado, motivos: r.motivos.map(m => m.codigo) };
}

export function prepararTecnico(
  entrada: EntradaPrepararTecnico, calendario: CalendarioNYSE = CALENDARIO_NYSE, opciones: OpcionesPrepararTecnico = {},
): ResultadoPrepararTecnico {
  const r = prepararSinReferencias(entrada, calendario, opciones);
  const snap = r.snapshot;
  return {
    ...r,
    referencias: {
      tecnico: {
        estado: r.estado,
        fecha_evaluacion: r.fecha_evaluacion,
        margen_cierre_minutos: opciones.margen_cierre_minutos === undefined ? MARGEN_CIERRE_MINUTOS : opciones.margen_cierre_minutos,
        ultima_vela_diaria: snap === null || snap.ultima_vela_diaria === null ? null : snap.ultima_vela_diaria.fecha,
        ultima_vela_semanal: snap === null || snap.ultima_vela_semanal === null ? null : snap.ultima_vela_semanal.fecha,
        cierre: r.cierre === null ? null : { diaria: resumenCierre(r.cierre.diaria), semanal: resumenCierre(r.cierre.semanal) },
        descartes: r.descartes,
        frescura: r.frescura,
        racha_mogalef_superior: r.racha_mogalef_superior === null ? null : r.racha_mogalef_superior.registro,
      },
    },
  };
}

