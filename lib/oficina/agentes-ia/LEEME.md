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

## Analista Técnico de IA (v0.14)
- **Velas:** el servidor las pide a la ruta interna `/api/chart-data` (TwelveData) en diario (`interval=1day`) y semanal (`interval=1week`), con el token del usuario y sin seguir redirecciones. No se llama a TwelveData directo y no se toca `fetchTimeSeries` de la gráfica. La ruta devuelve `{ symbol, interval, priceName, candles, mas }` con las velas de la más antigua a la más reciente; esta capa solo comprueba la forma (lista de objetos con `time, open, high, low, close, volume`) y los valores los valida `validarVelas` del Técnico.
- **Si falla la diaria:** no se aborta el análisis; el Técnico queda sin calcular, se declara en `avisos_velas` y la corrida queda incompleta. Si falla solo la semanal se sigue con las diarias (cálculo parcial) y queda el aviso. Nunca se rellena.
- **Vela del día en curso:** `chart-data` no la marca. La descarta `prepararTecnico` con el calendario NYSE y el margen de cierre (parámetro `orquestador.margen_cierre_velas`); aquí no se quita nada por separado.
- **Quién calcula:** el código (`prepararTecnico` → indicadores, señales, niveles). El modelo solo interpreta. Recibe `items` (cada cifra con id), `niveles_calculados`, `senales`, `estado_calculo` y `avisos`. Sin cálculo de código válido (sin velas, NO_EVALUABLE o pendiente) NO se llama al modelo.
- **Salida (`salida.v1`, agente `tecnico`):** veredicto FAVORABLE | ESPERAR | DESFAVORABLE | NO_EVALUABLE, `tendencia` corto/medio/largo, hallazgos con evidencia, `datos_fuente` (copia exacta de items), `zona_entrada`, `soporte_clave`, `resistencia_clave`, `nivel_invalidacion` (solo niveles calculados, por `nivel_id` y precio exacto: regla de `validarSalidaTecnico`), `datos_faltantes`. Sin `puntaje`.
- **Reglas de código añadidas [PROPUESTA]:** un veredicto distinto de NO_EVALUABLE exige al menos un hallazgo con evidencia; un soporte no puede estar por encima del último cierre ni una resistencia por debajo; con NO_EVALUABLE no se proponen niveles; con cálculo parcial hay que declarar `datos_faltantes` y la confianza no supera el tope 0.6; sin órdenes de compra o venta.
- **Matriz de agentes:** el Técnico de IA corre solo donde la matriz lo pide. PMP + `nueva_posicion` (`abrir`): requerido. PMP con posición abierta (`mantener_o_vender`): opcional y no se pide; el cálculo de código sí corre. `analisis_completo` exige el Técnico solo si se ejecutó.
- **Guardado:** el análisis del Técnico se inserta en `oficina_analisis` (agente `tecnico`, `puntaje` null, prompt `tecnico.p6`) y la corrida lleva `referencias.tecnico`. El Director recibe la salida validada del Técnico junto con la del Fundamental.
- **Privacidad (Gemini gratis):** el Técnico solo ve datos públicos de mercado; nunca posición, portafolio, auditoría ni tesis.
- **Límites conocidos:** (1) la racha de MOGALEF_BANDA_SUPERIOR no se continúa entre corridas (`racha_previa` va null; falta leer `referencias.tecnico` de la corrida anterior). (2) Con NO_EVALUABLE la tendencia debe llevar un valor (`lateral` sin significado); el contrato Técnico no admite null. (3) La interpretación (si la tendencia o el veredicto son razonables) no se puede validar en código. (4) El ajuste de precios (`adjust`) es el predeterminado de TwelveData: sin confirmar. (5) Valuación y Riesgo y Capital siguen sin existir: PMP `abrir` seguirá incompleto por ellos. (6) La base debe aceptar `tecnico` en `oficina_analisis.agente`; si tiene un CHECK sin ese valor, la inserción falla y se declara.
- Mutaciones v0.14: `mutaciones/mutaciones_agentes_ia_v0_14.py` (140).

## Cifras respaldadas por los datos (v0.15, Técnico p2 y Fundamental p7)
- **Caso real (GKOS, 5-nov):** el Técnico escribió «RSI 62.01» en el resumen con el dato en 62.0196 (se redondea a 62.02; el hallazgo decía 62.02) y citó un ADX en el resumen que no estaba en ningún `datos_fuente`. Hasta la v0.14 solo se exigía que un hallazgo con cifra citara *algún* dato, no que la cifra fuera la del dato.
- **Regla de código (`verificar-cifras.ts`):** cada cifra del `resumen`, de los `hallazgos` (contra los datos de SU `evidencia`) y de los `negativos` debe coincidir con el valor de un dato copiado en `datos_fuente`, **redondeada y no truncada** a los decimales con que se escribió (62.01 no respalda 62.0196; 62.0 y 62 sí). Se acepta también como porcentaje (valor por 100) y en miles, millones o miles de millones. Se ignoran fechas ISO, enteros de un dígito (conteos) y los números que forman parte de los ids de los datos (EMA21, SMA200), los años de las fechas y los parámetros del Técnico (RSI 14, 30, 70, 1.5). Un valor de texto que parece número no respalda nada.
- **Mensaje de reintento:** el rechazo lista los datos citados (`id=valor`, hasta 12) y pide copiar la cifra redondeada, para que el modelo corrija en el segundo intento.
- **Interruptores:** `VERIFICAR_CIFRAS_TECNICO` y `VERIFICAR_CIFRAS_FUNDAMENTAL` (constantes.ts). Si en producción el Fundamental rechaza de más, se apaga solo el suyo.
- **Prompts:** `tecnico.p2` (cifras exactas y citar el dato de cada indicador mencionado, sin calcular distancias; negativo solo si perjudica; si el cierre está dentro de la zona de entrada y no es FAVORABLE, explicarlo; el resumen nombra el evento que cambiaría el veredicto) y `fundamental.p7` (misma regla de cifras). Lo semántico de esas reglas (negativo mal clasificado, zona contradictoria, resumen vago) sigue sin validación en código.
- **Límites:** una cifra que coincide por casualidad con otro dato citado no se distingue; no se revisan frases sin cifra; en español «1.234» se lee de las dos formas (1.234 y 1234) y basta que una coincida.
- Mutaciones v0.15: `mutaciones/mutaciones_agentes_ia_v0_15.py` (73).

## Pruebas
`npx vitest run lib/oficina/agentes-ia`. Mutaciones: `mutaciones/mutaciones_agentes_ia_v0_1.py` y `mutaciones/mutaciones_prueba_fundamental_v0_2.py` `mutaciones/mutaciones_gemini_v0_3.py` y `mutaciones/mutaciones_finnhub_v0_4.py` `mutaciones/mutaciones_agentes_ia_v0_5.py` y `mutaciones/mutaciones_agentes_ia_v0_6.py` `mutaciones/mutaciones_agentes_ia_v0_7.py` `mutaciones/mutaciones_agentes_ia_v0_8.py` `mutaciones/mutaciones_agentes_ia_v0_9.py` `mutaciones/mutaciones_agentes_ia_v0_10.py` y `mutaciones/mutaciones_agentes_ia_v0_11.py` (se corre con el mismo ejecutor de mutaciones).

## Prompt del Técnico tecnico.p3 (v0.16)

Solo prompt, sin reglas nuevas de código. A partir de una corrida real (GKOS, 5-nov-2026) en que el modelo ignoró p2: una señal que no se cumple se escribía como hallazgo `negativo` (llega al Director como negativo), y el resumen decía que faltaba «alcanzar» una zona donde el cierre (219.98) ya estaba dentro (zona 199.66 a 221.63). p3 pide: señal no cumplida = `neutral`; comparar el cierre con `min` y `max` de `zona_entrada` y, si está dentro y el veredicto no es FAVORABLE, decir que ya está dentro y qué señal concreta falta; evento del resumen concreto (señal por nombre o nivel por id y precio), sin frases como «una zona más definida». `negativos` sigue sin poder ir vacío (regla común). Nota: los niveles n2 y n3 son EMA8 y EMA21 calculadas por código, no pivotes. Lo semántico sigue sin validación en código; si con p3 el modelo sigue incumpliendo, la salida es una regla de código (por ejemplo rechazar «alcanzar» con el cierre dentro de la zona), que queda como [PROPUESTA] aparte.

## Prompt del Técnico tecnico.p4 (v0.17)

Solo prompt. Corrida real (GKOS, 6-nov-2026, p3): el resumen decía que FAVORABLE exigía `MOGALEF_BANDA_SUPERIOR`, que es señal de SALIDA del PCP, con `EMA8_SOBRE_EMA21` (señal de entrada) ya cumplida, y la confianza era 1.0. El Técnico no recibe el portafolio (privacidad), así que el prompt trabaja por tipo de señal: constantes `SENALES_ENTRADA_TECNICO` (RSI_SOBREVENTA, KONCORDE_BAJO_CERO, EMA8_SOBRE_EMA21, MOGALEF_BANDA_INFERIOR, NIVEL_PASADO) y `SENALES_SALIDA_TECNICO` (RSI_SOBRECOMPRA, MOGALEF_BANDA_SUPERIOR, RESISTENCIA_PASADA). Una señal de salida nunca es el evento que vuelve FAVORABLE; sin señal de entrada ni nivel útil, describe el estado y dice que no hay criterio de entrada definido. Si el veredicto o el evento dependen de algo no verificable con los datos, `confianza` ≤ `TOPE_CONFIANZA_CONDICION_NO_VERIFICABLE` (0.8). Las señales técnicas de PMP no están definidas por el usuario: hasta que las defina, el Técnico solo describe el estado. Ni el tope de 0.8 ni lo demás se validan en código.

## Prompt del Técnico tecnico.p5 y banderas de EMA8/EMA21 (v0.18)

Corrida real (GKOS, 6-nov-2026, p4): el resumen y `h1` decían que el cierre (219.98) estaba por encima de la EMA8 (221.63) y el resumen exigía más señales de entrada pese a que `EMA8_SOBRE_EMA21` y `KONCORDE_BAJO_CERO` ya se cumplían. La regla de cifras no ve estas comparaciones. Cambios: (1) items nuevos calculados por código `cierre_sobre_ema8` y `cierre_sobre_ema21` (`si` solo si el cierre es estrictamente mayor; sin cierre o sin media no hay item), con la fecha de la vela diaria; (2) prompt p5: no afirmar «por encima/por debajo» sin un item `cierre_sobre_*` (si vale `no`, el cierre NO está por encima), no comparar precios, y no decir que «faltan más señales» ni fijar cuántas bastan (el criterio de entrada no está definido; opción C: PMP sin señales técnicas definidas, el Técnico solo describe el estado). Sigue sin validación en código: que el modelo respete las banderas. Comparaciones contra otros niveles (por ejemplo la resistencia n1) no tienen bandera.

## Prompt del Técnico tecnico.p6, banderas por nivel y regla «dentro de la zona» (v0.19)

Corrida real (GKOS, 6-nov-2026, p5): el resumen decía que el cierre (224.2) estaba «dentro de la zona entre 201.8938 y 222.2002», pero quedaba por ENCIMA del máximo. La causa era una contradicción del propio prompt: p3 pedía «compara tú el cierre con min y max» y p5 prohibía comparar precios. Además hablaba de «falta confirmación técnica» con dos señales de entrada ya cumplidas. Cambios:

1. **Banderas por nivel (código):** un item `cierre_sobre_<id del nivel>` por cada nivel calculado (n1, n2, n3...): `si` solo si el cierre es estrictamente mayor que el precio del nivel; sin cierre o con precio no numérico no hay item. Fecha de la vela diaria.
2. **Regla de código (`VERIFICAR_DENTRO_DE_ZONA`):** si el resumen, un hallazgo o un negativo afirma «dentro de la zona» (patrón `PATRON_DENTRO_DE_ZONA`) y el último cierre queda fuera de `zona_entrada.min` a `max` (bordes incluidos como dentro), la salida se rechaza con el lado («por encima» o «por debajo») y el origen del texto. Una negación en los `VENTANA_NEGACION` (25) caracteres previos («no está dentro de la zona») deja pasar la frase. Solo se contrasta esta frase: no se valida texto libre en general, y la frase inversa («fuera de la zona» con el cierre dentro) no se comprueba.
3. **Prompt p6:** se quita «compara tú»; la ubicación se deduce de las banderas (dentro = nivel de `min` en `si` y nivel de `max` en `no`; ambos `si` = por encima; ambos `no` = por debajo) y se citan en `datos_fuente`; se prohíbe hablar de «confirmación» (completa, técnica...) porque el criterio de entrada no está definido.

Sigue sin validación en código que el modelo respete las banderas fuera de la frase «dentro de la zona».

## Analistas requeridos faltantes en el Director, coherencia del Técnico y criterios de aceptación (v0.20)

Decisiones del 7-nov: un analista requerido (R de la matriz v2) que falla no lo sustituye ni lo rellena el Director; los reintentos quedan registrados; un opcional caído no detiene la corrida; el fallo del Director nunca produce COMPRAR (el Motor no depende de él).

1. **Contexto del Director:** el Orquestador agrega `analistas_requeridos_sin_resultado` (los requeridos de la corrida sin análisis válido tras el reintento, en el orden de la tabla; los opcionales nunca figuran). El campo es opcional en el tipo y vacío por defecto. Solo son nombres de analistas (datos públicos): no cambia lo que el Director ve de privado.
2. **Director p7 y su validador:** con faltantes, `recomendacion_para_motor` no puede ser `continuar` (`completar_datos` o `detener`) y `datos_faltantes` debe nombrar a cada analista faltante (sin distinguir mayúsculas). Un requerido ausente cuenta como faltante crítico para poder usar `completar_datos`. Sin faltantes, todo sigue igual.
3. **Coherencia del veredicto del Técnico (`VERIFICAR_COHERENCIA_VEREDICTO_TECNICO`):** condiciones NECESARIAS comprobadas contra las señales calculadas por código: FAVORABLE exige al menos una señal de entrada cumplida (`SENALES_ENTRADA_TECNICO`); DESFAVORABLE exige una señal de salida cumplida (`SENALES_SALIDA_TECNICO`) o el cierre bajo la EMA200 diaria; ESPERAR y NO_EVALUABLE no tienen restricción. Una señal sin datos no cuenta como cumplida. No es una definición de criterio de entrada de PMP (sigue sin definir): una señal de entrada cumplida no obliga a FAVORABLE.

### Criterios de aceptación del Técnico (aprobados el 7-nov)

| # | Criterio | Cómo se garantiza |
|---|---|---|
| A1 | El validador aprueba y `intentos` ≤ 2 | Si no aprueba, no se guarda. `intentos` se revisa por SQL: `salida->'trazabilidad'->>'intentos'` |
| A2 | Ningún precio fuera de `niveles_calculados` | Código (`validarSalidaTecnico`: nivel_id y precio exacto) |
| A3 | Toda cifra escrita coincide con un dato citado, redondeada | Código (v0.15) |
| A4 | «Dentro de la zona» solo si el cierre está dentro | Código (v0.19) |
| A5 | NO_EVALUABLE cuando faltan datos | Código: sin velas, cálculo pendiente o NO_EVALUABLE no llaman al modelo; parcial exige `datos_faltantes` y confianza ≤ 0.6 |
| A6 | Veredicto coherente con las señales calculadas | Código (esta versión, condiciones necesarias) |

Una corrida del Técnico se acepta si cumple A1 a A6 sin excepciones. Lo que ningún criterio cubre (por ejemplo, un resumen que exija una señal concreta que el usuario no definió) se registra como observación, no se aprueba ni se rechaza «por razonable».

## Negativos del Técnico, monto declarado y motivo del opcional caído (v0.21)

Corrida real (GKOS, 9-nov-2026, p6): criterios A1 a A6 cumplidos, con dos defectos semánticos fuera de ellos: (1) el resumen decía que FAVORABLE «requiere que se cumpla RSI_SOBREVENTA» con dos señales de entrada ya cumplidas (el criterio de entrada de PMP no está definido); (2) el único negativo era «RSI_SOBREVENTA no se cumple», que el prompt manda como neutral.

1. **Regla de código `VERIFICAR_NEGATIVO_SENAL_NO_CUMPLIDA`:** un elemento de `negativos` que nombre por su id una señal calculada con `cumplida === false` se rechaza (con su índice). Una señal sin datos o cumplida no se rechaza; los hallazgos neutrales sí pueden describirla. Solo se contrasta el id de la señal, no el texto libre.
2. **Prompt `tecnico.p7` (solo prompt):** el resumen describe el estado actual (ubicación del cierre y señales cumplidas) y NO afirma qué evento cambiaría el veredicto. Reemplaza la instrucción de p6 de «nombrar el evento concreto».
3. **Monto declarado por corrida (`monto`):** campo opcional del cuerpo (número o texto positivo, hasta 2 decimales) y parámetro `-Monto` del script. Se pasa a `operacion.monto` de la entrada del Auditor (PMP-02 exige USD 50 y PCP USD 25 al abrir; con otro monto incumple, sin monto queda NO_EVALUABLE `monto_no_declarado`). No hay monto por omisión. Solo con `guardar` (sin guardar no corre el Auditor y se rechaza). La respuesta trae `monto_declarado`. Quien declara el monto es el usuario en cada corrida porque un mismo ticker puede entrar a PMP o a PCP.
4. **Motivo `agente_opcional_fallo` (aprobado el 7-nov):** un analista opcional que se pidió y no entregó resultado queda en `motivos` (`<agente>: <estado>`). Es informativo: no cambia la decisión ni el estado de la corrida y el Motor no interviene (lo agrega el Orquestador). Un opcional no pedido no corre y no deja motivo. No requiere SQL: `motivos` es un arreglo jsonb sin CHECK sobre los códigos. Falta comprobar que `oficina_registrar_corrida` no valide los códigos (consulta en las instrucciones de la entrega).

## Entrada de PMP: al menos dos señales técnicas (v0.22)

Decisión del 9-nov: la entrada de PMP la da el Técnico por código, con las mismas cinco señales de entrada que calcula (`RSI_SOBREVENTA`, `KONCORDE_BAJO_CERO`, `EMA8_SOBRE_EMA21`, `MOGALEF_BANDA_INFERIOR`, `NIVEL_PASADO`) y exigiendo AL MENOS DOS cumplidas (`MINIMO_SENALES_POR_USO.apertura_pmp = 2`; el resto de usos sigue en una). Una señal sin datos no cuenta como cumplida. Fibonacci y figuras chartistas no se calculan: quedan como `discrecionales_pendientes` que revisa el usuario en TradingView.

- `detonantePara(snapshot, 'apertura_pmp')` agrega `senales_minimas` al detonante. En el Orquestador, `PMP:nueva_posicion` toma `momento.detonante_confirmado` del Técnico (C6); el `momento` que entregue el llamador para PMP abrir se ignora, igual que en PCP. PMP recompra no cambia: solo el `momento` del llamador, y sin él el Motor responde ESPERAR.
- Precio de entrada (decisión, pendiente de construir): con señal, el cierre de la última vela cerrada; sin señal, espera con `buy_target` de la watchlist solo como referencia y la decisión no es COMPRAR.
- Pendiente de decisión del usuario: cómo se elige el take profit calculado para el filtro PMP-01 (14% a 36 meses).

### Pendiente

Valuación (con `ficha.valuacion_base`) y Riesgo y Capital; el Auditor aún no lee `valuacion_base` de la ficha.

## v0.23 — PMP-01 recibe sus datos (10-nov-2026)
- Requiere el parche de reglas 8 (`oficina_parche_reglas_pmp_v4.sql`: PMP-01 v2 y PMP-11 v2) ya aplicado.
- `ficha.valuacion_base` **declarada** (`estado:'declarado'`, valor positivo, fuente, fecha AAAA-MM-DD, `horizonte_meses` entero) se publica al Auditor como `valor_estimado_base` y `horizonte_meses` en `datos_fuente`. Si falta o es inválida, no se publica nada y PMP-01 queda NO_EVALUABLE (`dato_faltante`).
- `precio_actual` para PMP = cierre de la última vela diaria **cerrada** (misma regla de cierre del Técnico; la vela del día en formación se descarta). Sin velas o sin poder confirmar el cierre: no se publica precio.
- El 14% ya se evalúa en la corrida PMP `nueva_posicion`. Con el 45 de ejemplo en GKOS dará "incumple" (45 es mucho menor que el precio): reemplázalo por tu estimación real.
- Pendiente (siguiente versión): plan de 2 o 3 salidas de PMP, revisión semestral PMP-11 con el 14% y fundamentales, PMP-05 (nombres de análisis).

## v0.24 — el 14% solo se evalúa con señal de entrada (10-nov-2026)
- Decisión: el valor estimado a 36 meses no se declara hasta que haya señal de entrada de PMP (≥2 de 5 señales).
- La capa de datos publica `senal_entrada_pmp` (booleano, con la cuenta de señales en la fuente) junto al cierre de la última vela cerrada (`datosPmp01`, sustituye a `precioCierreUltimaVela`).
- PMP-01: sin señal → `no_aplica` ("el 14% se evalúa cuando haya señal"); con señal y sin `valuacion_base` → `no_evaluable` motivo `valor_estimado_por_declarar`; con ambos → cálculo del 14% como antes. Sin el dato de señal (entradas antiguas) se evalúa como en v0.23.

## v0.25 — PMP-05 con los análisis reales (10-nov-2026)
- Requiere el parche de reglas 9 (`oficina_parche_reglas_pmp05_v2.sql`): PMP-05 v2 exige `fundamental`, `valuacion`, `tecnico`, `riesgo_capital`.
- Antes, `datos.analisis_presentes` llegaba siempre vacío al Auditor, así que PMP-05 nunca podía cumplir. Ahora el Orquestador (`conAnalisisPresentes`) le entrega solo los NOMBRES de los agentes que terminaron en `ok` (nunca sus salidas); un agente en error queda fuera y PMP-05 lo nombra.
- Pendiente conocido: PLP-01 (sustitución) revisa otros nombres (`calidad_negocio`, `fundamentales`, `dividendos`...) que tampoco coinciden con los agentes; no se toca hasta que lo decidas.
- Pendiente conocido: con la decisión del 10-nov, Valuación no debería ser agente requerido en PMP mientras no haya señal de entrada; hoy lo sigue siendo (por eso GKOS sale BLOQUEADO con `valuacion: error`).

## v0.26 — sin señal de entrada, PMP no corre Valuación (10-nov-2026)
- PMP + nueva_posicion con el detonante `apertura_pmp` NO confirmado (menos de 2 señales): Valuación no corre y deja de ser requerida (no entra en `agentes_requeridos` ni en `analistas_requeridos_sin_resultado`); queda un aviso en la corrida. La decisión es ESPERAR, no BLOQUEADO por `agente_requerido_fallo`.
- Con señal confirmada Valuación corre normalmente y usa `ficha.valuacion_base`. Si el Técnico no es evaluable (sin velas, cierre dudoso) NO se quita nada: no se supone que no hay señal.
- Auditor: con `senal_entrada_pmp = false` PMP-05 no exige `valuacion`.
- No cambia el orden de precedencia: un BLOQUEO_REGLA del Auditor (p. ej. PMP-04 sin rol) sigue prevaleciendo sobre ESPERAR; por eso GKOS necesita su rol en el expediente.

## v0.27 — Riesgo y Capital por código (10-nov-2026)
- Sin IA, sin modelo: `riesgo-capital.ts` compara el `efectivo` de `oficina_v_capital` (del portafolio) con el monto declarado (`-Monto`). VIABLE si efectivo ≥ monto; NO_VIABLE si falta efectivo (con el faltante exacto); DATOS_INSUFICIENTES si falta el monto o el efectivo (o no es un decimal exacto): no se supone nada. No hay otros límites duros definidos todavía.
- Alimenta `motor.capital` (el Motor ya compara efectivo vs. monto y responde ESPERAR `capital_insuficiente`) y entra al Director con la forma de analista (hallazgo positivo/negativo/neutral con evidencia). Ya no falla como `agente_requerido_fallo`. No se guarda en `oficina_analisis` (no es un análisis de IA); queda en la respuesta (`riesgo_capital`) y en la ejecución de la corrida.
- Si `oficina_v_capital` no se puede leer, la corrida sigue: DATOS_INSUFICIENTES con el error como aviso.
- Sin `-Monto` el Motor devuelve NO_EVALUABLE ("Falta el monto de la operación"): ahora conviene correr siempre con `-Monto "50"` en PMP.

## v0.28 — GLB-03 recibe los fundamentos (10-nov-2026)
- GLB-03 (la decisión no se apoya solo en una noticia) quedaba siempre NO_EVALUABLE (`fundamento_no_declarado`) porque nadie declaraba los fundamentos. Ahora, al llamar al Auditor, cada análisis que terminó `ok` con `analisis_id` (Fundamental, Valuación, Técnico) entra a `datos_fuente` como REFERENCIA al análisis guardado (no su contenido; categorías estado_financiero / estimacion / indicador_tecnico) y se lista en `datos.fundamentos`.
- Riesgo y Capital (por código, sin análisis guardado) no se cita. Sin ningún análisis ok, `fundamentos` queda vacío y GLB-03 sigue NO_EVALUABLE (no se finge).
- El sistema no ingiere noticias: GLB-03 cumple siempre que haya análisis de datos. Si algún día entran noticias como fundamento, deberán declararse con categoría `noticia`.
- Lo que sigue bloqueando a GKOS: PMP-04 (rol). PMP-09 (ficha de 11 apartados) queda NO_EVALUABLE hasta que se llene; GLB-02 (rol, no forzoso).

## v0.29 — PMP-09 lee la ficha aprobada (10-nov-2026)
- PMP-09 siempre decía "Ficha sin: todos los apartados" porque nadie le entregaba la ficha al Auditor. Ahora se lee `oficina_expedientes.ficha.ficha_pmp` = `{ <apartado>: { estado: 'aprobado', texto: '...' } }` y se entrega como `datos.ficha_pmp` (booleanos).
- Un apartado cuenta solo con estado exactamente `aprobado` y texto no vacío. Borrador, pendiente o sin texto NO cuentan. Sin `ficha_pmp`, todo queda como antes.
- Apartados: identidad, rol, negocio, rendimiento, volatilidad_riesgo, dividendos_fundamentales, correlacion, plan_ejecucion, decision_final, indices_referencia, competidores.

## v0.30 — reintento con espera ante fallos temporales de Gemini (10-nov-2026)
- Los 503 (UNAVAILABLE) de Gemini tumbaban agentes sueltos (Técnico, Director, Fundamental) en 4 de las últimas 6 corridas. El reintento inmediato de la corrida (1) cae en la misma ráfaga.
- `conReintentoTransitorio` (cliente-gemini.ts) envuelve el cliente de Gemini en el selector de proveedor: ante HTTP 429/500/502/503/504 o error de red espera 2 s y reintenta; si falla otra vez espera 5 s y reintenta (3 llamadas como máximo). NO reintenta claves inválidas (401/403), 400, respuestas bloqueadas, truncadas, vacías ni tiempo de espera agotado.
- El reintento de la corrida (1 por agente) sigue igual encima de esto. En el peor caso un agente tarda ~7 s más.

## v0.31 — Plan de salidas de PMP (posición abierta)

Reglas aprobadas el 10-nov. Solo lectura: la Oficina propone, no vende ni escribe en `trades`.

- **Cuántas salidas:** 2 si lo invertido (suma de compras y recompras) es 50 USD o menos (25% y el resto); 3 si es más (25%, 25% y el resto). Se tolera 1 USD de más por las fracciones de acción (`TOLERANCIA_MONTO`).
- **Niveles planeados:** `take_profit_1..3` del trade; las casillas `tp1_hit..tp3_hit` dicen cuáles ya se hicieron. Un nivel basta solo (precio ≥ nivel de la siguiente salida).
- **Confirmaciones:** RSI sobrecomprado, banda superior de Mogalef y resistencia pasada; se piden DOS. Tras una salida deben ser NUEVAS: no cumplirse en la última vela cerrada anterior a la venta anterior [PROPUESTA de lectura].
- **Porcentajes:** el 25% es sobre la posición que se tenga en ese momento (con las recompras que haya habido); la última salida es VENDER todo lo que queda. Tú marcas «cumplido» el TP en Trades abiertos y la siguiente pasa a evaluarse.
- **Sin datos:** sin velas/cierre no se evalúa y se declara en `datos_faltantes`; un nivel sin declarar o sin poder reconstruir la vela anterior se declara como aviso y el resto sigue valiendo.
- **Archivos nuevos:** `motor/salida-pmp.ts`, `orquestador/senales-previas.ts`, `conexion/salida-pmp-bd.ts` (+ pruebas) y `agentes-ia/refuerzo-v31.test.ts`.
- **Cambios:** nuevo uso `salida_pmp` del Técnico (2 de 3 señales), `corrida.ts` (`datos.salida_pmp`, `referencias.salida_pmp`; el cálculo de código del Técnico corre en PMP abierta), `analisis-guardado.ts` (lee `trades` y `trade_executions`; si no se pueden leer o son inválidos responde 422 sin llamar a ningún modelo).
- **Pantalla /oficina:** el detalle muestra «Plan de salidas (PMP)».
- **Fuera de esta versión:** revisión semestral del 14% y «pierde fundamentales» (PMP-11); la figura chartista sigue siendo confirmación tuya.

## v0.33 — La compra inicial vive en `trades`

La apertura de un trade NO crea fila en `trade_executions` (solo recompras y ventas). Caso real: META en PMP, 615.755 × 0.08099 = 49.87 USD y cero ejecuciones.
- Nuevo `conexion/apertura-trade.ts`: compra inicial = `entry_price × initial_quantity`, redondeada al centavo; si una ejecución de compra ya trae esa cantidad no se suma dos veces.
- `hechos-bd.ts` (hechos del Auditor) y `salida-pmp-bd.ts` (monto invertido del plan de salidas) la usan; `cargarHechosPosicion` lee ahora `trades(id, entry_price, initial_quantity)`.

## v0.34 — Pantalla: plan de salidas más claro

- El plan guarda el precio con el que evaluó y cuántas confirmaciones pide; la pantalla muestra «Precio (último cierre)», la distancia al nivel de la siguiente salida y «Confirmaciones: N de 2».
- El aviso de «no se pudo reconstruir la vela de la venta anterior» ahora dice la causa probable: una salida marcada como cumplida sin venta registrada en el trade.

## v0.35 — La Oficina lee la watchlist (rol, negocio, competidores, portafolios)

- Antes de desplegar, corre `sql/watchlist-oficina-v035.sql` en Supabase (agrega `rol`, `portafolios`, `competidores` a `watchlist`; repetirlo no hace daño). Sin las columnas la corrida sigue y deja el aviso «watchlist: … no se usan rol, negocio ni competidores».
- Página Watchlist: columnas Rol, Portafolios (casillas PMP/PCP/PLP/ETF/SEMILLA) y Competidores; «Notas» pasa a llamarse «Notas / negocio».
- La Oficina lee la fila de la watchlist por ticker (solo lectura):
  - **Rol**: el de la watchlist manda sobre el del expediente (el expediente solo si la watchlist no tiene rol).
  - **Negocio** = texto de Notas. Rol, negocio y competidores llenos cuentan como apartados completos de la ficha de PMP-09 (solo suma, nunca marca incompleto).
  - **Portafolios**: si el portafolio analizado no está marcado, solo avisa; la corrida sigue. También avisa si el ticker no está en la watchlist, está repetido o el rol no es válido.
- Los avisos salen en «Avisos» de la pantalla /oficina.

## v0.36 — Ficha PMP-09 propuesta desde datos

- Cada corrida de PMP calcula un BORRADOR de apartados con lo que ya tiene y lo guarda en `referencias.ficha_propuesta` (la pantalla /oficina lo muestra en «Ficha PMP-09 propuesta (borrador, sin aprobar)»):
  - `identidad` (ticker, mercado, portafolio, rol y negocio de la watchlist), `indices_referencia` (SPY, QQQ, DIA, QUAL), `rendimiento` (1 mes a 3 años según velas) y `volatilidad_riesgo` (volatilidad anualizada, caída máxima, distancia al máximo; mínimo 60 retornos).
  - NO propone `dividendos_fundamentales`, `correlacion`, `plan_ejecucion` ni `decision_final`: los declara como no propuestos.
- Un borrador NO cuenta para PMP-09. Se aprueba con `sql/aprobar-ficha-pmp-v036.sql` (probado en Postgres): copia los textos de la última corrida PMP del ticker a `ficha.ficha_pmp.<apartado>` con estado 'aprobado'; también acepta tus propios textos. Lo que no listas no se toca; se puede repetir.
- Rol, negocio y competidores siguen viniendo de la watchlist (v0.35).

## v0.37 — Botón «Ficha PMP» en la watchlist (aprobar la ficha PMP-09 sin SQL)

- `app/watchlist/BotonAprobarFicha.tsx`: componente con todo el código (ventana con el borrador de la última corrida PMP del ticker, casillas para aprobar identidad/rendimiento/volatilidad_riesgo/indices_referencia, y cuatro cajas para lo que escribes tú: dividendos_fundamentales, correlacion, plan_ejecucion, decision_final). La página solo dibuja `<BotonAprobarFicha ticker=... />` (3 líneas: import, botón de escritorio y botón de celular).
- `app/api/oficina/ficha/route.ts`: GET estado y POST aprobar. Usa la sesión del usuario (RLS), solo dueño; solo escribe `ficha.ficha_pmp` del expediente PMP del ticker. Si la base no deja actualizar (0 filas) responde 403 con el mensaje.
- Lógica pura y probada: `conexion/ficha-aprobacion.ts` y `conexion/ficha-aprobacion-bd.ts`. Solo se aprueba lo que se pide; un texto vacío no aprueba ni borra; lo aprobado antes se conserva.

## v0.38 — plan_ejecucion y decision_final propuestos con las reglas de PMP

- La corrida de PMP propone también `plan_ejecucion` (entrada 50 USD con 2 de 5 señales, Auditor CUMPLE y 14% anualizado; salidas de 2 o 3; niveles TP1–TP3) y `decision_final` (la Oficina propone y el usuario autoriza; revisar la venta del 100% si el semestral baja de 14% o pierde fundamentales). Ambos salen de las reglas aprobadas el 10-nov y se aprueban con el botón como los demás.
- Quedan para escribir a mano solo `dividendos_fundamentales` y `correlacion`.
- Las corridas anteriores a esta versión no traen esos dos borradores: hay que correr el ticker otra vez.

## v0.39 — Botón «Analizar en la Oficina» en la watchlist

- `app/watchlist/BotonAnalizarOficina.tsx` (icono ▶): hace lo mismo que `analizar-fundamental.ps1 -ConToken -Guardar` desde la página: llama a `/api/oficina/analisis-fundamental` con ticker, portafolio (el marcado en la fila, o PMP), monto (PMP 50, PCP 25, editable) y guarda la corrida. Muestra decisión, estado, veredicto del Auditor y motivos, con enlace a /oficina. No compra ni vende.
- La página solo suma el import y dos botones (escritorio y celular).
- El servidor sigue limitando a un análisis cada 30 s.

## v0.40 — Ficha PMP-09: dividendos, fundamentales y correlación automáticos

- La corrida de PMP ahora reúne sola, sin bloquearse si algo falla:
  - dividendos del ticker por `/api/dividends` (la misma ruta de las gráficas de /chart; 10 años);
  - un resumen de fundamentales con las cifras que ya baja la corrida (ingresos, utilidad neta, márgenes, razón corriente y prueba ácida);
  - las velas diarias de SPY, QQQ, DIA y QUAL por `/api/chart-data` (4 llamadas más a TwelveData por análisis de PMP).
- Apartados nuevos del borrador: `dividendos_fundamentales` (pagos, último pago, total y rendimiento sin anualizar como en la gráfica, más fundamentales) y `correlacion` (correlación de retornos diarios con cada índice, hasta 252 días en común; mínimo 120).
- Un error al consultar dividendos NO se interpreta como «sin dividendos»: el apartado no se propone y se dice por qué. Igual con fundamentales o índices sin datos.
- Ya no hay apartados que escribas a mano: el botón de la ficha propone los 8 y tú apruebas.

## v0.41 — Fundamental parcial sin flujo de caja
- Si el snapshot no trae NINGÚN item `flujo_*` (p. ej. SE, emisor 20-F: Finnhub financials-reported no tiene sus reportes), el Fundamental ya no cae en NO_EVALUABLE: evalúa crecimiento, rentabilidad y balance, pone `subpuntajes.flujo_caja` en null y declara `datos_faltantes: flujo_caja` con `critico` false (confianza topada).
- El validador solo acepta ese null si no hay items `flujo_*` y el faltante está declarado como no crítico; cualquier otra dimensión en null sigue exigiendo NO_EVALUABLE.
- Sin items de crecimiento, rentabilidad o balance sigue siendo NO_EVALUABLE.
- Archivos: validar-fundamental.ts, prompts.ts, refuerzo-v41.test.ts (nuevo), refuerzo-v06.test.ts (1 línea).

## v0.42 — Motor de la revisión semestral PMP-11 (módulo puro, aún no conectado)
- `lib/oficina/motor/revision-pmp.ts`: `rendimientoAnualizado` ((valor estimado ÷ cierre)^(12/36) − 1; mínimo 14%, comparado redondeado a 2 decimales), `perdidaDeFundamentales` (2 de 4: ingresos/márgenes, deuda +25 pp sobre ingresos, FCF negativo 4 trimestres o 2 años, deterioro de activos > 5%), `revisionSemestralPMP` → `revisar_venta_100 | mantener | no_evaluable`, `venta_automatica` siempre false.
- Criterio sin datos = no_evaluable (nunca se supone). 1 deterioro + algún criterio sin datos = NO_EVALUABLE.
- [PROPUESTA] umbrales del criterio 1 (no fijados): ingresos TTM −10% o margen operativo −5 pp contra el año previo.
- Pendiente: conectarlo a una corrida `revision_tesis` (datos: valuacion_base vigente, cierre, ingresos/deuda/FCF/deterioro de Finnhub y Webull) y mostrarlo en /oficina.

## v0.43 — Revisión semestral PMP-11 conectada (solo lectura)
- `POST /api/oficina/revision-pmp { ticker }` y panel «Revisión semestral PMP (PMP-11)» en /oficina (`app/oficina/RevisionPmp.tsx`). No guarda ni vende; devuelve `revisar_venta_100 | mantener | no_evaluable`.
- Valor estimado = `ficha.valuacion_base` del expediente PMP (declarado por el usuario); cierre = última vela diaria cerrada; fundamentales = Webull + Finnhub (mismos items del Fundamental).
- Los fundamentales comparan los DOS ÚLTIMOS años fiscales consecutivos. Aún sin datos (quedan no_evaluable): FCF por trimestre y deterioro de activos.
- Renombrados los campos del módulo del motor: `ingresos_actual`, `ingresos_previo`, `margen_operativo_actual`.
- Archivos: motor/revision-pmp.ts(+test), conexion/revision-pmp-datos.ts, revision-pmp-bd.ts, revision-pmp.test.ts, app/api/oficina/revision-pmp/route.ts, app/oficina/RevisionPmp.tsx. `app/oficina/page.tsx` requiere 2 líneas a mano (import y `<RevisionPmp />`).

## v0.45 — PMP-11: flujo de caja por trimestre y deterioro de activos; avisos de datos en el botón
- `conexion/revision-pmp-finnhub.ts`: FCF por trimestre desde los reportes de Finnhub (acumulado del año fiscal → trimestre por diferencia; Q4 = anual − acumulado Q3; 4 trimestres consecutivos o null) y deterioro de activos del último FY (suma de partidas de deterioro del flujo de caja en USD).
- [PROPUESTA] flujo de caja anual completo (trae flujo operativo) sin partidas de deterioro = 0 deterioro; flujo incompleto = NO_EVALUABLE.
- El deterioro se compara con los activos totales del mismo año fiscal.
- El botón ▶ muestra «Avisos de datos» (antes solo salían por PowerShell) para diagnosticar fuentes sin abrir la consola.

## v0.47 — Finnhub entrega la unidad como `usd`
- Diagnóstico con META (10-K): todos los conceptos de balance y flujo de caja se descartaban porque `unit` llegaba como `usd` (no `u_usd`). `esUnidadUsdFinnhub` ahora acepta `usd` exacta; `usdPerShare`, `shares` y mayúsculas siguen rechazadas.
- Consecuencia: balance, flujo de caja y FCF aparecen para los emisores de 10-K; los de 20-F (SE) pueden seguir sin ellos.
- v0.46 hizo que el aviso diga qué unidad llegó (por eso se pudo ver).

## v0.48 — Revisión PMP-11: deuda sin parte corriente
- Si algún año no trae deuda corriente (META), el criterio «deuda vs ingresos» compara solo la deuda de largo plazo en los dos años (misma base) y lo avisa; no se supone cero.

## v0.49 — Revisión PMP-11: el valor estimado son los take profit del trade
- Decisión del usuario (14-nov): valor estimado vigente = take profit registrados. Se toma el TP más lejano (TP1..TP3 > 0) del trade abierto único del ticker (`trades`, status open). Con 0 o 2+ trades abiertos o sin TP, cae a `ficha.valuacion_base` y lo avisa.
- Horizonte 36 meses (el aprobado), no el tiempo restante.
- Panel de /oficina: muestra de dónde sale el valor estimado.

## v0.50 — PMP-11 usa el modelo de valuación de /position
- Corrección del usuario (15-nov): el 14% se mide con la «Ganancia anualizada» de ValuationModelsCard (P/E objetivo × EPS a N años), no con los take profit. Se quitó la lectura de take profit.
- `conexion/valuacion-modelos.ts` replica la fórmula de la tarjeta (P/E histórico = promedio de cierre cercano ÷ EPS por año con tope de 10 días; si no hay, P/E actual; EPS a 1 año = estimado de analistas si existe, si no EPS TTM × (1+CAGR acotado 4–12%)^N). Fuentes: /api/fundamentals, /api/webull/income-statement y POST /api/chart-data.
- Horizonte por omisión 1 año (como la tarjeta); el panel de /oficina trae selector 1–10. El precio de comparación es el último cierre cerrado (la tarjeta usa el precio vivo del trade: puede diferir unos decimales).
- Si el modelo no se calcula, cae a `ficha.valuacion_base` y lo avisa. `FetchDatos` admite ahora `method` y `body` (POST).

## v0.51 — Panel de revisión PMP-11 sin escribir el ticker
- `app/oficina/RevisionPmp.tsx` lista solo las posiciones abiertas cuyo portafolio se llama PMP (tabla `trades`, status open, join `portfolios(name)`); la primera queda elegida. Botón «Revisar todas (N)» las revisa una por una (6 s entre consultas por el límite del servidor). Sin posiciones detectadas vuelve al campo de texto.

## v0.52 — Panel PMP-11: cualquier ticker
- El campo es un input con lista (datalist) de las posiciones PMP abiertas: se puede escribir cualquier ticker; no requiere corrida previa ni expediente (el expediente solo se lee como respaldo de `valuacion_base`).

## v0.53 — Guardar la revisión PMP-11 (cierra PMP-11)
- Cada revisión se guarda en `oficina_expedientes.ficha.revisiones_pmp11` (últimas 24; una por día, la del mismo día se reemplaza). No toca el resto de la ficha ni crea expedientes: sin expediente PMP único, la consulta no se guarda y lo dice.
- Usa tu sesión y el permiso «propias»; si la base no actualiza exactamente 1 fila, avisa en vez de fingir que guardó.
- La ruta acepta `guardar: true`; el panel trae la casilla «Guardar en el historial» (marcada), un calendario semestral de tus posiciones PMP abiertas (sin revisar / al día / vencida, próxima = última + 6 meses) y el historial por ticker.
- Sigue siendo una tarea de revisión: nunca vende ni compra.

## v0.54 — Confianza estable del Fundamental
- Causa de la variación (0.9 / 0.6 / 0.5 con los mismos datos): el snapshot trae avisos de datos ausentes (p. ej. deuda corriente o arrendamiento sin concepto en la fuente) y a veces el modelo los declaraba en `datos_faltantes` (tope de confianza 0.6) y a veces no (0.9).
- Ahora, si algún aviso del código dice que falta un dato («sin concepto», «sin dato», «no viene en la fuente», «se omite»), el validador rechaza `datos_faltantes` vacío y el modelo reintenta declarándolo (no crítico). Resultado: con avisos la confianza queda siempre en el tope o debajo; sin avisos no cambia nada.
- El tope (0.6) no se modificó. Si algún día se quiere distinguir faltantes menores (p. ej. arrendamiento) de los importantes, es una decisión aparte.

## v0.55 — El Fundamental cita flujo de caja y balance
- Antes, con los mismos datos, una corrida de META daba ACEPTABLE 75 (sin citar FCF ni razón corriente) y otras SOLIDO 85 (citándolos).
- Ahora, si hay items de flujo de caja (`flujo_*`) o de balance (razón corriente, deuda, activos, pasivos, patrimonio, efectivo) y el subpuntaje de esa dimensión se puntúa, algún hallazgo debe citar uno en su `evidencia`; si no, el validador rechaza y el modelo reintenta. Sin items de esa dimensión no se exige nada.
- Puede subir en uno el número de reintentos de algunas corridas.

## v0.56 — Valuación por código para PMP
- El analista `valuacion` (que PMP-05 exige cuando hay señal de entrada) era «no implementado todavía». Ahora, en una posición PMP NUEVA, se calcula por código con el mismo modelo de `/position` (P/E objetivo × EPS), a 3 años = 36 meses, con el cierre de la última vela cerrada.
- Veredicto del analista (solo descriptivo): ganancia anualizada ≥ 14% = BARATA, menos = RAZONABLE, modelo no calculable = NO_EVALUABLE. Nunca CARA: el 14% lo decide PMP-01 (Auditor), no se bloquea dos veces.
- PMP-01 recibe como `valor_estimado_base` el precio objetivo del modelo y horizonte 36 meses; ya no pide declararlo en la ficha. Si el modelo no se puede calcular (EPS no positivo, sin datos), se usa lo declarado en `valuacion_base`; si tampoco hay, PMP-01 sigue NO_EVALUABLE y lo dice.
- La respuesta de la corrida trae `valuacion` (precio objetivo, ganancia anualizada, fuente). Agrega 1 consulta POST (chart-data) y 2 GET (fundamentals, income-statement) por corrida de PMP nueva.
- Solo PMP con posición nueva; las posiciones abiertas no cambian (su revisión es PMP-11).

## v0.57 — Límite de consultas (429) y orden de los índices
- En la corrida de PH, DIA y QUAL salieron «sin velas»: TwelveData permite 8 consultas por minuto y la corrida pedía muchas a la vez (ticker diario y semanal, 4 índices y, desde v0.56, la valuación).
- Ahora una consulta de velas rechazada con HTTP 429 espera 12 s y se reintenta UNA vez (diarias, semanales e índices). Otros errores no se reintentan ni esperan.
- Los 4 índices de referencia de la ficha se piden de uno en uno (antes juntos).
- `DepsDatosReales.esperar` es opcional (por omisión espera de verdad); las pruebas lo inyectan para no esperar.
- Si un ticker sigue sin velas tras el reintento, la ficha lo sigue declarando como «sin dato», sin inventar nada.

## v0.58 — Aprobar la tesis que propone el Director
- El Director ya podía proponer una tesis (primera o cambio, clasificada por código), pero no había forma de aprobarla. Ahora, en el detalle de una corrida de `/oficina`, si el Director propuso tesis aparece el texto y el botón «Aprobar tesis» (componente `app/oficina/TesisPropuesta.tsx`).
- Al aprobar: `oficina_expedientes.tesis_vigente` = texto, `tesis_version` + 1, y se agrega una entrada a `ficha.tesis_historial` (versión, texto, corrida de origen, tesis anterior, fecha). Las versiones previas no se pierden. `tesis_origen` no se toca.
- Solo con tu sesión (RLS), solo el expediente de esa corrida, verificando que se actualice exactamente 1 fila y con la versión leída como condición (si cambió entretanto: 409, no pisa). La misma propuesta no se aprueba dos veces. No cambia ninguna decisión ni opera.
- Rutas: `GET /api/oficina/tesis?corrida_id=…` (estado) y `POST /api/oficina/tesis { corrida_id }` (aprobar).
- Desde ahora la tesis aprobada (texto, versión, origen) llega al Fundamental en las corridas nuevas para que marque qué se mantiene, se debilita o se rompe (`cambios_vs_tesis_vigente`). Si `tesis_vigente` no se puede leer como texto, se sigue sin tesis (no se inventa).
- Supuesto a confirmar: la columna `tesis_vigente` acepta un texto (sirve si es `text` o `jsonb`).

## v0.59 — Alertas de la Oficina (revisión PMP-11 vencida y señal técnica nueva)
- Las alertas de TP/stop y de entrada de la watchlist siguen como estaban (Edge Functions `update-trades` y `update-ia` → `/api/notify` → Resend). Estas dos son nuevas y salen por el mismo camino.
- **Revisión PMP-11 vencida**: para cada posición PMP abierta, vence 6 meses después de su última revisión guardada (`ficha.revisiones_pmp11`); si nunca se revisó, el 2027-04-06 (primera revisión formal de la regla). Avisa por correo y repite como máximo cada 7 días mientras siga vencida. No hace consultas externas.
- **Señal técnica nueva**: un ticker de la watchlist pasa de menos de 2 a 2 o más de las 5 señales de entrada de PMP (cierre de la última vela cerrada, mismo Técnico de la Oficina). Una revisión por ticker y por día, como mucho 2 tickers por corrida (TwelveData permite 8 consultas por minuto). La primera observación de un ticker solo se guarda (no avisa, para no inundar al activar). Si el correo no sale, no se guarda el estado y se reintenta.
- El Técnico corre en Next.js, no en Deno: la Edge Function `update-ia` llama a `POST /api/oficina/senal` (autorizada con `x-notify-secret`) y es ella quien guarda el estado y manda el correo. La ruta solo calcula; no guarda ni envía nada.
- Estado en la tabla nueva `oficina_alertas_estado` (SQL `sql/oficina-alertas-v059.sql`), accesible solo con la clave de servicio.
- `lib/oficina/alertas/alertas-oficina.ts` y `supabase/functions/update-ia/alertas-oficina.ts` son el MISMO archivo (la Edge Function no puede importar de `lib/`); una prueba falla si difieren. Si cambias uno, copia el otro.
- Hay que pegar a mano los cambios de `app/api/notify/route.ts` y `supabase/functions/update-ia/index.ts`: ver `lib/oficina/alertas/PEGADOS-v059.md`.

## v0.60 — La tesis solo se propone con un cambio real; la ficha lee el rol del expediente
- **Tesis.** Con tesis vigente, el Director a veces reescribe la misma tesis con otras palabras. Ahora el código mira lo que el Fundamental comparó contra la tesis que recibió (`cambios_vs_tesis_vigente`): si todos los puntos son `se_mantiene`, la clasificación queda `sin_propuesta` y no aparece el botón «Aprobar tesis». Si algún punto es `se_debilita` o `se_rompe`, sigue siendo `cambio_de_tesis`. Si no hay comparación válida (sin lista, lista vacía, estado raro, Fundamental con error), se ofrece como antes: la duda nunca oculta una propuesta. La primera propuesta (sin tesis vigente) no cambia.
- La anotación del Director en `anotaciones_codigo` agrega `cambio_marcado_por_fundamental` (true, false o null). La propuesta original del modelo queda guardada sin tocar.
- **Ficha PMP-09, identidad.** El rol sale de la watchlist; si no hay, del expediente (`rol_posicion`, el mismo que ve el Auditor). Solo queda «rol sin definir» si ninguno lo tiene.
- Tests: `refuerzo-v60.test.ts`.

## v0.61 — Botón ▶ sin cuadro previo y tesis vigente siempre visible
- `app/watchlist/BotonAnalizarOficina.tsx` (watchlist y Trades abiertos): el portafolio ya está declarado en la fila y el monto es fijo (PMP 50, PCP 25; posición abierta sin monto), así que al dar clic el análisis arranca de inmediato y se abre la ventana con «No cierres esta ventana», el resultado y «Analizar otra vez». Solo si el portafolio no se decide solo (ninguno o más de uno marcado en la watchlist; en Trades abiertos, un nombre que no se reconoce) se abre la ventana con el selector y el monto, como antes. En Trades abiertos el portafolio se reconoce por código (PMP, PCP, PLP, ETF, SEMILLA) o por plazo (corto = PCP, mediano = PMP, largo = PLP).
- `app/oficina/TesisPropuesta.tsx`: sin propuesta en la corrida, muestra la tesis vigente (versión y texto) sin botón.

## v0.62 — Montos por portafolio y reglas que no aplican
- Botón ▶: monto fijo PMP 50, PCP 25, SEMILLA 5. PLP y ETF no llevan monto (sus activos ya están comprados; una sustitución entra con lo que dejó la venta) y no muestran el aviso de «sin monto». La posición abierta sigue sin monto.
- `/oficina`, «Reglas del Auditor»: las reglas con resultado `no_aplica` ya no se listan; queda una línea plegada «N reglas no aplican a esta corrida» con sus códigos. Los datos guardados no cambian.

## v0.63 — La valuación por código queda visible en /oficina
- La corrida guarda en sus referencias (`referencias.valuacion_modelo`) el cálculo de valuación de PMP para una posición nueva: P/E objetivo y su origen, EPS a 3 años y su origen, precio objetivo, cierre usado, ganancia total y ganancia anualizada. `valuacionDe` (corridas-lectura) lo lee y `/oficina` lo muestra en la sección «Valuación por código (modelo de /position)».
- Se puede cotejar a mano: precio objetivo = P/E × EPS; anualizada = (precio objetivo / cierre)^(1/3) − 1. Las corridas anteriores a v0.63 no lo traen: hay que correrlas otra vez.
- No cambia ninguna decisión ni el Auditor; solo muestra lo que ya se calculaba. Sin migración de base de datos.

## v0.64 — Una sola «última vela cerrada» para valuación, ficha y revisión
- Antes, la valuación por código, la ficha PMP-09 y la revisión semestral descartaban siempre la vela de la fecha de hoy; el Técnico y el Auditor (PMP-01) usan `confirmarCierreVelas` (calendario NYSE + margen de 30 min), que da por cerrada la vela de hoy después del cierre. Resultado en PH: 4.86% con el cierre del día anterior (934.80) y 5.39% con el de hoy (920.84) en la misma corrida.
- `lib/oficina/conexion/velas-cerradas.ts` (`velasDiariasCerradas`) aplica la regla del Técnico: última vela `confirmada` → se conserva; `en_formacion` → se descarta; si no se puede decidir (calendario, instante inválido) → regla anterior. La usan `analisis-guardado.ts` (valuación), `ficha-propuesta.ts` (con el nuevo parámetro `ahora`; sin él conserva la regla anterior) y `revision-pmp-bd.ts`.
- La decisión no cambia por esto (en PH ambos porcentajes están bajo 14%), pero ahora todo el informe habla del mismo cierre. Las series de los índices de la correlación no se tocaron (se cruzan por fecha común).
- Tests: `velas-cerradas.test.ts`.

## v0.64a — Catálogo de PCP alineado al Técnico
- `catalogo-fixture.ts` y el SQL `parche-catalogo-v064a.sql` (PCP-04 v3, PCP-06 v3, PCP-10 v2, vigentes desde 2026-11-18): PCP-04 usa NIVEL_PASADO (pivotes de mínimo y de máximo, ±1.5%) en lugar de soporte_resistencia_pasado; PCP-06 usa RESISTENCIA_PASADA (solo pivotes de máximo) y la banda superior de Mogalef como «cierre estrictamente mayor que la banda de la vela anterior, una señal por racha»; la banda inferior (PCP-04, PCP-10) es «cierre estrictamente menor que la banda de la vela anterior».
- PCP-09 v1 está archivada sin vigencia (nunca estuvo vigente); no existe una regla PCP-09 vigente. PLP-03 conserva el texto viejo de Mogalef inferior (es la misma señal).

## v0.65 — Salida de PCP conectada a tus trades
- Antes el Motor sabía evaluar la salida de PCP (`evaluarSalidaPCP`) pero ninguna corrida real le daba compras, plan ni niveles. Ahora una posición PCP abierta lee de la base (solo lectura): la apertura de `trades` (entry_price × initial_quantity), las recompras y ventas de `trade_executions`, `take_profit_1..3` con `tp1_hit..tp3_hit`, `stop_loss` y `ficha.plan_pcp` (solo si está «declarado»). Adaptador: `lib/oficina/conexion/salida-pcp-bd.ts`.
- Regla aprobada el 18-nov: PCP sale por señal Y por los TP de `trades`. Una compra: señal o TP1 vende 100%. Dos o tres compras: primera salida REDUCIR 50% cuando el precio supera el costo promedio ponderado y, si el trade tiene TP1 sin cumplir, también alcanza TP1 (por lo regular TP1 = costo promedio; si queda por encima, manda TP1; la señal sola no adelanta la primera salida; decidido el 18-nov); después VENDER el resto con una señal o TP2/TP3. TP1 no vende el resto. Un nivel marcado «cumplido» no vuelve a disparar. La primera salida se considera hecha si hay una venta registrada.
- Stop: es solo referencia. En plan escalonado, con el precio en o bajo el stop y menos de 3 compras, aparece el aviso «zona de posible recompra» (quedan 3 − compras recompras). En plan de una compra el stop sigue vendiendo (PCP-07). Sin plan declarado el stop no se evalúa y se avisa. Nunca compra ni vende sola.
- El precio es el cierre de la última vela cerrada del Técnico (como PMP). El resultado completo queda en `referencias.salida_pcp` de la corrida y /oficina lo muestra en «Salida (PCP)».
- Con una posición PCP abierta, un dato ilegible o inválido (compra sin precio o cantidad, nivel no numérico, modalidad de plan inválida) detiene la corrida antes de llamar a ningún modelo; nada se rellena.
- Tests: `motor/salida-pcp.test.ts`, `conexion/salida-pcp-bd.test.ts`, `corridas-lectura.test.ts` y 2 casos nuevos en `orquestador/corrida.test.ts`. Sin migración de base de datos.

## v0.66 — Plan de PCP deducido de tus trades
- Antes, una posición PCP sin `ficha.plan_pcp` declarado daba PCP-07 NO_EVALUABLE y la salida no evaluaba el stop. Ahora, si la ficha no declara el plan, se deduce de las compras reales (`lib/oficina/conexion/plan-pcp.ts`): una sola compra = «una_compra»; con recompras = «escalonado». Una evaluación de recompra implica «escalonado» (la primera recompra no se bloquea por tener todavía una compra). Lo declarado en la ficha siempre manda.
- Lo usan el Auditor (`entrada-auditor.ts`, solo PCP con posición existente) y la salida de PCP (`salida-pcp-bd.ts`, con un aviso «se deduce de tus trades» en /oficina). El detalle de PCP-07 sigue diciendo «Plan declarado: …» aunque venga deducido; el aviso de la sección «Salida (PCP)» es quien lo aclara.
- Consecuencia: una posición PCP con una sola compra y sin plan declarado se trata como «una compra»: tocar el stop da VENDER (PCP-07), antes no se evaluaba.
- El reparto mensual PCP-08 queda fuera de la Oficina por decisión del 18-nov (lo haces a mano, sin botón ni aviso).
- Tests: `plan-pcp.test.ts`, `salida-pcp-bd.test.ts` y un caso nuevo en `conexion.test.ts`.

## v0.67 — PCP-01: el historial del gráfico sale de las velas
- Hallazgo al revisar la apertura de un PCP nuevo (nunca se había corrido): PCP-01 pide `historial_grafico_anios` y nada lo declaraba, así que la apertura de PCP daba siempre NO_EVALUABLE crítico (el Auditor no dejaba llegar a COMPRAR).
- `lib/oficina/conexion/historial-pcp.ts`: de las velas diarias ya leídas (TwelveData vía chart-data) declara dos datos para el Auditor: años del historial = (última vela − primera) / 365.25 días, TRUNCADO a dos decimales (4.9993 no pasa como 5.00), y `historial_grafico_completo` (true si llegaron menos de 2500 velas, el máximo que devuelve la ruta; con 2500 el historial supera los 9.9 años, así que el mínimo de 5 se cumple igual). Sin velas no declara nada y PCP-01 sigue NO_EVALUABLE.
- Solo en PCP nueva_posicion (`entrada-auditor.ts`). Tests: `historial-pcp.test.ts` y un caso en `conexion.test.ts`.
- Pendiente (decisión de Jaime): PCP-07 en la apertura sigue NO_EVALUABLE porque aún no hay compras de las que deducir el plan.

## Watchlist: competidores en 4 casillas (v0.65b)
- `lib/competidores.ts` (+ test): máximo 4 tickers, validación (vacías se ignoran; inválido, el propio ticker o repetido se rechazan), clasificación: posición abierta (amarillo) > en watchlist (verde) > ninguno.
- `app/watchlist/CompetidoresCeldas.tsx`: clic en la columna abre 4 casillas (Enter guarda, Esc cancela). Guarda en `watchlist.competidores` como «A, B, C».
- `page.tsx` lee `trades` con status open para el amarillo; `BotonAnalizarOficina` bloquea ▶ si no hay ningún competidor (solo cuando la fila pasa la prop).
- Texto existente con más de 4 tickers se recorta a 4 al guardar.

## v0.67b: PCP-07 en la apertura
- En `nueva_posicion` sin plan declarado, PCP-07 da CUMPLE («el plan se deduce de tus trades después de abrir»). Motivo: la posición aún no existe, así que no hay trades de dónde deducirlo (primera corrida real: FSLR quedó NO_EVALUABLE solo por esto).
- Recompra / posición abierta sin plan siguen siendo NO_EVALUABLE (ahí el plan sí se deduce en v0.66).

## v0.68a: apertura de PCP exige dos señales (PCP-10)
- `MINIMO_SENALES_POR_USO.apertura_pcp` pasa de 1 a 2 (igual que `apertura_pmp`). Motivo: FSLR (RSI + Koncorde) dio COMPRAR con el Técnico en ESPERAR; ahora hacen falta 2 de las 4 señales de entrada (RSI, Koncorde, EMA8>EMA21, Mogalef inferior). NIVEL_PASADO no cuenta.
- Recompra PCP, salida PCP y DCA de PLP siguen con 1.
- Catálogo: fixture y `parche-catalogo-v068a.sql` (PCP-10 `cuantos_deben_coincidir` 2, vigente desde 2026-11-19).
- Ojo: el Técnico cuenta RSI y Koncorde como señales separadas, aunque el catálogo las agrupa en «sobreventa».
- v0.68a (ajuste de test): en `corrida.test.ts` la serie «onda lenta» da solo 1 señal de apertura PCP, así que el caso «cada caso usa su propio uso del detonante» espera `detonante_confirmado: false` para PCP apertura.

## v0.68: alerta de entrada de PCP
- `conexion/senal-pmp.ts`: la misma consulta de `/api/oficina/senal` devuelve además `pcp` (uso `apertura_pcp`, al menos 2 de 4 señales). Sin consultas extra a TwelveData.
- `alertas/alertas-oficina.ts` (copiado idéntico a la Edge Function): lee de `watchlist` los tickers con `PCP` en `portafolios`; para ellos guarda un estado propio (`senal_pcp:TICKER`) y avisa «🟢 SEÑAL TÉCNICA NUEVA (PCP)» solo al pasar de no confirmada a confirmada. La primera observación solo se guarda. Si falla la consulta queda «sin dato».
- Un ticker marcado PCP se revisa aunque su señal de PMP ya se haya revisado hoy. La alerta de PMP no cambia.
- A mano: un pegado en `supabase/functions/update-ia/index.ts` (ver `alertas/PEGADOS-v068.md`).
- Pendiente (v0.69): señal de salida y «zona de posible recompra» para posiciones PCP abiertas.

## v0.68b: watchlist con casillas PMP y PCP
- Columna «Portafolio»: dos casillas (PMP, PCP) en vez del selector de 5 opciones. Se pueden marcar las dos. `lib/portafolios-watchlist.ts` (+ test) y `app/watchlist/PortafoliosCasillas.tsx`.
- Los códigos viejos (PLP, ETF, SEMILLA) que un ticker ya tuviera guardados se muestran en gris («+PLP») y se conservan al marcar o desmarcar; la pantalla ya no ofrece marcarlos nuevos.
- ▶ con PMP y PCP marcados: corre PMP (50 USD) y luego PCP (25 USD), una tras otra, y la ventana muestra el resultado de cada una. Un 429 se reintenta una vez a los 12 s. Con un solo portafolio marcado corre directo, como antes; con otra mezcla (p. ej. PMP + PLP) sigue el selector manual.
- Se guarda en la misma columna `watchlist.portafolios` (arreglo): la Oficina y la alerta de entrada PCP la leen igual.

## v0.68c: dos arreglos de la primera corrida PMP + PCP
- Finnhub: dos cierres distintos con el mismo `year` (ejercicio de 52/53 semanas o cambio de cierre) generaban ids repetidos (`efectivo_fy2023`…) y el sobre del Fundamental era inválido («items[92].id repetido»). Ahora se conserva el cierre más reciente y se avisa (`fyAAAA: dos cierres distintos… comparten el año fiscal`). Test nuevo en `datos-finnhub.test.ts`.
- Botón ▶ con PMP + PCP: el servidor exige 30 s entre análisis contados desde que EMPIEZA el anterior; si PMP fallaba pronto, PCP recibía 429 y el reintento de 12 s no alcanzaba. Ahora se espera lo que falte hasta 31 s entre un portafolio y otro, y el reintento ante un 429 espera 31 s.

## v0.68d: portafolio según el rol (reemplaza las casillas de v0.68b) y Técnico con datos_fuente completado
- Columna «Portafolio» de la watchlist: solo se muestra. PMP y PCP siempre aparecen: gris opaco = no considerado, verde = considerado. Lo decide el rol: crecimiento = PCP, flujo = PMP, mixto = PMP + PCP (`lib/portafolios-watchlist.ts`, `app/watchlist/PortafoliosEtiquetas.tsx`). Se borra `PortafoliosCasillas.tsx`.
- Al cambiar el rol se guardan rol y `portafolios` en una sola actualización (si falla, vuelven los dos). El ▶ usa los portafolios del rol; sin rol abre el selector manual. Para filas viejas: `sincronizar-portafolios-por-rol.sql` (primero solo lista).
- Técnico (IA): si el modelo cita en `evidencia` un id que SÍ existe en los datos calculados pero olvidó listarlo en `datos_fuente` (falló así en SCCO/PMP: «evidencia apunta a un id que no está en datos_fuente: senal_RSI_SOBREVENTA…»), `completarDatosFuente` lo agrega idéntico al calculado antes de validar. Un id inexistente se sigue rechazando; el validador no cambió.

## v0.69: alertas de salida y zona de recompra de PCP
- `POST /api/oficina/senal-salida` (`conexion/senal-salida-pcp.ts`): calcula para un trade PCP abierto lo mismo que la corrida (Técnico `senal_salida` + `evaluarPlanSalidaPCP`, con trade, ejecuciones y ficha que le pasa la Edge Function). Solo lectura.
- `alertas/alertas-oficina.ts` (copia idéntica en la Edge Function): lee los trades abiertos de portafolios PCP, y por trade y día pide el cálculo al servidor. Avisa «🔴 SALIDA PCP» (VENDER/REDUCIR con su motivo) o «🟡 ZONA DE RECOMPRA PCP» solo cuando LO QUE DICE EL PLAN CAMBIA (firma distinta de la última avisada; aunque sea la primera vez que se ve). No repite el mismo aviso; cuando deja de haber salida, se rearma. Estado en `oficina_alertas_estado` con clave `salida_pcp:<trade_id>`. Si falla el servidor o el correo no se guarda nada y se reintenta.
- Máximo 2 trades por corrida de la Edge Function. Nunca vende: el correo dice que tú decides y que registres la venta y marques el TP.
- A mano: un pegado en `supabase/functions/update-ia/index.ts` (ver `alertas/PEGADOS-v069.md`).
- Los avisos de salida usan los tipos «🔴 SALIDA PCP» y «🟡 ZONA DE RECOMPRA PCP» (sin las palabras ENTRADA/SEÑAL, que `/api/notify` trata como alerta de entrada).

## v0.69b: rol automático de las posiciones abiertas (GLB-02)
- Una posición ABIERTA toma el rol de su portafolio: PCP = crecimiento, PMP = flujo (`ROL_POR_PORTAFOLIO` en `conexion/hechos-bd.ts`). Manda sobre el rol de la watchlist y del expediente, así GLB-02 (y PMP-04) ya no dependen de que el ticker siga en la watchlist. Una posición nueva sigue usando el rol de la watchlist; otros portafolios no cambian.
- `flujo-auditoria.ts` pasa `portafolio_codigo` a `cargarHechosPosicion`.

## v0.70: entradas de PCP pulidas (segunda versión)
- Sin MACD en la apertura (PCP-10) ni en la recompra (PCP-04): ya no sale como confirmación pendiente; lo revisas tú fuera de la Oficina. La salida de PCP no cambia.
- Dos señales nuevas del Técnico (código, velas diarias cerradas), solo en `apertura_pcp` (ahora 6 posibles, mínimo 2): `REBOTE_SMA_100_200` (el mínimo de la última vela está a ≤ SMA +1% y cierra por encima; vale la SMA 100 o la 200, es UNA señal; con menos de 200 velas evalúa solo la 100, con menos de 100 queda sin datos) y `REVERSION_ALCISTA_VELAS` (patrones verdes de `lib/indicators.ts`: Est. M., Env. A., M., M. Inv., que se completan en la última vela; es UNA señal).
- Fuerza informativa (`fuerzaEntrada`): 2 normal, 3 fuerte, 4 o más muy fuerte. No cambia COMPRAR ni el mínimo. Sale en el correo («🟢 SEÑAL TÉCNICA NUEVA (PCP)… fuerza fuerte») y en /oficina, sección «Entrada técnica (PCP)» (`referencias.entrada_pcp`, solo en corridas PCP de nueva posición).
- Técnico de IA: `SENALES_ENTRADA_TECNICO` incluye las dos nuevas (el prompt las lista solo; versión p7).
- Catálogo: `parche-catalogo-v070.sql` (PCP-04 y PCP-10 versiones nuevas desde 2026-11-21; una sola vez). Fixture actualizado.
- Edge Function: copia idéntica de `alertas-oficina.ts`; hay que volver a desplegar `update-ia`.

## v0.71: salud financiera informativa para PCP
- Alerta SOLO informativa (no compra, no vende, no bloquea; no entra al Motor): ¿la empresa genera ganancias (utilidad neta) y flujo de caja libre? Ayuda a decidir cuánto invertir. Periodo: TTM y último año fiscal.
- `conexion/salud-financiera.ts` (código puro): utilidad neta de Webull (TTM y último FY); flujo de caja libre de Finnhub (TTM de `stock/metric` y último año del reporte anual, operativo − compra de propiedad, planta y equipo; si falta, el anual de `stock/metric`). Cada medida: positivo / negativo / mixto (TTM y año no coinciden) / sin datos. Resumen: sólida (ambas positivas), débil (ambas negativas), mixta, sin datos. Nada se rellena.
- Usa los datos que la corrida ya lee: no hay consultas nuevas. Se guarda en `referencias.salud_financiera` de las corridas PCP y se muestra en /oficina («Salud financiera (informativa, PCP)»). Por ahora no va en el correo de la señal (se puede agregar).

## v0.72: PMP al abrir — salud financiera obligatoria y valuación por P/E contra su promedio de 5 años
- **Salud financiera obligatoria (solo PMP + nueva posición).** Ganancias (utilidad neta) y flujo de caja libre, TTM y último año fiscal (`conexion/salud-financiera.ts`, con `obligatoria: true` solo cambia el texto). El Motor (nivel «fundamentales», 5b) la aplica: sólida = pasa; débil o mixta = NO_COMPRAR (`salud_financiera`); sin datos = NO_EVALUABLE (no se supone que cumple). No aplica a la recompra de PMP ni a PCP (en PCP sigue informativa).
- **Valuación por P/E.** `compararPer` (en `valuacion-modelos.ts`): P/E actual (el de `/api/fundamentals`; si falta, cierre ÷ EPS TTM) contra el promedio de los últimos 5 años (cierre a la fecha de cada reporte anual ÷ EPS, necesita al menos 3 años con EPS positivo). Por debajo = BARATA (se puede comprar); igual o por encima = CARA (el Motor da ESPERAR, `valuacion_cara`); sin comparación = NO_EVALUABLE. Reemplaza el criterio anterior del veredicto (≥14% BARATA, si no RAZONABLE). El 14% anualizado lo sigue decidiendo PMP-01 (Auditor).
- /oficina: sección «Salud financiera (obligatoria, PMP)» y, en la valuación por código, la línea de P/E actual vs promedio. La corrida guarda `referencias.salud_financiera` también en PMP.
- Sin cambios de catálogo (no hay SQL): ambas reglas están en el Motor. Igual que antes, la Valuación no corre si PMP tiene menos de 2 señales técnicas (así que sin señal no se ve el P/E).

## v0.72b: filtro de PMP al 10%, «aceptable» pasa y la Valuación corre sin señal técnica
- **Filtro de ganancia anualizada (PMP-01 y revisión PMP-11): 14% → 10%** (`RENDIMIENTO_MINIMO_PCT`, fixture y `parche-catalogo-v072.sql`: PMP-01 versión nueva vigente desde 2026-11-22, solo si la vigente tiene umbral 14; corre UNA vez). El texto de la ficha de PMP-09 también dice 10%.
- **Salud financiera:** nuevo resumen «aceptable» = ninguna medida negativa y al menos una «mixta» (TTM y último año no coinciden): PASA. «incompleta» = una medida sin datos y ninguna negativa: NO_EVALUABLE (antes bloqueaba como NO_COMPRAR). «mixta» queda para una medida negativa y la otra no: NO_COMPRAR.
- **Valuación sin señal técnica:** ya no se omite en PMP + nueva posición (antes v0.26); así el P/E contra su promedio de 5 años se ve siempre en la corrida. PMP-01 sigue sin aplicar sin señal (la ganancia anualizada se evalúa cuando hay señal); una valuación CARA da ESPERAR.
- Arreglo de tipos en /oficina: el portafolio se lee de `d.corrida.portafolio_codigo`.

## v0.73: PMP al abrir — dividendos obligatorios y «Dividendo vs precio» del lado verde
- **Paga dividendos (obligatorio en PMP).** `conexion/dividendo-pmp.ts`: paga = al menos un pago en los últimos 400 días. Si no paga: NO_COMPRAR (`sin_dividendos`) y el texto sugiere pasarla a PCP (la Oficina solo sugiere; el cambio de portafolio lo haces tú en la watchlist).
- **Lado verde o rojo.** Misma cuenta que `DividendYieldChart` (último dividendo conocido ÷ cierre del día, sin anualizar) con el promedio de los **últimos 5 años** (la gráfica usa 10 por omisión). Hoy ≥ promedio = verde = barata (se puede comprar); hoy < promedio = rojo = cara: ESPERAR (`dividendo_caro`). Pide al menos 250 cierres y 3 años con dividendo conocido; si no, NO_EVALUABLE (no se supone).
- Es ADEMÁS del P/E contra su promedio de 5 años (v0.72b), de ganancias y flujo de caja positivos y del filtro de 10%; el Motor las revisa en ese orden: valuación (P/E) → fundamentales → salud financiera → dividendo → técnico. Solo PMP + nueva posición.
- Se guarda en `referencias.dividendo_pmp` y /oficina muestra «Dividendo vs precio (obligatorio, PMP)». PMP-01 se queda como está (se evalúa cuando hay señal técnica).
- Para que la gráfica de /chart también use 5 años basta pasar `years={5}` a `DividendYieldChart` donde se usa (el componente no se tocó).

## v0.74 — Pertenencia a índices de referencia
- Nuevo `conexion/pertenencia-indices.ts`: consulta Finnhub (`index/constituents` de ^GSPC, ^NDX, ^DJI y `etf/holdings` de QUAL) y dice a qué índices pertenece el ticker (SPY, QQQ, DIA, QUAL).
- PMP (posición nueva): debe pertenecer a algún índice. Si no pertenece, o si la fuente falla, la corrida NO inicia (422, etapa `indice`, sin modelo ni escritura) y se sugiere pasarla a PCP. PMP con posición abierta no se bloquea.
- PCP: solo informa. Si pertenece, lo nombra; si no, deja un aviso (no bloquea ni cambia la decisión).
- La ficha PMP-09 «índices de referencia» ahora muestra los índices a los que pertenece (ya no la lista declarada); si no pertenece o no se pudo consultar queda en no propuestos.
- Se guarda en `referencias.pertenencia_indices` y se muestra en /oficina («Índices de referencia»).
- Nota: si Finnhub responde 403 por plan en constituyentes/holdings, PMP no iniciará y el mensaje lo dice.

## v0.75 — Pertenencia a índices con fuentes gratuitas
- Finnhub cobra los constituyentes (HTTP 403 en SPY/QQQ/DIA/QUAL), así que `pertenencia-indices.ts` lee: S&P 500, Nasdaq-100 y Dow desde Wikipedia (API `action=parse`, columna Symbol/Ticker) y QUAL desde el CSV de tenencias de iShares. Sin clave.
- Cada lista debe tener un mínimo de símbolos (SPY 400, QQQ 80, DIA 25, QUAL 80); una lista recortada cuenta como fallo. Caché en memoria de 24 h (los fallos no se guardan).
- Mismas reglas: PMP al abrir sin poder comprobar o sin índice → no inicia (sugiere PCP); PCP solo alerta/nombra.
- `FetchDatos` admite `text()` opcional (el CSV). Pruebas: `indices.test-util.ts`.
- Si Wikipedia o iShares cambian de formato o bloquean, el mensaje dice cuál falló y por qué (HTTP, lista incompleta, etc.).

## v0.76
- Reintentos ante 503/429/5xx del proveedor del modelo: de 2 a 4, con esperas de 2, 5, 12 y 25 s.
- Pertenencia a índices: el texto ahora muestra el motivo de cada índice no consultado («Sin consultar: QQQ (HTTP 403)»); el lector de Wikipedia acepta celdas tipo «NYSE: MMM».

## v0.77
- Pertenencia a índices: las tablas de componentes de Nasdaq-100 y Dow están en las páginas «List of NASDAQ-100 companies» y «List of Dow Jones Industrial Average companies» (las anteriores no traían la tabla). Si QUAL (iShares) falla, el motivo muestra cómo empieza la respuesta; el CSV tolera BOM.

## v0.78 — se quita la pertenencia a índices
- Decisión de Jaime (23-nov): identificar a qué índice pertenece cada acción daba errores (Finnhub cobra; Wikipedia/iShares frágiles). Se elimina todo el concepto: sin consulta, sin bloqueo en PMP, sin alerta en PCP, sin sección en /oficina.
- La ficha PMP-09 vuelve a declarar los índices de referencia (SPY, QQQ, DIA, QUAL) como antes de la v0.74. Se conservan los cambios de v0.75-v0.76 de reintentos del modelo (4 reintentos).

## v0.79 — financieras en la salud financiera
- Decisión de Jaime (24-nov): bancos, aseguradoras y brókers no tienen flujo de caja libre significativo (GS: negativo todos los años). Para ellas la salud financiera (PMP obligatoria, PCP informativa) evalúa solo las ganancias; el flujo de caja se muestra pero no cuenta.
- Se detecta por la industria de Finnhub (`stock/profile2` → `finnhubIndustry`, patrón `ES_FINANCIERA` en `salud-financiera.ts`: bank, financ, insur, broker, capital markets, asset manag, investment, credit, mortgage, reit). Si no se puede leer la industria, rige la regla general y se avisa.
- Se guarda `financiera` e `industria` en `referencias.salud_financiera` y /oficina lo indica.

## v0.80 — recompras de PCP
- Cuerpo de la ruta: `evaluacion: "recompra"` (solo PCP, con `guardar` y `monto`). Sin posición abierta responde 422 (etapa `recompra`) sin llamar al modelo ni escribir. La corrida usa el tipo `recompra`: Auditor (PCP-02 monto escalonado 25/25/50, PCP-03 máximo 3 compras y 100 USD, PCP-04 señal, PCP-07 plan escalonado), Técnico (`recompra_pcp`: RSI, Koncorde, Mogalef inferior, nivel pasado; sin MACD; mínimo 1) y Motor (RECOMPRAR / NO_RECOMPRAR). No se llama al Fundamental.
- Botón ▶: tras la corrida de posición abierta de PCP, si el precio está en la zona de recompra (`recompra_sugerida` en la respuesta), encadena solo la evaluación de recompra con el monto que toca (1 compra → 25, 2 compras → 50) y la muestra bajo la tarjeta. Nada se compra solo.
- /oficina: la corrida de recompra muestra «Recompra técnica (PCP)» con las señales de hoy (`referencias.entrada_pcp`).
- Correo «ZONA DE RECOMPRA PCP»: dice si hoy ya hay señal de recompra y de cuánto sería la compra; cuando aparece la señal dentro de la zona se manda un aviso nuevo. REDESPLEGAR `update-ia` (copia idéntica de `alertas-oficina.ts`).

## v0.81
- Flujo de caja libre: el pago de propiedad, planta y equipo también se busca en `PaymentsToAcquireProductiveAssets` y `PaymentsToAcquireOtherPropertyPlantAndEquipment` (empresas como GLW no usaban el concepto estándar y quedaban «sin datos»). Sin ninguno de los conceptos sigue sin inventarse.
- /oficina: la valuación mostraba «mínimo 14%»; ahora 10% (PMP-01 v3).

## v0.82
- Decisión de Jaime (24-nov): si el proveedor no trae el flujo de caja libre (p. ej. falta el capex) y las ganancias cumplen, PMP NO bloquea: la salud queda «aceptable» con un aviso («flujo de caja libre sin datos en el proveedor»). Ganancias sin datos siguen siendo NO_EVALUABLE; ganancias negativas siguen bloqueando; flujo de caja negativo sigue bloqueando.

## v0.83 — modelo de respaldo
- Opcional: variable de entorno `GEMINI_MODEL_FALLBACK` (nombre de otro modelo de Gemini). Si el modelo principal sigue con un error temporal (503, 429, 5xx) después de los 4 reintentos con espera, se intenta UNA vez con el de respaldo. Si no se define la variable, todo funciona como antes. Errores de clave o de petición (401/403/400) no cambian de modelo.

## v0.84
- /oficina, sección «Salida (PCP)»: siempre muestra el estado de las recompras (1.ª de 25 USD y 2.ª de 50 USD: cuántas van, cuál sigue y cuándo se evalúa) y deja claro cuándo la decisión es MANTENER (sin salida y fuera de la zona de recompra). Solo lectura; no cambia decisiones.

## v0.85 — Etapa del PCP por take profit llenos
- La etapa de una posición PCP la marcan los TP con valor: TP1 = apertura, TP2 = 1.ª recompra, TP3 = 2.ª recompra (no el historial de compras, que se desfasa con ventas parciales y nuevas compras).
- Cierre en o bajo el stop: solo TP1 → 1.ª recompra (25 USD); TP1+TP2 → 2.ª recompra (50 USD); los 3 TP → la Oficina propone VENDER 100% (motivo stop, con aviso); tú decides.
- Auditor: hechos.posicion.etapas_pcp (desde trades.take_profit_1..3) manda en PCP-02/03/05/06/07; sin TP se cuenta el historial como antes. PCP-07 acepta vender por stop solo con 3 TP.
- Edge Function: sin cambios en este lote (la señal usa la etapa).

## v0.86 — PCP: salida 100% por salto de sesión
- Si en la sesión (precio en vivo de Finnhub /quote, sin esperar el cierre) el activo sube más de 10% sobre el cierre anterior y el precio está sobre el costo promedio, la Oficina propone VENDER 100% sin respetar otras reglas (motivo `salto_sesion`). Propuesta: tú decides.
- Aplica en la corrida ▶ (posición abierta PCP) y en la alerta de salida. Si la cotización no llega, esa salida no se evalúa y todo sigue como antes.
- Edge Function: sin cambios de archivo, pero la alerta llama a la ruta `/api/oficina/senal-salida` (se despliega con la app).

## v0.87 — Recompras de PMP (10 USD)
- Dispara el stop O una señal: cierre en o bajo `trades.stop_loss`, o una señal de recompra del Técnico (`recompra_pmp`: RSI sobrevendido, Koncorde bajo cero, banda inferior de Mogalef, nivel pasado; basta una). Monto fijo de 10 USD (PMP-03).
- Tope: un activo no puede pasar del 10% del portafolio (activos abiertos, neto de ventas, + efectivo). El cálculo es de código (`conexion/limite-posicion-pmp.ts`) y el Motor responde ESPERAR `limite_10pct_portafolio` si se pasa, o NO_EVALUABLE si no se pudo calcular (no se supone).
- En la corrida ▶ de una posición PMP abierta, si se dispara, el botón encadena la evaluación de recompra (10 USD) igual que en PCP y la muestra en una tarjeta anidada. `referencias.recompra_pmp` guarda stop/señal.
- Sin cambios en la Edge Function ni en alertas por correo (no se pidieron); el stop de PMP sigue sin vender nada (PMP-08).

## v0.88 — Recompras de PLP (5 USD)
- Igual que PMP (stop O señal) pero de 5 USD (PLP-03) y SIN tope de monto ni de número de recompras. Señales: las de `dca_plp` del Técnico (RSI sobrevendido, banda inferior de Mogalef, EMA8 sobre EMA21, nivel pasado); basta una.
- En la corrida ▶ de una posición PLP abierta, si se dispara, el botón encadena la evaluación de recompra (5 USD). `referencias.recompra_plp` guarda stop/señal. Sin stop legible solo cuentan las señales.
- Sin cambios en Edge Function ni alertas por correo.

## v0.89 — SEMILLA sin recompras; ETF ya cubierto
- SEMILLA: el Motor responde NO_RECOMPRAR `semilla_sin_recompras` a cualquier recompra (también la de dividendo de la misma empresa que SEM-04 permitía). Spin off no es un portafolio de la Oficina: no se toca.
- ETF sectoriales: el aporte semanal de 2 USD por ETF (1 USD si no alcanza el efectivo; ETF-01/ETF-02) ya existía y no tiene límite de aportes; no cambia nada.

## v0.90 — Pantalla de recompras PMP/PLP, rebote SMA 100/200 y corrección de SEMILLA
- /oficina: nueva sección «Recompra (PMP · 10 USD)» / «(PLP · 5 USD)»: si toca recompra (stop o señal) o MANTENER. Sale de `referencias.recompra_pmp|recompra_plp` (`recompraDe` en corridas-lectura).
- El rebote en SMA 100/200 (`REBOTE_SMA_100_200`) cuenta también como señal de recompra en PMP (`recompra_pmp`) y PLP (`dca_plp`).
- SEMILLA (corrección de v0.89): solo se permite la recompra con el dividendo de esa misma empresa (SEM-04, tal como estaba); se quitó la guarda del Motor que la bloqueaba toda. ETF-01 se queda en su versión actual (el aporte de 1 USD solo si no alcanza el efectivo para los 2 USD).
- PMP: el tope de 10% por activo es sobre costo invertido (confirmado).
