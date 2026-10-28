// Auditor de Reglas: función pura. Mismas entradas → misma salida y mismo hash (contrato v0.2, sección 0).
import { hashSha256 } from './canonico';
import { evaluadorDeRegla } from './evaluadores';
import type { Eval } from './evaluadores';
import { REGEX_FECHA } from './numeros';
import {
  ACCIONES, AGENTE_AUDITOR, CATEGORIAS_DATO, CLASES_REGLA, CONTRATO_ENTRADA, CONTRATO_SALIDA, ErrorAuditor, MAX_CARACTERES_RESUMEN,
  PORTAFOLIOS_AUDITOR, TIPOS_EVALUACION_AUDITOR,
} from './tipos';
import type {
  AdvertenciaReferencial, DatoFaltante, EntradaAuditor, FiltroFallido, Infraccion, ReglaDelegada, ReglaEntrada, ResultadoReglaSalida,
  SalidaAuditor, Tarea, VeredictoAuditorV1,
} from './tipos';

export const MOTIVO_PORTAFOLIO_NO_DECLARADO = 'portafolio_no_declarado';
export const MOTIVO_PORTAFOLIO_SIN_REGLAS = 'portafolio_sin_reglas';
export const MOTIVO_EVALUADOR_NO_IMPLEMENTADO = 'evaluador_no_implementado';
export const CODIGO_REGLA_PORTAFOLIO = 'GLB-04';
/** Clases cuyo no_evaluable obligatorio decide el veredicto (el resto —calendario, referenciales, delegadas— solo se lista). */
const CLASES_CRITICAS = ['estructura_limite', 'filtro_elegibilidad', 'transversal'];
/** Clases cuyo incumplimiento puede ocurrir; en las demás un `incumple` es un error de código. */
const CLASES_QUE_INCUMPLEN = ['estructura_limite', 'filtro_elegibilidad', 'referencial'];

/** Valida la forma de la entrada; un problema es un error de código del llamador (la ejecución queda en error). */
export function validarEntrada(e: EntradaAuditor): string[] {
  const p: string[] = [];
  const noVacio = (v: unknown) => typeof v === 'string' && v.trim() !== '';
  if (e.contrato !== CONTRATO_ENTRADA) p.push(`contrato debe ser ${CONTRATO_ENTRADA}`);
  for (const k of ['run_id', 'snapshot_id', 'ticker', 'mercado'] as const) if (!noVacio(e[k])) p.push(`${k} vacío`);
  if (!(TIPOS_EVALUACION_AUDITOR as readonly string[]).includes(e.tipo_evaluacion)) p.push(`tipo_evaluacion desconocido: ${String(e.tipo_evaluacion)}`);
  if (!REGEX_FECHA.test(String(e.fecha_evaluacion))) p.push('fecha_evaluacion inválida');
  if (!(ACCIONES as readonly string[]).includes(e.operacion?.accion)) p.push(`operacion.accion desconocida: ${String(e.operacion?.accion)}`);
  if (e.posicion?.fecha_apertura != null && !REGEX_FECHA.test(e.posicion.fecha_apertura)) p.push('posicion.fecha_apertura inválida');
  for (const c of e.posicion?.compras ?? []) if (!REGEX_FECHA.test(c.fecha)) p.push(`compra con fecha inválida: ${c.fecha}`);
  if (!Array.isArray(e.reglas_vigentes)) { p.push('reglas_vigentes debe ser una lista'); return p; }
  const codigos = new Set<string>();
  for (const r of e.reglas_vigentes) {
    if (!noVacio(r.codigo)) { p.push('regla sin código'); continue; }
    if (codigos.has(r.codigo)) p.push(`regla duplicada: ${r.codigo}`);
    codigos.add(r.codigo);
    if (!noVacio(r.version_id)) p.push(`${r.codigo}: version_id vacío`);
    if (!(CLASES_REGLA as readonly string[]).includes(r.clase)) p.push(`${r.codigo}: clase desconocida ${String(r.clase)}`);
    if (r.caracter !== 'obligatoria' && r.caracter !== 'referencial') p.push(`${r.codigo}: carácter desconocido`);
    if (r.caracter === 'referencial' && r.clase !== 'referencial') p.push(`${r.codigo}: carácter referencial exige clase referencial`);
    if (!REGEX_FECHA.test(String(r.vigente_desde))) p.push(`${r.codigo}: vigente_desde inválida`);
    if (!r.aplica_a || !Array.isArray(r.aplica_a.portafolios) || !Array.isArray(r.aplica_a.tipos_evaluacion)) p.push(`${r.codigo}: aplica_a inválido`);
    if (r.definicion === null || typeof r.definicion !== 'object') p.push(`${r.codigo}: definicion inválida`);
  }
  const ids = new Set<string>();
  for (const d of e.datos_fuente ?? []) {
    if (!noVacio(d.id)) p.push('datos_fuente con id vacío');
    if (ids.has(d.id)) p.push(`datos_fuente con id repetido: ${d.id}`);
    ids.add(d.id);
    if (!(CATEGORIAS_DATO as readonly string[]).includes(d.categoria)) p.push(`datos_fuente ${d.id}: categoría inválida ${String(d.categoria)}`);
    if (!noVacio(d.fuente)) p.push(`datos_fuente ${d.id}: sin fuente`);
    if (!REGEX_FECHA.test(String(d.fecha_dato))) p.push(`datos_fuente ${d.id}: fecha_dato inválida`);
  }
  return p;
}

function aplica(r: ReglaEntrada, portafolio: string, tipo: string): boolean {
  const { portafolios, tipos_evaluacion } = r.aplica_a;
  return (portafolios.includes('todos') || portafolios.includes(portafolio)) && (tipos_evaluacion.includes('todos') || tipos_evaluacion.includes(tipo));
}

/** [PROPUESTA] Regla de apertura (solo nueva_posicion) de ese portafolio, evaluando una posición abierta anterior a su vigencia. */
function esAnteriorARegla(e: EntradaAuditor, r: ReglaEntrada, portafolio: string): boolean {
  const { portafolios, tipos_evaluacion } = r.aplica_a;
  const delPortafolio = portafolios.includes(portafolio);
  const soloApertura = tipos_evaluacion.length === 1 && tipos_evaluacion[0] === 'nueva_posicion';
  return delPortafolio && soloApertura && e.tipo_evaluacion === 'posicion_abierta' && e.posicion.existe
    && e.posicion.fecha_apertura !== null && e.posicion.fecha_apertura < r.vigente_desde;
}

function resultadoDe(r: ReglaEntrada, ev: Eval): ResultadoReglaSalida {
  return {
    codigo: r.codigo, version_id: r.version_id, caracter: r.caracter, clase: r.clase, resultado: ev.resultado,
    valor_observado: ev.valor ?? null, umbral: ev.umbral ?? null, detalle: ev.detalle, evidencia: ev.evidencia ?? [], motivo: ev.motivo ?? null,
    critico: ev.resultado === 'no_evaluable' && r.caracter === 'obligatoria' && CLASES_CRITICAS.includes(r.clase),
  };
}

function resumen(v: VeredictoAuditorV1, e: EntradaAuditor, res: ResultadoReglaSalida[], inf: Infraccion[], fil: FiltroFallido[], faltan: DatoFaltante[], adv: AdvertenciaReferencial[]): string {
  const evaluadas = res.filter((x) => x.resultado !== 'no_aplica' && x.resultado !== 'anterior_a_regla').length;
  const partes = [`${v} · ${e.portafolio_codigo ?? 'sin portafolio'} / ${e.tipo_evaluacion} · ${evaluadas} regla(s) evaluada(s)`];
  if (inf.length) partes.push(`infracciones: ${inf.map((x) => x.codigo).join(', ')}`);
  if (fil.length) partes.push(`filtros fallidos: ${fil.map((x) => x.codigo).join(', ')}`);
  const crit = faltan.filter((x) => x.critico);
  if (crit.length) partes.push(`datos críticos faltantes: ${crit.map((x) => `${x.codigo_regla} (${x.motivo})`).join(', ')}`);
  if (adv.length) partes.push(`advertencias: ${adv.map((x) => x.codigo).join(', ')}`);
  const t = partes.join(' · ');
  return t.length <= MAX_CARACTERES_RESUMEN ? t : t.slice(0, MAX_CARACTERES_RESUMEN - 1) + '…';
}

export function auditar(e: EntradaAuditor): SalidaAuditor {
  const problemas = validarEntrada(e);
  if (problemas.length > 0) throw new ErrorAuditor(`Entrada inválida: ${problemas.join('; ')}`);
  const hash = hashSha256(e);
  const base = { contrato: CONTRATO_SALIDA, agente: AGENTE_AUDITOR, run_id: e.run_id, snapshot_id: e.snapshot_id, hash_entrada: hash, ticker: e.ticker, portafolio_codigo: e.portafolio_codigo, tipo_evaluacion: e.tipo_evaluacion } as const;
  const vacio = { infracciones: [], filtros_fallidos: [], advertencias_referenciales: [], reglas_delegadas: [], tareas_sugeridas: [], datos_fuente: [] };
  const soloPortafolio = (motivo: string, detalle: string): SalidaAuditor => {
    const glb04 = e.reglas_vigentes.find((r) => r.codigo === CODIGO_REGLA_PORTAFOLIO);
    const resultados = motivo === MOTIVO_PORTAFOLIO_NO_DECLARADO && glb04
      ? [resultadoDe(glb04, { resultado: 'no_evaluable', motivo, detalle })] : [];
    const faltan: DatoFaltante[] = [{ codigo_regla: CODIGO_REGLA_PORTAFOLIO, motivo, detalle, critico: true }];
    return { ...base, ...vacio, veredicto: 'NO_EVALUABLE', resumen: resumen('NO_EVALUABLE', e, resultados, [], [], faltan, []), resultados_reglas: resultados, datos_faltantes: faltan };
  };
  if (e.portafolio_codigo === null || e.portafolio_codigo.trim() === '') return soloPortafolio(MOTIVO_PORTAFOLIO_NO_DECLARADO, 'La evaluación no declara su portafolio (GLB-04)');
  const portafolio = e.portafolio_codigo;
  if (!(PORTAFOLIOS_AUDITOR as readonly string[]).includes(portafolio)) return soloPortafolio(MOTIVO_PORTAFOLIO_SIN_REGLAS, `El portafolio ${portafolio} no tiene reglas`);

  const resultados: ResultadoReglaSalida[] = [];
  const tareas: Tarea[] = [];
  const delegadas: ReglaDelegada[] = [];
  const levantar = new Map<string, string>();
  for (const r of e.reglas_vigentes) {
    if (!aplica(r, portafolio, e.tipo_evaluacion)) {
      resultados.push(resultadoDe(r, esAnteriorARegla(e, r, portafolio)
        ? { resultado: 'anterior_a_regla', detalle: `Posición abierta el ${e.posicion.fecha_apertura}, anterior a la vigencia (${r.vigente_desde}); regla de apertura sin efecto retroactivo` }
        : { resultado: 'no_aplica', detalle: 'No corresponde a este portafolio o tipo de evaluación' }));
      continue;
    }
    const fn = evaluadorDeRegla(r);
    let ev: Eval;
    if (fn === null) ev = { resultado: 'no_evaluable', motivo: MOTIVO_EVALUADOR_NO_IMPLEMENTADO, detalle: `La regla ${r.codigo} no tiene evaluador registrado` };
    else {
      try { ev = fn({ e, r }); } catch (err) { throw new ErrorAuditor(`Fallo del evaluador de ${r.codigo}: ${err instanceof Error ? err.message : String(err)}`); }
    }
    if (ev.resultado === 'incumple' && !CLASES_QUE_INCUMPLEN.includes(r.clase)) throw new ErrorAuditor(`El evaluador de ${r.codigo} devolvió incumple en la clase ${r.clase}`);
    resultados.push(resultadoDe(r, ev));
    if (ev.levantar) levantar.set(r.codigo, ev.levantar);
    for (const t of ev.tareas ?? []) tareas.push(t);
    if (r.componente_delegado) {
      for (const agente of r.componente_delegado.split(',').map((s) => s.trim()).filter(Boolean)) delegadas.push({ codigo: r.codigo, agente });
    }
  }

  const infracciones: Infraccion[] = [];
  const filtros: FiltroFallido[] = [];
  const advertencias: AdvertenciaReferencial[] = [];
  const faltantes: DatoFaltante[] = [];
  for (const x of resultados) {
    if (x.resultado === 'incumple') {
      if (x.clase === 'estructura_limite') infracciones.push({ codigo: x.codigo, version_id: x.version_id, detalle: x.detalle, condicion_para_levantar: levantar.get(x.codigo) ?? 'Corregir la operación para cumplir la regla' });
      else if (x.clase === 'filtro_elegibilidad') filtros.push({ codigo: x.codigo, version_id: x.version_id, detalle: x.detalle });
      else advertencias.push({ codigo: x.codigo, version_id: x.version_id, detalle: x.detalle });
    } else if (x.resultado === 'no_evaluable') {
      faltantes.push({ codigo_regla: x.codigo, motivo: x.motivo ?? 'dato_faltante', detalle: x.detalle, critico: x.critico });
    }
  }
  // Orden de resolución (contrato, sección 4; decisión 13-oct: la infracción confirmada prevalece sobre un dato faltante).
  const veredicto: VeredictoAuditorV1 = infracciones.length > 0 ? 'BLOQUEO_REGLA'
    : filtros.length > 0 ? 'NO_ELEGIBLE'
    : faltantes.some((f) => f.critico) ? 'NO_EVALUABLE' : 'CUMPLE';
  const citados = new Set(resultados.flatMap((x) => x.evidencia));
  return {
    ...base, veredicto, resumen: resumen(veredicto, e, resultados, infracciones, filtros, faltantes, advertencias),
    resultados_reglas: resultados, infracciones, filtros_fallidos: filtros, advertencias_referenciales: advertencias,
    reglas_delegadas: delegadas, tareas_sugeridas: tareas, datos_faltantes: faltantes,
    datos_fuente: e.datos_fuente.filter((d) => citados.has(d.id)),
  };
}
