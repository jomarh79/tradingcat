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

