// v0.64: velas diarias CERRADAS con la misma regla que el Técnico (calendario NYSE + margen, `confirmarCierreVelas`).
// Antes la ficha, la valuación y la revisión descartaban siempre la vela de la fecha de hoy: después del cierre del mercado quedaban un día atrasadas
// frente al Técnico y al Auditor (PH: 4.86% con el cierre del día anterior y 5.39% con el de hoy). Ahora todos toman la misma última vela cerrada.
import { confirmarCierreVelas } from '../orquestador/cierre-velas';
import { ZONA_OFICINA, fechaEnZona } from '../orquestador/calendario';
import { fechaDeVela } from './ficha-propuesta';

/**
 * `evaluadoEn`: instante ISO con zona (por ejemplo `new Date().toISOString()`).
 * - Última vela `confirmada` (el mercado ya cerró esa sesión): se conservan todas.
 * - Última vela `en_formacion`: se descarta.
 * - Si la regla no puede decidir (calendario que no cubre la fecha, instante inválido, fecha incoherente): regla anterior, se descartan las velas de hoy o posteriores.
 */
export function velasDiariasCerradas<T extends { time: number; close: number }>(velas: readonly T[], evaluadoEn: string): T[] {
  const validas = velas.filter(v => Number.isFinite(v.close) && v.close > 0);
  const ultima = validas[validas.length - 1];
  if (ultima === undefined) return [];
  const antiguaRegla = (): T[] => {
    const t = new Date(evaluadoEn);
    const hoy = Number.isNaN(t.getTime()) ? null : fechaEnZona(t, ZONA_OFICINA);
    return hoy === null ? validas.slice(0, -1) : validas.filter(v => fechaDeVela(v.time) < hoy);
  };
  const r = confirmarCierreVelas({ mercado: 'US', evaluado_en: evaluadoEn, diaria: { fecha: fechaDeVela(ultima.time) }, semanal: null });
  if (r.diaria.estado === 'confirmada') return validas;
  if (r.diaria.estado === 'en_formacion') return validas.slice(0, -1);
  return antiguaRegla();
}
