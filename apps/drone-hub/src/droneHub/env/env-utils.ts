export type EnvDraftEntry = {
  id: string;
  key: string;
  value: string;
};

export type EnvValueEntry = {
  key: string;
  value: string;
};

const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function decodeDoubleQuotedValue(raw: string): string {
  return raw.replace(/\\([\\nrt"$])/g, (_match, token: string) => {
    if (token === 'n') return '\n';
    if (token === 'r') return '\r';
    if (token === 't') return '\t';
    return token;
  });
}

export function normalizeEnvKey(raw: string): string {
  return String(raw ?? '').trim();
}

export function isValidEnvKey(raw: string): boolean {
  const key = normalizeEnvKey(raw);
  return Boolean(key) && ENV_KEY_RE.test(key);
}

export function createEnvDraftEntry(key = '', value = ''): EnvDraftEntry {
  return { id: makeId(), key, value };
}

export function envMapToDraftEntries(varsRaw: Record<string, string> | null | undefined): EnvDraftEntry[] {
  return Object.entries(varsRaw ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => createEnvDraftEntry(key, value));
}

export function envValueEntriesToMap(entriesRaw: EnvValueEntry[] | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of entriesRaw ?? []) {
    const key = normalizeEnvKey(entry?.key ?? '');
    if (!key || !isValidEnvKey(key)) continue;
    out[key] = String(entry?.value ?? '');
  }
  return out;
}

export function envValueEntriesToDraftEntries(entriesRaw: EnvValueEntry[] | null | undefined): EnvDraftEntry[] {
  return envMapToDraftEntries(envValueEntriesToMap(entriesRaw));
}

export function envDraftEntriesToMap(entries: EnvDraftEntry[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of entries) {
    const key = normalizeEnvKey(entry.key);
    if (!key || !isValidEnvKey(key)) continue;
    out[key] = String(entry.value ?? '');
  }
  return out;
}

export function validateEnvDraftEntries(entries: EnvDraftEntry[]): string | null {
  const seen = new Set<string>();
  for (const entry of entries) {
    const rawKey = String(entry.key ?? '');
    const key = normalizeEnvKey(rawKey);
    if (!key) continue;
    if (!isValidEnvKey(key)) {
      return `Invalid environment variable name: ${rawKey}`;
    }
    if (seen.has(key)) {
      return `Duplicate environment variable: ${key}`;
    }
    seen.add(key);
  }
  return null;
}

export function mergeImportedEnvIntoDraftEntries(entries: EnvDraftEntry[], incoming: Record<string, string>): EnvDraftEntry[] {
  const next = entries.map((entry) => ({ ...entry }));
  const indexByKey = new Map<string, number>();
  next.forEach((entry, index) => {
    const key = normalizeEnvKey(entry.key);
    if (!key || !isValidEnvKey(key)) return;
    indexByKey.set(key, index);
  });
  for (const [key, value] of Object.entries(incoming)) {
    const existingIndex = indexByKey.get(key);
    if (existingIndex == null) {
      next.push(createEnvDraftEntry(key, value));
      indexByKey.set(key, next.length - 1);
      continue;
    }
    next[existingIndex] = { ...next[existingIndex], value };
  }
  return next;
}

export function parseDotenvText(textRaw: string): {
  vars: Record<string, string>;
  warnings: string[];
} {
  const text = String(textRaw ?? '');
  const vars: Record<string, string> = {};
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((lineRaw, index) => {
    const line = String(lineRaw ?? '');
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const withoutExport = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed;
    const equalsIndex = withoutExport.indexOf('=');
    if (equalsIndex <= 0) {
      warnings.push(`Line ${index + 1} was ignored.`);
      return;
    }
    const key = normalizeEnvKey(withoutExport.slice(0, equalsIndex));
    if (!isValidEnvKey(key)) {
      warnings.push(`Line ${index + 1} has an invalid key.`);
      return;
    }
    let value = withoutExport.slice(equalsIndex + 1);
    if (value.startsWith('"')) {
      const closingIndex = value.lastIndexOf('"');
      value = closingIndex > 0 ? decodeDoubleQuotedValue(value.slice(1, closingIndex)) : decodeDoubleQuotedValue(value.slice(1));
    } else if (value.startsWith("'")) {
      const closingIndex = value.lastIndexOf("'");
      value = closingIndex > 0 ? value.slice(1, closingIndex) : value.slice(1);
    } else {
      value = value.replace(/\s+#.*$/, '');
    }
    vars[key] = value;
  });

  return { vars, warnings };
}
