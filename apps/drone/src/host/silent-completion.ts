export function normalizeSilentCompletion(
  ok: boolean,
  outputRaw: unknown,
  explicitlySilent = false,
): { output: string; silentCompletion: boolean } {
  const output = ok ? String(outputRaw ?? '') : '';
  const silentCompletion = ok && (explicitlySilent || output.trim() === '[[NO_REPLY]]');
  return { output: silentCompletion ? '' : output, silentCompletion };
}
