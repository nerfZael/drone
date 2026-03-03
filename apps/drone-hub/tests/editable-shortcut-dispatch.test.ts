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
});
