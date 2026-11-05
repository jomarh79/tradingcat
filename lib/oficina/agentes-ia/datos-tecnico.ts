// Items del Técnico: todo lo que el modelo puede citar sale del cálculo de código (`SnapshotTecnico`). El modelo no calcula ni trae cifras propias.
// Cada item sigue la forma del Fundamental (`ItemDato`), así el Director y el validador usan las mismas reglas de evidencia.
import {
  ID_ITEM_CIERRE_DIARIO, ID_ITEM_CIERRE_SEMANAL, ID_ITEM_SOBRE_EMA200, ID_ITEM_SOBRE_SMA200, PREFIJO_ITEM_NIVEL_CAMPO, PREFIJO_ITEM_SENAL, PREFIJO_ITEM_INDICADOR,
  SENAL_CUMPLIDA, SENAL_NO_CUMPLIDA, SENAL_SIN_DATOS, UNIDAD_PORCENTAJE, UNIDAD_PRECIO, VALOR_NO, VALOR_SI,
} from './constantes';
import type { ItemDato } from './validar-fundamental';
import type { SnapshotTecnico } from '../tecnico';

/** Indicadores calculados sobre velas semanales (su fecha de dato es la de la última vela semanal). */
export const INDICADORES_SEMANALES: readonly string[] = ['sma200_semanal'];
/** Indicadores expresados en porcentaje. */
export const INDICADORES_PORCENTUALES: readonly string[] = ['volatilidad_atr14_pct'];

export function itemsDesdeSnapshotTecnico(s: SnapshotTecnico): ItemDato[] {
  const fuente = `${s.fuente}; calculado por código`;
  const fDia = s.ultima_vela_diaria === null ? s.fecha_evaluacion : s.ultima_vela_diaria.fecha;
  const fSem = s.ultima_vela_semanal === null ? fDia : s.ultima_vela_semanal.fecha;
  const items: ItemDato[] = [];
  if (s.ultima_vela_diaria !== null) items.push({ id: ID_ITEM_CIERRE_DIARIO, campo: ID_ITEM_CIERRE_DIARIO, valor: Number(s.ultima_vela_diaria.cierre), unidad: UNIDAD_PRECIO, fuente, fecha_dato: fDia });
  if (s.ultima_vela_semanal !== null) items.push({ id: ID_ITEM_CIERRE_SEMANAL, campo: ID_ITEM_CIERRE_SEMANAL, valor: Number(s.ultima_vela_semanal.cierre), unidad: UNIDAD_PRECIO, fuente, fecha_dato: fSem });
  for (const [k, v] of Object.entries(s.indicadores)) {
    if (typeof v !== 'number' || !isFinite(v)) continue;
    items.push({
      id: `${PREFIJO_ITEM_INDICADOR}${k}`, campo: k, valor: v, unidad: INDICADORES_PORCENTUALES.includes(k) ? UNIDAD_PORCENTAJE : null, fuente,
      fecha_dato: INDICADORES_SEMANALES.includes(k) ? fSem : fDia,
    });
  }
  const bandera = (id: string, v: boolean | null, fecha: string): void => {
    if (v !== null) items.push({ id, campo: id, valor: v ? VALOR_SI : VALOR_NO, unidad: null, fuente, fecha_dato: fecha });
  };
  bandera(ID_ITEM_SOBRE_EMA200, s.cierre_sobre_ema200_diaria, fDia);
  bandera(ID_ITEM_SOBRE_SMA200, s.cierre_sobre_sma200_semanal, fSem);
  for (const g of s.senales) {
    items.push({ id: `${PREFIJO_ITEM_SENAL}${g.id}`, campo: g.id, valor: g.cumplida === null ? SENAL_SIN_DATOS : g.cumplida ? SENAL_CUMPLIDA : SENAL_NO_CUMPLIDA, unidad: null, fuente, fecha_dato: fDia });
  }
  for (const n of s.niveles_calculados) {
    items.push({ id: n.id, campo: `${PREFIJO_ITEM_NIVEL_CAMPO}${n.tipo}`, valor: Number(n.precio), unidad: UNIDAD_PRECIO, fuente, fecha_dato: n.fecha_origen ?? fDia });
  }
  return items;
}
