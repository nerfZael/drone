import { describe, expect, test } from 'bun:test';
import type React from 'react';
import {
  addOptimisticStartupSeeds,
  replaceOptimisticStartupSeeds,
  type StartupSeedMap,
} from '../src/droneHub/app/startup-seed-optimistic';

describe('optimistic startup seed state', () => {
  test('preserves access and approval settings before and after creation is accepted', () => {
    let state: StartupSeedMap = {};
    const setState = ((next: React.SetStateAction<StartupSeedMap>) => {
      state = typeof next === 'function' ? next(state) : next;
    }) as React.Dispatch<React.SetStateAction<StartupSeedMap>>;
    const options = {
      runtime: 'container' as const,
      agent: { kind: 'builtin' as const, id: 'codex' as const },
      model: 'gpt-test',
      agentPermissionMode: 'workspace-write' as const,
      approvalPolicy: 'agent-decides' as const,
      prompt: 'Review this',
      chatName: 'default',
    };

    const optimistic = addOptimisticStartupSeeds(setState, ['review-drone'], options);
    expect(state[optimistic[0]!.id]).toMatchObject({
      agentPermissionMode: 'workspace-write',
      approvalPolicy: 'agent-decides',
    });

    replaceOptimisticStartupSeeds(
      setState,
      optimistic,
      [{ id: 'drone-accepted', name: 'review-drone' }],
      options,
    );
    expect(state[optimistic[0]!.id]).toBeUndefined();
    expect(state['drone-accepted']).toMatchObject({
      agentPermissionMode: 'workspace-write',
      approvalPolicy: 'agent-decides',
    });
  });
});
