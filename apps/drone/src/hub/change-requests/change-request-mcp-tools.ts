import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { McpTokenIdentity } from '../mcp-tokens';

type ChangeRequestMcpContext = {
  principal: McpTokenIdentity;
  allowedWriteDroneRefs?: string[];
};

type ChangeRequestMcpDependencies = {
  context: ChangeRequestMcpContext;
  requestJson: (pathname: string, init?: RequestInit, timeoutMs?: number) => Promise<any>;
  toolResult: (value: Record<string, unknown>) => any;
};

export function registerChangeRequestMcpTools(
  server: McpServer,
  dependencies: ChangeRequestMcpDependencies,
): void {
  const { context, requestJson, toolResult } = dependencies;

  server.registerTool(
    'get_change_request',
    {
      title: 'Get change request',
      description:
        'Read a native DroneHub change request by integer requestNumber. This is public, read-only review access and does not grant update or merge authority.',
      inputSchema: { requestNumber: z.number().int().positive() },
    },
    async (args) => {
      const response = await requestJson(
        `/api/change-requests/${encodeURIComponent(args.requestNumber)}`,
        { method: 'GET' },
      );
      return toolResult({ ok: true, request: reviewRequest(response?.request) });
    },
  );

  server.registerTool(
    'list_change_request_revisions',
    {
      title: 'List change request revisions',
      description:
        'List the immutable retained revisions and source commits for a native DroneHub change request. This is public, read-only review access.',
      inputSchema: { requestNumber: z.number().int().positive() },
    },
    async (args) => {
      const response = await requestJson(
        `/api/change-requests/${encodeURIComponent(args.requestNumber)}/revisions`,
        { method: 'GET' },
      );
      return toolResult({ ok: true, revisions: response?.revisions ?? [] });
    },
  );

  server.registerTool(
    'get_change_request_changes',
    {
      title: 'Get change request changes',
      description:
        'List files and line counts in an immutable change-request revision. Omit revision for the current revision. This is public, read-only review access.',
      inputSchema: {
        requestNumber: z.number().int().positive(),
        revision: z.number().int().positive().optional(),
      },
    },
    async (args) => {
      const query = args.revision ? `?revision=${encodeURIComponent(args.revision)}` : '';
      const response = await requestJson(
        `/api/change-requests/${encodeURIComponent(args.requestNumber)}/changes${query}`,
        { method: 'GET' },
      );
      return toolResult({
        ok: true,
        request: reviewRequest(response?.request),
        revision: response?.revision,
        counts: response?.counts,
        entries: response?.entries ?? [],
      });
    },
  );

  server.registerTool(
    'get_change_request_diff',
    {
      title: 'Get change request file diff',
      description:
        'Read the revision-pinned diff for one repository-relative file in a native change request. This is public, read-only review access.',
      inputSchema: {
        requestNumber: z.number().int().positive(),
        path: z.string(),
        revision: z.number().int().positive().optional(),
        contextLines: z.number().int().min(0).max(200).optional(),
      },
    },
    async (args) => {
      const query = new URLSearchParams({ path: args.path });
      if (args.revision) query.set('revision', String(args.revision));
      if (args.contextLines !== undefined) query.set('contextLines', String(args.contextLines));
      const response = await requestJson(
        `/api/change-requests/${encodeURIComponent(args.requestNumber)}/diff?${query.toString()}`,
        { method: 'GET' },
      );
      return toolResult({
        ok: true,
        revision: response?.revision,
        baseSha: response?.baseSha,
        headSha: response?.headSha,
        path: response?.path,
        diff: response?.diff ?? '',
        truncated: response?.truncated === true,
        isBinary: response?.isBinary === true,
      });
    },
  );

  server.registerTool(
    'prepare_change_request_review',
    {
      title: 'Prepare change request review',
      description:
        'Create or reuse an isolated worktree containing an exact change-request revision squash-merged onto the freshly fetched destination. Use the returned path to inspect full code and run builds or tests. This never edits or merges the change request. Container chats automatically review in their own drone.',
      inputSchema: {
        requestNumber: z.number().int().positive(),
        revision: z.number().int().positive().optional(),
        drone: z.string().optional(),
      },
    },
    async (args) => {
      const reviewerDroneRef = reviewDroneRef(context, args.drone);
      const response = await requestJson(
        `/api/change-requests/${encodeURIComponent(args.requestNumber)}/review-workspace`,
        {
          method: 'POST',
          body: JSON.stringify({
            revision: args.revision,
            reviewerDroneRef,
          }),
        },
        120_000,
      );
      return toolResult({
        ok: true,
        workspace: response?.workspace,
        instructions:
          'Review the exact code at workspace.path. Inspect repository guidance first, then run the relevant build and tests there. Bind your verbal conclusion to workspace.revision, workspace.destinationBranch, workspace.destinationSha, and workspace.candidateTreeSha. Do not claim the current change request was reviewed when workspace.isCurrentRevision is false. If fixes are needed, edit workspace.path, commit every change there, and call update_change_request_from_review with requestNumber and workspace.workspaceId; do not use refreshSnapshot for those edits.',
      });
    },
  );

  server.registerTool(
    'create_change_request',
    {
      title: 'Create change request',
      description:
        'Capture the current committed changes as a native DroneHub change request. This does not create a GitHub pull request. After creation, reference the returned number as CR #<number> in chat so DroneHub renders a linked change-request card.',
      inputSchema: {
        drone: z.string().optional(),
        chat: z.string().optional(),
        title: z.string(),
        description: z.string().optional(),
        destinationBranch: z.string().optional(),
      },
    },
    async (args) => {
      const principal = chatPrincipal(context);
      const droneRef = principal?.droneId ?? cleanString(args.drone);
      if (!droneRef) throw new Error('drone is required');
      const response = await requestJson(
        '/api/change-requests',
        {
          method: 'POST',
          body: JSON.stringify({
            droneRef,
            chatName: (principal?.chatName ?? cleanString(args.chat)) || 'default',
            chatId: principal?.chatId ?? null,
            title: args.title,
            description: args.description,
            destinationBranch: args.destinationBranch,
            actor: changeRequestActor(context),
          }),
        },
        120_000,
      );
      const requestNumber = Number(response?.request?.number);
      const reference =
        Number.isSafeInteger(requestNumber) && requestNumber > 0
          ? `CR #${requestNumber}`
          : 'CR #<number>';
      return toolResult({
        ...response,
        instructions: `Write ${reference} in your chat response (no URL is needed) so DroneHub renders the created change request as an interactive card.`,
      });
    },
  );

  server.registerTool(
    'update_change_request',
    {
      title: 'Update change request',
      description:
        'Update any native DroneHub change request by integer requestNumber. Title, description, and destination edits do not refresh its code unless refreshSnapshot is explicitly true. This never grants merge authority.',
      inputSchema: {
        requestNumber: z.number().int().positive(),
        title: z.string().optional(),
        description: z.string().optional(),
        destinationBranch: z.string().optional(),
        refreshSnapshot: z.boolean().optional(),
      },
    },
    async (args) => {
      const response = await requestJson(
        `/api/change-requests/${encodeURIComponent(args.requestNumber)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            title: args.title,
            description: args.description,
            destinationBranch: args.destinationBranch,
            refreshSnapshot: args.refreshSnapshot === true,
            actor: changeRequestActor(context),
          }),
        },
        120_000,
      );
      return toolResult({ ok: true, request: reviewRequest(response?.request) });
    },
  );

  server.registerTool(
    'update_change_request_from_review',
    {
      title: 'Update change request from review',
      description:
        'Publish committed code changes from a prepared review workspace as a new immutable revision of its change request. The workspace must be clean and committed, descend from its prepared candidate, and match the current revision and destination branch. Container chats automatically use their own drone.',
      inputSchema: {
        requestNumber: z.number().int().positive(),
        workspaceId: z.string().min(1),
        drone: z.string().optional(),
      },
    },
    async (args) => {
      const reviewerDroneRef = reviewDroneRef(context, args.drone);
      const response = await requestJson(
        `/api/change-requests/${encodeURIComponent(args.requestNumber)}/review-workspace/promote`,
        {
          method: 'POST',
          body: JSON.stringify({
            workspaceId: args.workspaceId,
            reviewerDroneRef,
            actor: changeRequestActor(context),
          }),
        },
        120_000,
      );
      return toolResult({
        ok: true,
        request: reviewRequest(response?.request),
        instructions:
          'A new immutable change-request revision was created. Prepare a fresh review workspace for the new revision before reporting it safe to merge.',
      });
    },
  );

  server.registerTool(
    'close_change_request',
    {
      title: 'Close change request',
      description:
        'Close a native DroneHub change request, identified by its integer requestNumber, without merging it.',
      inputSchema: { requestNumber: z.number().int().positive() },
    },
    async (args) => {
      await requireOwnedChangeRequest(context, requestJson, args.requestNumber);
      return toolResult(
        await requestJson(`/api/change-requests/${encodeURIComponent(args.requestNumber)}/close`, {
          method: 'POST',
        }),
      );
    },
  );

  server.registerTool(
    'merge_change_request',
    {
      title: 'Merge change request',
      description:
        'Directly squash-merge a native DroneHub change request, identified by its integer requestNumber, to its destination branch using the host Git identity and credentials. After prepare_change_request_review, pass that workspace revision, destinationBranch, destinationSha, and candidateTreeSha as the matching expected fields so a changed candidate is rejected.',
      inputSchema: {
        requestNumber: z.number().int().positive(),
        commitMessage: z.string().optional(),
        expectedRevision: z.number().int().positive().optional(),
        expectedDestinationBranch: z.string().min(1).optional(),
        expectedDestinationSha: z
          .string()
          .regex(/^[0-9a-fA-F]{40}$/)
          .optional(),
        expectedCandidateTreeSha: z
          .string()
          .regex(/^[0-9a-fA-F]{40}$/)
          .optional(),
      },
    },
    async (args) => {
      await requireOwnedChangeRequest(context, requestJson, args.requestNumber);
      return toolResult(
        await requestJson(
          `/api/change-requests/${encodeURIComponent(args.requestNumber)}/merge`,
          {
            method: 'POST',
            body: JSON.stringify({
              commitMessage: args.commitMessage,
              expectedRevision: args.expectedRevision,
              expectedDestinationBranch: args.expectedDestinationBranch,
              expectedDestinationSha: args.expectedDestinationSha,
              expectedCandidateTreeSha: args.expectedCandidateTreeSha,
              actor: changeRequestActor(context),
            }),
          },
          120_000,
        ),
      );
    },
  );
}

function chatPrincipal(
  context: ChangeRequestMcpContext,
): Extract<McpTokenIdentity, { kind: 'chat' }> | null {
  return context.principal.kind === 'chat' ? context.principal : null;
}

function changeRequestActor(context: ChangeRequestMcpContext) {
  const principal = chatPrincipal(context);
  if (principal) {
    return {
      kind: 'chat' as const,
      id: principal.chatId,
      label: `${principal.droneId}/${principal.chatName}`,
    };
  }
  return {
    kind: 'user' as const,
    id: context.principal.tokenId,
    label: context.principal.name,
  };
}

async function requireOwnedChangeRequest(
  context: ChangeRequestMcpContext,
  requestJson: ChangeRequestMcpDependencies['requestJson'],
  requestNumberRaw: unknown,
): Promise<void> {
  const requestNumber = Number(requestNumberRaw);
  if (!Number.isSafeInteger(requestNumber) || requestNumber <= 0) {
    throw new Error('requestNumber must be a positive integer');
  }
  const response = await requestJson(`/api/change-requests/${encodeURIComponent(requestNumber)}`, {
    method: 'GET',
  });
  const request = response?.request;
  if (!request) throw new Error(`unknown change request: #${requestNumber}`);
  const principal = chatPrincipal(context);
  if (principal && !changeRequestBelongsToChat(request, principal)) {
    throw new Error('This chat can only manage change requests that it created.');
  }
  if (!principal && !changeRequestIsWithinWriteScope(request, context.allowedWriteDroneRefs)) {
    throw new Error('This assistant can only manage change requests in its write scope.');
  }
}

export function changeRequestBelongsToChat(
  request: { droneId?: unknown; chatId?: unknown; chatName?: unknown },
  principal: Extract<McpTokenIdentity, { kind: 'chat' }>,
): boolean {
  if (cleanString(request.droneId) !== principal.droneId) return false;
  const requestChatId = cleanString(request.chatId);
  return requestChatId
    ? requestChatId === principal.chatId
    : cleanString(request.chatName) === principal.chatName;
}

export function changeRequestIsWithinWriteScope(
  request: { droneId?: unknown; droneName?: unknown },
  allowedWriteDroneRefs?: string[],
): boolean {
  if (allowedWriteDroneRefs === undefined) return true;
  const allowed = new Set(allowedWriteDroneRefs.map(cleanString).filter(Boolean));
  return allowed.has(cleanString(request.droneId)) || allowed.has(cleanString(request.droneName));
}

function cleanString(value: unknown): string {
  return String(value ?? '').trim();
}

function reviewDroneRef(context: ChangeRequestMcpContext, requestedDrone: unknown): string {
  if (context.principal.kind === 'chat') return context.principal.droneId;
  if (context.principal.kind === 'drone' && context.principal.droneId) {
    return context.principal.droneId;
  }
  const drone = cleanString(requestedDrone);
  if (!drone) throw new Error('drone is required when preparing a review outside a drone chat');
  return drone;
}

function reviewRequest(value: any): any {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const { repoRoot: _repoRoot, snapshotRef: _snapshotRef, ...request } = value;
  return request;
}
