// Modelo falso compartido por las pruebas: responde según el esquema pedido, construyendo una salida válida a partir del sobre recibido.
import type { LlamadaModelo, PeticionModelo } from './index';

export function modeloFalso(opciones: { fundamentalMalo?: boolean; directorMalo?: boolean; directorPropone?: boolean } = {}) {
  const peticiones: PeticionModelo[] = [];
  const llamar: LlamadaModelo = async p => {
    peticiones.push(p);
    const usuario = JSON.parse(p.mensajes[1]!.content) as Record<string, unknown>;
    if (p.esquema_nombre === 'salida_fundamental_v1') {
      if (opciones.fundamentalMalo) return { ok: true, texto: '{}', json: {}, modelo: 'modelo-f' };
      const items = ((usuario['snapshot'] as Record<string, unknown>)['datos'] as Record<string, unknown>)['items'] as Record<string, unknown>[];
      const dato = items.find(i => i['id'] === 'margen_bruto_fy2024')!;
      const salida = {
        contrato: 'salida.v1', agente: 'fundamental', run_id: usuario['run_id'], snapshot_id: (usuario['snapshot'] as Record<string, unknown>)['id'], ticker: usuario['ticker'],
        veredicto: 'NO_EVALUABLE', puntaje: null, confianza: 0.3, resumen: 'Solo hay estado de resultados; falta balance y flujo de caja.',
        hallazgos: [{ id: 'h1', tipo: 'positivo', texto: 'El margen bruto se mantiene alto.', evidencia: ['margen_bruto_fy2024'] }, { id: 'h2', tipo: 'negativo', texto: 'No hay datos de balance.', evidencia: [] }],
        negativos: ['No hay datos de balance ni de flujo de caja.'], datos_fuente: [dato], supuestos: [], invalidadores: [],
        datos_faltantes: [{ campo: 'balance', critico: true }, { campo: 'flujo_caja_libre', critico: true }],
        subpuntajes: { crecimiento: null, rentabilidad: null, balance: null, flujo_caja: null, ventaja_competitiva: null }, tesis_propuesta: null, cambios_vs_tesis_vigente: [],
      };
      return { ok: true, texto: JSON.stringify(salida), json: salida, modelo: 'modelo-f', tokens_in: 100, tokens_out: 50 };
    }
    if (opciones.directorMalo) return { ok: true, texto: '{}', json: {}, modelo: 'modelo-d' };
    const dir = {
      contrato: 'integracion.v1', agente: 'director_ia', run_id: usuario['run_id'], snapshot_id: usuario['snapshot_id'], ticker: usuario['ticker'],
      portafolio_codigo: usuario['portafolio_codigo'], tipo_evaluacion: usuario['tipo_evaluacion'], resumen: 'No hay datos suficientes para integrar.',
      integracion: { coincidencias: [], contradicciones: [], no_comparables: [], discrepancias_con_auditoria: [] },
      tesis: opciones.directorPropone === true ? { estado: 'propuesta_cambio', propuesta: 'Negocio con margen bruto alto, pendiente de balance y flujo de caja.', pendiente_autorizacion: true } : { estado: 'sin_tesis', propuesta: null, pendiente_autorizacion: false }, riesgos_principales: ['Falta de datos de balance.'],
      hallazgos_negativos_ids: ['fundamental:h2'], negativos: ['Falta de datos de balance.'], datos_faltantes: ['balance', 'flujo_caja_libre'],
      condicion_que_cambiaria_la_conclusion: { texto: 'Disponer de balance y flujo de caja.', medible: false, umbral: null },
      recomendacion_para_motor: 'completar_datos', nivel_confianza: 0.3, explicacion_confianza: 'Cobertura muy parcial.',
    };
    return { ok: true, texto: JSON.stringify(dir), json: dir, modelo: 'modelo-d', tokens_in: 80, tokens_out: 40 };
  };
  return { llamar, peticiones };
}
