import { getPromptQueueRepository } from '../host/prompt-queue-repository';
import {
  commitPermanentDroneDeletionInStore,
  getTranscriptStore,
  type PermanentDroneChatCleanupResult,
} from './transcript-store';
import {
  deleteCanonicalDroneLifecycle,
  getCanonicalDroneLifecycle,
} from './drone-lifecycle-service';

export async function permanentlyDeleteCanonicalDrone(opts: {
  droneId: string;
  lifecycleState: 'real' | 'archived';
}): Promise<PermanentDroneChatCleanupResult> {
  await getCanonicalDroneLifecycle(opts.droneId);
  getPromptQueueRepository();
  const transcriptStore = getTranscriptStore();
  if (transcriptStore) return await commitPermanentDroneDeletionInStore(opts);

  const removedLifecycle = Boolean(await deleteCanonicalDroneLifecycle(opts.droneId, opts.lifecycleState));
  if (!removedLifecycle) {
    return {
      available: true,
      removedLifecycle: false,
      alreadyDeleted: false,
      activeChatsDeleted: 0,
      turnsDeleted: 0,
      archivedChatsDeleted: 0,
      chatTombstonesDeleted: 0,
      archivedChatTombstonesDeleted: 0,
      promptsDeleted: 0,
    };
  }
  const cleanup = await commitPermanentDroneDeletionInStore(opts);
  return { ...cleanup, removedLifecycle: true };
}
