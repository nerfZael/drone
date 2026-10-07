import { expect, test } from 'bun:test';
import {
  canvasSettingsForAgent,
  normalizeCanvasNewCardSettings,
  type CanvasNewCardSettings,
} from '../src/droneHub/canvas/canvas-new-card-settings';
import { chatAgentKey } from '../src/droneHub/app/agent-model-picks';

const codex: CanvasNewCardSettings = {
  agentKey: 'builtin:codex',
  model: 'gpt-6-sol',
  reasoning: 'high',
  permissionMode: 'read',
  approvalPolicy: 'auto',
};

test('saved canvas settings are kept as stored, and anything unusable is left unset', () => {
  expect(normalizeCanvasNewCardSettings(codex)).toEqual(codex);
  expect(normalizeCanvasNewCardSettings({ agentKey: 'native', permissionMode: 'root', approvalPolicy: 'sometimes' }))
    .toEqual({ agentKey: 'native', model: '', reasoning: '', permissionMode: 'execute', approvalPolicy: 'ask' });
  expect(normalizeCanvasNewCardSettings({ model: 'gpt-6-sol' })).toBeNull();
  expect(normalizeCanvasNewCardSettings(null)).toBeNull();
});

test('another agent starts its model over and keeps only the access and approvals it can use', () => {
  expect(canvasSettingsForAgent(codex, 'builtin:codex', { kind: 'builtin', id: 'codex' })).toBe(codex);
  // Built-in honors read-only access and approvals, but not Codex's own Auto.
  expect(canvasSettingsForAgent(codex, 'native', { kind: 'native' }))
    .toEqual({ agentKey: 'native', model: '', reasoning: '', permissionMode: 'read', approvalPolicy: 'ask' });
  expect(canvasSettingsForAgent(codex, 'builtin:cursor', { kind: 'builtin', id: 'cursor' }))
    .toEqual({ agentKey: 'builtin:cursor', model: '', reasoning: '', permissionMode: 'execute', approvalPolicy: 'ask' });
  expect(canvasSettingsForAgent({ ...codex, approvalPolicy: 'none' }, 'builtin:blip', { kind: 'builtin', id: 'blip' }))
    .toEqual({ agentKey: 'builtin:blip', model: '', reasoning: '', permissionMode: 'read', approvalPolicy: 'none' });
});

test('another agent starts with the model and reasoning last picked for it', () => {
  expect(canvasSettingsForAgent(codex, 'builtin:claude', { kind: 'builtin', id: 'claude' }, { model: 'opus', reasoning: 'medium' }))
    .toEqual({ agentKey: 'builtin:claude', model: 'opus', reasoning: 'medium', permissionMode: 'execute', approvalPolicy: 'ask' });
});

test('an agent goes by its picker key', () => {
  expect(chatAgentKey({ kind: 'builtin', id: 'claude' })).toBe('builtin:claude');
  expect(chatAgentKey({ kind: 'custom', id: 'mine', label: 'Mine', command: 'mine' })).toBe('custom:mine');
  expect(chatAgentKey({ kind: 'native' })).toBe('native');
});
