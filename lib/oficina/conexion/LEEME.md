# Oficina - modulo de conexion v0.7

- reglas-bd, entrada-auditor, hechos-bd, expediente-bd, persistencia-auditor, flujo-auditoria: ver versiones anteriores.
- datos-aporte-etf.ts (NUEVO): arma los datos congelados del aporte semanal de ETFs con la base real (cliente con sesion del usuario, RLS activo).
  Propuestas E1-E5: efectivo de oficina_v_capital; 11 ETFs sectoriales (sin IVV PESOS, GBTC, QQQ; con otro numero no se arma);
  duplicado = compra del mismo ETF en la semana en curso (lunes a domingo, America/Mexico_City); snapshot = ahora.
- corrida-etf.ts (NUEVO): correrAporteEtf(cliente, body, { nuevoId, ahora }) = datos + flujo con Auditor + registro atomico (oficina_registrar_corrida).
  Respuesta: resumen sin tokens ni claves. 400 body invalido, 422 datos reales insuficientes (nada registrado), 500 si el registro falla.
- app/api/oficina/corrida-etf/route.ts (NUEVO): POST protegido por isOwnerRequest; cliente = clave anonima + token del usuario (sin service role).
- scripts/oficina/probar-corrida-etf.ps1: prueba manual (pide correo y clave sin mostrarlas, o -ConToken).
- Tests: 125 en conexion; 314 mutaciones (56 + 77 + 17 + 48 + 53 + 63), 0 sin atrapar.
