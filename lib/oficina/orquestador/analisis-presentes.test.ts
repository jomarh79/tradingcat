import { describe, expect, it } from 'vitest';
import { conAnalisisPresentes } from './corrida';

describe('v0.25 analisis_presentes para el Auditor', () => {
  const sobre = { contrato: 'x', datos: { monto: 1 } };
  it('solo nombres de agentes con estado ok, en el orden de la matriz', () => {
    const r = conAnalisisPresentes(sobre, { tecnico: { estado: 'ok' }, fundamental: { estado: 'ok' }, valuacion: { estado: 'error' } }) as { datos: Record<string, unknown> };
    expect(r.datos).toEqual({ monto: 1, analisis_presentes: ['fundamental', 'tecnico'] });
  });
  it('no muta el sobre original', () => {
    conAnalisisPresentes(sobre, { tecnico: { estado: 'ok' } });
    expect(sobre).toEqual({ contrato: 'x', datos: { monto: 1 } });
  });
  it('sobres sin datos (o no objeto) se dejan igual', () => {
    const raro = { aud: 1 };
    expect(conAnalisisPresentes(raro, { tecnico: { estado: 'ok' } })).toBe(raro);
    expect(conAnalisisPresentes(null, {})).toBeNull();
  });
});


describe('v0.28 los análisis ok se citan como fundamento de la decisión (GLB-03)', () => {
  const sobre = { datos: { fundamentos: null, monto: 1 }, datos_fuente: [{ id: 'x' }] };
  const res = { fundamental: { estado: 'ok' as const, analisis_id: 'an-f' }, tecnico: { estado: 'ok' as const, analisis_id: 'an-t' }, valuacion: { estado: 'error' as const }, riesgo_capital: { estado: 'ok' as const } };
  it('agrega una referencia por análisis ok con analisis_id (categoría según el agente) y la lista en fundamentos', () => {
    const r = conAnalisisPresentes(sobre, res, '2026-11-10') as { datos: Record<string, unknown>; datos_fuente: Record<string, unknown>[] };
    expect(r.datos['fundamentos']).toEqual(['analisis:fundamental', 'analisis:tecnico']);
    expect(r.datos_fuente.map((d) => d['id'])).toEqual(['x', 'analisis:fundamental', 'analisis:tecnico']);
    expect(r.datos_fuente[1]).toMatchObject({ campo: 'analisis_fundamental', categoria: 'estado_financiero', valor: 'an-f', fecha_dato: '2026-11-10' });
    expect(r.datos_fuente[2]).toMatchObject({ categoria: 'indicador_tecnico', valor: 'an-t' });
  });
  it('un agente en error o sin analisis_id (riesgo_capital por código) no se cita; sin ningún análisis fundamentos queda como venía', () => {
    const r = conAnalisisPresentes(sobre, { valuacion: { estado: 'error' }, riesgo_capital: { estado: 'ok' } }, '2026-11-10') as { datos: Record<string, unknown>; datos_fuente: unknown[] };
    expect(r.datos['fundamentos']).toBeNull();
    expect(r.datos_fuente).toEqual([{ id: 'x' }]);
  });
  it('sin fecha (llamada antigua) no cita nada y no muta el original', () => {
    const r = conAnalisisPresentes(sobre, res) as { datos: Record<string, unknown> };
    expect(r.datos['fundamentos']).toBeNull();
    expect(sobre.datos.fundamentos).toBeNull();
    expect(sobre.datos_fuente).toHaveLength(1);
  });
});
