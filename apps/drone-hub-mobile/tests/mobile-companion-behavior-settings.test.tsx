import React, { act } from 'react';
import { createRequire } from 'node:module';
import { expect, mock, test } from 'bun:test';
import { COMPANION_CAPABILITY } from '@drone/device-protocol';

mock.module('react-native', () => ({ ActivityIndicator: 'ActivityIndicator', Switch: 'Switch', Text: 'Text', View: 'View', StyleSheet: { create: (value: unknown) => value } }));
mock.module('../src/components/Ui', () => ({ Button: 'Button', ErrorBanner: 'ErrorBanner' }));
mock.module('../src/components/ThemedTextInput', () => ({ ThemedTextInput: 'Input' }));
const response = { settings: { promptDeliveryMode: 'asap', systemPrompt: 'Original prompt', enabledTools: ['read'] },
  defaultSystemPrompt: 'Default prompt', maxSystemPromptChars: 8000,
  tools: [{ name: 'read', label: 'Read', description: 'Read text', requires: null }, { name: 'write', label: 'Write', description: 'Write text', requires: 'read' }] };
const calls: any[] = [];
let grants = ['*'];
let failSave = false;
let instructionRevision = 1;
const mesh = {
  identity: { id: 'phone' }, profile: { capabilitiesByDevice: { hub: [COMPANION_CAPABILITY] } },
  get devices() { return [{ id: 'phone', grants: [{ capability: 'companion', version: 1, operations: grants }] }]; },
  request: async (_device: string, _capability: string, operation: string, payload?: any) => {
    calls.push({ operation, payload });
    if (operation === 'behavior.settings.update' && failSave) throw new Error('Hub offline');
    if (operation.startsWith('instructions.')) {
      if (operation === 'instructions.update' && payload.revision !== instructionRevision) throw new Error('Instructions changed. Read the latest instructions before saving again.');
      return { instructions: { content: payload?.content ?? 'Shared instructions', revision: instructionRevision }, maxChars: 8000 };
    }
    return { ...response, settings: { ...response.settings, ...payload } };
  },
};
mock.module('../src/mesh/MeshContext', () => ({ useMesh: () => mesh }));
const rendererRequire = createRequire(import.meta.resolve('react-test-renderer'));
mock.module(rendererRequire.resolve('react'), () => React);
const { create } = await import('react-test-renderer');
const { MobileCompanionBehaviorSettings } = await import('../src/local-assistant/MobileCompanionBehaviorSettings');

test('mobile saves edited behavior fields, preserves drafts on failure, handles tool dependencies and stale instructions', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  let root!: ReturnType<typeof create>;
  const button = (label: string) => root.root.findAllByType('Button' as any).find(node => node.props.children === label)!;
  const press = async (label: string) => act(async () => { button(label).props.onPress(); });
  try {
    await act(async () => { root = create(<MobileCompanionBehaviorSettings deviceId="hub" />); });
    await press('Queue');
    failSave = true;
    await press('Save shared behavior');
    expect(root.root.findAllByType('ErrorBanner' as any)[0].props.message).toBe('Hub offline');
    expect(button('Save shared behavior').props.disabled).toBe(false);
    failSave = false;
    await press('Save shared behavior');
    expect(calls.filter(call => call.operation === 'behavior.settings.update').at(-1).payload).toEqual({ promptDeliveryMode: 'queue' });
    await press('Enabled tools (1) · Show');
    const toggle = (name: string, value: boolean) => act(async () => { root.root.findAllByType('Switch' as any).find(node => node.props.accessibilityLabel === name)!.props.onValueChange(value); });
    await toggle('Write', true);
    await press('Save shared behavior');
    expect(calls.filter(call => call.operation === 'behavior.settings.update').at(-1).payload).toEqual({ enabledTools: ['read', 'write'] });
    await toggle('Read', false);
    await press('Save shared behavior');
    expect(calls.filter(call => call.operation === 'behavior.settings.update').at(-1).payload).toEqual({ enabledTools: [] });
    await act(async () => { root.root.findAllByType('Input' as any).find(node => node.props.accessibilityLabel === 'Persistent Companion instructions')!.props.onChangeText('My draft'); });
    instructionRevision = 2;
    await press('Save instructions');
    expect(root.root.findAllByType('ErrorBanner' as any)[0].props.message).toContain('Instructions changed');
    expect(root.root.findAllByType('Input' as any).at(-1)!.props.value).toBe('My draft');
    await press('Discard draft and load latest instructions');
    expect(root.root.findAllByType('Input' as any).at(-1)!.props.value).toBe('Shared instructions');
    grants = ['run.start']; calls.length = 0;
    await act(async () => { root.update(<MobileCompanionBehaviorSettings key="no-access" deviceId="hub" />); });
    expect(calls).toHaveLength(0);
    expect(JSON.stringify(root.toJSON())).toContain('Allow Companion behavior settings access');
  } finally {
    await act(async () => root.unmount()); grants = ['*']; failSave = false;
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  }
});
