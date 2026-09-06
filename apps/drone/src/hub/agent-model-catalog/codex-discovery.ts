import { CodexAppServerConnection } from '../../codex-app-server';
import { parseAgentModelList } from './parsers';
import type { AgentModelCatalogModel } from './types';

type Connection = Pick<CodexAppServerConnection, 'call' | 'stop'>;

export async function discoverCodexModels(
  connection: Connection = new CodexAppServerConnection({ launchScript: 'exec codex app-server' }),
): Promise<AgentModelCatalogModel[]> {
  const entries: unknown[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  const timeout = setTimeout(() => connection.stop(), 30_000);
  timeout.unref?.();
  try {
    do {
      const page = await connection.call('model/list', { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) });
      if (!Array.isArray(page?.data)) throw new Error('Codex returned an invalid model list');
      entries.push(...page.data.filter((entry: any) => entry?.hidden !== true));
      cursor = typeof page.nextCursor === 'string' && page.nextCursor ? page.nextCursor : undefined;
      if (cursor && cursors.has(cursor)) throw new Error('Codex returned a repeated model-list cursor');
      if (cursor) cursors.add(cursor);
      if (cursors.size > 100) throw new Error('Codex model list exceeded the page limit');
    } while (cursor);
    const models = parseAgentModelList(JSON.stringify(entries));
    if (!models.length) throw new Error('Codex returned no available models');
    return models;
  } finally {
    clearTimeout(timeout);
    connection.stop();
  }
}
