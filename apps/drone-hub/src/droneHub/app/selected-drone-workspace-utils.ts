export function editorLanguageForPath(filePath: string): string {
  const lower = String(filePath ?? '').trim().toLowerCase();
  const seg = lower.split('/').pop() ?? lower;
  if (seg === 'dockerfile') return 'dockerfile';
  if (seg === 'makefile') return 'makefile';
  if (seg.endsWith('.ts')) return 'typescript';
  if (seg.endsWith('.tsx')) return 'typescript';
  if (seg.endsWith('.js')) return 'javascript';
  if (seg.endsWith('.jsx')) return 'javascript';
  if (seg.endsWith('.json')) return 'json';
  if (seg.endsWith('.md')) return 'markdown';
  if (seg.endsWith('.py')) return 'python';
  if (seg.endsWith('.go')) return 'go';
  if (seg.endsWith('.rs')) return 'rust';
  if (seg.endsWith('.sh') || seg.endsWith('.bash') || seg.endsWith('.zsh')) return 'shell';
  if (seg.endsWith('.yml') || seg.endsWith('.yaml')) return 'yaml';
  if (seg.endsWith('.xml')) return 'xml';
  if (seg.endsWith('.html') || seg.endsWith('.htm')) return 'html';
  if (seg.endsWith('.css')) return 'css';
  if (seg.endsWith('.scss')) return 'scss';
  return 'plaintext';
}

export function formatEditorMtime(mtimeMs: number | null): string {
  if (typeof mtimeMs !== 'number' || !Number.isFinite(mtimeMs) || mtimeMs <= 0) return 'Unknown';
  try {
    return new Date(mtimeMs).toLocaleString();
  } catch {
    return 'Unknown';
  }
}

export function formatBytes(value: number | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return '-';
  if (n < 1024) return `${Math.floor(n)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let idx = 0;
  while (v >= 1024 && idx < units.length - 1) {
    v /= 1024;
    idx += 1;
  }
  const precision = v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(precision)} ${units[idx]}`;
}

export function parseIsoMs(raw: string | null | undefined): number {
  const ms = Date.parse(String(raw ?? ''));
  return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
}

export function parseGithubPullRequestHref(
  hrefRaw: string,
): { owner: string; repo: string; pullNumber: number } | null {
  const href = String(hrefRaw ?? '').trim();
  if (!href) return null;
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || String(u.hostname || '').toLowerCase() !== 'github.com') return null;
  const m = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/i.exec(String(u.pathname ?? '').trim());
  if (!m) return null;
  const owner = String(m[1] ?? '').trim().toLowerCase();
  const repo = String(m[2] ?? '').trim().toLowerCase();
  const pullNumber = Number(m[3]);
  if (!owner || !repo || !Number.isFinite(pullNumber) || pullNumber <= 0) return null;
  return { owner, repo, pullNumber: Math.floor(pullNumber) };
}
