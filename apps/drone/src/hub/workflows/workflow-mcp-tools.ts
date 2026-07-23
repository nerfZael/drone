import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { workflowDefinitionSchema, workflowJsonValueSchema } from './workflow-schema';

type WorkflowMcpDependencies = {
  requestJson: (pathname: string, init?: RequestInit, timeoutMs?: number) => Promise<any>;
  toolResult: (value: Record<string, unknown>) => any;
};

function cleanString(value: unknown): string {
  return String(value ?? '').trim();
}

function requiredDrone(args: { drone?: string }): string {
  const drone = cleanString(args.drone);
  if (!drone) throw new Error('drone is required for host workflow tools');
  return drone;
}

function workflowListProjection(workflow: any): any {
  return {
    id: workflow?.id,
    droneId: workflow?.droneId,
    name: workflow?.name,
    description: workflow?.description,
    version: workflow?.version,
    updatedAt: workflow?.updatedAt,
    agents: Object.keys(workflow?.definition?.agents ?? {}),
    phases: Array.isArray(workflow?.definition?.phases)
      ? workflow.definition.phases.map((phase: any) => ({
          id: phase?.id,
          label: phase?.label,
        }))
      : [],
  };
}

function workflowRunListProjection(run: any): any {
  return {
    id: run?.id,
    workflowId: run?.workflowId,
    workflowName: run?.workflowName,
    workflowVersion: run?.workflowVersion,
    status: run?.status,
    revision: run?.revision,
    plan: run?.plan,
    requestedAt: run?.requestedAt,
    startedAt: run?.startedAt,
    finishedAt: run?.finishedAt,
    error: run?.error,
  };
}

function truncatedText(value: unknown, maxChars: number): string {
  return String(value ?? '').slice(0, maxChars);
}

export function registerWorkflowMcpTools(
  server: McpServer,
  dependencies: WorkflowMcpDependencies,
): void {
  const { requestJson, toolResult } = dependencies;

  server.registerTool(
    'list_workflows',
    {
      title: 'List drone workflows',
      description: 'List the reusable workflows owned by a Drone Hub drone.',
      inputSchema: { drone: z.string().optional() },
    },
    async (args) => {
      const drone = requiredDrone(args);
      const response = await requestJson(`/api/drones/${encodeURIComponent(drone)}/workflows`, {
        method: 'GET',
      });
      return toolResult({
        ok: true,
        drone,
        workflows: (response?.workflows ?? []).map(workflowListProjection),
      });
    },
  );

  server.registerTool(
    'get_workflow',
    {
      title: 'Get drone workflow',
      description: 'Read one workflow definition and its current version.',
      inputSchema: { drone: z.string().optional(), workflowId: z.string() },
    },
    async (args) => {
      const drone = requiredDrone(args);
      const response = await requestJson(
        `/api/drones/${encodeURIComponent(drone)}/workflows/${encodeURIComponent(args.workflowId)}`,
        { method: 'GET' },
      );
      return toolResult({ ok: true, workflow: response?.workflow });
    },
  );

  server.registerTool(
    'create_workflow',
    {
      title: 'Create drone workflow',
      description: 'Create a validated structured workflow for this drone.',
      inputSchema: {
        drone: z.string().optional(),
        name: z.string(),
        description: z.string().optional(),
        definition: workflowDefinitionSchema,
      },
    },
    async (args) => {
      const drone = requiredDrone(args);
      const response = await requestJson(`/api/drones/${encodeURIComponent(drone)}/workflows`, {
        method: 'POST',
        body: JSON.stringify({
          name: args.name,
          description: args.description,
          definition: args.definition,
          actorKind: 'mcp',
          actorId: 'drone-hub-mcp',
        }),
      });
      return toolResult({ ok: true, workflow: response?.workflow });
    },
  );

  server.registerTool(
    'update_workflow',
    {
      title: 'Update drone workflow',
      description: 'Update workflow metadata or definition using its current version.',
      inputSchema: {
        drone: z.string().optional(),
        workflowId: z.string(),
        baseVersion: z.number().int().positive(),
        name: z.string().optional(),
        description: z.string().optional(),
        definition: workflowDefinitionSchema.optional(),
      },
    },
    async (args) => {
      const drone = requiredDrone(args);
      const response = await requestJson(
        `/api/drones/${encodeURIComponent(drone)}/workflows/${encodeURIComponent(args.workflowId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            baseVersion: args.baseVersion,
            ...(args.name === undefined ? {} : { name: args.name }),
            ...(args.description === undefined ? {} : { description: args.description }),
            ...(args.definition === undefined ? {} : { definition: args.definition }),
            actorKind: 'mcp',
            actorId: 'drone-hub-mcp',
          }),
        },
      );
      return toolResult({ ok: true, workflow: response?.workflow });
    },
  );

  server.registerTool(
    'delete_workflow',
    {
      title: 'Delete drone workflow',
      description:
        'Delete a workflow, its retained runs, and all chats or child drones created by those runs.',
      inputSchema: { drone: z.string().optional(), workflowId: z.string() },
    },
    async (args) => {
      const drone = requiredDrone(args);
      await requestJson(
        `/api/drones/${encodeURIComponent(drone)}/workflows/${encodeURIComponent(args.workflowId)}`,
        { method: 'DELETE' },
      );
      return toolResult({ ok: true, deleted: true, workflowId: args.workflowId });
    },
  );

  server.registerTool(
    'execute_workflow',
    {
      title: 'Request workflow execution',
      description:
        'Create a durable pending workflow run. A Drone Hub user must approve it before execution starts.',
      inputSchema: {
        drone: z.string().optional(),
        workflowId: z.string(),
        input: workflowJsonValueSchema.optional(),
      },
    },
    async (args) => {
      const drone = requiredDrone(args);
      const response = await requestJson(
        `/api/drones/${encodeURIComponent(drone)}/workflows/${encodeURIComponent(args.workflowId)}/runs`,
        {
          method: 'POST',
          body: JSON.stringify({
            input: args.input === undefined ? {} : args.input,
            actorKind: 'mcp',
            actorId: 'drone-hub-mcp',
          }),
        },
      );
      return toolResult({
        ok: true,
        approvalRequired: true,
        run: response?.run,
      });
    },
  );

  server.registerTool(
    'list_workflow_runs',
    {
      title: 'List workflow runs',
      description: 'List workflow execution requests and their current statuses.',
      inputSchema: {
        drone: z.string().optional(),
        workflowId: z.string().optional(),
      },
    },
    async (args) => {
      const drone = requiredDrone(args);
      const query = args.workflowId ? `?workflowId=${encodeURIComponent(args.workflowId)}` : '';
      const response = await requestJson(
        `/api/drones/${encodeURIComponent(drone)}/workflow-runs${query}`,
        { method: 'GET' },
      );
      return toolResult({
        ok: true,
        runs: (response?.runs ?? []).map(workflowRunListProjection),
      });
    },
  );

  server.registerTool(
    'get_workflow_run',
    {
      title: 'Get workflow run',
      description: 'Inspect a workflow run and a page of its agent invocations.',
      inputSchema: {
        drone: z.string().optional(),
        runId: z.string(),
        invocationCursor: z.string().optional(),
        invocationLimit: z.number().int().positive().max(100).optional(),
      },
    },
    async (args) => {
      const drone = requiredDrone(args);
      const base = `/api/drones/${encodeURIComponent(drone)}/workflow-runs/${encodeURIComponent(args.runId)}`;
      const query = new URLSearchParams();
      if (args.invocationCursor) query.set('cursor', args.invocationCursor);
      query.set('limit', String(args.invocationLimit ?? 20));
      const [runResponse, invocationResponse] = await Promise.all([
        requestJson(base, { method: 'GET' }),
        requestJson(`${base}/invocations?${query}`, { method: 'GET' }),
      ]);
      return toolResult({
        ok: true,
        run: runResponse?.run,
        invocations: (invocationResponse?.invocations ?? []).map((invocation: any) => ({
          ...invocation,
          ...(typeof invocation?.textResult === 'string'
            ? { textResult: truncatedText(invocation.textResult, 8_000) }
            : {}),
        })),
        nextCursor: invocationResponse?.nextCursor ?? null,
      });
    },
  );

  server.registerTool(
    'cancel_workflow_run',
    {
      title: 'Cancel workflow run',
      description: 'Request cancellation of an active workflow run.',
      inputSchema: { drone: z.string().optional(), runId: z.string() },
    },
    async (args) => {
      const drone = requiredDrone(args);
      const response = await requestJson(
        `/api/drones/${encodeURIComponent(drone)}/workflow-runs/${encodeURIComponent(args.runId)}/cancel`,
        { method: 'POST', body: '{}' },
      );
      return toolResult({ ok: true, run: response?.run });
    },
  );
}
