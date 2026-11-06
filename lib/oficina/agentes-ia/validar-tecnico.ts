// Validación del sobre de entrada y de la salida del Analista Técnico de IA. Código puro: no llama al modelo.
// El Técnico de IA solo INTERPRETA lo que el código ya calculó (`tecnico_codigo`): indicadores, señales y niveles. Sus precios deben ser niveles calculados,
// citados por `nivel_id` (regla de `validarSalidaTecnico`, que aquí se reutiliza sin cambios). Una salida que no pase NO se guarda ni llega al Director.
import {
  AGENTE_TECNICO, CONFIANZA_MAX, CONFIANZA_MIN, CONTRATO_ENTRADA, CONTRATO_SALIDA, ESTADOS_TECNICO_CON_MODELO, ESTADO_TECNICO_PARCIAL, MAX_RESUMEN,
  MERCADOS_VALIDOS, TOPE_CONFIANZA_CON_FALTANTES, VEREDICTO_NO_EVALUABLE, VERIFICAR_CIFRAS_TECNICO,
} from './constantes';
import { itemsDesdeSnapshotTecnico } from './datos-tecnico';
import { erroresDeCifras, numerosPermitidos } from './verificar-cifras';
import { contieneOrden, enRango, enumDe, esFechaIso, esNumeroFinito, esObjeto, recolectarTextos, textoNoVacio, tieneCifra } from './utilidades';
import type { Obj } from './utilidades';
import type { ItemDato, Validacion } from './validar-fundamental';
import { esUuid } from '../orquestador/persistencia';
import { validarSalidaTecnico } from '../tecnico';
import type { SalidaTecnicoModelo, SnapshotTecnico } from '../tecnico';

export interface SobreTecnicoValido {
  run_id: string; ticker: string; mercado: string; snapshot_id: string; generado_en: string;
  /** Estado del cálculo de código con el que se llama al modelo. */
  estado: string; motivos: string[]; descartes: unknown;
  snapshot: SnapshotTecnico;
  items: ItemDato[];
}

export function validarSobreTecnico(x: unknown): Validacion<SobreTecnicoValido> {
  const e: string[] = [];
  if (!esObjeto(x)) return { ok: false, errores: ['el sobre no es un objeto'] };
  if (x['contrato'] !== CONTRATO_ENTRADA) e.push(`contrato debe ser ${CONTRATO_ENTRADA}`);
  if (x['agente'] !== AGENTE_TECNICO) e.push(`agente debe ser ${AGENTE_TECNICO}`);
  if (!esUuid(x['run_id'])) e.push('run_id no es uuid');
  if (!textoNoVacio(x['ticker'])) e.push('ticker ausente');
  if (!enumDe(x['mercado'], MERCADOS_VALIDOS)) e.push(`mercado debe ser ${MERCADOS_VALIDOS.join(' o ')}`);
  const snap = x['snapshot'];
  if (!esObjeto(snap)) e.push('snapshot ausente');
  else {
    if (!esUuid(snap['id'])) e.push('snapshot.id no es uuid');
    if (!textoNoVacio(snap['generado_en'])) e.push('snapshot.generado_en ausente');
  }
  const tc = x['tecnico_codigo'];
  if (!esObjeto(tc)) {
    e.push('tecnico_codigo ausente: no hay cálculo de código del Técnico (sin velas); no se llama al modelo');
  } else if (!enumDe(tc['estado'], ESTADOS_TECNICO_CON_MODELO)) {
    const m = Array.isArray(tc['motivos']) ? tc['motivos'].filter(textoNoVacio).join('; ') : '';
    e.push(`el cálculo de código del Técnico quedó en ${String(tc['estado'])}${m === '' ? '' : ` (${m})`}; no se llama al modelo`);
  } else {
    const s = tc['snapshot'];
    if (!esObjeto(s) || !Array.isArray(s['niveles_calculados']) || !Array.isArray(s['senales']) || !esObjeto(s['indicadores']) || !textoNoVacio(s['fecha_evaluacion']) || !textoNoVacio(s['fuente'])) {
      e.push('tecnico_codigo.snapshot inválido (niveles_calculados, senales, indicadores, fecha_evaluacion, fuente)');
    }
  }
  if (e.length > 0 || !esObjeto(snap) || !esObjeto(tc) || !esObjeto(tc['snapshot'])) return { ok: false, errores: e };
  const snapshot = tc['snapshot'] as unknown as SnapshotTecnico;
  return {
    ok: true,
    valor: {
      run_id: x['run_id'] as string, ticker: x['ticker'] as string, mercado: x['mercado'] as string, snapshot_id: snap['id'] as string, generado_en: snap['generado_en'] as string,
      estado: tc['estado'] as string, motivos: Array.isArray(tc['motivos']) ? tc['motivos'].filter(textoNoVacio) : [], descartes: tc['descartes'] ?? null,
      snapshot, items: itemsDesdeSnapshotTecnico(snapshot),
    },
  };
}

/** Lo ÚNICO que ve el modelo del Técnico: precios y señales públicas de mercado calculados por código. Sin posiciones, portafolio ni auditoría. */
export function mensajeTecnicoParaModelo(s: SobreTecnicoValido): Obj {
  return {
    contrato: CONTRATO_ENTRADA, agente: AGENTE_TECNICO, run_id: s.run_id, ticker: s.ticker, mercado: s.mercado,
    snapshot: {
      id: s.snapshot_id, generado_en: s.generado_en,
      datos: {
        items: s.items, niveles_calculados: s.snapshot.niveles_calculados,
        senales: s.snapshot.senales.map(g => ({ id: g.id, cumplida: g.cumplida, detalle: g.detalle })),
        estado_calculo: s.estado, avisos: s.motivos, descartes: s.descartes,
      },
    },
  };
}

export interface SalidaTecnicoIa extends Obj {
  contrato: string; agente: string; run_id: string; snapshot_id: string; ticker: string; veredicto: string; confianza: number; resumen: string;
  hallazgos: { id: string; tipo: string; texto: string; evidencia: string[] }[];
  negativos: string[]; datos_fuente: ItemDato[]; datos_faltantes: { campo: string; critico: boolean }[];
}

const TIPOS_HALLAZGO_TECNICO = ['positivo', 'negativo', 'neutral'] as const;
const mismoDato = (a: Obj, b: ItemDato): boolean =>
  a['campo'] === b.campo && a['valor'] === b.valor && a['unidad'] === b.unidad && a['fuente'] === b.fuente && a['fecha_dato'] === b.fecha_dato;

export function validarSalidaTecnicoIa(x: unknown, sobre: SobreTecnicoValido): Validacion<SalidaTecnicoIa> {
  const e: string[] = [];
  if (!esObjeto(x)) return { ok: false, errores: ['la salida no es un objeto'] };
  if (x['contrato'] !== CONTRATO_SALIDA) e.push(`contrato debe ser ${CONTRATO_SALIDA}`);
  if (x['agente'] !== AGENTE_TECNICO) e.push(`agente debe ser ${AGENTE_TECNICO}`);
  if (x['run_id'] !== sobre.run_id) e.push('run_id no coincide con el del sobre');
  if (x['snapshot_id'] !== sobre.snapshot_id) e.push('snapshot_id no coincide con el del sobre');
  if (x['ticker'] !== sobre.ticker) e.push('ticker no coincide con el del sobre');

  const veredicto = x['veredicto'];
  const noEval = veredicto === VEREDICTO_NO_EVALUABLE;
  if (!enRango(x['confianza'], CONFIANZA_MIN, CONFIANZA_MAX)) e.push(`confianza debe estar entre ${CONFIANZA_MIN} y ${CONFIANZA_MAX}`);
  if (!textoNoVacio(x['resumen']) || (x['resumen'] as string).length > MAX_RESUMEN) e.push(`resumen obligatorio, máximo ${MAX_RESUMEN} caracteres`);

  // datos_fuente: solo items calculados por código, idénticos
  const fuentes = new Map<string, ItemDato>(sobre.items.map(i => [i.id, i]));
  const idsFuente = new Set<string>();
  const df = x['datos_fuente'];
  if (!Array.isArray(df)) e.push('datos_fuente debe ser una lista');
  else df.forEach((d, i) => {
    if (!esObjeto(d)) { e.push(`datos_fuente[${i}] no es objeto`); return; }
    if (!textoNoVacio(d['fuente']) || !esFechaIso(d['fecha_dato'])) e.push(`datos_fuente[${i}] sin fuente o fecha_dato válida`);
    const orig = typeof d['id'] === 'string' ? fuentes.get(d['id']) : undefined;
    if (orig === undefined) e.push(`datos_fuente[${i}] cita un id que no existe en los datos calculados: ${String(d['id'])}`);
    else if (!mismoDato(d, orig)) e.push(`datos_fuente[${i}] (${orig.id}) no coincide con el dato calculado`);
    else idsFuente.add(orig.id);
  });

  // hallazgos
  const hall = x['hallazgos'];
  let conEvidencia = 0;
  if (!Array.isArray(hall)) e.push('hallazgos debe ser una lista');
  else {
    const ids = new Set<string>();
    hall.forEach((h, i) => {
      if (!esObjeto(h)) { e.push(`hallazgos[${i}] no es objeto`); return; }
      if (!textoNoVacio(h['id'])) e.push(`hallazgos[${i}].id ausente`);
      else if (ids.has(h['id'])) e.push(`hallazgos[${i}].id repetido: ${h['id']}`);
      else ids.add(h['id']);
      if (!enumDe(h['tipo'], TIPOS_HALLAZGO_TECNICO)) e.push(`hallazgos[${i}].tipo inválido`);
      if (!textoNoVacio(h['texto'])) e.push(`hallazgos[${i}].texto ausente`);
      const ev = h['evidencia'];
      if (!Array.isArray(ev)) e.push(`hallazgos[${i}].evidencia debe ser una lista`);
      else {
        for (const id of ev) if (typeof id !== 'string' || !idsFuente.has(id)) e.push(`hallazgos[${i}].evidencia apunta a un id que no está en datos_fuente: ${String(id)}`);
        if (typeof h['texto'] === 'string' && tieneCifra(h['texto']) && ev.length === 0) e.push(`hallazgos[${i}] cita una cifra sin evidencia`);
        if (ev.length > 0) conEvidencia++;
      }
    });
    if (!noEval && conEvidencia === 0) e.push('un veredicto distinto de NO_EVALUABLE exige al menos un hallazgo con evidencia citada');
  }

  // Las cifras escritas deben ser las de los datos citados (redondeadas, no truncadas); los parámetros de los indicadores (EMA21, RSI de 14...) no cuentan
  if (VERIFICAR_CIFRAS_TECNICO) {
    const parametros = Object.values(sobre.snapshot.parametros ?? {}).filter(esNumeroFinito);
    e.push(...erroresDeCifras(x, fuentes, idsFuente, numerosPermitidos(sobre.items, parametros)));
  }

  const neg = x['negativos'];
  if (!Array.isArray(neg) || neg.length === 0 || !neg.every(textoNoVacio)) e.push('negativos debe traer al menos un elemento de texto (o qué se revisó para concluir que no hay)');

  const falt = x['datos_faltantes'];
  let hayCritico = false;
  if (!Array.isArray(falt)) e.push('datos_faltantes debe ser una lista');
  else falt.forEach((f, i) => {
    if (!esObjeto(f) || !textoNoVacio(f['campo']) || typeof f['critico'] !== 'boolean') e.push(`datos_faltantes[${i}] inválido (campo, critico)`);
    else if (f['critico']) hayCritico = true;
  });
  if (!noEval && hayCritico) e.push('hay datos_faltantes críticos: el veredicto debe ser NO_EVALUABLE');
  if (noEval && Array.isArray(falt) && falt.length === 0) e.push('NO_EVALUABLE exige listar datos_faltantes');
  if (sobre.estado === ESTADO_TECNICO_PARCIAL && Array.isArray(falt) && falt.length === 0) e.push('el cálculo de código quedó parcial: declara en datos_faltantes lo que no se calculó (ver avisos)');
  const conf = x['confianza'];
  if (enRango(conf, CONFIANZA_MIN, CONFIANZA_MAX) && Array.isArray(falt) && falt.length > 0 && conf > TOPE_CONFIANZA_CON_FALTANTES) e.push(`confianza (${String(conf)}) no puede superar ${String(TOPE_CONFIANZA_CON_FALTANTES)} cuando hay datos_faltantes`);

  // Niveles y tendencias: la regla de precios es la del módulo Técnico (solo niveles calculados, por nivel_id y con el precio exacto)
  // (incluye el vocabulario del veredicto y las tendencias corto, medio y largo)
  e.push(...validarSalidaTecnico(x as unknown as SalidaTecnicoModelo, sobre.snapshot.niveles_calculados).errores);
  if (noEval) {
    for (const k of ['zona_entrada', 'soporte_clave', 'resistencia_clave', 'nivel_invalidacion']) if (x[k] !== null && x[k] !== undefined) e.push(`${k} debe ser null con NO_EVALUABLE: no se proponen niveles sin evaluación`);
  }
  // Un soporte no puede estar por encima del último cierre, ni una resistencia por debajo (comprobable en código)
  const cierre = sobre.snapshot.ultima_vela_diaria === null ? null : Number(sobre.snapshot.ultima_vela_diaria.cierre);
  const sop = x['soporte_clave']; const res = x['resistencia_clave'];
  if (cierre !== null && esObjeto(sop) && esNumeroFinito(Number(sop['precio'])) && Number(sop['precio']) > cierre) e.push(`soporte_clave (${String(sop['precio'])}) está por encima del último cierre (${String(cierre)}): un soporte va por debajo`);
  if (cierre !== null && esObjeto(res) && esNumeroFinito(Number(res['precio'])) && Number(res['precio']) < cierre) e.push(`resistencia_clave (${String(res['precio'])}) está por debajo del último cierre (${String(cierre)}): una resistencia va por encima`);

  if (recolectarTextos(x, ['datos_fuente', 'evidencia', 'id', 'run_id', 'snapshot_id', 'contrato', 'agente', 'ticker']).some(contieneOrden)) e.push('la salida contiene una instrucción de compra o venta: los agentes no emiten órdenes');
  if (e.length > 0) return { ok: false, errores: Array.from(new Set(e)) };
  return { ok: true, valor: x as SalidaTecnicoIa };
}
