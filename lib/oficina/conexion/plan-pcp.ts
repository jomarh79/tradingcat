// Plan de PCP deducido de las compras reales (v0.66, decidido el 18-nov): una sola compra = «una_compra»; con recompras = «escalonado».
// Solo se usa cuando la ficha NO trae un plan declarado: lo declarado siempre manda. Una evaluación de recompra implica plan escalonado
// (la primera recompra no puede bloquearse por tener todavía una sola compra). Función pura.

export type PlanDeducido = 'una_compra' | 'escalonado';

export function deducirPlanPcp(n_compras: number, tipo_evaluacion: string): PlanDeducido | null {
  if (!Number.isInteger(n_compras) || n_compras < 1) return null;
  if (tipo_evaluacion === 'recompra' || n_compras >= 2) return 'escalonado';
  return 'una_compra';
}
