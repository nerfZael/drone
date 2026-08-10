import { listCanonicalRepositories } from '../groups-repositories';

export async function listRepositories(): Promise<{
  ok: true;
  repos: Array<{
    path: string;
    addedAt: string | null;
    remoteUrl: string | null;
    github: unknown;
  }>;
  count: number;
}> {
  const repos = (await listCanonicalRepositories()).map((repo) => ({
    path: repo.path,
    addedAt: repo.addedAt ?? null,
    remoteUrl: repo.remoteUrl ?? null,
    github: repo.github ?? null,
  }));
  return { ok: true, repos, count: repos.length };
}
