import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'bun:test';

function source(relativePath: string): string {
  return readFileSync(new URL(`../src/${relativePath}`, import.meta.url), 'utf8');
}

describe('Hub registry hot-path boundaries', () => {
  test('prompt delivery uses targeted canonical reads', () => {
    const runtime = source('hub/chat-prompt-runtime.ts');
    const start = runtime.indexOf('async function sendPromptToChat');
    const end = runtime.indexOf('// Reconcile pending prompt completion', start);
    const delivery = runtime.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(delivery).not.toContain('loadRegistry()');
    expect(delivery).toContain('resolveCanonicalDroneOrPendingForReadRef');
    expect(delivery).toContain('resolveCanonicalDroneEnvironmentConfig');

    const acceptanceStart = runtime.indexOf('async function createOrEnqueuePromptUnified');
    const acceptanceEnd = runtime.indexOf('const {\n    dequeueProvisioning,', acceptanceStart);
    const acceptance = runtime.slice(acceptanceStart, acceptanceEnd);

    expect(acceptanceStart).toBeGreaterThanOrEqual(0);
    expect(acceptanceEnd).toBeGreaterThan(acceptanceStart);
    expect(acceptance).not.toContain('loadRegistry()');
    expect(acceptance).toContain('resolveCanonicalDroneOrPendingForReadRef');
    expect(acceptance).toContain('getChatEntry');
  });

  test('provisioning handoffs do not retain a registry snapshot', () => {
    const handoff = source('hub/provisioned-prompt-handoff.ts');
    const provisioning = source('hub/drone-provisioning.ts');

    expect(handoff).not.toContain('registrySnapshot');
    expect(provisioning).not.toContain('postCreateRegistrySnapshot');
  });

  test('readiness is published immediately after the API listener binds', () => {
    const server = source('hub/server.ts');
    const transport = server.indexOf('const httpTransport = await startHubHttpTransport');
    const ready = server.indexOf('await opts.onListening?.', transport);
    const subscriptions = server.indexOf('await resourceSubscriptionService?.start()', ready);
    const status = server.indexOf('droneStatusRuntime.start()', ready);

    expect(transport).toBeGreaterThanOrEqual(0);
    expect(ready).toBeGreaterThan(transport);
    expect(subscriptions).toBeGreaterThan(ready);
    expect(status).toBeGreaterThan(ready);
  });

  test('launcher state is published after static UI startup', () => {
    const cli = source('cli.ts');
    const callback = cli.indexOf('onListening: async (listening) =>');
    const staticUi = cli.indexOf('await startStaticDroneHubUiServer', callback);
    const state = cli.indexOf('await writeHubState', callback);

    expect(callback).toBeGreaterThanOrEqual(0);
    expect(staticUi).toBeGreaterThan(callback);
    expect(state).toBeGreaterThan(staticUi);
  });
});
