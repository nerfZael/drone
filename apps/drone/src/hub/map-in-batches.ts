export async function mapInBatches<T, R>(
  values: readonly T[],
  batchSizeRaw: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const batchSize = Math.max(1, Math.floor(batchSizeRaw));
  const results: R[] = [];
  for (let start = 0; start < values.length; start += batchSize) {
    const batch = values.slice(start, start + batchSize);
    results.push(...(await Promise.all(batch.map((value, offset) => mapper(value, start + offset)))));
  }
  return results;
}
