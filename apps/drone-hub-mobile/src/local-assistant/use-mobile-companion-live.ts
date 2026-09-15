import React from 'react';
import { CompanionLiveController, type CompanionClientController, type CompanionLiveTarget } from '@drone/assistant-chat';
import { useMesh } from '../mesh/MeshContext';
import { MobileCompanionLivePlatform } from './MobileCompanionLivePlatform';
import type { MobileMicrophoneCoordinator } from './mobile-microphone-coordinator';

export function useMobileCompanionLive(microphoneCoordinator: MobileMicrophoneCoordinator, controller?: CompanionClientController,
  shortcutCallbacks?: { start(): Promise<void>; ended(): void }) {
  const mesh = useMesh();
  const latest = React.useRef({ mesh, shortcutCallbacks });
  latest.current = { mesh, shortcutCallbacks };
  const [shortcutArmed, setShortcutArmed] = React.useState(false);
  const [runtime] = React.useState(() => {
    const platform: MobileCompanionLivePlatform = new MobileCompanionLivePlatform({
      microphoneCoordinator,
      mesh: () => latest.current.mesh,
      onShortcutArmed: setShortcutArmed,
      hasTarget: () => ['connecting', 'listening', 'paused'].includes(live.getSnapshot().status),
      onAction: (action) => {
        if (action === 'play') {
          const state = live.getSnapshot();
          if (state.status === 'paused') void live.resume();
          else if (platform.canUseShortcut() && (state.status === 'idle' || state.status === 'error')) {
            void latest.current.shortcutCallbacks?.start().catch((error) => {
              if (live.getSnapshot() !== state) return;
              live.fail(error instanceof Error ? error.message : 'Could not start Companion.');
            });
          }
        } else if (action === 'pause' || action === 'stop') live.pause();
        else if (action === 'end') {
          platform.disarm();
          latest.current.shortcutCallbacks?.ended();
          void live.stop();
        }
      },
    });
    const live: CompanionLiveController = new CompanionLiveController(platform, controller);
    return { platform, live };
  });
  const { live, platform } = runtime;
  const state = React.useSyncExternalStore(live.subscribe, live.getSnapshot, live.getSnapshot);
  React.useEffect(() => () => { platform.disarm(); void live.stop(); }, [live, platform]);
  const start = React.useCallback((id: string, name: string, run: CompanionLiveTarget['run'], signal?: AbortSignal) =>
    live.start({ id, name, run }, signal), [live]);
  return { ...state, shortcutArmed, setHeadsetShortcut: platform.setHeadsetShortcut,
    start, stop: live.stop, reset: live.reset, pause: live.pause, resume: live.resume, toggleMute: live.toggleMute };
}
