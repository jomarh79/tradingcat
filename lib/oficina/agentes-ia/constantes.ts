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
export const VEREDICTOS_AUDITOR_CON_BLOQUEO = ['BLOQUEO_REGLA', 'NO_ELEGIBLE'] as const;

export const MAX_RESUMEN = 600;
export const PUNTAJE_MIN = 0;
export const PUNTAJE_MAX = 100;
export const CONFIANZA_MIN = 0;
export const CONFIANZA_MAX = 1;
/** Intentos por validación: el primero más 1 reintento con el error (contrato, sección 3). */
export const INTENTOS_POR_VALIDACION = 2;
/** Los números enteros de un solo dígito (conteos como «2 de 3 analistas») no se consideran cifras que requieran fuente. */
export const ENTERO_MAXIMO_SIN_FUENTE = 9;
export const MAX_ERRORES_EN_MENSAJE = 12;

export const PROVEEDOR_OPENAI = 'openai';
export const ENV_API_KEY = 'OPENAI_API_KEY';
export const ENV_MODELO_ANALISTA = 'OPENAI_MODEL_ANALISTA';
export const ENV_MODELO_DIRECTOR = 'OPENAI_MODEL_DIRECTOR';
export const OPENAI_URL_BASE = 'https://api.openai.com/v1';
export const OPENAI_RUTA_CHAT = '/chat/completions';
export const TIMEOUT_MODELO_MS = 180_000;
export const ESTADO_HTTP_NO_AUTORIZADO = 401;
export const ESTADO_HTTP_PROHIBIDO = 403;

export const VERSION_PROMPT_FUNDAMENTAL = 'fundamental.p1';
export const VERSION_PROMPT_DIRECTOR = 'director.p1';
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
