import { expect, test } from 'bun:test';
import {
  canvasSettingsForAgent,
  normalizeCanvasNewCardSettings,
  type CanvasNewCardSettings,
} from '../src/droneHub/canvas/canvas-new-card-settings';

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
