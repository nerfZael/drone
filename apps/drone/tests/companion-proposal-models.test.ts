import { expect, test } from 'bun:test';
import { CompanionProposalModels } from '../src/hub/companion/companion-proposal-models';

const catalog = (overrides = {}) => ({
  ok: true, agent: 'codex', runtime: 'container',
  models: [{ id: 'gpt-6-astra', label: 'GPT-6 Astra', reasoningLevels: ['low', 'medium', 'high'] }],
  ...overrides,
});
const proposal = (overrides = {}) => JSON.stringify({
  version: 1, title: 'Create with Astra', operations: [
    { id: 'drone', type: 'create_drone', prompt: 'Do the work', model: 'Astra', reasoning: 'low', ...overrides },
    { id: 'chat', type: 'create_chat', droneId: '$drone', chatName: 'review', model: 'astra', reasoning: 'low', ...overrides },
  ],
});

test('returns corrections for friendly names and missing agents in both creation operations', () => {
  const resolver = new CompanionProposalModels();
  resolver.remember(catalog());
  for (const operation of JSON.parse(proposal()).operations) {
    const content = JSON.stringify({ version: 1, title: 'Create', operations: [
      operation.type === 'create_chat' ? { ...operation, droneId: 'existing' } : operation,
    ] });
    expect(() => resolver.validate(content)).toThrow('"agent":"builtin:codex","model":"gpt-6-astra","reasoning":"low"');
  }
  expect(() => resolver.validate(proposal({ model: 'gpt-6-astra' }))).toThrow('submit a corrected patch');
  expect(() => resolver.validate(proposal({ agent: 'builtin:codex', model: 'gpt-6-astra' }))).not.toThrow();
});

test('rejects guessed IDs, missing catalogs, incompatible agents and unsupported reasoning', () => {
  const resolver = new CompanionProposalModels();
  expect(() => resolver.validate(proposal())).toThrow('Read list_agent_models');
  resolver.remember(catalog());
  for (const overrides of [
    { model: 'gpt-7-astra' }, { agent: 'native' }, { provider: 'codex' },
    { reasoning: 'ultra' }, { runtime: 'host' },
  ]) expect(() => resolver.validate(proposal(overrides))).toThrow();
});

test('does not choose among ambiguous names or agent/provider configurations', () => {
  const resolver = new CompanionProposalModels();
  resolver.remember(catalog({ models: [
    ...catalog().models,
    { id: 'gpt-6-astra-mini', label: 'Astra Mini', reasoningLevels: ['low'] },
  ] }));
  expect(() => resolver.validate(proposal())).toThrow('unambiguously');
  expect(() => resolver.validate(proposal({ agent: 'builtin:codex', model: 'gpt-6-astra' }))).not.toThrow();
  resolver.remember(catalog({ agent: 'native', provider: 'codex' }));
  expect(() => resolver.validate(proposal({ model: 'gpt-6-astra' }))).toThrow('unambiguously');
  expect(() => resolver.validate(proposal({ agent: 'native', provider: 'codex', model: 'gpt-6-astra' }))).not.toThrow();
  expect(() => resolver.validate(proposal({ agent: 'native', model: 'gpt-6-astra' }))).toThrow('\"provider\":\"codex\"');
});

test('failed or empty discovery cannot authorize a model; omitted overrides stay omitted', () => {
  const resolver = new CompanionProposalModels();
  resolver.remember(catalog({ ok: false }));
  expect(() => resolver.validate(proposal())).toThrow();
  resolver.remember(catalog());
  resolver.remember(catalog({ models: [] }));
  expect(() => resolver.validate(proposal())).toThrow();
  const content = proposal({ model: undefined, reasoning: undefined });
  expect(() => resolver.validate(content)).not.toThrow();
});


test('runtime returns correction errors and delivers only the assistant-corrected proposal unchanged', async () => {
  const { CompanionRuntime } = await import('../src/hub/companion/companion-runtime');
  const { DEFAULT_COMPANION_SETTINGS } = await import('../src/hub/companion/companion-config');
  const resolver = new CompanionProposalModels();
  const original = JSON.stringify({ version: 1, title: 'Empty', operations: [] });
  const delivered: any[] = [];
  const context = {
    settings: DEFAULT_COMPANION_SETTINGS,
    snapshots: new Map(),
    proposalModels: resolver,
    callBrowser: async (name: string, args: any) => {
      if (name === 'read_proposal') return {
        targetId: 'companion-proposal', path: 'companion-proposal.json',
        revision: 'r1', mode: 'edit', content: original,
      };
      delivered.push(args);
      return { ok: true };
    },
  };
  const runtime = Object.create(CompanionRuntime.prototype);
  const tools = await runtime.customTools(context, []);
  const read = tools.find((tool: any) => tool.name === 'read_proposal');
  const patch = tools.find((tool: any) => tool.name === 'apply_proposal_patch');
  await read.execute('read', {});
  const args = {
    targetId: 'companion-proposal', baseRevision: 'r1',
    patch: `*** Begin Patch\n*** Update File: companion-proposal.json\n@@\n-${original}\n+${proposal()}\n*** End Patch`,
  };
  await expect(patch.execute('invalid', args)).rejects.toThrow('Read list_agent_models');
  expect(delivered).toHaveLength(0);
  resolver.remember(catalog());
  await expect(patch.execute('friendly', args)).rejects.toThrow('submit a corrected patch');
  expect(delivered).toHaveLength(0);
  const corrected = proposal({ agent: 'builtin:codex', model: 'gpt-6-astra' });
  await patch.execute('valid', {
    ...args,
    patch: args.patch.replace(proposal(), corrected),
  });
  expect(delivered[0].content.trimEnd()).toBe(corrected);
  expect(delivered).toHaveLength(1);
  for (const operation of JSON.parse(delivered[0].content).operations) {
    expect(operation).toMatchObject({ agent: 'builtin:codex', model: 'gpt-6-astra', reasoning: 'low' });
  }
});

test('runtime exposes explicit proposal execution independently of patch snapshots', async () => {
  const { CompanionRuntime } = await import('../src/hub/companion/companion-runtime');
  const { DEFAULT_COMPANION_SETTINGS } = await import('../src/hub/companion/companion-config');
  const calls: unknown[] = [];
  const pending = { applied: false, status: 'pending_review', revision: '2', operationCount: 1 };
  const runtime = Object.create(CompanionRuntime.prototype);
  const tools = await runtime.customTools({
    settings: DEFAULT_COMPANION_SETTINGS,
    snapshots: new Map(),
    proposalModels: new CompanionProposalModels(),
    callBrowser: async (name: string, args: unknown) => { calls.push({ name, args }); return pending; },
  }, []);
  const execute = tools.find((tool: any) => tool.name === 'execute_proposal');
  expect(execute.parameters.required).toEqual(['targetId', 'baseRevision']);
  const args = { targetId: 'companion-proposal', baseRevision: '2' };
  const response = await execute.execute('execute', args);
  expect(calls).toEqual([{ name: 'execute_proposal', args }]);
  expect(response.details).toEqual(pending);
});

test('runtime retains separate snapshots for multiple proposals and rejects cross-document patches', async () => {
  const { CompanionRuntime } = await import('../src/hub/companion/companion-runtime');
  const { DEFAULT_COMPANION_SETTINGS } = await import('../src/hub/companion/companion-config');
  const { CompanionProposalStore } = await import('@drone/assistant-chat');
  let id = 0;
  const store = new CompanionProposalStore(() => `proposal-${++id}`);
  const runtime = Object.create(CompanionRuntime.prototype);
  const tools = await runtime.customTools({
    settings: DEFAULT_COMPANION_SETTINGS, snapshots: new Map(), proposalModels: new CompanionProposalModels(),
    callBrowser: async (name: string, args: any) => {
      if (name === 'create_proposal') return store.create({ defaultRepoPath: '/repo' }, 'session', args.title);
      if (name === 'read_proposal') return store.read(args.targetId);
      if (name === 'apply_proposal_patch') return store.patch(args.targetId, args.baseRevision, args.content, () => ({ defaultRepoPath: '/wrong' }), 'session');
      if (name === 'discard_proposal') return store.discard(args.targetId, args.baseRevision);
      throw new Error(name);
    },
  }, []);
  const tool = (name: string) => tools.find((item: any) => item.name === name);
  const a = (await tool('create_proposal').execute('create-a', { title: 'A' })).details;
  const b = (await tool('create_proposal').execute('create-b', { title: 'B' })).details;
  const patch = (path: string) => `*** Begin Patch\n*** Update File: ${path}\n@@\n-  "operations": []\n+  "operations": [{"id":"group","type":"create_group","name":"Review"}]\n*** End Patch`;
  await expect(tool('apply_proposal_patch').execute('cross-target', {
    targetId: a.targetId, baseRevision: a.revision, patch: patch(b.path),
  })).rejects.toThrow('patch path does not match');
  for (const item of [a, b]) {
    const result = await tool('apply_proposal_patch').execute(`patch-${item.targetId}`, {
      targetId: item.targetId, baseRevision: item.revision, patch: patch(item.path),
    });
    expect(result.details).toMatchObject({ targetId: item.targetId, revision: '1', operationCount: 1 });
  }
  expect(store.pending).toHaveLength(2);
  await tool('discard_proposal').execute('discard-a', { targetId: a.targetId, baseRevision: '1' });
  expect(store.pending.map(item => item.id)).toEqual([b.targetId]);
});
