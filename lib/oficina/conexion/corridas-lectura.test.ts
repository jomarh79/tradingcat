import { describe, expect, it } from 'vitest';
import { detalleCorrida, limiteSeguro, limpiarTicker, listarCorridas, planSalidaDe, reglasDe, textoCorto } from './corridas-lectura';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Cliente falso: registra las llamadas y responde por tabla. Solo expone lectura (cualquier otra cosa falla). */
function falso(tablas: Record<string, { data?: unknown; error?: unknown }>) {
  const llamadas: Array<{ tabla: string; op: string; args: unknown[] }> = [];
  return {
    llamadas,
    from(tabla: string) {
      const r = tablas[tabla] ?? { data: [] };
      const q: Record<string, unknown> = {};
      for (const op of ['select', 'ilike', 'eq', 'in', 'order', 'limit']) {
        q[op] = (...args: unknown[]) => { llamadas.push({ tabla, op, args }); return q; };
      }
      q['then'] = (ok: (v: unknown) => unknown) => Promise.resolve({ data: r.data ?? null, error: r.error ?? null }).then(ok);
      return q;
    },
  };
}

describe('corridas-lectura: utilidades', () => {
  it('limpia el ticker y elimina comodines', () => {
    expect(limpiarTicker('gk%os_')).toBe('GKOS');
    expect(limpiarTicker('brk.b')).toBe('BRK.B');
    expect(limpiarTicker(5)).toBe('');
  });
  it('acota el límite', () => {
    expect(limiteSeguro(undefined)).toBe(50);
    expect(limiteSeguro('0')).toBe(50);
    expect(limiteSeguro('5000')).toBe(100);
    expect(limiteSeguro('20')).toBe(20);
  });
  it('recorta textos largos y entiende objetos', () => {
    expect(textoCorto({ texto: 'hola' })).toBe('hola');
    expect(textoCorto('x'.repeat(500))).toHaveLength(401);
  });
  it('ordena reglas: incumple, no_evaluable, resto, cumple', () => {
    const r = reglasDe({ salida: { resultados_reglas: [
      { codigo: 'B', resultado: 'cumple', detalle: '' }, { codigo: 'A', resultado: 'no_evaluable', detalle: '' },
      { codigo: 'C', resultado: 'incumple', detalle: 'x' }, { codigo: 'D', resultado: 'informativo', detalle: '' },
    ] } });
    expect(r.map(x => x.codigo)).toEqual(['C', 'A', 'D', 'B']);
  });
});

describe('listarCorridas', () => {
  it('filtra por ticker, ordena y limita; devuelve motivos_total', async () => {
    const c = falso({ oficina_corridas_historial: { data: [{ id: U(1), corrida_id: U(2), version: 1, ticker: 'GKOS', estado_final: 'completada', director_estado: 'ok', iniciada_at: '2026-11-10T10:00:00Z', motivos: [{}, {}] }] } });
    const r = await listarCorridas(c, { ticker: 'gkos', limite: '10' });
    expect(r.ok && r.datos[0]).toMatchObject({ ticker: 'GKOS', motivos_total: 2, estado_final: 'completada' });
    const ops = c.llamadas.map(x => x.op);
    expect(ops).toEqual(['select', 'ilike', 'order', 'limit']);
    expect(c.llamadas[1]?.args).toEqual(['ticker', '%GKOS%']);
    expect(c.llamadas[2]?.args).toEqual(['iniciada_at', { ascending: false }]);
    expect(c.llamadas[3]?.args).toEqual([10]);
  });
  it('sin ticker no filtra', async () => {
    const c = falso({ oficina_corridas_historial: { data: [] } });
    await listarCorridas(c, {});
    expect(c.llamadas.some(x => x.op === 'ilike')).toBe(false);
  });
  it('error de la base: mensaje fijo, sin detalles', async () => {
    const c = falso({ oficina_corridas_historial: { error: { message: 'secreto interno' } } });
    const r = await listarCorridas(c, {});
    expect(r).toEqual({ ok: false, http: 500, error: 'No se pudieron leer las corridas' });
  });
});

describe('detalleCorrida', () => {
  const fila = {
    id: U(1), corrida_id: U(2), version: 1, ticker: 'GKOS', portafolio_codigo: 'PMP', tipo_evaluacion: 'nueva_posicion', decision: 'ESPERAR',
    estado_final: 'completada', director_estado: 'ok', auditoria_veredicto: 'CUMPLE', iniciada_at: '2026-11-10T10:00:00Z', finalizada_at: '2026-11-10T10:01:00Z',
    ruta: 'analitica', disparador: 'usuario', snapshot_fecha_datos: '2026-11-07',
    resultados_agentes: [{ agente: 'fundamental', estado: 'ok', analisis_id: U(10), reintentos: 1 }, { agente: 'valuacion', estado: 'no_ejecutado', analisis_id: null, reintentos: 0 }],
    auditoria_analisis_id: U(11), director_analisis_id: U(12),
    motivos: [{ codigo: 'agente_opcional_fallo', detalle: 'x: error' }], datos_vencidos: ['precio'],
    referencias: { datos_faltantes: ['deuda'], avisos: ['aviso 1'] },
  };
  const analisis = [
    { id: U(10), agente: 'fundamental', veredicto: 'ACEPTABLE', puntaje: '55', confianza: 'media', salida: { hallazgos: [{ texto: 'margen sube' }], negativos: ['deuda'] } },
    { id: U(11), agente: 'auditor_reglas', veredicto: 'CUMPLE', puntaje: null, confianza: null, salida: { resultados_reglas: [{ codigo: 'PMP-01', resultado: 'no_evaluable', detalle: 'sin señal' }] } },
    { id: U(12), agente: 'director', veredicto: null, puntaje: null, confianza: 'alta', salida: {} },
  ];

  it('arma agentes, reglas, motivos y datos faltantes', async () => {
    const c = falso({ oficina_corridas_historial: { data: [fila] }, oficina_analisis: { data: analisis } });
    const r = await detalleCorrida(c, U(2));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos.agentes).toHaveLength(2);
    expect(r.datos.agentes[0]).toMatchObject({ agente: 'fundamental', veredicto: 'ACEPTABLE', puntaje: 55, textos: ['margen sube'], negativos: ['deuda'], reintentos: 1 });
    expect(r.datos.agentes[1]).toMatchObject({ agente: 'valuacion', estado: 'no_ejecutado', veredicto: null });
    expect(r.datos.reglas_auditor).toEqual([{ codigo: 'PMP-01', resultado: 'no_evaluable', detalle: 'sin señal' }]);
    expect(r.datos.motivos).toEqual([{ codigo: 'agente_opcional_fallo', detalle: 'x: error' }]);
    expect(r.datos.datos_faltantes).toEqual(['deuda']);
    expect(r.datos.avisos).toEqual(['aviso 1']);
    expect(r.datos.director?.confianza).toBe('alta');
    expect(r.datos.corrida.ruta).toBe('analitica');
  });
  it('pide los análisis una sola vez con los ids de la corrida', async () => {
    const c = falso({ oficina_corridas_historial: { data: [fila] }, oficina_analisis: { data: analisis } });
    await detalleCorrida(c, U(2));
    const en = c.llamadas.find(x => x.tabla === 'oficina_analisis' && x.op === 'in');
    expect(en?.args).toEqual(['id', [U(10), U(11), U(12)]]);
  });
  it('rechaza ids que no son uuid sin consultar la base', async () => {
    const c = falso({});
    expect(await detalleCorrida(c, "x' or 1=1")).toMatchObject({ ok: false, http: 400 });
    expect(c.llamadas).toHaveLength(0);
  });
  it('404 si no existe y 500 si falla la base', async () => {
    expect(await detalleCorrida(falso({ oficina_corridas_historial: { data: [] } }), U(2))).toMatchObject({ ok: false, http: 404 });
    expect(await detalleCorrida(falso({ oficina_corridas_historial: { error: {} } }), U(2))).toMatchObject({ ok: false, http: 500 });
    expect(await detalleCorrida(falso({ oficina_corridas_historial: { data: [fila] }, oficina_analisis: { error: {} } }), U(2))).toMatchObject({ ok: false, http: 500 });
  });
  it('solo usa lecturas (nunca insert/update/delete)', async () => {
    const c = falso({ oficina_corridas_historial: { data: [fila] }, oficina_analisis: { data: analisis } });
    await detalleCorrida(c, U(2));
    expect(c.llamadas.every(x => ['select', 'eq', 'in', 'order', 'limit'].includes(x.op))).toBe(true);
  });
  it('sin análisis guardados no consulta oficina_analisis', async () => {
    const f = { ...fila, resultados_agentes: [], auditoria_analisis_id: null, director_analisis_id: null };
    const c = falso({ oficina_corridas_historial: { data: [f] } });
    const r = await detalleCorrida(c, U(2));
    expect(r.ok && r.datos.reglas_auditor).toEqual([]);
    expect(c.llamadas.some(x => x.tabla === 'oficina_analisis')).toBe(false);
  });
});

describe('plan de salidas de PMP en el detalle', () => {
  it('sin plan en referencias: null', () => { expect(planSalidaDe({})).toBeNull(); expect(planSalidaDe({ salida_pmp: 'x' })).toBeNull(); });
  it('normaliza el plan y la salida exigida', () => {
    const p = planSalidaDe({ salida_pmp: { total_salidas: 2, hechas: 1, siguiente: 2, nivel_siguiente: '140', motivo: 'nivel_planeado', confirmaciones_nuevas: ['RSI_SOBRECOMPRA'], faltantes: [], exigida: { decision: 'VENDER', porcentaje: 100, detalle: 'x', regla: 'PMP-SALIDA' } } });
    expect(p).toEqual({ total_salidas: 2, hechas: 1, siguiente: 2, nivel_siguiente: '140', motivo: 'nivel_planeado', confirmaciones_nuevas: ['RSI_SOBRECOMPRA'], faltantes: [], exigida: { decision: 'VENDER', porcentaje: 100, detalle: 'x' } });
  });
  it('sin salida exigida: exigida null', () => {
    expect(planSalidaDe({ salida_pmp: { total_salidas: 3, exigida: null } })?.exigida).toBeNull();
  });
});
