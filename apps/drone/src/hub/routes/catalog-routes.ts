import { parseBoolParam } from '../hub-format';
import type { HubRouter } from '../hub-router';
import {
  createSkill,
  createSkillFromEditablePackage,
  deleteSkillRecord,
  getSkillById,
  listSkills,
  replaceSkillFromEditablePackage,
  updateSkillRecord,
  updateSkillFromEditablePackage,
} from '../skills';
import {
  createMcpServer,
  deleteMcpServerRecord,
  getMcpServerById,
  listMcpServers,
  updateMcpServerRecord,
} from '../mcp-servers';
import { listMcpServerTools } from '../mcp-server-tools';
import {
  createMcpAccessToken,
  getMcpAccessTokenById,
  listMcpAccessTokens,
  regenerateMcpAccessToken,
  revokeMcpAccessToken,
} from '../mcp-tokens';
import {
  importSkillFromSource,
  listSkillSourceCandidates,
  listSkillSources,
  previewSkillFromSource,
} from '../skill-sources';

export type CatalogRouteDependencies = {
  mcpToken: string;
  upsertDroneHubMcpServerPreset: () => Promise<any>;
};

export function registerCatalogRoutes(apiRouter: HubRouter, deps: CatalogRouteDependencies): void {
  const { mcpToken, upsertDroneHubMcpServerPreset } = deps;
  const errorMessage = (error: any): string => error?.message ?? String(error);
  const createCatalogStatus = (message: string): number =>
    /already exists|duplicate|unique constraint/i.test(message)
      ? 409
      : /missing |invalid /i.test(message)
        ? 400
        : 500;

  apiRouter.get('/api/skills', async ({ json: respond }) => {
    respond(200, { ok: true, skills: await listSkills() });
  });

  apiRouter.post('/api/skills', async ({ readJson, json: respond }) => {
    const body = await readJson();
    try {
      respond(201, { ok: true, skill: await createSkill(body) });
    } catch (error: any) {
      const message = errorMessage(error);
      respond(createCatalogStatus(message), { ok: false, error: message });
    }
  });

  apiRouter.post('/api/skills/package', async ({ readJson, json: respond }) => {
    const body = await readJson();
    try {
      respond(201, { ok: true, skill: await createSkillFromEditablePackage(body) });
    } catch (error: any) {
      const message = errorMessage(error);
      respond(createCatalogStatus(message), { ok: false, error: message });
    }
  });

  apiRouter.get('/api/skills/:skillId', async ({ params, fail, json: respond }) => {
    const skill = await getSkillById(params.skillId);
    if (!skill) fail(404, `unknown skill: ${params.skillId}`);
    respond(200, { ok: true, skill });
  });

  apiRouter.put('/api/skills/:skillId', async ({ params, readJson, json: respond }) => {
    const body = await readJson();
    try {
      respond(200, { ok: true, skill: await updateSkillRecord(params.skillId, body) });
    } catch (error: any) {
      const message = errorMessage(error);
      const status = /unknown skill/i.test(message) ? 404 : createCatalogStatus(message);
      respond(status, { ok: false, error: message });
    }
  });

  apiRouter.put('/api/skills/:skillId/package', async ({ params, readJson, json: respond }) => {
    const body = await readJson();
    try {
      respond(200, {
        ok: true,
        skill: await updateSkillFromEditablePackage(params.skillId, body),
      });
    } catch (error: any) {
      const message = errorMessage(error);
      const status = /unknown skill/i.test(message) ? 404 : createCatalogStatus(message);
      respond(status, { ok: false, error: message });
    }
  });

  apiRouter.post(
    '/api/skills/:skillId/replacement-package',
    async ({ params, readJson, json: respond }) => {
      const body = await readJson();
      try {
        respond(200, {
          ok: true,
          skill: await replaceSkillFromEditablePackage(params.skillId, body),
        });
      } catch (error: any) {
        const message = errorMessage(error);
        const status = /unknown skill/i.test(message) ? 404 : createCatalogStatus(message);
        respond(status, { ok: false, error: message });
      }
    },
  );

  apiRouter.delete('/api/skills/:skillId', async ({ params, fail, json: respond }) => {
    if (!(await deleteSkillRecord(params.skillId))) {
      fail(404, `unknown skill: ${params.skillId}`);
    }
    respond(200, { ok: true, deleted: true, id: params.skillId });
  });

  apiRouter.get('/api/mcp-servers', async ({ json: respond }) => {
    respond(200, { ok: true, servers: await listMcpServers() });
  });

  apiRouter.post('/api/mcp-servers', async ({ readJson, json: respond }) => {
    const body = await readJson();
    try {
      respond(201, { ok: true, server: await createMcpServer(body) });
    } catch (error: any) {
      const message = errorMessage(error);
      respond(createCatalogStatus(message), { ok: false, error: message });
    }
  });

  apiRouter.post('/api/mcp-servers/drone-hub-preset', async ({ json: respond }) => {
    try {
      respond(200, { ok: true, server: await upsertDroneHubMcpServerPreset() });
    } catch (error: any) {
      const message = errorMessage(error);
      respond(/not enabled/i.test(message) ? 503 : 500, { ok: false, error: message });
    }
  });

  apiRouter.get('/api/mcp-servers/:serverId/tools', async ({ params, fail, json: respond }) => {
    const server = await getMcpServerById(params.serverId);
    if (!server) return fail(404, `unknown MCP server: ${params.serverId}`);
    try {
      respond(200, {
        ok: true,
        serverId: server.id,
        tools: await listMcpServerTools(server),
      });
    } catch (error: any) {
      const message = errorMessage(error);
      respond(/timed? out|timeout/i.test(message) ? 504 : 502, {
        ok: false,
        error: message,
      });
    }
  });

  apiRouter.get('/api/mcp-servers/:serverId', async ({ params, fail, json: respond }) => {
    const server = await getMcpServerById(params.serverId);
    if (!server) fail(404, `unknown MCP server: ${params.serverId}`);
    respond(200, { ok: true, server });
  });

  apiRouter.put('/api/mcp-servers/:serverId', async ({ params, readJson, json: respond }) => {
    const body = await readJson();
    try {
      respond(200, {
        ok: true,
        server: await updateMcpServerRecord(params.serverId, body),
      });
    } catch (error: any) {
      const message = errorMessage(error);
      const status = /unknown MCP server/i.test(message) ? 404 : createCatalogStatus(message);
      respond(status, { ok: false, error: message });
    }
  });

  apiRouter.delete('/api/mcp-servers/:serverId', async ({ params, fail, json: respond }) => {
    if (!(await deleteMcpServerRecord(params.serverId))) {
      fail(404, `unknown MCP server: ${params.serverId}`);
    }
    respond(200, { ok: true, deleted: true, id: params.serverId });
  });

  apiRouter.get('/api/mcp-tokens', async ({ json: respond }) => {
    respond(200, { ok: true, tokens: await listMcpAccessTokens() });
  });

  apiRouter.post('/api/mcp-tokens', async ({ readJson, fail, json: respond }) => {
    const body = await readJson<any>();
    if (body?.kind != null && body.kind !== 'host') {
      fail(400, 'MCP token API only creates host tokens');
    }
    try {
      const created = await createMcpAccessToken({
        name: String(body?.name ?? '').trim(),
        kind: 'host',
        signingSecret: mcpToken,
      });
      respond(201, { ok: true, token: created.token, tokenValue: created.tokenValue });
    } catch (error: any) {
      const message = errorMessage(error);
      respond(/missing |too long/i.test(message) ? 400 : 500, {
        ok: false,
        error: message,
      });
    }
  });

  apiRouter.post('/api/mcp-tokens/:tokenId/regenerate', async ({ params, fail, json: respond }) => {
    const existing = await getMcpAccessTokenById(params.tokenId);
    if (!existing) return fail(404, `unknown MCP token: ${params.tokenId}`);
    if (existing.kind !== 'host') {
      fail(400, 'Only host MCP tokens can be regenerated from settings');
    }
    try {
      const result = await regenerateMcpAccessToken(params.tokenId, mcpToken);
      respond(200, { ok: true, token: result.token, tokenValue: result.tokenValue });
    } catch (error: any) {
      const message = errorMessage(error);
      respond(/unknown MCP token/i.test(message) ? 404 : 500, {
        ok: false,
        error: message,
      });
    }
  });

  apiRouter.delete('/api/mcp-tokens/:tokenId', async ({ params, fail, json: respond }) => {
    const token = await revokeMcpAccessToken(params.tokenId);
    if (!token) fail(404, `unknown MCP token: ${params.tokenId}`);
    respond(200, { ok: true, token });
  });

  apiRouter.get('/api/skill-sources', ({ json: respond }) => {
    respond(200, { ok: true, sources: listSkillSources() });
  });

  apiRouter.get('/api/skill-sources/:sourceId/skills', async ({ params, url, json: respond }) => {
    try {
      respond(200, {
        ok: true,
        sourceId: params.sourceId,
        skills: await listSkillSourceCandidates(params.sourceId, fetch, {
          forceRefresh: parseBoolParam(url.searchParams.get('refresh'), false),
        }),
      });
    } catch (error: any) {
      const message = errorMessage(error);
      const status = /unknown skill source/i.test(message)
        ? 404
        : /invalid /i.test(message)
          ? 400
          : 502;
      respond(status, { ok: false, error: message });
    }
  });

  apiRouter.get('/api/skill-sources/:sourceId/preview', async ({ params, url, json: respond }) => {
    try {
      respond(200, {
        ok: true,
        preview: await previewSkillFromSource({
          sourceId: params.sourceId,
          path: String(url.searchParams.get('path') ?? '').trim(),
        }),
      });
    } catch (error: any) {
      const message = errorMessage(error);
      const status = /unknown skill source|unknown source skill path/i.test(message)
        ? 404
        : /missing |invalid /i.test(message)
          ? 400
          : 502;
      respond(status, { ok: false, error: message });
    }
  });

  apiRouter.post(
    '/api/skill-sources/:sourceId/import',
    async ({ params, readJson, json: respond }) => {
      const body = await readJson<any>();
      try {
        respond(201, {
          ok: true,
          skill: await importSkillFromSource({ sourceId: params.sourceId, path: body?.path }),
        });
      } catch (error: any) {
        const message = errorMessage(error);
        const status = /unknown skill source|unknown source skill path/i.test(message)
          ? 404
          : /missing |invalid /i.test(message)
            ? 400
            : /already exists|duplicate/i.test(message)
              ? 409
              : /not importable/i.test(message)
                ? 422
                : 502;
        respond(status, { ok: false, error: message });
      }
    },
  );
}
