# Mutaciones de la v0.18 (banderas cierre_sobre_ema8/ema21 y prompt tecnico.p5). Ejecución: python3 mutar.py <carpeta del proyecto> lib/oficina/agentes-ia <este archivo>
D='lib/oficina/agentes-ia/'
M=[('d: mayor estricto', D+'datos-tecnico.ts', 'typeof m !== \'number\' || !isFinite(m) ? null : cierreDiario > m;', 'typeof m !== \'number\' || !isFinite(m) ? null : cierreDiario >= m;'),
('d: invertido', D+'datos-tecnico.ts', ': cierreDiario > m;', ': cierreDiario < m;'),
('d: sin cierre', D+'datos-tecnico.ts', 'cierreDiario === null || !isFinite(cierreDiario) || typeof m', 'typeof m'),
('d: cierre no finito', D+'datos-tecnico.ts', '|| !isFinite(cierreDiario) ||', '||'),
('d: media no finita', D+'datos-tecnico.ts', "typeof m !== 'number' || !isFinite(m) ?", "typeof m !== 'number' ?"),
('d: media tipo', D+'datos-tecnico.ts', "typeof m !== 'number' || !isFinite(m) ?", '!isFinite(m as number) ?'),
('d: ema8 usa ema21', D+'datos-tecnico.ts', 'bandera(ID_ITEM_SOBRE_EMA8, sobreMedia(CLAVE_INDICADOR_EMA8), fDia);', 'bandera(ID_ITEM_SOBRE_EMA8, sobreMedia(CLAVE_INDICADOR_EMA21), fDia);'),
('d: ema21 usa ema8', D+'datos-tecnico.ts', 'bandera(ID_ITEM_SOBRE_EMA21, sobreMedia(CLAVE_INDICADOR_EMA21), fDia);', 'bandera(ID_ITEM_SOBRE_EMA21, sobreMedia(CLAVE_INDICADOR_EMA8), fDia);'),
('d: ema8 omitida', D+'datos-tecnico.ts', 'bandera(ID_ITEM_SOBRE_EMA8, sobreMedia(CLAVE_INDICADOR_EMA8), fDia);', ''),
('d: ema21 omitida', D+'datos-tecnico.ts', 'bandera(ID_ITEM_SOBRE_EMA21, sobreMedia(CLAVE_INDICADOR_EMA21), fDia);', ''),
('d: fecha semanal', D+'datos-tecnico.ts', 'bandera(ID_ITEM_SOBRE_EMA8, sobreMedia(CLAVE_INDICADOR_EMA8), fDia);', 'bandera(ID_ITEM_SOBRE_EMA8, sobreMedia(CLAVE_INDICADOR_EMA8), fSem);'),
# ('d: cierre numerico') es equivalente: JavaScript convierte la cadena numérica al comparar y isFinite coacciona igual; se retira del archivo.

('c: id ema8', D+'constantes.ts', "ID_ITEM_SOBRE_EMA8 = 'cierre_sobre_ema8'", "ID_ITEM_SOBRE_EMA8 = 'cierre_ema8'"),
('c: id ema21', D+'constantes.ts', "ID_ITEM_SOBRE_EMA21 = 'cierre_sobre_ema21'", "ID_ITEM_SOBRE_EMA21 = 'cierre_ema21'"),
('c: clave ema8', D+'constantes.ts', "CLAVE_INDICADOR_EMA8 = 'ema8'", "CLAVE_INDICADOR_EMA8 = 'ema9'"),
('c: clave ema21', D+'constantes.ts', "CLAVE_INDICADOR_EMA21 = 'ema21'", "CLAVE_INDICADOR_EMA21 = 'ema20'"),
('c: version', D+'constantes.ts', "VERSION_PROMPT_TECNICO = 'tecnico.p5'", "VERSION_PROMPT_TECNICO = 'tecnico.p4'"),
('p: sin bandera', D+'prompts.ts', 'a menos que un item \\`cierre_sobre_*\\` lo diga', 'aunque no lo diga ningun item'),
('p: lista banderas', D+'prompts.ts', 'cierre_sobre_ema8, cierre_sobre_ema21, cierre_sobre_ema200_diaria, cierre_sobre_sma200_semanal', 'cierre_sobre_ema200_diaria, cierre_sobre_sma200_semanal'),
('p: valor no', D+'prompts.ts', 'si su valor es \\`no\\`, el cierre NO está por encima', 'si su valor es \\`no\\`, el cierre esta por encima'),
('p: comparar', D+'prompts.ts', 'No compares tú precios entre sí.', ''),
('p: faltan senales', D+'prompts.ts', 'No digas que «faltan más señales»', 'Puedes decir que «faltan más señales»'),
('p: criterio', D+'prompts.ts', 'el criterio de entrada no está definido en los datos. Lista', 'el criterio de entrada esta definido. Lista'),
('p: cuantas', D+'prompts.ts', 'sin concluir cuántas bastan', 'concluyendo cuántas bastan')]
