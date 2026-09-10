import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'bun:test';
import { EventData } from '../src/droneHub/app/CustomEventsSettingsTab';

test('event fields render nested values and preserve falsy data safely', () => {
  const html = renderToStaticMarkup(<EventData value={{ count: 0, enabled: false, missing: null, nested: { items: ['<script>bad()</script>', ''] } }} />);
  expect(html).toContain('count</dt>');
  expect(html).toContain('>0</span>');
  expect(html).toContain('>false</span>');
  expect(html).toContain('Null');
  expect(html).toContain('(empty text)');
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<script>');
});
