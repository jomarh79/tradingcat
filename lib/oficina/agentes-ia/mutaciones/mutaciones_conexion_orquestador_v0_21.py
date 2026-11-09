# Mutaciones de la v0.21 (paso del monto al Auditor y motivo del analista opcional). Ejecución: python3 mutar.py <carpeta del proyecto> lib/oficina <este archivo>
F='lib/oficina/conexion/flujo-auditoria.ts'
O='lib/oficina/orquestador/corrida.ts'
M=[('flujo: no mezcla', F, "hechos: a.operacion === undefined ? hechos.hechos : { ...hechos.hechos, operacion: { ...hechos.hechos.operacion, ...a.operacion } } });", "hechos: hechos.hechos });"),
('flujo: no pasa', F, "...(flujo.operacion !== undefined ? { operacion: flujo.operacion } : {}) });", "});"),
('opc: sin motivo', O, "...opcionales.filter(a => resultados_agentes[a]?.estado !== 'ok').map(", "...[].filter(a => resultados_agentes[a as Agente]?.estado !== 'ok').map("),
('opc: ok cuenta', O, "opcionales.filter(a => resultados_agentes[a]?.estado !== 'ok')", "opcionales.filter(a => resultados_agentes[a]?.estado === 'ok')"),
('opc: requeridos', O, "...opcionales.filter(a => resultados_agentes[a]?.estado !== 'ok').map(", "...requeridos.filter(a => resultados_agentes[a]?.estado !== 'ok').map("),
('opc: codigo', O, "codigo: 'agente_opcional_fallo', detalle: `${a}: ${resultados_agentes[a]?.estado", "codigo: 'agente_requerido_fallo', detalle: `${a}: ${resultados_agentes[a]?.estado"),
('opc: detalle', O, "detalle: `${a}: ${resultados_agentes[a]?.estado ?? 'sin resultado'}` }))],", "detalle: `${a}` }))],"),
]
