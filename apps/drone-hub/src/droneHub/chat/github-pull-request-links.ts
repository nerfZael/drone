export type GithubPullRequestLink = {
  owner: string;
  repo: string;
  pullNumber: number;
  href: string;
};

export function parseGithubPullRequestHref(hrefRaw: string): GithubPullRequestLink | null {
  const href = String(hrefRaw ?? '').trim();
  if (!href) return null;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || String(url.hostname || '').toLowerCase() !== 'github.com') return null;
  const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/i.exec(String(url.pathname ?? '').trim());
  if (!match) return null;
  const owner = String(match[1] ?? '').trim().toLowerCase();
  const repo = String(match[2] ?? '').trim().toLowerCase();
  const pullNumber = Number(match[3]);
  if (!owner || !repo || !Number.isFinite(pullNumber) || pullNumber <= 0) return null;
  const normalizedPullNumber = Math.floor(pullNumber);
  return {
    owner,
    repo,
    pullNumber: normalizedPullNumber,
    href: `https://github.com/${owner}/${repo}/pull/${normalizedPullNumber}`,
  };
}

export function extractGithubPullRequestLinks(textRaw: string, limit = 3): GithubPullRequestLink[] {
  const text = String(textRaw ?? '');
  if (!text) return [];
  const maxLinks = Math.max(1, Math.floor(limit));
  const links: GithubPullRequestLink[] = [];
  const seen = new Set<string>();
  const candidates = text.match(/https:\/\/github\.com\/[^\s<>"']+/gi) ?? [];

  for (const candidateRaw of candidates) {
    const candidate = candidateRaw.replace(/[),.;:!?\]}]+$/g, '');
    const parsed = parseGithubPullRequestHref(candidate);
    if (!parsed) continue;
    const key = `${parsed.owner}/${parsed.repo}#${parsed.pullNumber}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(parsed);
    if (links.length >= maxLinks) break;
  }

  return links;
}
