F='lib/oficina/orquestador/parametros.ts'
M=[
('dh: typeof object',F,"if (typeof valor !== 'object' || valor === null) return null;\n  const d = (valor as { dias_habiles","if (valor === null) return null;\n  const d = (valor as { dias_habiles"),
('dh: null check',F,"if (typeof valor !== 'object' || valor === null) return null;\n  const d = (valor as { dias_habiles","if (typeof valor !== 'object') return null;\n  const d = (valor as { dias_habiles"),
('dh: number',F,"typeof d === 'number' && isFinite(d) && d >= 0 ? d : null;\n}\n\n/** `{ valor","isFinite(d as number) && (d as number) >= 0 ? (d as number) : null;\n}\n\n/** `{ valor"),
('dh: finite',F,"typeof d === 'number' && isFinite(d) && d >= 0 ? d : null;\n}\n\n/** `{ valor","typeof d === 'number' && d >= 0 ? d : null;\n}\n\n/** `{ valor"),
('dh: >=0 a >0',F,"typeof d === 'number' && isFinite(d) && d >= 0 ? d : null;\n}\n\n/** `{ valor","typeof d === 'number' && isFinite(d) && d > 0 ? d : null;\n}\n\n/** `{ valor"),
('dh: sin cota',F,"typeof d === 'number' && isFinite(d) && d >= 0 ? d : null;\n}\n\n/** `{ valor","typeof d === 'number' && isFinite(d) ? d : null;\n}\n\n/** `{ valor"),
('dh: campo',F,"{ dias_habiles?: unknown }).dias_habiles;","{ dias_habiles?: unknown }).dias;"),
('res: usa lector',F,"frescura = leerDiasHabiles(ff.valor);","frescura = leerValorConUnidad(ff.valor, 'dias_habiles');"),
('res: version',F,"else versiones.push({ clave: CLAVE_FRESCURA_PRECIO, version: ff.version });","else versiones.push({ clave: CLAVE_FRESCURA_PRECIO, version: 0 });"),
('res: mensaje',F,'(se espera { "${CAMPO_DIAS_HABILES}": número >= 0 })','(se espera algo)'),
('res: campo const',F,"export const CAMPO_DIAS_HABILES = 'dias_habiles';","export const CAMPO_DIAS_HABILES = 'dias';"),
]
