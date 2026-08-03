import { describe, expect, test } from 'bun:test';
import {
  mobileDroneCreatePreferencesFromPayload,
  mobileDroneCreatePreferencesFromSelection,
  normalizeMobileDroneCreatePreferences,
  resolveMobileDroneCreateDefaults,
} from '../src/drones/create-preferences-model';

describe('mobile new drone preferences', () => {
  test('remembers creation choices but not contextual identity fields', () => {
    const preferences = mobileDroneCreatePreferencesFromPayload({
      runtime: 'container',
      name: 'temporary-name',
      group: 'temporary-group',
      repoPath: '/work/repo-a',
      draft: true,
      persistVolume: true,
      repoBranchSource: 'remote',
      remoteBranch: 'origin/feature-a',
      seedAgent: { kind: 'builtin', id: 'codex' },
      seedModel: 'gpt-5.4',
      seedReasoning: 'high',
      seedAgentPermissionMode: 'read-only',
      seedApprovalPolicy: 'agent-decides',
      seedPrompt: 'hello',
    });

    expect(preferences).toEqual({
      mode: 'with-chat',
      runtime: 'container',
      draft: true,
      persistVolume: true,
      agent: 'codex',
      agentPermissionMode: 'read-only',
      approvalPolicy: 'agent-decides',
      model: 'gpt-5.4',
      provider: '',
      reasoning: 'high',
      repoBranchSource: 'remote',
      repoCreateRemoteBranch: 'origin/feature-a',
    });
    expect(preferences).not.toHaveProperty('name');
    expect(preferences).not.toHaveProperty('group');
    expect(preferences).not.toHaveProperty('repoPath');
  });

  test('combines a remembered device choice with current repo context and explicit overrides', () => {
    const remembered = normalizeMobileDroneCreatePreferences({
      mode: 'without-chat',
      runtime: 'host',
      draft: false,
      persistVolume: true,
      agent: 'claude',
      agentPermissionMode: 'full-access',
      model: 'claude-sonnet',
      provider: 'anthropic',
      reasoning: 'medium',
      repoBranchSource: 'remote',
      repoCreateRemoteBranch: 'origin/repo-a',
    });

    expect(
      resolveMobileDroneCreateDefaults({
        remembered,
        repoPath: '/work/current',
        overrides: { mode: 'with-chat', group: 'explicit-group' },
      }),
    ).toEqual({
      ...remembered,
      mode: 'with-chat',
      group: 'explicit-group',
      repoPath: '/work/current',
    });
  });

  test('infers empty mode when the create payload has no seed agent', () => {
    expect(
      mobileDroneCreatePreferencesFromPayload({
        runtime: 'host',
        repoBranchSource: 'host',
      }).mode,
    ).toBe('without-chat');
  });

  test('retains hidden agent and model choices when creating an empty drone', () => {
    expect(
      mobileDroneCreatePreferencesFromSelection({
        mode: 'without-chat',
        runtime: 'container',
        draft: false,
        persistVolume: false,
        agent: 'codex',
        agentPermissionMode: 'read-only',
        model: 'gpt-5.4',
        provider: 'openai',
        reasoning: 'high',
        repoBranchSource: 'host',
        repoCreateRemoteBranch: '',
      }),
    ).toMatchObject({
      mode: 'without-chat',
      agent: 'codex',
      model: 'gpt-5.4',
      reasoning: 'high',
    });
  });
});
