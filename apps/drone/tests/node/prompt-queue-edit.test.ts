import assert from 'node:assert/strict';
import test from 'node:test';

import { PromptQueueRepository } from '../../src/host/prompt-queue-repository';
import { memoryHubDatabase } from './helpers/memory-hub-database';

const sender = { kind: 'chat' as const, chatId: 'chat-a', droneId: 'drone', chatName: 'lead' };

async function enqueue(queue: PromptQueueRepository, id: string, extra: Record<string, unknown> = {}) {
  await queue.enqueue({
    droneId: 'drone',
    chatName: 'worker',
    prompt: { id, at: new Date().toISOString(), prompt: `${id} text`, state: 'queued', ...extra },
  });
}

test('a sender stamp is written once and never replaced', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    const queue = new PromptQueueRepository(database);
    await enqueue(queue, 'p1');
    const ref = { droneId: 'drone', chatName: 'worker', promptId: 'p1' };
    assert.equal(await queue.stampSender({ ...ref, sentBy: sender }), true);
    // An idempotent retry by the same chat still owns the prompt.
    assert.equal(await queue.stampSender({ ...ref, sentBy: sender }), true);
    assert.equal(await queue.stampSender({ ...ref, promptId: 'missing', sentBy: sender }), false);
    assert.equal(
      await queue.stampSender({ ...ref, sentBy: { ...sender, chatId: 'chat-b' } }),
      false,
    );
    assert.deepEqual(queue.get(ref)?.sentBy, sender);
  } finally {
    close();
  }
});

test('editing a waiting prompt keeps its queue position and updates the native text', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    const queue = new PromptQueueRepository(database);
    await enqueue(queue, 'phase-1');
    await enqueue(queue, 'phase-2', { nativePrompt: { text: 'phase-2 text', images: [] } });
    await enqueue(queue, 'phase-3');
    for (const promptId of ['phase-1', 'phase-2', 'phase-3']) {
      await queue.stampSender({ droneId: 'drone', chatName: 'worker', promptId, sentBy: sender });
    }
    const ref = { droneId: 'drone', chatName: 'worker', promptId: 'phase-2' };

    const replaced = await queue.editQueued({ ...ref, text: 'new phase 2', requireSentByChatId: 'chat-a' });
    assert.deepEqual(replaced, { status: 'edited', state: 'queued', prompt: 'new phase 2' });
    const appended = await queue.editQueued({ ...ref, text: 'also this', mode: 'append' });
    assert.equal(appended.status === 'edited' && appended.prompt, 'new phase 2\n\nalso this');

    const row = queue.get(ref);
    assert.equal(row?.prompt, 'new phase 2\n\nalso this');
    assert.equal(row?.nativePrompt?.text, 'new phase 2\n\nalso this');
    assert.deepEqual(row?.sentBy, sender);
    assert.deepEqual(
      queue.listPending({ droneId: 'drone', chatName: 'worker' }).map((prompt) => prompt.id),
      ['phase-1', 'phase-2', 'phase-3'],
    );
  } finally {
    close();
  }
});

test('edits are refused for other senders, claimed prompts, and automated prompts', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    const queue = new PromptQueueRepository(database);
    await enqueue(queue, 'claimed');
    await enqueue(queue, 'mine');
    await enqueue(queue, 'action', {
      action: { type: 'send-in-new-chat', chatName: 'spawned' },
    });
    await queue.stampSender({ droneId: 'drone', chatName: 'worker', promptId: 'mine', sentBy: sender });
    await queue.claim({ droneId: 'drone', chatName: 'worker', promptId: 'claimed', leaseOwner: 'hub:test' });
    const ref = (promptId: string) => ({ droneId: 'drone', chatName: 'worker', promptId });

    assert.deepEqual(await queue.editQueued({ ...ref('claimed'), text: 'late' }), {
      status: 'too-late',
      state: 'sending',
    });
    assert.deepEqual(
      await queue.editQueued({ ...ref('mine'), text: 'x', requireSentByChatId: 'chat-b' }),
      { status: 'not-owner', state: 'queued' },
    );
    assert.equal((await queue.editQueued({ ...ref('action'), text: 'x' })).status, 'unsupported');
    assert.deepEqual(await queue.editQueued({ ...ref('missing'), text: 'x' }), {
      status: 'not-found',
      state: null,
    });
    assert.equal(queue.get(ref('claimed'))?.prompt, 'claimed text');
    assert.equal(queue.get(ref('mine'))?.prompt, 'mine text');
  } finally {
    close();
  }
});

test('native preparation keeps uploaded-file references through an edit and never reuses stale text', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    const queue = new PromptQueueRepository(database);
    const ref = { droneId: 'drone', chatName: 'worker', promptId: 'with-files' };
    const files = '\n\nAttached files:\n- /artifacts/spec.md';
    await enqueue(queue, 'with-files');
    await queue.prepareQueuedNativePrompt({ ...ref, nativePrompt: { text: `with-files text${files}`, images: [] } });

    const edited = await queue.editQueued({ ...ref, text: 'Use the spec.' });
    assert.equal(edited.status, 'edited');
    assert.equal(queue.get(ref)?.nativePrompt?.text, `Use the spec.${files}`);

    // A pump that read the prompt before an edit must not prepare the old text.
    await enqueue(queue, 'raced');
    const raced = { ...ref, promptId: 'raced' };
    await queue.editQueued({ ...raced, text: 'New text' });
    await queue.prepareQueuedNativePrompt({ ...raced, nativePrompt: { text: `raced text${files}`, images: [] } });
    assert.equal(queue.get(raced)?.nativePrompt, undefined);
    await queue.prepareQueuedNativePrompt({ ...raced, nativePrompt: { text: `New text${files}`, images: [] } });
    assert.equal(queue.get(raced)?.nativePrompt?.text, `New text${files}`);
  } finally {
    close();
  }
});
