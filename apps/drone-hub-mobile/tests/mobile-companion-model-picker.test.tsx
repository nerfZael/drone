import React, { act } from 'react';
import { createRequire } from 'node:module';
import { expect, mock, test } from 'bun:test';

mock.module('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', Text: 'Text', TextInput: 'TextInput', View: 'View',
  StyleSheet: { create: (value: unknown) => value },
}));
const models = [
  { provider: 'openai', id: 'shared', name: 'OpenAI model', thinkingLevel: 'low' },
  { provider: 'codex', id: 'shared', name: 'Codex model', thinkingLevel: 'high' },
];
const calls: any[] = [];
let failSave = false;
const response = { settings: { provider: 'openai', model: 'shared', thinkingLevel: 'low' }, models,
  credentials: { openai: true, codex: true } };
const request = async (_device: string, _capability: string, operation: string, payload: any) => {
  calls.push({ operation, payload });
  if (operation === 'model.settings.update' && failSave) throw new Error('Save failed');
  return { ...response, settings: payload ?? response.settings };
};
mock.module('../src/mesh/MeshContext', () => ({ useMesh: () => ({ request,
  profile: { capabilitiesByDevice: { hub: [{ id: 'companion', operations: ['model.settings.get', 'model.settings.update'] }] } },
}) }));
const rendererRequire = createRequire(import.meta.resolve('react-test-renderer'));
mock.module(rendererRequire.resolve('react'), () => React);
const { create } = await import('react-test-renderer');
const { MobileCompanionModelPicker } = await import('../src/local-assistant/MobileCompanionModelPicker');

test('provider selection scopes models without saving until an explicit model choice; failed saves can retry', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  let root!: ReturnType<typeof create>;
  const press = async (label: string) => act(async () => {
    root.root.findAllByType('Pressable' as any).find((node) => node.props.accessibilityLabel === label)!.props.onPress();
  });
  try {
    await act(async () => { root = create(<MobileCompanionModelPicker deviceId="hub" />); });
    await press('Codex');
    expect(calls.filter((call) => call.operation === 'model.settings.update')).toHaveLength(0);
    expect(JSON.stringify(root.toJSON())).not.toContain('OpenAI model');
    failSave = true;
    await press('Codex model');
    expect(JSON.stringify(root.toJSON())).toContain('Save failed');
    failSave = false;
    await press('Codex model');
    expect(calls.at(-1).payload).toEqual({ provider: 'codex', model: 'shared', thinkingLevel: 'high' });
    expect(JSON.stringify(root.toJSON())).not.toContain('Save failed');
    expect(JSON.stringify(root.toJSON())).toContain('Reasoning');
  } finally {
    await act(async () => root.unmount());
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  }
});
