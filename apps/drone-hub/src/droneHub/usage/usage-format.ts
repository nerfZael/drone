export function usageNumber(value: number | null | undefined): string {
  return value == null ? 'Unavailable' : new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}
export function usageCost(value: number | null | undefined): string {
  return value == null ? 'Price unavailable' : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value);
}

export function usagePartialReason(reason: string): string {
  switch (reason) {
    case 'missing-baseline': return 'The first usage report had no earlier counter to compare with. Its last request is counted, but earlier usage could not be verified.';
    case 'compaction-unverified': return 'Context was compacted, but its token usage has not been verified from the agent’s response records. The estimate may be low.';
    default: return 'The agent did not provide enough information to verify complete usage.';
  }
}
