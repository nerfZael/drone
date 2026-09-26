import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ModelsEditor } from '../src/droneHub/entity/EntityModels';

const options = [
  { provider: 'openai-codex', id: 'gpt-6-sol', name: 'GPT-6 Sol · Codex', thinkingLevel: 'medium' },
  { provider: 'openai-codex', id: 'gpt-6-sol', name: 'GPT-6 Sol · Codex', thinkingLevel: 'high' },
  { provider: 'openai-codex', id: 'gpt-6-luna', name: 'GPT-6 Luna · Codex', thinkingLevel: 'low' },
];
const sol = { model: 'openai-codex/gpt-6-sol', reasoning: 'high' };
const luna = { model: 'openai-codex/gpt-6-luna', reasoning: 'low' };

test('one model for everything shows a single picker; separate parts show head, workers and voice', () => {
  const single = renderToStaticMarkup(<ModelsEditor models={{ head: sol, task: sol, voice: null }} options={options} idle onChange={() => undefined} />);
  expect(single).toContain('One model for everything');
  expect(single).toMatch(/type="checkbox"[^>]*checked/);
  expect(single).toContain('>All<');
  expect(single).not.toContain('Workers');

  const parts = renderToStaticMarkup(<ModelsEditor models={{ head: sol, task: luna, voice: null }} options={options} idle onChange={() => undefined} />);
  for (const label of ['Head', 'Workers', 'Voice']) expect(parts).toContain(label);
  expect(parts).toContain('>Off: the head answers<');
});

test('models are locked while a session runs', () => {
  const html = renderToStaticMarkup(<ModelsEditor models={{ head: sol, task: luna, voice: luna }} options={options} idle={false} onChange={() => undefined} />);
  expect(html).toContain('Reset the session to change them');
  expect(html).not.toContain('>Off: the head answers<');
});
