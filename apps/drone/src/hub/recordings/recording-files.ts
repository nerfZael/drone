import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

/** Readers see either the old complete file or the new complete file, including after a crash. */
export async function writeRecordingFile(file: string, content: string) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temporary, content, { mode: 0o600, flag: 'wx' }); await fs.rename(temporary, file); }
  finally { await fs.rm(temporary, { force: true }); }
}
