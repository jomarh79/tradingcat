# Oficina - modulo de conexion v0.4

- reglas-bd.ts: reglas vigentes desde oficina_reglas / _versiones / _clasificacion.
- entrada-auditor.ts: construye auditoria_entrada.v1.
- hechos-bd.ts: posicion, compras (trade_executions buy/sell/close), capital, expediente y plan_pcp (solo si ficha.plan_pcp.estado = "declarado").
- expediente-bd.ts: recupera o crea el Expediente Maestro (id real de Supabase; nunca inventado).
  Busca por user_id + ticker + mercado + portfolio_id. Si no existe lo crea (tesis_origen: reconstruida si la posicion ya existia, al_entrar si es nueva;
  tesis_version y ficha usan el default de la base). Si el insert choca con el indice unico oficina_expedientes_unico (23505) relee una vez.
  Si no se puede recuperar ni crear: ok=false y NO se debe guardar oficina_analisis.
- persistencia-auditor.ts: guarda la salida del Auditor en oficina_analisis (una fila, error de la base tal cual).
- Tests: 69 en conexion; 189 mutaciones (56 + 73 + 17 + 43), 0 sin atrapar.
