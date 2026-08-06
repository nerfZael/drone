import { hubLog } from '../hub-settings';

export type CreatedDroneAutoRenameOperations = {
  suggestName(input: { droneId: string; prompt: string }): Promise<string>;
  renameDrone(input: {
    droneId: string;
    newName: string;
    expectedName?: string;
    source: 'mobile-create-auto-rename';
    attempt: number;
    suggestedBase: string;
  }): Promise<void>;
};

const AUTO_RENAME_MAX_RETRY_MS = 5 * 60 * 1000;
const AUTO_RENAME_MAX_ATTEMPTS = 240;

function renameCandidate(base: string, suffix: number): string {
  const suffixText = suffix <= 1 ? '' : ` (${suffix})`;
  const availableBaseLength = Math.max(0, 80 - suffixText.length);
  return `${base.slice(0, availableBaseLength).trim()}${suffixText}`.trim();
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, delayMs);
    timer.unref?.();
  });
}

export async function autoRenameCreatedDroneFromPrompt(
  operations: CreatedDroneAutoRenameOperations,
  droneIdRaw: string,
  promptRaw: string,
  expectedNameRaw?: string,
): Promise<string> {
  const droneId = String(droneIdRaw ?? '').trim();
  const prompt = String(promptRaw ?? '').trim();
  const expectedName = String(expectedNameRaw ?? '').trim();
  if (!droneId || !prompt) throw new Error('droneId and prompt are required for automatic naming');

  const base = String(await operations.suggestName({ droneId, prompt })).trim();
  if (!base) throw new Error('name suggestion returned an empty drone name');

  const startedAtMs = Date.now();
  let conflictSuffix = 1;
  let lastError = '';
  for (let attempt = 1; attempt <= AUTO_RENAME_MAX_ATTEMPTS; attempt += 1) {
    const candidate = renameCandidate(base, conflictSuffix);
    if (!candidate || /[\r\n]/.test(candidate)) {
      throw new Error(`name suggestion produced an invalid drone name: "${candidate}"`);
    }
    try {
      await operations.renameDrone({
        droneId,
        newName: candidate,
        source: 'mobile-create-auto-rename',
        attempt,
        suggestedBase: base,
        ...(expectedName ? { expectedName } : {}),
      });
      return candidate;
    } catch (error: any) {
      const message = String(error?.message ?? error ?? '').trim();
      lastError = message || 'rename failed';
      const normalized = message.toLowerCase();
      if (
        normalized.includes('already exists') ||
        normalized.includes('pending') ||
        normalized.includes('cannot rename')
      ) {
        conflictSuffix += 1;
        continue;
      }
      const retriable =
        normalized.includes('rename busy') ||
        normalized.includes('still starting') ||
        normalized.includes('unknown drone');
      if (!retriable) throw error;

      const delayMs = Math.min(3000, 250 + attempt * 250);
      if (Date.now() - startedAtMs + delayMs > AUTO_RENAME_MAX_RETRY_MS) break;
      await wait(delayMs);
    }
  }
  throw new Error(`automatic rename timed out${lastError ? ` (last error: ${lastError})` : ''}`);
}

export function scheduleCreatedDroneAutoRename(
  operations: CreatedDroneAutoRenameOperations,
  droneId: string,
  prompt: string,
  expectedName?: string,
): void {
  void autoRenameCreatedDroneFromPrompt(operations, droneId, prompt, expectedName).catch(
    (error: any) => {
      if (/rename precondition failed/i.test(String(error?.message ?? error ?? ''))) return;
      hubLog('warn', 'mobile-created drone auto-rename failed', {
        droneId,
        error: error?.message ?? String(error),
      });
    },
  );
}
