export type BackgroundLifecycle = {
  register: (name: string, stop: () => Promise<void>) => void;
  stop: () => Promise<void>;
};

export function createBackgroundLifecycle(
  onStopError: (name: string, error: unknown) => void,
): BackgroundLifecycle {
  const resources: Array<{ name: string; stop: () => Promise<void> }> = [];
  let stopPromise: Promise<void> | null = null;

  return {
    register(name, stop) {
      resources.push({ name, stop });
    },
    async stop() {
      if (!stopPromise) {
        stopPromise = (async () => {
          for (const resource of [...resources].reverse()) {
            try {
              await resource.stop();
            } catch (error) {
              onStopError(resource.name, error);
            }
          }
        })();
      }
      await stopPromise;
    },
  };
}
