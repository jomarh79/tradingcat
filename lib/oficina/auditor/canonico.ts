import { createHash } from 'crypto';

/** JSON canónico: claves ordenadas, sin espacios. Mismas entradas, mismo texto, mismo hash. */
export function jsonCanonico(valor: unknown): string {
  if (valor === null || typeof valor !== 'object') {
    if (valor === undefined) return 'null';
    return JSON.stringify(valor);
  }
  if (Array.isArray(valor)) return '[' + valor.map(jsonCanonico).join(',') + ']';
  const o = valor as Record<string, unknown>;
  const claves = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return '{' + claves.map((k) => JSON.stringify(k) + ':' + jsonCanonico(o[k])).join(',') + '}';
}

export function hashSha256(valor: unknown): string {
  return createHash('sha256').update(jsonCanonico(valor), 'utf8').digest('hex');
}
