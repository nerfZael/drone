import {
  COMPANION_INSTRUCTIONS_MAX_CHARS,
  COMPANION_INSTRUCTIONS_PATH,
  type CompanionInstructions,
} from '@drone/assistant-chat';
import { getHubSettingsRepository, HubSettingVersionConflictError } from '../../host/hub-settings-repository';
import { loadBlipTools } from '../assistant/blip-runtime-loader';

const SETTING_KEY = 'companion.instructions';

export async function readCompanionInstructions(): Promise<CompanionInstructions> {
  const record = (await getHubSettingsRepository()).get<string>(SETTING_KEY);
  return { content: record?.value ?? '', revision: record?.version ?? 0 };
}

export async function writeCompanionInstructions(content: unknown, revision: unknown, beforeWrite?: () => void): Promise<CompanionInstructions> {
  if (typeof content !== 'string') throw new Error('Instructions must be text.');
  if (content.length > COMPANION_INSTRUCTIONS_MAX_CHARS) {
    throw new Error(`Instructions cannot exceed ${COMPANION_INSTRUCTIONS_MAX_CHARS} characters.`);
  }
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
    throw new Error('A valid instructions revision is required.');
  }
  try {
    const repository = await getHubSettingsRepository();
    const record = await repository.update<string>(SETTING_KEY, (current) => {
      // The write may wait behind another transaction. Recheck cancellation and
      // the revision inside that transaction, immediately before the mutation.
      beforeWrite?.();
      if ((current?.version ?? 0) !== revision) {
        throw new HubSettingVersionConflictError(SETTING_KEY, revision === 0 ? null : revision, current);
      }
      return content;
    });
    return { content: record.value, revision: record.version };
  } catch (error) {
    if (error instanceof HubSettingVersionConflictError) {
      throw Object.assign(new Error('Instructions changed. Read the latest instructions before saving again.'), {
        code: 'STALE_INSTRUCTIONS',
      });
    }
    throw error;
  }
}

export async function patchCompanionInstructions(snapshot: CompanionInstructions, patch: unknown, beforeWrite?: () => void): Promise<CompanionInstructions> {
  if (typeof patch !== 'string' || patch.length > COMPANION_INSTRUCTIONS_MAX_CHARS * 2 + 1_000) {
    throw new Error('Instructions patch is invalid or too large.');
  }
  const { parsePatch, applyPatchHunks } = await loadBlipTools();
  const operations = parsePatch(patch);
  if (operations.length !== 1 || operations[0].type !== 'update' || operations[0].moveTo) {
    throw new Error('Instructions patches must contain exactly one Update File operation without a move.');
  }
  const operation = operations[0];
  if (operation.path !== COMPANION_INSTRUCTIONS_PATH) throw new Error('Instructions patch path does not match.');
  const next = applyPatchHunks(snapshot.content.replace(/\r\n/g, '\n'), operation.hunks, operation.path);
  return writeCompanionInstructions(snapshot.content.includes('\r\n') ? next.replace(/\n/g, '\r\n') : next, snapshot.revision, beforeWrite);
}
