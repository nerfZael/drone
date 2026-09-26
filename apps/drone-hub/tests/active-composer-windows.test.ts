import { expect, test } from 'bun:test';
import { ActiveComposerRegistry, type ActiveComposer } from '../src/droneHub/chat/ActiveComposerContext';

// Two windows (documents): the Hub's own and a desktop window of its own, like the entity bench.
const hubWindow = {} as Document;
const benchWindow = {} as Document;
const composer = (id: string, doc: Document): ActiveComposer => ({ id, isEligible: () => true, appendTranscript: () => undefined, ownerDocument: () => doc });

test('composer shortcuts act in the window in use, not in the one last typed in', () => {
  const registry = new ActiveComposerRegistry();
  registry.register(composer('hub-chat', hubWindow));
  registry.register(composer('side-chat', hubWindow));
  registry.register(composer('entity-chat', benchWindow));
  registry.focus('side-chat');
  registry.focus('entity-chat');
  expect(registry.getSnapshot()).toBe('entity-chat');
  // Back in the Hub's window: its last active composer is the target again.
  registry.activateIn(hubWindow);
  expect(registry.getSnapshot()).toBe('side-chat');
  // Already in the right window: nothing changes.
  registry.activateIn(hubWindow);
  expect(registry.getSnapshot()).toBe('side-chat');
  registry.activateIn(benchWindow);
  expect(registry.getSnapshot()).toBe('entity-chat');
});
