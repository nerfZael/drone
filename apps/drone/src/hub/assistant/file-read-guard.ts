/**
 * Keeps chats that share files from writing over each other. A reader (an agent chat, a native chat, the Companion, the
 * entity) may change a file through the workspace tools only after reading it, and only while the file is still as it
 * read it: a write by another reader, a save in the editor, a command, anything that changes its content, means reading
 * it again first. Files are compared by content, so no writer has to report its changes. New files can always be made.
 *
 * What each reader read is kept in memory: after the Hub restarts, readers read again before they write.
 */
export class FileReadGuard {
  /** Per reader, the sha256 of each file as that reader last read or wrote it, oldest first. */
  private readonly seen = new Map<string, Map<string, string>>();
  /** Per file, the change holding it, which the next one waits for. */
  private readonly queues = new Map<string, Promise<void>>();

  constructor(
    private readonly maxReaders = 500,
    private readonly maxFilesPerReader = 2_000,
  ) {}

  /** `reader` has seen `file` (its `fileId`) with this content, by reading it or by writing it. */
  saw(reader: string, file: string, sha256: string): void {
    let files = this.seen.get(reader);
    if (files) this.seen.delete(reader);
    else files = new Map();
    // Most recently active last, so the oldest readers and files are the ones dropped.
    this.seen.set(reader, files);
    files.delete(file);
    files.set(file, sha256);
    if (files.size > this.maxFilesPerReader) files.delete(files.keys().next().value!);
    if (this.seen.size > this.maxReaders) this.seen.delete(this.seen.keys().next().value!);
  }

  /** `file` is gone (deleted or moved away) as far as `reader` knows. */
  forget(reader: string, file: string): void {
    this.seen.get(reader)?.delete(file);
  }

  /** Throws unless `reader` last saw `file` with the content it has now (`sha256`); `label` names it in the message. */
  assertCurrent(reader: string, file: string, sha256: string, label: string): void {
    const seen = this.seen.get(reader)?.get(file);
    if (seen === undefined) {
      throw new Error(
        `Read ${label} with read_file before changing it. Files shared between chats are changed only after reading them, so no one's changes are lost.`,
      );
    }
    if (seen !== sha256) {
      throw new Error(
        `${label} changed since you last read it (another chat, the user or a command changed it). Read it again with read_file, then make your change on what it holds now.`,
      );
    }
  }

  /**
   * Runs a checked change while it holds every file it touches (by `fileId`), so two readers cannot both pass the check
   * for one file. Files are taken in one order, so changes touching the same files never wait on each other in a circle.
   */
  async serialize<T>(files: string[], change: () => Promise<T>): Promise<T> {
    const releases: Array<() => void> = [];
    try {
      for (const file of [...new Set(files)].sort()) releases.push(await this.take(file));
      return await change();
    } finally {
      for (const release of releases.reverse()) release();
    }
  }

  private async take(file: string): Promise<() => void> {
    const previous = this.queues.get(file) ?? Promise.resolve();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.queues.set(file, held);
    await previous;
    return () => {
      if (this.queues.get(file) === held) this.queues.delete(file);
      release();
    };
  }
}
