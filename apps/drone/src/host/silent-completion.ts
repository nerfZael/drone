export function normalizeSilentCompletion(
  ok: boolean,
  outputRaw: unknown,
  options?: { explicitlySilent?: boolean; prompt?: unknown; promptId?: unknown },
): { output: string; silentCompletion: boolean } {
  const output = ok ? String(outputRaw ?? '') : '';
  const silentCompletion = ok && options?.explicitlySilent === true;
  return { output: silentCompletion ? '' : output, silentCompletion };
}
