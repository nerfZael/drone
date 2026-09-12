const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ExpiringMap } = require('@drone/hub-model');

test('expires untouched entries without removing fresh or refreshed values', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 });
  const cache = new ExpiringMap(value => value.expiresAt);
  cache.set('untouched', { expiresAt: 1_010 });
  cache.set('refreshed', { expiresAt: 1_010 });
  cache.set('fresh', { expiresAt: 1_030 });
  t.mock.timers.tick(5);
  const replacement = { expiresAt: 1_025 };
  cache.set('refreshed', replacement);
  t.mock.timers.tick(5);
  assert.equal(cache.has('untouched'), false);
  assert.equal(cache.get('refreshed'), replacement);
  assert.equal(cache.has('fresh'), true);
  t.mock.timers.tick(15);
  assert.equal(cache.has('refreshed'), false);
  assert.equal(cache.size, 1);
  t.mock.timers.tick(5);
  assert.equal(cache.size, 0);
});

test('clear/delete stop cleanup and a subsequent entry gets its own expiry', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 });
  let deadlinesRead = 0;
  const cache = new ExpiringMap(value => { deadlinesRead++; return value; });
  cache.set('first', 1_010);
  cache.clear();
  cache.set('second', 1_020);
  cache.delete('second');
  const before = deadlinesRead;
  t.mock.timers.tick(20);
  assert.equal(deadlinesRead, before);
  cache.set('third', 1_025);
  t.mock.timers.tick(5);
  assert.equal(cache.size, 0);
});
