import React from 'react';
import type { RepoBranchesPayload, RepoRemoteBranchOption } from '../types';

type RequestJson = <T>(url: string, init?: RequestInit) => Promise<T>;

export type RepoBranchOptionsState = {
  loading: boolean;
  error: string | null;
  repoRoot: string | null;
  hostBranch: string | null;
  remoteBranches: RepoRemoteBranchOption[];
};

type UseRepoBranchOptionsArgs = {
  repoPaths: string[];
  requestJson: RequestJson;
};

const EMPTY_STATE: RepoBranchOptionsState = {
  loading: false,
  error: null,
  repoRoot: null,
  hostBranch: null,
  remoteBranches: [],
};

export function useRepoBranchOptions({ repoPaths, requestJson }: UseRepoBranchOptionsArgs): Record<string, RepoBranchOptionsState> {
  const [byPath, setByPath] = React.useState<Record<string, RepoBranchOptionsState>>({});
  const inflightRef = React.useRef(new Set<string>());

  React.useEffect(() => {
    const targets = Array.from(
      new Set(
        repoPaths
          .map((value) => String(value ?? '').trim())
          .filter(Boolean),
      ),
    );
    for (const repoPath of targets) {
      if (inflightRef.current.has(repoPath)) continue;
      if (Object.prototype.hasOwnProperty.call(byPath, repoPath)) continue;
      inflightRef.current.add(repoPath);
      setByPath((current) => ({
        ...current,
        [repoPath]: {
          ...(current[repoPath] ?? EMPTY_STATE),
          loading: true,
          error: null,
        },
      }));
      void requestJson<RepoBranchesPayload>(`/api/repos/branches?repoPath=${encodeURIComponent(repoPath)}`)
        .then((data) => {
          if (!data || data.ok !== true) {
            throw new Error(String((data as any)?.error ?? 'Failed loading repo branches.'));
          }
          setByPath((current) => ({
            ...current,
            [repoPath]: {
              loading: false,
              error: null,
              repoRoot: String(data.repoRoot ?? '').trim() || repoPath,
              hostBranch: String(data.hostBranch ?? '').trim() || null,
              remoteBranches: Array.isArray(data.remoteBranches) ? data.remoteBranches : [],
            },
          }));
        })
        .catch((error: any) => {
          setByPath((current) => ({
            ...current,
            [repoPath]: {
              ...(current[repoPath] ?? EMPTY_STATE),
              loading: false,
              error: String(error?.message ?? error ?? 'Failed loading repo branches.').trim() || 'Failed loading repo branches.',
            },
          }));
        })
        .finally(() => {
          inflightRef.current.delete(repoPath);
        });
    }
  }, [byPath, repoPaths, requestJson]);

  return byPath;
}
