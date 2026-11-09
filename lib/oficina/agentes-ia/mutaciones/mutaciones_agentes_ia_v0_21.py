# Mutaciones de la v0.21 (agentes-ia): negativos del Técnico y monto. Ejecución: python3 mutar.py <carpeta del proyecto> lib/oficina/agentes-ia <este archivo>
V='lib/oficina/agentes-ia/validar-tecnico.ts'
R='lib/oficina/agentes-ia/analisis-real.ts'
G='lib/oficina/agentes-ia/analisis-guardado.ts'
C='lib/oficina/agentes-ia/constantes.ts'
M=[('neg: interruptor', V, "if (VERIFICAR_NEGATIVO_SENAL_NO_CUMPLIDA && Array.isArray(neg))", "if (false && Array.isArray(neg))"),
('neg: cumplidas', V, "g.cumplida === false).map(g => g.id as string);\n    neg.forEach", "g.cumplida === true).map(g => g.id as string);\n    neg.forEach"),
('neg: null cuenta', V, "g.cumplida === false).map(g => g.id as string);\n    neg.forEach", "g.cumplida !== true).map(g => g.id as string);\n    neg.forEach"),
('neg: sin indice', V, "negativos[${i}] nombra la señal", "negativos[0] nombra la señal"),
('neg: no string', V, "if (typeof n !== 'string') return;", ""),
('neg: sin includes', V, "if (n.includes(id)) e.push", "if (false) e.push"),
('neg: solo primera', V, "for (const id of noCumplidas) if (n.includes(id)) e.push", "for (const id of noCumplidas.slice(0, 1)) if (n.includes(id)) e.push"),
('monto: clave', C, "'guardar', 'monto'] as const", "'guardar'] as const"),
('monto: cero', R, "|| Number(t) <= 0)", "|| Number(t) < 0)"),
('monto: decimales', R, "(\\.\\d{1,2})?$/", "(\\.\\d{1,9})?$/"),
('monto: no pasa', G, "v.cuerpo.monto !== undefined ? { operacion: { monto: v.cuerpo.monto } } : {}", "{}"),
('monto: null', G, "monto_declarado: v.cuerpo.monto ?? null,", "monto_declarado: null,"),
('monto: sin guardar', R, "if (v.cuerpo.monto !== undefined) return { http: 400", "if (false) return { http: 400"),
('monto: no se agrega', R, "...(monto !== undefined ? { monto } : {}),", ""),
('prompt: version', C, "VERSION_PROMPT_TECNICO = 'tecnico.p7'", "VERSION_PROMPT_TECNICO = 'tecnico.p6'"),
]
