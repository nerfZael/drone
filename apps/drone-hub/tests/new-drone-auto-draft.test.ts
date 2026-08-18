import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

describe('new drone automatic drafts', () => {
  test('desktop saves populated composer content as a background draft on navigation', () => {
    const workspaceSource = readFileSync(
      new URL('../src/droneHub/app/DraftChatWorkspace.tsx', import.meta.url),
      'utf8',
    );
    const modelSource = readFileSync(
      new URL('../src/use-drone-hub-app-model.tsx', import.meta.url),
      'utf8',
    );
    const creationSource = readFileSync(
      new URL('../src/droneHub/app/use-drone-creation-actions.ts', import.meta.url),
      'utf8',
    );

    expect(workspaceSource).not.toContain('Save as draft');
    expect(workspaceSource).toContain('onDraftContentChange={onDraftContentChange}');
    expect(modelSource).toContain('encodeDraftChatAttachments(content.attachments)');
    expect(modelSource).toContain('createAsDraft: true');
    expect(modelSource).toContain('selectOnSuccess: false');
    expect(modelSource).toContain("setDraftChat(null)");
    expect(creationSource).not.toContain('Draft drones cannot queue attachments');
    expect(creationSource).toContain(
      'seedAttachments: shouldSeedPromptViaCreate ? draftAttachments : []',
    );
  });

  test('desktop reserves keep-open creation for Ctrl/Command+Enter', () => {
    const workspaceSource = readFileSync(
      new URL('../src/droneHub/app/DraftChatWorkspace.tsx', import.meta.url),
      'utf8',
    );
    const chatInputSource = readFileSync(
      new URL('../src/droneHub/chat/ChatInput.tsx', import.meta.url),
      'utf8',
    );

    expect(workspaceSource).toContain('editorCtrlEnterBehavior="new-chat"');
    expect(workspaceSource).toContain('onSendInNewChat=');
    expect(workspaceSource).toContain('keepComposerOpen: true');
    expect(workspaceSource).not.toContain(
      "keepComposerOpen: context.trigger === 'keyboard' && context.deliveryMode === 'queue'",
    );
    expect(chatInputSource).toContain(
      "editorCtrlEnterBehavior === 'new-chat' && onSendInNewChat",
    );
  });

  test('mobile removes the header toggle and saves before leaving the new-drone screen', () => {
    const mobileRoot = new URL('../../drone-hub-mobile/src/', import.meta.url);
    const headerSource = readFileSync(new URL('shell/MeshApp.tsx', mobileRoot), 'utf8');
    const screenSource = readFileSync(new URL('screens/DronesScreen.tsx', mobileRoot), 'utf8');
    const newDroneSource = readFileSync(new URL('drones/NewDroneScreen.tsx', mobileRoot), 'utf8');

    expect(headerSource).not.toContain('accessibilityLabel="Create as draft"');
    expect(newDroneSource).toContain('onDraftContentChange({');
    expect(screenSource).toContain('saveNewDroneDraftBeforeNavigation()');
    expect(screenSource).toContain('{ ...content.payload, draft: true }');
    expect(screenSource).toContain('{ selectCreatedDrone: false }');
    expect(screenSource).toContain('setNewDroneScreenVersion((value) => value + 1)');
    expect(screenSource).toContain('newDroneDraftSavePromiseRef.current');
  });
});
