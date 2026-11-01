// Fixtures compartidas de las pruebas del módulo de agentes de IA.
import type { SalidaFundamental, SobreFundamental } from './validar-fundamental';
import type { ContextoDirector } from '../orquestador/corrida';

export const RUN_ID = '11111111-1111-4111-8111-111111111111';
export const SNAP_ID = '22222222-2222-4222-8222-222222222222';
export const ANALISIS_ID = '33333333-3333-4333-8333-333333333333';

export const sobreBase = (): SobreFundamental => ({
  contrato: 'entrada.v1', run_id: RUN_ID, agente: 'fundamental', ticker: 'GKOS', mercado: 'US',
  snapshot: {
    id: SNAP_ID, generado_en: '2026-10-29T18:00:00Z',
    datos: { items: [
      { id: 'd1', campo: 'ingresos_ttm', valor: 123456789, unidad: 'USD', fuente: 'SEC EDGAR 10-K', fecha_dato: '2026-06-30' },
      { id: 'd2', campo: 'margen_bruto', valor: 0.82, unidad: 'ratio', fuente: 'SEC EDGAR 10-K', fecha_dato: '2026-06-30' },
      { id: 'd3', campo: 'fragmento_riesgos', valor: 'La empresa depende de un solo producto.', unidad: null, fuente: 'SEC EDGAR 10-K', fecha_dato: '2026-06-30' },
    ] },
  },
  tesis_vigente: { texto: 'Crecimiento sostenido en oftalmología.', version: 2, origen: 'al_entrar' },
});

export const salidaBase = (): SalidaFundamental => {
  const s = sobreBase();
  return {
    contrato: 'salida.v1', agente: 'fundamental', run_id: RUN_ID, snapshot_id: SNAP_ID, ticker: 'GKOS', veredicto: 'ACEPTABLE', puntaje: 66, confianza: 0.6,
    resumen: 'Negocio rentable con concentración en un producto.',
    hallazgos: [
      { id: 'h1', tipo: 'positivo', texto: 'Margen bruto de 0.82 en el último reporte.', evidencia: ['d2'] },
      { id: 'h2', tipo: 'negativo', texto: 'Concentración en un solo producto.', evidencia: ['d3'] },
    ],
    negativos: ['Concentración en un solo producto.'],
    datos_fuente: s.snapshot.datos.items.slice(),
    supuestos: ['Se asume que el último reporte refleja la operación actual.'],
    invalidadores: [{ condicion: 'El margen bruto cae bajo 0.7', medible: true, umbral: { campo: 'margen_bruto', operador: '<', valor: 0.7 } }],
    datos_faltantes: [],
    subpuntajes: { crecimiento: 70, rentabilidad: 80, balance: 60, flujo_caja: 55, ventaja_competitiva: 65 },
    tesis_propuesta: { resumen: 'Rentable pero concentrado.', motores: ['Margen alto'], riesgos_clave: ['Un solo producto'] },
    cambios_vs_tesis_vigente: [{ punto: 'Crecimiento sostenido', estado: 'se_mantiene' }],
  };
};

export const contextoBase = (): ContextoDirector => ({
  run_id: RUN_ID, snapshot_id: SNAP_ID, ticker: 'GKOS', mercado: 'US', portafolio_codigo: 'PMP', tipo_evaluacion: 'nueva_posicion',
  salidas_analistas: { fundamental: salidaBase() },
  auditoria: { veredicto: 'CUMPLE', reglas_revisadas: ['PMP-01'] },
  reglas_versiones_ids: [], contexto: null,
});

export const salidaDirectorBase = (): Record<string, unknown> => ({
  contrato: 'integracion.v1', agente: 'director_ia', run_id: RUN_ID, snapshot_id: SNAP_ID, ticker: 'GKOS', portafolio_codigo: 'PMP', tipo_evaluacion: 'nueva_posicion',
  resumen: 'El análisis fundamental es aceptable con un riesgo de concentración.',
  integracion: {
    coincidencias: [{ texto: 'El margen bruto es alto.', evidencia: ['fundamental:h1'] }],
    contradicciones: [], no_comparables: [], discrepancias_con_auditoria: [],
  },
  tesis: { estado: 'vigente', propuesta: null, pendiente_autorizacion: false },
  riesgos_principales: ['Concentración en un solo producto.'],
  hallazgos_negativos_ids: ['fundamental:h2'],
  negativos: ['Concentración en un solo producto.'],
  datos_faltantes: [],
  condicion_que_cambiaria_la_conclusion: { texto: 'Que el margen bruto cayera bajo 0.7.', medible: true, umbral: { campo: 'margen_bruto', operador: '<', valor: 0.7 } },
  recomendacion_para_motor: 'continuar', nivel_confianza: 0.6, explicacion_confianza: 'Un solo analista disponible; cobertura parcial.',
});
