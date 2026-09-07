import { loadRegistryCompatibilityBase } from '../host/registry';
import { listCanonicalDroneLifecycleForRead } from './drone-lifecycle-service';
import { isWorkflowChildDroneEntry } from './workflows/workflow-child-drone-metadata';

/** Setup needs a count, not a projection of every active and archived transcript. */
export async function countSetupDrones(): Promise<number> {
  const records = await listCanonicalDroneLifecycleForRead('real');
  const entries = records
    ? records.map((record) => record.lifecycle)
    : Object.values((await loadRegistryCompatibilityBase()).drones ?? {});
  return entries.filter((entry) => !isWorkflowChildDroneEntry(entry)).length;
}
