import { loadRegistry } from '../host/registry';
import { readCanonicalDroneSummaryModel } from './canonical-drone-read-model';

/**
 * Loads the bounded registry-shaped model used by drone pickers and workspace catalogs.
 *
 * The compatibility projection includes complete active and archived transcripts. It is
 * intentionally reserved for migration/export callers and can be hundreds of megabytes on a
 * long-lived Hub. Interactive summary consumers must prefer this targeted canonical read model.
 */
export async function loadDroneSummaryRegistry(): Promise<any> {
  return readCanonicalDroneSummaryModel() ?? (await loadRegistry());
}
