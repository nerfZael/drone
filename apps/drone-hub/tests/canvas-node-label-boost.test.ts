import { expect, test } from 'bun:test';
import { NODE_MAX_LABEL_TEXT_BOOST, getChatLabelTextBoost, getNodeWidthPx } from '../src/droneHub/canvas/node-metrics';

test('a short label in a minimum-width node grows to the cap', () => {
  expect(getChatLabelTextBoost('default', getNodeWidthPx('default'))).toBe(NODE_MAX_LABEL_TEXT_BOOST);
});

test('a long label only takes the slack its estimate leaves', () => {
  const label = 'default - Copy 3';
  const boost = getChatLabelTextBoost(label, getNodeWidthPx(label));
  expect(boost).toBeGreaterThan(1);
  expect(boost).toBeLessThan(1.15);
  // The boosted text still fits the node at its estimated width.
  expect(label.length * 7.2 * boost).toBeLessThanOrEqual(getNodeWidthPx(label) - 16);
});

test('never shrinks text', () => {
  expect(getChatLabelTextBoost('a very long chat name that fills its node', 40)).toBe(1);
});
