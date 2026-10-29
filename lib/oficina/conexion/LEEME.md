# Oficina - modulo de conexion v0.6

- reglas-bd.ts: reglas vigentes desde oficina_reglas / _versiones / _clasificacion.
- entrada-auditor.ts: construye auditoria_entrada.v1.
- hechos-bd.ts: posicion, compras (trade_executions buy/sell/close), capital, expediente y plan_pcp (solo si ficha.plan_pcp.estado = "declarado").
- expediente-bd.ts: recupera o crea el Expediente Maestro (id real de Supabase, nunca inventado).
- persistencia-auditor.ts: guarda la salida del Auditor en oficina_analisis.
- flujo-auditoria.ts (NUEVO): une todo con un cliente inyectado (ClienteOficina).
  * resolverPortfolioId: codigo de portafolio -> portfolio_id (oficina_portafolios_config, exactamente 1 fila).
  * prepararAuditoria: portafolio -> expediente (recuperar/crear) -> reglas -> hechos -> entrada del Auditor (sobre_auditor).
  * puertoAuditorBd: corre el Auditor y guarda su salida en oficina_analisis (ejecucion_id null; el registro de la corrida lo hace oficina_registrar_corrida).
  * ejecutarCorridaConAuditoria(cliente, solicitud, datos, puertosBase, opciones, { user_id? }): todo el flujo + ejecutarCorrida.
    Si la preparacion falla: no se guarda ningun analisis, el motivo va en datos_faltantes y el Auditor responde error (la corrida no queda completada).
    El run_id del Auditor es el corrida_id.
- user_id es OPCIONAL: en sesion de usuario se omite (la base lo pone con auth.uid()); con clave de servicio se pasa explicito desde una variable fija de entorno.
- Tests: 102 en conexion; 251 mutaciones (56 + 77 + 17 + 48 + 53), 0 sin atrapar.
