/** What a Hub helper (next actions, asks) has cost in one chat or across all of them. */
export type HelperCost = { cost: number; calls: number; unpriced: number };

/** Short form for badges and tables: "$0.12", "<$0.01", with "+" when some calls had no known price. */
export function formatHelperCost(cost: HelperCost): string {
  if (cost.calls === 0) return '$0';
  if (cost.cost > 0 && cost.cost < 0.01) return `<$0.01${cost.unpriced ? '+' : ''}`;
  return `$${cost.cost.toFixed(2)}${cost.unpriced ? '+' : ''}`;
}

/** The exact amount, as a sentence: `${feature} ${verb} cost $0.0123 ${where} over 14 model calls.` */
export function describeHelperCost(cost: HelperCost, feature: string, where: string, verb = 'has'): string {
  if (cost.calls === 0) return `${feature} ${verb} cost nothing ${where} yet.`;
  return `${feature} ${verb} cost $${cost.cost.toFixed(4)} ${where} over ${cost.calls} model ${cost.calls === 1 ? 'call' : 'calls'}${cost.unpriced ? `, plus ${cost.unpriced} without a known price` : ''}.`;
}
