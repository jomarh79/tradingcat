D='lib/oficina/agentes-ia/'
M=[
('c: version F',D+'constantes.ts',"'fundamental.p6'","'fundamental.p5'"),
('c: version D',D+'constantes.ts',"'director.p5'","'director.p6'"),
('p: sin resumen/hallazgos/tesis',D+'prompts.ts',"El \\`resumen\\`, los \\`hallazgos\\` y la \\`tesis_propuesta\\` no pueden afirmar","Los \\`hallazgos\\` no pueden afirmar"),
('p: tema faltante',D+'prompts.ts',"cuyo dato esté en \\`datos_faltantes\\` (por ejemplo","cuyo dato esté en \\`datos_presentes\\` (por ejemplo"),
('p: baja deuda',D+'prompts.ts',"no digas «baja deuda» ni «endeudamiento controlado» si falta la deuda","no digas «baja deuda» si falta la deuda"),
('p: solo faltar',D+'prompts.ts',"sobre ese tema solo puedes decir que el dato falta","sobre ese tema puedes opinar"),
('p: resumen cubierto',D+'prompts.ts',"Cada afirmación del \\`resumen\\` debe estar cubierta por un hallazgo con evidencia citada","El \\`resumen\\` puede resumir libremente"),
('p: no anadir',D+'prompts.ts',"no añadas al \\`resumen\\` conclusiones que no estén en los hallazgos","puedes añadir al \\`resumen\\` conclusiones propias"),
('p: ttm crecimiento',D+'prompts.ts',"no hables de crecimiento TTM sin citar un item de crecimiento TTM","no hables de crecimiento"),
('p: condicion exacta',D+'prompts.ts',"La \\`condicion\\` debe describir exactamente lo que mide el umbral","La \\`condicion\\` puede ser libre"),
('p: calificativos',D+'prompts.ts',"sin añadir calificativos que el umbral no mide, como «sostenida»","añadiendo calificativos como «sostenida»"),
('p: ejemplo condicion',D+'prompts.ts',"«la utilidad neta TTM es mayor que 0»","«la utilidad es buena»"),
]
