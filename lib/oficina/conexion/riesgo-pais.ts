// Riesgo país (v0.96, decisión de Jaime 26-nov): lista FIJA y editable de países por nivel de riesgo. No viene de ningún proveedor ni de ningún modelo: es una
// clasificación tuya (corrígela aquí). El país de cada empresa sale de Webull (/api/fundamentals) cuando lo trae y, si no, de Finnhub (profile2.country).
// País desconocido o fuera de la lista = sin dato (nunca se supone bajo). Cuenta en el ranking de la comparación como una métrica más (menor es mejor).

export type NivelRiesgoPais = 'bajo' | 'medio' | 'alto';
export const VALOR_NIVEL: Readonly<Record<NivelRiesgoPais, number>> = { bajo: 0, medio: 1, alto: 2 };
export const NIVEL_DE_VALOR: Readonly<Record<number, NivelRiesgoPais>> = { 0: 'bajo', 1: 'medio', 2: 'alto' };

export interface PaisRiesgo { nivel: NivelRiesgoPais; nombre: string; motivo: string }

const ALTO_CN = 'Estructura VIE (el inversionista no posee la empresa operativa), riesgo regulatorio y de delistado, control de capitales';
const L = (nivel: NivelRiesgoPais, nombre: string, motivo: string): PaisRiesgo => ({ nivel, nombre, motivo });

/** Código ISO de 2 letras → nivel. EDITABLE: agrega o corrige países aquí. */
export const RIESGO_POR_PAIS: Readonly<Record<string, PaisRiesgo>> = {
  // Bajo: mercados desarrollados con estado de derecho y mercado de capitales profundo
  US: L('bajo', 'Estados Unidos', 'Mercado desarrollado'), CA: L('bajo', 'Canadá', 'Mercado desarrollado'), GB: L('bajo', 'Reino Unido', 'Mercado desarrollado'),
  IE: L('bajo', 'Irlanda', 'Mercado desarrollado'), DE: L('bajo', 'Alemania', 'Mercado desarrollado'), FR: L('bajo', 'Francia', 'Mercado desarrollado'),
  NL: L('bajo', 'Países Bajos', 'Mercado desarrollado'), CH: L('bajo', 'Suiza', 'Mercado desarrollado'), SE: L('bajo', 'Suecia', 'Mercado desarrollado'),
  DK: L('bajo', 'Dinamarca', 'Mercado desarrollado'), NO: L('bajo', 'Noruega', 'Mercado desarrollado'), FI: L('bajo', 'Finlandia', 'Mercado desarrollado'),
  BE: L('bajo', 'Bélgica', 'Mercado desarrollado'), AT: L('bajo', 'Austria', 'Mercado desarrollado'), LU: L('bajo', 'Luxemburgo', 'Mercado desarrollado'),
  ES: L('bajo', 'España', 'Mercado desarrollado'), IT: L('bajo', 'Italia', 'Mercado desarrollado'), JP: L('bajo', 'Japón', 'Mercado desarrollado'),
  AU: L('bajo', 'Australia', 'Mercado desarrollado'), NZ: L('bajo', 'Nueva Zelanda', 'Mercado desarrollado'), SG: L('bajo', 'Singapur', 'Mercado desarrollado'),
  KR: L('bajo', 'Corea del Sur', 'Mercado desarrollado'),
  // Medio: emergentes con instituciones razonables, o riesgo geopolítico/cambiario/regulatorio moderado
  TW: L('medio', 'Taiwán', 'Tensión geopolítica con China'), IL: L('medio', 'Israel', 'Riesgo geopolítico'), IN: L('medio', 'India', 'Emergente: regulación y tipo de cambio'),
  BR: L('medio', 'Brasil', 'Emergente: inflación, tipo de cambio y fiscal'), MX: L('medio', 'México', 'Emergente: tipo de cambio y riesgo regulatorio'),
  CL: L('medio', 'Chile', 'Emergente: tipo de cambio'), CO: L('medio', 'Colombia', 'Emergente: tipo de cambio y político'), PE: L('medio', 'Perú', 'Emergente: político'),
  UY: L('medio', 'Uruguay', 'Emergente: tipo de cambio (operaciones en Latinoamérica)'), PA: L('medio', 'Panamá', 'Emergente'),
  ZA: L('medio', 'Sudáfrica', 'Emergente: energía, tipo de cambio'), ID: L('medio', 'Indonesia', 'Emergente: tipo de cambio'), TH: L('medio', 'Tailandia', 'Emergente'),
  PH: L('medio', 'Filipinas', 'Emergente'), MY: L('medio', 'Malasia', 'Emergente'), VN: L('medio', 'Vietnam', 'Emergente'), SA: L('medio', 'Arabia Saudita', 'Dependencia del petróleo y geopolítica'),
  AE: L('medio', 'Emiratos Árabes Unidos', 'Geopolítica'), PL: L('medio', 'Polonia', 'Cercanía a la guerra en Ucrania'),
  BM: L('medio', 'Bermudas', 'Domicilio offshore: el negocio opera en otros países'), KY: L('medio', 'Islas Caimán', 'Domicilio offshore: el negocio opera en otros países'),
  VG: L('medio', 'Islas Vírgenes Británicas', 'Domicilio offshore: el negocio opera en otros países'),
  // Alto
  CN: L('alto', 'China', ALTO_CN), HK: L('alto', 'Hong Kong', 'Control de China y riesgo regulatorio'), MO: L('alto', 'Macao', 'Control de China y riesgo regulatorio'),
  RU: L('alto', 'Rusia', 'Sanciones y mercado cerrado a inversionistas extranjeros'), UA: L('alto', 'Ucrania', 'Guerra'), AR: L('alto', 'Argentina', 'Controles de capital, inflación e impagos'),
  TR: L('alto', 'Turquía', 'Inflación y tipo de cambio'), VE: L('alto', 'Venezuela', 'Sanciones y colapso económico'), EG: L('alto', 'Egipto', 'Tipo de cambio y deuda'),
  NG: L('alto', 'Nigeria', 'Tipo de cambio y controles de capital'), PK: L('alto', 'Pakistán', 'Deuda y político'),
};

export interface RiesgoPaisEmpresa { codigo: string | null; nombre: string | null; nivel: NivelRiesgoPais | null; motivo: string | null }

/** Normaliza el código de país (ISO de 2 letras; admite minúsculas y espacios). null si no es un código legible. */
export function codigoPais(x: unknown): string | null {
  if (typeof x !== 'string') return null;
  const t = x.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(t) ? t : null;
}

export function riesgoDePais(x: unknown): RiesgoPaisEmpresa {
  const codigo = codigoPais(x);
  const r = codigo === null ? undefined : RIESGO_POR_PAIS[codigo];
  return r === undefined ? { codigo, nombre: null, nivel: null, motivo: null } : { codigo, nombre: r.nombre, nivel: r.nivel, motivo: r.motivo };
}

/** Texto de aviso para el ticker analizado (solo si el riesgo no es bajo). */
export function avisoRiesgoPais(ticker: string, r: RiesgoPaisEmpresa): string | null {
  if (r.nivel === null || r.nivel === 'bajo') return null;
  return `${ticker}: país de riesgo ${r.nivel} (${r.nombre}, ${r.codigo}): ${r.motivo}. Solo es un aviso${r.nivel === 'alto' ? ' fuerte' : ''}: no cambia la decisión de la Oficina; en la comparación con competidores cuenta como una métrica más.`;
}
