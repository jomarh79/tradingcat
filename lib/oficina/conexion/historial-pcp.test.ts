import { describe, expect, it } from 'vitest';
import { auditar } from '../auditor';
import { CATALOGO_FIXTURE } from '../auditor/catalogo-fixture';
import type { EntradaAuditor } from '../auditor';
import { LIMITE_VELAS_DIARIAS, datosHistorialPcp } from './historial-pcp';

const DIA = 86400;
const velas = (n: number, fuente = 'TwelveData') => ({ diarias: Array.from({ length: n }, (_, i) => ({ time: 1_500_000_000 + i * DIA })), fuente });
const valor = (xs: ReturnType<typeof datosHistorialPcp>, campo: string) => xs.find(x => x.campo === campo)?.valor;

describe('datosHistorialPcp', () => {
  it('sin velas o con menos de 2: no declara nada (PCP-01 queda NO_EVALUABLE)', () => {
    expect(datosHistorialPcp(null, '2026-11-18')).toEqual([]);
    expect(datosHistorialPcp(undefined, '2026-11-18')).toEqual([]);
    expect(datosHistorialPcp(velas(1), '2026-11-18')).toEqual([]);
  });
  it('años = (última − primera) / 365.25 días, truncado a dos decimales (4.9993 → 4.99, nunca 5.00), y completo si llegaron menos del límite', () => {
    const r = datosHistorialPcp(velas(1827), '2026-11-18');   // 1826 días = 4.99 años
    expect(valor(r, 'historial_grafico_anios')).toBe('4.99');
    expect(valor(r, 'historial_grafico_completo')).toBe(true);
    expect(r.every(x => x.fecha_dato === '2026-11-18' && x.fuente === 'TwelveData')).toBe(true);
  });
  it('con el límite de velas el historial pudo truncarse (completo = false)', () => {
    expect(valor(datosHistorialPcp(velas(LIMITE_VELAS_DIARIAS), '2026-11-18'), 'historial_grafico_completo')).toBe(false);
  });
});

describe('PCP-01 con el Auditor', () => {
  const entrada = (n: number): EntradaAuditor => ({
    contrato: 'auditoria_entrada.v1', run_id: 'r', snapshot_id: 's', ticker: 'AMD', mercado: 'US', portafolio_codigo: 'PCP', tipo_evaluacion: 'nueva_posicion', fecha_evaluacion: '2026-11-18',
    operacion: { accion: 'abrir', monto: '25', precio: null, porcentaje_venta: null, instrumento_destino: null, origen_dinero: null, dividendo_misma_empresa: null, motivo_venta: null },
    posicion: { existe: false, fecha_apertura: null, compras: null, ventas_previas: null, costo_promedio_ponderado: null, plan_pcp: null, rol: 'crecimiento' },
    contexto_portafolio: { posiciones_abiertas: 3, movimiento_ya_registrado: null, sustitucion_autorizada: null },
    datos: { analisis_presentes: [], ficha_pmp: null, candidata_semilla: null, recompra_con_analisis_propios: null, stop_tocado: null, aumenta_peso_sectorial: null, dividendo_recibido: null, neto_mensual_pcp: null, traspaso_identificable: null, historial_meses_etf: null, aporte_etf: null, fundamentos: null },
    datos_fuente: datosHistorialPcp(velas(n), '2026-11-18'), analisis_ids: [], reglas_vigentes: CATALOGO_FIXTURE,
  });
  const pcp01 = (n: number) => auditar(entrada(n)).resultados_reglas.find(r => r.codigo === 'PCP-01')!;
  it('con 10 años de velas cumple; con 3 años y fuente completa incumple; con el límite y bajo 5 años no se alcanza (no hay caso)', () => {
    expect(pcp01(LIMITE_VELAS_DIARIAS).resultado).toBe('cumple');
    expect(pcp01(1100).resultado).toBe('incumple');   // ~3 años, entregó todo lo que existe
  });
});
