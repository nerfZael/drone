import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function loadServerEnv(): void {
  const candidates = [
    path.resolve(process.cwd(), 'server', '.env'),
    path.resolve(process.cwd(), '.env'),
  ];
  for (const file of candidates) {
    if (existsSync(file)) loadEnvFile(file);
  }
  aliasEnv('CLERK_PUBLISHABLE_KEY', 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'VITE_CLERK_PUBLISHABLE_KEY');
  aliasEnv('VITE_CLERK_PUBLISHABLE_KEY', 'CLERK_PUBLISHABLE_KEY', 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY');
}

function loadEnvFile(file: string): void {
  const text = readFileSync(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed || process.env[parsed.key] != null) continue;
    process.env[parsed.key] = parsed.value;
  }
}

function aliasEnv(target: string, ...sources: string[]): void {
  if (process.env[target] != null) return;
  for (const source of sources) {
    const value = process.env[source]?.trim();
    if (value) {
      process.env[target] = value;
      return;
    }
  }
}

function parseEnvLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
  if (!match) return null;
  return { key: match[1]!, value: parseEnvValue(match[2] ?? '') };
}

function parseEnvValue(raw: string): string {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value.replace(/\s+#.*$/, '').trim();
}
