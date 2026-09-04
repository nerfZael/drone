import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  COMPANION_SHORTCUT_DOUBLE_TAP_MS,
  companionProposalShortcutGesture,
  isCompanionShortcutDoubleTap,
  shouldAutoExecuteCompanionProposal,
  shouldConsumeCompanionProposalShortcut,
  shouldCancelCompanionRecordingWithEscape,
} from '../src/droneHub/companion/companion-shortcut';

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

describe('Companion proposal auto-approve', () => {
  test('waits for a successfully completed turn and an executable proposal', () => {
    const ready = {
      enabled: true,
      status: 'completed',
      operationCount: 1,
      hasExecutionContext: true,
      executing: false,
      executed: false,
    };
    expect(shouldAutoExecuteCompanionProposal(ready)).toBe(true);
    expect(shouldAutoExecuteCompanionProposal({ ...ready, enabled: false })).toBe(false);
    expect(shouldAutoExecuteCompanionProposal({ ...ready, status: 'working' })).toBe(false);
    expect(shouldAutoExecuteCompanionProposal({ ...ready, status: 'cancelled' })).toBe(false);
    expect(shouldAutoExecuteCompanionProposal({ ...ready, status: 'error' })).toBe(false);
    expect(shouldAutoExecuteCompanionProposal({ ...ready, operationCount: 0 })).toBe(false);
    expect(shouldAutoExecuteCompanionProposal({ ...ready, hasExecutionContext: false })).toBe(false);
    expect(shouldAutoExecuteCompanionProposal({ ...ready, executing: true })).toBe(false);
    expect(shouldAutoExecuteCompanionProposal({ ...ready, executed: true })).toBe(false);
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
