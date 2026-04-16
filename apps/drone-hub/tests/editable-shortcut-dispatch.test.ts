import { describe, expect, test } from 'bun:test';
import { shouldDispatchEditableShortcutAction } from '../src/droneHub/app/lifecycle-effect-helpers';

describe('editable shortcut dispatch', () => {
  test('allows create-draft shortcut from primary chat input', () => {
    const out = shouldDispatchEditableShortcutAction({
      matchedActionId: 'createDraftDrone',
      targetInPrimaryChatInput: true,
      targetInCanvasMessageInput: false,
    });
    expect(out).toBe(true);
  });

  test('allows create-draft shortcut from canvas message input', () => {
    const out = shouldDispatchEditableShortcutAction({
      matchedActionId: 'createDraftDrone',
      targetInPrimaryChatInput: false,
      targetInCanvasMessageInput: true,
    });
    expect(out).toBe(true);
  });

  test('does not allow other shortcuts from editable inputs', () => {
    const out = shouldDispatchEditableShortcutAction({
      matchedActionId: 'openCanvasTab',
      targetInPrimaryChatInput: true,
      targetInCanvasMessageInput: true,
    });
    expect(out).toBe(false);
  });

  test('does not allow create-chat shortcut from chat inputs', () => {
    expect(
      shouldDispatchEditableShortcutAction({
        matchedActionId: 'createDroneChat',
        targetInPrimaryChatInput: true,
        targetInCanvasMessageInput: false,
      }),
    ).toBe(false);
    expect(
      shouldDispatchEditableShortcutAction({
        matchedActionId: 'createDroneChat',
        targetInPrimaryChatInput: false,
        targetInCanvasMessageInput: true,
      }),
    ).toBe(false);
  });

  test('does not allow child-drone shortcut from chat inputs', () => {
    expect(
      shouldDispatchEditableShortcutAction({
        matchedActionId: 'createChildDraftDrone',
        targetInPrimaryChatInput: true,
        targetInCanvasMessageInput: false,
      }),
    ).toBe(false);
    expect(
      shouldDispatchEditableShortcutAction({
        matchedActionId: 'createChildDraftDrone',
        targetInPrimaryChatInput: false,
        targetInCanvasMessageInput: true,
      }),
    ).toBe(false);
  });
});
