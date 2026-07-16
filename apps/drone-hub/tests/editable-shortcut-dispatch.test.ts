import { describe, expect, test } from 'bun:test';
import { shouldDispatchEditableShortcutAction } from '../src/droneHub/app/lifecycle-effect-helpers';

describe('editable shortcut dispatch', () => {
  test('allows create-draft shortcut from primary chat input', () => {
    const out = shouldDispatchEditableShortcutAction({
      matchedActionId: 'createDraftDrone',
      targetInPrimaryChatInput: true,
      targetInCanvasMessageInput: false,
      targetInAssistantChatInput: false,
    });
    expect(out).toBe(true);
  });

  test('allows create-draft shortcut from canvas message input', () => {
    const out = shouldDispatchEditableShortcutAction({
      matchedActionId: 'createDraftDrone',
      targetInPrimaryChatInput: false,
      targetInCanvasMessageInput: true,
      targetInAssistantChatInput: false,
    });
    expect(out).toBe(true);
  });

  test('does not allow create-draft shortcut from assistant chat input', () => {
    const out = shouldDispatchEditableShortcutAction({
      matchedActionId: 'createDraftDrone',
      targetInPrimaryChatInput: false,
      targetInCanvasMessageInput: false,
      targetInAssistantChatInput: true,
    });
    expect(out).toBe(false);
  });

  test('does not allow other shortcuts from editable inputs', () => {
    const out = shouldDispatchEditableShortcutAction({
      matchedActionId: 'openCanvasTab',
      targetInPrimaryChatInput: true,
      targetInCanvasMessageInput: true,
      targetInAssistantChatInput: true,
    });
    expect(out).toBe(false);
  });

  test('allows voice transcription shortcut from chat inputs', () => {
    expect(
      shouldDispatchEditableShortcutAction({
        matchedActionId: 'toggleVoiceClipboardRecording',
        targetInPrimaryChatInput: true,
        targetInCanvasMessageInput: false,
        targetInAssistantChatInput: false,
      }),
    ).toBe(true);
    expect(
      shouldDispatchEditableShortcutAction({
        matchedActionId: 'toggleVoiceClipboardRecording',
        targetInPrimaryChatInput: false,
        targetInCanvasMessageInput: true,
        targetInAssistantChatInput: false,
      }),
    ).toBe(true);
    expect(
      shouldDispatchEditableShortcutAction({
        matchedActionId: 'toggleVoiceClipboardRecording',
        targetInPrimaryChatInput: false,
        targetInCanvasMessageInput: false,
        targetInAssistantChatInput: true,
      }),
    ).toBe(true);
  });

  test('does not allow voice transcription shortcut from unrelated editable inputs', () => {
    const out = shouldDispatchEditableShortcutAction({
      matchedActionId: 'toggleVoiceClipboardRecording',
      targetInPrimaryChatInput: false,
      targetInCanvasMessageInput: false,
      targetInAssistantChatInput: false,
    });
    expect(out).toBe(false);
  });

  test('does not allow create-chat shortcut from chat inputs', () => {
    expect(
      shouldDispatchEditableShortcutAction({
        matchedActionId: 'createDroneChat',
        targetInPrimaryChatInput: true,
        targetInCanvasMessageInput: false,
        targetInAssistantChatInput: false,
      }),
    ).toBe(false);
    expect(
      shouldDispatchEditableShortcutAction({
        matchedActionId: 'createDroneChat',
        targetInPrimaryChatInput: false,
        targetInCanvasMessageInput: true,
        targetInAssistantChatInput: false,
      }),
    ).toBe(false);
  });

  test('does not allow child-drone shortcut from chat inputs', () => {
    expect(
      shouldDispatchEditableShortcutAction({
        matchedActionId: 'createChildDraftDrone',
        targetInPrimaryChatInput: true,
        targetInCanvasMessageInput: false,
        targetInAssistantChatInput: false,
      }),
    ).toBe(false);
    expect(
      shouldDispatchEditableShortcutAction({
        matchedActionId: 'createChildDraftDrone',
        targetInPrimaryChatInput: false,
        targetInCanvasMessageInput: true,
        targetInAssistantChatInput: false,
      }),
    ).toBe(false);
  });
});
