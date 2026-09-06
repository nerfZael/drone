export type MobileFileReference = {
  raw: string;
  path: string;
  line: number | null;
  column: number | null;
};

export type MobileFileReferenceSegment =
  | { type: 'text'; text: string }
  | { type: 'file'; text: string; reference: MobileFileReference };

const COMMON_FILE_BASENAMES = new Set([
  'agents.md',
  'dockerfile',
  'gemfile',
  'license',
  'makefile',
  'procfile',
  'readme',
]);

function isLikelyFilePath(raw: string): boolean {
  const candidate = String(raw ?? '').trim();
  if (!candidate || /\s/.test(candidate) || candidate.includes('\0')) return false;
  if (candidate.startsWith('~')) return false;
  if (/^https?:\/\//i.test(candidate)) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(candidate)) return false;
  const normalized = candidate.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '..')) return false;
  const base = (segments.at(-1) ?? normalized).toLowerCase();
  return (
    COMMON_FILE_BASENAMES.has(base) || normalized.includes('/') || /\.[a-z0-9_-]{1,16}$/i.test(base)
  );
}

function positiveInteger(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function parseMobileFileReference(
  raw: string,
  explicitLink = false,
): MobileFileReference | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  let pathToken = text;
  if (explicitLink) {
    try {
      pathToken = decodeURIComponent(pathToken);
    } catch {
      return null;
    }
  }
  if (explicitLink && /^[a-z][a-z0-9+.-]*:/i.test(pathToken) && !/^[^:]+\.[^:]+:\d+(?::\d+)?$/.test(pathToken)) return null;
  let line: number | null = null;
  let column: number | null = null;

  const hashMatch = /^(.*)#L(\d+)(?:C(\d+))?$/i.exec(pathToken);
  if (hashMatch) {
    pathToken = String(hashMatch[1] ?? '').trim();
    line = positiveInteger(hashMatch[2]);
    column = positiveInteger(hashMatch[3]);
  } else {
    const lineSuffix = /:(\d+)(?::(\d+))?$/.exec(pathToken);
    if (lineSuffix && typeof lineSuffix.index === 'number') {
      const possiblePath = pathToken.slice(0, lineSuffix.index).trim();
      if (explicitLink || isLikelyFilePath(possiblePath)) {
        pathToken = possiblePath;
        line = positiveInteger(lineSuffix[1]);
        column = positiveInteger(lineSuffix[2]);
      }
    }
  }

  if (explicitLink) {
    pathToken = pathToken.split(/[?#]/, 1)[0];
    if (
      !pathToken ||
      pathToken.startsWith('~') ||
      /^[a-z][a-z0-9+.-]*:/i.test(pathToken) ||
      /[\0\r\n]/.test(pathToken) ||
      pathToken.startsWith('//')
    )
      return null;
    return { raw: text, path: pathToken.replace(/\\/g, '/'), line, column };
  }
  if (!isLikelyFilePath(pathToken)) return null;
  let normalizedPath = pathToken.trim().replace(/\\/g, '/');
  if (normalizedPath.startsWith('./')) normalizedPath = normalizedPath.slice(2);
  normalizedPath = normalizedPath.replace(/\/+/g, '/');
  if (normalizedPath.length > 1) normalizedPath = normalizedPath.replace(/\/+$/g, '');
  if (
    !normalizedPath ||
    normalizedPath === '/' ||
    normalizedPath.includes('/../') ||
    normalizedPath.startsWith('../') ||
    normalizedPath.startsWith('/..')
  ) {
    return null;
  }
  return { raw: text, path: normalizedPath, line, column };
}

const LOOSE_FILE_REFERENCE =
  /(?:\.{0,1}[\\/]|[A-Za-z0-9_@+-]+[\\/])?(?:[A-Za-z0-9_@.+-]+[\\/])+[A-Za-z0-9_@.+-]+(?:#L\d+(?:C\d+)?|:\d+(?::\d+)?)?|\b(?:AGENTS\.md|Dockerfile|Gemfile|LICENSE|Makefile|Procfile|README|[A-Za-z0-9_@+-]+\.[A-Za-z][A-Za-z0-9_-]{0,15})(?:#L\d+(?:C\d+)?|:\d+(?::\d+)?)?/gi;

export function splitMobileFileReferences(text: string): MobileFileReferenceSegment[] {
  const source = String(text ?? '');
  const segments: MobileFileReferenceSegment[] = [];
  let cursor = 0;
  for (const match of source.matchAll(LOOSE_FILE_REFERENCE)) {
    const value = match[0];
    const index = match.index ?? 0;
    const tokenStart =
      Math.max(
        source.lastIndexOf(' ', index - 1),
        source.lastIndexOf('\n', index - 1),
        source.lastIndexOf('\t', index - 1),
      ) + 1;
    const tokenPrefix = source.slice(tokenStart, index);
    if (/^[a-z][a-z0-9+.-]*:/i.test(`${tokenPrefix}${value}`)) continue;
    if (value.includes('@') && !/[\\/]/.test(value)) continue;
    const reference = parseMobileFileReference(value);
    if (!reference) continue;
    if (index > cursor) segments.push({ type: 'text', text: source.slice(cursor, index) });
    segments.push({ type: 'file', text: value, reference });
    cursor = index + value.length;
  }
  if (cursor < source.length) segments.push({ type: 'text', text: source.slice(cursor) });
  return segments.length > 0 ? segments : [{ type: 'text', text: source }];
}
