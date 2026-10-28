// Evaluadores por regla. Cada uno recibe la regla (con su definición congelada) y la entrada, y devuelve un resultado.
// Los umbrales salen de `definicion`; aquí solo viven los nombres de claves y las constantes que la definición no trae (marcadas).
import { dec } from '../motor/decimal';
import { aDec, gananciaAnualizada, sumarAnios, textoDec } from './numeros';
import type { CompraPosicion, DatoFuente, EntradaAuditor, ReglaEntrada, ResultadoRegla, Tarea, Umbral } from './tipos';

export interface Ctx { e: EntradaAuditor; r: ReglaEntrada }
export interface Eval {
  resultado: ResultadoRegla;
  detalle: string;
  valor?: string | null;
  umbral?: Umbral | null;
  evidencia?: string[];
  motivo?: string;
  levantar?: string;
  tareas?: Tarea[];
}

/** ETF-03: "si_historial_menor_a_12_meses: no_evaluar" (la definición lo trae como texto). */
export const MESES_HISTORIAL_MINIMO_ETF = 12;
/** SEM-06 / SEM-09: la señal de banana (SEM-07) es causa válida de venta aunque SEM-06 no la liste (SEM-09: "banana_o_senal_de_salida"). [PROPUESTA] */
export const CAUSA_VENTA_BANANA = 'banana_senal_salida';
export const CAUSA_LIMITE_VIDA = 'limite_de_vida_15_anios';
export const CAUSA_CAIDA_ORDINARIA = 'caida_ordinaria';
/** Campos de datos_fuente que PMP-01 lee (los publica el Analista de Valuación y el snapshot). */
export const CAMPO_VALOR_ESTIMADO_BASE = 'valor_estimado_base';
export const CAMPO_PRECIO_ACTUAL = 'precio_actual';
export const CAMPO_HORIZONTE_MESES = 'horizonte_meses';
export const CAMPO_HISTORIAL_ANIOS = 'historial_grafico_anios';
export const CAMPO_HISTORIAL_COMPLETO = 'historial_grafico_completo';
export const CATEGORIA_NOTICIA = 'noticia';
/** Acciones que son una venta. */
export const ACCIONES_DE_VENTA = ['vender', 'reducir'] as const;

const ok = (detalle: string, x: Partial<Eval> = {}): Eval => ({ resultado: 'cumple', detalle, ...x });
const noEval = (motivo: string, detalle: string, x: Partial<Eval> = {}): Eval => ({ resultado: 'no_evaluable', motivo, detalle, ...x });
const incumple = (detalle: string, levantar: string, x: Partial<Eval> = {}): Eval => ({ resultado: 'incumple', detalle, levantar, ...x });
const noAplica = (detalle: string): Eval => ({ resultado: 'no_aplica', detalle });

const esVenta = (e: EntradaAuditor) => (ACCIONES_DE_VENTA as readonly string[]).includes(e.operacion.accion);
export const dato = (e: EntradaAuditor, campo: string): DatoFuente | null => e.datos_fuente.find((d) => d.campo === campo) ?? null;
const regla = (e: EntradaAuditor, codigo: string): ReglaEntrada | null => e.reglas_vigentes.find((x) => x.codigo === codigo) ?? null;
const texto = (v: unknown): string | null => (typeof v === 'string' || typeof v === 'number' ? String(v) : null);
const arr = (v: unknown): unknown[] | null => (Array.isArray(v) ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const strs = (v: unknown): string[] | null => { const a = arr(v); return a && a.every((x) => typeof x === 'string') ? (a as string[]) : null; };
const defInvalida = (r: ReglaEntrada, clave: string): Eval => noEval('definicion_invalida', `La definición de ${r.codigo} v${r.version_id} no trae "${clave}" válido`);
const igual = (a: string | null, b: string | null): boolean => { const x = aDec(a); const y = aDec(b); return x !== null && y !== null && x === y; };

/** Compras que cuentan para los máximos: las de la fecha de vigencia de la regla en adelante (decisión 13-oct, opción b; [PROPUESTA] el mismo día cuenta). */
export function comprasContadas(compras: CompraPosicion[], vigenteDesde: string): CompraPosicion[] {
  return compras.filter((c) => c.fecha >= vigenteDesde);
}
const sumaMontos = (cs: CompraPosicion[]): bigint | null => {
  let t = BigInt(0);
  for (const c of cs) { const m = aDec(c.monto); if (m === null) return null; t += m; }
  return t;
};

// ---------------------------------------------------------------- Montos fijos (PMP-02, PMP-03, PLP-03 parte monto, SEM-02)
function montoFijo(c: Ctx, etiqueta: string): Eval {
  const esperado = texto(c.r.definicion['monto_usd']);
  if (esperado === null || aDec(esperado) === null) return defInvalida(c.r, 'monto_usd');
  const m = c.e.operacion.monto;
  if (m === null || aDec(m) === null) return noEval('monto_no_declarado', `La operación no declara un monto válido (${etiqueta})`);
  const u = { operador: '=', valor: esperado };
  return igual(m, esperado)
    ? ok(`Monto USD ${m} = USD ${esperado} (${etiqueta})`, { valor: m, umbral: u })
    : incumple(`Monto USD ${m} ≠ USD ${esperado} (${etiqueta})`, `Proponer exactamente USD ${esperado}`, { valor: m, umbral: u });
}

// ---------------------------------------------------------------- PMP
function pmp01(c: Ctx): Eval {
  const { e, r } = c;
  const umbralTxt = texto(r.definicion['umbral']);
  const horizonteDef = r.definicion['horizonte_meses'];
  const decimalesDef = r.definicion['redondeo_decimales'];
  const umbral = aDec(umbralTxt);
  if (umbral === null) return defInvalida(r, 'umbral');
  if (typeof horizonteDef !== 'number' || !Number.isInteger(horizonteDef) || horizonteDef <= 0) return defInvalida(r, 'horizonte_meses');
  if (typeof decimalesDef !== 'number' || !Number.isInteger(decimalesDef) || decimalesDef < 0 || decimalesDef > 3) return defInvalida(r, 'redondeo_decimales');
  const dv = dato(e, CAMPO_VALOR_ESTIMADO_BASE);
  const dp = dato(e, CAMPO_PRECIO_ACTUAL);
  const dh = dato(e, CAMPO_HORIZONTE_MESES);
  if (!dv || !dp) return noEval('dato_faltante', `Falta ${!dv ? CAMPO_VALOR_ESTIMADO_BASE : CAMPO_PRECIO_ACTUAL} en datos_fuente`);
  const ev = [dv.id, dp.id, ...(dh ? [dh.id] : [])];
  if (!dh || Number(dh.valor) !== horizonteDef) {
    return noEval('horizonte_distinto', `El análisis de Valuación usa un horizonte de ${dh ? String(dh.valor) : 'ningún'} meses; PMP-01 exige ${horizonteDef}`, { evidencia: ev });
  }
  const v = aDec(dv.valor);
  const p = aDec(dp.valor);
  if (v === null || p === null || v <= BigInt(0) || p <= BigInt(0)) return noEval('dato_invalido', 'valor_estimado_base y precio_actual deben ser números positivos', { evidencia: ev });
  const g = gananciaAnualizada(v, p, horizonteDef, umbral, decimalesDef);
  const u = { operador: '>', valor: umbralTxt! };
  return g.supera
    ? ok(`Ganancia anualizada ${g.porcentaje_redondeado}% > ${umbralTxt}%`, { valor: g.porcentaje_redondeado, umbral: u, evidencia: ev })
    : { resultado: 'incumple', detalle: `Ganancia anualizada ${g.porcentaje_redondeado}% no supera ${umbralTxt}% (exactamente el umbral no cumple)`, valor: g.porcentaje_redondeado, umbral: u, evidencia: ev, levantar: 'Buscar otra candidata o esperar un precio con ganancia anualizada mayor al umbral' };
}

function pmp04(c: Ctx): Eval {
  const roles = strs(c.r.definicion['roles']);
  if (!roles) return defInvalida(c.r, 'roles');
  const rol = c.e.posicion.rol;
  if (rol && roles.includes(rol)) return ok(`Rol definido: ${rol}`, { valor: rol });
  return incumple(rol ? `Rol "${rol}" no está entre ${roles.join(', ')}` : 'No hay rol definido antes de comprar', `Definir el rol (${roles.join(', ')}) antes de comprar`);
}

function pmp05(c: Ctx): Eval {
  const orden = strs(c.r.definicion['orden']);
  if (!orden) return defInvalida(c.r, 'orden');
  // [PROPUESTA] En una recompra no se exige la ganancia anualizada: el 14% no aplica a recompras (PMP-01).
  const requeridos = c.e.tipo_evaluacion === 'recompra' ? orden.filter((x) => x !== 'ganancia_anualizada') : orden;
  const faltan = requeridos.filter((x) => !c.e.datos.analisis_presentes.includes(x));
  return faltan.length === 0
    ? ok(`Análisis completos: ${requeridos.join(', ')}`)
    : noEval('analisis_faltantes', `Faltan análisis requeridos: ${faltan.join(', ')}`);
}

function pmp09(c: Ctx): Eval {
  const apartados = strs(c.r.definicion['apartados']);
  if (!apartados) return defInvalida(c.r, 'apartados');
  const ficha = c.e.datos.ficha_pmp;
  const faltan = apartados.filter((a) => !ficha || ficha[a] !== true);
  return faltan.length === 0
    ? ok('Ficha completa')
    : noEval('ficha_incompleta', `Ficha sin: ${faltan.join(', ')}`);
}

function pmp10(c: Ctx): Eval {
  const v = c.e.datos.recompra_con_analisis_propios;
  if (v === null) return noEval('dato_faltante', 'No se declara si la recompra tiene análisis propios');
  return v
    ? ok('La recompra tiene su propia evaluación')
    : incumple('Un MANTENER no autoriza la recompra: falta su propia evaluación', 'Evaluar la recompra con análisis propios');
}

// ---------------------------------------------------------------- PCP
function pcp01(c: Ctx): Eval {
  const umbralTxt = texto(c.r.definicion['umbral']);
  const umbral = aDec(umbralTxt);
  if (umbral === null) return defInvalida(c.r, 'umbral');
  const da = dato(c.e, CAMPO_HISTORIAL_ANIOS);
  const dc = dato(c.e, CAMPO_HISTORIAL_COMPLETO);
  const ev = [...(da ? [da.id] : []), ...(dc ? [dc.id] : [])];
  const anios = da ? aDec(da.valor) : null;
  if (anios === null) return noEval('dato_faltante', 'Falta el historial del gráfico en años', { evidencia: ev });
  const u = { operador: '>=', valor: umbralTxt! };
  if (anios >= umbral) return ok(`Historial de ${textoDec(anios)} años ≥ ${umbralTxt}`, { valor: textoDec(anios), umbral: u, evidencia: ev });
  if (dc && dc.valor === true) {
    return incumple(`Historial de ${textoDec(anios)} años < ${umbralTxt} y la fuente devolvió todo lo que existe`, 'Esperar a que la empresa acumule el historial mínimo', { valor: textoDec(anios), umbral: u, evidencia: ev });
  }
  return noEval('fuente_truncada', `La fuente devolvió ${textoDec(anios)} años y no confirma que sea todo lo que existe`, { valor: textoDec(anios), umbral: u, evidencia: ev });
}

function contadasODeclarar(e: EntradaAuditor, desde: string): { contadas: CompraPosicion[]; total: number } | null {
  if (e.tipo_evaluacion === 'nueva_posicion') return { contadas: [], total: 0 };
  if (e.posicion.compras === null) return null;
  return { contadas: comprasContadas(e.posicion.compras, desde), total: e.posicion.compras.length };
}

function pcp02(c: Ctx): Eval {
  const lista = arr(c.r.definicion['compras']);
  if (!lista) return defInvalida(c.r, 'compras');
  const cc = contadasODeclarar(c.e, c.r.vigente_desde);
  if (!cc) return noEval('compras_no_declaradas', 'No se declaran las compras de la posición');
  const n = cc.contadas.length + 1; // [PROPUESTA 3.7, aprobada] reinicia en 1 con la primera compra desde la vigencia
  const fila = lista.map(obj).find((x) => x && x['n'] === n);
  const m = c.e.operacion.monto;
  if (m === null || aDec(m) === null) return noEval('monto_no_declarado', 'La operación no declara un monto válido');
  if (!fila) return incumple(`No existe monto definido para la compra ${n}`, 'No proponer más compras en esta posición', { valor: m });
  const esperado = texto(fila['monto_usd']);
  const u = { operador: '=', valor: esperado ?? '' };
  return igual(m, esperado)
    ? ok(`Compra ${n}: USD ${m} = USD ${esperado}`, { valor: m, umbral: u })
    : incumple(`Compra ${n}: USD ${m} ≠ USD ${esperado}`, `Proponer USD ${esperado} para la compra ${n}`, { valor: m, umbral: u });
}

function pcp03(c: Ctx): Eval {
  const maxCompras = c.r.definicion['max_compras'];
  const maxInv = texto(c.r.definicion['max_invertido_usd']);
  if (typeof maxCompras !== 'number' || aDec(maxInv) === null) return defInvalida(c.r, 'max_compras / max_invertido_usd');
  const cc = contadasODeclarar(c.e, c.r.vigente_desde);
  if (!cc) return noEval('compras_no_declaradas', 'No se declaran las compras de la posición');
  const acumulado = sumaMontos(cc.contadas);
  const m = aDec(c.e.operacion.monto);
  if (acumulado === null) return noEval('dato_invalido', 'Una compra de la posición trae un monto inválido');
  if (m === null) return noEval('monto_no_declarado', 'La operación no declara un monto válido');
  const nueva = cc.contadas.length + 1;
  const total = acumulado + m;
  const nota = cc.total > cc.contadas.length ? ` (${cc.total - cc.contadas.length} compra(s) anteriores a la vigencia no cuentan)` : '';
  const u = { operador: '<=', valor: `${maxCompras} compras y USD ${maxInv}` };
  if (nueva > maxCompras) return incumple(`Sería la compra ${nueva}; el máximo es ${maxCompras}${nota}`, 'No proponer más compras en esta posición', { valor: String(nueva), umbral: u });
  if (total > dec(maxInv!)) return incumple(`Invertido USD ${textoDec(total)} > USD ${maxInv}${nota}`, 'No exceder el máximo invertido por posición', { valor: textoDec(total), umbral: u });
  return ok(`Compra ${nueva} de ${maxCompras}; invertido USD ${textoDec(total)} ≤ USD ${maxInv}${nota}`, { valor: textoDec(total), umbral: u });
}

function pcp05(c: Ctx): Eval {
  const tabla = obj(c.r.definicion['por_numero_de_compras']);
  if (!tabla) return defInvalida(c.r, 'por_numero_de_compras');
  if (!esVenta(c.e)) return ok('No hay venta propuesta');
  const compras = c.e.posicion.compras;
  if (compras === null) return noEval('compras_no_declaradas', 'No se declaran las compras de la posición');
  const vp = c.e.posicion.ventas_previas;
  if (vp === null) return noEval('ventas_previas_no_declaradas', 'No se declara cuántas ventas parciales se han hecho');
  const plan = arr(tabla[String(compras.length)]);
  if (!plan) return noEval('numero_de_compras_sin_plan', `No hay plan de salida para ${compras.length} compra(s)`);
  const esperado = texto(plan[vp]);
  if (esperado === null) return incumple('La salida ya se completó según el plan', 'No proponer más ventas');
  const p = c.e.operacion.porcentaje_venta;
  if (p === null || aDec(p) === null) return noEval('porcentaje_no_declarado', 'La venta no declara su porcentaje');
  const u = { operador: '=', valor: esperado };
  return igual(p, esperado)
    ? ok(`Venta ${vp + 1} de ${plan.length}: ${p}% = ${esperado}%`, { valor: p, umbral: u })
    : incumple(`Con ${compras.length} compra(s) la venta ${vp + 1} debe ser ${esperado}% y se propone ${p}%`, `Proponer ${esperado}%`, { valor: p, umbral: u });
}

function pcp06(c: Ctx): Eval {
  if (!esVenta(c.e)) return ok('No hay venta propuesta');
  const compras = c.e.posicion.compras;
  const vp = c.e.posicion.ventas_previas;
  if (compras === null || vp === null) return noEval('dato_faltante', 'Faltan las compras o las ventas previas de la posición');
  if (compras.length < 2 || vp !== 0) return ok('La salida depende de la señal de salida (delegada al Técnico)');
  const costo = c.e.posicion.costo_promedio_ponderado;
  const precio = c.e.operacion.precio;
  if (aDec(costo) === null || aDec(precio) === null) return noEval('dato_faltante', 'Falta el costo promedio ponderado o el precio de la venta');
  const u = { operador: '>', valor: costo! };
  return aDec(precio)! > aDec(costo)!
    ? ok(`Primer parcial: precio ${precio} > costo promedio ${costo}`, { valor: precio, umbral: u })
    : incumple(`Primer parcial con precio ${precio} ≤ costo promedio ponderado ${costo}`, 'Esperar a que el precio supere el costo promedio ponderado', { valor: precio, umbral: u });
}

function pcp07(c: Ctx): Eval {
  const { e } = c;
  const plan = e.posicion.plan_pcp;
  if (plan === null) return noEval('plan_no_declarado', 'La posición no declara su plan (una compra o escalonado)');
  if (e.tipo_evaluacion === 'recompra' && plan === 'una_compra') {
    return incumple('El plan de una compra no admite recompras', 'Declarar un plan escalonado al abrir (no aplica a una posición ya abierta con plan de una compra)');
  }
  if (e.tipo_evaluacion === 'posicion_abierta' && esVenta(e) && e.operacion.motivo_venta === 'stop' && plan === 'escalonado') {
    return incumple('En un plan escalonado el stop marca una zona de posible recompra, no una venta', 'Evaluar la recompra o vender por una señal de salida');
  }
  return ok(`Plan declarado: ${plan}`);
}

// ---------------------------------------------------------------- PLP
function pasaUniverso(e: EntradaAuditor): { tickers: string[] } | Eval {
  const plp02 = regla(e, 'PLP-02');
  const tk = plp02 ? strs(plp02.definicion['tickers']) : null;
  if (!tk) return noEval('universo_no_disponible', 'No hay universo cerrado (PLP-02) en las reglas congeladas');
  return { tickers: tk };
}

function plp01(c: Ctx): Eval {
  const s = c.e.contexto_portafolio.sustitucion_autorizada;
  if (!s) return noAplica('Solo aplica en una sustitución autorizada');
  const revisar = strs(c.r.definicion['revisar']);
  if (!revisar) return defInvalida(c.r, 'revisar');
  const faltan = revisar.filter((x) => !c.e.datos.analisis_presentes.includes(x));
  return faltan.length === 0 ? ok(`Revisión completa: ${revisar.join(', ')}`) : noEval('analisis_faltantes', `Faltan análisis de la sustitución: ${faltan.join(', ')}`);
}

function plp02(c: Ctx): Eval {
  const { e, r } = c;
  const sus = obj(r.definicion['sustitucion']);
  const max = r.definicion['max_posiciones'];
  if (!sus || typeof max !== 'number') return defInvalida(r, 'sustitucion / max_posiciones');
  const s = e.contexto_portafolio.sustitucion_autorizada;
  const valida = s !== null && sus['permitida'] === true && s.regla === sus['origen'] && s.autorizacion_id.trim() !== '';
  if (!valida) {
    return incumple(`Abrir ${e.ticker} está bloqueado: universo cerrado de ${max} posiciones y no hay una sustitución con autorización registrada`,
      `Registrar tu autorización expresa de una sustitución (origen ${String(sus['origen'])})`);
  }
  const abiertas = e.contexto_portafolio.posiciones_abiertas;
  if (abiertas === null) return noEval('posiciones_abiertas_no_declaradas', 'No se declara el número de posiciones abiertas');
  return abiertas + 1 <= max
    ? ok(`Sustitución autorizada (${s!.autorizacion_id}); quedarían ${abiertas + 1} de ${max} posiciones`)
    : incumple(`La sustitución dejaría ${abiertas + 1} posiciones; el máximo es ${max}`, 'Vender primero la posición sustituida');
}

function plp03(c: Ctx): Eval {
  const u = pasaUniverso(c.e);
  if ('resultado' in u) return u;
  const instr = c.e.operacion.instrumento_destino ?? c.e.ticker;
  if (!u.tickers.includes(instr)) return incumple(`${instr} no pertenece al universo del PLP`, 'Operar solo tickers del universo del PLP');
  return montoFijo(c, 'PLP-03');
}

// ---------------------------------------------------------------- SEMILLA
function sem03(c: Ctx): Eval {
  const max = c.r.definicion['max_posiciones'];
  if (typeof max !== 'number') return defInvalida(c.r, 'max_posiciones');
  const n = c.e.contexto_portafolio.posiciones_abiertas;
  if (n === null) return noEval('posiciones_abiertas_no_declaradas', 'No se declara el número de posiciones abiertas');
  const u = { operador: '<=', valor: String(max) };
  return n + 1 <= max
    ? ok(`Quedarían ${n + 1} de ${max} posiciones`, { valor: String(n + 1), umbral: u })
    : incumple(`Ya hay ${n} posiciones; la ${n + 1} no se abre (máximo ${max})`, 'Esperar a una venta antes de abrir otra', { valor: String(n + 1), umbral: u });
}

function sem04(c: Ctx): Eval {
  const { origen_dinero: o, dividendo_misma_empresa: m } = c.e.operacion;
  if (o === null) return noEval('origen_dinero_no_declarado', 'No se declara el origen del dinero de la recompra');
  if (o === 'dinero_nuevo') return incumple('Recompra con dinero nuevo', 'Solo se reinvierte el dividendo de la misma empresa');
  if (m === true) return ok('Reinversión del dividendo en la misma empresa que lo pagó');
  if (m === false) return incumple('El dividendo se reinvertiría en una empresa distinta de la que lo pagó', 'Reinvertir el dividendo solo en la misma empresa');
  return noEval('dato_faltante', 'No se declara si el dividendo es de la misma empresa');
}

function sem05(c: Ctx): Eval {
  const k = c.e.datos.candidata_semilla;
  if (!k) return noEval('candidata_no_declarada', 'No hay datos de la candidata de Semilla');
  const fallos: string[] = [];
  const faltan: string[] = [];
  if (k.empresa_operativa === false || k.spac === true) fallos.push('no es empresa operativa o es un SPAC');
  else if (k.empresa_operativa === null || k.spac === null) faltan.push('empresa operativa / SPAC');
  if (k.tesis_escrita === false || k.invalidacion_escrita === false) fallos.push('falta la tesis escrita con su invalidación');
  else if (k.tesis_escrita === null || k.invalidacion_escrita === null) faltan.push('tesis escrita / invalidación');
  if (k.fecha_ipo === null) faltan.push('fecha de IPO');
  if (fallos.length > 0) return incumple(`No cumple: ${fallos.join('; ')}`, 'Elegir otra candidata');
  if (faltan.length > 0) return noEval('dato_faltante', `Faltan datos de la candidata: ${faltan.join(', ')}`);
  return ok('Operativa sin SPAC, tesis con invalidación y fecha de IPO declarada');
}

function sem06(c: Ctx): Eval {
  const { e, r } = c;
  if (!esVenta(e)) return ok('No hay venta propuesta');
  const causas = strs(r.definicion['causas_validas']);
  const vida = r.definicion['limite_de_vida_anios'];
  if (!causas || typeof vida !== 'number') return defInvalida(r, 'causas_validas / limite_de_vida_anios');
  const motivo = e.operacion.motivo_venta;
  if (motivo === null) return noEval('motivo_no_declarado', 'La venta no declara su causa');
  if (motivo === CAUSA_CAIDA_ORDINARIA) return incumple('Una caída ordinaria no es causa de venta', 'Vender solo por una causa válida de SEM-06 o por la señal de SEM-07');
  if (motivo === CAUSA_LIMITE_VIDA) {
    const fa = e.posicion.fecha_apertura;
    if (!fa) return noEval('fecha_apertura_no_declarada', 'Falta la fecha de apertura para verificar el límite de vida');
    const limite = sumarAnios(fa, vida);
    return e.fecha_evaluacion >= limite
      ? ok(`Límite de vida cumplido (${limite})`)
      : incumple(`El límite de vida de ${vida} años se cumple el ${limite}`, `Esperar al ${limite}`);
  }
  if (motivo === CAUSA_VENTA_BANANA || causas.includes(motivo)) return ok(`Causa válida: ${motivo}`);
  return incumple(`"${motivo}" no es una causa válida de venta`, 'Vender solo por una causa válida de SEM-06 o por la señal de SEM-07');
}

// ---------------------------------------------------------------- ETF
function etf02(c: Ctx): Eval {
  const sect = obj(c.r.definicion['sectoriales']);
  const fond = obj(c.r.definicion['fondeados_por_flujos']);
  const a = sect ? strs(sect['tickers']) : null;
  const b = fond ? strs(fond['tickers']) : null;
  if (!a || !b) return defInvalida(c.r, 'sectoriales.tickers / fondeados_por_flujos.tickers');
  const instr = c.e.operacion.instrumento_destino ?? c.e.ticker;
  return a.includes(instr) || b.includes(instr)
    ? ok(`${instr} pertenece al universo de ETFs`)
    : incumple(`${instr} no pertenece al universo de ETFs`, 'Operar solo instrumentos del universo de ETFs');
}

function etf01(c: Ctx): Eval {
  const { e, r } = c;
  const ap = e.datos.aporte_etf;
  const avisos: string[] = [];
  if (e.contexto_portafolio.movimiento_ya_registrado === true) avisos.push('el movimiento ya está registrado (duplicado: el Motor emite NO_COMPRAR)');
  if (!ap) return avisos.length ? { resultado: 'incumple', detalle: `Advertencia: ${avisos.join('; ')}`, levantar: 'No duplicar el movimiento' } : noEval('aporte_no_declarado', 'No se declara el cálculo del aporte semanal');
  const completo = texto(r.definicion['monto_por_etf_usd']);
  const reducido = texto(r.definicion['monto_reducido_usd']);
  const permiteReducido = r.definicion['aporte_reducido'] === true;
  if (aDec(completo) === null) return defInvalida(r, 'monto_por_etf_usd');
  const esperado = ap.modo === 'completo' ? completo : ap.modo === 'reducido' ? (permiteReducido ? reducido : null) : null;
  if (ap.modo === 'reducido' && !permiteReducido) avisos.push('la versión vigente de ETF-01 no admite aporte reducido');
  if (ap.modo !== 'ninguno' && esperado !== null && !igual(e.operacion.monto, esperado)) avisos.push(`el aporte por ETF debería ser USD ${esperado} (modo ${ap.modo}) y se propone USD ${e.operacion.monto ?? 'sin monto'}`);
  if (ap.modo === 'ninguno' && e.operacion.monto !== null && aDec(e.operacion.monto) !== BigInt(0)) avisos.push('no alcanza el efectivo para ningún aporte y se propone comprar');
  return avisos.length > 0
    ? { resultado: 'incumple', detalle: `Advertencia: ${avisos.join('; ')}`, levantar: 'Ajustar el aporte al cálculo del Orquestador', ...(esperado ? { umbral: { operador: '=', valor: esperado } } : {}) }
    : ok(`Aporte consistente con el modo ${ap.modo}`);
}

// ---------------------------------------------------------------- Calendario y tareas (no emiten veredicto de operación)
const tarea = (tipo: string, regla: string, detalle: string, x: Record<string, unknown> = {}): Tarea => ({ tipo, regla, detalle, ...x });

function destinoDividendo(c: Ctx): Eval {
  const dest = texto(c.r.definicion['destino_ticker']);
  const pct = texto(c.r.definicion['porcentaje']);
  if (!dest || !pct) return defInvalida(c.r, 'destino_ticker / porcentaje');
  const d = c.e.datos.dividendo_recibido;
  if (d === null) return noEval('dividendo_no_declarado', 'No se declara si hubo dividendo');
  return d
    ? ok(`Dividendo: ${pct}% a ${dest}`, { tareas: [tarea('destino_dividendo', c.r.codigo, `${pct}% del dividendo a ${dest}`, { destino: dest, porcentaje: pct })] })
    : noAplica('Sin dividendo recibido');
}

function revisionPeriodica(c: Ctx): Eval {
  const primera = texto(c.r.definicion['primera_revision']);
  if (!primera) return defInvalida(c.r, 'primera_revision');
  return c.e.fecha_evaluacion >= primera
    ? ok(`Revisión periódica vigente desde ${primera}`, { tareas: [tarea('revision_periodica', c.r.codigo, `Revisión de fundamentales (primera: ${primera})`)] })
    : noAplica(`Antes de la primera revisión (${primera})`);
}

function etf03(c: Ctx): Eval {
  const m = c.e.datos.historial_meses_etf;
  if (m === null) return noEval('historial_no_declarado', 'No se declara el historial del ETF');
  if (m < MESES_HISTORIAL_MINIMO_ETF) return noAplica(`Historial de ${m} meses < ${MESES_HISTORIAL_MINIMO_ETF}: no se evalúa`);
  return ok('Revisión anual contra SPY', { tareas: [tarea('revision_anual_etf', c.r.codigo, 'Comparar contra SPY (rendimiento total ponderado por tiempo, 12 meses al 31-dic)')] });
}

function etf04(c: Ctx): Eval {
  const primero = texto(c.r.definicion['primer_retiro']);
  const pct = texto(c.r.definicion['retirar_pct']);
  if (!primero || !pct) return defInvalida(c.r, 'primer_retiro / retirar_pct');
  return c.e.fecha_evaluacion >= primero
    ? ok(`Retiro quinquenal vigente desde ${primero}`, { tareas: [tarea('retiro_quinquenal', c.r.codigo, `Retirar ${pct}% de cada ETF sectorial y repartir en partes iguales`)] })
    : noAplica(`Antes del primer retiro (${primero})`);
}

function pcp08(c: Ctx): Eval {
  const neto = aDec(c.e.datos.neto_mensual_pcp);
  if (c.e.datos.neto_mensual_pcp === null || neto === null) return noEval('neto_no_declarado', 'No se declara el neto mensual realizado');
  if (neto <= BigInt(0)) return ok('Neto mensual no positivo: lo absorbe PCP, sin reparto', { valor: textoDec(neto) });
  // [PROPUESTA] tercios al centavo hacia abajo para QQQ y GBTC; el remanente se queda en PCP.
  const centavos = neto / BigInt(1000000);
  const tercio = centavos / BigInt(3);
  const fmt = (c2: bigint) => `${c2 / BigInt(100)}.${(c2 % BigInt(100)).toString().padStart(2, '0')}`;
  const pcp = centavos - BigInt(2) * tercio;
  return ok(`Reparto mensual de ${textoDec(neto)}`, {
    valor: textoDec(neto),
    tareas: [tarea('reparto_mensual', c.r.codigo, `PCP ${fmt(pcp)}, QQQ ${fmt(tercio)}, GBTC ${fmt(tercio)}`, { PCP: fmt(pcp), QQQ: fmt(tercio), GBTC: fmt(tercio) })],
  });
}

function sem09(c: Ctx): Eval {
  const por = obj(c.r.definicion['por_causa']);
  if (!por) return defInvalida(c.r, 'por_causa');
  if (!esVenta(c.e)) return noAplica('Sin venta propuesta');
  const motivo = c.e.operacion.motivo_venta;
  if (motivo === null) return noEval('motivo_no_declarado', 'La venta no declara su causa');
  let destino: string;
  if (motivo === CAUSA_LIMITE_VIDA) destino = String(obj(por[CAUSA_LIMITE_VIDA])?.['destino']);
  else if (motivo === CAUSA_VENTA_BANANA) {
    const b = obj(por['banana_o_senal_de_salida']);
    const n = c.e.contexto_portafolio.posiciones_abiertas;
    destino = n !== null && n >= 52 ? String(b?.['si_52_posiciones']) : String(b?.['destino']);
  } else destino = String(obj(por['otras_causas'])?.['destino']);
  return ok(`Destino del dinero: ${destino}`, { tareas: [tarea('destino_ventas_semilla', c.r.codigo, `Destino del dinero de la venta: ${destino}`, { destino })] });
}

function sem08(c: Ctx): Eval {
  const campos = strs(c.r.definicion['campos']);
  if (!campos) return defInvalida(c.r, 'campos');
  return ok('Registro obligatorio posterior a la compra', { tareas: [tarea('registro_compra_semilla', c.r.codigo, `Registrar: ${campos.join(', ')}`, { campos })] });
}

// ---------------------------------------------------------------- Transversales y referenciales
function glb01(c: Ctx): Eval {
  const { existe, fecha_apertura } = c.e.posicion;
  if (!existe) return ok('Operación sobre una posición nueva');
  if (!fecha_apertura) return noEval('fecha_apertura_no_declarada', 'La posición existe pero no declara su fecha de apertura');
  return fecha_apertura < c.r.vigente_desde
    ? { resultado: 'anterior_a_regla', detalle: `Posición abierta el ${fecha_apertura}, anterior a la vigencia (${c.r.vigente_desde}); sin bloqueo retroactivo` }
    : ok(`Posición abierta el ${fecha_apertura}, posterior a la vigencia`);
}

function glb02(c: Ctx): Eval {
  return c.e.posicion.rol ? ok(`Rol registrado: ${c.e.posicion.rol}`) : { resultado: 'incumple', detalle: 'La posición no tiene rol registrado (no es forzoso)', levantar: 'Registrar el rol' };
}

function glb03(c: Ctx): Eval {
  const f = c.e.datos.fundamentos;
  if (!f || f.length === 0) return noEval('fundamento_no_declarado', 'No se declaran los fundamentos de la operación');
  const items = f.map((id) => c.e.datos_fuente.find((d) => d.id === id) ?? null);
  if (items.some((d) => d === null)) return noEval('fundamento_sin_dato', 'Un fundamento no existe en datos_fuente', { evidencia: f });
  if (items.some((d) => !d!.categoria)) return noEval('categoria_faltante', 'Un fundamento no trae categoría', { evidencia: f });
  return items.every((d) => d!.categoria === CATEGORIA_NOTICIA)
    ? incumple('El único fundamento de la operación es una noticia', 'Sostener la decisión en datos distintos de una noticia', { evidencia: f })
    : ok('La decisión no se apoya solo en noticias', { evidencia: f });
}

function glb05(c: Ctx): Eval {
  if (c.e.operacion.accion !== 'mover_dinero') return noAplica('No hay movimiento de dinero');
  return c.e.datos.traspaso_identificable === true
    ? ok('El traspaso está identificado y no cuenta como ganancia')
    : noEval('traspaso_no_identificable', 'No se puede distinguir el traspaso de un aporte externo');
}

function stopReferencial(c: Ctx): Eval {
  return c.e.datos.stop_tocado === true
    ? { resultado: 'incumple', detalle: 'El stop de referencia fue tocado: es solo referencia y no sugiere vender; corresponde revisión de tesis', levantar: 'Revisar la tesis' }
    : ok('El stop es solo referencia');
}

const delegada = (c: Ctx): Eval => ({
  resultado: 'delegada',
  detalle: `La evalúa: ${c.r.componente_delegado ?? 'sin componente declarado'}`,
});

export const EVALUADORES: Record<string, (c: Ctx) => Eval> = {
  'GLB-01': glb01, 'GLB-02': glb02, 'GLB-03': glb03, 'GLB-04': (c) => ok(`Portafolio declarado: ${c.e.portafolio_codigo}`), 'GLB-05': glb05,
  'PCP-01': pcp01, 'PCP-02': pcp02, 'PCP-03': pcp03, 'PCP-05': pcp05, 'PCP-06': pcp06, 'PCP-07': pcp07, 'PCP-08': pcp08,
  'PLP-01': plp01, 'PLP-02': plp02, 'PLP-03': plp03, 'PLP-05': destinoDividendo, 'PLP-09': revisionPeriodica,
  'PLP-06': stopReferencial, 'PLP-07': (c) => (c.e.datos.aumenta_peso_sectorial === true
    ? { resultado: 'incumple', detalle: 'La compra aumenta el peso de un sector (sin límites numéricos: informativo)', levantar: 'Informativo' }
    : ok('Sin aumento de concentración sectorial declarado')),
  'PLP-08': () => ok('Comunicar la recompra'),
  'PMP-01': pmp01, 'PMP-02': (c) => montoFijo(c, 'PMP-02'), 'PMP-03': (c) => montoFijo(c, 'PMP-03'), 'PMP-04': pmp04, 'PMP-05': pmp05,
  'PMP-06': destinoDividendo, 'PMP-08': stopReferencial, 'PMP-09': pmp09, 'PMP-10': pmp10, 'PMP-11': revisionPeriodica,
  'SEM-01': () => ok('Una compra semanal sin forzar: sin candidata no se compra'),
  'SEM-02': (c) => montoFijo(c, 'SEM-02'), 'SEM-03': sem03, 'SEM-04': sem04, 'SEM-05': sem05, 'SEM-06': sem06, 'SEM-07': delegada,
  'SEM-08': sem08, 'SEM-09': sem09,
  'ETF-01': etf01, 'ETF-02': etf02, 'ETF-03': etf03, 'ETF-04': etf04, 'ETF-05': () => ok('Se reporta en el Expediente'),
};

/** Evaluador genérico por clase (delegadas y declarativas no necesitan código propio). */
export function evaluadorDeRegla(r: ReglaEntrada): ((c: Ctx) => Eval) | null {
  const propio = EVALUADORES[r.codigo];
  if (propio) return propio;
  if (r.clase === 'delegada') return delegada;
  if (r.clase === 'declarativa') return () => noAplica('Garantizada por diseño');
  return null;
}
