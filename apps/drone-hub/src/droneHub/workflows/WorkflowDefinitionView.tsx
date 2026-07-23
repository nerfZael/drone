import React from 'react';

import type { DroneWorkflow, WorkflowNode } from './workflow-types';

function NodeCard({ node, depth = 0 }: { node: WorkflowNode; depth?: number }) {
  const nested =
    node.type === 'sequence' || node.type === 'parallel'
      ? node.children
      : node.type === 'forEach' || node.type === 'repeat'
        ? [node.body]
        : node.type === 'if'
          ? [node.then, ...(node.else ? [node.else] : [])]
          : [];
  return (
    <div
      className="rounded-[var(--radius-medium)] border border-[var(--border-subtle)] bg-[var(--surface-softest)] p-2"
      style={{ marginLeft: Math.min(depth, 4) * 8 }}
    >
      <div className="flex items-center gap-2">
        <span className="rounded bg-[var(--accent-subtle)] px-1.5 py-0.5 text-[var(--text-9)] font-[var(--weight-semibold)] uppercase text-[var(--accent)]">
          {node.type}
        </span>
        <span className="min-w-0 truncate text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--fg)]">
          {node.label || node.id}
        </span>
        {node.type === 'call' ? (
          <span className="ml-auto text-[var(--text-10)] text-[var(--muted)]">{node.agent}</span>
        ) : null}
      </div>
      {node.type === 'call' ? (
        <div className="mt-1.5 whitespace-pre-wrap text-[var(--text-10)] leading-4 text-[var(--muted)]">
          {node.prompt}
        </div>
      ) : null}
      {nested.length > 0 ? (
        <div className="mt-2 space-y-1.5">
          {nested.map((child, index) => (
            <NodeCard key={`${child.id}:${index}`} node={child} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function WorkflowDefinitionView({ workflow }: { workflow: DroneWorkflow }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-1.5">
        {Object.entries(workflow.definition.agents).map(([id, agent]) => (
          <div
            key={id}
            className="rounded-[var(--radius-medium)] border border-[var(--border-subtle)] px-2 py-1.5"
          >
            <div className="text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--fg)]">
              {id} · {agent.runner.kind === 'drone' ? 'Child drone' : 'Chat'} ·{' '}
              {agent.runner.agent.id === 'codex' ? 'Codex' : 'Blip'}
              {agent.model ? ` · ${agent.model}` : ''}
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {agent.permissions.map((permission) => (
                <span
                  key={permission}
                  className="rounded bg-[var(--surface-inset)] px-1.5 py-0.5 text-[var(--text-9)] text-[var(--muted)]"
                >
                  {permission}
                </span>
              ))}
            </div>
            <details className="mt-1 text-[var(--text-10)] text-[var(--muted)]">
              <summary className="cursor-pointer">Instructions</summary>
              <div className="mt-1 whitespace-pre-wrap">{agent.instructions}</div>
            </details>
          </div>
        ))}
      </div>
      {workflow.definition.phases.map((phase, index) => (
        <section key={phase.id}>
          <div className="mb-1.5 text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--muted)]">
            {index + 1}. {phase.label || phase.id}
          </div>
          <NodeCard node={phase.run} />
        </section>
      ))}
    </div>
  );
}
