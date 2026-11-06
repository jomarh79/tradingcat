// Constantes del módulo de agentes de IA (Fundamental y Director). Ningún parámetro va como número o texto suelto en el código.

export const CONTRATO_ENTRADA = 'entrada.v1';
export const CONTRATO_SALIDA = 'salida.v1';
export const CONTRATO_INTEGRACION = 'integracion.v1';
export const AGENTE_FUNDAMENTAL = 'fundamental';
export const AGENTE_DIRECTOR_IA = 'director_ia';

export const VEREDICTOS_FUNDAMENTAL = ['SOLIDO', 'ACEPTABLE', 'DEBIL', 'NO_EVALUABLE'] as const;
export const VEREDICTO_NO_EVALUABLE = 'NO_EVALUABLE';
export const TIPOS_HALLAZGO = ['positivo', 'negativo', 'neutral'] as const;
export const TIPO_HALLAZGO_NEGATIVO = 'negativo';
export const ESTADOS_CAMBIO_TESIS = ['se_mantiene', 'se_debilita', 'se_rompe'] as const;
export const SUBPUNTAJES_FUNDAMENTAL = ['crecimiento', 'rentabilidad', 'balance', 'flujo_caja', 'ventaja_competitiva'] as const;
export const OPERADORES_UMBRAL = ['<', '<=', '>', '>=', '==', '!='] as const;
export const MERCADOS_VALIDOS = ['US', 'BMV'] as const;

export const ESTADOS_TESIS_DIRECTOR = ['vigente', 'propuesta_cambio', 'sin_cambio', 'sin_tesis'] as const;
export const ESTADO_TESIS_PROPUESTA = 'propuesta_cambio';
export const RECOMENDACIONES_MOTOR = ['continuar', 'completar_datos', 'detener'] as const;
export const RECOMENDACION_CONTINUAR = 'continuar';
export const RECOMENDACION_COMPLETAR_DATOS = 'completar_datos';
export const VEREDICTOS_AUDITOR_CON_BLOQUEO = ['BLOQUEO_REGLA', 'NO_ELEGIBLE'] as const;

export const MAX_RESUMEN = 600;
export const PUNTAJE_MIN = 0;
export const PUNTAJE_MAX = 100;
export const CONFIANZA_MIN = 0;
export const CONFIANZA_MAX = 1;
/** [PROPUESTA] Tope de la confianza (`confianza` del Fundamental y `nivel_confianza` del Director) cuando su lista de `datos_faltantes` no está vacía (valor fijado por Claude; el usuario puede cambiarlo). */
export const TOPE_CONFIANZA_CON_FALTANTES = 0.6;
/** Intentos por validación: el primero más 1 reintento con el error (contrato, sección 3). */
export const INTENTOS_POR_VALIDACION = 2;
/** Los números enteros de un solo dígito (conteos como «2 de 3 analistas») no se consideran cifras que requieran fuente. */
export const ENTERO_MAXIMO_SIN_FUENTE = 9;
export const MAX_ERRORES_EN_MENSAJE = 12;
/** Referencias válidas que se listan en el mensaje de error del Director (para que el modelo corrija al reintentar). */
export const MAX_REFS_EN_MENSAJE = 20;
/** Avisos de datos que viajan al modelo en el snapshot; el resto se resume en una línea. */
export const MAX_AVISOS_SNAPSHOT = 40;
/** Campos válidos que se listan en el mensaje de error de un umbral con campo inexistente. */
export const MAX_CAMPOS_EN_MENSAJE = 30;

export const PROVEEDOR_OPENAI = 'openai';
export const ENV_API_KEY = 'OPENAI_API_KEY';
export const ENV_MODELO_ANALISTA = 'OPENAI_MODEL_ANALISTA';
export const ENV_MODELO_DIRECTOR = 'OPENAI_MODEL_DIRECTOR';
export const OPENAI_URL_BASE = 'https://api.openai.com/v1';
export const OPENAI_RUTA_CHAT = '/chat/completions';
export const TIMEOUT_MODELO_MS = 180_000;
export const ESTADO_HTTP_NO_AUTORIZADO = 401;
export const ESTADO_HTTP_PROHIBIDO = 403;

export const VERSION_PROMPT_FUNDAMENTAL = 'fundamental.p7';
export const VERSION_PROMPT_DIRECTOR = 'director.p6';
export const ESQUEMA_NOMBRE_FUNDAMENTAL = 'salida_fundamental_v1';
export const ESQUEMA_NOMBRE_DIRECTOR = 'integracion_v1';

// ---- datos del Fundamental (prueba con Webull income-statement)
export const FUENTE_WEBULL_INCOME = 'Webull Fundamentals API (estado de resultados)';
export const FUENTE_CALCULO_CODIGO = 'Calculado por código a partir del estado de resultados de Webull';
export const ANIOS_ANUALES_FUNDAMENTAL = 5;
export const DECIMALES_RATIO = 4;
export const PERIODO_TTM = 'ttm';
export const MONEDA_POR_OMISION = 'USD';
export const UNIDAD_EPS = 'por acción';
export const UNIDAD_ACCIONES = 'acciones';
export const UNIDAD_RATIO = 'ratio';
export const PORTAFOLIO_PRUEBA_POR_OMISION = 'PMP';
export const MERCADO_PRUEBA = 'US';
export const TIPO_EVALUACION_PRUEBA = 'nueva_posicion';
export const MAX_ITEMS_EXTRA = 100;
export const MIN_ESPERA_PRUEBA_MS = 30_000;

// ---- proveedor Gemini (Google AI Studio). Los nombres de campo de la petición van aquí para corregirlos en un solo sitio.
export const PROVEEDOR_GEMINI = 'gemini';
export const ENV_PROVEEDOR_IA = 'PROVEEDOR_IA';
export const PROVEEDORES_IA = [PROVEEDOR_OPENAI, PROVEEDOR_GEMINI] as const;
export const ENV_GEMINI_API_KEY = 'GEMINI_API_KEY';
export const ENV_GEMINI_MODELO_ANALISTA = 'GEMINI_MODEL_ANALISTA';
export const ENV_GEMINI_MODELO_DIRECTOR = 'GEMINI_MODEL_DIRECTOR';
export const GEMINI_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const GEMINI_RUTA_MODELOS = '/models/';
export const GEMINI_SUFIJO_GENERAR = ':generateContent';
export const GEMINI_CABECERA_CLAVE = 'x-goog-api-key';
export const GEMINI_CAMPO_MIME = 'responseMimeType';
export const GEMINI_CAMPO_ESQUEMA = 'responseJsonSchema';
export const MIME_JSON = 'application/json';
export const GEMINI_ROL_USUARIO = 'user';
export const GEMINI_ROL_MODELO = 'model';
export const GEMINI_FIN_NORMAL = 'STOP';
export const GEMINI_FIN_TRUNCADO = 'MAX_TOKENS';
export const ESTADO_HTTP_PETICION_INVALIDA = 400;

// ---- datos de Finnhub (balance y flujo de caja desde financials-reported; ratios desde stock/metric)
export const FUENTE_FINNHUB_REPORTADO = 'Finnhub financials-reported (estados presentados ante la SEC)';
export const FUENTE_FINNHUB_METRIC = 'Finnhub stock/metric (ratio calculado por el proveedor; la fecha es la de consulta, no la del balance)';
export const FUENTE_CALCULO_RAZON_CORRIENTE = 'Calculado por código: activos corrientes entre pasivos corrientes (Finnhub financials-reported)';
export const FUENTE_CALCULO_FCF = 'Calculado por código: flujo operativo menos pagos por propiedad, planta y equipo (Finnhub financials-reported)';
export const ANIOS_REPORTADOS_FINNHUB = 3;
export const UNIDAD_USD_FINNHUB = 'u_usd';
/** Finnhub etiqueta los reportes anteriores al último con `unit_standard_usd_<código distinto por reporte>` (visto en GKOS 2019 a 2024). Otras unidades (p. ej. `unit12`) no se aceptan. */
export const PREFIJO_UNIDAD_USD_FINNHUB = 'unit_standard_usd_';
export const UNIDAD_USD = 'USD';
export const TRIMESTRE_ANUAL = 0;
export const TRIMESTRES_PARCIALES = [1, 2, 3] as const;
export const CLAVES_FINNHUB_PRUEBA = ['finnhub_reportado', 'finnhub_reportado_trimestral', 'finnhub_metric'] as const;

// --- Datos reales (v0.9): la ruta analisis-fundamental trae Webull y Finnhub sola ---
/** Variable de entorno de la clave de Finnhub (solo servidor). Si en tu `.env.local` se llama distinto, cambia solo esta constante. */
export const ENV_FINNHUB_API_KEY = 'FINNHUB_API_KEY';
/** Opcional: origen público de la app (por ejemplo https://tu-app.onrender.com) para llamar a la ruta interna de Webull. Si falta se usa el origen de la petición. */
export const ENV_BASE_URL_OFICINA = 'OFICINA_BASE_URL';
export const RUTA_WEBULL_INCOME = '/api/webull/income-statement';
export const FINNHUB_URL_BASE = 'https://finnhub.io/api/v1';
export const FINNHUB_RUTA_REPORTADO = '/stock/financials-reported';
export const FINNHUB_RUTA_METRIC = '/stock/metric';
export const FINNHUB_CABECERA_CLAVE = 'X-Finnhub-Token';
export const FINNHUB_FRECUENCIA_ANUAL = 'annual';
export const FINNHUB_FRECUENCIA_TRIMESTRAL = 'quarterly';
export const FINNHUB_METRIC_TODAS = 'all';
/** Tiempo máximo por llamada de datos; mayor que los 10 s de la ruta de Webull. */
export const TIMEOUT_DATOS_MS = 25_000;
export const MAX_AVISOS_OBTENCION = 20;
export const MAX_LARGO_AVISO = 300;
export const CLAVES_ANALISIS_REAL = ['ticker', 'con_director', 'portafolio', 'guardar'] as const;
export const FUENTE_OK = 'ok';
export const FUENTE_OMITIDA = 'omitida';

// --- v0.13: guardado del análisis (expediente, análisis, corrida) ---
export const DISPARADOR_ANALISIS_GUARDADO = 'usuario';
export const TIPO_EVALUACION_NUEVA = 'nueva_posicion';
export const TIPO_EVALUACION_ABIERTA = 'posicion_abierta';
export const TABLA_EXPEDIENTES_TESIS = 'oficina_expedientes';
export const COLUMNAS_TESIS_EXPEDIENTE = 'id,tesis_vigente,tesis_version';
/** [PROPUESTA] false mientras se use la capa gratuita de Gemini: el Director no recibe el resultado del Auditor ni el tipo de evaluación real (delata si hay posición). */
export const DIRECTOR_VE_DATOS_PRIVADOS = false;
export const TESIS_PRIMERA_PROPUESTA = 'primera_propuesta';
export const TESIS_CAMBIO = 'cambio_de_tesis';
export const TESIS_SIN_PROPUESTA = 'sin_propuesta';
export const CLAVE_ANOTACIONES_CODIGO = 'anotaciones_codigo';

// --- v0.14: Analista Técnico (velas de TwelveData por /api/chart-data + agente de IA) ---
export const AGENTE_TECNICO = 'tecnico';
export const ESQUEMA_NOMBRE_TECNICO = 'salida_tecnico_v1';
export const VERSION_PROMPT_TECNICO = 'tecnico.p2';
export const RUTA_CHART_DATA = '/api/chart-data';
export const INTERVALO_VELAS_DIARIAS = '1day';
export const INTERVALO_VELAS_SEMANALES = '1week';
/** Fuente que queda escrita en el snapshot del Técnico y en `referencias.tecnico`. */
export const FUENTE_VELAS = 'TwelveData (vía /api/chart-data)';
/** Estados del cálculo de código con los que el modelo SÍ se llama; cualquier otro (NO_EVALUABLE, pendiente) corta antes del modelo. */
export const ESTADOS_TECNICO_CON_MODELO = ['completo', 'parcial'] as const;
export const ESTADO_TECNICO_PARCIAL = 'parcial';
/** Texto de los items de señal según `cumplida` (true / false / null: nunca se rellena con false). */
export const SENAL_CUMPLIDA = 'cumplida';
export const SENAL_NO_CUMPLIDA = 'no_cumplida';
export const SENAL_SIN_DATOS = 'sin_datos';
export const VALOR_SI = 'si';
export const VALOR_NO = 'no';
export const PREFIJO_ITEM_INDICADOR = 'ind_';
export const PREFIJO_ITEM_SENAL = 'senal_';
export const PREFIJO_ITEM_NIVEL_CAMPO = 'nivel_';
export const ID_ITEM_CIERRE_DIARIO = 'cierre_ultima_vela_diaria';
export const ID_ITEM_CIERRE_SEMANAL = 'cierre_ultima_vela_semanal';
export const ID_ITEM_SOBRE_EMA200 = 'cierre_sobre_ema200_diaria';
export const ID_ITEM_SOBRE_SMA200 = 'cierre_sobre_sma200_semanal';
export const UNIDAD_PRECIO = 'precio';
export const UNIDAD_PORCENTAJE = 'porcentaje';

// --- v0.15: las cifras escritas por el modelo deben coincidir con los datos que cita ---
/** [PROPUESTA] true: cada cifra del `resumen`, los `hallazgos` y los `negativos` del Técnico debe coincidir (redondeada, no truncada) con un dato citado. */
export const VERIFICAR_CIFRAS_TECNICO = true;
/** [PROPUESTA] Igual para el Fundamental. Si en producción rechaza de más, se apaga aquí sin tocar el resto. */
export const VERIFICAR_CIFRAS_FUNDAMENTAL = true;
/** Formas equivalentes de escribir un valor: tal cual, como porcentaje (×100) y en miles, millones o miles de millones. */
export const ESCALAS_CIFRA = [1, 100, 1e-3, 1e-6, 1e-9] as const;
/** Margen para comparar decimales de coma flotante. */
export const EPSILON_CIFRA = 1e-9;
/** Datos citados que se listan en el mensaje de error de una cifra sin respaldo (para que el modelo corrija al reintentar). */
export const MAX_VALORES_EN_MENSAJE = 12;
