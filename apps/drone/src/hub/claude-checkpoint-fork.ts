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
  for (const directory of directories) {
    const file = path.join(projects, directory.name, `${sessionId}.jsonl`);
    let transcript: string;
    try {
      transcript = fs.readFileSync(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    for (const line of transcript.split('\n')) {
      let entry: any;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      } // The live tail may be an incomplete line.
      if (
        entry?.uuid === messageId &&
        entry.type === 'assistant' &&
        !entry.isSidechain &&
        entry.sessionId === sessionId &&
        Array.isArray(entry.message?.content) &&
        entry.message.content.some(
          (part: any) => part?.type === 'text' && typeof part.text === 'string' && part.text.trim(),
        )
      ) {
        return;
      }
    }
  }
  throw new Error(
    'The Claude assistant checkpoint is no longer available; the source was not changed.',
  );
}
