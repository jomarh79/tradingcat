// Comprobación común (Técnico y Fundamental): cada cifra que el modelo escribe en el `resumen`, los `hallazgos` y los `negativos` debe coincidir con el valor de un dato que cita.
// Hasta la v0.14 solo se exigía que un hallazgo con cifra citara ALGÚN dato; no que la cifra fuera la del dato (el Técnico escribió RSI 62.01 con el dato en 62.0196, que se redondea a 62.02,
// y un ADX que no citó en ninguna parte). Código puro. Límite: una cifra que coincide por casualidad con otro dato citado no se distingue; el sentido de la frase sigue siendo revisión humana.
import { MAX_VALORES_EN_MENSAJE } from './constantes';
import { cifrasSinRespaldo, esObjeto, numerosEnTextos, textoNoVacio } from './utilidades';
import type { ItemDato } from './validar-fundamental';

/** Parámetros de indicadores y años que se escriben en los textos sin ser cifras de un dato: los dígitos de los ids, campos y fechas de los items más los valores extra (parámetros). */
export function numerosPermitidos(items: readonly ItemDato[], extra: readonly number[] = []): number[] {
  return numerosEnTextos(items.flatMap(i => [i.id, i.campo, i.fecha_dato])).concat(extra);
}

const numerico = (i: ItemDato | undefined): number[] => (i !== undefined && typeof i.valor === 'number' ? [i.valor] : []);

function pista(items: readonly (ItemDato | undefined)[]): string {
  const vistos = items.filter((i): i is ItemDato => i !== undefined && typeof i.valor === 'number').slice(0, MAX_VALORES_EN_MENSAJE);
  return vistos.length === 0 ? ' (no hay datos numéricos citados)' : ` (datos citados: ${vistos.map(i => `${i.id}=${String(i.valor)}`).join(', ')}; copia la cifra del dato, redondeada, sin truncar)`;
}

/** Errores de cifras sin respaldo. `fuentes`: items del sobre por id. `citados`: ids que la salida copió en `datos_fuente` (ya validados). */
export function erroresDeCifras(x: Record<string, unknown>, fuentes: ReadonlyMap<string, ItemDato>, citados: ReadonlySet<string>, permitidos: readonly number[]): string[] {
  const e: string[] = [];
  const todos = Array.from(citados).map(id => fuentes.get(id));
  const revisar = (campo: string, texto: unknown, items: readonly (ItemDato | undefined)[], alcance: string): void => {
    if (!textoNoVacio(texto)) return;
    const sueltas = cifrasSinRespaldo(texto, items.flatMap(numerico), permitidos);
    if (sueltas.length > 0) e.push(`${campo} cita cifras que no coinciden con ${alcance}: ${sueltas.join(', ')}${pista(items)}`);
  };
  revisar('resumen', x['resumen'], todos, 'ningún dato de datos_fuente');
  if (Array.isArray(x['hallazgos'])) {
    x['hallazgos'].forEach((h, i) => {
      if (!esObjeto(h) || !Array.isArray(h['evidencia'])) return;
      const ev = h['evidencia'].filter((id): id is string => typeof id === 'string' && citados.has(id)).map(id => fuentes.get(id));
      revisar(`hallazgos[${i}]`, h['texto'], ev, 'los datos de su evidencia');
    });
  }
  if (Array.isArray(x['negativos'])) x['negativos'].forEach((n, i) => revisar(`negativos[${i}]`, n, todos, 'ningún dato de datos_fuente'));
  return e;
}
