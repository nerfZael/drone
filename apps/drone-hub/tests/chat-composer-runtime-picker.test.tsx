import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { expect, test } from 'bun:test';
import {
  ChatComposerRuntimePanel,
  chatComposerRuntimeTriggerLabel,
  type ChatComposerRuntimePickerConfig,
} from '../src/droneHub/chat/ChatComposerRuntimePicker';
import { agentAccessChoiceGroups } from '../src/droneHub/app/agent-access-choice-groups';

function accessGroups(overrides: Partial<Parameters<typeof agentAccessChoiceGroups>[0]> = {}) {
  return agentAccessChoiceGroups({
    permissionMode: 'write',
    onPermissionModeChange: () => {},
    approvalPolicy: 'ask',
    onApprovalPolicyChange: () => {},
    readOnlySupported: true,
    approvalsSupported: true,
    agentIsCodex: true,
    ...overrides,
  });
}

test('access and approvals are left out for agents that do not support them', () => {
  expect(accessGroups().map((group) => group.id)).toEqual(['access', 'approvals']);
  expect(accessGroups().find((group) => group.id === 'approvals')?.options.map((option) => option.label))
    .toEqual(['Ask', 'Auto', 'Never ask']);
  expect(accessGroups({ agentIsCodex: false }).find((group) => group.id === 'approvals')?.options.map((option) => option.label))
    .toEqual(['Ask', 'Never ask']);
  expect(accessGroups({ approvalsSupported: false }).map((group) => group.id)).toEqual(['access']);
  expect(accessGroups({ readOnlySupported: false, approvalsSupported: false })).toEqual([]);
});

test('one picker chooses the agent, model, reasoning, and access', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const changes: string[] = [];
  const config: ChatComposerRuntimePickerConfig = {
    agent: {
      value: 'builtin:codex',
      label: 'Codex',
      entries: [
        { value: 'builtin:codex', label: 'Codex' },
        { value: 'builtin:claude', label: 'Claude Code' },
      ],
      onChange: (value) => changes.push(`agent:${value}`),
    },
    model: {
      currentProvider: 'external',
      currentModel: 'model-a',
      currentThinkingLevel: 'high',
      options: [
        { provider: 'external', id: 'model-a', name: 'Model A', thinkingLevel: 'low' },
        { provider: 'external', id: 'model-a', name: 'Model A', thinkingLevel: 'high' },
      ],
      onSelect: (choice, selection) => changes.push(`${selection}:${choice.id}:${choice.thinkingLevel}`),
    },
    choiceGroups: accessGroups({
      onApprovalPolicyChange: (value) => changes.push(`approvals:${value}`),
    }),
  };
  const element = dom.document.createElement('div');
  dom.document.body.appendChild(element);
  const root = createRoot(element as unknown as HTMLElement);
  const button = (label: string) =>
    Array.from(dom.document.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === label,
    ) as unknown as HTMLButtonElement;
  try {
    expect(chatComposerRuntimeTriggerLabel(config)).toBe('Codex · Model A (High)');
    await act(async () => root.render(<ChatComposerRuntimePanel config={config} onDone={() => changes.push('done')} />));
    for (const title of ['Agent', 'Model', 'Reasoning', 'Access', 'Approvals']) {
      expect(element.textContent).toContain(title);
    }
    await act(async () => button('Codex').click());
    await act(async () => button('Claude Code').click());
    await act(async () => button('Low').click());
    await act(async () => button('Never ask').click());
    expect(changes).toEqual(['agent:builtin:claude', 'reasoning:model-a:low', 'approvals:none']);
    // Settings changes keep the panel open so several can be made at once.
    expect(changes).not.toContain('done');
  } finally {
    await act(async () => root.unmount());
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.happyDOM.abort();
  }
});

test('an agent action closes the picker, and choosing a model folds its list', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const events: string[] = [];
  let currentModel = 'model-a';
  const config = (): ChatComposerRuntimePickerConfig => ({
    agent: {
      value: 'builtin:pi',
      label: 'Pi',
      entries: [
        { value: 'builtin:pi', label: 'Pi' },
        { value: 'add-custom', label: 'Add custom...' },
      ],
      actionValues: ['add-custom'],
      onChange: (value) => events.push(`agent:${value}`),
    },
    model: {
      currentProvider: 'external',
      currentModel,
      // Without reasoning levels, the model list is all this agent offers.
      showReasoning: false,
      options: [
        { provider: 'external', id: 'model-a', name: 'Model A' },
        { provider: 'external', id: 'model-b', name: 'Model B' },
      ],
      onSelect: (choice) => {
        currentModel = choice.id;
        events.push(`model:${choice.id}`);
      },
    },
  });
  const element = dom.document.createElement('div');
  dom.document.body.appendChild(element);
  const root = createRoot(element as unknown as HTMLElement);
  const render = () => root.render(<ChatComposerRuntimePanel config={config()} onDone={() => events.push('done')} />);
  const button = (label: string) =>
    Array.from(element.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === label,
    ) as unknown as HTMLButtonElement | undefined;
  try {
    await act(async () => render());
    // Among the other settings, the model list starts folded.
    expect(button('Model B')).toBeUndefined();
    await act(async () => button('Model A')!.click());
    await act(async () => button('Model B')!.click());
    await act(async () => render());
    expect(events).toEqual(['model:model-b']);
    expect(button('Model A')).toBeUndefined();
    await act(async () => button('Pi')!.click());
    await act(async () => button('Add custom...')!.click());
    expect(events).toEqual(['model:model-b', 'done', 'agent:add-custom']);
  } finally {
    await act(async () => root.unmount());
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.happyDOM.abort();
  }
});
