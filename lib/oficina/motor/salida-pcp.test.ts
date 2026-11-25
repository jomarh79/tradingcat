import { describe, expect, it } from 'vitest';
import { evaluarPlanSalidaPCP, evaluarSalidaPCP } from './salida-pcp';
import type { EntradaSalidaPCP } from './salida-pcp';

const N = (nivel: string | null, cumplido = false) => ({ nivel, cumplido });
const SIN = [N(null), N(null), N(null)] as const;
const base = (x: Partial<EntradaSalidaPCP>): EntradaSalidaPCP => ({
  plan: 'escalonado', compras: [{ cantidad: '1', precio: '100' }], precio_actual: '100', stop: null, niveles: SIN, senal_salida: false, primera_salida_realizada: false, ...x,
});
const dos = [{ cantidad: '1', precio: '100' }, { cantidad: '1', precio: '80' }];   // costo promedio 90
const tres = [...dos, { cantidad: '2', precio: '70' }];                           // (100+80+140)/4 = 80

describe('evaluarSalidaPCP: comportamiento anterior (sin niveles)', () => {
  it('una compra con señal vende 100%', () => {
    expect(evaluarSalidaPCP({ plan: 'una_compra', compras: [{ cantidad: '1', precio: '50' }], precio_actual: '60', senal_salida: true, primera_salida_realizada: false }))
      .toMatchObject({ decision: 'VENDER', porcentaje: 100, regla: 'PCP-06' });
  });
  it('una compra sin señal, sin niveles y sin stop: nada', () => {
    expect(evaluarSalidaPCP({ plan: 'una_compra', compras: [{ cantidad: '1', precio: '50' }], precio_actual: '60', senal_salida: false, primera_salida_realizada: false })).toBeNull();
  });
  it('plan de una compra: el stop vende; plan escalonado: no', () => {
    const e = base({ compras: [{ cantidad: '1', precio: '100' }], stop: '95', precio_actual: '94' });
    expect(evaluarSalidaPCP({ ...e, plan: 'una_compra' })).toMatchObject({ decision: 'VENDER', regla: 'PCP-07' });
    expect(evaluarSalidaPCP({ ...e, plan: 'escalonado' })).toBeNull();
  });
  it('dos compras: sobre el costo promedio reduce 50%; en o bajo el costo, nada', () => {
    expect(evaluarSalidaPCP(base({ compras: dos, precio_actual: '90.01' }))).toMatchObject({ decision: 'REDUCIR', porcentaje: 50 });
    expect(evaluarSalidaPCP(base({ compras: dos, precio_actual: '90' }))).toBeNull();
  });
  it('tras la primera salida solo la señal vende lo que queda', () => {
    expect(evaluarSalidaPCP(base({ compras: dos, precio_actual: '120', primera_salida_realizada: true }))).toBeNull();
    expect(evaluarSalidaPCP(base({ compras: dos, precio_actual: '120', primera_salida_realizada: true, senal_salida: true }))).toMatchObject({ decision: 'VENDER', porcentaje: 100 });
  });
});

describe('evaluarPlanSalidaPCP: TP de trades (aprobado el 18-nov)', () => {
  it('una compra: TP1 alcanzado vende 100% aunque no haya señal', () => {
    const r = evaluarPlanSalidaPCP(base({ precio_actual: '110', niveles: [N('108'), N(null), N(null)] }));
    expect(r.exigida).toMatchObject({ decision: 'VENDER', porcentaje: 100 });
    expect(r.motivo).toBe('nivel_planeado');
    expect(r.nivel_alcanzado).toBe('TP1 = 108');
  });
  it('una compra: TP1 aún no alcanzado o ya cumplido no dispara', () => {
    expect(evaluarPlanSalidaPCP(base({ precio_actual: '107.99', niveles: [N('108'), N(null), N(null)] })).exigida).toBeNull();
    expect(evaluarPlanSalidaPCP(base({ precio_actual: '130', niveles: [N('108', true), N(null), N(null)] })).exigida).toBeNull();
  });
  it('una compra: la señal sigue mandando aunque haya TP', () => {
    const r = evaluarPlanSalidaPCP(base({ precio_actual: '101', senal_salida: true, niveles: [N('108'), N(null), N(null)] }));
    expect(r.motivo).toBe('senal_salida');
  });
  it('dos compras: la primera salida exige superar el costo promedio aunque TP1 esté bajo el costo', () => {
    const r = evaluarPlanSalidaPCP(base({ compras: dos, precio_actual: '88', niveles: [N('85'), N('200'), N(null)], senal_salida: true }));
    expect(r.exigida).toBeNull();
    expect(r.costo_promedio).toBe('90');
  });
  it('dos compras: sobre el costo y con TP1 alcanzado, REDUCIR 50% y el motivo cita el TP', () => {
    const r = evaluarPlanSalidaPCP(base({ compras: dos, precio_actual: '95', niveles: [N('93'), N('110'), N(null)] }));
    expect(r.exigida).toMatchObject({ decision: 'REDUCIR', porcentaje: 50 });
    expect(r.motivo).toBe('nivel_planeado');
    expect(r.nivel_alcanzado).toBe('TP1 = 93');
  });
  it('dos compras tras la primera salida: TP2 o TP3 venden el resto; TP1 no', () => {
    const e = base({ compras: dos, primera_salida_realizada: true });
    expect(evaluarPlanSalidaPCP({ ...e, precio_actual: '100', niveles: [N('95'), N('110'), N('120')] }).exigida).toBeNull();
    expect(evaluarPlanSalidaPCP({ ...e, precio_actual: '112', niveles: [N('95', true), N('110'), N('120')] }).exigida).toMatchObject({ decision: 'VENDER', porcentaje: 100 });
    expect(evaluarPlanSalidaPCP({ ...e, precio_actual: '121', niveles: [N('95', true), N('110', true), N('120')] }).nivel_alcanzado).toBe('TP3 = 120');
    expect(evaluarPlanSalidaPCP({ ...e, precio_actual: '130', niveles: [N('95', true), N('110', true), N('120', true)] }).exigida).toBeNull();
  });
  it('dos compras: con TP1 por encima del costo promedio, la primera salida espera a TP1 (18-nov)', () => {
    const e = base({ compras: dos, niveles: [N('100'), N('110'), N(null)] });   // costo promedio 90
    const antes = evaluarPlanSalidaPCP({ ...e, precio_actual: '95', senal_salida: true });
    expect(antes.exigida).toBeNull();
    const llega = evaluarPlanSalidaPCP({ ...e, precio_actual: '100' });
    expect(llega.exigida).toMatchObject({ decision: 'REDUCIR', porcentaje: 50 });
    expect(llega.nivel_alcanzado).toBe('TP1 = 100');
  });
  it('dos compras: TP1 igual al costo promedio sale al superarlo; sin TP1 en el trade (o ya cumplido) basta superar el costo', () => {
    expect(evaluarPlanSalidaPCP(base({ compras: dos, precio_actual: '90.5', niveles: [N('90'), N('200'), N(null)] })).exigida).toMatchObject({ decision: 'REDUCIR' });
    expect(evaluarPlanSalidaPCP(base({ compras: dos, precio_actual: '90', niveles: [N('90'), N('200'), N(null)] })).exigida).toBeNull();
    expect(evaluarPlanSalidaPCP(base({ compras: dos, precio_actual: '95', niveles: [N('100', true), N('200'), N(null)] })).exigida).toMatchObject({ decision: 'REDUCIR' });
  });
  it('tres compras se comporta igual que dos y calcula el costo promedio ponderado', () => {
    const r = evaluarPlanSalidaPCP(base({ compras: tres, precio_actual: '81' }));
    expect(r.costo_promedio).toBe('80');
    expect(r.exigida).toMatchObject({ decision: 'REDUCIR', porcentaje: 50 });
  });
});

describe('evaluarPlanSalidaPCP: zona de posible recompra (solo aviso)', () => {
  it('plan escalonado con precio en o bajo el stop y recompras disponibles', () => {
    const r = evaluarPlanSalidaPCP(base({ stop: '95', precio_actual: '95' }));
    expect(r.zona_recompra).toBe(true);
    expect(r.recompras_restantes).toBe(2);
    expect(r.exigida).toBeNull();
  });
  it('con 2 compras queda 1 recompra; con 3 compras ya no hay zona', () => {
    expect(evaluarPlanSalidaPCP(base({ compras: dos, stop: '90', precio_actual: '85' })).recompras_restantes).toBe(1);
    const r3 = evaluarPlanSalidaPCP(base({ compras: tres, stop: '90', precio_actual: '70' }));
    expect(r3.zona_recompra).toBe(false);
    expect(r3.recompras_restantes).toBe(0);
  });
  it('precio sobre el stop: sin zona', () => {
    expect(evaluarPlanSalidaPCP(base({ stop: '95', precio_actual: '96' })).zona_recompra).toBe(false);
  });
  it('plan de una compra: no hay zona de recompra', () => {
    const r = evaluarPlanSalidaPCP(base({ plan: 'una_compra', stop: '95', precio_actual: '90' }));
    expect(r.zona_recompra).toBe(false);
  });
  it('plan no declarado: el stop no se evalúa y se avisa; nunca supone un plan', () => {
    const r = evaluarPlanSalidaPCP(base({ plan: null, stop: '95', precio_actual: '90' }));
    expect(r.exigida).toBeNull();
    expect(r.zona_recompra).toBe(false);
    expect(r.faltantes.join('|')).toContain('plan_pcp');
  });
  it('sin compras no hay nada que evaluar', () => {
    expect(evaluarPlanSalidaPCP(base({ compras: [] })).exigida).toBeNull();
  });
});

describe('v0.85: la etapa PCP la marcan los take profit con valor', () => {
  const be = [{ cantidad: '1', precio: '184.74' }, { cantidad: '1', precio: '177.17' }, { cantidad: '1', precio: '142.39' }, { cantidad: '1', precio: '154.92' }]; // 4 compras, TP1 y TP2
  it('BE: 4 compras pero solo TP1 y TP2 → etapa 2, queda 1 recompra y toca el stop → zona de recompra', () => {
    const r = evaluarPlanSalidaPCP(base({ compras: be, precio_actual: '90', stop: '95', niveles: [N('200', true), N('210', true), N(null)] }));
    expect(r.etapas).toBe(2);
    expect(r.zona_recompra).toBe(true);
    expect(r.recompras_restantes).toBe(1);
    expect(r.exigida).toBeNull();
  });
  it('solo TP1 y stop tocado → 1.ª recompra (2 restantes)', () => {
    const r = evaluarPlanSalidaPCP(base({ precio_actual: '90', stop: '95', niveles: [N('200'), N(null), N(null)] }));
    expect(r.etapas).toBe(1);
    expect(r.zona_recompra).toBe(true);
    expect(r.recompras_restantes).toBe(2);
  });
  it('3 TP llenos y stop tocado → VENDER 100% por stop', () => {
    const r = evaluarPlanSalidaPCP(base({ compras: be, precio_actual: '90', stop: '95', niveles: [N('200', true), N('210', true), N('220')] }));
    expect(r.etapas).toBe(3);
    expect(r.exigida).toMatchObject({ decision: 'VENDER', porcentaje: 100 });
    expect(r.motivo).toBe('stop');
    expect(r.zona_recompra).toBe(false);
  });
});
