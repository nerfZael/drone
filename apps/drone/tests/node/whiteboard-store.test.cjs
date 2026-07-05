const assert = require('node:assert/strict');
const test = require('node:test');

const Database = require('better-sqlite3');
const { WhiteboardStore } = require('../../dist/hub/whiteboard-store.js');

function createStore() {
  const db = new Database(':memory:');
  return {
    store: new WhiteboardStore(db),
    close: () => db.close(),
  };
}

function assertStatus(fn, statusCode) {
  assert.throws(fn, (error) => error && error.statusCode === statusCode);
}

test('WhiteboardStore applies simple assistant operations', () => {
  const { store, close } = createStore();
  try {
    store.create({ id: 'board', title: 'Board' });

    const added = store.applyOperations('board', [
      { action: 'add_shape', shapes: [{ id: 'note-1', type: 'text', text: 'First note' }, { id: 'rect-1', type: 'rectangle', text: 'Box' }] },
    ], 'test');
    assert.equal(added.version, 2);
    assert.equal(added.scene.elements.filter((element) => element && element.isDeleted !== true).length, 3);

    const edited = store.applyOperations('board', [{ action: 'update_text', id: 'note-1', text: 'Updated note' }], 'test');
    assert.equal(edited.scene.elements.find((element) => element && element.id === 'note-1').text, 'Updated note');

    const deleted = store.applyOperations('board', [{ action: 'delete_shape', id: 'rect-1' }], 'test');
    assert.equal(deleted.scene.elements.find((element) => element && element.id === 'rect-1').isDeleted, true);
  } finally {
    close();
  }
});

test('WhiteboardStore rejects stale scene saves', () => {
  const { store, close } = createStore();
  try {
    const created = store.create({ id: 'board', title: 'Board' });
    store.save('board', { baseVersion: created.version, title: 'Renamed' });

    assertStatus(() => {
      store.save('board', { baseVersion: created.version, title: 'Stale rename' });
    }, 409);
  } finally {
    close();
  }
});

test('WhiteboardStore rejects oversized scenes', () => {
  const { store, close } = createStore();
  try {
    assertStatus(() => {
      store.create({
        id: 'too-many-elements',
        scene: {
          elements: Array.from({ length: 501 }, (_, index) => ({ id: `shape-${index}`, type: 'rectangle' })),
          appState: null,
          files: {},
        },
      });
    }, 413);
  } finally {
    close();
  }
});

test('WhiteboardStore rejects bad assistant operations', () => {
  const { store, close } = createStore();
  try {
    store.create({ id: 'board', title: 'Board' });
    store.applyOperations('board', [{ action: 'add_shape', shape: { id: 'note-1', type: 'text', text: 'Existing' } }], 'test');

    assertStatus(() => {
      store.applyOperations('board', [{ action: 'delete_shape', id: 'missing' }], 'test');
    }, 400);

    assertStatus(() => {
      store.applyOperations('board', [{ action: 'unknown' }], 'test');
    }, 400);

    assertStatus(() => {
      store.applyOperations('board', Array.from({ length: 101 }, () => ({ action: 'add_shape', shape: { type: 'text', text: 'x' } })), 'test');
    }, 413);

    assertStatus(() => {
      store.applyOperations('board', [{ action: 'add_shape', shape: { id: 'note-1', type: 'text', text: 'Duplicate' } }], 'test');
    }, 400);
  } finally {
    close();
  }
});

test('WhiteboardStore rejects reusing a deleted whiteboard id', () => {
  const { store, close } = createStore();
  try {
    store.create({ id: 'archived', title: 'Archived' });
    assert.equal(store.delete('archived').deleted, true);

    assertStatus(() => {
      store.create({ id: 'archived', title: 'Reused' });
    }, 409);
  } finally {
    close();
  }
});
