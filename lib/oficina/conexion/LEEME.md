# Oficina - modulo de conexion v0.3

- reglas-bd.ts: reglas vigentes desde oficina_reglas / _versiones / _clasificacion.
- entrada-auditor.ts: construye auditoria_entrada.v1.
- hechos-bd.ts: posicion, compras (trade_executions buy/sell/close), capital, expediente y plan_pcp.
  plan_pcp se lee de oficina_expedientes.ficha.plan_pcp SOLO si estado = "declarado" y modalidad = una_compra | escalonado.
  Un plan pendiente o ausente = no declarado (el Auditor da NO_EVALUABLE). Modalidad invalida con estado declarado = problema.
- persistencia-auditor.ts: guarda la salida del Auditor en oficina_analisis (una fila, error de la base tal cual).
- Tests: 56 en conexion; 146 mutaciones (56 + 73 + 17), 0 sin atrapar.
