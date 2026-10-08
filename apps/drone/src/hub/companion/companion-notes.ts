import fs from 'node:fs/promises';
import path from 'node:path';
import { companionHomeRoot } from './companion-attachments';

export const COMPANION_NOTE_MAX_CHARS = 200_000;
/** Naming is a nicety; a slow provider must not hold the dictation hostage. */
const TITLE_TIMEOUT_MS = 15_000;

export type CompanionNoteDependencies = {
  suggestTitle(text: string): Promise<string>;
  log?(level: 'warn', message: string, meta?: Record<string, unknown>): void;
  homeRoot?: string;
  now?: () => Date;
  titleTimeoutMs?: number;
};

/** Saves dictated text as `notes/<date> <title>.md` in the Companion home, titled by the naming LLM. */
export async function createCompanionNote(
  rawText: unknown,
  deps: CompanionNoteDependencies,
): Promise<{ path: string; name: string; title: string }> {
  const text = typeof rawText === 'string' ? rawText.trim() : '';
  if (!text) throw Object.assign(new Error('Note text is required.'), { code: 'INVALID_REQUEST' });
  if (text.length > COMPANION_NOTE_MAX_CHARS) {
    throw Object.assign(new Error('Note text is too long.'), { code: 'INVALID_REQUEST' });
  }
  let title = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    title = fileTitle(await Promise.race([
      deps.suggestTitle(text),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('note title suggestion timed out')), deps.titleTimeoutMs ?? TITLE_TIMEOUT_MS);
      }),
    ]));
  } catch (error) {
    // A missing naming key must not lose the dictation.
    deps.log?.('warn', 'note title suggestion failed; using the opening words', {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearTimeout(timer);
  }
  title ||= fileTitle(text.split(/\s+/).slice(0, 6).join(' ')) || 'Note';

  const directory = path.join(deps.homeRoot ?? companionHomeRoot(), 'notes');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const now = deps.now?.() ?? new Date();
  const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((part) => String(part).padStart(2, '0'))
    .join('-');
  for (let attempt = 1; attempt <= 100; attempt += 1) {
    const name = `${date} ${title}${attempt > 1 ? ` (${attempt})` : ''}.md`;
    try {
      await fs.writeFile(path.join(directory, name), `${text}\n`, { mode: 0o600, flag: 'wx' });
      return { path: `notes/${name}`, name, title };
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }
  throw new Error('Too many notes share this title today.');
}

function fileTitle(raw: string): string {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 60)
    .trim();
}
