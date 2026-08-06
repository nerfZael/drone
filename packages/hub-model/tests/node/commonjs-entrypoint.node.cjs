const assert = require('node:assert/strict');
const { test } = require('node:test');

test('loads the package entrypoints from Node CommonJS', () => {
  const root = require('@drone/hub-model');
  const sidebar = require('@drone/hub-model/sidebar');

  assert.equal(typeof root.sidebarMoveDestination, 'function');
  assert.equal(typeof sidebar.sidebarMoveDestination, 'function');
});
