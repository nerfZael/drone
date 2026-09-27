import { getLegacyResidualStateRepository } from '../host/legacy-residual-state';
import { loadRegistryCompatibilityBase, loadRegistryRawSnapshot, updateRegistry } from '../host/registry';
import { localCheckoutStateFromRegistry, type LocalCheckoutState } from './local-checkout-model';

async function initializedRepository() {
  const repository = getLegacyResidualStateRepository();
  if (repository && !repository.read()) {
    await repository.seedIfAbsent(await loadRegistryRawSnapshot());
  }
  return repository;
}

export async function readLocalCheckoutState(): Promise<LocalCheckoutState> {
  const repository = await initializedRepository();
  return localCheckoutStateFromRegistry(
    repository ? repository.read() : await loadRegistryCompatibilityBase(),
  );
}

export async function writeLocalCheckoutState(state: LocalCheckoutState): Promise<void> {
  const repository = await initializedRepository();
  const mutate = (registry: any) => {
    registry.settings ??= {};
    registry.settings.localCheckout = state;
  };
  if (repository) {
    // Checkout owns only residual settings. Supplying a full compatibility
    // projection here copies and compares every drone's chat history, which
    // can exhaust the hub heap. update merges the latest residual row inside
    // the shared SQLite transaction, preserving unrelated concurrent writes.
    await repository.update({ version: 2, drones: {}, pending: {} }, mutate);
  } else {
    // Bun retains the existing registry fallback without native SQLite.
    await updateRegistry(mutate);
  }
}
