import { afterEach, describe, expect, test } from 'bun:test';

import { loadWorkflowInvocations } from '../src/droneHub/workflows/workflow-api';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('workflow API', () => {
  test('loads every invocation page for the selected run', async () => {
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      const secondPage = url.includes('cursor=250');
      return Response.json({
        invocations: [{ id: secondPage ? 'second' : 'first' }],
        nextCursor: secondPage ? null : '250',
      });
    }) as typeof fetch;

    const invocations = await loadWorkflowInvocations('owner drone', 'run/one');

    expect(invocations.map((invocation) => invocation.id)).toEqual(['first', 'second']);
    expect(requestedUrls).toEqual([
      '/api/drones/owner%20drone/workflow-runs/run%2Fone/invocations?limit=250',
      '/api/drones/owner%20drone/workflow-runs/run%2Fone/invocations?limit=250&cursor=250',
    ]);
  });
});
