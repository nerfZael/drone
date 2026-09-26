import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Steps, type WorkItem } from '../src/droneHub/entity/EntityWork';

const w = (steps: WorkItem['steps'], state: WorkItem['state'] = 'act') => ({ steps, state } as WorkItem);

test('a card\'s steps: all of them when open; compact, what it is doing first and the latest done, when not', () => {
  const steps = { done: ['one', 'two', 'three', 'four'], doing: ['five'], next: ['six', 'seven'] };
  const open = renderToStaticMarkup(<Steps w={w(steps)} />);
  for (const s of ['one', 'four', 'five', 'seven']) expect(open).toContain(s);
  const compact = renderToStaticMarkup(<Steps w={w(steps)} limit={4} />);
  expect(compact).toContain('five');
  expect(compact).toContain('four');
  expect(compact).toContain('three');
  expect(compact).not.toContain('>one<');
  expect(compact).toContain('+3 more');
});
