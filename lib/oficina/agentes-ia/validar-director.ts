// Validación del contexto de entrada y de la salida `integracion.v1` del Director IA (contrato del Director, secciones 2.1 a 2.4).
// Código puro. El Director integra y explica; no decide, no recomienda operar y no calcula.
// [PROPUESTA] Las referencias a hallazgos van como `agente:id_hallazgo` (por ejemplo `fundamental:h3`), igual que `hallazgos_negativos_ids`.
import {
  AGENTE_DIRECTOR_IA, CONFIANZA_MAX, CONFIANZA_MIN, CONTRATO_INTEGRACION, ESTADOS_TESIS_DIRECTOR, ESTADO_TESIS_PROPUESTA, MAX_REFS_EN_MENSAJE, MAX_RESUMEN, TOPE_CONFIANZA_CON_FALTANTES,
  OPERADORES_UMBRAL, RECOMENDACIONES_MOTOR, RECOMENDACION_CONTINUAR, TIPO_HALLAZGO_NEGATIVO, VEREDICTOS_AUDITOR_CON_BLOQUEO,
} from './constantes';
import {
  canonCifra, cifrasDe, cifrasEnTexto, contieneOrden, enRango, enumDe, esNumeroFinito, esObjeto, recolectarTextos, textoNoVacio,
} from './utilidades';
import type { Obj } from './utilidades';
import type { Validacion } from './validar-fundamental';
import { esUuid } from '../orquestador/persistencia';
import { normalizarVeredicto } from '../motor/motor';
import type { Agente, TipoEvaluacion } from '../motor/tipos';
import { TIPOS_EVALUACION } from '../motor/tipos';

export const AGENTES_CONOCIDOS: readonly Agente[] = ['fundamental', 'valuacion', 'tecnico', 'riesgo_capital'];
const PORTAFOLIOS = ['PMP', 'PCP', 'PLP', 'ETF', 'SEMILLA'] as const;

export interface ContextoDirectorValido {
  run_id: string; snapshot_id: string; ticker: string; mercado: string; portafolio_codigo: string; tipo_evaluacion: TipoEvaluacion;
  salidas_analistas: Partial<Record<Agente, Obj>>;
  auditoria: { veredicto: string; reglas_revisadas: string[] } | null;
  reglas_versiones_ids: string[];
  contexto: unknown;
}

export function validarContextoDirector(x: unknown): Validacion<ContextoDirectorValido> {
  const e: string[] = [];
  if (!esObjeto(x)) return { ok: false, errores: ['el contexto no es un objeto'] };
  if (!esUuid(x['run_id'])) e.push('run_id no es uuid');
  if (!esUuid(x['snapshot_id'])) e.push('snapshot_id no es uuid');
  if (!textoNoVacio(x['ticker'])) e.push('ticker ausente');
  if (!textoNoVacio(x['mercado'])) e.push('mercado ausente');
  if (!enumDe(x['portafolio_codigo'], PORTAFOLIOS)) e.push('portafolio_codigo inválido');
  if (!enumDe(x['tipo_evaluacion'], TIPOS_EVALUACION)) e.push('tipo_evaluacion inválido');
  const sa = x['salidas_analistas'];
  if (!esObjeto(sa) || Object.keys(sa).length === 0) e.push('el Director necesita al menos la salida validada de un analista');
  else for (const k of Object.keys(sa)) {
    const s = sa[k];
    if (!enumDe(k, AGENTES_CONOCIDOS)) e.push(`analista desconocido: ${k}`);
    else if (!esObjeto(s) || s['agente'] !== k || !textoNoVacio(s['veredicto']) || !Array.isArray(s['hallazgos']) || !Array.isArray(s['datos_fuente'])) e.push(`la salida de ${k} no tiene la forma validada (agente, veredicto, hallazgos, datos_fuente)`);
  }
  const au = x['auditoria'];
  if (au !== null && au !== undefined && (!esObjeto(au) || !textoNoVacio(au['veredicto']) || !Array.isArray(au['reglas_revisadas']))) e.push('auditoria inválida (veredicto, reglas_revisadas)');
  if (!Array.isArray(x['reglas_versiones_ids'])) e.push('reglas_versiones_ids debe ser una lista');
  if (e.length > 0) return { ok: false, errores: e };
  return { ok: true, valor: { ...x, auditoria: au ?? null, contexto: x['contexto'] ?? null } as unknown as ContextoDirectorValido };
}

const ref = (agente: string, id: string): string => `${agente}:${id}`;

/** Cifras que el Director puede citar: las que ya están en los análisis, en la auditoría o en el contexto entregado. */
function cifrasPermitidas(ctx: ContextoDirectorValido): Set<string> {
  const set = new Set<string>();
  const agregar = (t: string): void => { for (const c of cifrasDe(t)) set.add(canonCifra(c)); };
  for (const k of Object.keys(ctx.salidas_analistas)) {
    const s = ctx.salidas_analistas[k as Agente];
    for (const t of recolectarTextos(s, ['id', 'evidencia'])) agregar(t);
    for (const d of (s?.['datos_fuente'] as unknown[] | undefined) ?? []) if (esObjeto(d) && esNumeroFinito(d['valor'])) set.add(canonCifra(String(d['valor'])));
    for (const f of [s?.['puntaje'], s?.['confianza']]) if (esNumeroFinito(f)) set.add(canonCifra(String(f)));
  }
  agregar(JSON.stringify(ctx.auditoria));
  agregar(JSON.stringify(ctx.contexto));
  return set;
}

export function validarSalidaDirector(x: unknown, ctx: ContextoDirectorValido): Validacion<Obj> {
  const e: string[] = [];
  if (!esObjeto(x)) return { ok: false, errores: ['la salida no es un objeto'] };
  if (x['contrato'] !== CONTRATO_INTEGRACION) e.push(`contrato debe ser ${CONTRATO_INTEGRACION}`);
  if (x['agente'] !== AGENTE_DIRECTOR_IA) e.push(`agente debe ser ${AGENTE_DIRECTOR_IA}`);
  if (x['run_id'] !== ctx.run_id) e.push('run_id no coincide');
  if (x['snapshot_id'] !== ctx.snapshot_id) e.push('snapshot_id no coincide');
  if (x['ticker'] !== ctx.ticker) e.push('ticker no coincide');
  if (x['portafolio_codigo'] !== ctx.portafolio_codigo) e.push('portafolio_codigo no coincide');
  if (x['tipo_evaluacion'] !== ctx.tipo_evaluacion) e.push('tipo_evaluacion no coincide');
  if (!textoNoVacio(x['resumen']) || (x['resumen'] as string).length > MAX_RESUMEN) e.push(`resumen obligatorio, máximo ${MAX_RESUMEN} caracteres`);

  // hallazgos disponibles: referencias agente:id
  const todas = new Set<string>();
  const negativas = new Set<string>();
  const agentesPresentes = Object.keys(ctx.salidas_analistas);
  for (const k of agentesPresentes) {
    for (const h of (ctx.salidas_analistas[k as Agente]?.['hallazgos'] as unknown[]) ?? []) {
      if (!esObjeto(h) || typeof h['id'] !== 'string') continue;
      todas.add(ref(k, h['id']));
      if (h['tipo'] === TIPO_HALLAZGO_NEGATIVO) negativas.add(ref(k, h['id']));
    }
  }
  const refsValidas = (lista: unknown, campo: string): void => {
    if (!Array.isArray(lista)) { e.push(`${campo}.evidencia debe ser una lista`); return; }
    for (const r of lista) {
      if (typeof r === 'string' && todas.has(r)) continue;
      const validas = Array.from(todas).slice(0, MAX_REFS_EN_MENSAJE);
      e.push(`${campo} cita una referencia inexistente: ${String(r)} (el formato es agente:id, por ejemplo ${validas[0] ?? 'fundamental:h1'}; referencias válidas: ${validas.length === 0 ? 'ninguna' : validas.join(', ')})`);
    }
  };

  const integ = x['integracion'];
  let contradicciones: unknown[] = [];
  if (!esObjeto(integ)) e.push('integracion ausente');
  else {
    for (const campo of ['coincidencias', 'contradicciones', 'no_comparables', 'discrepancias_con_auditoria'] as const) {
      if (!Array.isArray(integ[campo])) e.push(`integracion.${campo} debe ser una lista`);
    }
    (Array.isArray(integ['coincidencias']) ? integ['coincidencias'] : []).forEach((c, i) => {
      if (!esObjeto(c) || !textoNoVacio(c['texto'])) e.push(`coincidencias[${i}] inválida`); else refsValidas(c['evidencia'], `coincidencias[${i}]`);
    });
    contradicciones = Array.isArray(integ['contradicciones']) ? integ['contradicciones'] : [];
    contradicciones.forEach((c, i) => {
      if (!esObjeto(c) || !textoNoVacio(c['texto']) || !Array.isArray(c['entre']) || c['entre'].length < 2 || !c['entre'].every(a => typeof a === 'string' && agentesPresentes.includes(a))) e.push(`contradicciones[${i}] inválida (texto, entre ≥ 2 analistas presentes)`);
      else refsValidas(c['evidencia'], `contradicciones[${i}]`);
    });
    (Array.isArray(integ['no_comparables']) ? integ['no_comparables'] : []).forEach((c, i) => { if (!esObjeto(c) || !textoNoVacio(c['texto']) || !textoNoVacio(c['motivo'])) e.push(`no_comparables[${i}] inválido (texto, motivo)`); });
    (Array.isArray(integ['discrepancias_con_auditoria']) ? integ['discrepancias_con_auditoria'] : []).forEach((c, i) => { if (!esObjeto(c) || !textoNoVacio(c['regla']) || !textoNoVacio(c['texto'])) e.push(`discrepancias_con_auditoria[${i}] inválida (regla, texto)`); });
  }

  // 4. veredictos normalizados opuestos sin contradicción declarada
  const norm = agentesPresentes.map(k => normalizarVeredicto(k as Agente, String(ctx.salidas_analistas[k as Agente]?.['veredicto'])));
  if (norm.includes('FAVORABLE') && norm.includes('DESFAVORABLE') && contradicciones.length === 0) e.push('hay veredictos opuestos (FAVORABLE y DESFAVORABLE) y contradicciones está vacío');

  // 3. todos los hallazgos negativos presentes
  const ids = x['hallazgos_negativos_ids'];
  if (!Array.isArray(ids) || !ids.every(i => typeof i === 'string')) e.push('hallazgos_negativos_ids debe ser una lista de textos');
  else {
    const dados = new Set(ids as string[]);
    negativas.forEach(n => { if (!dados.has(n)) e.push(`hallazgos_negativos_ids omite un hallazgo negativo: ${n}`); });
    dados.forEach(d => { if (!negativas.has(d)) e.push(`hallazgos_negativos_ids incluye una referencia que no es un hallazgo negativo existente: ${d}`); });
  }

  // 5. negativos
  const neg = x['negativos'];
  if (!Array.isArray(neg) || neg.length === 0 || !neg.every(textoNoVacio)) e.push('negativos debe traer al menos un elemento de texto');
  const rp = x['riesgos_principales'];
  if (!Array.isArray(rp) || !rp.every(textoNoVacio)) e.push('riesgos_principales debe ser una lista de textos');
  if (!Array.isArray(x['datos_faltantes']) || !(x['datos_faltantes'] as unknown[]).every(textoNoVacio)) e.push('datos_faltantes debe ser una lista de textos');

  // 7. tesis
  const t = x['tesis'];
  if (!esObjeto(t) || !enumDe(t['estado'], ESTADOS_TESIS_DIRECTOR) || typeof t['pendiente_autorizacion'] !== 'boolean' || !(t['propuesta'] === null || textoNoVacio(t['propuesta']))) e.push('tesis inválida (estado, propuesta texto o null, pendiente_autorizacion)');
  else {
    if (t['propuesta'] !== null && t['pendiente_autorizacion'] !== true) e.push('un cambio de tesis propuesto debe quedar con pendiente_autorizacion = true');
    if (t['propuesta'] !== null && t['estado'] !== ESTADO_TESIS_PROPUESTA) e.push(`con propuesta de tesis el estado debe ser ${ESTADO_TESIS_PROPUESTA}`);
    if (t['propuesta'] === null && t['estado'] === ESTADO_TESIS_PROPUESTA) e.push(`estado ${ESTADO_TESIS_PROPUESTA} exige texto en propuesta`);
  }

  const cc = x['condicion_que_cambiaria_la_conclusion'];
  if (!esObjeto(cc) || !textoNoVacio(cc['texto']) || typeof cc['medible'] !== 'boolean') e.push('condicion_que_cambiaria_la_conclusion inválida (texto, medible, umbral)');
  else {
    const u = cc['umbral'];
    if (u === null) { if (cc['medible'] === true) e.push('condicion medible exige umbral'); }
    else if (!esObjeto(u) || !textoNoVacio(u['campo']) || !enumDe(u['operador'], OPERADORES_UMBRAL) || !esNumeroFinito(u['valor'])) e.push('condicion.umbral inválido (campo, operador, valor)');
  }
  const rec = x['recomendacion_para_motor'];
  if (!enumDe(rec, RECOMENDACIONES_MOTOR)) e.push(`recomendacion_para_motor debe ser ${RECOMENDACIONES_MOTOR.join('|')}`);
  if (!enRango(x['nivel_confianza'], CONFIANZA_MIN, CONFIANZA_MAX)) e.push(`nivel_confianza debe estar entre ${CONFIANZA_MIN} y ${CONFIANZA_MAX}`);
  const nivel = x['nivel_confianza'];
  if (esNumeroFinito(nivel) && enRango(nivel, CONFIANZA_MIN, CONFIANZA_MAX)) {
    const confianzas = agentesPresentes.map(k => ctx.salidas_analistas[k as Agente]?.['confianza']).filter((c): c is number => esNumeroFinito(c));
    const minima = confianzas.length > 0 ? Math.min(...confianzas) : null;
    if (minima !== null && nivel > minima) e.push(`nivel_confianza (${String(nivel)}) no puede superar la confianza mínima de los analistas (${String(minima)})`);
    if (Array.isArray(x['datos_faltantes']) && x['datos_faltantes'].length > 0 && nivel > TOPE_CONFIANZA_CON_FALTANTES) e.push(`nivel_confianza (${String(nivel)}) no puede superar ${String(TOPE_CONFIANZA_CON_FALTANTES)} cuando hay datos_faltantes`);
  }
  if (!textoNoVacio(x['explicacion_confianza'])) e.push('explicacion_confianza ausente');

  // 8. operación presentada como viable pese a un bloqueo del Auditor, sin declarar la discrepancia
  if (ctx.auditoria !== null && (VEREDICTOS_AUDITOR_CON_BLOQUEO as readonly string[]).includes(ctx.auditoria.veredicto) && rec === RECOMENDACION_CONTINUAR) {
    const d = esObjeto(integ) && Array.isArray(integ['discrepancias_con_auditoria']) ? integ['discrepancias_con_auditoria'] : [];
    if (d.length === 0) e.push(`el Auditor emitió ${ctx.auditoria.veredicto} y la salida recomienda continuar sin declarar la discrepancia`);
  }

  // 2. cifras: solo las ya presentes en los análisis, la auditoría o el contexto (el Director no calcula)
  // Un umbral declarado en `condicion_que_cambiaria_la_conclusion` es una condición propuesta, no un dato citado: su valor puede aparecer en ese texto.
  const permitidas = cifrasPermitidas(ctx);
  const umbralDeclarado = esObjeto(cc) && esObjeto(cc['umbral']) && esNumeroFinito(cc['umbral']['valor']) ? canonCifra(String(Math.abs(cc['umbral']['valor']))) : null;
  if (umbralDeclarado !== null) permitidas.add(umbralDeclarado);
  const textos = recolectarTextos(x, ['ticker', 'campo']);
  for (const tx of textos) for (const c of cifrasEnTexto(tx)) if (!c.conteo && !permitidas.has(canonCifra(c.token))) e.push(`cita una cifra que no existe en los datos de los analistas: ${c.token}`);

  // 6. órdenes
  if (textos.some(contieneOrden)) e.push('la salida contiene una instrucción de compra o venta: el Director no emite órdenes');

  if (e.length > 0) return { ok: false, errores: Array.from(new Set(e)) };
  return { ok: true, valor: x };
}
