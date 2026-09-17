import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, spyOn, test } from 'bun:test';
import * as liveModule from '../src/droneHub/companion/use-companion-live';
import * as cuesModule from '../src/droneHub/companion/companion-recording-cues';
import { CompanionProvider, useCompanion } from '../src/droneHub/companion/CompanionContext';
import { useDroneHubUiStore } from '../src/droneHub/app/use-drone-hub-ui-store';
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

test('Jev holds pause, resume, stop without resetting, restart on tap, and clear context only on the longest hold', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: 'http://localhost' } } });
  const useLive = liveModule.useCompanionLive;
  let live!: ReturnType<typeof useLive>;
  let starts = 0; let stops = 0; let resets = 0;
  const cues: string[] = [];
  const cueSpy = spyOn(cuesModule, 'playCompanionRecordingCue').mockImplementation(cue => { cues.push(cue); });
  const liveSpy = spyOn(liveModule, 'useCompanionLive').mockImplementation(() => {
    live = { ...useLive(), mode: 'jev', enabled: true, resolved: true, loading: false,
      start: async () => { starts++; live.status = 'listening'; live.muted = false; },
      stop: () => { stops++; live.status = 'idle'; live.muted = false; },
      reset: () => { resets++; live.stop(); },
      toggleMute: () => { live.muted = !live.muted; },
    };
    return live;
  });
  let companion!: NonNullable<ReturnType<typeof useCompanion>>;
  function Harness() { companion = useCompanion()!; return null; }
  const press = () => companion.handleShortcut({ phase: 'down' });
  const release = async (heldMs: number) => { companion.handleShortcut({ phase: 'up', heldMs }); await flush(); };
  const durations = useDroneHubUiStore.getState().companionShortcutDurations;
  try {
    useDroneHubUiStore.setState({ companionShortcutDurations: { pauseMs: 300, cancelMs: 800, resetMs: 1300 } });
    renderToStaticMarkup(<CompanionProvider><Harness /></CompanionProvider>);
    press(); expect(starts).toBe(0); await release(30); expect(starts).toBe(1);
    press(); expect(live.muted).toBe(false); await release(400); expect(live.muted).toBe(true);
    press(); await release(400); expect(live.muted).toBe(false); expect(cues.at(-1)).toBe('resume');
    press(); await release(900); expect(live.status).toBe('idle'); expect(stops).toBe(1); expect(resets).toBe(0);
    press(); await release(30); expect(starts).toBe(2); expect(resets).toBe(0);
    press(); await release(1400); expect(live.status).toBe('idle'); expect(resets).toBe(1); expect(starts).toBe(2);
    press(); await release(30); expect(starts).toBe(3);
    press(); companion.handleShortcut({ phase: 'cancel' }); await release(1400); expect(resets).toBe(1);
    // Select the middle-hold action from keydown, even if listening ends during the hold.
    press(); live.status = 'idle'; await release(900); expect(cues.at(-1)).toBe('cancel'); expect(resets).toBe(1);
    press(); await release(900); expect(cues.at(-1)).toBe('close'); expect(resets).toBe(1);
    useDroneHubUiStore.setState({ companionShortcutDurations: { pauseMs: 200, cancelMs: 400, resetMs: 600 } });
    press(); await release(30); press(); await release(250); expect(live.muted).toBe(true);
    press(); await release(650); expect(resets).toBe(2);
  } finally {
    await companion?.close();
    useDroneHubUiStore.setState({ companionShortcutDurations: durations });
    liveSpy.mockRestore(); cueSpy.mockRestore();
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window');
  }
});
