// Riesgo y Capital POR CÓDIGO (decisión 10-nov-2026: sin IA). Compara el efectivo del portafolio contra el monto declarado de la operación.
// Datos: `efectivo` de `oficina_v_capital` y el monto declarado con -Monto. No inventa nada: si falta alguno, DATOS_INSUFICIENTES y no se supone un valor.
// El Motor hace la comparación definitiva (`capital_insuficiente`); aquí solo se calcula el veredicto del agente y se arma `motor.capital`.
// Sin límites duros adicionales definidos (peso de la posición, etc.): hoy NO existen; NO_VIABLE se produce solo por efectivo insuficiente.
import { aDec, textoDec } from '../auditor/numeros';

export type VeredictoRiesgoCapital = 'VIABLE' | 'NO_VIABLE' | 'DATOS_INSUFICIENTES';

export interface EntradaRiesgoCapital { efectivo: unknown; monto: unknown }

export interface ResultadoRiesgoCapital {
  veredicto: VeredictoRiesgoCapital;
  efectivo_disponible: string | null;
  monto_requerido: string | null;
  /** Lo que falta de efectivo (solo si NO_VIABLE). */
  faltante: string | null;
  detalle: string;
}

export function calcularRiesgoCapital(e: EntradaRiesgoCapital): ResultadoRiesgoCapital {
  const ef = aDec(typeof e.efectivo === 'number' || typeof e.efectivo === 'string' ? String(e.efectivo) : null);
  const mo = aDec(typeof e.monto === 'number' || typeof e.monto === 'string' ? String(e.monto) : null);
  const efTxt = ef === null ? null : textoDec(ef);
  const moTxt = mo === null || mo <= BigInt(0) ? null : textoDec(mo);
  if (efTxt === null || moTxt === null) {
    const falta = [efTxt === null ? 'efectivo del portafolio (oficina_v_capital)' : null, moTxt === null ? 'monto de la operación (-Monto)' : null].filter(Boolean).join(' y ');
    return { veredicto: 'DATOS_INSUFICIENTES', efectivo_disponible: efTxt, monto_requerido: moTxt, faltante: null, detalle: `Falta ${falta}: no se evalúa el capital` };
  }
  if (ef! < mo!) {
    const f = textoDec(mo! - ef!);
    return { veredicto: 'NO_VIABLE', efectivo_disponible: efTxt, monto_requerido: moTxt, faltante: f, detalle: `Efectivo ${efTxt} < monto ${moTxt}: faltan ${f}` };
  }
  return { veredicto: 'VIABLE', efectivo_disponible: efTxt, monto_requerido: moTxt, faltante: null, detalle: `Efectivo ${efTxt} alcanza para el monto ${moTxt}` };
}

/** Forma de salida que exige el contexto del Director (agente, veredicto, hallazgos, datos_fuente). `fecha` = día de la corrida (AAAA-MM-DD). */
export function salidaComoAnalista(r: ResultadoRiesgoCapital, fecha: string): Record<string, unknown> {
  const datos_fuente: Record<string, unknown>[] = [];
  const evidencia: string[] = [];
  if (r.efectivo_disponible !== null) { datos_fuente.push({ id: 'rc-d1', campo: 'efectivo_disponible', valor: r.efectivo_disponible, unidad: 'USD', fuente: 'oficina_v_capital.efectivo', fecha_dato: fecha }); evidencia.push('rc-d1'); }
  if (r.monto_requerido !== null) { datos_fuente.push({ id: 'rc-d2', campo: 'monto_requerido', valor: r.monto_requerido, unidad: 'USD', fuente: 'monto declarado en la corrida (-Monto)', fecha_dato: fecha }); evidencia.push('rc-d2'); }
  const tipo = r.veredicto === 'VIABLE' ? 'positivo' : r.veredicto === 'NO_VIABLE' ? 'negativo' : 'neutral';
  return {
    agente: 'riesgo_capital', origen: 'codigo', veredicto: r.veredicto,
    efectivo_disponible: r.efectivo_disponible, monto_requerido: r.monto_requerido, faltante: r.faltante, detalle: r.detalle,
    hallazgos: [{ id: 'rc-h1', tipo, texto: r.detalle, evidencia }],
    negativos: r.veredicto === 'NO_VIABLE' ? [r.detalle] : [],
    datos_fuente,
  };
}
