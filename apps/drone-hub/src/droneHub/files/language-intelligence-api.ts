import { requestJson } from '../http';

export type LanguageLocation = {
  path: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  name?: string | null;
  preview?: string | null;
};

export type LanguageDefinitionPayload =
  | { ok: true; id: string; name: string; repoRoot: string; target: LanguageLocation | null }
  | { ok: false; error: string; id?: string; name?: string };

export type LanguageReferencesPayload =
  | {
      ok: true;
      id: string;
      name: string;
      repoRoot: string;
      references: LanguageLocation[];
      truncated?: boolean;
    }
  | { ok: false; error: string; id?: string; name?: string };

export type LanguagePosition = {
  path: string;
  line: number;
  column: number;
};

function queryForPosition(
  position: LanguagePosition,
  extras?: Record<string, string | number>,
): string {
  const params = new URLSearchParams();
  params.set('path', position.path);
  params.set('line', String(position.line));
  params.set('column', String(position.column));
  for (const [key, value] of Object.entries(extras ?? {})) params.set(key, String(value));
  return params.toString();
}

export async function fetchLanguageDefinition(
  droneId: string,
  position: LanguagePosition,
): Promise<LanguageDefinitionPayload> {
  const query = queryForPosition(position);
  return await requestJson<LanguageDefinitionPayload>(
    `/api/drones/${encodeURIComponent(droneId)}/language/definition?${query}`,
  );
}

export async function fetchLanguageReferences(
  droneId: string,
  position: LanguagePosition,
  limit = 100,
): Promise<LanguageReferencesPayload> {
  const query = queryForPosition(position, { limit });
  return await requestJson<LanguageReferencesPayload>(
    `/api/drones/${encodeURIComponent(droneId)}/language/references?${query}`,
  );
}
