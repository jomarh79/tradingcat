// Validación del sobre de entrada y de la salida del Analista Fundamental (contrato de agentes, secciones 1 a 4).
// Código puro: no llama al modelo. Una salida que no pase NO se guarda ni llega al Director.
// [PROPUESTA] Forma de `snapshot.datos` para el Fundamental: `{ items: [{ id, campo, valor, unidad, fuente, fecha_dato }] }`. Los fragmentos de texto
//   del 10-K/10-Q son items con `campo` de fragmento y `valor` texto. El agente solo puede citar items existentes, con los mismos valores.
import {
  AGENTE_FUNDAMENTAL, CONFIANZA_MAX, CONFIANZA_MIN, CONTRATO_ENTRADA, CONTRATO_SALIDA, ESTADOS_CAMBIO_TESIS, MAX_RESUMEN, MERCADOS_VALIDOS,
  OPERADORES_UMBRAL, PUNTAJE_MAX, PUNTAJE_MIN, SUBPUNTAJES_FUNDAMENTAL, TIPOS_HALLAZGO, VEREDICTOS_FUNDAMENTAL, VEREDICTO_NO_EVALUABLE,
} from './constantes';
import { contieneOrden, enRango, enumDe, esEntero, esFechaIso, esNumeroFinito, esObjeto, recolectarTextos, textoNoVacio, tieneCifra } from './utilidades';
import type { Obj } from './utilidades';
import { esUuid } from '../orquestador/persistencia';

export interface ItemDato { id: string; campo: string; valor: number | string; unidad: string | null; fuente: string; fecha_dato: string }
export interface SobreFundamental {
  contrato: string; run_id: string; agente: string; ticker: string; mercado: string;
  snapshot: { id: string; generado_en: string; datos: { items: ItemDato[] } };
  tesis_vigente: { texto: string; version: number; origen: string } | null;
}
export type Validacion<T> = { ok: true; valor: T } | { ok: false; errores: string[] };

export function validarSobreFundamental(x: unknown): Validacion<SobreFundamental> {
  const e: string[] = [];
  if (!esObjeto(x)) return { ok: false, errores: ['el sobre no es un objeto'] };
  if (x['contrato'] !== CONTRATO_ENTRADA) e.push(`contrato debe ser ${CONTRATO_ENTRADA}`);
  if (x['agente'] !== AGENTE_FUNDAMENTAL) e.push(`agente debe ser ${AGENTE_FUNDAMENTAL}`);
  if (!esUuid(x['run_id'])) e.push('run_id no es uuid');
  if (!textoNoVacio(x['ticker'])) e.push('ticker ausente');
  if (!enumDe(x['mercado'], MERCADOS_VALIDOS)) e.push(`mercado debe ser ${MERCADOS_VALIDOS.join(' o ')}`);
  const snap = x['snapshot'];
  if (!esObjeto(snap)) e.push('snapshot ausente');
  else {
    if (!esUuid(snap['id'])) e.push('snapshot.id no es uuid');
    if (!textoNoVacio(snap['generado_en'])) e.push('snapshot.generado_en ausente');
    const datos = snap['datos'];
    const items = esObjeto(datos) ? datos['items'] : undefined;
    if (!Array.isArray(items) || items.length === 0) e.push('snapshot.datos.items ausente o vacío: sin datos el Fundamental no se ejecuta');
    else {
      const ids = new Set<string>();
      items.forEach((it, i) => {
        if (!esObjeto(it)) { e.push(`items[${i}] no es objeto`); return; }
        if (!textoNoVacio(it['id'])) e.push(`items[${i}].id ausente`);
        else if (ids.has(it['id'])) e.push(`items[${i}].id repetido: ${it['id']}`);
        else ids.add(it['id']);
        if (!textoNoVacio(it['campo'])) e.push(`items[${i}].campo ausente`);
        if (!(esNumeroFinito(it['valor']) || textoNoVacio(it['valor']))) e.push(`items[${i}].valor debe ser número finito o texto`);
        if (!(it['unidad'] === null || typeof it['unidad'] === 'string')) e.push(`items[${i}].unidad debe ser texto o null`);
        if (!textoNoVacio(it['fuente'])) e.push(`items[${i}].fuente ausente`);
        if (!esFechaIso(it['fecha_dato'])) e.push(`items[${i}].fecha_dato inválida`);
      });
    }
  }
  const t = x['tesis_vigente'];
  if (t !== null && t !== undefined) {
    if (!esObjeto(t) || !textoNoVacio(t['texto']) || !esEntero(t['version']) || !textoNoVacio(t['origen'])) e.push('tesis_vigente inválida (texto, version, origen)');
  }
  if (e.length > 0) return { ok: false, errores: e };
  return { ok: true, valor: { ...x, tesis_vigente: t === undefined ? null : t } as unknown as SobreFundamental };
}

export interface SalidaFundamental extends Obj {
  contrato: string; agente: string; run_id: string; snapshot_id: string; ticker: string; veredicto: string;
  puntaje: number | null; confianza: number; resumen: string;
  hallazgos: { id: string; tipo: string; texto: string; evidencia: string[] }[];
  negativos: string[];
  datos_fuente: ItemDato[];
  supuestos: string[];
  invalidadores: { condicion: string; medible: boolean; umbral: { campo: string; operador: string; valor: number } | null }[];
  datos_faltantes: { campo: string; critico: boolean }[];
  subpuntajes: Record<string, number | null>;
  tesis_propuesta: { resumen: string; motores: string[]; riesgos_clave: string[] } | null;
  cambios_vs_tesis_vigente: { punto: string; estado: string }[];
}

const mismoDato = (a: Obj, b: ItemDato): boolean =>
  a['campo'] === b.campo && a['valor'] === b.valor && a['unidad'] === b.unidad && a['fuente'] === b.fuente && a['fecha_dato'] === b.fecha_dato;

export function validarSalidaFundamental(x: unknown, sobre: SobreFundamental): Validacion<SalidaFundamental> {
  const e: string[] = [];
  if (!esObjeto(x)) return { ok: false, errores: ['la salida no es un objeto'] };
  if (x['contrato'] !== CONTRATO_SALIDA) e.push(`contrato debe ser ${CONTRATO_SALIDA}`);
  if (x['agente'] !== AGENTE_FUNDAMENTAL) e.push(`agente debe ser ${AGENTE_FUNDAMENTAL}`);
  if (x['run_id'] !== sobre.run_id) e.push('run_id no coincide con el del sobre');
  if (x['snapshot_id'] !== sobre.snapshot.id) e.push('snapshot_id no coincide con el del sobre');
  if (x['ticker'] !== sobre.ticker) e.push('ticker no coincide con el del sobre');

  const veredicto = x['veredicto'];
  if (!enumDe(veredicto, VEREDICTOS_FUNDAMENTAL)) e.push(`veredicto debe ser ${VEREDICTOS_FUNDAMENTAL.join('|')}`);
  const noEval = veredicto === VEREDICTO_NO_EVALUABLE;
  const p = x['puntaje'];
  if (p === null) { if (!noEval) e.push('puntaje null solo se permite con NO_EVALUABLE'); }
  else if (!enRango(p, PUNTAJE_MIN, PUNTAJE_MAX)) e.push(`puntaje debe estar entre ${PUNTAJE_MIN} y ${PUNTAJE_MAX}`);
  if (!enRango(x['confianza'], CONFIANZA_MIN, CONFIANZA_MAX)) e.push(`confianza debe estar entre ${CONFIANZA_MIN} y ${CONFIANZA_MAX}`);
  if (!textoNoVacio(x['resumen']) || (x['resumen'] as string).length > MAX_RESUMEN) e.push(`resumen obligatorio, máximo ${MAX_RESUMEN} caracteres`);

  // datos_fuente: solo items del sobre, idénticos (el modelo no inventa ni altera cifras)
  const fuentes = new Map<string, ItemDato>(sobre.snapshot.datos.items.map(i => [i.id, i]));
  const idsFuente = new Set<string>();
  const df = x['datos_fuente'];
  if (!Array.isArray(df)) e.push('datos_fuente debe ser una lista');
  else df.forEach((d, i) => {
    if (!esObjeto(d)) { e.push(`datos_fuente[${i}] no es objeto`); return; }
    if (!textoNoVacio(d['fuente']) || !esFechaIso(d['fecha_dato'])) e.push(`datos_fuente[${i}] sin fuente o fecha_dato válida`);
    const orig = typeof d['id'] === 'string' ? fuentes.get(d['id']) : undefined;
    if (orig === undefined) e.push(`datos_fuente[${i}] cita un id que no existe en el snapshot: ${String(d['id'])}`);
    else if (!mismoDato(d, orig)) e.push(`datos_fuente[${i}] (${orig.id}) no coincide con el dato del snapshot`);
    else idsFuente.add(orig.id);
  });

  // hallazgos
  const hall = x['hallazgos'];
  if (!Array.isArray(hall)) e.push('hallazgos debe ser una lista');
  else {
    const ids = new Set<string>();
    hall.forEach((h, i) => {
      if (!esObjeto(h)) { e.push(`hallazgos[${i}] no es objeto`); return; }
      if (!textoNoVacio(h['id'])) e.push(`hallazgos[${i}].id ausente`);
      else if (ids.has(h['id'])) e.push(`hallazgos[${i}].id repetido: ${h['id']}`);
      else ids.add(h['id']);
      if (!enumDe(h['tipo'], TIPOS_HALLAZGO)) e.push(`hallazgos[${i}].tipo inválido`);
      if (!textoNoVacio(h['texto'])) e.push(`hallazgos[${i}].texto ausente`);
      const ev = h['evidencia'];
      if (!Array.isArray(ev)) e.push(`hallazgos[${i}].evidencia debe ser una lista`);
      else {
        for (const id of ev) if (typeof id !== 'string' || !idsFuente.has(id)) e.push(`hallazgos[${i}].evidencia apunta a un id que no está en datos_fuente: ${String(id)}`);
        if (typeof h['texto'] === 'string' && tieneCifra(h['texto']) && ev.length === 0) e.push(`hallazgos[${i}] cita una cifra sin evidencia`);
      }
    });
  }

  const neg = x['negativos'];
  if (!Array.isArray(neg) || neg.length === 0 || !neg.every(textoNoVacio)) e.push('negativos debe traer al menos un elemento de texto (o qué se revisó para concluir que no hay)');
  const sup = x['supuestos'];
  if (!Array.isArray(sup) || !sup.every(textoNoVacio)) e.push('supuestos debe ser una lista de textos');

  const inv = x['invalidadores'];
  if (!Array.isArray(inv)) e.push('invalidadores debe ser una lista');
  else inv.forEach((v, i) => {
    if (!esObjeto(v)) { e.push(`invalidadores[${i}] no es objeto`); return; }
    if (!textoNoVacio(v['condicion'])) e.push(`invalidadores[${i}].condicion ausente`);
    if (typeof v['medible'] !== 'boolean') e.push(`invalidadores[${i}].medible debe ser booleano`);
    const u = v['umbral'];
    if (u === null) { if (v['medible'] === true) e.push(`invalidadores[${i}] medible exige umbral`); }
    else if (!esObjeto(u) || !textoNoVacio(u['campo']) || !enumDe(u['operador'], OPERADORES_UMBRAL) || !esNumeroFinito(u['valor'])) e.push(`invalidadores[${i}].umbral inválido (campo, operador, valor)`);
  });

  const falt = x['datos_faltantes'];
  let hayCritico = false;
  if (!Array.isArray(falt)) e.push('datos_faltantes debe ser una lista');
  else falt.forEach((f, i) => {
    if (!esObjeto(f) || !textoNoVacio(f['campo']) || typeof f['critico'] !== 'boolean') e.push(`datos_faltantes[${i}] inválido (campo, critico)`);
    else if (f['critico']) hayCritico = true;
  });
  if (!noEval && hayCritico) e.push('hay datos_faltantes críticos: el veredicto debe ser NO_EVALUABLE');
  if (noEval && Array.isArray(falt) && falt.length === 0) e.push('NO_EVALUABLE exige listar datos_faltantes');

  const sub = x['subpuntajes'];
  if (!esObjeto(sub)) e.push('subpuntajes ausente');
  else for (const k of SUBPUNTAJES_FUNDAMENTAL) {
    const v = sub[k];
    if (v !== null && !enRango(v, PUNTAJE_MIN, PUNTAJE_MAX)) e.push(`subpuntajes.${k} debe ser número ${PUNTAJE_MIN}-${PUNTAJE_MAX} o null`);
    if (v === null && !noEval) e.push(`subpuntajes.${k} null solo se permite con NO_EVALUABLE`);
  }

  const tp = x['tesis_propuesta'];
  if (tp === null) { if (!noEval) e.push('tesis_propuesta null solo se permite con NO_EVALUABLE'); }
  else if (!esObjeto(tp) || !textoNoVacio(tp['resumen']) || !Array.isArray(tp['motores']) || !tp['motores'].every(textoNoVacio) || !Array.isArray(tp['riesgos_clave']) || !tp['riesgos_clave'].every(textoNoVacio)) e.push('tesis_propuesta inválida (resumen, motores, riesgos_clave)');

  const cam = x['cambios_vs_tesis_vigente'];
  if (!Array.isArray(cam)) e.push('cambios_vs_tesis_vigente debe ser una lista');
  else {
    if (sobre.tesis_vigente === null && cam.length > 0) e.push('cambios_vs_tesis_vigente debe ir vacío cuando no hay tesis vigente');
    cam.forEach((c, i) => { if (!esObjeto(c) || !textoNoVacio(c['punto']) || !enumDe(c['estado'], ESTADOS_CAMBIO_TESIS)) e.push(`cambios_vs_tesis_vigente[${i}] inválido`); });
  }

  if (recolectarTextos(x, ['datos_fuente', 'evidencia', 'id', 'run_id', 'snapshot_id', 'contrato', 'agente', 'ticker']).some(contieneOrden)) e.push('la salida contiene una instrucción de compra o venta: los agentes no emiten órdenes');
  if (e.length > 0) return { ok: false, errores: e };
  return { ok: true, valor: x as SalidaFundamental };
}
