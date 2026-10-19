import type { IdSenal, SnapshotTecnico } from './tipos';

/** Qué señales calculadas por código cuentan para cada uso (contrato v0.4, sección 4; matriz v2).
 *  MACD y figura chartista no se calculan: las confirmas tú. En la salida del PCP tampoco se calcula Koncorde. */
export const SENALES_POR_USO = {
  apertura_pcp: ['RSI_SOBREVENTA', 'KONCORDE_BAJO_CERO', 'EMA8_SOBRE_EMA21', 'MOGALEF_BANDA_INFERIOR'],      // PCP-10
  recompra_pcp: ['RSI_SOBREVENTA', 'KONCORDE_BAJO_CERO', 'MOGALEF_BANDA_INFERIOR', 'NIVEL_PASADO'],          // PCP-04; nivel = pivote de mínimo o de máximo (19-oct)
  dca_plp: ['RSI_SOBREVENTA', 'MOGALEF_BANDA_INFERIOR', 'EMA8_SOBRE_EMA21', 'NIVEL_PASADO'],                 // PLP-03; "sobreventa" = RSI ≤ 30 [PROPUESTA]; NIVEL_PASADO [PROPUESTA] por el reemplazo de SOPORTE_PASADO
  salida_pcp: ['RSI_SOBRECOMPRA', 'MOGALEF_BANDA_SUPERIOR', 'RESISTENCIA_PASADA'],                           // PCP-05/06 (19-oct); sin soporte
} as const satisfies Record<string, readonly IdSenal[]>;

export type UsoSenales = keyof typeof SENALES_POR_USO;

const DISCRECIONALES: Record<UsoSenales, readonly string[]> = {
  apertura_pcp: ['MACD', 'figura chartista'],
  recompra_pcp: ['MACD', 'figura chartista'],
  dca_plp: ['figura chartista'],
  salida_pcp: ['MACD', 'Koncorde (visual)', 'figura chartista'],
};

const AVISOS: Record<UsoSenales, string> = {
  apertura_pcp: 'Señal técnica: no autoriza por sí sola una operación ni anula reglas obligatorias, el veto del Auditor o tu autorización.',
  recompra_pcp: 'Señal técnica: no autoriza por sí sola una operación ni anula reglas obligatorias, el veto del Auditor o tu autorización.',
  dca_plp: 'La sobreventa (RSI ≤ 30) es una condición técnica, no una orden de compra: siguen aplicando calidad, tesis, valoración, riesgo, capital y tu autorización.',
  salida_pcp: 'Señal técnica de salida: no autoriza por sí sola una venta ni anula reglas obligatorias, el veto del Auditor o tu autorización; aplican las reglas de salida del PCP (plan, costo promedio ponderado).',
};

export interface Detonante {
  /** Basta una señal (PCP-10, PCP-04, PCP-05/06). En `salida_pcp` equivale a `senal_salida` de la entrada del Motor. */
  detonante_confirmado: boolean;
  senales_cumplidas: IdSenal[];
  senales_no_evaluables: IdSenal[];    // no se cuentan como cumplidas ni como incumplidas
  discrecionales_pendientes: string[]; // las confirmas tú
  aviso: string;
}

export function detonantePara(snapshot: SnapshotTecnico, uso: UsoSenales): Detonante {
  const ids: readonly IdSenal[] = SENALES_POR_USO[uso];
  const cumplidas: IdSenal[] = [], noEval: IdSenal[] = [];
  for (const id of ids) {
    const s = snapshot.senales.find(x => x.id === id);
    if (!s || s.cumplida === null) noEval.push(id);
    else if (s.cumplida) cumplidas.push(id);
  }
  return {
    detonante_confirmado: cumplidas.length > 0,
    senales_cumplidas: cumplidas,
    senales_no_evaluables: noEval,
    discrecionales_pendientes: DISCRECIONALES[uso].slice(),
    aviso: AVISOS[uso],
  };
}
