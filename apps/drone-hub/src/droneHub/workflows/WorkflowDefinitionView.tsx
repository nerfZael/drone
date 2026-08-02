import React from 'react';
import { MarkerType, type ReactFlowInstance } from '@xyflow/react';

import {
  buildWorkflowGraphLayout,
  WORKFLOW_GRAPH_NODE_HEIGHT,
  WORKFLOW_GRAPH_NODE_WIDTH,
  type WorkflowGraphEdge,
  type WorkflowGraphLayout,
  type WorkflowGraphNode,
} from './workflow-graph-layout';
import {
  WorkflowGraphCanvas,
  type WorkflowCanvasEdge,
  type WorkflowCanvasNode,
} from './WorkflowGraphCanvas';
import { workflowStatusLabel } from './workflow-presentation';
import type { DroneWorkflow, WorkflowInvocation, WorkflowRun } from './workflow-types';

const MIN_SCALE = 0.28;
const MAX_SCALE = 1.35;
const SCALE_STEP = 0.1;
const FIT_PADDING = 28;

type GraphMode = 'definition' | 'run';
type InspectorTab = 'overview' | 'input' | 'output' | 'chats';
type NodeExecutionStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'skipped';

type GraphViewportState = {
  scale: number;
  panX: number;
  panY: number;
};

type NodeExecutionSummary = {
  status: NodeExecutionStatus;
  invocations: WorkflowInvocation[];
};

type Props = {
  workflow: DroneWorkflow;
  run?: WorkflowRun | null;
  invocations?: WorkflowInvocation[];
  ownerDroneId?: string;
  onOpenChat?: (droneId: string, chatName: string) => void;
};

function clampScale(value: number): number {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.round(value * 100) / 100));
}

export function workflowFitViewport({
  viewportWidth,
  viewportHeight,
  graphWidth,
  graphHeight,
}: {
  viewportWidth: number;
  viewportHeight: number;
  graphWidth: number;
  graphHeight: number;
}): GraphViewportState {
  const nextScale = Math.min(
    1,
    (viewportWidth - FIT_PADDING * 2) / graphWidth,
    (viewportHeight - FIT_PADDING * 2) / graphHeight,
  );
  const scale = clampScale(nextScale);
  return {
    scale,
    panX: (viewportWidth - graphWidth * scale) / 2,
    panY: FIT_PADDING,
  };
}

function nodeTypeColor(type: WorkflowGraphNode['type']): string {
  if (type === 'phase') return 'var(--canvas-related)';
  if (type === 'call') return 'var(--accent)';
  if (type === 'parallel') return 'var(--green)';
  if (type === 'if') return 'var(--canvas-related)';
  if (type === 'forEach' || type === 'repeat') return 'var(--yellow)';
  return 'var(--muted)';
}

function nodeTypeGlyph(type: WorkflowGraphNode['type']): string {
  if (type === 'phase') return '◆';
  if (type === 'call') return '●';
  if (type === 'parallel') return '⑂';
  if (type === 'if') return '◇';
  if (type === 'forEach' || type === 'repeat') return '↻';
  return '→';
}

function executionStatusLabel(status: NodeExecutionStatus): string {
  if (status === 'idle') return 'Not reached';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function executionStatusColor(status: NodeExecutionStatus): string {
  if (status === 'completed') return 'var(--green)';
  if (status === 'running') return 'var(--accent)';
  if (status === 'failed') return 'var(--red)';
  if (status === 'cancelled') return 'var(--red)';
  if (status === 'queued') return 'var(--yellow)';
  return 'var(--muted-dim)';
}

function summarizeInvocations(invocations: WorkflowInvocation[]): NodeExecutionSummary {
  if (invocations.length === 0) return { status: 'idle', invocations };
  if (invocations.some((invocation) => invocation.status === 'failed')) {
    return { status: 'failed', invocations };
  }
  if (invocations.some((invocation) => invocation.status === 'running')) {
    return { status: 'running', invocations };
  }
  if (invocations.some((invocation) => invocation.status === 'queued')) {
    return { status: 'queued', invocations };
  }
  if (invocations.every((invocation) => invocation.status === 'cancelled')) {
    return { status: 'cancelled', invocations };
  }
  if (invocations.every((invocation) => invocation.status === 'completed')) {
    return { status: 'completed', invocations };
  }
  if (invocations.some((invocation) => invocation.status === 'cancelled')) {
    return { status: 'cancelled', invocations };
  }
  return { status: 'idle', invocations };
}

export function buildWorkflowNodeExecutionMap(
  layout: WorkflowGraphLayout,
  invocations: WorkflowInvocation[],
): Map<string, NodeExecutionSummary> {
  const callNodes = layout.nodes.filter((node) => node.type === 'call');
  return new Map(
    layout.nodes.map((node) => {
      let matching: WorkflowInvocation[];
      if (node.type === 'phase') {
        matching = invocations.filter((invocation) => invocation.phaseId === node.phaseId);
      } else if (node.type === 'call') {
        matching = invocations.filter(
          (invocation) =>
            invocation.phaseId === node.phaseId && invocation.nodeId === node.sourceId,
        );
      } else {
        const descendantIds = new Set(
          callNodes
            .filter(
              (candidate) =>
                candidate.phaseId === node.phaseId &&
                candidate.key.startsWith(`${node.key}/`),
            )
            .map((candidate) => candidate.sourceId),
        );
        matching = invocations.filter(
          (invocation) =>
            invocation.phaseId === node.phaseId && descendantIds.has(invocation.nodeId),
        );
      }
      return [node.key, summarizeInvocations(matching)];
    }),
  );
}

export function workflowCallsForAgent(
  layout: WorkflowGraphLayout,
  agentId: string,
): WorkflowGraphNode[] {
  return layout.nodes.filter((node) => node.type === 'call' && node.agentId === agentId);
}

export function workflowRunAgentGroups(
  workflow: DroneWorkflow,
  layout: WorkflowGraphLayout,
  invocations: WorkflowInvocation[],
): Array<{
  agentId: string;
  calls: WorkflowGraphNode[];
  invocations: WorkflowInvocation[];
}> {
  return Object.keys(workflow.definition.agents).map((agentId) => {
    const calls = workflowCallsForAgent(layout, agentId);
    const callRefs = new Set(calls.map((call) => `${call.phaseId}\u0000${call.sourceId}`));
    return {
      agentId,
      calls,
      invocations: invocations.filter((invocation) =>
        callRefs.has(`${invocation.phaseId}\u0000${invocation.nodeId}`),
      ),
    };
  });
}

function edgePath(
  edge: WorkflowGraphEdge,
  source: WorkflowGraphNode,
  target: WorkflowGraphNode,
): string {
  if (edge.variant === 'phase') {
    const startX = source.x + WORKFLOW_GRAPH_NODE_WIDTH;
    const startY = source.y + WORKFLOW_GRAPH_NODE_HEIGHT / 2;
    const endX = target.x;
    const endY = target.y + WORKFLOW_GRAPH_NODE_HEIGHT / 2;
    const control = Math.max(28, (endX - startX) * 0.42);
    return `M ${startX} ${startY} C ${startX + control} ${startY}, ${endX - control} ${endY}, ${endX} ${endY}`;
  }
  if (edge.variant === 'loop') {
    const startX = source.x + WORKFLOW_GRAPH_NODE_WIDTH;
    const startY = source.y + WORKFLOW_GRAPH_NODE_HEIGHT / 2;
    const endX = target.x + WORKFLOW_GRAPH_NODE_WIDTH;
    const endY = target.y + WORKFLOW_GRAPH_NODE_HEIGHT / 2;
    const curveX = Math.max(startX, endX) + 38;
    return `M ${startX} ${startY} C ${curveX} ${startY}, ${curveX} ${endY}, ${endX} ${endY}`;
  }
  const startX = source.x + WORKFLOW_GRAPH_NODE_WIDTH / 2;
  const startY = source.y + WORKFLOW_GRAPH_NODE_HEIGHT;
  const endX = target.x + WORKFLOW_GRAPH_NODE_WIDTH / 2;
  const endY = target.y;
  if (edge.points?.length) {
    const route = [...edge.points, { x: endX, y: endY }];
    return `M ${startX} ${startY} ${route.map((point) => `L ${point.x} ${point.y}`).join(' ')}`;
  }
  const control = Math.max(20, Math.min(70, Math.abs(endY - startY) * 0.48));
  return `M ${startX} ${startY} C ${startX} ${startY + control}, ${endX} ${endY - control}, ${endX} ${endY}`;
}

function edgeLabelPosition(
  source: WorkflowGraphNode,
  target: WorkflowGraphNode,
  variant: WorkflowGraphEdge['variant'],
): { x: number; y: number } {
  if (variant === 'phase') {
    return {
      x: (source.x + WORKFLOW_GRAPH_NODE_WIDTH + target.x) / 2,
      y: (source.y + target.y) / 2 + WORKFLOW_GRAPH_NODE_HEIGHT / 2 - 8,
    };
  }
  return {
    x: (source.x + target.x) / 2 + WORKFLOW_GRAPH_NODE_WIDTH / 2,
    y: (source.y + WORKFLOW_GRAPH_NODE_HEIGHT + target.y) / 2 - 7,
  };
}

function formatDuration(startedAt: string | null, finishedAt: string | null): string {
  if (!startedAt) return 'Not started';
  const start = Date.parse(startedAt);
  const finish = finishedAt ? Date.parse(finishedAt) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(finish)) return '—';
  const seconds = Math.max(0, Math.floor((finish - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) return `${minutes}m ${String(remainder).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatTimestamp(value: string | null): string {
  if (!value) return '—';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function jsonText(value: unknown): string {
  if (value === undefined) return 'Not available';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function latestInvocation(invocations: WorkflowInvocation[]): WorkflowInvocation | null {
  return [...invocations].sort((left, right) => right.ordinal - left.ordinal)[0] ?? null;
}

function NodeStatusBadge({ summary }: { summary: NodeExecutionSummary }) {
  return (
    <span
      className="inline-flex h-5 items-center gap-1.5 rounded-full border px-2 text-[var(--text-8)] font-[var(--weight-semibold)] uppercase tracking-[0.08em]"
      style={{
        color: executionStatusColor(summary.status),
        borderColor: `color-mix(in srgb, ${executionStatusColor(summary.status)} 45%, transparent)`,
        background: `color-mix(in srgb, ${executionStatusColor(summary.status)} 10%, var(--panel-raised))`,
      }}
    >
      <span className="relative flex h-1.5 w-1.5">
        {summary.status === 'running' ? (
          <span
            className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
            style={{ background: executionStatusColor(summary.status) }}
          />
        ) : null}
        <span
          className="relative inline-flex h-1.5 w-1.5 rounded-full"
          style={{ background: executionStatusColor(summary.status) }}
        />
      </span>
      {executionStatusLabel(summary.status)}
      {summary.invocations.length > 1 ? ` · ${summary.invocations.length}` : ''}
    </span>
  );
}

function WorkflowGraphCard({
  node,
  mode,
  summary,
  selected,
  showDetails,
  dimmed,
  onSelect,
  onOpenChat,
}: {
  node: WorkflowGraphNode;
  mode: GraphMode;
  summary: NodeExecutionSummary;
  selected: boolean;
  showDetails: boolean;
  dimmed: boolean;
  onSelect: () => void;
  onOpenChat?: (invocation: WorkflowInvocation) => void;
}) {
  const chatInvocation = [...summary.invocations]
    .reverse()
    .find((invocation) => invocation.lastChatName);
  const statusColor = executionStatusColor(summary.status);
  const typeColor = nodeTypeColor(node.type);
  return (
    <button
      type="button"
      data-workflow-graph-node={node.type}
      aria-pressed={selected}
      onClick={onSelect}
      className={`nodrag nopan group relative h-full w-full overflow-visible text-left outline-none transition-[transform,opacity] duration-150 hover:-translate-y-0.5 focus-visible:-translate-y-0.5 ${dimmed ? 'opacity-20' : 'opacity-100'}`}
      title={`${node.eyebrow}: ${node.label}`}
    >
      <span
        className="absolute inset-0 overflow-hidden rounded-[10px] border bg-[var(--panel-raised)] shadow-[0_14px_32px_var(--shadow-color)] transition-[border-color,box-shadow] duration-150 group-hover:shadow-[0_18px_38px_var(--shadow-color)] group-focus-visible:shadow-[0_0_0_2px_var(--accent-muted),0_18px_38px_var(--shadow-color)]"
        style={{
          borderColor: selected
            ? typeColor
            : mode === 'run' && summary.status !== 'idle'
              ? `color-mix(in srgb, ${statusColor} 52%, var(--border))`
              : 'var(--border)',
          boxShadow:
            mode === 'run' && summary.status === 'running'
              ? `0 0 0 1px ${statusColor}, 0 0 24px color-mix(in srgb, ${statusColor} 20%, transparent)`
              : undefined,
        }}
      >
        <span
          className="absolute inset-y-0 left-0 w-[3px]"
          style={{ background: mode === 'run' && summary.status !== 'idle' ? statusColor : typeColor }}
        />
        <span className="flex h-full min-w-0 flex-col px-3 py-2.5 pl-3.5">
          <span className="flex min-w-0 items-center gap-2">
            <span
              className="flex-none text-[10px] leading-none"
              style={{ color: typeColor }}
              aria-hidden="true"
            >
              {nodeTypeGlyph(node.type)}
            </span>
            <span
              className="min-w-0 truncate text-[var(--text-8)] font-[var(--weight-semibold)] uppercase tracking-[0.14em]"
              style={{ color: typeColor, fontFamily: 'var(--display)' }}
            >
              {node.eyebrow}
            </span>
            {mode === 'run' ? (
              <span className="ml-auto flex-none">
                <NodeStatusBadge summary={summary} />
              </span>
            ) : (
              <span className="ml-auto max-w-[112px] flex-none truncate font-mono text-[var(--text-8)] text-[var(--muted-dim)]">
                {node.sourceId}
              </span>
            )}
          </span>
          <span className="mt-1.5 line-clamp-2 min-h-[30px] text-[var(--text-12)] font-[var(--weight-semibold)] leading-[1.25] text-[var(--fg-strong)]">
            {node.label}
          </span>
          {node.type === 'call' ? (
            <>
              <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[var(--text-9)]">
                <span className="max-w-[100px] flex-none truncate rounded bg-[var(--accent-subtle)] px-1.5 py-0.5 text-[var(--accent)]">
                  {node.agentId}
                </span>
                <span className="min-w-0 truncate text-[var(--muted)]">
                  {[node.runnerLabel, node.model].filter(Boolean).join(' · ')}
                </span>
                {mode === 'run' && chatInvocation && onOpenChat ? (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenChat(chatInvocation);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      event.stopPropagation();
                      onOpenChat(chatInvocation);
                    }}
                    className="ml-auto flex-none rounded px-1.5 py-0.5 text-[var(--accent)] hover:bg-[var(--accent-subtle)]"
                    title="Open the latest agent chat"
                  >
                    Chat ↗
                  </span>
                ) : null}
              </span>
              {showDetails ? (
                <span className="mt-1 line-clamp-2 text-[var(--text-9)] leading-[1.35] text-[var(--muted-dim)]">
                  {node.prompt}
                </span>
              ) : null}
            </>
          ) : (
            <span className="mt-1.5 flex items-center gap-2 text-[var(--text-9)] text-[var(--muted)]">
              <span>{node.detail}</span>
              {mode === 'run' && summary.invocations.length > 0 ? (
                <span className="ml-auto font-mono text-[var(--text-8)] text-[var(--muted-dim)]">
                  {summary.invocations.filter((item) => item.status === 'completed').length}/
                  {summary.invocations.length}
                </span>
              ) : null}
            </span>
          )}
        </span>
      </span>
      <span className="pointer-events-none absolute -top-[5px] left-1/2 z-10 h-2 w-2 -translate-x-1/2 rounded-full border border-[var(--border)] bg-[var(--panel-raised)]" />
      <span
        className="pointer-events-none absolute -bottom-[5px] left-1/2 z-10 h-2 w-2 -translate-x-1/2 rounded-full border bg-[var(--panel-raised)]"
        style={{ borderColor: typeColor }}
      />
    </button>
  );
}

function InspectorSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-[var(--border-subtle)] px-3 py-3">
      <div
        className="mb-2 text-[var(--text-8)] font-[var(--weight-semibold)] uppercase tracking-[0.14em] text-[var(--muted-dim)]"
        style={{ fontFamily: 'var(--display)' }}
      >
        {label}
      </div>
      {children}
    </section>
  );
}

function WorkflowNodeInspector({
  node,
  mode,
  run,
  summary,
  ownerDroneId,
  tab,
  onTabChange,
  onClose,
  onInspectAgent,
  onOpenChat,
}: {
  node: WorkflowGraphNode;
  mode: GraphMode;
  run: WorkflowRun | null;
  summary: NodeExecutionSummary;
  ownerDroneId?: string;
  tab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  onClose: () => void;
  onInspectAgent?: (agentId: string) => void;
  onOpenChat?: (droneId: string, chatName: string) => void;
}) {
  const newest = latestInvocation(summary.invocations);
  const tabs: Array<{ id: InspectorTab; label: string; count?: number }> = [
    { id: 'overview', label: 'Info' },
    { id: 'input', label: 'Input' },
    { id: 'output', label: 'Output' },
    {
      id: 'chats',
      label: 'Chats',
      count: summary.invocations.filter((invocation) => invocation.lastChatName).length,
    },
  ];

  return (
    <aside className="flex w-[310px] flex-none flex-col border-l border-[var(--border)] bg-[var(--panel-alt)] shadow-[-18px_0_42px_var(--shadow-color)]">
      <div className="flex flex-none items-start gap-2 border-b border-[var(--border)] px-3 py-3">
        <span
          className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-lg border text-[11px]"
          style={{
            color: nodeTypeColor(node.type),
            borderColor: `color-mix(in srgb, ${nodeTypeColor(node.type)} 40%, var(--border))`,
            background: `color-mix(in srgb, ${nodeTypeColor(node.type)} 8%, var(--panel-raised))`,
          }}
        >
          {nodeTypeGlyph(node.type)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[var(--text-8)] uppercase tracking-[0.14em] text-[var(--muted-dim)]">
            {node.eyebrow}
          </span>
          <span className="mt-0.5 block text-[var(--text-12)] font-[var(--weight-semibold)] leading-tight text-[var(--fg-strong)]">
            {node.label}
          </span>
          <span className="mt-1 block truncate font-mono text-[var(--text-8)] text-[var(--muted)]">
            {node.sourceId}
          </span>
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close node inspector"
          className="flex h-7 w-7 flex-none items-center justify-center rounded text-[var(--text-14)] text-[var(--muted)] hover:bg-[var(--surface-softest)] hover:text-[var(--fg)]"
        >
          ×
        </button>
      </div>
      <div className="grid flex-none grid-cols-4 border-b border-[var(--border-subtle)] px-1.5">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onTabChange(item.id)}
            className={`relative h-9 truncate px-1 text-[var(--text-8)] font-[var(--weight-semibold)] uppercase tracking-[0.08em] ${
              tab === item.id ? 'text-[var(--fg)]' : 'text-[var(--muted-dim)] hover:text-[var(--muted)]'
            }`}
          >
            {item.label}
            {item.count ? ` ${item.count}` : ''}
            {tab === item.id ? (
              <span
                className="absolute inset-x-1 bottom-0 h-0.5 rounded-full"
                style={{ background: nodeTypeColor(node.type) }}
              />
            ) : null}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'overview' ? (
          <>
            {mode === 'run' ? (
              <InspectorSection label="Execution">
                <div className="flex items-center gap-2">
                  <NodeStatusBadge summary={summary} />
                  <span className="ml-auto font-mono text-[var(--text-9)] text-[var(--muted)]">
                    {summary.invocations.length} invocation
                    {summary.invocations.length === 1 ? '' : 's'}
                  </span>
                </div>
                {newest ? (
                  <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg bg-[var(--surface-inset)] p-2.5">
                    <span>
                      <span className="block text-[var(--text-8)] uppercase text-[var(--muted-dim)]">
                        Started
                      </span>
                      <span className="mt-0.5 block text-[var(--text-10)] text-[var(--fg)]">
                        {formatTimestamp(newest.startedAt)}
                      </span>
                    </span>
                    <span>
                      <span className="block text-[var(--text-8)] uppercase text-[var(--muted-dim)]">
                        Duration
                      </span>
                      <span className="mt-0.5 block text-[var(--text-10)] text-[var(--fg)]">
                        {formatDuration(newest.startedAt, newest.finishedAt)}
                      </span>
                    </span>
                  </div>
                ) : (
                  <p className="mt-2 text-[var(--text-10)] leading-relaxed text-[var(--muted)]">
                    This step has not been reached in the selected run.
                  </p>
                )}
              </InspectorSection>
            ) : null}
            <InspectorSection label="Step">
              <div className="space-y-2 text-[var(--text-10)]">
                <div className="flex gap-3">
                  <span className="w-14 flex-none text-[var(--muted-dim)]">Phase</span>
                  <span className="text-[var(--fg)]">{node.phaseId}</span>
                </div>
                <div className="flex gap-3">
                  <span className="w-14 flex-none text-[var(--muted-dim)]">Behavior</span>
                  <span className="text-[var(--fg)]">{node.detail}</span>
                </div>
                {node.agentId ? (
                  <>
                    <div className="flex gap-3">
                      <span className="w-14 flex-none text-[var(--muted-dim)]">Agent</span>
                      <button
                        type="button"
                        onClick={() => onInspectAgent?.(node.agentId!)}
                        className="text-left text-[var(--accent)] hover:underline"
                      >
                        {node.agentId} ↗
                      </button>
                    </div>
                    <div className="flex gap-3">
                      <span className="w-14 flex-none text-[var(--muted-dim)]">Runner</span>
                      <span className="text-[var(--fg)]">
                        {[node.runnerLabel, node.model].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                  </>
                ) : null}
              </div>
            </InspectorSection>
            {node.permissions?.length ? (
              <InspectorSection label="Permissions">
                <div className="flex flex-wrap gap-1.5">
                  {node.permissions.map((permission) => (
                    <span
                      key={permission}
                      className="rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-2 py-1 font-mono text-[var(--text-8)] text-[var(--muted)]"
                    >
                      {permission}
                    </span>
                  ))}
                </div>
              </InspectorSection>
            ) : null}
          </>
        ) : null}
        {tab === 'input' ? (
          <>
            {node.prompt ? (
              <InspectorSection label="Prompt">
                <div className="whitespace-pre-wrap text-[var(--text-10)] leading-relaxed text-[var(--fg)]">
                  {node.prompt}
                </div>
              </InspectorSection>
            ) : null}
            <InspectorSection label="Run input">
              <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--surface-inset)] p-2.5 font-mono text-[var(--text-9)] leading-relaxed text-[var(--fg)]">
                {run ? jsonText(run.input) : 'Select a run to inspect its resolved input.'}
              </pre>
            </InspectorSection>
          </>
        ) : null}
        {tab === 'output' ? (
          <InspectorSection label={summary.invocations.length > 1 ? 'Invocation outputs' : 'Output'}>
            {summary.invocations.length > 0 ? (
              <div className="space-y-2">
                {[...summary.invocations]
                  .sort((left, right) => left.ordinal - right.ordinal)
                  .map((invocation) => (
                    <details
                      key={invocation.id}
                      open={summary.invocations.length === 1}
                      className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-softest)]"
                    >
                      <summary className="cursor-pointer px-2.5 py-2 text-[var(--text-9)] text-[var(--fg)]">
                        <span className="font-mono text-[var(--muted)]">
                          #{invocation.ordinal}
                        </span>{' '}
                        {executionStatusLabel(invocation.status)}
                      </summary>
                      <pre className="max-h-[300px] overflow-auto whitespace-pre-wrap border-t border-[var(--border-subtle)] bg-[var(--surface-inset)] p-2.5 font-mono text-[var(--text-9)] leading-relaxed text-[var(--fg)]">
                        {invocation.error ??
                          invocation.textResult ??
                          jsonText(invocation.structuredResult)}
                      </pre>
                    </details>
                  ))}
              </div>
            ) : run?.output !== null && run?.output !== undefined ? (
              <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--surface-inset)] p-2.5 font-mono text-[var(--text-9)] leading-relaxed text-[var(--fg)]">
                {jsonText(run.output)}
              </pre>
            ) : (
              <p className="text-[var(--text-10)] leading-relaxed text-[var(--muted)]">
                No output has been recorded for this step.
              </p>
            )}
          </InspectorSection>
        ) : null}
        {tab === 'chats' ? (
          <InspectorSection label="Agent conversations">
            {summary.invocations.some((invocation) => invocation.lastChatName) ? (
              <div className="space-y-2">
                {summary.invocations
                  .filter((invocation) => invocation.lastChatName)
                  .map((invocation) => (
                    <button
                      key={invocation.id}
                      type="button"
                      onClick={() =>
                        onOpenChat?.(
                          invocation.executionDroneId || ownerDroneId || '',
                          invocation.lastChatName!,
                        )
                      }
                      className="group flex w-full items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-2.5 py-2 text-left hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)]"
                    >
                      <span className="flex h-7 w-7 flex-none items-center justify-center rounded bg-[var(--accent-subtle)] text-[var(--accent)]">
                        ◌
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--fg)]">
                          {invocation.lastChatName}
                        </span>
                        <span className="mt-0.5 block text-[var(--text-8)] text-[var(--muted-dim)]">
                          Invocation #{invocation.ordinal} · {invocation.status}
                        </span>
                      </span>
                      <span className="text-[var(--accent)]">↗</span>
                    </button>
                  ))}
              </div>
            ) : (
              <p className="text-[var(--text-10)] leading-relaxed text-[var(--muted)]">
                No chat is attached to this step in the selected run.
              </p>
            )}
          </InspectorSection>
        ) : null}
      </div>
    </aside>
  );
}

function WorkflowAgentsInspector({
  workflow,
  layout,
  selectedAgentId,
  onSelectAgent,
  onSelectNode,
}: {
  workflow: DroneWorkflow;
  layout: WorkflowGraphLayout;
  selectedAgentId: string;
  onSelectAgent: (agentId: string) => void;
  onSelectNode: (nodeKey: string) => void;
}) {
  const agentIds = Object.keys(workflow.definition.agents);
  const agent = workflow.definition.agents[selectedAgentId];
  if (!selectedAgentId || !agent) {
    return (
      <aside className="flex w-[310px] flex-none flex-col border-l border-[var(--border)] bg-[var(--panel-alt)] shadow-[-18px_0_42px_var(--shadow-color)]">
        <div className="flex h-11 flex-none items-center border-b border-[var(--border)] px-3">
          <span className="text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--fg-strong)]">
            Agents
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="divide-y divide-[var(--border-subtle)]">
            {agentIds.map((agentId) => {
              const candidate = workflow.definition.agents[agentId]!;
              const callCount = workflowCallsForAgent(layout, agentId).length;
              return (
                <button
                  key={agentId}
                  type="button"
                  onClick={() => onSelectAgent(agentId)}
                  className="flex w-full items-center px-3 py-3 text-left hover:bg-[var(--surface-softest)] focus-visible:bg-[var(--surface-softest)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--accent-muted)]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--fg)]">
                      {agentId}
                    </span>
                    <span className="mt-0.5 block truncate text-[var(--text-8)] text-[var(--muted-dim)]">
                      {candidate.runner.agent.id} ·{' '}
                      {candidate.runner.kind === 'drone' ? 'child drone' : 'chat'} ·{' '}
                      {callCount} call{callCount === 1 ? '' : 's'}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </aside>
    );
  }
  const calls = workflowCallsForAgent(layout, selectedAgentId);
  const runnerLabel = agent.runner.kind === 'drone' ? 'Child drone' : 'Chat';
  const builtinAgent =
    agent.runner.agent.id.charAt(0).toUpperCase() + agent.runner.agent.id.slice(1);

  return (
    <aside className="flex w-[310px] flex-none flex-col border-l border-[var(--border)] bg-[var(--panel-alt)] shadow-[-18px_0_42px_var(--shadow-color)]">
      <div className="flex min-h-11 flex-none items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <button
          type="button"
          onClick={() => onSelectAgent('')}
          aria-label="Back to agents"
          className="flex h-7 w-7 flex-none items-center justify-center rounded text-[22px] leading-none text-[var(--muted)] hover:bg-[var(--surface-softest)] hover:text-[var(--fg)]"
        >
          ‹
        </button>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--fg-strong)]">
            {selectedAgentId}
          </span>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <InspectorSection label="Agent">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-[var(--accent-border)] bg-[var(--accent-subtle)] font-mono text-[var(--text-10)] text-[var(--accent)]">
              {selectedAgentId.slice(0, 2).toUpperCase()}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-mono text-[var(--text-12)] font-[var(--weight-semibold)] text-[var(--fg-strong)]">
                {selectedAgentId}
              </span>
              <span className="mt-0.5 block text-[var(--text-9)] text-[var(--muted)]">
                {builtinAgent} · {runnerLabel}
              </span>
            </span>
          </div>
          <div className="mt-3 space-y-2 rounded-lg bg-[var(--surface-inset)] p-2.5 text-[var(--text-9)]">
            <div className="flex gap-3">
              <span className="w-16 flex-none text-[var(--muted-dim)]">Runner</span>
              <span className="text-[var(--fg)]">{runnerLabel}</span>
            </div>
            <div className="flex gap-3">
              <span className="w-16 flex-none text-[var(--muted-dim)]">Agent</span>
              <span className="text-[var(--fg)]">{builtinAgent}</span>
            </div>
            <div className="flex gap-3">
              <span className="w-16 flex-none text-[var(--muted-dim)]">Model</span>
              <span className="min-w-0 break-all font-mono text-[var(--fg)]">
                {agent.model || agent.runner.agent.id}
              </span>
            </div>
          </div>
        </InspectorSection>
        <InspectorSection label="Instructions">
          <div className="whitespace-pre-wrap text-[var(--text-10)] leading-relaxed text-[var(--fg)]">
            {agent.instructions || (
              <span className="italic text-[var(--muted-dim)]">No agent instructions.</span>
            )}
          </div>
        </InspectorSection>
        <InspectorSection label="Permissions">
          {agent.permissions.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {agent.permissions.map((permission) => (
                <span
                  key={permission}
                  className="rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-2 py-1 font-mono text-[var(--text-8)] text-[var(--muted)]"
                >
                  {permission}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-[var(--text-10)] text-[var(--muted-dim)]">
              No permissions requested.
            </span>
          )}
        </InspectorSection>
        <InspectorSection label={`Used by · ${calls.length}`}>
          {calls.length > 0 ? (
            <div className="space-y-2">
              {calls.map((call) => (
                <button
                  key={call.key}
                  type="button"
                  onClick={() => onSelectNode(call.key)}
                  className="group w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-softest)] p-2.5 text-left hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)]"
                >
                  <span className="flex items-start gap-2">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--fg)]">
                        {call.label}
                      </span>
                      <span className="mt-0.5 block font-mono text-[var(--text-8)] text-[var(--muted-dim)]">
                        {call.phaseId} / {call.sourceId}
                      </span>
                    </span>
                    <span className="text-[var(--accent)]">↗</span>
                  </span>
                  {call.prompt ? (
                    <span className="mt-2 line-clamp-3 block text-[var(--text-9)] leading-relaxed text-[var(--muted)]">
                      {call.prompt}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : (
            <span className="text-[var(--text-10)] text-[var(--muted-dim)]">
              This agent is not referenced by a call node.
            </span>
          )}
        </InspectorSection>
      </div>
    </aside>
  );
}

function WorkflowRunConversationsInspector({
  workflow,
  layout,
  run,
  invocations,
  ownerDroneId,
  onSelectNode,
  onOpenChat,
  onClose,
}: {
  workflow: DroneWorkflow;
  layout: WorkflowGraphLayout;
  run: WorkflowRun;
  invocations: WorkflowInvocation[];
  ownerDroneId?: string;
  onSelectNode: (nodeKey: string) => void;
  onOpenChat?: (droneId: string, chatName: string) => void;
  onClose: () => void;
}) {
  const groups = workflowRunAgentGroups(workflow, layout, invocations);
  const chatCount = invocations.filter((invocation) => invocation.lastChatName).length;
  const callByRef = new Map(
    layout.nodes
      .filter((node) => node.type === 'call')
      .map((node) => [`${node.phaseId}\u0000${node.sourceId}`, node]),
  );

  return (
    <aside className="flex w-[330px] flex-none flex-col border-l border-[var(--border)] bg-[var(--panel-alt)] shadow-[-18px_0_42px_var(--shadow-color)]">
      <div className="flex flex-none items-start gap-2 border-b border-[var(--border)] px-3 py-3">
        <span className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-lg border border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent)]">
          ◌
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[var(--text-8)] uppercase tracking-[0.14em] text-[var(--muted-dim)]">
            Run conversations
          </span>
          <span className="mt-0.5 block text-[var(--text-12)] font-[var(--weight-semibold)] leading-tight text-[var(--fg-strong)]">
            {chatCount} chat{chatCount === 1 ? '' : 's'} across {groups.length} agent
            {groups.length === 1 ? '' : 's'}
          </span>
          <span className="mt-1 block truncate font-mono text-[var(--text-8)] text-[var(--muted)]">
            #{run.id.length > 10 ? run.id.slice(-6) : run.id}
          </span>
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close run conversations"
          className="flex h-7 w-7 flex-none items-center justify-center rounded text-[var(--text-14)] text-[var(--muted)] hover:bg-[var(--surface-softest)] hover:text-[var(--fg)]"
        >
          ×
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
        <div className="space-y-2.5">
          {groups.map((group) => {
            const agent = workflow.definition.agents[group.agentId]!;
            const invokedCallRefs = new Set(
              group.invocations.map(
                (invocation) => `${invocation.phaseId}\u0000${invocation.nodeId}`,
              ),
            );
            const unreachedCalls = group.calls.filter(
              (call) => !invokedCallRefs.has(`${call.phaseId}\u0000${call.sourceId}`),
            );
            const groupChats = group.invocations.filter(
              (invocation) => invocation.lastChatName,
            ).length;
            const active = group.invocations.some(
              (invocation) => invocation.status === 'running',
            );
            return (
              <section
                key={group.agentId}
                className="overflow-hidden rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-softest)]"
              >
                <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--surface-inset)] px-2.5 py-2">
                  <span
                    className="relative flex h-2 w-2 flex-none rounded-full"
                    style={{
                      background: active
                        ? 'var(--accent)'
                        : group.invocations.length > 0
                          ? 'var(--green)'
                          : 'var(--muted-dim)',
                    }}
                  >
                    {active ? (
                      <span className="absolute inset-0 animate-ping rounded-full bg-[var(--accent)] opacity-55" />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--fg)]">
                      {group.agentId}
                    </span>
                    <span className="mt-0.5 block truncate text-[var(--text-8)] text-[var(--muted-dim)]">
                      {agent.runner.agent.id} ·{' '}
                      {agent.runner.kind === 'drone' ? 'child drone' : 'chat'}
                    </span>
                  </span>
                  <span className="flex-none rounded-full bg-[var(--surface-strong)] px-2 py-0.5 font-mono text-[var(--text-8)] text-[var(--muted)]">
                    {groupChats} chat{groupChats === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="divide-y divide-[var(--border-subtle)]">
                  {[...group.invocations]
                    .sort((left, right) => left.ordinal - right.ordinal)
                    .map((invocation) => {
                      const call = callByRef.get(
                        `${invocation.phaseId}\u0000${invocation.nodeId}`,
                      );
                      const statusColor = executionStatusColor(invocation.status);
                      return (
                        <div key={invocation.id} className="px-2.5 py-2.5">
                          <div className="flex items-start gap-2">
                            <span className="mt-1 flex h-2 w-2 flex-none items-center justify-center">
                              <span
                                className="h-1.5 w-1.5 rounded-full"
                                style={{ background: statusColor }}
                              />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[var(--text-10)] font-[var(--weight-semibold)] leading-tight text-[var(--fg)]">
                                {call?.label || invocation.nodeId}
                              </span>
                              <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[var(--text-8)]">
                                <span className="font-mono text-[var(--muted-dim)]">
                                  #{invocation.ordinal}
                                </span>
                                <span style={{ color: statusColor }}>
                                  {executionStatusLabel(invocation.status)}
                                </span>
                                <span className="text-[var(--muted-dim)]">
                                  {formatDuration(
                                    invocation.startedAt,
                                    invocation.finishedAt,
                                  )}
                                </span>
                              </span>
                              {invocation.lastChatName ? (
                                <span className="mt-1.5 block truncate text-[var(--text-9)] text-[var(--muted)]">
                                  {invocation.lastChatName}
                                </span>
                              ) : (
                                <span className="mt-1.5 block text-[var(--text-8)] italic text-[var(--muted-dim)]">
                                  No chat available yet
                                </span>
                              )}
                            </span>
                          </div>
                          <div className="mt-2 flex items-center justify-end gap-1.5">
                            {call ? (
                              <button
                                type="button"
                                onClick={() => onSelectNode(call.key)}
                                className="h-6 rounded px-2 text-[var(--text-8)] uppercase tracking-wide text-[var(--muted)] hover:bg-[var(--surface-strong)] hover:text-[var(--fg)]"
                              >
                                Inspect
                              </button>
                            ) : null}
                            {invocation.lastChatName ? (
                              <button
                                type="button"
                                onClick={() =>
                                  onOpenChat?.(
                                    invocation.executionDroneId || ownerDroneId || '',
                                    invocation.lastChatName!,
                                  )
                                }
                                className="h-6 rounded border border-[var(--accent-border)] bg-[var(--accent-subtle)] px-2 text-[var(--text-8)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--accent)] hover:border-[var(--accent-muted)]"
                              >
                                Open chat ↗
                              </button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  {unreachedCalls.map((call) => (
                    <button
                      key={call.key}
                      type="button"
                      onClick={() => onSelectNode(call.key)}
                      className="flex w-full items-center gap-2 px-2.5 py-2.5 text-left opacity-65 hover:bg-[var(--surface-softest)] hover:opacity-100"
                    >
                      <span className="h-1.5 w-1.5 flex-none rounded-full bg-[var(--muted-dim)]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[var(--text-9)] text-[var(--fg-secondary)]">
                          {call.label}
                        </span>
                        <span className="mt-0.5 block font-mono text-[var(--text-8)] text-[var(--muted-dim)]">
                          Not reached
                        </span>
                      </span>
                      <span className="text-[var(--muted-dim)]">→</span>
                    </button>
                  ))}
                  {group.invocations.length === 0 && unreachedCalls.length === 0 ? (
                    <div className="px-2.5 py-3 text-[var(--text-9)] italic text-[var(--muted-dim)]">
                      Not used by this workflow.
                    </div>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

export function WorkflowDefinitionView({
  workflow,
  run = null,
  invocations = [],
  ownerDroneId,
  onOpenChat,
}: Props) {
  const layout = React.useMemo(() => buildWorkflowGraphLayout(workflow), [workflow]);
  const executionByNode = React.useMemo(
    () => buildWorkflowNodeExecutionMap(layout, invocations),
    [invocations, layout],
  );
  const viewportContainerRef = React.useRef<HTMLDivElement | null>(null);
  const reactFlowRef =
    React.useRef<ReactFlowInstance<WorkflowCanvasNode, WorkflowCanvasEdge> | null>(null);
  const viewportInteractedRef = React.useRef(false);
  const agentIds = React.useMemo(
    () => Object.keys(workflow.definition.agents),
    [workflow.definition.agents],
  );
  const [mode, setMode] = React.useState<GraphMode>('definition');
  const [showDetails, setShowDetails] = React.useState(true);
  const [query, setQuery] = React.useState('');
  const [selectedNodeKey, setSelectedNodeKey] = React.useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = React.useState<string | null>(null);
  const [runConversationsOpen, setRunConversationsOpen] = React.useState(false);
  const [inspectorTab, setInspectorTab] = React.useState<InspectorTab>('overview');
  const [scale, setScale] = React.useState(1);
  const nodesByKey = React.useMemo(
    () => new Map(layout.nodes.map((node) => [node.key, node])),
    [layout.nodes],
  );
  const selectedNode = selectedNodeKey ? nodesByKey.get(selectedNodeKey) ?? null : null;
  const selectedSummary = selectedNodeKey
    ? executionByNode.get(selectedNodeKey) ?? { status: 'idle' as const, invocations: [] }
    : { status: 'idle' as const, invocations: [] };
  const normalizedQuery = query.trim().toLowerCase();
  const completedInvocations = invocations.filter(
    (invocation) => invocation.status === 'completed',
  ).length;
  const activeInvocations = invocations.filter(
    (invocation) => invocation.status === 'running',
  ).length;
  const failedInvocations = invocations.filter(
    (invocation) => invocation.status === 'failed',
  ).length;
  const availableChatCount = invocations.filter(
    (invocation) => invocation.lastChatName,
  ).length;

  React.useEffect(() => {
    viewportInteractedRef.current = false;
    setScale(1);
    setSelectedNodeKey(null);
    setSelectedAgentId(null);
    setRunConversationsOpen(false);
    setMode('definition');
    setQuery('');
  }, [workflow.id]);

  React.useEffect(() => {
    if (!run) return;
    setMode('run');
    setSelectedAgentId(null);
    const active =
      invocations.find((invocation) => invocation.status === 'running') ??
      [...invocations].sort((left, right) => right.ordinal - left.ordinal)[0];
    if (!active) return;
    const matchingNode = layout.nodes.find(
      (node) =>
        node.type === 'call' &&
        node.phaseId === active.phaseId &&
        node.sourceId === active.nodeId,
    );
    if (matchingNode) setSelectedNodeKey(matchingNode.key);
  }, [invocations, layout.nodes, run?.id]);

  const zoomBy = React.useCallback((delta: number) => {
    const instance = reactFlowRef.current;
    if (!instance) return;
    const currentScale = instance.getZoom();
    const nextScale = clampScale(currentScale + delta);
    if (nextScale === currentScale) return;
    void instance.zoomTo(nextScale);
  }, []);

  const fitGraph = React.useCallback(() => {
    const viewport = viewportContainerRef.current;
    const instance = reactFlowRef.current;
    if (!viewport || !instance || viewport.clientWidth <= 0 || viewport.clientHeight <= 0) return;
    const fitted = workflowFitViewport({
      viewportWidth: viewport.clientWidth,
      viewportHeight: viewport.clientHeight,
      graphWidth: layout.width,
      graphHeight: layout.height,
    });
    void instance.setViewport({
      x: fitted.panX,
      y: fitted.panY,
      zoom: fitted.scale,
    });
  }, [layout.height, layout.width]);

  React.useEffect(() => {
    const viewport = viewportContainerRef.current;
    if (!viewport) return;
    let frame = 0;
    const fitBeforeInteraction = () => {
      if (viewportInteractedRef.current) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!viewportInteractedRef.current) fitGraph();
      });
    };
    fitBeforeInteraction();
    if (typeof ResizeObserver === 'undefined') {
      return () => cancelAnimationFrame(frame);
    }
    const observer = new ResizeObserver(fitBeforeInteraction);
    observer.observe(viewport);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [fitGraph, selectedNodeKey, workflow.id]);

  const onViewportKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        viewportInteractedRef.current = true;
        zoomBy(SCALE_STEP);
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        viewportInteractedRef.current = true;
        zoomBy(-SCALE_STEP);
      } else if (event.key === '0') {
        event.preventDefault();
        viewportInteractedRef.current = true;
        fitGraph();
      } else if (event.key === 'Escape') {
        setSelectedNodeKey(null);
        setSelectedAgentId(null);
        setRunConversationsOpen(false);
      }
    },
    [fitGraph, zoomBy],
  );

  const openInvocationChat = React.useCallback(
    (invocation: WorkflowInvocation) => {
      if (!invocation.lastChatName) return;
      onOpenChat?.(
        invocation.executionDroneId || ownerDroneId || '',
        invocation.lastChatName,
      );
    },
    [onOpenChat, ownerDroneId],
  );

  const canvasNodes = React.useMemo<WorkflowCanvasNode[]>(() => {
    const phaseNodes: WorkflowCanvasNode[] = layout.phaseRegions.map((region) => {
      const summary = summarizeInvocations(
        invocations.filter((invocation) => invocation.phaseId === region.phaseId),
      );
      const completedInPhase = summary.invocations.filter(
        (invocation) => invocation.status === 'completed',
      ).length;
      return {
        id: region.key,
        type: 'phase',
        position: { x: region.x, y: region.y },
        data: {
          content: (
            <div
              data-workflow-phase-region={region.phaseId}
              className="h-full w-full overflow-hidden rounded-[14px] border bg-[var(--surface-faint)]"
              style={{
                borderColor:
                  mode === 'run' && summary.status !== 'idle'
                    ? `color-mix(in srgb, ${executionStatusColor(summary.status)} 32%, var(--border-subtle))`
                    : 'var(--canvas-related-subtle)',
              }}
            >
              <div className="flex h-[38px] min-w-0 items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--panel-overlay-soft)] px-3">
                <span
                  className="flex-none whitespace-nowrap text-[var(--text-8)] font-[var(--weight-semibold)] uppercase tracking-[0.14em] text-[var(--canvas-related)]"
                  style={{ fontFamily: 'var(--display)' }}
                >
                  {String(region.index + 1).padStart(2, '0')}
                </span>
                <span className="min-w-0 truncate text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--fg)]">
                  {region.label}
                </span>
                {mode === 'run' ? (
                  <span
                    className="ml-auto flex h-5 flex-none items-center gap-1.5 rounded-full px-2 text-[var(--text-8)] uppercase tracking-wide"
                    style={{
                      color: executionStatusColor(summary.status),
                      background: `color-mix(in srgb, ${executionStatusColor(summary.status)} 9%, transparent)`,
                    }}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: executionStatusColor(summary.status) }}
                    />
                    {executionStatusLabel(summary.status)}
                    {summary.invocations.length > 0 ? (
                      <span className="font-mono opacity-70">
                        · {completedInPhase}/{summary.invocations.length}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <span className="ml-auto flex-none whitespace-nowrap font-mono text-[var(--text-8)] text-[var(--muted-dim)]">
                    {region.nodeCount} nodes
                  </span>
                )}
              </div>
            </div>
          ),
        },
        style: { width: region.width, height: region.height, pointerEvents: 'none' },
        draggable: false,
        selectable: false,
        focusable: false,
        zIndex: -1,
      };
    });

    const graphNodes: WorkflowCanvasNode[] = layout.nodes.map((node) => {
      const summary =
        executionByNode.get(node.key) ?? { status: 'idle' as const, invocations: [] };
      const matches =
        !normalizedQuery ||
        `${node.label} ${node.sourceId} ${node.agentId ?? ''} ${node.prompt ?? ''}`
          .toLowerCase()
          .includes(normalizedQuery);
      return {
        id: node.key,
        type: 'workflow',
        position: { x: node.x, y: node.y },
        data: {
          content: (
            <WorkflowGraphCard
              node={node}
              mode={mode}
              summary={summary}
              selected={
                selectedNodeKey === node.key ||
                Boolean(selectedAgentId && node.agentId === selectedAgentId)
              }
              showDetails={showDetails}
              dimmed={!matches || Boolean(selectedAgentId && node.agentId !== selectedAgentId)}
              onSelect={() => {
                setSelectedAgentId(null);
                setRunConversationsOpen(false);
                setSelectedNodeKey(node.key);
                setInspectorTab('overview');
              }}
              onOpenChat={onOpenChat ? openInvocationChat : undefined}
            />
          ),
        },
        style: {
          width: WORKFLOW_GRAPH_NODE_WIDTH,
          height: WORKFLOW_GRAPH_NODE_HEIGHT,
          pointerEvents: 'auto',
        },
        draggable: false,
        selectable: false,
        focusable: false,
        zIndex: 2,
        ariaLabel: `${node.eyebrow}: ${node.label}`,
      };
    });

    return [...phaseNodes, ...graphNodes];
  }, [
    executionByNode,
    invocations,
    layout.nodes,
    layout.phaseRegions,
    mode,
    normalizedQuery,
    onOpenChat,
    openInvocationChat,
    selectedAgentId,
    selectedNodeKey,
    showDetails,
  ]);

  const canvasEdges = React.useMemo<WorkflowCanvasEdge[]>(
    () =>
      layout.edges.flatMap((edge) => {
        const source = nodesByKey.get(edge.from);
        const target = nodesByKey.get(edge.to);
        if (!source || !target) return [];
        const sourceSummary =
          executionByNode.get(source.key) ?? { status: 'idle' as const, invocations: [] };
        const targetSummary =
          executionByNode.get(target.key) ?? { status: 'idle' as const, invocations: [] };
        const runColor =
          targetSummary.status === 'failed'
            ? 'var(--red)'
            : targetSummary.status === 'running'
              ? 'var(--accent)'
              : sourceSummary.status === 'completed' && targetSummary.status === 'completed'
                ? 'var(--green)'
                : 'var(--muted-dim)';
        const definitionColor =
          edge.variant === 'loop'
            ? 'var(--yellow)'
            : edge.variant === 'branch'
              ? 'var(--accent)'
              : 'var(--canvas-related-muted)';
        const color = mode === 'run' ? runColor : definitionColor;
        const active = mode === 'run' && targetSummary.status === 'running';
        const labelPosition = edge.label
          ? edgeLabelPosition(source, target, edge.variant)
          : undefined;
        return [
          {
            id: edge.key,
            type: 'workflow',
            source: edge.from,
            target: edge.to,
            sourceHandle:
              edge.variant === 'phase' || edge.variant === 'loop'
                ? 'right-source'
                : 'bottom-source',
            targetHandle:
              edge.variant === 'phase'
                ? 'left-target'
                : edge.variant === 'loop'
                  ? 'right-target'
                  : 'top-target',
            data: {
              path: edgePath(edge, source, target),
              label: edge.label,
              labelX: labelPosition?.x,
              labelY: labelPosition?.y,
            },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color,
              width: 12,
              height: 12,
            },
            style: {
              stroke: color,
              strokeWidth: active ? 2.5 : edge.variant === 'phase' ? 1.7 : 1.8,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
              strokeDasharray:
                edge.variant === 'loop'
                  ? '5 6'
                  : mode === 'run' && targetSummary.status === 'idle'
                    ? '3 7'
                    : undefined,
              opacity: mode === 'run' && targetSummary.status === 'idle' ? 0.42 : 0.9,
            },
            selectable: false,
            focusable: false,
            deletable: false,
            reconnectable: false,
            zIndex: 0,
          } satisfies WorkflowCanvasEdge,
        ];
      }),
    [executionByNode, layout.edges, mode, nodesByKey],
  );

  const onGraphInit = React.useCallback(
    (instance: ReactFlowInstance<WorkflowCanvasNode, WorkflowCanvasEdge>) => {
      reactFlowRef.current = instance;
      requestAnimationFrame(() => fitGraph());
    },
    [fitGraph],
  );

  return (
    <section className="flex min-h-[360px] flex-1 flex-col overflow-hidden border-y border-[var(--border)] bg-[var(--panel)]">
      <div className="flex min-h-11 flex-none flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--panel-alt)] px-2.5 py-1.5">
        <div className="flex h-7 items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-0.5">
          <button
            type="button"
            onClick={() => {
              setMode('definition');
              setRunConversationsOpen(false);
            }}
            className={`h-6 rounded-md px-2.5 text-[var(--text-9)] font-[var(--weight-semibold)] ${
              mode === 'definition'
                ? 'bg-[var(--panel-raised)] text-[var(--fg)] shadow-sm'
                : 'text-[var(--muted)] hover:text-[var(--fg)]'
            }`}
          >
            Definition
          </button>
          <button
            type="button"
            onClick={() => {
              if (!run) return;
              setMode('run');
              setSelectedAgentId(null);
              setRunConversationsOpen(false);
            }}
            disabled={!run}
            className={`flex h-6 items-center gap-1.5 rounded-md px-2.5 text-[var(--text-9)] font-[var(--weight-semibold)] ${
              mode === 'run'
                ? 'bg-[var(--panel-raised)] text-[var(--fg)] shadow-sm'
                : 'text-[var(--muted)] hover:text-[var(--fg)]'
            } disabled:cursor-not-allowed disabled:opacity-35`}
          >
            {run ? (
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  background:
                    run.status === 'completed'
                      ? 'var(--green)'
                      : run.status === 'failed'
                        ? 'var(--red)'
                        : 'var(--accent)',
                }}
              />
            ) : null}
            Run
          </button>
        </div>
        {mode === 'run' && run ? (
          <>
            <span className="h-4 w-px bg-[var(--border-subtle)]" />
            <span className="font-mono text-[var(--text-8)] text-[var(--muted-dim)]">
              #{run.id.length > 10 ? run.id.slice(-6) : run.id}
            </span>
            <span className="capitalize text-[var(--text-9)] font-[var(--weight-semibold)] text-[var(--fg)]">
              {workflowStatusLabel(run.status)}
            </span>
            <span className="font-mono text-[var(--text-8)] text-[var(--muted-dim)]">
              {formatDuration(run.startedAt, run.finishedAt)}
            </span>
            <span className="hidden text-[var(--text-8)] text-[var(--muted)] min-[900px]:inline">
              <strong className="font-[var(--weight-semibold)] text-[var(--green)]">
                {completedInvocations}
              </strong>{' '}
              complete
              {activeInvocations ? (
                <>
                  {' '}
                  ·{' '}
                  <strong className="font-[var(--weight-semibold)] text-[var(--accent)]">
                    {activeInvocations}
                  </strong>{' '}
                  active
                </>
              ) : null}
              {failedInvocations ? (
                <>
                  {' '}
                  ·{' '}
                  <strong className="font-[var(--weight-semibold)] text-[var(--red)]">
                    {failedInvocations}
                  </strong>{' '}
                  failed
                </>
              ) : null}
            </span>
          </>
        ) : (
          <span className="text-[var(--text-8)] text-[var(--muted-dim)]">
            {workflow.definition.phases.length} phases · {layout.nodes.length} nodes
          </span>
        )}
        {mode === 'definition' && agentIds.length > 0 ? (
          <button
            type="button"
            aria-pressed={selectedAgentId !== null}
            onClick={() => {
              if (selectedAgentId !== null) {
                setSelectedAgentId(null);
                return;
              }
              setSelectedNodeKey(null);
              setRunConversationsOpen(false);
              setSelectedAgentId('');
            }}
            className={`flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[var(--text-8)] font-[var(--weight-semibold)] uppercase tracking-[0.08em] ${
              selectedAgentId !== null
                ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                : 'border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--muted)] hover:border-[var(--border)] hover:text-[var(--fg)]'
            }`}
            title="Inspect workflow agent definitions"
          >
            Agents
          </button>
        ) : null}
        {mode === 'run' && run ? (
          <button
            type="button"
            aria-pressed={runConversationsOpen}
            onClick={() => {
              setSelectedAgentId(null);
              setSelectedNodeKey(null);
              setRunConversationsOpen((current) => !current);
            }}
            className={`flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[var(--text-8)] font-[var(--weight-semibold)] uppercase tracking-[0.08em] ${
              runConversationsOpen
                ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                : 'border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--muted)] hover:border-[var(--border)] hover:text-[var(--fg)]'
            }`}
            title="Browse every agent conversation in this run"
          >
            <span aria-hidden="true">◌</span>
            Conversations
            <span className="font-mono opacity-60">{availableChatCount}</span>
          </button>
        ) : null}
        <div className="ml-auto flex items-center gap-1.5">
          <label className="relative hidden h-7 items-center min-[760px]:flex">
            <span className="pointer-events-none absolute left-2 text-[var(--text-10)] text-[var(--muted-dim)]">
              ⌕
            </span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find step"
              aria-label="Find a workflow step"
              className="h-7 w-28 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-inset)] pl-6 pr-2 text-[var(--text-9)] text-[var(--fg)] outline-none placeholder:text-[var(--muted-dim)] focus:w-40 focus:border-[var(--accent-muted)]"
            />
          </label>
          <button
            type="button"
            aria-pressed={showDetails}
            onClick={() => setShowDetails((current) => !current)}
            className={`hidden h-7 rounded-lg border px-2 text-[var(--text-8)] uppercase tracking-wide min-[680px]:block ${
              showDetails
                ? 'border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                : 'border-[var(--border-subtle)] text-[var(--muted)]'
            }`}
            title="Toggle prompt previews"
          >
            Details
          </button>
          <span className="mx-0.5 h-4 w-px bg-[var(--border-subtle)]" />
          <button
            type="button"
            onClick={() => {
              viewportInteractedRef.current = true;
              zoomBy(-SCALE_STEP);
            }}
            disabled={scale <= MIN_SCALE}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--text-12)] text-[var(--muted)] hover:border-[var(--border)] hover:text-[var(--fg)] disabled:opacity-35"
            aria-label="Zoom workflow out"
          >
            −
          </button>
          <span
            aria-label={`Workflow zoom ${Math.round(scale * 100)} percent`}
            className="flex h-7 min-w-[46px] items-center justify-center px-1.5 font-mono text-[var(--text-8)] text-[var(--muted)]"
          >
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            onClick={() => {
              viewportInteractedRef.current = true;
              fitGraph();
            }}
            className="h-7 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-2 text-[var(--text-8)] font-[var(--weight-semibold)] text-[var(--muted)] hover:border-[var(--border)] hover:text-[var(--fg)]"
            title="Reset the workflow graph position and zoom"
          >
            Reset view
          </button>
          <button
            type="button"
            onClick={() => {
              viewportInteractedRef.current = true;
              zoomBy(SCALE_STEP);
            }}
            disabled={scale >= MAX_SCALE}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--text-12)] text-[var(--muted)] hover:border-[var(--border)] hover:text-[var(--fg)] disabled:opacity-35"
            aria-label="Zoom workflow in"
          >
            +
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div
          ref={viewportContainerRef}
          tabIndex={0}
          role="region"
          aria-label="Workflow graph. Drag to pan, use the mouse wheel or pinch gesture to zoom, and select a node to inspect it."
          data-workflow-graph-viewport="1"
          className="relative min-h-0 min-w-0 flex-1 select-none overflow-hidden bg-[var(--panel)] outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--accent-muted)]"
          style={{
            backgroundImage:
              'linear-gradient(180deg, color-mix(in srgb, var(--canvas-related) 3%, transparent), transparent 36%)',
          }}
          onKeyDown={onViewportKeyDown}
        >
          <WorkflowGraphCanvas
            nodes={canvasNodes}
            edges={canvasEdges}
            minZoom={MIN_SCALE}
            maxZoom={MAX_SCALE}
            onInit={onGraphInit}
            onMoveStart={(event) => {
              if (event) viewportInteractedRef.current = true;
            }}
            onMove={(_event, viewport) => setScale(viewport.zoom)}
          />
          <div className="pointer-events-none absolute bottom-2.5 left-2.5 flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-overlay)] px-2.5 py-1.5 text-[var(--text-8)] text-[var(--muted-dim)] shadow-[0_8px_24px_var(--shadow-color)] backdrop-blur">
            {mode === 'run' ? (
              <>
                {(['completed', 'running', 'queued', 'failed'] as NodeExecutionStatus[]).map(
                  (status) => (
                    <span key={status} className="flex items-center gap-1">
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: executionStatusColor(status) }}
                      />
                      {executionStatusLabel(status)}
                    </span>
                  ),
                )}
              </>
            ) : (
              <>Drag to pan · wheel or pinch to zoom · select any step to inspect</>
            )}
          </div>
        </div>
        {runConversationsOpen && run ? (
          <WorkflowRunConversationsInspector
            workflow={workflow}
            layout={layout}
            run={run}
            invocations={invocations}
            ownerDroneId={ownerDroneId}
            onSelectNode={(nodeKey) => {
              setRunConversationsOpen(false);
              setSelectedNodeKey(nodeKey);
              setInspectorTab('overview');
            }}
            onOpenChat={onOpenChat}
            onClose={() => setRunConversationsOpen(false)}
          />
        ) : selectedAgentId !== null ? (
          <WorkflowAgentsInspector
            workflow={workflow}
            layout={layout}
            selectedAgentId={selectedAgentId}
            onSelectAgent={setSelectedAgentId}
            onSelectNode={(nodeKey) => {
              setSelectedAgentId(null);
              setSelectedNodeKey(nodeKey);
              setInspectorTab('overview');
            }}
          />
        ) : selectedNode ? (
          <WorkflowNodeInspector
            node={selectedNode}
            mode={mode}
            run={run}
            summary={selectedSummary}
            ownerDroneId={ownerDroneId}
            tab={inspectorTab}
            onTabChange={setInspectorTab}
            onClose={() => setSelectedNodeKey(null)}
            onInspectAgent={(agentId) => {
              setMode('definition');
              setRunConversationsOpen(false);
              setSelectedNodeKey(null);
              setSelectedAgentId(agentId);
            }}
            onOpenChat={onOpenChat}
          />
        ) : null}
      </div>
    </section>
  );
}
