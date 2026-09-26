import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { LimbPanel } from '../src/droneHub/entity/EntityLimbPanel';

test('a part of the entity opens on its thread, with its log a tab away; parts that do not talk show only their log', () => {
  const both = renderToStaticMarkup(<LimbPanel title="Head" thread={<div>said things</div>} log={<div>the log</div>} onClose={() => undefined} />);
  expect(both).toMatch(/role="tab" aria-selected="true"[^>]*>Thread/);
  expect(both).toContain('said things');
  expect(both).not.toContain('the log');
  const logOnly = renderToStaticMarkup(<LimbPanel title="Keypad" log={<div>the log</div>} onClose={() => undefined} />);
  expect(logOnly).not.toContain('role="tab"');
  expect(logOnly).toContain('the log');
});
