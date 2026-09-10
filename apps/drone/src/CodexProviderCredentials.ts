import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

// Credentials live outside prompt records and scripts, with owner-only permissions.
export class CodexProviderCredentials {
  constructor(private readonly dataDir: string) {}

  async save(sessionKey: string, apiKey: string): Promise<string> {
    if (!apiKey.trim()) throw new Error('Configure an OpenRouter API key in Hub settings.');
    const version = crypto.createHash('sha256').update(apiKey.trim()).digest('hex');
    const file = this.file(sessionKey, version);
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, apiKey.trim(), { mode: 0o600 });
      await fs.rename(temporary, file);
      return version;
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }

  async environment(sessionKey: string, version?: string): Promise<NodeJS.ProcessEnv> {
    try {
      if (!version || !/^[a-f0-9]{64}$/.test(version)) throw new Error('Missing credential version');
      const apiKey = (await fs.readFile(this.file(sessionKey, version), 'utf8')).trim();
      if (!apiKey) throw new Error('Empty credential');
      return { DRONE_CODEX_OPENROUTER_API_KEY: apiKey };
    } catch {
      throw new Error('OpenRouter credentials are unavailable. Resend the message from Drone Hub.');
    }
  }

  private file(sessionKey: string, version: string): string {
    return path.join(this.dataDir, 'credentials', 'codex-openrouter', crypto.createHash('sha256').update(sessionKey).digest('hex') + '-' + version);
  }
}
