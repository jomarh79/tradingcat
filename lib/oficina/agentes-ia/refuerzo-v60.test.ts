import { describe, expect, it } from 'vitest';
import { clasificarTesisPropuesta, fundamentalMarcaCambio } from './clasificar-tesis';
import { proponerFichaPmp } from '../conexion/ficha-propuesta';

const director = { tesis: { estado: 'propuesta_cambio', propuesta: 'Texto reescrito de la tesis.', pendiente_autorizacion: true } };
const fund = (...estados: string[]) => ({ cambios_vs_tesis_vigente: estados.map((e, i) => ({ punto: `p${i}`, estado: e })) });

describe('v0.60 fundamentalMarcaCambio', () => {
  it('true si algún punto se debilita o se rompe', () => {
    expect(fundamentalMarcaCambio(fund('se_mantiene', 'se_debilita'))).toBe(true);
    expect(fundamentalMarcaCambio(fund('se_rompe'))).toBe(true);
  });
  it('false si todo se mantiene', () => {
    expect(fundamentalMarcaCambio(fund('se_mantiene', 'se_mantiene'))).toBe(false);
  });
  it('null si no se puede saber: sin salida, sin lista, lista vacía o estado raro', () => {
    expect(fundamentalMarcaCambio(undefined)).toBeNull();
    expect(fundamentalMarcaCambio({})).toBeNull();
    expect(fundamentalMarcaCambio(fund())).toBeNull();
    expect(fundamentalMarcaCambio(fund('se_mantiene', 'otro'))).toBeNull();
  });
});

describe('v0.60 clasificarTesisPropuesta con cambio marcado', () => {
  it('con tesis vigente y todo "se_mantiene" la propuesta no se ofrece', () => {
    expect(clasificarTesisPropuesta(director, true, false)).toBe('sin_propuesta');
  });
  it('con tesis vigente y cambio marcado sigue siendo cambio_de_tesis', () => {
    expect(clasificarTesisPropuesta(director, true, true)).toBe('cambio_de_tesis');
  });
  it('con duda (null) se ofrece, no se oculta nada', () => {
    expect(clasificarTesisPropuesta(director, true, null)).toBe('cambio_de_tesis');
    expect(clasificarTesisPropuesta(director, true)).toBe('cambio_de_tesis');
  });
  it('sin tesis vigente la primera propuesta siempre se ofrece', () => {
    expect(clasificarTesisPropuesta(director, false, false)).toBe('primera_propuesta');
  });
});

describe('v0.60 ficha: rol del expediente', () => {
  const base = { ticker: 'META', hoy: '2026-11-17', velas: null, watchlist: null };
  it('sin watchlist usa el rol del expediente', () => {
    expect(proponerFichaPmp({ ...base, rol_expediente: 'mixto' }).propuesta['identidad']?.texto).toBe('META · mercado US · portafolio PMP · rol mixto');
  });
  it('el rol de la watchlist manda sobre el del expediente', () => {
    const wl = { rol: 'crecimiento', negocio: null, competidores: null, portafolios: ['PMP'] };
    expect(proponerFichaPmp({ ...base, watchlist: wl, rol_expediente: 'mixto' }).propuesta['identidad']?.texto).toContain('rol crecimiento');
  });
  it('sin ninguno queda "rol sin definir"', () => {
    expect(proponerFichaPmp(base).propuesta['identidad']?.texto).toContain('rol sin definir');
    expect(proponerFichaPmp({ ...base, rol_expediente: '  ' }).propuesta['identidad']?.texto).toContain('rol sin definir');
  });
});
