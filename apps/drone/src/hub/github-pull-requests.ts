import { spawn } from 'node:child_process';

export type GithubPullRequestListState = 'open' | 'closed' | 'all';
export type GithubPullRequestMergeMethod = 'merge' | 'squash' | 'rebase';
export type GithubPullRequestChecksState = 'success' | 'failing' | 'pending' | 'unknown';
export type GithubPullRequestReviewState = 'approved' | 'changes_requested' | 'review_required' | 'unknown';

export type GithubRepoRef = {
  owner: string;
  repo: string;
};

export type GithubRepoResolutionDebug = {
  remoteUrl: string | null;
  parsedRepo: GithubRepoRef | null;
};

export type GithubPullRequestSummary = {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  headRefName: string;
  headLabel: string;
  baseRefName: string;
  isCrossRepository: boolean;
  checksState: GithubPullRequestChecksState;
  reviewState: GithubPullRequestReviewState;
  hasMergeConflicts: boolean;
};

type GithubPullRequestFileStatusType = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'type-changed' | 'unmerged' | 'unknown';

export type GithubPullRequestFileChange = {
  path: string;
  originalPath: string | null;
  statusChar: string;
  statusType: GithubPullRequestFileStatusType;
  additions: number;
  deletions: number;
  changes: number;
  patch: string | null;
  truncated: boolean;
  isBinary: boolean;
};

export type GithubPullRequestChanges = {
  repo: GithubRepoRef;
  pullRequest: {
    number: number;
    title: string;
    htmlUrl: string | null;
    baseRefName: string;
    headRefName: string;
    baseSha: string;
    headSha: string;
  };
  counts: {
    changed: number;
    additions: number;
    deletions: number;
  };
  entries: GithubPullRequestFileChange[];
};

export class GithubPullRequestError extends Error {
  statusCode: number;
  code: string | null;

  constructor(message: string, opts?: { statusCode?: number; code?: string | null }) {
    super(String(message ?? 'GitHub pull request operation failed'));
    this.name = 'GithubPullRequestError';
    this.statusCode = Number.isFinite(opts?.statusCode) ? Math.max(400, Math.floor(opts?.statusCode ?? 500)) : 500;
    this.code = opts?.code ? String(opts.code) : null;
  }
}

export function isGithubPullRequestError(err: unknown): err is GithubPullRequestError {
  return err instanceof GithubPullRequestError;
}

export function normalizeGithubPullRequestListState(
  raw: unknown,
  fallback: GithubPullRequestListState = 'open',
): GithubPullRequestListState {
  const state = String(raw ?? '').trim().toLowerCase();
  if (state === 'closed') return 'closed';
  if (state === 'all') return 'all';
  if (state === 'open') return 'open';
  return fallback;
}

export function normalizeGithubPullRequestMergeMethod(
  raw: unknown,
  fallback: GithubPullRequestMergeMethod = 'merge',
): GithubPullRequestMergeMethod {
  const method = String(raw ?? '').trim().toLowerCase();
  if (method === 'squash') return 'squash';
  if (method === 'rebase') return 'rebase';
  if (method === 'merge') return 'merge';
  return fallback;
}

type LocalCommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

async function runLocal(cmd: string, args: string[], opts?: { cwd?: string }): Promise<LocalCommandResult> {
  return await new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: opts?.cwd,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d) => (stderr += d.toString('utf8')));
    child.once('error', (err: any) => resolve({ code: 127, stdout, stderr: `${stderr}${err?.message ?? String(err)}` }));
    child.once('close', (code) => resolve({ code: typeof code === 'number' ? code : 1, stdout, stderr }));
  });
}

async function gitBestRemoteUrl(repoRoot: string): Promise<string | null> {
  const origin = await runLocal('git', ['-C', repoRoot, 'remote', 'get-url', 'origin']);
  const originUrl = String(origin.stdout ?? '').trim();
  if (origin.code === 0 && originUrl) return originUrl;

  const remotes = await runLocal('git', ['-C', repoRoot, 'remote', '-v']);
  const lines = String(remotes.stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    const parts = line.split(/\s+/g);
    const url = parts[1] ? String(parts[1]).trim() : '';
    if (url) return url;
  }
  return null;
}

function parseGithubSlug(remoteUrl: string | null): GithubRepoRef | null {
  const value = String(remoteUrl ?? '').trim();
  if (!value) return null;
  const m =
    value.match(/github\.com[:/](?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?$/i) ??
    value.match(/^https?:\/\/github\.com\/(?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?$/i);
  const owner = (m as any)?.groups?.owner ? String((m as any).groups.owner).trim() : '';
  const repo = (m as any)?.groups?.repo ? String((m as any).groups.repo).trim() : '';
  if (!owner || !repo) return null;
  return { owner, repo };
}

async function resolveGithubRepoForRepoRoot(repoRoot: string): Promise<GithubRepoRef> {
  const remoteUrl = await gitBestRemoteUrl(repoRoot);
  const github = parseGithubSlug(remoteUrl);
  if (!github) {
    throw new GithubPullRequestError(
      'This repo does not have a GitHub remote. Configure an origin like github.com/owner/repo to manage pull requests.',
      {
        statusCode: 412,
        code: 'github_repo_unresolved',
      },
    );
  }
  return github;
}

export async function inspectGithubRepoForRepoRoot(repoRootRaw: string): Promise<GithubRepoResolutionDebug> {
  const repoRoot = String(repoRootRaw ?? '').trim();
  if (!repoRoot) return { remoteUrl: null, parsedRepo: null };
  const remoteUrl = await gitBestRemoteUrl(repoRoot);
  return {
    remoteUrl,
    parsedRepo: parseGithubSlug(remoteUrl),
  };
}

const GITHUB_TOKEN_ENV_KEYS = ['DRONE_HUB_GITHUB_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN'] as const;

async function resolveGithubToken(): Promise<string | null> {
  for (const key of GITHUB_TOKEN_ENV_KEYS) {
    const raw = String(process.env[key] ?? '').trim();
    if (raw) return raw;
  }
  const gh = await runLocal('gh', ['auth', 'token']);
  if (gh.code !== 0) return null;
  const token = String(gh.stdout ?? '').trim();
  return token || null;
}

function githubAuthRequiredError(): GithubPullRequestError {
  return new GithubPullRequestError(
    'GitHub authentication is required. Set DRONE_HUB_GITHUB_TOKEN (or GITHUB_TOKEN / GH_TOKEN), or run gh auth login.',
    {
      statusCode: 412,
      code: 'github_token_missing',
    },
  );
}

function parseGithubApiErrorMessage(status: number, statusText: string, parsedBody: any): string {
  const base = `${status} ${statusText || 'GitHub API error'}`.trim();
  const message = typeof parsedBody?.message === 'string' ? parsedBody.message.trim() : '';
  if (!message) return base;
  const firstError = Array.isArray(parsedBody?.errors) && parsedBody.errors.length > 0 ? parsedBody.errors[0] : null;
  const details =
    typeof firstError?.message === 'string'
      ? firstError.message.trim()
      : typeof firstError?.code === 'string'
        ? firstError.code.trim()
        : '';
  if (details && !message.toLowerCase().includes(details.toLowerCase())) return `${message} (${details})`;
  return message;
}

async function githubApiRequest<T>(opts: {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
  path: string;
  token?: string | null;
  body?: unknown;
}): Promise<T> {
  const method = opts.method ?? 'GET';
  const token = String(opts.token ?? '').trim();
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'drone-hub',
  };
  if (token) headers.authorization = `Bearer ${token}`;
  if (opts.body != null) headers['content-type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(`https://api.github.com${opts.path}`, {
      method,
      headers,
      body: opts.body != null ? JSON.stringify(opts.body) : undefined,
    });
  } catch (error: any) {
    throw new GithubPullRequestError(`Failed reaching GitHub API: ${error?.message ?? String(error)}`, {
      statusCode: 502,
      code: 'github_request_failed',
    });
  }

  const text = await response.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    if (!token && (response.status === 401 || response.status === 403)) {
      throw githubAuthRequiredError();
    }
    throw new GithubPullRequestError(parseGithubApiErrorMessage(response.status, response.statusText, parsed), {
      statusCode: response.status,
      code: 'github_api_error',
    });
  }

  return parsed as T;
}

async function githubGraphqlRequest<T>(opts: {
  query: string;
  variables: Record<string, unknown>;
  token?: string | null;
}): Promise<T> {
  const token = String(opts.token ?? '').trim();
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'drone-hub',
    'content-type': 'application/json',
  };
  if (token) headers.authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: opts.query,
        variables: opts.variables,
      }),
    });
  } catch (error: any) {
    throw new GithubPullRequestError(`Failed reaching GitHub GraphQL API: ${error?.message ?? String(error)}`, {
      statusCode: 502,
      code: 'github_request_failed',
    });
  }

  const text = await response.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    if (!token && (response.status === 401 || response.status === 403)) throw githubAuthRequiredError();
    throw new GithubPullRequestError(parseGithubApiErrorMessage(response.status, response.statusText, parsed), {
      statusCode: response.status,
      code: 'github_api_error',
    });
  }

  if (Array.isArray(parsed?.errors) && parsed.errors.length > 0) {
    const first = parsed.errors[0];
    const msg = typeof first?.message === 'string' ? first.message.trim() : 'GitHub GraphQL query failed';
    throw new GithubPullRequestError(msg || 'GitHub GraphQL query failed', {
      statusCode: 502,
      code: 'github_graphql_error',
    });
  }

  return parsed as T;
}

function checksStateFromRaw(raw: unknown): GithubPullRequestChecksState {
  const value = String(raw ?? '').trim().toUpperCase();
  if (value === 'SUCCESS') return 'success';
  if (value === 'FAILURE' || value === 'ERROR' || value === 'STARTUP_FAILURE' || value === 'TIMED_OUT' || value === 'ACTION_REQUIRED') {
    return 'failing';
  }
  if (value === 'PENDING' || value === 'EXPECTED' || value === 'IN_PROGRESS' || value === 'QUEUED' || value === 'WAITING' || value === 'REQUESTED') {
    return 'pending';
  }
  return 'unknown';
}

function reviewStateFromRaw(raw: unknown): GithubPullRequestReviewState {
  const value = String(raw ?? '').trim().toUpperCase();
  if (value === 'APPROVED') return 'approved';
  if (value === 'CHANGES_REQUESTED') return 'changes_requested';
  if (value === 'REVIEW_REQUIRED') return 'review_required';
  return 'unknown';
}

function mapGithubPullRequest(raw: any): GithubPullRequestSummary | null {
  const number = Number(raw?.number);
  if (!Number.isFinite(number) || number <= 0) return null;
  const title = String(raw?.title ?? '').trim() || `PR #${number}`;
  const state = String(raw?.state ?? '').trim() || 'open';
  const htmlUrl = String(raw?.html_url ?? '').trim();
  const createdAt = String(raw?.created_at ?? '').trim();
  const updatedAt = String(raw?.updated_at ?? '').trim();
  const authorLogin = raw?.user?.login ? String(raw.user.login).trim() : null;
  const authorAvatarUrl = raw?.user?.avatar_url ? String(raw.user.avatar_url).trim() : null;
  const headRefName = String(raw?.head?.ref ?? '').trim();
  const headLabel = String(raw?.head?.label ?? '').trim();
  const baseRefName = String(raw?.base?.ref ?? '').trim();
  const headRepoFull = String(raw?.head?.repo?.full_name ?? '').trim().toLowerCase();
  const baseRepoFull = String(raw?.base?.repo?.full_name ?? '').trim().toLowerCase();

  return {
    number: Math.floor(number),
    title,
    state,
    draft: Boolean(raw?.draft),
    htmlUrl,
    createdAt,
    updatedAt,
    authorLogin,
    authorAvatarUrl,
    headRefName,
    headLabel,
    baseRefName,
    isCrossRepository: Boolean(headRepoFull && baseRepoFull && headRepoFull !== baseRepoFull),
    checksState: 'unknown',
    reviewState: 'unknown',
    hasMergeConflicts: false,
  };
}

function mapGithubPullRequestFromGraphql(raw: any, owner: string): GithubPullRequestSummary | null {
  const number = Number(raw?.number);
  if (!Number.isFinite(number) || number <= 0) return null;
  const title = String(raw?.title ?? '').trim() || `PR #${number}`;
  const state = String(raw?.state ?? '').trim() || 'OPEN';
  const htmlUrl = String(raw?.url ?? '').trim();
  const createdAt = String(raw?.createdAt ?? '').trim();
  const updatedAt = String(raw?.updatedAt ?? '').trim();
  const authorLogin = raw?.author?.login ? String(raw.author.login).trim() : null;
  const authorAvatarUrl = raw?.author?.avatarUrl ? String(raw.author.avatarUrl).trim() : null;
  const headRefName = String(raw?.headRefName ?? '').trim();
  const baseRefName = String(raw?.baseRefName ?? '').trim();
  const headOwner = String(raw?.headRepositoryOwner?.login ?? '').trim();
  const ownerLower = String(owner ?? '').trim().toLowerCase();
  const headOwnerLower = headOwner.toLowerCase();
  const headLabel = headOwner ? `${headOwner}:${headRefName}` : headRefName;
  const rollupState = raw?.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state;
  const checksState = checksStateFromRaw(rollupState);
  const reviewState = reviewStateFromRaw(raw?.reviewDecision);
  const hasMergeConflicts = String(raw?.mergeStateStatus ?? '').trim().toUpperCase() === 'DIRTY';

  return {
    number: Math.floor(number),
    title,
    state: state.toLowerCase(),
    draft: Boolean(raw?.isDraft),
    htmlUrl,
    createdAt,
    updatedAt,
    authorLogin,
    authorAvatarUrl,
    headRefName,
    headLabel,
    baseRefName,
    isCrossRepository: Boolean(headOwnerLower && ownerLower && headOwnerLower !== ownerLower),
    checksState,
    reviewState,
    hasMergeConflicts,
  };
}

function mapGithubFileStatus(raw: unknown): { statusChar: string; statusType: GithubPullRequestFileStatusType } {
  const status = String(raw ?? '').trim().toLowerCase();
  switch (status) {
    case 'added':
      return { statusChar: 'A', statusType: 'added' };
    case 'removed':
      return { statusChar: 'D', statusType: 'deleted' };
    case 'modified':
      return { statusChar: 'M', statusType: 'modified' };
    case 'renamed':
      return { statusChar: 'R', statusType: 'renamed' };
    case 'copied':
      return { statusChar: 'C', statusType: 'copied' };
    case 'changed':
      return { statusChar: 'T', statusType: 'type-changed' };
    case 'unchanged':
      return { statusChar: '.', statusType: 'unknown' };
    default:
      return { statusChar: '?', statusType: 'unknown' };
  }
}

function buildGithubPullRequestUnifiedDiff(raw: any): { patch: string | null; truncated: boolean; isBinary: boolean } {
  const status = String(raw?.status ?? '').trim().toLowerCase();
  const filePath = String(raw?.filename ?? '').trim();
  const previousPath = String(raw?.previous_filename ?? '').trim();
  const patchBody = typeof raw?.patch === 'string' ? String(raw.patch) : '';
  const hasPatch = Boolean(patchBody.trim());
  const isBinary = !hasPatch;
  const truncated = !hasPatch && Number(raw?.changes ?? 0) > 0;
  if (!filePath || !hasPatch) return { patch: null, truncated, isBinary };

  const fromPath = previousPath || filePath;
  const oldLabel = status === 'added' ? '/dev/null' : `a/${fromPath}`;
  const newLabel = status === 'removed' ? '/dev/null' : `b/${filePath}`;
  const header = [`diff --git a/${fromPath} b/${filePath}`, `--- ${oldLabel}`, `+++ ${newLabel}`].join('\n');
  const normalizedBody = patchBody.endsWith('\n') ? patchBody : `${patchBody}\n`;
  return {
    patch: `${header}\n${normalizedBody}`,
    truncated,
    isBinary,
  };
}

function assertValidPullNumber(pullNumberRaw: number): number {
  const pullNumber = Number(pullNumberRaw);
  if (!Number.isFinite(pullNumber) || pullNumber <= 0 || Math.floor(pullNumber) !== pullNumber) {
    throw new GithubPullRequestError('invalid pull request number', { statusCode: 400, code: 'invalid_pull_number' });
  }
  return pullNumber;
}

function graphqlStatesForListState(state: GithubPullRequestListState): string[] {
  if (state === 'closed') return ['CLOSED'];
  if (state === 'all') return ['OPEN', 'CLOSED'];
  return ['OPEN'];
}

async function listGithubPullRequestsViaGraphql(opts: {
  repo: GithubRepoRef;
  state: GithubPullRequestListState;
  token: string;
}): Promise<GithubPullRequestSummary[]> {
  const graphql = await githubGraphqlRequest<{
    data?: {
      repository?: {
        pullRequests?: {
          nodes?: any[];
        };
      } | null;
    };
  }>({
    token: opts.token,
    query: `
      query PullRequestList($owner: String!, $repo: String!, $states: [PullRequestState!], $first: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequests(states: $states, first: $first, orderBy: { field: UPDATED_AT, direction: DESC }) {
            nodes {
              number
              title
              state
              isDraft
              url
              createdAt
              updatedAt
              author {
                login
                avatarUrl
              }
              headRefName
              headRepositoryOwner {
                login
              }
              baseRefName
              mergeStateStatus
              reviewDecision
              commits(last: 1) {
                nodes {
                  commit {
                    statusCheckRollup {
                      state
                    }
                  }
                }
              }
            }
          }
        }
      }
    `,
    variables: {
      owner: opts.repo.owner,
      repo: opts.repo.repo,
      states: graphqlStatesForListState(opts.state),
      first: 100,
    },
  });

  const nodes = Array.isArray(graphql?.data?.repository?.pullRequests?.nodes) ? graphql.data?.repository?.pullRequests?.nodes : [];
  return nodes
    .map((row) => mapGithubPullRequestFromGraphql(row, opts.repo.owner))
    .filter((row): row is GithubPullRequestSummary => row != null)
    .sort((a, b) => {
      const aTime = Date.parse(a.updatedAt);
      const bTime = Date.parse(b.updatedAt);
      if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return bTime - aTime;
      return b.number - a.number;
    });
}

export async function listGithubPullRequestsForRepoRoot(opts: {
  repoRoot: string;
  state?: GithubPullRequestListState;
}): Promise<{ repo: GithubRepoRef; pullRequests: GithubPullRequestSummary[] }> {
  const repoRoot = String(opts.repoRoot ?? '').trim();
  if (!repoRoot) throw new GithubPullRequestError('missing repo root', { statusCode: 400 });
  const repo = await resolveGithubRepoForRepoRoot(repoRoot);
  const token = await resolveGithubToken();
  const state = normalizeGithubPullRequestListState(opts.state, 'open');

  let pullRequests: GithubPullRequestSummary[] = [];
  let usedGraphql = false;
  if (token) {
    try {
      pullRequests = await listGithubPullRequestsViaGraphql({ repo, state, token });
      usedGraphql = true;
    } catch {
      // Fall back to REST list. Badges may be less complete when GraphQL fields are unavailable.
    }
  }

  if (!usedGraphql) {
    const rows = await githubApiRequest<any[]>({
      path: `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/pulls?state=${encodeURIComponent(
        state,
      )}&sort=updated&direction=desc&per_page=100`,
      method: 'GET',
      token,
    });
    pullRequests = Array.isArray(rows)
      ? rows
          .map((row) => mapGithubPullRequest(row))
          .filter((row): row is GithubPullRequestSummary => row != null)
          .sort((a, b) => {
            const aTime = Date.parse(a.updatedAt);
            const bTime = Date.parse(b.updatedAt);
            if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return bTime - aTime;
            return b.number - a.number;
          })
      : [];
  }

  return { repo, pullRequests };
}

async function listGithubPullRequestFiles(opts: {
  repo: GithubRepoRef;
  pullNumber: number;
  token: string | null;
}): Promise<any[]> {
  const out: any[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const rows = await githubApiRequest<any[]>({
      path: `/repos/${encodeURIComponent(opts.repo.owner)}/${encodeURIComponent(opts.repo.repo)}/pulls/${opts.pullNumber}/files?per_page=100&page=${page}`,
      method: 'GET',
      token: opts.token,
    });
    const list = Array.isArray(rows) ? rows : [];
    if (list.length === 0) break;
    out.push(...list);
    if (list.length < 100) break;
  }
  return out;
}

export async function listGithubPullRequestChangesForRepoRoot(opts: {
  repoRoot: string;
  pullNumber: number;
}): Promise<GithubPullRequestChanges> {
  const repoRoot = String(opts.repoRoot ?? '').trim();
  if (!repoRoot) throw new GithubPullRequestError('missing repo root', { statusCode: 400 });
  const pullNumber = assertValidPullNumber(opts.pullNumber);
  const repo = await resolveGithubRepoForRepoRoot(repoRoot);
  const token = await resolveGithubToken();

  const pull = await githubApiRequest<{
    number?: number;
    title?: string;
    html_url?: string | null;
    base?: { ref?: string; sha?: string };
    head?: { ref?: string; sha?: string };
  }>({
    method: 'GET',
    path: `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/pulls/${pullNumber}`,
    token,
  });

  const files = await listGithubPullRequestFiles({ repo, pullNumber, token });
  const entries: GithubPullRequestFileChange[] = files
    .map((row) => {
      const pathText = String(row?.filename ?? '').trim();
      if (!pathText) return null;
      const originalPathRaw = String(row?.previous_filename ?? '').trim();
      const status = mapGithubFileStatus(row?.status);
      const patch = buildGithubPullRequestUnifiedDiff(row);
      return {
        path: pathText,
        originalPath: originalPathRaw || null,
        statusChar: status.statusChar,
        statusType: status.statusType,
        additions: Math.max(0, Math.floor(Number(row?.additions ?? 0) || 0)),
        deletions: Math.max(0, Math.floor(Number(row?.deletions ?? 0) || 0)),
        changes: Math.max(0, Math.floor(Number(row?.changes ?? 0) || 0)),
        patch: patch.patch,
        truncated: patch.truncated,
        isBinary: patch.isBinary,
      };
    })
    .filter((row): row is GithubPullRequestFileChange => row != null);

  const additions = entries.reduce((sum, row) => sum + Math.max(0, Number(row.additions) || 0), 0);
  const deletions = entries.reduce((sum, row) => sum + Math.max(0, Number(row.deletions) || 0), 0);

  return {
    repo,
    pullRequest: {
      number: pullNumber,
      title: String(pull?.title ?? '').trim() || `PR #${pullNumber}`,
      htmlUrl: pull?.html_url ? String(pull.html_url).trim() : null,
      baseRefName: String(pull?.base?.ref ?? '').trim(),
      headRefName: String(pull?.head?.ref ?? '').trim(),
      baseSha: String(pull?.base?.sha ?? '').trim().toLowerCase(),
      headSha: String(pull?.head?.sha ?? '').trim().toLowerCase(),
    },
    counts: {
      changed: entries.length,
      additions,
      deletions,
    },
    entries,
  };
}

export async function mergeGithubPullRequestForRepoRoot(opts: {
  repoRoot: string;
  pullNumber: number;
  method?: GithubPullRequestMergeMethod;
}): Promise<{ repo: GithubRepoRef; number: number; merged: boolean; message: string; sha: string | null }> {
  const repoRoot = String(opts.repoRoot ?? '').trim();
  if (!repoRoot) throw new GithubPullRequestError('missing repo root', { statusCode: 400 });
  const pullNumber = assertValidPullNumber(opts.pullNumber);
  const repo = await resolveGithubRepoForRepoRoot(repoRoot);
  const token = await resolveGithubToken();
  if (!token) throw githubAuthRequiredError();
  const method = normalizeGithubPullRequestMergeMethod(opts.method, 'merge');

  const merged = await githubApiRequest<{ merged?: boolean; message?: string; sha?: string | null }>({
    method: 'PUT',
    path: `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/pulls/${pullNumber}/merge`,
    token,
    body: { merge_method: method },
  });
  return {
    repo,
    number: pullNumber,
    merged: Boolean(merged?.merged),
    message: String(merged?.message ?? '').trim() || 'Merged',
    sha: merged?.sha ? String(merged.sha).trim() : null,
  };
}

export async function closeGithubPullRequestForRepoRoot(opts: {
  repoRoot: string;
  pullNumber: number;
}): Promise<{ repo: GithubRepoRef; number: number; state: string; htmlUrl: string | null; title: string }> {
  const repoRoot = String(opts.repoRoot ?? '').trim();
  if (!repoRoot) throw new GithubPullRequestError('missing repo root', { statusCode: 400 });
  const pullNumber = assertValidPullNumber(opts.pullNumber);
  const repo = await resolveGithubRepoForRepoRoot(repoRoot);
  const token = await resolveGithubToken();
  if (!token) throw githubAuthRequiredError();

  const closed = await githubApiRequest<{
    number?: number;
    state?: string;
    html_url?: string;
    title?: string;
  }>({
    method: 'PATCH',
    path: `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/pulls/${pullNumber}`,
    token,
    body: { state: 'closed' },
  });

  return {
    repo,
    number: Number.isFinite(Number(closed?.number)) ? Math.max(1, Math.floor(Number(closed?.number))) : pullNumber,
    state: String(closed?.state ?? '').trim() || 'closed',
    htmlUrl: closed?.html_url ? String(closed.html_url).trim() : null,
    title: String(closed?.title ?? '').trim() || `PR #${pullNumber}`,
  };
}
