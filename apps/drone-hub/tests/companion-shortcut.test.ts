import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  COMPANION_SHORTCUT_DOUBLE_TAP_MS,
  companionProposalShortcutGesture,
  isCompanionShortcutDoubleTap,
  shouldConsumeCompanionProposalShortcut,
  shouldCancelCompanionRecordingWithEscape,
  companionRecordingGesture,
  CompanionShortcutPress,
} from '../src/droneHub/companion/companion-shortcut';

describe('Companion tap and hold', () => {
  test('classifies release at the cancel and reset thresholds', () => {
    expect(companionRecordingGesture(599)).toBe('tap');
    expect(companionRecordingGesture(600)).toBe('cancel');
    expect(companionRecordingGesture(1499)).toBe('cancel');
    expect(companionRecordingGesture(1500)).toBe('reset');
  });

  test('acts only on release, ignores repeat downs, and treats quick taps independently', () => {
    let now = 0;
    const press = new CompanionShortcutPress(() => now);
    const actions: string[] = [];
    const release = (action: string) => actions.push(action);
    press.down(release, () => {});
    now = 100;
    press.down(release, () => {});
    expect(actions).toEqual([]);
    press.up();
    press.down(release, () => {});
    press.up();
    expect(actions).toEqual(['tap', 'tap']);
    press.down(release, () => {});
    press.up(700); // Use host duration, independent of network delays.
    press.down(release, () => {});
    press.up(1600);
    expect(actions).toEqual(['tap', 'tap', 'cancel', 'reset']);
    press.down(release, () => {});
    press.cancel();
    press.up();
    expect(actions).toHaveLength(4);
  });

  test('hold thresholds only preview; reset never executes cancel first', async () => {
    const press = new CompanionShortcutPress();
    const actions: string[] = [];
    const previews: string[] = [];
    try {
      press.down(action => actions.push(action), action => previews.push(action));
      await new Promise(resolve => setTimeout(resolve, 1550));
      expect(previews).toEqual(['cancel', 'reset']);
      expect(actions).toEqual([]);
      press.up(1550);
      expect(actions).toEqual(['reset']);
    } finally { press.cancel(); }
  });
});

describe('Companion proposal shortcut', () => {
  test('consumes Caps Lock even while Apply is unavailable so capitalization is not toggled', () => {
    expect(shouldConsumeCompanionProposalShortcut({
      matched: true,
      shortcutKey: 'capslock',
      canApply: false,
    })).toBe(true);
    expect(shouldConsumeCompanionProposalShortcut({
      matched: true,
      shortcutKey: 'capslock',
      canApply: true,
    })).toBe(true);
  });

  test('does not swallow an unavailable custom binding or unrelated key', () => {
    expect(shouldConsumeCompanionProposalShortcut({
      matched: true,
      shortcutKey: 'k',
      canApply: false,
    })).toBe(false);
    expect(shouldConsumeCompanionProposalShortcut({
      matched: false,
      shortcutKey: 'capslock',
      canApply: true,
    })).toBe(false);
  });

  test('leaves proposal execution exclusively to auto-approve while it is enabled', () => {
    const source = readFileSync(
      new URL('../src/droneHub/app/use-drone-hub-lifecycle-effects.ts', import.meta.url),
      'utf8',
    );
    expect(source).toMatch(
      /const canApplyCompanionProposal = Boolean\([\s\S]*companion\?\.proposal &&\s*!companion\.autoApprove &&/,
    );
    expect(source).toContain("companion?.status === 'idle'");
    expect(source).toContain('companionProposalRef.current !== expectedProposal');
  });
});

describe('Companion shortcut double tap', () => {
  test('recognizes a second press only when it is relatively quick', () => {
    expect(isCompanionShortcutDoubleTap(1_000, 1_000 + COMPANION_SHORTCUT_DOUBLE_TAP_MS)).toBe(true);
    expect(isCompanionShortcutDoubleTap(1_000, 1_001 + COMPANION_SHORTCUT_DOUBLE_TAP_MS)).toBe(false);
    expect(isCompanionShortcutDoubleTap(0, 100)).toBe(false);
  });

  test('maps a proposal double tap to the auto-approve toggle', () => {
    expect(companionProposalShortcutGesture(0, 1_000)).toBe('schedule-apply');
    expect(companionProposalShortcutGesture(1_000, 1_200)).toBe('toggle-auto-approve');
    expect(companionProposalShortcutGesture(1_000, 1_500)).toBe('schedule-apply');
  });
});

describe('Companion recording Escape shortcut', () => {
  test('cancels only an active recording lifecycle', () => {
    for (const voiceStatus of ['starting', 'recording', 'paused']) {
      expect(shouldCancelCompanionRecordingWithEscape({
        key: 'Escape',
        repeat: false,
        isComposing: false,
        voiceStatus,
      })).toBe(true);
    }
    for (const voiceStatus of ['idle', 'transcribing']) {
      expect(shouldCancelCompanionRecordingWithEscape({
        key: 'Escape',
        repeat: false,
        isComposing: false,
        voiceStatus,
      })).toBe(false);
    }
  });

  test('leaves repeated, composing, and unrelated key presses alone', () => {
    expect(shouldCancelCompanionRecordingWithEscape({
      key: 'Enter',
      repeat: false,
      isComposing: false,
      voiceStatus: 'recording',
    })).toBe(false);
    expect(shouldCancelCompanionRecordingWithEscape({
      key: 'Escape',
      repeat: true,
      isComposing: false,
      voiceStatus: 'recording',
    })).toBe(false);
    expect(shouldCancelCompanionRecordingWithEscape({
      key: 'Escape',
      repeat: false,
      isComposing: true,
      voiceStatus: 'recording',
    })).toBe(false);
  });
});
