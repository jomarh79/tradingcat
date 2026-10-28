# Oficina - modulo de conexion v0.2

- reglas-bd.ts: reglas vigentes desde oficina_reglas / _versiones / _clasificacion.
- entrada-auditor.ts: construye auditoria_entrada.v1.
- hechos-bd.ts: lee posicion, compras (trade_executions: buy/sell/close), capital y expediente. No estima: si falta un dato devuelve problemas.
- persistencia-auditor.ts: guarda la salida del Auditor en oficina_analisis (una fila, error de la base tal cual).
- Tests: 55 en conexion; 129 mutaciones (56 + 73), 0 sin atrapar. Suite oficina completa verde.
Pendiente: plan_pcp, dividendos/movimientos (tablas vacias hoy) y el cableado final con el cliente Supabase real.
