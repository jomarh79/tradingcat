import type { IdSenal, SnapshotTecnico } from './tipos';

/** Qué señales calculadas por código cuentan para cada uso (contrato v0.4, sección 4; matriz v2).
 *  MACD y figura chartista no se calculan: las confirmas tú. En la salida del PCP tampoco se calcula Koncorde. */
export const SENALES_POR_USO = {
  apertura_pcp: ['RSI_SOBREVENTA', 'KONCORDE_BAJO_CERO', 'EMA8_SOBRE_EMA21', 'MOGALEF_BANDA_INFERIOR', 'REBOTE_SMA_100_200', 'REVERSION_ALCISTA_VELAS'],      // PCP-10; v0.70: +rebote en SMA 100/200 y reversión alcista por velas (6 posibles, mínimo 2)
  recompra_pcp: ['RSI_SOBREVENTA', 'KONCORDE_BAJO_CERO', 'MOGALEF_BANDA_INFERIOR', 'NIVEL_PASADO'],          // PCP-04; nivel = pivote de mínimo o de máximo (19-oct)
  dca_plp: ['RSI_SOBREVENTA', 'MOGALEF_BANDA_INFERIOR', 'EMA8_SOBRE_EMA21', 'NIVEL_PASADO', 'REBOTE_SMA_100_200'],                    // PLP-03 (22-oct): definición común NIVEL_PASADO (mínimos y máximos, 19-oct); "sobreventa" = RSI ≤ 30 [PROPUESTA]
  salida_pcp: ['RSI_SOBRECOMPRA', 'MOGALEF_BANDA_SUPERIOR', 'RESISTENCIA_PASADA'],                           // PCP-05/06 (19-oct); sin soporte
  // Apertura de PMP (decisión del 9-nov): las mismas cinco señales de entrada que calcula el Técnico, pero exige AL MENOS DOS cumplidas (`MINIMO_SENALES_POR_USO`).
  apertura_pmp: ['RSI_SOBREVENTA', 'KONCORDE_BAJO_CERO', 'EMA8_SOBRE_EMA21', 'MOGALEF_BANDA_INFERIOR', 'NIVEL_PASADO'],
  // Recompra de PMP (decisión del 25-nov): las mismas cuatro señales que la recompra de PCP; basta una (el stop tocado también dispara, por código del Motor)
  recompra_pmp: ['RSI_SOBREVENTA', 'KONCORDE_BAJO_CERO', 'MOGALEF_BANDA_INFERIOR', 'NIVEL_PASADO', 'REBOTE_SMA_100_200'],   // v0.90: +rebote en SMA 100/200 (25-nov)
  // Salida de PMP (decisión del 10-nov): banda superior de Mogalef, RSI sobrecomprado y resistencia pasada; exige AL MENOS DOS confirmaciones (el nivel planeado va aparte y basta solo).
  salida_pmp: ['RSI_SOBRECOMPRA', 'MOGALEF_BANDA_SUPERIOR', 'RESISTENCIA_PASADA'],
} as const satisfies Record<string, readonly IdSenal[]>;

export type UsoSenales = keyof typeof SENALES_POR_USO;

/** Cuántas señales cumplidas hacen falta para confirmar el detonante. Por omisión una (PCP-04, PCP-05/06). */
export const MINIMO_SENALES_POR_USO: Readonly<Record<UsoSenales, number>> = {
  apertura_pcp: 2,   // 18-nov: PCP-10 exige al menos dos señales de entrada (igual que PMP)
  recompra_pcp: 1, dca_plp: 1, salida_pcp: 1, recompra_pmp: 1,
  apertura_pmp: 2,   // 9-nov: "por lo menos dos"
  salida_pmp: 2,     // 10-nov: los criterios que no son el nivel planeado piden dos confirmaciones
};

const DISCRECIONALES: Record<UsoSenales, readonly string[]> = {
  apertura_pcp: ['figura chartista'],   // v0.70: el MACD lo revisas tú fuera de la Oficina
  recompra_pcp: ['figura chartista'],
  recompra_pmp: ['figura chartista'],
  dca_plp: ['figura chartista'],
  salida_pcp: ['MACD', 'Koncorde (visual)', 'figura chartista'],
  apertura_pmp: ['figura chartista', 'Fibonacci'],   // las revisa el usuario en TradingView: no se calculan ni se conectan
  salida_pmp: ['figura chartista'],                  // la figura de tu gráfico es una confirmación tuya: no se calcula
};

const AVISOS: Record<UsoSenales, string> = {
  apertura_pcp: 'Entrada técnica de PCP (al menos dos señales cumplidas): no autoriza por sí sola una operación ni anula reglas obligatorias, el veto del Auditor o tu autorización.',
  recompra_pcp: 'Señal técnica: no autoriza por sí sola una operación ni anula reglas obligatorias, el veto del Auditor o tu autorización.',
  recompra_pmp: 'Señal técnica de recompra de PMP (10 USD): no autoriza por sí sola una compra ni anula reglas obligatorias, el tope de 10% del portafolio, el veto del Auditor o tu autorización.',
  dca_plp: 'La sobreventa (RSI ≤ 30) es una condición técnica, no una orden de compra: siguen aplicando calidad, tesis, valoración, riesgo, capital y tu autorización.',
  apertura_pmp: 'Entrada técnica de PMP (al menos dos señales cumplidas): no autoriza por sí sola una operación ni anula reglas obligatorias, el filtro de ganancia anualizada, el veto del Auditor o tu autorización.',
  salida_pmp: 'Señal técnica de salida de PMP (al menos dos confirmaciones): no autoriza por sí sola una venta ni anula reglas obligatorias, el veto del Auditor o tu autorización; aplica el plan de salidas de PMP.',
  salida_pcp: 'Señal técnica de salida: no autoriza por sí sola una venta ni anula reglas obligatorias, el veto del Auditor o tu autorización; aplican las reglas de salida del PCP (plan, costo promedio ponderado).',
};

export interface Detonante {
  /** Se cumplen al menos `senales_minimas` señales (una en PCP-04, PCP-05/06; dos en `apertura_pcp` y `apertura_pmp`). En `salida_pcp` equivale a `senal_salida` de la entrada del Motor. */
  detonante_confirmado: boolean;
  /** Cuántas señales cumplidas se exigen para este uso. */
  senales_minimas: number;
  senales_cumplidas: IdSenal[];
  senales_no_evaluables: IdSenal[];    // no se cuentan como cumplidas ni como incumplidas
  discrecionales_pendientes: string[]; // las confirmas tú
  aviso: string;
  /** v0.70: solo informativa. 2 cumplidas = normal, 3 = fuerte, 4 o más = muy fuerte; null si hay menos de 2. No cambia `detonante_confirmado`. */
  fuerza: FuerzaSenal | null;
}

export type FuerzaSenal = 'normal' | 'fuerte' | 'muy_fuerte';

/** Fuerza de una entrada según cuántas señales coinciden (informativa; el mínimo para confirmar no cambia). */
export function fuerzaEntrada(cumplidas: number): FuerzaSenal | null {
  if (cumplidas >= 4) return 'muy_fuerte';
  if (cumplidas === 3) return 'fuerte';
  if (cumplidas === 2) return 'normal';
  return null;
}

export const ETIQUETA_FUERZA: Record<FuerzaSenal, string> = { normal: 'normal', fuerte: 'fuerte', muy_fuerte: 'muy fuerte' };

export function detonantePara(snapshot: SnapshotTecnico, uso: UsoSenales): Detonante {
  const ids: readonly IdSenal[] = SENALES_POR_USO[uso];
  const cumplidas: IdSenal[] = [], noEval: IdSenal[] = [];
  for (const id of ids) {
    const s = snapshot.senales.find(x => x.id === id);
    if (!s || s.cumplida === null) noEval.push(id);
    else if (s.cumplida) cumplidas.push(id);
  }
  return {
    detonante_confirmado: cumplidas.length >= MINIMO_SENALES_POR_USO[uso],
    senales_minimas: MINIMO_SENALES_POR_USO[uso],
    senales_cumplidas: cumplidas,
    senales_no_evaluables: noEval,
    discrecionales_pendientes: DISCRECIONALES[uso].slice(),
    aviso: AVISOS[uso],
    fuerza: fuerzaEntrada(cumplidas.length),
  };
}
