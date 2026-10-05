import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'bun:test';
import { NextActionsSettingsTab } from '../src/droneHub/app/NextActionsSettingsTab';
import type { UseNextActionsSettingsDraftResult } from '../src/droneHub/app/use-next-actions-settings';
import type { NextActionsSettingsResponse } from '../src/droneHub/chat/next-actions';

const settings = {
  enabled: true,
  provider: 'codex' as const,
  model: 'gpt-6-luna',
  thinkingLevel: 'low',
  actions: [{ name: 'Commit', text: 'Commit the changes\nwith a short message' }],
  instructions: 'Pick replies.',
};

const data: NextActionsSettingsResponse = {
  ok: true,
  settings,
  revision: 'r1',
  defaults: { actions: [{ name: 'Commit', text: 'Commit the changes' }], instructions: 'Pick replies.' },
  limits: { maxActions: 24, maxActionNameChars: 40, maxActionChars: 2000, maxInstructionsChars: 8000, maxTurns: 6 },
  models: [{ provider: 'codex', id: 'gpt-6-luna', name: 'GPT-6 Luna', thinkingLevel: 'low' }],
  credentials: { openai: false, codex: true, gemini: false, openrouter: false, cerebras: false },
  totalCost: { cost: 0.0312, calls: 40, unpriced: 0 },
  costByChat: [
    { droneId: 'd1', chatName: 'default', droneName: 'Login fix', cost: 0.02, calls: 25, unpriced: 0 },
    { droneId: 'd2', chatName: 'chat-2', droneName: null, cost: 0.0112, calls: 15, unpriced: 0 },
  ],
};

test('each action edits its button name and the message it sends; costs show in total and per chat', () => {
  const props = {
    data, draft: settings, setDraft: () => {}, loading: false, loadError: '', saving: false, saveError: '',
    saved: false, dirty: false, save: async () => true, reset: async () => {},
  } as UseNextActionsSettingsDraftResult;
  const html = renderToStaticMarkup(<NextActionsSettingsTab settings={props} />);
  expect(html).toMatch(/<input[^>]*aria-label="Action 1 button name"[^>]*value="Commit"/);
  expect(html).toContain('aria-label="Action 1 message"');
  expect(html).toContain('Commit the changes\nwith a short message</textarea>');
  expect(html).toContain('$0.03');
  expect(html).toContain('over 40 model calls');
  expect(html).toContain('Login fix');
  expect(html).toContain('d2');
  expect(html).toContain('$0.02');
});
