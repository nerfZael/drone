import type { ContinuousVoiceSessionStatus } from '@drone/assistant-chat';

type ContinuousDictationToggleControls = {
  getStatus(): ContinuousVoiceSessionStatus;
  start(): Promise<boolean>;
  stop(): Promise<void>;
  cancel(): void;
  onStartIntent(): void;
};

export function createContinuousDictationToggle(
  controls: ContinuousDictationToggleControls,
) {
  let intendedActive = false;
  let pendingCommands = 0;
  let commandTail: Promise<void> | null = null;
  let generation = 0;
  let active = true;

  const sync = (active: boolean) => {
    if (pendingCommands === 0) intendedActive = active;
  };

  const runCommand = async (shouldStart: boolean, commandGeneration: number) => {
    if (!active || commandGeneration !== generation) return;
    if (shouldStart) {
      if (controls.getStatus() !== 'idle') controls.cancel();
      await controls.start();
      return;
    }
    if (controls.getStatus() === 'error') {
      controls.cancel();
      return;
    }
    if (controls.getStatus() !== 'idle') await controls.stop();
  };

  const toggle = (): Promise<void> => {
    if (!active) return Promise.resolve();
    const shouldStart = !intendedActive;
    const commandGeneration = generation;
    intendedActive = shouldStart;

    if (shouldStart) {
      controls.onStartIntent();
      // A second press while stop is flushing audio should abort that old work.
      // The queued start still waits for stop to unwind before opening the mic.
      if (controls.getStatus() === 'stopping') controls.cancel();
    } else if (controls.getStatus() === 'starting') {
      // Invalidate an in-flight permission/settings request immediately.
      controls.cancel();
    }

    pendingCommands += 1;
    const command = () => runCommand(shouldStart, commandGeneration);
    const run = commandTail ? commandTail.then(command) : command();
    const completed = run.finally(() => {
      pendingCommands -= 1;
      if (pendingCommands === 0) intendedActive = controls.getStatus() !== 'idle';
    });
    const safeTail = completed.then(
      () => undefined,
      () => undefined,
    );
    commandTail = safeTail;
    void safeTail.then(() => {
      if (commandTail === safeTail) commandTail = null;
    });
    return completed;
  };

  const activate = () => {
    active = true;
  };

  const deactivate = () => {
    if (!active) return;
    active = false;
    intendedActive = false;
    generation += 1;
    controls.cancel();
  };

  return { activate, deactivate, sync, toggle };
}
