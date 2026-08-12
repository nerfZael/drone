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
    'create_change_request',
    {
      title: 'Create change request',
      description:
        'Capture the current committed changes as a native DroneHub change request. This does not create a GitHub pull request.',
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
      return toolResult(response);
    },
  );

  server.registerTool(
    'update_change_request',
    {
      title: 'Update change request',
      description:
        'Refresh a native DroneHub change request, identified by its integer requestNumber, from the latest committed source and optionally change its title, description, or destination branch.',
      inputSchema: {
        requestNumber: z.number().int().positive(),
        title: z.string().optional(),
        description: z.string().optional(),
        destinationBranch: z.string().optional(),
        refreshSnapshot: z.boolean().optional(),
      },
    },
    async (args) => {
      await requireOwnedChangeRequest(context, requestJson, args.requestNumber);
      const response = await requestJson(
        `/api/change-requests/${encodeURIComponent(args.requestNumber)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            title: args.title,
            description: args.description,
            destinationBranch: args.destinationBranch,
            refreshSnapshot: args.refreshSnapshot,
          }),
        },
        120_000,
      );
      return toolResult(response);
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
        'Directly squash-merge a native DroneHub change request, identified by its integer requestNumber, to its destination branch using the host Git identity and credentials.',
      inputSchema: {
        requestNumber: z.number().int().positive(),
        commitMessage: z.string().optional(),
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
