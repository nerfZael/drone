import { useMutation, useQuery, type QueryKey } from '@tanstack/react-query';

export type SettingsRequestJson = <T>(url: string, init?: RequestInit) => Promise<T>;
type SettingsQueryStatus = { error: Error | null; isFetching: boolean };

export const settingsQueryKey = (...parts: ReadonlyArray<unknown>): QueryKey => ['settings', ...parts];

export function useSettingsQuery<T>(
  requestJson: SettingsRequestJson,
  queryKey: QueryKey,
  url: string,
  enabled = true,
) {
  return useQuery<T, Error>({
    queryKey,
    queryFn: ({ signal }) => requestJson<T>(url, { signal }),
    enabled,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
}

export function useSettingsPostMutation<TData, TBody>(requestJson: SettingsRequestJson, url: string) {
  return useMutation<TData, Error, TBody>({
    mutationFn: (body) =>
      requestJson<TData>(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
  });
}

export function settingsQueryError(
  localError: string | null,
  dismissed: boolean,
  ...queries: SettingsQueryStatus[]
): string | null {
  if (localError || dismissed || queries.some((query) => query.isFetching)) return localError;
  return queries.find((query) => query.error)?.error?.message ?? null;
}

export const settingsErrorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);
