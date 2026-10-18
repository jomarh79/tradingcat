import type { IdSenal, SnapshotTecnico } from './tipos';

/** Qué señales calculadas por código cuentan para cada uso (contrato v0.4, sección 4).
 *  MACD y figura chartista no se calculan: las confirmas tú. */
export const SENALES_POR_USO = {
  apertura_pcp: ['RSI_SOBREVENTA', 'KONCORDE_BAJO_CERO', 'EMA8_SOBRE_EMA21', 'MOGALEF_BANDA_INFERIOR'],      // PCP-10
  recompra_pcp: ['RSI_SOBREVENTA', 'KONCORDE_BAJO_CERO', 'MOGALEF_BANDA_INFERIOR', 'SOPORTE_PASADO'],        // PCP-04
  dca_plp: ['RSI_SOBREVENTA', 'MOGALEF_BANDA_INFERIOR', 'EMA8_SOBRE_EMA21', 'SOPORTE_PASADO'],               // PLP-03; "sobreventa" = RSI ≤ 30 [PROPUESTA]
} as const satisfies Record<string, readonly IdSenal[]>;

export type UsoSenales = keyof typeof SENALES_POR_USO;

export interface Detonante {
  detonante_confirmado: boolean;       // basta una señal (PCP-10, PCP-04)
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
    discrecionales_pendientes: uso === 'dca_plp' ? ['figura chartista'] : ['MACD', 'figura chartista'],
    aviso: uso === 'dca_plp'
      ? 'La sobreventa (RSI ≤ 30) es una condición técnica, no una orden de compra: siguen aplicando calidad, tesis, valoración, riesgo, capital y tu autorización.'
      : 'Señal técnica: no autoriza por sí sola una operación ni anula reglas obligatorias, el veto del Auditor o tu autorización.',
  };
}
