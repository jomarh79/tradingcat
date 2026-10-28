export {
  COLUMNAS_CLASIFICACION, COLUMNAS_REGLAS, COLUMNAS_VERSIONES, ESTADO_VIGENTE, TABLA_CLASIFICACION, TABLA_REGLAS, TABLA_VERSIONES,
  cargarFilasReglas, resolverReglas,
} from './reglas-bd';
export type { ClienteConsulta, FilaClasificacion, FilaRegla, FilaVersion, FilasReglas, OpcionesReglas, ResultadoCarga, ResultadoReglas } from './reglas-bd';
export { ACCION_POR_TIPO, conSobreAuditor, construirEntradaAuditor } from './entrada-auditor';
export type { ArgumentosEntrada, HechosAuditor, ResultadoEntrada } from './entrada-auditor';
