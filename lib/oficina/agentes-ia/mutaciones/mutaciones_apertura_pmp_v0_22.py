# Mutaciones de la apertura de PMP (al menos dos señales de entrada). Ejecución: python3 mutar.py <carpeta del proyecto> lib/oficina <este archivo>
D='lib/oficina/tecnico/detonantes.ts'
P='lib/oficina/orquestador/preparar-tecnico.ts'
C='lib/oficina/orquestador/corrida.ts'
M=[('min: uno', D, "apertura_pmp: 2,   // 9-nov", "apertura_pmp: 1,   // 9-nov"),
('min: tres', D, "apertura_pmp: 2,   // 9-nov", "apertura_pmp: 3,   // 9-nov"),
('cmp: mayor', D, "cumplidas.length >= MINIMO_SENALES_POR_USO[uso]", "cumplidas.length > MINIMO_SENALES_POR_USO[uso]"),
('pcp: minimo', D, "apertura_pcp: 1, recompra_pcp: 1,", "apertura_pcp: 2, recompra_pcp: 1,"),
('sin nivel', D, "'MOGALEF_BANDA_INFERIOR', 'NIVEL_PASADO'],\n} as const", "'MOGALEF_BANDA_INFERIOR'],\n} as const"),
('con salida', D, "'MOGALEF_BANDA_INFERIOR', 'NIVEL_PASADO'],\n} as const", "'MOGALEF_BANDA_INFERIOR', 'NIVEL_PASADO', 'RSI_SOBRECOMPRA'],\n} as const"),
('minimas: campo', D, "senales_minimas: MINIMO_SENALES_POR_USO[uso],", "senales_minimas: 1,"),
('discrecionales', D, "apertura_pmp: ['figura chartista', 'Fibonacci'],", "apertura_pmp: ['figura chartista'],"),
('momento: sin pmp', P, "'dca_plp', 'apertura_pmp'] as const satisfies readonly UsoDetonante[]", "'dca_plp'] as const satisfies readonly UsoDetonante[]"),
('caso: sin pmp', C, "  'PMP:nueva_posicion': 'apertura_pmp',\n", ""),
('caso: recompra', C, "  'PMP:nueva_posicion': 'apertura_pmp',\n", "  'PMP:nueva_posicion': 'apertura_pmp',\n  'PMP:recompra': 'apertura_pmp',\n"),
]
