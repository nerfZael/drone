export function usageNumber(value: number | null | undefined): string {
  return value == null ? 'Unavailable' : new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}
export function usageCost(value: number | null | undefined): string {
  return value == null ? 'Price unavailable' : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value);
}
