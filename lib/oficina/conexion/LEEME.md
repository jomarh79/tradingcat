# Oficina - modulo de conexion v0.5

- reglas-bd.ts: reglas vigentes desde oficina_reglas / _versiones / _clasificacion.
- entrada-auditor.ts: construye auditoria_entrada.v1.
- hechos-bd.ts: posicion, compras (trade_executions buy/sell/close), capital, expediente y plan_pcp (solo si ficha.plan_pcp.estado = "declarado").
- expediente-bd.ts: recupera o crea el Expediente Maestro (id real de Supabase, nunca inventado).
- persistencia-auditor.ts: guarda la salida del Auditor en oficina_analisis (una fila, error de la base tal cual).
- user_id es OPCIONAL en expediente-bd y persistencia-auditor: en sesion de usuario se omite (la base lo pone con auth.uid() y el RLS "propias" limita las filas);
  si viene, se valida y se usa en filtros y filas (proceso sin sesion con clave de servicio: variable fija de entorno, nunca de la peticion).
- Tests: 73 en conexion; 198 mutaciones (56 + 77 + 17 + 48), 0 sin atrapar.
