type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

export type RemoteDroneAutoRenameResult =
  | { ok: true; name: string }
  | { ok: false; error: string };

function makeCandidate(base: string, n: number): string {
  const suffix = n <= 1 ? '' : ` (${n})`;
  const raw = `${base}${suffix}`.trim();
  if (!raw) return '';
  return raw.length > 80 ? raw.slice(0, 80).trim() : raw;
}

function isNameConflict(errorMessage: string): boolean {
  const msg = errorMessage.toLowerCase();
  return msg.includes('already exists') || msg.includes('pending') || msg.includes('cannot rename');
}

export async function suggestAndRenameRemoteDroneFromPrompt(opts: {
  droneId: string;
  prompt: string;
  currentName?: string;
  requestJson: RequestJsonFn;
}): Promise<RemoteDroneAutoRenameResult> {
  const droneId = String(opts.droneId ?? '').trim();
  const prompt = String(opts.prompt ?? '').trim();
  if (!droneId || !prompt) return { ok: false, error: 'missing drone id or prompt' };

  const suggestion = await opts.requestJson<{ ok: true; name: string }>(
    '/api/drones/name-from-message',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: prompt,
        source: 'remote-create-auto-rename',
        droneId,
      }),
    },
  );

  const base = String(suggestion?.name ?? '').trim();
  if (!base) return { ok: false, error: 'name suggestion returned an empty value' };

  const currentName = String(opts.currentName ?? '').trim();
  if (currentName && currentName === base) return { ok: true, name: base };

  let conflictSuffix = 1;
  let lastError = '';
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const candidate = makeCandidate(base, conflictSuffix);
    if (!candidate) return { ok: false, error: 'name suggestion produced an empty candidate' };

    try {
      await opts.requestJson<{ ok: true; id: string; newName: string }>(
        `/api/drones/${encodeURIComponent(droneId)}/rename`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            newName: candidate,
            source: 'remote-create-auto-rename',
            attempt,
            suggestedBase: base,
          }),
        },
      );
      return { ok: true, name: candidate };
    } catch (error: any) {
      lastError = String(error?.message ?? error ?? '').trim() || 'rename failed';
      if (!isNameConflict(lastError)) return { ok: false, error: lastError };
      conflictSuffix += 1;
    }
  }

  return { ok: false, error: lastError || 'rename failed after too many conflicts' };
}
