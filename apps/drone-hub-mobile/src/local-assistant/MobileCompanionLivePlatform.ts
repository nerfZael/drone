import { AppState, Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import type { CompanionLiveConnectionOptions, CompanionLivePlatform } from '@drone/assistant-chat';
import { MobileCompanionLiveConnection } from './MobileCompanionLiveConnection';
import { openMobileLiveAudio, prepareMobileLiveAudio } from './openMobileLiveAudio';
import { openMobileLiveControls, type MobileLiveControls, type LiveMediaAction } from './mobile-live-controls';
import type { MobileMicrophoneCoordinator } from './mobile-microphone-coordinator';

type Mesh = Pick<ConstructorParameters<typeof MobileCompanionLiveConnection>[0], 'request' | 'subscribe' | 'openLiveAudio'>;
type Options = {
  microphoneCoordinator: MobileMicrophoneCoordinator;
  mesh(): Mesh;
  onAction(action: LiveMediaAction): void;
  onShortcutArmed(armed: boolean): void;
  hasTarget(): boolean;
};

/** Serializes native control acquisition/release independently of Live connections. */
export class MobileCompanionLivePlatform implements CompanionLivePlatform {
  private controls: MobileLiveControls | null = null;
  private pending = Promise.resolve();
  private keepControls = false;

  constructor(private readonly options: Options) {}

  canStart = (): boolean => Boolean(this.controls) || AppState.currentState === 'active';
  canUseShortcut = (): boolean => this.keepControls && Boolean(this.controls);

  prepare = (signal: AbortSignal): Promise<void> => this.enqueue(async () => {
    if (signal.aborted) return;
    if (this.options.microphoneCoordinator.getSnapshot()) {
      throw new Error('Another voice feature is using the microphone. Stop it before starting Live.');
    }
    await this.openControls(false, () => !signal.aborted);
  });

  setHeadsetShortcut = async (enabled: boolean): Promise<void> => {
    if (enabled && Platform.OS !== 'android') throw new Error('Background headset shortcuts require Android.');
    this.keepControls = enabled;
    if (!enabled) this.options.onShortcutArmed(false);
    await this.enqueue(async () => {
      if (!enabled) {
        if (!this.keepControls && !this.options.hasTarget()) await this.releaseControls();
        return;
      }
      try {
        await this.openControls(true, () => this.keepControls);
        if (this.keepControls) this.options.onShortcutArmed(true);
      } catch (error) {
        this.keepControls = false;
        this.options.onShortcutArmed(false);
        throw error;
      }
    });
  };

  disarm(): void { this.keepControls = false; this.options.onShortcutArmed(false); }

  stopped = (audioReleased: Promise<void>, paused: boolean): Promise<void> => this.enqueue(async () => {
    await audioReleased;
    if (paused || this.keepControls) await this.controls?.update('paused');
    else await this.releaseControls();
  });

  schedule = (callback: () => void, delayMs: number): (() => void) => {
    if (this.controls?.schedule) return this.controls.schedule(callback, delayMs);
    const timer = setTimeout(callback, delayMs);
    return () => clearTimeout(timer);
  };

  createConnection = (options: CompanionLiveConnectionOptions) => {
    const controls = this.controls!;
    let playStopCue = false;
    const stop = () => { if (!options.signal.aborted) options.onStop(); };
    const connection = new MobileCompanionLiveConnection({
      ...options,
      ...this.options.mesh(),
      targetDeviceId: options.target.id, sessionId: Crypto.randomUUID(),
      microphoneCoordinator: this.options.microphoneCoordinator,
      schedule: controls.schedule,
      openAudio: (callbacks) => openMobileLiveAudio(callbacks, stop, {
        backgroundAlreadyStarted: true,
        onCaptureStopped: async () => { if (playStopCue) await controls.cue('stopped'); },
      }),
      onCapturing: () => {
        if (options.signal.aborted) return;
        options.onCapturing();
        void controls.update('recording').catch(stop);
        // Capture is already buffering; reconnects must not repeat the start cue.
        if (!options.reconnecting) void controls.cue('recording').catch(stop);
      },
      onError: (error) => {
        if (options.signal.aborted) return;
        void controls.update('connecting').catch(() => undefined);
        options.onError(error);
      },
    });
    return {
      start: async () => {
        void controls.update('connecting').catch(stop);
        await connection.start();
      },
      close: (reason: 'stop' | 'pause' | 'reconnect') => {
        playStopCue = reason !== 'reconnect';
        return connection.close();
      },
      mute: (muted: boolean) => connection.mute(muted),
      send: (event: Record<string, unknown>) => connection.send(event),
    };
  };

  private async openControls(standby: boolean, wanted: () => boolean): Promise<void> {
    if (!wanted() || this.controls) return;
    await prepareMobileLiveAudio(standby ? { headsetShortcut: true } : undefined);
    if (!wanted()) return;
    const controls = await openMobileLiveControls((action) => {
      if (this.controls === controls) this.options.onAction(action);
    }, standby);
    if (!wanted()) { await controls.release(); return; }
    this.controls = controls;
  }

  private async releaseControls(): Promise<void> {
    const controls = this.controls;
    this.controls = null;
    await controls?.release();
  }

  private enqueue(action: () => Promise<void>): Promise<void> {
    const pending = this.pending.then(action);
    this.pending = pending.catch(() => undefined);
    return pending;
  }
}
