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
import { deleteDroneWorkflowRecords } from './workflows/workflow-store';

export async function permanentlyDeleteCanonicalDrone(opts: {
  droneId: string;
  lifecycleState: 'real' | 'archived';
}): Promise<PermanentDroneChatCleanupResult> {
  const transcriptStore = getTranscriptStore();
  await getCanonicalDroneLifecycle(opts.droneId);
  getPromptQueueRepository();
  let cleanup: PermanentDroneChatCleanupResult;
  if (transcriptStore) {
    cleanup = await commitPermanentDroneDeletionInStore(opts);
  } else {
    const removedLifecycle = Boolean(
      await deleteCanonicalDroneLifecycle(opts.droneId, opts.lifecycleState),
    );
    cleanup = removedLifecycle
      ? { ...(await commitPermanentDroneDeletionInStore(opts)), removedLifecycle: true }
      : {
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
  await deleteDroneWorkflowRecords(opts.droneId);
  return cleanup;
}
