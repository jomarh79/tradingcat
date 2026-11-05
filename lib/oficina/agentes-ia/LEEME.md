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

## Datos de Finnhub (v0.4)
`datos-finnhub.ts` (`itemsDesdeFinnhub`) convierte tres respuestas de Finnhub en items del snapshot. La ruta de prueba acepta `finnhub_reportado` (financials-reported anual), `finnhub_reportado_trimestral` (financials-reported trimestral) y `finnhub_metric` (stock/metric); el script las trae con `-ConFinnhub`.
- Solo toma **balance y flujo de caja** de financials-reported (conceptos us-gaap en USD, últimos 3 años). El estado de resultados sigue viniendo de Webull: el SEC clasifica el deterioro de intangibles en el costo de ventas y daría una utilidad bruta distinta (GKOS 2025: 282.761.000 contra 395.628.000 de Webull).
- Cada item lleva formulario (10-K/10-Q), fecha de presentación y fecha de cierre del periodo. Un concepto ausente se omite con aviso (nunca se asume cero: p. ej. sin concepto de deuda).
- Calculado por código: razón corriente (activos corrientes entre pasivos corrientes) y flujo de caja libre (flujo operativo menos pagos por propiedad, planta y equipo), con su fuente de cálculo.
- El 10-Q más reciente: Finnhub trae su flujo de caja (**acumulado del año fiscal**, no del trimestre) pero su balance suele venir vacío; se avisa y el balance más reciente es el del último 10-K. Solo se usa un trimestral posterior al último anual.
- `stock/metric`: solo ratios ya expresados como razón (razón corriente, prueba ácida, deuda sobre patrimonio). Su fecha es la de consulta, no la del balance, y así lo dice la fuente. Márgenes y retornos (en porcentaje) no se toman.
- No hay datos de Finnhub si la clave no existe o el plan no cubre el endpoint (TwelveData responde 403 en balance y flujo de caja con el plan actual del usuario: no se usa).

## Proveedores (v0.3)
- `openai`: `OPENAI_API_KEY`, `OPENAI_MODEL_ANALISTA`, `OPENAI_MODEL_DIRECTOR`.
- `gemini` (Google AI Studio): `GEMINI_API_KEY`, `GEMINI_MODEL_ANALISTA`, `GEMINI_MODEL_DIRECTOR`. Cliente: `cliente-gemini.ts` (generateContent, clave en la cabecera `x-goog-api-key`, salida JSON con esquema).
- Selector: `proveedor-ia.ts` (`resolverProveedorIa`). El proveedor queda en la trazabilidad y en la respuesta de la prueba.
- Los nombres de campo de la petición a Gemini (`responseMimeType`, `responseJsonSchema`) están como constantes en `constantes.ts` (no se pudo confirmar en la documentación cuál es la vigente). Si Google responde HTTP 400, se corrige ahí.
- El esquema solo guía al modelo; la autoridad es el validador del código.
- **Capa gratuita de Gemini: Google puede usar lo enviado para mejorar sus modelos.** Mientras se use, el Director recibe solo datos públicos; no enviar posiciones ni datos del portafolio. Esta restricción debe aplicarse al cablear el Director con datos reales (aún no existe).

## Correcciones de la prueba real (v0.5)
- **Avisos de datos al modelo [PROPUESTA]:** el snapshot puede traer `datos.avisos` (lista de textos generados por código sobre datos ausentes o con salvedades). Antes solo los veía quien leía la respuesta HTTP, no el modelo. Es un campo OPCIONAL y aditivo de `entrada.v1`; si no hay avisos no aparece. Viajan como máximo `MAX_AVISOS_SNAPSHOT` (40); el resto se resume en una línea. La respuesta de la prueba conserva todos.
- **Prompts p2:** escala 0 a 100 (la v0.4 devolvió 6.5), afirmaciones cualitativas con evidencia directa (sin «continuo» si algún periodo no lo cumple), datos ausentes a `datos_faltantes` y menos `confianza`, y referencias del Director siempre `agente:id` (también en coincidencias y contradicciones).
- **Error del Director:** ante una referencia inexistente el mensaje de reintento dice el formato y lista las referencias válidas (hasta `MAX_REFS_EN_MENSAJE`, 20).
- Los prompts no garantizan nada: la autoridad sigue siendo el validador. Afirmaciones cualitativas sin respaldo (por ejemplo «continuo») no se pueden detectar por código.
- Mutaciones: `mutaciones/mutaciones_agentes_ia_v0_5.py` (48).

## Correcciones de la segunda prueba real (v0.6)
- **Unidad de Finnhub:** el último reporte anual usa `u_usd`, pero los anteriores (GKOS 2019 a 2024) usan `unit_standard_usd_<código distinto por reporte>`; 2015 a 2018 usan `unit12`. Se acepta `u_usd` o el prefijo `unit_standard_usd_` con código no vacío (`esUnidadUsdFinnhub`). Cualquier otra unidad (`unit12`, etc.) se descarta con aviso, sin asumir USD. Basado en una sola muestra (GKOS): si otro ticker trae otra unidad, saldrá el aviso «unidad inesperada».
- **Campo del umbral:** `invalidadores[].umbral.campo` debe ser el `campo` de un item numérico del snapshot (no el id ni un texto). El error lista los campos válidos (primero los que empiezan igual, hasta `MAX_CAMPOS_EN_MENSAJE` = 30). Se aplica a cualquier umbral presente, sea o no medible la condición.
- **Prompts p3:** cada subpuntaje debe citar evidencia de su dimensión (sin ninguna, NO_EVALUABLE; el contrato no permite subpuntaje null con otro veredicto), `umbral.campo` exacto, y `tesis.estado` = `sin_tesis` si no hay tesis vigente. Solo son instrucciones: el validador no comprueba que cada subpuntaje tenga evidencia.
- Mutaciones: `mutaciones/mutaciones_agentes_ia_v0_6.py` (34).

## Confianza del Director (v0.7)
- Regla de código aprobada por el usuario: `nivel_confianza` del Director no puede superar la `confianza` más baja de los analistas (se ignoran las que no sean numéricas), ni `TOPE_CONFIANZA_CON_FALTANTES` si su lista `datos_faltantes` no está vacía. Es un cambio de validador, no de contrato.
- **[PROPUESTA] El tope vale 0.6**: lo fijé yo; es una constante nombrada en `constantes.ts` y el usuario puede cambiarlo. Solo mira los `datos_faltantes` del propio Director, no los de los analistas.
- Una confianza fuera de 0 a 1 da solo el error de rango. Prompt del Director p4 explica la regla.
- **Desde v0.8 el mismo tope aplica al Fundamental** (aprobado por el usuario): con `datos_faltantes` no vacío, `confianza` ≤ `TOPE_CONFIANZA_CON_FALTANTES`, con cualquier veredicto. Prompt del Fundamental p4. En la prueba real el Fundamental dio 0.8 con deuda ausente y el Director lo copió; ahora el error cae sobre el modelo que lo causa.
- Mutaciones v0.8: `mutaciones/mutaciones_agentes_ia_v0_8.py` (17).
- Mutaciones: `mutaciones/mutaciones_agentes_ia_v0_7.py` (22).

## Análisis con datos reales (v0.9)
- Ruta nueva `POST /api/oficina/analisis-fundamental` (body `{ ticker, con_director?, portafolio? }`): el SERVIDOR trae los datos, ya no se pega JSON. Script: `scripts/oficina/analizar-fundamental.ps1`.
- **Webull:** llama por HTTP a tu ruta `/api/webull/income-statement` reenviando el token del dueño (tu ruta no se modifica). No se siguen redirecciones (el token no viaja a otro destino); si hay una, el error pide definir `OFICINA_BASE_URL` (origen público de la app, opcional; por omisión se usa el origen de la petición). Si Webull falla no hay análisis (HTTP 502).
- **Finnhub:** `financials-reported` anual y trimestral y `stock/metric`, con la clave solo en la cabecera `X-Finnhub-Token` (variable `FINNHUB_API_KEY`, privada y solo del servidor. La Oficina NUNCA usa `NEXT_PUBLIC_FINNHUB_KEY`: esa queda visible en el navegador y es solo del frontend). Si falla una llamada se omite esa parte y se añade un aviso (`avisos_obtencion`, que también ve el modelo); nunca se rellena.
- La respuesta añade `fuentes` (`ok` u `omitida` por fuente). Errores solo con estado HTTP: nunca cuerpos de respuesta, claves ni tokens. Tiempo máximo por llamada: `TIMEOUT_DATOS_MS` = 25 s.
- **Privacidad (capa gratuita de Gemini):** el Director recibe solo el análisis del Fundamental, el ticker y el código de portafolio elegido; sin posiciones, capital ni datos del portafolio (hay un test que fija las claves). No se debe añadir nada de eso mientras se use esa capa.
- **Limitación:** en local, tu servidor no alcanza Webull (timeout), así que esta ruta falla allí con `Webull (ruta interna): ...`. Se prueba contra la app desplegada (`-Base`) con las variables de entorno puestas en el despliegue.
- Solo analiza: no lee ni escribe en Supabase, no guarda y no opera. Guardar con expediente es la siguiente entrega.
- `prueba-fundamental` acepta ahora `avisos_obtencion` (lista de hasta 20 textos de hasta 300 caracteres). Mutaciones: `mutaciones/mutaciones_agentes_ia_v0_9.py` (79).

## Invalidadores y recomendación del Director (v0.10)
- **Invalidadores (solo prompt, Fundamental p5):** un invalidador debe vigilar el futuro: preferir items del periodo más reciente (`_ttm`) y una condición que hoy todavía no se cumple; no usar items de un año fiscal ya cerrado (`_fy2025`). El código no lo verifica (es semántico): el validador solo sigue exigiendo que `umbral.campo` sea un campo numérico real.
- **Recomendación del Director (regla de código, Director p5):** `completar_datos` solo se acepta si algún analista presente declara un `datos_faltantes` con `critico: true` (estrictamente `true`). Con faltantes no críticos el Director debe usar `continuar` (confianza ≤ `TOPE_CONFIANZA_CON_FALTANTES`). Los `datos_faltantes` del propio Director (textos) no cuentan. No se restringen `continuar` ni `detener`: la regla inversa (rechazar `continuar` si hay un faltante crítico) **no** se aplicó porque no se pidió.
- Mutaciones v0.10: `mutaciones/mutaciones_agentes_ia_v0_10.py` (26).

## Resumen sin afirmar lo que falta (v0.11, Fundamental p6, solo prompt)
- En la prueba real el `resumen` decía «baja deuda a largo plazo» con `deuda_largo_plazo` en `datos_faltantes`. El prompt p6 prohíbe afirmar sobre un tema con dato faltante (resumen, hallazgos y tesis; solo se puede decir que falta), exige que cada afirmación del `resumen` esté cubierta por un hallazgo con evidencia y que la `condicion` del invalidador describa exactamente lo que mide el umbral (sin «sostenida»).
- **Limitación:** no hay regla de código. Un filtro por palabras (por ejemplo «deuda») rechazaría también las menciones correctas de que el dato falta. La comprobación semántica sigue siendo revisión humana de las corridas de prueba.
- El prompt del Director no cambia (p5). Mutaciones: `mutaciones/mutaciones_agentes_ia_v0_11.py` (12).

## Primera propuesta de tesis (v0.12, Director p6)
- Decisión del usuario: sin cambiar el contrato `integracion.v1`. Por convención, `tesis.estado = propuesta_cambio` cuando no hay tesis vigente significa **primera propuesta** (siempre con `pendiente_autorizacion` true). El prompt del Director p6 lo indica y le prohíbe inventar un estado nuevo. Quien lea el resultado debe interpretarlo así; el código de guardado deberá distinguirlo comprobando si existe tesis vigente.
- Mutaciones: `mutaciones/mutaciones_agentes_ia_v0_12.py` (4).

## Guardado del análisis (v0.13)
- `POST /api/oficina/analisis-fundamental` con `"guardar": true` (script: `-Guardar`). Sin `guardar` sigue siendo prueba en seco. Con `guardar` el Director siempre corre (`con_director: false` se rechaza).
- **Orden** (`ejecutarAnalisisGuardado`): validar cuerpo → traer datos (Webull y Finnhub, sin escribir nada) → armar y validar el sobre → leer portafolio, posición y parámetros (solo lectura) → recuperar o crear el expediente y leer si ya tiene tesis vigente → correr el flujo del Orquestador con los puertos de IA reales (cada análisis validado se inserta en `oficina_analisis` al producirse, con el expediente real y sin `user_id`: lo pone la base) → registrar la corrida y sus ejecuciones con `oficina_registrar_corrida` (atómico). Si algo falla antes de llegar al expediente, HTTP 502 (datos) o 422 (etapa y problemas) y no se escribe nada ni se llama al modelo.
- **Sesión del usuario:** la ruta crea el cliente con la clave anónima y el token del usuario (RLS "propias"); nunca la clave de servicio.
- **Tipo de evaluación:** `posicion_abierta` si hay una posición de ese ticker en ese portafolio (`oficina_v_posiciones`), `nueva_posicion` si no. Posición ambigua (más de una fila) = no se guarda nada.
- **Primera propuesta o cambio** (convención del 3-nov): el código mira la columna `tesis_vigente` del expediente (null, vacío, `{}` o `[]` = sin tesis). Si el Director propone (`propuesta_cambio` con texto): sin tesis vigente = `primera_propuesta`; con tesis vigente = `cambio_de_tesis`; si no propone = `sin_propuesta`. Se guarda en `salida.anotaciones_codigo` del análisis del Director (no se toca lo que validó el modelo) y se devuelve en la respuesta.
- **Privacidad (capa gratuita de Gemini):** mientras `DIRECTOR_VE_DATOS_PRIVADOS` sea false, el Director NO recibe el resultado del Auditor, los ids de reglas ni el contexto, y recibe el tipo `nueva_posicion` aunque haya posición (el tipo real delata que la tienes). El Motor y la corrida registrada usan los valores reales. La anotación del análisis del Director deja escrito lo que se le ocultó. Si algún día pasas a un plan de pago, se cambia esa constante a propósito.
- **Corrida incompleta:** Valuación, Técnico y Riesgo y Capital no existen todavía; si el portafolio los exige, la corrida queda incompleta/bloqueada y así se registra con sus motivos. Es lo esperado.
- **Límites conocidos:** (1) el análisis y la corrida son escrituras distintas: si `oficina_registrar_corrida` falla, los análisis ya insertados quedan sin corrida (la respuesta es HTTP 500 con `persistencia.estado` distinto de `guardada`). (2) Si el expediente ya tiene tesis vigente, esa tesis NO se envía al modelo (el Fundamental no compara contra ella: `cambios_vs_tesis_vigente` queda vacío); solo se usa para clasificar. (3) Nada escribe `tesis_vigente`: aprobar una tesis es un paso aparte que no existe todavía. (4) `tesis_estado` del Motor no se informa. (5) Dos llamadas seguidas crean dos corridas y dos juegos de análisis (no hay deduplicación; la ruta ya exige 30 s entre llamadas).
- Mutaciones v0.13: `mutaciones/mutaciones_agentes_ia_v0_13.py` (72).

## Pruebas
`npx vitest run lib/oficina/agentes-ia`. Mutaciones: `mutaciones/mutaciones_agentes_ia_v0_1.py` y `mutaciones/mutaciones_prueba_fundamental_v0_2.py` `mutaciones/mutaciones_gemini_v0_3.py` y `mutaciones/mutaciones_finnhub_v0_4.py` `mutaciones/mutaciones_agentes_ia_v0_5.py` y `mutaciones/mutaciones_agentes_ia_v0_6.py` `mutaciones/mutaciones_agentes_ia_v0_7.py` `mutaciones/mutaciones_agentes_ia_v0_8.py` `mutaciones/mutaciones_agentes_ia_v0_9.py` `mutaciones/mutaciones_agentes_ia_v0_10.py` y `mutaciones/mutaciones_agentes_ia_v0_11.py` (se corre con el mismo ejecutor de mutaciones).
