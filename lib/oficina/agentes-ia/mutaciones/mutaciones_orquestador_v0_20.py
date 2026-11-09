# Mutaciones de la v0.20 en el Orquestador (lista de analistas requeridos sin resultado en el contexto del Director). Ejecución: python3 mutar.py <carpeta del proyecto> lib/oficina/orquestador <este archivo>
F='lib/oficina/orquestador/corrida.ts'
M=[('o: no ok', F, "requeridos.filter(a => resultados_agentes[a]?.estado !== 'ok')", "requeridos.filter(a => resultados_agentes[a]?.estado === 'ok')"),
('o: sin filtro', F, "analistas_requeridos_sin_resultado: requeridos.filter(a => resultados_agentes[a]?.estado !== 'ok'),", "analistas_requeridos_sin_resultado: requeridos,"),
('o: opcionales', F, "analistas_requeridos_sin_resultado: requeridos.filter(a => resultados_agentes[a]?.estado !== 'ok'),", "analistas_requeridos_sin_resultado: Object.keys(resultados_agentes).filter(a => resultados_agentes[a as Agente]?.estado !== 'ok') as Agente[],"),
('o: campo', F, "analistas_requeridos_sin_resultado: requeridos.filter(a => resultados_agentes[a]?.estado !== 'ok'),", "analistas_requeridos_sin_resultado: [],"),
('o: ausente', F, "resultados_agentes[a]?.estado !== 'ok')", "resultados_agentes[a] === undefined)")]
