// Esquemas JSON para «salida estructurada estricta» del proveedor (strict: todas las claves requeridas, sin claves extra; opcionales = null).
// Son una ayuda para el modelo: la verdad la dicta el validador en código (validar-*.ts), que corre siempre.
import {
  CONTRATO_INTEGRACION, CONTRATO_SALIDA, AGENTE_DIRECTOR_IA, AGENTE_FUNDAMENTAL, AGENTE_TECNICO, ESTADOS_CAMBIO_TESIS, ESTADOS_TESIS_DIRECTOR, OPERADORES_UMBRAL,
  RECOMENDACIONES_MOTOR, SUBPUNTAJES_FUNDAMENTAL, TIPOS_HALLAZGO, VEREDICTOS_FUNDAMENTAL,
} from './constantes';
import { VEREDICTOS_TECNICO } from '../tecnico';

type Esquema = Record<string, unknown>;
const texto: Esquema = { type: 'string' };
const numero: Esquema = { type: 'number' };
const booleano: Esquema = { type: 'boolean' };
const nulo: Esquema = { type: 'null' };
const lista = (items: Esquema): Esquema => ({ type: 'array', items });
const opcional = (s: Esquema): Esquema => ({ anyOf: [s, nulo] });
const enumerado = (v: readonly string[]): Esquema => ({ type: 'string', enum: v.slice() });
const objeto = (props: Record<string, Esquema>): Esquema => ({ type: 'object', properties: props, required: Object.keys(props), additionalProperties: false });

const umbral = objeto({ campo: texto, operador: enumerado(OPERADORES_UMBRAL), valor: numero });

export const ESQUEMA_FUNDAMENTAL: Esquema = objeto({
  contrato: enumerado([CONTRATO_SALIDA]),
  agente: enumerado([AGENTE_FUNDAMENTAL]),
  run_id: texto,
  snapshot_id: texto,
  ticker: texto,
  veredicto: enumerado(VEREDICTOS_FUNDAMENTAL),
  puntaje: opcional(numero),
  confianza: numero,
  resumen: texto,
  hallazgos: lista(objeto({ id: texto, tipo: enumerado(TIPOS_HALLAZGO), texto, evidencia: lista(texto) })),
  negativos: lista(texto),
  datos_fuente: lista(objeto({ id: texto, campo: texto, valor: { anyOf: [numero, texto] }, unidad: opcional(texto), fuente: texto, fecha_dato: texto })),
  supuestos: lista(texto),
  invalidadores: lista(objeto({ condicion: texto, medible: booleano, umbral: opcional(umbral) })),
  datos_faltantes: lista(objeto({ campo: texto, critico: booleano })),
  subpuntajes: objeto(SUBPUNTAJES_FUNDAMENTAL.reduce<Record<string, Esquema>>((a, k) => { a[k] = opcional(numero); return a; }, {})),
  tesis_propuesta: opcional(objeto({ resumen: texto, motores: lista(texto), riesgos_clave: lista(texto) })),
  cambios_vs_tesis_vigente: lista(objeto({ punto: texto, estado: enumerado(ESTADOS_CAMBIO_TESIS) })),
});

export const ESQUEMA_DIRECTOR: Esquema = objeto({
  contrato: enumerado([CONTRATO_INTEGRACION]),
  agente: enumerado([AGENTE_DIRECTOR_IA]),
  run_id: texto,
  snapshot_id: texto,
  ticker: texto,
  portafolio_codigo: texto,
  tipo_evaluacion: texto,
  resumen: texto,
  integracion: objeto({
    coincidencias: lista(objeto({ texto, evidencia: lista(texto) })),
    contradicciones: lista(objeto({ entre: lista(texto), texto, evidencia: lista(texto) })),
    no_comparables: lista(objeto({ texto, motivo: texto })),
    discrepancias_con_auditoria: lista(objeto({ regla: texto, texto })),
  }),
  tesis: objeto({ estado: enumerado(ESTADOS_TESIS_DIRECTOR), propuesta: opcional(texto), pendiente_autorizacion: booleano }),
  riesgos_principales: lista(texto),
  hallazgos_negativos_ids: lista(texto),
  negativos: lista(texto),
  datos_faltantes: lista(texto),
  condicion_que_cambiaria_la_conclusion: objeto({ texto, medible: booleano, umbral: opcional(umbral) }),
  recomendacion_para_motor: enumerado(RECOMENDACIONES_MOTOR),
  nivel_confianza: numero,
  explicacion_confianza: texto,
});

const tendencia = enumerado(['alcista', 'lateral', 'bajista']);
const nivelClave = objeto({ precio: numero, nivel_id: texto });

export const ESQUEMA_TECNICO: Esquema = objeto({
  contrato: enumerado([CONTRATO_SALIDA]),
  agente: enumerado([AGENTE_TECNICO]),
  run_id: texto,
  snapshot_id: texto,
  ticker: texto,
  veredicto: enumerado(VEREDICTOS_TECNICO),
  confianza: numero,
  resumen: texto,
  tendencia: objeto({ corto: tendencia, medio: tendencia, largo: tendencia }),
  hallazgos: lista(objeto({ id: texto, tipo: enumerado(TIPOS_HALLAZGO), texto, evidencia: lista(texto) })),
  negativos: lista(texto),
  datos_fuente: lista(objeto({ id: texto, campo: texto, valor: { anyOf: [numero, texto] }, unidad: opcional(texto), fuente: texto, fecha_dato: texto })),
  zona_entrada: opcional(objeto({ min: numero, max: numero, nivel_ids: lista(texto) })),
  soporte_clave: opcional(nivelClave),
  resistencia_clave: opcional(nivelClave),
  nivel_invalidacion: opcional(nivelClave),
  datos_faltantes: lista(objeto({ campo: texto, critico: booleano })),
});
