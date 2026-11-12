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
