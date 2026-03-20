export type MarkdownPreviewLinkTarget = {
  path: string;
  line: number | null;
  column: number | null;
};

function parsePositiveInt(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function isExternalHref(rawHref: string): boolean {
  const href = String(rawHref ?? '').trim();
  if (!href) return false;
  if (/^https?:\/\//i.test(href)) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return true;
  return false;
}

function normalizeResolvedPath(rawPath: string): string | null {
  const normalized = String(rawPath ?? '').trim().replace(/\\/g, '/');
  if (!normalized) return null;

  const absolute = normalized.startsWith('/');
  const stack: string[] = [];
  const segments = (absolute ? normalized.slice(1) : normalized).split('/');
  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (stack.length === 0) return null;
      stack.pop();
      continue;
    }
    stack.push(segment);
  }

  return `/${stack.join('/')}`;
}

export function resolveMarkdownPreviewLinkTarget(baseFilePath: string, rawHref: string): MarkdownPreviewLinkTarget | null {
  const href = String(rawHref ?? '').trim();
  const basePath = String(baseFilePath ?? '').trim().replace(/\\/g, '/');
  if (!href || !basePath || href.startsWith('#') || isExternalHref(href)) return null;

  let pathToken = href;
  let line: number | null = null;
  let column: number | null = null;

  const lineAnchorMatch = /^(.*)#L(\d+)(?:C(\d+))?$/i.exec(pathToken);
  if (lineAnchorMatch) {
    pathToken = String(lineAnchorMatch[1] ?? '').trim();
    line = parsePositiveInt(lineAnchorMatch[2]);
    column = parsePositiveInt(lineAnchorMatch[3]);
  } else {
    const hashIndex = pathToken.indexOf('#');
    if (hashIndex >= 0) pathToken = pathToken.slice(0, hashIndex);
  }

  const queryIndex = pathToken.indexOf('?');
  if (queryIndex >= 0) pathToken = pathToken.slice(0, queryIndex);

  const lineSuffixMatch = /:(\d+)(?::(\d+))?$/.exec(pathToken);
  if (lineSuffixMatch && typeof lineSuffixMatch.index === 'number') {
    const maybePath = pathToken.slice(0, lineSuffixMatch.index).trim();
    if (maybePath) {
      pathToken = maybePath;
      line = parsePositiveInt(lineSuffixMatch[1]);
      column = parsePositiveInt(lineSuffixMatch[2]);
    }
  }

  if (!pathToken) return null;
  const baseDir = basePath.includes('/') ? basePath.slice(0, basePath.lastIndexOf('/')) || '/' : '/';
  const combinedPath = pathToken.startsWith('/') ? pathToken : `${baseDir}/${pathToken}`;
  const resolvedPath = normalizeResolvedPath(combinedPath);
  if (!resolvedPath || resolvedPath === '/') return null;

  return {
    path: resolvedPath,
    line,
    column,
  };
}
