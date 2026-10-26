export {
  CALENDARIO_NYSE, ZONA_NYSE, ZONA_OFICINA, MARGEN_COBERTURA_MOTOR_DIAS, calendarioParaMotor, crearCalendarioNYSE, diaSemana, fechaEnZona,
  formatoEnZona, parseFecha, sumarDias, validarDatosCalendario,
} from './calendario';
export type { CalendarioNYSE, ConsultaFecha, ConsultaSemana, SesionNYSE } from './calendario';
export { CALENDARIO_NYSE_DATOS } from './calendario-nyse';
export type { DatosCalendarioNYSE } from './calendario-nyse';
export { MARGEN_CIERRE_MINUTOS, confirmarCierreVelas, instanteEvaluacion } from './cierre-velas';
export type {
  CierreEsperado, EntradaCierreVelas, EstadoCierre, Mercado, MotivoCierre, OpcionesCierreVelas, ResultadoCierre,
  ResultadoCierreVelas, VelaFuente,
} from './cierre-velas';
export { USOS_DETONANTE, USOS_MOMENTO, USO_SENAL_SALIDA, prepararTecnico } from './preparar-tecnico';
export type {
  DescarteVela, EntradaPrepararTecnico, EstadoPreparacion, OpcionesPrepararTecnico, ReferenciaTecnico, ResultadoPrepararTecnico,
  UsoDetonante, UsoMomento,
} from './preparar-tecnico';
export {
  CLAVE_FRESCURA_PRECIO, CLAVE_MARGEN_CIERRE, CAMPO_HORAS, CLAVE_VENTANA_ALERTAS, UNIDAD_DIAS_HABILES, UNIDAD_MINUTOS, leerHoras, leerValorConUnidad, parametroVigente, resolverParametros,
} from './parametros';
export type { FilaParametro, OrigenParametro, ParametrosOrquestador } from './parametros';
export { ESTADO_DATO_VENCIDO, MAX_DIAS_REVISION_FRESCURA, MOTIVO_PRECIO_DESACTUALIZADO, datoFaltantePorFrescura, evaluarFrescuraPrecio, textoDatoFaltante, textoUmbralFrescura } from './frescura';
export type { DatoFaltanteVencido, ResultadoFrescura } from './frescura';
export { rachaPreviaDeReferencias, registrarRachaMogalefSuperior } from './racha';
export type { EstadoRachaRegistro, RachaRegistrada, ResultadoRacha } from './racha';
export { MS_POR_HORA, SEVERIDADES_ALERTA, claveGrupoAlerta, procesarAlerta } from './alertas';
export type { AlertaEntrante, CambioAlerta, DecisionAlerta, GrupoAlerta, ResultadoAlerta, SeveridadAlerta } from './alertas';
export {
  AGENTES_ORDEN, MATRIZ_AGENTES, MATRIZ_AGENTES_VERSION, REGLA_PLP_ABRIR, REGLA_PLP_SUSTITUCION, REGLA_SEMILLA_RECOMPRA, accionDeMatriz, agentesDeCorrida, reglaEstructural,
} from './matriz-agentes';
export type { AccionMatriz, AgentesDeCorrida, ClaseReglaEstructural, ReglaEstructural, Requisito } from './matriz-agentes';
export { MONTO_POR_ETF_SECTORIAL_USD, MONTO_REDUCIDO_POR_ETF_USD, calcularAporteSemanal } from './aporte-etf';
export type { DatosAporteSemanal, ModoAporte, ResultadoAporteSemanal } from './aporte-etf';
export {
  DISPARADORES, MERCADOS, MOTIVO_PORTAFOLIO_SIN_REGLAS, PORTAFOLIOS_OPERATIVOS, PORTAFOLIOS_SIN_REGLAS, PORTAFOLIO_SIN_CLASIFICAR,
  normalizarCodigoPortafolio, validarSolicitud,
} from './solicitud';
export type { Disparador, ResultadoSolicitud, SolicitudNormalizada, SolicitudV1 } from './solicitud';
export {
  NOMBRE_AGENTE_AUDITOR, NOMBRE_AGENTE_DIRECTOR, NOMBRE_AGENTE_ORQUESTADOR, REINTENTOS_AUDITOR, REINTENTOS_POR_AGENTE, USO_MOMENTO_POR_CASO,
  VEREDICTOS_AUDITOR, coherenciaPosicion, ejecutarCorrida,
} from './corrida';
export type {
  ContextoDirector, DatosCongelados, EjecucionRegistrada, FilaCorrida, OpcionesCorrida, Puertos, RespuestaAgente, RespuestaAuditor, ResultadoAgenteRegistro, ResultadoCorrida,
} from './corrida';
export {
  AGENTE_SIN_EXTRAS, FUNCION_REGISTRO, almacenSupabase, esUuid, filaCorridaParaBd, filaEjecucionParaBd, persistirResultado,
  verificarEjecucion, verificarFilaCorrida,
} from './persistencia';
export type { Almacen, ClienteSupabaseMinimo, OpcionesPersistencia, ResultadoPersistencia } from './persistencia';
