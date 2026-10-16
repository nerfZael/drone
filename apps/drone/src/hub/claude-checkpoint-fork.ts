/* eslint-disable @typescript-eslint/no-require-imports -- Serialized helpers load Node built-ins inside the provider process, not the Hub. */

export function claudeCheckpointValidationScript(sessionId: string, messageId: string): string {
  return `(${validateClaudeCheckpoint.toString()})(${JSON.stringify(sessionId)}, ${JSON.stringify(messageId)});`;
}

/** Validate before invoking --resume-session-at; never fall back to the live tail. */
export function validateClaudeCheckpoint(sessionId: string, messageId: string): void {
  // Self-contained so the same read-only check can execute inside a container drone.
  const fs = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  const os = require('node:os') as typeof import('node:os');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(sessionId) || !uuid.test(messageId))
    throw new Error('Invalid Claude checkpoint ID.');
  const projects = path.join(
    process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
    'projects',
  );
  const directories = fs
    .readdirSync(projects, { withFileTypes: true })
    .filter((entry) => entry.isDirectory());
  // A long session's transcript can outgrow the longest string Node can hold, so it is
  // read in chunks, and only lines that mention the message are parsed.
  const needle = Buffer.from(messageId);
  const isCheckpoint = (line: Buffer): boolean => {
    if (line.indexOf(needle) < 0) return false;
    let entry: any;
    try {
      entry = JSON.parse(line.toString('utf8'));
    } catch {
      return false;
    } // The live tail may be an incomplete line.
    return (
      entry?.uuid === messageId &&
      entry.type === 'assistant' &&
      !entry.isSidechain &&
      entry.sessionId === sessionId &&
      Array.isArray(entry.message?.content) &&
      entry.message.content.some(
        (part: any) => part?.type === 'text' && typeof part.text === 'string' && part.text.trim(),
      )
    );
  };
  for (const directory of directories) {
    const file = path.join(projects, directory.name, `${sessionId}.jsonl`);
    let fd: number;
    try {
      fd = fs.openSync(file, 'r');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    try {
      const chunk = Buffer.alloc(1 << 20);
      // The start of a line that continues in the next chunk.
      let partial: Buffer[] = [];
      for (;;) {
        const read = fs.readSync(fd, chunk, 0, chunk.length, null);
        if (read === 0) break;
        const data = chunk.subarray(0, read);
        let start = 0;
        for (let end = data.indexOf(10); end >= 0; end = data.indexOf(10, start)) {
          const piece = data.subarray(start, end);
          const line = partial.length ? Buffer.concat([...partial, piece]) : piece;
          partial = [];
          if (isCheckpoint(line)) return;
          start = end + 1;
        }
        if (start < read) partial.push(Buffer.from(data.subarray(start)));
      }
      if (partial.length && isCheckpoint(Buffer.concat(partial))) return;
    } finally {
      fs.closeSync(fd);
    }
  }
  throw new Error(
    'The Claude assistant checkpoint is no longer available; the source was not changed.',
  );
}
