import { describe, expect, it } from 'vitest';
import { contieneOrden, validarContextoDirector, validarSalidaDirector, validarSalidaFundamental, validarSobreFundamental } from './index';
import { RUN_ID, contextoBase, salidaBase, salidaDirectorBase, sobreBase } from './fixtures.test-util';

const errF = (mut: (s: Record<string, unknown>) => void, sobre = sobreBase()): string => {
  const s = JSON.parse(JSON.stringify(salidaBase())) as Record<string, unknown>;
  mut(s);
  const r = validarSalidaFundamental(s, sobre);
  return r.ok ? '' : r.errores.join(' | ');
};
const errD = (mut: (s: Record<string, unknown>, ctx: ReturnType<typeof contextoBase>) => void): string => {
  const ctx = JSON.parse(JSON.stringify(contextoBase())) as ReturnType<typeof contextoBase>;
  const s = JSON.parse(JSON.stringify(salidaDirectorBase())) as Record<string, unknown>;
  mut(s, ctx);
  const c = validarContextoDirector(ctx);
  if (!c.ok) return `CTX: ${c.errores.join(' | ')}`;
  const r = validarSalidaDirector(s, c.valor);
  return r.ok ? '' : r.errores.join(' | ');
};

describe('detector de órdenes de compra o venta', () => {
  it('detecta instrucciones dirigidas al usuario', () => {
    for (const t of ['Compra GKOS hoy', 'compra X', 'Te sugiero vender la posición', 'Debes comprar más', 'Recomiendo comprar ahora', 'Vende ya', 'Compra la acción', 'You should buy more', 'Buy now', 'Sell GKOS', 'Es momento de vender', 'Esto es bueno. Compra más.']) expect(contieneOrden(t)).toBe(true);
  });
  it('no marca descripciones del negocio', () => {
    for (const t of ['La empresa compra acciones propias', 'Compra de acciones propias por 100 millones', 'Recompra de acciones neta positiva', 'Las ventas crecieron', 'El flujo de caja libre financia las recompras', 'Se recomienda revisar la tesis', 'Buyback program announced']) expect(contieneOrden(t)).toBe(false);
  });
});

describe('sobre del Fundamental', () => {
  it('acepta el sobre válido, también sin tesis vigente', () => {
    expect(validarSobreFundamental(sobreBase()).ok).toBe(true);
    expect(validarSobreFundamental({ ...sobreBase(), tesis_vigente: null }).ok).toBe(true);
  });
  it('rechaza sobre sin datos, sin snapshot, ids repetidos o fechas inválidas', () => {
    const sin = { ...sobreBase(), snapshot: { ...sobreBase().snapshot, datos: { items: [] } } };
    expect(validarSobreFundamental(sin).ok).toBe(false);
    expect(validarSobreFundamental({ ...sobreBase(), snapshot: undefined }).ok).toBe(false);
    expect(validarSobreFundamental(null).ok).toBe(false);
    const dup = sobreBase(); dup.snapshot.datos.items[1]!.id = 'd1';
    expect(validarSobreFundamental(dup).ok).toBe(false);
    const fecha = sobreBase(); fecha.snapshot.datos.items[0]!.fecha_dato = '2026-02-30';
    expect(validarSobreFundamental(fecha).ok).toBe(false);
    const sinFuente = sobreBase(); sinFuente.snapshot.datos.items[0]!.fuente = '';
    expect(validarSobreFundamental(sinFuente).ok).toBe(false);
    expect(validarSobreFundamental({ ...sobreBase(), run_id: 'x' }).ok).toBe(false);
    expect(validarSobreFundamental({ ...sobreBase(), mercado: 'EU' }).ok).toBe(false);
    expect(validarSobreFundamental({ ...sobreBase(), agente: 'tecnico' }).ok).toBe(false);
    expect(validarSobreFundamental({ ...sobreBase(), contrato: 'entrada.v2' }).ok).toBe(false);
    expect(validarSobreFundamental({ ...sobreBase(), tesis_vigente: { texto: '', version: 1, origen: 'x' } }).ok).toBe(false);
  });
});

describe('salida del Fundamental', () => {
  it('acepta la salida válida', () => {
    expect(errF(() => undefined)).toBe('');
  });
  it('rechaza identificadores que no coinciden con el sobre', () => {
    expect(errF(s => { s['run_id'] = '99999999-9999-4999-8999-999999999999'; })).toContain('run_id');
    expect(errF(s => { s['snapshot_id'] = 'x'; })).toContain('snapshot_id');
    expect(errF(s => { s['ticker'] = 'AAPL'; })).toContain('ticker');
    expect(errF(s => { s['contrato'] = 'salida.v2'; })).toContain('contrato');
    expect(errF(s => { s['agente'] = 'tecnico'; })).toContain('agente');
  });
  it('rechaza veredicto, puntaje, confianza y resumen fuera de contrato', () => {
    expect(errF(s => { s['veredicto'] = 'COMPRAR'; })).toContain('veredicto');
    expect(errF(s => { s['puntaje'] = 101; })).toContain('puntaje');
    expect(errF(s => { s['puntaje'] = -1; })).toContain('puntaje');
    expect(errF(s => { s['puntaje'] = null; })).toContain('puntaje null');
    expect(errF(s => { s['confianza'] = 1.1; })).toContain('confianza');
    expect(errF(s => { s['confianza'] = -0.1; })).toContain('confianza');
    expect(errF(s => { s['resumen'] = ''; })).toContain('resumen');
    expect(errF(s => { s['resumen'] = 'x'.repeat(601); })).toContain('resumen');
    expect(errF(s => { s['resumen'] = 'x'.repeat(600); })).toBe('');
    expect(errF(s => { s['puntaje'] = 0; s['confianza'] = 0; })).toBe('');
    expect(errF(s => { s['puntaje'] = 100; s['confianza'] = 1; })).toBe('');
  });
  it('datos_fuente solo puede citar items del snapshot, idénticos (no inventa ni altera cifras)', () => {
    expect(errF(s => { (s['datos_fuente'] as Record<string, unknown>[])[0]!['valor'] = 0.9; })).toContain('no coincide');
    expect(errF(s => { (s['datos_fuente'] as Record<string, unknown>[])[0]!['id'] = 'd9'; })).toContain('no existe en el snapshot');
    expect(errF(s => { (s['datos_fuente'] as Record<string, unknown>[])[0]!['fuente'] = 'Yo'; })).toContain('no coincide');
    expect(errF(s => { (s['datos_fuente'] as Record<string, unknown>[])[1]!['unidad'] = 'USD'; })).toContain('no coincide');
    expect(errF(s => { (s['datos_fuente'] as Record<string, unknown>[])[0]!['fecha_dato'] = '2026-07-01'; })).toContain('no coincide');
    expect(errF(s => { (s['datos_fuente'] as Record<string, unknown>[])[0]!['campo'] = 'otro'; })).toContain('no coincide');
    expect(errF(s => { (s['datos_fuente'] as Record<string, unknown>[])[0]!['fuente'] = ''; })).toContain('sin fuente');
    expect(errF(s => { s['datos_fuente'] = 'x'; })).toContain('datos_fuente');
  });
  it('hallazgos: cifra sin evidencia, evidencia inexistente, ids repetidos, tipo inválido', () => {
    expect(errF(s => { (s['hallazgos'] as Record<string, unknown>[])[0]!['evidencia'] = []; })).toContain('cifra sin evidencia');
    expect(errF(s => { (s['hallazgos'] as Record<string, unknown>[])[0]!['evidencia'] = ['d9']; })).toContain('no está en datos_fuente');
    expect(errF(s => { (s['hallazgos'] as Record<string, unknown>[])[1]!['id'] = 'h1'; })).toContain('repetido');
    expect(errF(s => { (s['hallazgos'] as Record<string, unknown>[])[1]!['tipo'] = 'malo'; })).toContain('tipo');
    expect(errF(s => { (s['hallazgos'] as Record<string, unknown>[])[1]!['texto'] = ''; })).toContain('texto');
    expect(errF(s => { (s['hallazgos'] as Record<string, unknown>[])[1]!['evidencia'] = 'd3'; })).toContain('evidencia');
    expect(errF(s => { s['hallazgos'] = {}; })).toContain('hallazgos');
    // sin cifra, la evidencia vacía es válida
    expect(errF(s => { (s['hallazgos'] as Record<string, unknown>[])[1]!['evidencia'] = []; })).toBe('');
    // códigos como Q3 o 10-K no cuentan como cifra
    expect(errF(s => { (s['hallazgos'] as Record<string, unknown>[])[1]!['texto'] = 'Según el 10-K del Q3 hay concentración.'; (s['hallazgos'] as Record<string, unknown>[])[1]!['evidencia'] = []; })).toBe('');
  });
  it('negativos obligatorios (al menos uno, textos no vacíos)', () => {
    expect(errF(s => { s['negativos'] = []; })).toContain('negativos');
    expect(errF(s => { s['negativos'] = ['']; })).toContain('negativos');
    expect(errF(s => { delete s['negativos']; })).toContain('negativos');
  });
  it('supuestos, invalidadores y umbrales', () => {
    expect(errF(s => { s['supuestos'] = [1]; })).toContain('supuestos');
    expect(errF(s => { s['invalidadores'] = 'x'; })).toContain('invalidadores');
    expect(errF(s => { (s['invalidadores'] as Record<string, unknown>[])[0]!['umbral'] = null; })).toContain('medible exige umbral');
    expect(errF(s => { (s['invalidadores'] as Record<string, unknown>[])[0]!['medible'] = false; (s['invalidadores'] as Record<string, unknown>[])[0]!['umbral'] = null; })).toBe('');
    expect(errF(s => { ((s['invalidadores'] as Record<string, unknown>[])[0]!['umbral'] as Record<string, unknown>)['operador'] = '~'; })).toContain('umbral inválido');
    expect(errF(s => { ((s['invalidadores'] as Record<string, unknown>[])[0]!['umbral'] as Record<string, unknown>)['valor'] = '0.7'; })).toContain('umbral inválido');
    expect(errF(s => { (s['invalidadores'] as Record<string, unknown>[])[0]!['condicion'] = ''; })).toContain('condicion');
    expect(errF(s => { (s['invalidadores'] as Record<string, unknown>[])[0]!['medible'] = 'si'; })).toContain('medible');
  });
  it('datos faltantes críticos obligan a NO_EVALUABLE; NO_EVALUABLE exige listarlos', () => {
    expect(errF(s => { s['datos_faltantes'] = [{ campo: 'fcf', critico: true }]; })).toContain('críticos');
    expect(errF(s => { s['datos_faltantes'] = [{ campo: 'fcf', critico: false }]; })).toBe('');
    expect(errF(s => { s['datos_faltantes'] = [{ campo: 'fcf' }]; })).toContain('datos_faltantes[0]');
    expect(errF(s => { s['datos_faltantes'] = 'x'; })).toContain('datos_faltantes');
    const noEval = (s: Record<string, unknown>): void => {
      s['veredicto'] = 'NO_EVALUABLE'; s['puntaje'] = null; s['tesis_propuesta'] = null;
      s['subpuntajes'] = { crecimiento: null, rentabilidad: null, balance: null, flujo_caja: null, ventaja_competitiva: null };
      s['datos_faltantes'] = [{ campo: 'fcf', critico: true }];
    };
    expect(errF(noEval)).toBe('');
    expect(errF(s => { noEval(s); s['datos_faltantes'] = []; })).toContain('NO_EVALUABLE exige');
  });
  it('subpuntajes y tesis_propuesta: null solo con NO_EVALUABLE; rangos', () => {
    expect(errF(s => { (s['subpuntajes'] as Record<string, unknown>)['balance'] = null; })).toContain('subpuntajes.balance null');
    expect(errF(s => { (s['subpuntajes'] as Record<string, unknown>)['balance'] = 101; })).toContain('subpuntajes.balance');
    expect(errF(s => { delete (s['subpuntajes'] as Record<string, unknown>)['balance']; })).toContain('subpuntajes.balance');
    expect(errF(s => { s['subpuntajes'] = null; })).toContain('subpuntajes');
    expect(errF(s => { s['tesis_propuesta'] = null; })).toContain('tesis_propuesta null');
    expect(errF(s => { s['tesis_propuesta'] = { resumen: '', motores: [], riesgos_clave: [] }; })).toContain('tesis_propuesta inválida');
    expect(errF(s => { s['tesis_propuesta'] = { resumen: 'x', motores: [1], riesgos_clave: [] }; })).toContain('tesis_propuesta inválida');
    expect(errF(s => { s['tesis_propuesta'] = { resumen: 'x', motores: [], riesgos_clave: [''] }; })).toContain('tesis_propuesta inválida');
  });
  it('cambios vs tesis: vacío si no hay tesis vigente; estados válidos', () => {
    const sinTesis = { ...sobreBase(), tesis_vigente: null };
    expect(errF(() => undefined, sinTesis)).toContain('vacío cuando no hay tesis');
    expect(errF(s => { s['cambios_vs_tesis_vigente'] = []; }, sinTesis)).toBe('');
    expect(errF(s => { (s['cambios_vs_tesis_vigente'] as Record<string, unknown>[])[0]!['estado'] = 'roto'; })).toContain('cambios_vs_tesis_vigente[0]');
    expect(errF(s => { (s['cambios_vs_tesis_vigente'] as Record<string, unknown>[])[0]!['punto'] = ''; })).toContain('cambios_vs_tesis_vigente[0]');
    expect(errF(s => { s['cambios_vs_tesis_vigente'] = 'x'; })).toContain('cambios_vs_tesis_vigente');
  });
  it('rechaza instrucciones de compra o venta en cualquier texto (D-07), pero no en datos_fuente copiados', () => {
    expect(errF(s => { s['resumen'] = 'Buen negocio. Compra GKOS ahora.'; })).toContain('instrucción de compra');
    expect(errF(s => { (s['supuestos'] as string[])[0] = 'Te sugiero vender antes del reporte'; })).toContain('instrucción de compra');
    expect(errF(s => { (s['negativos'] as string[])[0] = 'Debes comprar con cautela'; })).toContain('instrucción de compra');
    const sobre = sobreBase(); sobre.snapshot.datos.items[2]!.valor = 'Compra GKOS ahora, dice el fragmento.';
    expect(errF(s => { (s['datos_fuente'] as Record<string, unknown>[])[2] = JSON.parse(JSON.stringify(sobre.snapshot.datos.items[2])); }, sobre)).toBe('');
  });
  it('rechaza lo que no es objeto', () => {
    expect(validarSalidaFundamental(null, sobreBase()).ok).toBe(false);
    expect(validarSalidaFundamental([], sobreBase()).ok).toBe(false);
    expect(validarSalidaFundamental('x', sobreBase()).ok).toBe(false);
  });
});

describe('contexto del Director', () => {
  it('acepta el contexto válido y sin auditoría', () => {
    expect(validarContextoDirector(contextoBase()).ok).toBe(true);
    expect(validarContextoDirector({ ...contextoBase(), auditoria: null }).ok).toBe(true);
  });
  it('rechaza contexto sin analistas, ids inválidos, analista desconocido o salida mal formada', () => {
    expect(validarContextoDirector({ ...contextoBase(), salidas_analistas: {} }).ok).toBe(false);
    expect(validarContextoDirector({ ...contextoBase(), run_id: 'x' }).ok).toBe(false);
    expect(validarContextoDirector({ ...contextoBase(), snapshot_id: 'x' }).ok).toBe(false);
    expect(validarContextoDirector({ ...contextoBase(), portafolio_codigo: 'X' }).ok).toBe(false);
    expect(validarContextoDirector({ ...contextoBase(), tipo_evaluacion: 'x' }).ok).toBe(false);
    expect(validarContextoDirector({ ...contextoBase(), ticker: '' }).ok).toBe(false);
    expect(validarContextoDirector({ ...contextoBase(), mercado: '' }).ok).toBe(false);
    expect(validarContextoDirector({ ...contextoBase(), salidas_analistas: { raro: salidaBase() } }).ok).toBe(false);
    expect(validarContextoDirector({ ...contextoBase(), salidas_analistas: { fundamental: { agente: 'tecnico' } } }).ok).toBe(false);
    expect(validarContextoDirector({ ...contextoBase(), auditoria: { veredicto: '' , reglas_revisadas: [] } }).ok).toBe(false);
    expect(validarContextoDirector({ ...contextoBase(), reglas_versiones_ids: 'x' }).ok).toBe(false);
    expect(validarContextoDirector(null).ok).toBe(false);
  });
});

describe('salida del Director (integracion.v1)', () => {
  it('acepta la salida válida', () => {
    expect(errD(() => undefined)).toBe('');
  });
  it('rechaza identificadores que no coinciden', () => {
    for (const k of ['run_id', 'snapshot_id', 'ticker', 'portafolio_codigo', 'tipo_evaluacion']) expect(errD(s => { s[k] = 'otro'; })).toContain(k);
    expect(errD(s => { s['contrato'] = 'integracion.v2'; })).toContain('contrato');
    expect(errD(s => { s['agente'] = 'fundamental'; })).toContain('agente');
  });
  it('D-02: veredictos opuestos sin contradicción se rechazan; con contradicción declarada se aceptan', () => {
    const opuestos = (s: Record<string, unknown>, ctx: ReturnType<typeof contextoBase>): void => {
      const tec = { ...JSON.parse(JSON.stringify(salidaBase())), agente: 'tecnico', veredicto: 'DESFAVORABLE', hallazgos: [{ id: 'h1', tipo: 'negativo', texto: 'Tendencia bajista.', evidencia: [] }] };
      (ctx.salidas_analistas as Record<string, unknown>)['tecnico'] = tec;
      (ctx.salidas_analistas.fundamental as Record<string, unknown>)['veredicto'] = 'SOLIDO';
      s['hallazgos_negativos_ids'] = ['fundamental:h2', 'tecnico:h1'];
    };
    expect(errD(opuestos)).toContain('veredictos opuestos');
    expect(errD((s, ctx) => {
      opuestos(s, ctx);
      (s['integracion'] as Record<string, unknown>)['contradicciones'] = [{ entre: ['fundamental', 'tecnico'], texto: 'Fundamental sólido, técnico bajista.', evidencia: ['fundamental:h1', 'tecnico:h1'] }];
    })).toBe('');
  });
  it('D-04: omitir un hallazgo negativo o citar uno inexistente se rechaza', () => {
    expect(errD(s => { s['hallazgos_negativos_ids'] = []; })).toContain('omite un hallazgo negativo: fundamental:h2');
    expect(errD(s => { s['hallazgos_negativos_ids'] = ['fundamental:h2', 'fundamental:h1']; })).toContain('no es un hallazgo negativo existente');
    expect(errD(s => { s['hallazgos_negativos_ids'] = 'x'; })).toContain('hallazgos_negativos_ids');
  });
  it('D-03: cifra que no existe en los datos de los analistas se rechaza; las existentes y los conteos simples se aceptan', () => {
    expect(errD(s => { s['resumen'] = 'Los ingresos crecieron 35% en el periodo.'; })).toContain('cifra que no existe');
    expect(errD(s => { s['resumen'] = 'El margen bruto es 0.82.'; })).toBe('');
    expect(errD(s => { s['resumen'] = 'El margen bruto es 0,82.'; })).toBe('');
    expect(errD(s => { s['resumen'] = 'Los ingresos son 123,456,789 USD.'; })).toBe('');
    expect(errD(s => { s['resumen'] = 'Solo 1 analista disponible.'; })).toBe('');
    expect(errD(s => { s['resumen'] = 'Crecimiento de 5% anual.'; })).toContain('cifra que no existe');
    expect(errD(s => { s['resumen'] = 'Crecimiento de 5.5 anual.'; })).toContain('cifra que no existe');
    expect(errD(s => { s['resumen'] = 'Aplican PMP-01 y el 10-K.'; })).toBe('');
    expect(errD((s, ctx) => { ctx.auditoria = { veredicto: 'CUMPLE', reglas_revisadas: ['PMP-01'] }; (ctx as unknown as Record<string, unknown>)['contexto'] = { plazo: 36 }; s['resumen'] = 'Horizonte de 36 meses.'; })).toBe('');
    expect(errD(s => { s['resumen'] = 'Puntaje de 66.'; })).toBe('');
  });
  it('umbral de la condición: su valor puede aparecer en su texto; no es cifra libre en otros textos', () => {
    expect(errD(s => { (s['condicion_que_cambiaria_la_conclusion'] as Record<string, unknown>)['texto'] = 'Si el margen bruto cae bajo 0.7.'; })).toBe('');
    expect(errD(s => { (s['condicion_que_cambiaria_la_conclusion'] as Record<string, unknown>)['texto'] = 'Si el margen bruto cae bajo 0.55.'; })).toContain('cifra que no existe');
    expect(errD(s => { (s['condicion_que_cambiaria_la_conclusion'] as Record<string, unknown>)['texto'] = 'Si el margen bruto cae bajo 0.9.'; })).toContain('0.9');
    expect(errD(s => { (s['condicion_que_cambiaria_la_conclusion'] as Record<string, unknown>)['umbral'] = { campo: 'margen_bruto', operador: '<', valor: -0.5 }; (s['condicion_que_cambiaria_la_conclusion'] as Record<string, unknown>)['texto'] = 'Que el cambio fuera 0.5 negativo.'; })).toBe('');
  });
  it('referencias a hallazgos inexistentes y contradicciones mal formadas', () => {
    expect(errD(s => { ((s['integracion'] as Record<string, unknown>)['coincidencias'] as Record<string, unknown>[])[0]!['evidencia'] = ['fundamental:h9']; })).toContain('referencia inexistente');
    expect(errD(s => { ((s['integracion'] as Record<string, unknown>)['coincidencias'] as Record<string, unknown>[])[0]!['evidencia'] = 'x'; })).toContain('evidencia');
    expect(errD(s => { ((s['integracion'] as Record<string, unknown>)['coincidencias'] as Record<string, unknown>[])[0]!['texto'] = ''; })).toContain('coincidencias[0]');
    expect(errD(s => { (s['integracion'] as Record<string, unknown>)['contradicciones'] = [{ entre: ['fundamental'], texto: 'x', evidencia: [] }]; })).toContain('contradicciones[0]');
    expect(errD(s => { (s['integracion'] as Record<string, unknown>)['contradicciones'] = [{ entre: ['fundamental', 'tecnico'], texto: 'x', evidencia: [] }]; })).toContain('contradicciones[0]');
    expect(errD(s => { (s['integracion'] as Record<string, unknown>)['no_comparables'] = [{ texto: 'x' }]; })).toContain('no_comparables[0]');
    expect(errD(s => { (s['integracion'] as Record<string, unknown>)['discrepancias_con_auditoria'] = [{ regla: 'PMP-01' }]; })).toContain('discrepancias_con_auditoria[0]');
    expect(errD(s => { (s['integracion'] as Record<string, unknown>)['coincidencias'] = 'x'; })).toContain('integracion.coincidencias');
    expect(errD(s => { delete s['integracion']; })).toContain('integracion ausente');
  });
  it('negativos, riesgos, faltantes, condición, recomendación y confianza', () => {
    expect(errD(s => { s['negativos'] = []; })).toContain('negativos');
    expect(errD(s => { s['riesgos_principales'] = [1]; })).toContain('riesgos_principales');
    expect(errD(s => { s['datos_faltantes'] = [1]; })).toContain('datos_faltantes');
    expect(errD(s => { s['recomendacion_para_motor'] = 'comprar'; })).toContain('recomendacion_para_motor');
    expect(errD(s => { s['nivel_confianza'] = 2; })).toContain('nivel_confianza');
    expect(errD(s => { s['explicacion_confianza'] = ''; })).toContain('explicacion_confianza');
    expect(errD(s => { s['resumen'] = 'x'.repeat(601); })).toContain('resumen');
    expect(errD(s => { s['condicion_que_cambiaria_la_conclusion'] = null; })).toContain('condicion_que_cambiaria_la_conclusion inválida');
    expect(errD(s => { (s['condicion_que_cambiaria_la_conclusion'] as Record<string, unknown>)['umbral'] = null; })).toContain('medible exige umbral');
    expect(errD(s => { (s['condicion_que_cambiaria_la_conclusion'] as Record<string, unknown>)['medible'] = false; (s['condicion_que_cambiaria_la_conclusion'] as Record<string, unknown>)['umbral'] = null; })).toBe('');
    expect(errD(s => { (s['condicion_que_cambiaria_la_conclusion'] as Record<string, unknown>)['umbral'] = { campo: '', operador: '<', valor: 1 }; })).toContain('umbral inválido');
  });
  it('D-05: un cambio de tesis queda pendiente de autorización', () => {
    expect(errD(s => { s['tesis'] = { estado: 'propuesta_cambio', propuesta: 'Nueva tesis más cauta.', pendiente_autorizacion: false }; })).toContain('pendiente_autorizacion = true');
    expect(errD(s => { s['tesis'] = { estado: 'propuesta_cambio', propuesta: 'Nueva tesis más cauta.', pendiente_autorizacion: true }; })).toBe('');
    expect(errD(s => { s['tesis'] = { estado: 'vigente', propuesta: 'Nueva tesis.', pendiente_autorizacion: true }; })).toContain('estado debe ser propuesta_cambio');
    expect(errD(s => { s['tesis'] = { estado: 'propuesta_cambio', propuesta: null, pendiente_autorizacion: true }; })).toContain('exige texto');
    expect(errD(s => { s['tesis'] = { estado: 'raro', propuesta: null, pendiente_autorizacion: false }; })).toContain('tesis inválida');
    expect(errD(s => { s['tesis'] = null; })).toContain('tesis inválida');
  });
  it('D-09: con BLOQUEO_REGLA o NO_ELEGIBLE y «continuar», exige declarar la discrepancia', () => {
    for (const v of ['BLOQUEO_REGLA', 'NO_ELEGIBLE']) {
      expect(errD((_s, ctx) => { ctx.auditoria = { veredicto: v as 'BLOQUEO_REGLA', reglas_revisadas: ['PMP-01'] }; })).toContain(`el Auditor emitió ${v}`);
      expect(errD((s, ctx) => { ctx.auditoria = { veredicto: v as 'BLOQUEO_REGLA', reglas_revisadas: ['PMP-01'] }; (s['integracion'] as Record<string, unknown>)['discrepancias_con_auditoria'] = [{ regla: 'PMP-01', texto: 'El Director ve la operación como viable, pero la regla la bloquea.' }]; })).toBe('');
      expect(errD((s, ctx) => { ctx.auditoria = { veredicto: v as 'BLOQUEO_REGLA', reglas_revisadas: [] }; s['recomendacion_para_motor'] = 'detener'; })).toBe('');
    }
    expect(errD((_s, ctx) => { ctx.auditoria = { veredicto: 'NO_EVALUABLE', reglas_revisadas: [] }; })).toBe('');
  });
  it('D-07: rechaza instrucciones de compra o venta', () => {
    expect(errD(s => { s['resumen'] = 'Análisis aceptable. Compra GKOS ahora.'; })).toContain('instrucción de compra');
    expect(errD(s => { (s['riesgos_principales'] as string[])[0] = 'Te sugiero vender si cae'; })).toContain('instrucción de compra');
  });
  it('rechaza lo que no es objeto', () => {
    const c = validarContextoDirector(contextoBase());
    if (!c.ok) throw new Error('contexto');
    expect(validarSalidaDirector(null, c.valor).ok).toBe(false);
    expect(validarSalidaDirector([], c.valor).ok).toBe(false);
    void RUN_ID;
  });
});

describe('refuerzo: sobre del Fundamental, campo por campo', () => {
  const con = (mut: (s: ReturnType<typeof sobreBase>) => void): string => {
    const s = sobreBase(); mut(s);
    const r = validarSobreFundamental(s);
    return r.ok ? '' : r.errores.join(' | ');
  };
  it('cada campo de un item y del snapshot se valida por separado', () => {
    expect(con(() => undefined)).toBe('');
    expect(con(s => { (s.snapshot.datos.items[0] as unknown as Record<string, unknown>)['valor'] = NaN; })).toContain('valor debe ser número finito o texto');
    expect(con(s => { (s.snapshot.datos.items[0] as unknown as Record<string, unknown>)['valor'] = {}; })).toContain('valor debe ser número finito o texto');
    expect(con(s => { (s.snapshot.datos.items[0] as unknown as Record<string, unknown>)['valor'] = ''; })).toContain('valor debe ser número finito o texto');
    expect(con(s => { (s.snapshot.datos.items[0] as unknown as Record<string, unknown>)['unidad'] = 5; })).toContain('unidad debe ser texto o null');
    expect(con(s => { s.snapshot.datos.items[0]!.campo = ''; })).toContain('campo ausente');
    expect(con(s => { s.snapshot.datos.items[0]!.id = ''; })).toContain('id ausente');
    expect(con(s => { s.snapshot.datos.items[0]!.fuente = ' '; })).toContain('fuente ausente');
    expect(con(s => { s.snapshot.datos.items[0]!.fecha_dato = '2026-13-45'; })).toContain('fecha_dato inválida');
    expect(con(s => { s.snapshot.datos.items[1]!.id = 'd1'; })).toContain('repetido');
    expect(con(s => { (s.snapshot.datos.items as unknown[])[0] = []; })).toContain('items[0] no es objeto');
    expect(con(s => { s.snapshot.id = 'x'; })).toContain('snapshot.id no es uuid');
    expect(con(s => { s.snapshot.generado_en = ''; })).toContain('generado_en ausente');
    expect(con(s => { s.ticker = ''; })).toContain('ticker ausente');
    expect(con(s => { s.run_id = 'x'; })).toContain('run_id no es uuid');
    expect(con(s => { s.agente = 'x'; })).toContain('agente debe ser fundamental');
    expect(con(s => { s.contrato = 'x'; })).toContain('contrato debe ser entrada.v1');
    expect(con(s => { s.mercado = 'x'; })).toContain('mercado debe ser US o BMV');
    expect(con(s => { (s.snapshot as unknown as Record<string, unknown>)['datos'] = []; })).toContain('items ausente o vacío');
    expect(con(s => { s.tesis_vigente = { texto: 'x', version: 1.5, origen: 'al_entrar' }; })).toContain('tesis_vigente inválida');
    expect(con(s => { s.tesis_vigente = { texto: 'x', version: 1, origen: '' }; })).toContain('tesis_vigente inválida');
    expect(con(s => { s.tesis_vigente = [] as unknown as typeof s.tesis_vigente; })).toContain('tesis_vigente inválida');
  });
  it('un sobre sin la clave tesis_vigente queda normalizado a null', () => {
    const s = sobreBase() as unknown as Record<string, unknown>;
    delete s['tesis_vigente'];
    const r = validarSobreFundamental(s);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valor.tesis_vigente).toBeNull();
  });
});

describe('refuerzo: salida del Fundamental', () => {
  it('mensajes específicos para listas y umbrales', () => {
    expect(errF(s => { (s['hallazgos'] as Record<string, unknown>[])[1]!['evidencia'] = 'd3'; })).toContain('evidencia debe ser una lista');
    expect(errF(s => { ((s['invalidadores'] as Record<string, unknown>[])[0]!['umbral'] as Record<string, unknown>)['campo'] = ''; })).toContain('umbral inválido');
    expect(errF(s => { (s['hallazgos'] as unknown[])[0] = []; })).toContain('hallazgos[0] no es objeto');
    expect(errF(s => { (s['hallazgos'] as Record<string, unknown>[])[0]!['id'] = ''; })).toContain('id ausente');
    expect(errF(s => { (s['datos_fuente'] as unknown[])[0] = []; })).toContain('datos_fuente[0] no es objeto');
    expect(errF(s => { (s['invalidadores'] as unknown[])[0] = []; })).toContain('invalidadores[0] no es objeto');
  });
});

describe('refuerzo: contexto y salida del Director, campo por campo', () => {
  const ctxErr = (mut: (c: Record<string, unknown>) => void): string => {
    const c = JSON.parse(JSON.stringify(contextoBase())) as Record<string, unknown>; mut(c);
    const r = validarContextoDirector(c);
    return r.ok ? '' : r.errores.join(' | ');
  };
  const sa = (c: Record<string, unknown>): Record<string, Record<string, unknown>> => c['salidas_analistas'] as Record<string, Record<string, unknown>>;
  it('contexto: cada exigencia con su mensaje', () => {
    expect(ctxErr(() => undefined)).toBe('');
    expect(ctxErr(c => { c['run_id'] = 'x'; })).toContain('run_id no es uuid');
    expect(ctxErr(c => { c['snapshot_id'] = 'x'; })).toContain('snapshot_id no es uuid');
    expect(ctxErr(c => { c['ticker'] = ''; })).toContain('ticker ausente');
    expect(ctxErr(c => { c['mercado'] = ''; })).toContain('mercado ausente');
    expect(ctxErr(c => { c['portafolio_codigo'] = 'X'; })).toContain('portafolio_codigo inválido');
    expect(ctxErr(c => { c['tipo_evaluacion'] = 'x'; })).toContain('tipo_evaluacion inválido');
    expect(ctxErr(c => { c['salidas_analistas'] = {}; })).toContain('al menos la salida validada de un analista');
    expect(ctxErr(c => { sa(c)['raro'] = sa(c)['fundamental']!; })).toContain('analista desconocido: raro');
    expect(ctxErr(c => { sa(c)['fundamental']!['agente'] = 'tecnico'; })).toContain('no tiene la forma validada');
    expect(ctxErr(c => { sa(c)['fundamental']!['veredicto'] = ''; })).toContain('no tiene la forma validada');
    expect(ctxErr(c => { sa(c)['fundamental']!['hallazgos'] = 'x'; })).toContain('no tiene la forma validada');
    expect(ctxErr(c => { sa(c)['fundamental']!['datos_fuente'] = 'x'; })).toContain('no tiene la forma validada');
    expect(ctxErr(c => { c['salidas_analistas'] = { fundamental: [] }; })).toContain('no tiene la forma validada');
    expect(ctxErr(c => { c['auditoria'] = { veredicto: 'CUMPLE' }; })).toContain('auditoria inválida');
    expect(ctxErr(c => { c['auditoria'] = { veredicto: '', reglas_revisadas: [] }; })).toContain('auditoria inválida');
    expect(ctxErr(c => { c['auditoria'] = 'x'; })).toContain('auditoria inválida');
    expect(ctxErr(c => { c['reglas_versiones_ids'] = 'x'; })).toContain('reglas_versiones_ids debe ser una lista');
  });
  it('contexto sin auditoría ni contexto adicional se normaliza a null', () => {
    const c = JSON.parse(JSON.stringify(contextoBase())) as Record<string, unknown>;
    delete c['auditoria']; delete c['contexto'];
    const r = validarContextoDirector(c);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.valor.auditoria).toBeNull(); expect(r.valor.contexto).toBeNull(); }
  });

  it('salida: resumen vacío, listas y campos con su mensaje', () => {
    expect(errD(s => { s['resumen'] = ''; })).toContain('resumen obligatorio');
    expect(errD(s => { s['hallazgos_negativos_ids'] = ['fundamental:h2', 5]; })).toContain('hallazgos_negativos_ids debe ser una lista de textos');
    expect(errD(s => { s['datos_faltantes'] = 'x'; })).toContain('datos_faltantes debe ser una lista de textos');
    expect(errD(s => { s['riesgos_principales'] = 'x'; })).toContain('riesgos_principales debe ser una lista de textos');
    expect(errD(s => { (s['tesis'] as Record<string, unknown>)['pendiente_autorizacion'] = 'si'; })).toContain('tesis inválida');
    expect(errD(s => { (s['tesis'] as Record<string, unknown>)['propuesta'] = 5; })).toContain('tesis inválida');
    expect(errD(s => { (s['condicion_que_cambiaria_la_conclusion'] as Record<string, unknown>)['texto'] = ''; })).toContain('condicion_que_cambiaria_la_conclusion inválida');
    expect(errD(s => { (s['condicion_que_cambiaria_la_conclusion'] as Record<string, unknown>)['medible'] = 'si'; })).toContain('condicion_que_cambiaria_la_conclusion inválida');
    expect(errD(s => { ((s['condicion_que_cambiaria_la_conclusion'] as Record<string, unknown>)['umbral'] as Record<string, unknown>)['operador'] = '~'; })).toContain('umbral inválido');
    expect(errD(s => { ((s['condicion_que_cambiaria_la_conclusion'] as Record<string, unknown>)['umbral'] as Record<string, unknown>)['valor'] = '0.7'; })).toContain('umbral inválido');
    expect(errD(s => { ((s['condicion_que_cambiaria_la_conclusion'] as Record<string, unknown>)['umbral'] as Record<string, unknown>)['campo'] = ''; })).toContain('umbral inválido');
    expect(errD(s => { (s['integracion'] as Record<string, unknown>)['contradicciones'] = [{ entre: ['fundamental', 'fundamental'], texto: '', evidencia: [] }]; })).toContain('contradicciones[0] inválida');
    expect(errD(s => { (s['integracion'] as Record<string, unknown>)['contradicciones'] = [{ entre: ['fundamental', 'fundamental'], texto: 'x', evidencia: ['fundamental:h9'] }]; })).toContain('referencia inexistente');
    expect(errD(s => { (s['integracion'] as Record<string, unknown>)['no_comparables'] = [{ texto: 'x', motivo: '' }]; })).toContain('no_comparables[0]');
    expect(errD(s => { (s['integracion'] as Record<string, unknown>)['discrepancias_con_auditoria'] = [{ regla: 'PMP-01', texto: '' }]; })).toContain('discrepancias_con_auditoria[0]');
  });
  it('veredictos opuestos: solo uno de los lados no obliga a declarar contradicción', () => {
    const dosAnalistas = (v1: string, v2: string) => (s: Record<string, unknown>, ctx: ReturnType<typeof contextoBase>): void => {
      (ctx.salidas_analistas.fundamental as Record<string, unknown>)['veredicto'] = v1;
      (ctx.salidas_analistas as Record<string, unknown>)['tecnico'] = { ...JSON.parse(JSON.stringify(salidaBase())), agente: 'tecnico', veredicto: v2, hallazgos: [] };
      s['hallazgos_negativos_ids'] = ['fundamental:h2'];
    };
    expect(errD(dosAnalistas('SOLIDO', 'FAVORABLE'))).toBe('');
    expect(errD(dosAnalistas('DEBIL', 'DESFAVORABLE'))).toBe('');
    expect(errD(dosAnalistas('SOLIDO', 'ESPERAR'))).toBe('');
    expect(errD(dosAnalistas('SOLIDO', 'DESFAVORABLE'))).toContain('veredictos opuestos');
    expect(errD(dosAnalistas('DEBIL', 'FAVORABLE'))).toContain('veredictos opuestos');
  });
  it('las cifras de la auditoría y del contexto son citables; las referencias a hallazgos no cuentan como cifras', () => {
    expect(errD((s, ctx) => { ctx.auditoria = { veredicto: 'CUMPLE', reglas_revisadas: ['regla con tope 77'] }; s['resumen'] = 'La auditoría usa un tope de 77.'; })).toBe('');
    expect(errD(s => { s['resumen'] = 'La auditoría usa un tope de 77.'; })).toContain('77');
    expect(errD(s => { s['resumen'] = 'Ver fundamental:h12 y PMP-01.'; })).toBe('');
    expect(errD(s => { ((s['integracion'] as Record<string, unknown>)['coincidencias'] as Record<string, unknown>[])[0]!['evidencia'] = ['fundamental:h1']; s['resumen'] = 'Ver fundamental:h12.'; })).toBe('');
  });
  it('el ticker y el campo del umbral no se toman como cifras', () => {
    expect(errD((s, ctx) => { ctx.ticker = '9988.HK'; s['ticker'] = '9988.HK'; })).toBe('');
    expect(errD(s => { ((s['condicion_que_cambiaria_la_conclusion'] as Record<string, unknown>)['umbral'] as Record<string, unknown>)['campo'] = '52w_alto'; })).toBe('');
  });
  it('el número de una regla en discrepancias no se toma como cifra', () => {
    expect(errD((s, ctx) => {
      ctx.auditoria = { veredicto: 'BLOQUEO_REGLA', reglas_revisadas: ['PMP-01'] };
      (s['integracion'] as Record<string, unknown>)['discrepancias_con_auditoria'] = [{ regla: 'PMP-01', texto: 'La regla PMP-01 bloquea la operación.' }];
    })).toBe('');
  });
});
