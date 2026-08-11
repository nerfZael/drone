export type SidebarCommandQueue = {
  enqueue<T>(task: () => Promise<T>): Promise<T>;
};

/** Serialize sidebar writes while allowing callers to apply their UI change first. */
export function createSidebarCommandQueue(): SidebarCommandQueue {
  let tail: Promise<void> = Promise.resolve();
  return {
    enqueue<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.then(task, task);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}

