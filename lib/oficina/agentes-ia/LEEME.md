# agentes-ia — puertos de IA del Orquestador (v0.1)

Implementa `Puertos.analista` (solo **Fundamental**) y `Puertos.director` con OpenAI. Los demás analistas
(Técnico, Valuación, Riesgo y Capital) responden `error: no implementado todavía`; se agregan con el mismo patrón.
No opera, no escribe decisiones, no toca reglas. Solo servidor.

## Flujo de cada llamada
1. **Entrada**: se valida el sobre (`entrada.v1`) o el contexto del Director. Si falta información obligatoria
   (por ejemplo `snapshot.datos.items` vacío) el puerto devuelve `error` **sin llamar al modelo**.
2. **Modelo**: salida JSON estricta (`json_schema`, strict). Los esquemas son una ayuda; la verdad la dicta el validador.
3. **Validador (código)**: si falla, **un reintento** con el error. Si vuelve a fallar: `estado: error`, nada se guarda,
   no se presenta ninguna síntesis. Un análisis que no valida nunca llega al Director ni a la base.
4. **Guardado** en `oficina_analisis` (una fila). Si falla, `estado: error`.
5. Errores del proveedor (red, 429, 5xx): sin reintento interno; el Orquestador ya reintenta el puerto una vez.
   Peor caso: 2 llamadas del Orquestador × 2 intentos de validación = 4 llamadas al modelo.

## Qué impide inventar datos
- Cada `datos_fuente` de la salida debe ser una **copia exacta** (id, campo, valor, unidad, fuente, fecha_dato) de un item de
  `snapshot.datos.items`. Si el modelo cambia o agrega una cifra, se rechaza.
- Un hallazgo con cifra necesita `evidencia` (ids de `datos_fuente`); ids inexistentes se rechazan.
- `negativos` obligatorio. `NO_EVALUABLE` exige listar `datos_faltantes`; faltantes críticos obligan a `NO_EVALUABLE`.
- El Director solo puede citar cifras que ya estén en las salidas de los analistas, la auditoría o el contexto; debe incluir
  **todos** los hallazgos negativos; debe declarar la contradicción si hay veredictos FAVORABLE y DESFAVORABLE; una propuesta de
  tesis queda `pendiente_autorizacion = true`; con `BLOQUEO_REGLA`/`NO_ELEGIBLE` del Auditor y «continuar» debe declarar la discrepancia.

## Límites conocidos (heurísticas, [PROPUESTA])
- **Órdenes de compra/venta**: detección por patrones (imperativos, «te sugiero vender», «you should buy»…). No es infalible; el prompt
  también lo prohíbe. Un falso positivo solo provoca el reintento.
- **Cifras**: se comparan solo los dígitos (se ignoran separadores); `12.5` y `1.25` colisionan. Enteros de un dígito sin `%` se toman como conteos.
  El valor de `umbral` de la condición que cambiaría la conclusión puede aparecer en su texto (es una condición propuesta, no un dato citado).
- **Frescura** (contrato, sección 3, punto 4): no se valida aquí; el Orquestador marca `datos_vencidos`. Pendiente: bajar la confianza con datos caducados.
- **`ventaja_competitiva`** debería justificarse con evidencia citada: hoy solo se exige evidencia para hallazgos con cifras.
- No se detecta «da por vigente un cambio de regla no aprobado» (Director, punto 8, segunda parte).
- Referencias entre hallazgos: `agente:id` (por ejemplo `fundamental:h3`).

## Seguridad
- `OPENAI_API_KEY`, `OPENAI_MODEL_ANALISTA` y `OPENAI_MODEL_DIRECTOR` se leen del entorno (solo servidor). Si faltan, el error lista **solo los nombres**.
- La clave solo va en la cabecera `Authorization`. Los errores del proveedor se reducen a estado HTTP y código en minúsculas; nunca el mensaje original.
- Los fragmentos de documentos van como datos; el prompt indica ignorar instrucciones incluidas en ellos.

## Persistencia
`oficina_analisis` con `agente = 'fundamental'` o `'director_ia'`. El Director guarda `veredicto` y `puntaje` en null y `confianza = nivel_confianza`.
`salida` incluye `trazabilidad` (proveedor, modelo, contrato, versión del prompt, run_id, snapshot_id, intentos, generado_en).
`supuestos` e `invalidadores` van solo dentro de `salida` por ahora (las columnas son jsonb; moverlas está pendiente de tu visto bueno).
`expediente_id` es obligatorio y no se inventa; `ejecucion_id` queda en null como en el Auditor; `user_id` lo pone la base.

## Qué falta para una corrida real con IA
1. Una fuente de datos que arme `snapshot.datos.items` del Fundamental (estados financieros y ratios con fuente y fecha): **aún no existe**.
2. El cableado (ruta y `guardar_*` con el expediente de la corrida) y las variables de entorno.
3. Los otros tres analistas y la entrada del Director con tesis y Watchlist.

## Prueba de punta a punta con datos puestos a mano (v0.2)
`POST /api/oficina/prueba-fundamental` (solo dueño; no usa Supabase y no guarda nada: `guardado: false`).
Cuerpo: `{ ticker, income_statement, items_extra?, con_director?, portafolio? }`. `income_statement` es la respuesta de `/api/webull/income-statement`.
- `datos-fundamental.ts` convierte esa respuesta en items con fuente y fecha (5 años + TTM + EPS estimado con fecha de consulta). Márgenes y crecimientos los calcula el código (fuente "Calculado por código..."), redondeados a 4 decimales. Un valor nulo se omite y se avisa; nunca se rellena.
- Webull solo da estado de resultados. Sin balance ni flujo de caja, el Fundamental debe responder `NO_EVALUABLE`; es lo esperado. Para otra respuesta, agrega `items_extra` (cada uno con id, campo, valor, unidad, fuente, fecha_dato) con datos reales de Finnhub o TwelveData.
- El Director corre después con auditoría null y sin reglas; se omite si el Fundamental falla. `con_director: false` lo salta.
- Mínimo 30 s entre llamadas (cuesta llamadas a OpenAI). Script: `scripts/oficina/probar-fundamental-ia.ps1`.
- Variables: `PROVEEDOR_IA` (obligatoria: `openai` o `gemini`, sin valor por omisión) y las de ese proveedor. Solo servidor.

## Proveedores (v0.3)
- `openai`: `OPENAI_API_KEY`, `OPENAI_MODEL_ANALISTA`, `OPENAI_MODEL_DIRECTOR`.
- `gemini` (Google AI Studio): `GEMINI_API_KEY`, `GEMINI_MODEL_ANALISTA`, `GEMINI_MODEL_DIRECTOR`. Cliente: `cliente-gemini.ts` (generateContent, clave en la cabecera `x-goog-api-key`, salida JSON con esquema).
- Selector: `proveedor-ia.ts` (`resolverProveedorIa`). El proveedor queda en la trazabilidad y en la respuesta de la prueba.
- Los nombres de campo de la petición a Gemini (`responseMimeType`, `responseJsonSchema`) están como constantes en `constantes.ts` (no se pudo confirmar en la documentación cuál es la vigente). Si Google responde HTTP 400, se corrige ahí.
- El esquema solo guía al modelo; la autoridad es el validador del código.
- **Capa gratuita de Gemini: Google puede usar lo enviado para mejorar sus modelos.** Mientras se use, el Director recibe solo datos públicos; no enviar posiciones ni datos del portafolio. Esta restricción debe aplicarse al cablear el Director con datos reales (aún no existe).

## Pruebas
`npx vitest run lib/oficina/agentes-ia`. Mutaciones: `mutaciones/mutaciones_agentes_ia_v0_1.py` y `mutaciones/mutaciones_prueba_fundamental_v0_2.py` y `mutaciones/mutaciones_gemini_v0_3.py` (se corre con el mismo ejecutor de mutaciones).
