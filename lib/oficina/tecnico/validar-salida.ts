import { fmt } from './calculos';
import { VEREDICTOS_TECNICO } from './tipos';
import type { NivelCalculado, SalidaTecnicoModelo } from './tipos';

const TENDENCIAS = ['alcista', 'lateral', 'bajista'];

/** Regla estricta del contrato: todo precio que proponga el modelo debe ser uno de `niveles_calculados`,
 *  referenciado por su nivel_id. Devuelve los errores; si hay alguno, la salida se rechaza (no se corrige). */
export function validarSalidaTecnico(salida: SalidaTecnicoModelo, niveles: NivelCalculado[]): { ok: boolean; errores: string[] } {
  const errores: string[] = [];
  const porId: Record<string, NivelCalculado> = {};
  niveles.forEach(n => { porId[n.id] = n; });

  if (!(VEREDICTOS_TECNICO as readonly string[]).includes(salida.veredicto)) errores.push(`veredicto fuera de vocabulario: ${salida.veredicto}`);
  for (const k of ['corto', 'medio', 'largo'] as const) {
    if (!TENDENCIAS.includes(salida.tendencia?.[k])) errores.push(`tendencia.${k} inválida`);
  }

  const mismoPrecio = (a: number | string, b: string) => {
    const x = Number(a);
    return isFinite(x) && fmt(x) === b;
  };
  const revisar = (campo: string, p: { precio: number | string; nivel_id: string } | null | undefined) => {
    if (!p) return;
    const nivel = porId[p.nivel_id];
    if (!nivel) errores.push(`${campo}: el nivel_id "${p.nivel_id}" no existe en niveles_calculados`);
    else if (!mismoPrecio(p.precio, nivel.precio)) errores.push(`${campo}: el precio ${p.precio} no coincide con ${p.nivel_id} (${nivel.precio})`);
  };
  revisar('soporte_clave', salida.soporte_clave);
  revisar('resistencia_clave', salida.resistencia_clave);
  revisar('nivel_invalidacion', salida.nivel_invalidacion);

  const z = salida.zona_entrada;
  if (z) {
    if (!z.nivel_ids || z.nivel_ids.length === 0) errores.push('zona_entrada: falta nivel_ids');
    const usados = (z.nivel_ids || []).map(id => porId[id]);
    usados.forEach((n, i) => { if (!n) errores.push(`zona_entrada: el nivel_id "${z.nivel_ids[i]}" no existe en niveles_calculados`); });
    const precios = usados.filter((n): n is NivelCalculado => !!n).map(n => n.precio);
    if (precios.length === usados.length && precios.length > 0) {
      if (!precios.some(p => mismoPrecio(z.min, p))) errores.push(`zona_entrada.min (${z.min}) no es un nivel de nivel_ids`);
      if (!precios.some(p => mismoPrecio(z.max, p))) errores.push(`zona_entrada.max (${z.max}) no es un nivel de nivel_ids`);
    }
    if (Number(z.min) > Number(z.max)) errores.push('zona_entrada: min es mayor que max');
  }
  return { ok: errores.length === 0, errores };
}
