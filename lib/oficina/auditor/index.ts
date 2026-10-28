export { auditar, validarEntrada, MOTIVO_PORTAFOLIO_NO_DECLARADO, MOTIVO_PORTAFOLIO_SIN_REGLAS, MOTIVO_EVALUADOR_NO_IMPLEMENTADO, CODIGO_REGLA_PORTAFOLIO } from './auditor';
export { validarSalida } from './validador';
export { puertoAuditor } from './puerto';
export type { RespuestaAuditorConSalida } from './puerto';
export { hashSha256, jsonCanonico } from './canonico';
export { gananciaAnualizada } from './numeros';
export { comprasContadas, EVALUADORES, MESES_HISTORIAL_MINIMO_ETF, CAUSA_VENTA_BANANA, CAUSA_LIMITE_VIDA, CAUSA_CAIDA_ORDINARIA } from './evaluadores';
export * from './tipos';
