import { expect, test } from 'bun:test';
import { describeNewCardDefaults } from '../src/droneHub/canvas/new-card-defaults';

test('the new-card hint names agent, model, reasoning, access and, for a drone, runtime and repo', () => {
  expect(describeNewCardDefaults({
    kind: 'drone', agent: { kind: 'builtin', id: 'codex' }, model: 'gpt-6-sol', reasoning: 'medium',
    permissionMode: 'execute', approvalPolicy: 'none', runtime: 'container', repoPath: '/work/drone',
  })).toEqual(['Codex', 'GPT-6 Sol', 'Medium', 'Execute · Never ask', 'Container', 'drone']);
  // A chat runs in its drone, so no runtime or repo; an agent without approvals shows access alone.
  expect(describeNewCardDefaults({
    kind: 'chat', agent: { kind: 'builtin', id: 'blip' }, model: '', reasoning: null,
    permissionMode: 'write', approvalPolicy: 'ask',
  })).toEqual(['Blip', 'Default model', 'Write']);
  expect(describeNewCardDefaults({
    kind: 'drone', agent: { kind: 'custom', id: 'mine', label: 'My agent', command: 'x' },
    permissionMode: 'execute', runtime: 'container', repoPath: '',
  })).toEqual(['My agent', 'Execute', 'Container', 'No repo']);
});
