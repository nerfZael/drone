# Drone-Owned Workflow System

## Status

- **Type:** Feature
- **Status:** Implemented for version 1; hardening follow-ups remain
- **Scope:** New Drone Hub workflow domain exposed through the Drone Hub MCP server and UI
- **Confidence:** 94%. The core domain, persistence, execution, approval, MCP, hidden chats, and UI paths are implemented and covered by focused tests.

## Summary

Build a new workflow system in Drone Hub. Each workflow belongs to exactly one drone, is stored in the Hub database, and is managed through Drone Hub MCP tools rather than workspace files. Drone agents, the Drone Hub native assistant, and other authorized MCP clients can create, read, update, delete, execute, and inspect workflows through the same service.

Execution is asynchronous and always approval-gated. Drone Hub gets a new per-drone **Workflows** tab where users can browse definitions, inspect a visual representation, execute workflows, approve or deny pending runs, follow live status, inspect worker results, and cancel active runs.

The structured workflow language remains the same general model: ordered phases containing `call`, `sequence`, `parallel`, `forEach`, `if`, and `repeat` control flow. Runtime count caps are optional; the effective run timeout is the primary execution guard. Storage, authorization, tools, runs, approvals, and UI are now Drone Hub responsibilities.

## Background

Drone Hub already has most of the surrounding infrastructure this feature needs: drone-scoped MCP identities, readable and writable drone authorization, an in-process MCP client for the native assistant, a canonical SQLite database, per-drone right-panel tabs, and SSE-backed panels. Its per-drone chats already provide agent selection, prompt queues, transcripts, cancellation, permissions, and navigation into the normal chat surface.

The missing piece is a workflow domain that joins those capabilities without treating workflow definitions as workspace files or reusing an older Drone Hub automation model.

## Problem And Opportunity

Agents currently have no shared, durable way to define multi-agent phases, ask a user to approve an execution, and inspect the resulting run through both MCP and the Drone Hub UI. A Drone Hub-owned workflow service can make the drone the clear security and workspace boundary while keeping the workflow definition and runner flexible enough for later built-in agents, external agents, chats, containers, and worktrees.

## Direction Change

This brief replaces the earlier file-backed direction.

The system will not:

- Discover workflows from `.blip/workflows/`.
- Use `read_file` or `apply_patch` as the workflow CRUD interface.
- Add standalone workflow commands to the Blip CLI.
- Store workflow definitions or run state in a drone workspace.
- Reuse Drone Hub task cards, Fleet workflows, old playbooks, or group orchestration.

The Blip CLI agent can use workflows when it is running in or connected to Drone Hub and has the Drone Hub MCP server configured. The Drone Hub native assistant uses the same tools through its in-process MCP client. Other built-in or external agents can use the tools when their Drone Hub MCP identity allows it.

## Why This Direction Is Better

- A drone is a clear ownership and authorization boundary.
- Workflows remain available even if the drone workspace or branch changes.
- MCP gives every supported agent one structured API instead of requiring filesystem conventions.
- Drone Hub can validate definitions before saving them.
- Approval is enforced centrally, including for external MCP clients.
- The UI and agents read the same canonical records and run state.
- Definition history, optimistic concurrency, runs, and audit metadata fit naturally in the Hub database.
- Users can browse workflows without opening or understanding workflow source files.

The main trade-off is that workflows become a Drone Hub feature rather than a standalone Blip feature. That is acceptable because both required agent surfaces can reach the Drone Hub MCP server.

## Ownership Boundary

Each workflow has one immutable `droneId` owner.

The owner determines:

- Which MCP principal may access the workflow.
- Which drone appears in the Workflows tab.
- Which workspace the first-version workers can access.
- Which runtime policy and credentials apply.
- Which workflow list and run history contain the record.
- What happens when the drone is deleted.

A drone owns workflows, but a workflow invocation must not reuse one of the drone's existing user chats. Reuse would mix workflow prompts and intermediate results into user conversation history and would make parallel calls unsafe.

Every `call` creates either a fresh hidden chat on the owner drone or a fresh hidden child drone, according to its runner. Both runner kinds use a canonical Drone Hub chat backed by Blip or Codex and carry workflow-origin metadata containing the workflow, run, and invocation IDs. The workflow run stores stable execution-drone, child-drone, chat, and prompt-run IDs instead of creating a separate transcript system.

Hidden means the chat is omitted from the ordinary sidebar, chat switcher, and Canvas. It is still a complete, fully interactive chat. Clicking an invocation in the Workflows tab opens it in the existing chat surface, where the user may send more messages, stop it, rename it, archive it, or delete it. The workflow captures only the result associated with its own prompt-run ID; later user turns do not rewrite the invocation result. If a user interrupts or deletes the chat before that prompt finishes, the invocation fails clearly.

Later runner adapters may use:

- A workflow child chat backed by another built-in agent.
- A container-isolated agent.
- An existing chat when explicitly requested.
- An external agent adapter.
- A worker in a Git worktree.

Ownership and runner type remain separate concepts.

## Goals

- Start with an empty workflow list for every drone.
- Let a drone-scoped agent manage its own workflows through MCP.
- Let an authorized host or native assistant manage workflows for drones in its scope.
- Validate every create and update before saving.
- Require user approval before every execution.
- Make pending and active runs visible to both the UI and MCP clients.
- Let users open the complete child-agent chat for every invocation.
- Preserve workflow definition versions and immutable run snapshots.
- Support phases, parallel work, dynamic fan-out, conditions, and loops with optional explicit caps.
- Prevent recursive workflows and unsafe parallel writes, and use the run timeout as the primary runaway-work safeguard.
- Keep the first UI useful without building a visual editor.

## Non-Goals For Version 1

- Workflow definition files.
- A standalone local Blip workflow store or CLI command set.
- A drag-and-drop workflow editor.
- User editing of workflow definitions in the Workflows tab.
- Mid-run user input or per-phase approval.
- User pause and resume.
- Automatic retries.
- Agent-to-agent free-form messaging.
- Cross-drone workflow calls.
- Parallel writable workers.
- Worktrees, containers, pre-existing user chats, or external runners.
- Recursive workflow execution by child workers.
- Schedules, webhooks, and continuous triggers.

## User And Agent Flows

### Agent creates a workflow

1. The agent calls `list_workflows` and receives an empty list or existing summaries.
2. The agent builds a structured definition.
3. The agent calls `create_workflow` for its drone.
4. Drone Hub validates the definition and stores version 1.
5. The Workflows tab receives a change event and displays the new workflow.

### Agent edits a workflow

1. The agent calls `get_workflow` and receives the definition and record version.
2. The agent changes the definition in its own context.
3. The agent calls `update_workflow` with the full replacement definition and `baseVersion`.
4. Drone Hub rejects stale updates with a version conflict.
5. A successful update increments the record version.

Version 1 uses full-definition replacement. It does not add JSON Patch or workflow-specific edit operations.

### Agent executes a workflow

1. The agent calls `execute_workflow` with a workflow ID or name and optional input.
2. Drone Hub validates the current definition, resolves limits, snapshots the exact version and input, and creates a `pending_approval` run.
3. The MCP tool returns the run ID and pending status immediately.
4. The Workflows tab shows an approval card with the resolved execution plan.
5. Approval changes the run to `queued`, then `running`. Denial changes it to `denied`.
6. The agent can call `get_workflow_run` or `list_workflow_runs` to inspect status and results.

The MCP tool must not hold an external client connection open while waiting for a user to approve.

### User executes a workflow

1. The user selects a workflow in the drone's Workflows tab.
2. The user supplies any required input and presses **Run**.
3. A confirmation dialog displays the same resolved plan used for agent-requested approval.
4. Confirming records the user as the approver and starts the run.
5. The tab switches to the live run view.

### User or agent monitors a workflow

- The UI receives live workflow events and refreshes the run projection.
- MCP clients call `list_workflow_runs` for summaries.
- MCP clients call `get_workflow_run` for phases, invocations, results, errors, and revision.
- `get_workflow_run` may later support waiting for a revision change, but version 1 may use ordinary bounded polling.

### User or agent cancels a run

1. `cancel_workflow_run` marks the run as cancelling.
2. The executor stops active child-chat prompts through the existing chat runtime.
3. No new invocations are scheduled.
4. The run becomes `cancelled` after active workers settle.

### User deletes a run

1. Only a terminal run can be deleted. A pending or active run must be denied or cancelled first.
2. The confirmation dialog shows how many workflow-created chats will also be permanently deleted.
3. Drone Hub deletes the run and all chats or child drones whose workflow-origin metadata points to that run.
4. Chats already deleted independently are ignored.

Version 1 does not expose run deletion through MCP. Keeping this destructive history operation in the UI avoids adding a tenth workflow tool before agents have a clear need for it.

## Architecture

```text
Drone agent / external agent ──┐
                              │ Drone Hub MCP tools
Drone Hub native assistant ───┤
                              ▼
                         Workflow service
                         │      │       │
                         │      │       └── Approval broker
                         │      └────────── Workflow executor
                         └───────────────── Workflow store
                                                │
                         HTTP routes + SSE ◄─────┘
                                │
                                ▼
                      Per-drone Workflows tab
```

The MCP tools and HTTP routes are adapters over one workflow service. They must not implement separate validation, authorization, or state transitions.

## Workflow Definition

The workflow record owns display metadata. The stored definition does not repeat the workflow name or description.

```ts
type DroneWorkflow = {
  id: string;
  droneId: string;
  name: string;
  description: string;
  version: number;
  definition: WorkflowDefinitionV1;
  createdAt: string;
  updatedAt: string;
  createdBy: WorkflowActor;
  updatedBy: WorkflowActor;
};
```

The initial definition format is:

```json
{
  "version": 1,
  "agents": {
    "investigator": {
      "runner": {
        "kind": "drone-chat",
        "agent": { "kind": "builtin", "id": "blip" }
      },
      "model": "inherit",
      "permissions": ["workspace:read"],
      "instructions": "Investigate carefully and return concrete findings."
    },
    "implementer": {
      "runner": {
        "kind": "drone-chat",
        "agent": { "kind": "builtin", "id": "blip" }
      },
      "model": "inherit",
      "permissions": ["workspace:read", "workspace:write", "process:execute"],
      "instructions": "Implement only the supplied findings."
    },
    "reviewer": {
      "runner": {
        "kind": "drone-chat",
        "agent": { "kind": "builtin", "id": "blip" }
      },
      "model": "inherit",
      "permissions": ["workspace:read"],
      "instructions": "Review independently and return structured output."
    }
  },
  "phases": [
    {
      "id": "investigate",
      "label": "Investigate",
      "run": {
        "type": "parallel",
        "id": "reviews",
        "children": [
          {
            "type": "call",
            "id": "frontend-review",
            "agent": "investigator",
            "prompt": "Inspect the frontend portion of the problem."
          },
          {
            "type": "call",
            "id": "backend-review",
            "agent": "investigator",
            "prompt": "Inspect the backend portion of the problem."
          }
        ]
      }
    },
    {
      "id": "fix",
      "label": "Fix and verify",
      "run": {
        "type": "repeat",
        "id": "fix-loop",
        "until": {
          "op": "equals",
          "value": {
            "source": "result",
            "result": "fix.review",
            "path": "/passed"
          },
          "expected": true
        },
        "body": {
          "type": "sequence",
          "id": "fix-cycle",
          "children": [
            {
              "type": "call",
              "id": "implement",
              "agent": "implementer",
              "contextFrom": [
                { "source": "result", "result": "investigate.frontend-review" },
                { "source": "result", "result": "investigate.backend-review" },
                { "source": "result", "result": "fix.review", "optional": true }
              ],
              "prompt": "Implement the findings or address the latest review."
            },
            {
              "type": "call",
              "id": "review",
              "agent": "reviewer",
              "contextFrom": [{ "source": "result", "result": "fix.implement" }],
              "prompt": "Review the implementation.",
              "outputSchema": {
                "type": "object",
                "required": ["passed", "findings"],
                "properties": {
                  "passed": { "type": "boolean" },
                  "findings": {
                    "type": "array",
                    "items": { "type": "string" }
                  }
                },
                "additionalProperties": false
              }
            }
          ]
        }
      }
    }
  ],
  "outputFrom": "fix.review"
}
```

### Normative version 1 schema

The example above is illustrative. The following discriminated TypeScript contract is the readable, normative version 1 schema. The implementation should encode the same contract as strict Zod schemas and expose the resulting JSON Schema through the MCP definitions for `create_workflow` and `update_workflow`.

```ts
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

// IDs match /^[a-z][a-z0-9_-]{0,63}$/.
type WorkflowLocalId = string;

// A phase ID refers to the aggregate phase result. A call result uses
// "<phaseId>.<callId>". Call IDs are unique within their phase.
type WorkflowResultRefV1 = string;

// RFC 6901 JSON Pointer. The empty string selects the complete value.
type JsonPointer = string;

type WorkflowDefinitionV1 = {
  version: 1;
  inputSchema?: WorkflowJsonSchemaV1;
  limits?: WorkflowLimitsV1;
  agents: Record<WorkflowLocalId, WorkflowAgentV1>;
  phases: [WorkflowPhaseV1, ...WorkflowPhaseV1[]];
  outputFrom?: WorkflowResultRefV1;
};

type WorkflowLimitsV1 = {
  maxInvocations?: number; // Positive explicit cap; no implicit default
  maxConcurrency?: number; // Positive override; otherwise use executor capacity
  timeoutMinutes?: number; // Positive override; otherwise use the Hub timeout
};

type WorkflowAgentV1 = {
  runner: WorkflowRunnerV1;
  model?: 'inherit' | string; // default "inherit"
  permissions: [WorkflowPermissionV1, ...WorkflowPermissionV1[]];
  instructions: string;
};

type WorkflowPermissionV1 = 'workspace:read' | 'workspace:write' | 'process:execute';

type WorkflowRunnerV1 = {
  kind: 'drone-chat' | 'drone';
  agent: {
    kind: 'builtin';
    id: 'blip' | 'codex';
  };
};

type WorkflowPhaseV1 = {
  id: WorkflowLocalId;
  label?: string;
  run: WorkflowNodeV1;
};

type WorkflowNodeV1 =
  | WorkflowCallV1
  | WorkflowSequenceV1
  | WorkflowParallelV1
  | WorkflowForEachV1
  | WorkflowIfV1
  | WorkflowRepeatV1;

type WorkflowNodeMetadataV1 = {
  id: WorkflowLocalId;
  label?: string;
};

type WorkflowCallV1 = WorkflowNodeMetadataV1 & {
  type: 'call';
  agent: WorkflowLocalId;
  prompt: string;
  contextFrom?: WorkflowContextRefV1[];
  outputSchema?: WorkflowJsonSchemaV1;
};

type WorkflowSequenceV1 = WorkflowNodeMetadataV1 & {
  type: 'sequence';
  children: [WorkflowNodeV1, ...WorkflowNodeV1[]];
};

type WorkflowParallelV1 = WorkflowNodeMetadataV1 & {
  type: 'parallel';
  children: [WorkflowNodeV1, ...WorkflowNodeV1[]];
};

type WorkflowForEachV1 = WorkflowNodeMetadataV1 & {
  type: 'forEach';
  itemsFrom: WorkflowValueRefV1;
  maxItems?: number; // Positive explicit cap; no implicit default
  parallelism?: number; // Positive override; otherwise use executor scheduling
  body: WorkflowNodeV1;
};

type WorkflowIfV1 = WorkflowNodeMetadataV1 & {
  type: 'if';
  condition: WorkflowConditionV1;
  then: WorkflowNodeV1;
  else?: WorkflowNodeV1;
};

type WorkflowRepeatV1 = WorkflowNodeMetadataV1 & {
  type: 'repeat';
  maxIterations?: number; // Positive explicit cap; no implicit default
  until: WorkflowConditionV1;
  body: WorkflowNodeV1;
};

type WorkflowValueRefV1 =
  | {
      source: 'input';
      path?: JsonPointer;
    }
  | {
      source: 'result';
      result: WorkflowResultRefV1;
      path?: JsonPointer;
    }
  | {
      source: 'item';
      path?: JsonPointer;
    };

type WorkflowContextRefV1 = WorkflowValueRefV1 & {
  as?: WorkflowLocalId;
  optional?: boolean; // default false
};

type WorkflowConditionV1 =
  | {
      op: 'equals' | 'notEquals';
      value: WorkflowValueRefV1;
      expected: JsonValue;
    }
  | {
      op: 'exists' | 'truthy';
      value: WorkflowValueRefV1;
    };

type WorkflowJsonSchemaV1 =
  | {
      type: 'object';
      description?: string;
      properties: Record<string, WorkflowJsonSchemaV1>;
      required?: string[];
      additionalProperties: false;
    }
  | {
      type: 'array';
      description?: string;
      items: WorkflowJsonSchemaV1;
      maxItems?: number;
    }
  | {
      type: 'string';
      description?: string;
      enum?: string[];
    }
  | {
      type: 'number' | 'integer';
      description?: string;
      minimum?: number;
      maximum?: number;
    }
  | {
      type: 'boolean' | 'null';
      description?: string;
    };
```

All objects are strict: unknown fields are rejected rather than silently ignored.

### Version 1 runner and tool policy

| Concept               | Accepted in version 1                                  | Notes                                                                                                           |
| --------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Runner kind           | `drone-chat`, `drone`                                  | Creates a hidden chat in the owner drone or a hidden child drone linked to the owner.                           |
| Chat-agent kind       | `builtin`                                              | Other chat-agent kinds are not yet valid workflow runners.                                                      |
| Built-in agent ID     | `blip`, `codex`                                        | Cursor, Claude Code, OpenCode, Pi, native, and custom agents remain future additions.                           |
| Permission capability | `workspace:read`, `workspace:write`, `process:execute` | Definitions request capabilities rather than selecting an internal mode or tool bundle.                         |
| Model                 | `inherit` or a provider model ID                       | `inherit` uses the run or drone default.                                                                        |
| Tool profile          | Derived internally                                     | Blip's existing profiles implement the requested capability set but are not part of the public workflow schema. |

Adding a future runner or agent kind requires a new schema version or a backward-compatible extension that old validators reject clearly. Names mentioned in the later-extensions section are design directions, not currently accepted enum values.

This runner restriction does not restrict who can manage workflows. A drone-scoped Blip client and the Drone Hub native assistant can both author, execute, and inspect workflows through MCP.

### Permission semantics

The public names are namespaced so future permissions remain clear. Bare values such as `read` or `execute` are too ambiguous once the system can grant workspace, process, network, secret, container, or MCP capabilities.

Version 1 accepts exactly these canonical sets:

| Workflow permissions                                   | Internal Blip mapping                                               | Effective tools                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------- | -------------------------------------------------------- |
| `workspace:read`                                       | `read-only` permission and `read-only` profile                      | Structured file inspection and working-tree status.      |
| `workspace:read`, `workspace:write`                    | `workspace-write` permission and `no-shell-workspace-write` profile | Inspection plus structured file mutation, without shell. |
| `workspace:read`, `workspace:write`, `process:execute` | `full-access` permission and `local-trusted-write` profile          | Inspection, file mutation, and shell/process execution.  |

The following rules apply:

- `permissions` is required, non-empty, duplicate-free, and stored in canonical order.
- `workspace:write` requires `workspace:read`.
- `process:execute` requires both workspace permissions because the current shell can read and mutate the workspace. Version 1 does not claim to provide a read-only shell sandbox.
- Codex accepts read-only or the complete read/write/execute set. Its CLI cannot currently enforce structured workspace writes while prohibiting process execution, so write-without-execute definitions are rejected rather than widened silently.
- The workflow definition never names `read-only`, `workspace-write`, `full-access`, or a Blip tool profile directly.
- The resolved capabilities and internal mapping are frozen in the approved run snapshot.
- An invocation with `workspace:write` or `process:execute` counts as a writer for shared-workspace scheduling.
- The workflow-created chat stores the capability set. Permission changes made in the chat UI affect later user turns, not an already queued workflow prompt.

A future schema may add a capability such as `mcp:dronehub`. That would grant access to the server, not unconditional access to every operation: the MCP principal's drone scope, tool allowlist, mutation rules, and execution approvals would still apply. MCP access is deliberately absent from version 1 so child workflow agents cannot recursively manage or execute workflows.

### Reference and execution rules

- Phase, agent, and node IDs use the same lowercase ID format.
- Phase IDs are unique across the definition. Node IDs are unique within a phase, including nested nodes.
- Every call's `agent` must name an entry in `agents`.
- A result reference must be available at the point where it is evaluated. Ordinary forward references are invalid.
- A reference inside `repeat` resolves to the latest completed iteration in the current repeat scope. An optional `contextFrom` reference may point to a later call in the repeat body to consume that call's previous-iteration result; it is absent during the first iteration.
- A `source: "item"` reference is valid only inside a `forEach` body and resolves to the current item.
- `itemsFrom` must resolve to an array. When `maxItems` is present, a longer array fails before fan-out. When omitted, the run timeout is the guard.
- `path` must be an empty string or a valid RFC 6901 JSON Pointer.
- `contextFrom` values are supplied to the chat as labeled structured context. They are not string interpolation in `prompt`.
- `optional: false` makes a missing reference an invocation failure. `optional: true` omits missing context.
- `outputSchema` validates the structured portion of a call result. Conditions and non-empty result paths require structured output.
- `outputFrom`, when present, becomes the workflow's final output. Without it, the final phase aggregate is returned.
- `sequence`, `parallel`, and phases require at least one child. Empty control-flow containers are invalid.
- Failure behavior is the fixed fail-fast behavior described below; version 1 has no per-node retry or error-policy fields.
- `maxInvocations`, `maxItems`, and `maxIterations` are opt-in definition guards. Omitting them does not cause the validator or executor to inject a count limit.
- Every approved run still has an effective timeout. `timeoutMinutes` may override it; otherwise Drone Hub supplies its configured workflow timeout when the approval plan is resolved.
- Optional count, timeout, and concurrency values must be positive integers. The schema does not impose a maximum runtime count.
- Effective concurrency is the lowest applicable definition, node, and executor-capacity value; executor capacity does not truncate total work.

### Definition bounds and validation errors

- Maximum serialized definition size: 256 KiB.
- Maximum agents: 32.
- Maximum phases: 32.
- Maximum total nodes: 100.
- Maximum control-flow nesting depth: 12.
- Maximum agent instructions: 16,000 characters.
- Maximum call prompt: 32,000 characters.
- Input, context, structured output, and aggregate result sizes also receive host-enforced byte limits.

Create and update perform schema validation first and semantic validation second. Validation failures return all safe, actionable issues with a JSON-style path, stable code, and message, for example:

```json
{
  "ok": false,
  "issues": [
    {
      "path": "agents.reviewer.runner.agent.id",
      "code": "invalid_enum_value",
      "message": "Workflow agents must use the built-in blip or codex agent."
    }
  ]
}
```

### Control-flow nodes

| Node       | Behavior                                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------------------------- |
| `call`     | Run one configured agent and store its result.                                                              |
| `sequence` | Run children in order.                                                                                      |
| `parallel` | Run children concurrently and wait for all.                                                                 |
| `forEach`  | Run a body for each item in a structured result list, with an optional item cap.                            |
| `if`       | Select one branch from a structured condition.                                                              |
| `repeat`   | Run a body until a structured condition passes, an optional iteration cap is reached, or the run times out. |

Top-level phases run in order. Parallelism and loops live inside a phase. The end of a phase is a synchronization barrier.

Result references use a phase ID for an aggregate phase result or `<phase>.<call>` for a call result. A repeated call reference resolves to its latest completed invocation. Conditions inspect schema-validated structured output through JSON Pointer paths. The interpreter never evaluates JavaScript from a definition.

## MCP Tools

The Drone Hub MCP server exposes the following tools. Their externally visible names are qualified by the MCP adapter as usual.

| Tool                  | Purpose                                                        | Approval                |
| --------------------- | -------------------------------------------------------------- | ----------------------- |
| `list_workflows`      | List workflow summaries for a drone.                           | No                      |
| `get_workflow`        | Read one complete definition and metadata.                     | No                      |
| `create_workflow`     | Validate and create a workflow.                                | No                      |
| `update_workflow`     | Replace metadata or definition with optimistic concurrency.    | No                      |
| `delete_workflow`     | Delete a workflow, its retained runs, and their created chats. | Yes for agent calls     |
| `execute_workflow`    | Create an immutable pending run snapshot.                      | Always before execution |
| `list_workflow_runs`  | List recent runs by workflow or status.                        | No                      |
| `get_workflow_run`    | Inspect run state, phases, invocations, and results.           | No                      |
| `cancel_workflow_run` | Stop an active or pending run.                                 | No                      |

### Tool input conventions

- Host-scoped and native-assistant callers provide `drone` as an ID or resolvable name.
- A drone-scoped MCP principal may omit `drone`; Drone Hub fills its authenticated `droneId`.
- A drone-scoped principal cannot override `drone` to access another drone.
- Workflow identifiers may accept stable ID or exact name, but results always return the stable ID.
- Workflow names are unique per drone using case-insensitive comparison.
- `create_workflow` and `update_workflow` receive a structured definition object, not encoded JSON text.
- `update_workflow` requires `baseVersion` and returns a conflict when stale.
- `execute_workflow` accepts `input` and an optional idempotency key.
- `get_workflow_run` accepts an optional invocation cursor and bounded page size and returns a next cursor when more invocations exist.
- Tool results are bounded. Large prompts, outputs, and transcripts are summarized or truncated with explicit metadata.

Suggested execution result:

```json
{
  "ok": true,
  "runId": "workflow_run_123",
  "workflowId": "workflow_456",
  "workflowVersion": 3,
  "status": "pending_approval",
  "approvalRequired": true
}
```

## Authorization

The current MCP server already distinguishes host and drone token identities and checks drone references. Workflow tools should extend that authorization rather than build a second identity system.

| Caller           | Read definitions and runs           | Create or update                    | Delete                | Request execution             | Cancel                        |
| ---------------- | ----------------------------------- | ----------------------------------- | --------------------- | ----------------------------- | ----------------------------- |
| Drone principal  | Own drone only                      | Own drone only                      | Own drone only        | Own drone only                | Own drone only                |
| Native assistant | Drones in read scope                | Drones in write scope               | Drones in write scope | Drones in execute/write scope | Drones in execute/write scope |
| Host principal   | Explicit target drone               | Explicit target drone               | Explicit target drone | Explicit target drone         | Explicit target drone         |
| Legacy principal | Allowed during compatibility period | Allowed during compatibility period | Approval required     | Approval required             | Allowed                       |

Workflow create, update, delete, execute, and cancel tools should be treated as drone-scoped mutations by the existing MCP authorization layer. Read tools use readable drone scope.

Authorization permits a request. Approval permits a particular execution or destructive delete. They are separate checks.

## Approval Model

Execution approval must live in the workflow backend, not only in the native assistant's tool preflight. Otherwise an external MCP client could request execution without a Drone Hub user seeing it.

An execution request creates a durable `pending_approval` run containing:

- Owner drone.
- Workflow ID, version, and definition hash.
- Immutable definition snapshot.
- Resolved input.
- Resolved chat agents, models, requested capabilities, and internal tool mappings.
- Effective timeout and concurrency, plus any explicit invocation, iteration, or fan-out caps present in the definition.
- Whether workers may write files or execute shell commands.
- Requesting MCP principal or UI actor.
- Request and expiry timestamps.

The approval card supports **Run** and **Deny** in version 1. There is no permanent “always allow” option.

After approval, the executor runs the stored snapshot. Editing the workflow does not change a pending or active run.

Agent-requested deletion should also require approval because it permanently removes a user-managed definition, its run history, and the chats or child drones created by those runs. The approval or direct UI confirmation shows the affected resources.

## Execution Runtime

### Run statuses

```text
pending_approval
queued
running
completed
failed
cancelling
cancelled
denied
```

### Invocation model

Each `call` becomes a concrete invocation. Loop iterations and `forEach` items receive stable paths such as:

```text
fix/fix-loop/iteration-2/review
audit/files/item-17/check
```

An invocation record includes:

- Definition path and runtime identity.
- Phase, node, call, iteration, and item information.
- Agent definition snapshot.
- Runner kind, execution-drone ID, optional child-drone ID, stable chat ID, last-known chat name, and prompt-run ID.
- Status.
- Start and finish timestamps.
- Text and structured results.
- Changed files, usage, and errors when available.

### Version 1 runners

Both runners create a fresh canonical Drone Hub chat for every invocation and send one workflow prompt through the existing chat queue. The `drone-chat` runner uses the owner drone. The `drone` runner draft-creates and publishes a container child drone through canonical provisioning, links it with the existing fleet-parent relationship, and uses its default chat.

- The selected runner's workspace target.
- The built-in Blip or Codex chat agent.
- The declared workflow permissions and their frozen Blip tool mapping.
- The declared model or an inherited run model.
- The agent instructions plus call prompt.
- Only the results selected through `contextFrom`.
- The workflow event sink and cancellation signal.

The chat entry gains metadata similar to:

```json
{
  "visibility": "workflow",
  "workflowOrigin": {
    "workflowId": "workflow_456",
    "runId": "workflow_run_123",
    "invocationId": "fix/fix-loop/iteration-2/review"
  }
}
```

Ordinary chat-list projections exclude `visibility: "workflow"`, so these chats do not appear in the sidebar, chat switcher, or Canvas. Direct access by stable ID remains available to the Workflows tab. The workflow resolves the chat's current name when opening it, allowing user renaming without rewriting historical workflow state. User messages queued after the workflow prompt are normal chat turns and do not change the captured result for that invocation.

The workflow-created agent does not receive workflow management or execution tools. This makes recursion depth zero. Fan-out and loops are governed by the effective run timeout unless the definition supplies explicit caps.

### Workspace safety

- Read-only invocations may run concurrently.
- A writer has exclusive access to the shared drone workspace.
- Readers do not overlap a writer because they could observe partial changes.
- The scheduler queues conflicting invocations.
- Parallel writers require future worktree or container placement.

### Failure behavior

- `sequence` stops after a required child fails.
- `parallel` lets active siblings settle, then fails when any required child failed.
- `forEach` stops scheduling new items after a required failure.
- `if` fails when its condition cannot be evaluated.
- `repeat` fails when its condition cannot be evaluated, or when an explicitly configured `maxIterations` is exhausted without success.
- Invalid structured output fails the invocation.
- Version 1 does not retry automatically.

`repeat` is not retry. It repeats successful domain work because a structured result says more work is required. A later retry policy may repeat operational failures only when side effects are understood.

### Runtime safeguards

- Every run has an effective timeout resolved before approval. A definition may override it with `timeoutMinutes`; otherwise the Drone Hub workflow timeout is used.
- Timeout expiry stops scheduling new work, cancels active workflow prompts, and fails the run with a timeout reason.
- There is no default maximum invocation count.
- There is no default maximum `repeat` iteration count.
- There is no default maximum `forEach` item count.
- `maxInvocations`, `maxIterations`, and `maxItems` are optional opt-in guards and are commonly omitted.
- Executor concurrency is a resource-scheduling setting, not a total-work limit. `maxConcurrency` and `parallelism` may lower concurrency for a definition or node.
- Cross-workflow recursion remains disabled in version 1.

## Persistence

Use a new Drone Hub workflow store backed by the canonical Hub SQLite database. Do not store definitions in the registry or drone workspace.

The first schema uses three focused tables:

### `drone_workflows`

- `id`
- `drone_id`
- `name`
- `description`
- `definition_json`
- `version`
- `created_at`
- `updated_at`
- `created_by_json`
- `updated_by_json`

Unique index: normalized workflow name within `drone_id`.

### `drone_workflow_runs`

- `id`
- `drone_id`
- `workflow_id`
- `workflow_version`
- `definition_hash`
- `definition_snapshot_json`
- `input_json`
- `plan_json`
- `state_json`
- `status`
- `revision`
- `requested_by_json`
- `approved_by_json`
- `requested_at`
- `approved_at`
- `started_at`
- `finished_at`
- `updated_at`
- `output_json`
- `error`

`state_json` stores only compact run-level and phase-level executor state. Invocation history is normalized because a timeout-bounded run may still create many short invocations.

### `drone_workflow_invocations`

- `id`
- `run_id`
- `drone_id`
- `ordinal`
- `runtime_path`
- `phase_id`
- `node_id`
- `call_id`
- `iteration_index`
- `item_index`
- `agent_snapshot_json`
- `chat_id`
- `last_chat_name`
- `prompt_run_id`
- `status`
- `started_at`
- `finished_at`
- `text_result`
- `structured_result_json`
- `changed_files_json`
- `usage_json`
- `error`

Index invocations by `(run_id, ordinal)` and `(run_id, status)`. The canonical chat remains the source of truth for the full transcript and live tool activity. The invocation row stores the status and bounded result projection needed for orchestration and inspection. MCP and HTTP reads paginate invocation rows rather than returning an unbounded run document.

Every state transition increments `revision`. Definition updates increment the workflow `version`.

Deleting a workflow is rejected while it has a pending or active run. After confirmation or approval, version 1 deletes the definition, retained runs, and every chat or child drone created by those runs. Owner-drone deletion also removes child drones through the existing fleet-descendant lifecycle.

A workflow-created chat or child drone is fully interactive, but its retention parent is the workflow run. Deleting a terminal run permanently deletes every runner resource created by that run. If a user independently renames, archives, or deletes one first, the retained workflow run remains valid because it stores its own bounded result projection. The Workflows tab shows when the linked resource is unavailable.

On Hub restart, completed and terminal runs remain inspectable. Version 1 marks formerly active runs as failed with an interruption reason and aborts or closes any recoverable child handles. Automatic run resume is deferred.

## HTTP And Events

The frontend uses HTTP routes over the same workflow service:

```text
GET    /api/drones/:droneId/workflows
POST   /api/drones/:droneId/workflows
GET    /api/drones/:droneId/workflows/:workflowId
PATCH  /api/drones/:droneId/workflows/:workflowId
DELETE /api/drones/:droneId/workflows/:workflowId

POST   /api/drones/:droneId/workflows/:workflowId/runs
GET    /api/drones/:droneId/workflow-runs
GET    /api/drones/:droneId/workflow-runs/:runId
GET    /api/drones/:droneId/workflow-runs/:runId/invocations
DELETE /api/drones/:droneId/workflow-runs/:runId
POST   /api/drones/:droneId/workflow-runs/:runId/approve
POST   /api/drones/:droneId/workflow-runs/:runId/deny
POST   /api/drones/:droneId/workflow-runs/:runId/cancel
GET    /api/drones/:droneId/workflows/events
```

Initial event types:

- `workflow_run_started`
- `workflow_state_changed`
- `workflow_invocation_progress`
- `workflow_run_finished`

`workflow_state_changed` identifies the affected run, phase, node, or invocation and its new status. It includes the durable run revision so the UI can ignore duplicates and refresh when needed. Invocation progress carries transient child tool activity without forcing a durable state write for every message.

Definition create, update, and delete changes also need a lightweight `workflow_definition_changed` SSE event. This is a collection notification for refreshing the list, not a workflow runtime event.

## Workflows Tab

Add `workflows` to the per-drone right-panel tab IDs and labels. The tab receives the selected drone directly, matching Changes, Files, Terminal, and other drone-specific panes.

Create a dedicated `DroneWorkflowsDock` with three areas:

### Workflow list

- Name and description.
- Definition version.
- Last run status and time.
- Pending or active run indicator.
- Empty state: “No workflows for this drone.”
- Refresh action.

Version 1 does not need a UI definition editor. Agents author workflows through MCP. A later UI can add raw structured editing or a visual editor.

### Definition view

- Ordered phase cards.
- Nested sequence, parallel, condition, fan-out, and loop nodes.
- Agent badges showing chat agent, model, and permission capabilities.
- Prompts and instructions in a selected-node inspector.
- Result dependencies and output schemas.
- Limits and validation warnings.
- **Run** and **Delete** actions.

### Run view

- Pending approval card.
- Overall status and elapsed time.
- Phase and invocation status on the definition visualization.
- Loop iteration and `forEach` item expansion.
- Current or recent tool activity.
- Selected invocation prompt, result, changed files, and error.
- **Open agent chat** on every invocation, using the existing chat surface and transcript.
- Cancel action for pending or active runs.
- Delete action for terminal runs, with the number of chats that will also be deleted.
- Recent run history.

The tab must handle loading, empty, disabled, validation-error, permission-error, disconnected-event-stream, and terminal-run states.

## UI Reuse

Reuse the right-panel infrastructure, async pane boundary, existing status tokens, confirmation dialog patterns, and SSE refresh patterns.

Do not reuse the Canvas domain store or chat-node components directly. Canvas models draggable chats and drone relationships; a workflow is a structured tree with runtime expansion. Sharing that state model would add editing, positioning, and chat assumptions the Workflows tab does not need.

For version 1, render the workflow with ordinary React layout:

- Vertical phases.
- Nested cards for control-flow nodes.
- Branch columns for `parallel`.
- Compact connectors drawn with CSS or a small presentation helper.
- A detail inspector beside or below the visualization.

If large workflows later require pan and zoom, extract generic viewport or connector helpers from Canvas rather than importing Canvas workflow state.

The Whiteboard implementation is a better backend reference: dedicated SQLite store, REST routes, SSE collection refresh, and a dedicated panel. Reuse its architectural pattern, not its scene model.

## Code Ownership

### New Drone Hub backend modules

Implemented location:

```text
apps/drone/src/hub/workflows/
  workflow-types.ts
  workflow-schema.ts
  workflow-validator.ts
  workflow-store.ts
  workflow-store-schema.ts
  workflow-service.ts
  workflow-executor.ts
  workflow-runner.ts
  workflow-events.ts
  workflow-feature.ts
  workflow-mcp-tools.ts
  workflow-assistant-tools.ts
  workflow-tool-names.ts
  workflow-chat-metadata.ts
  workflow-permissions.ts
  drone-workflow-runner-gateway.ts
  workflow-child-drone-metadata.ts
```

Focused HTTP routes live in `apps/drone/src/hub/routes/workflow-routes.ts`. MCP registration, tool names, assistant summaries, feature construction, chat metadata, and Blip permission mapping are owned by the workflow directory rather than embedded in shared server files.

The workflow service owns all state transitions. Routes and MCP tools only normalize input, resolve actors, authorize, and call the service. The workflow runner uses an internal canonical chat service rather than making loopback HTTP requests to the public chat routes.

### Integration and removal boundary

The backend composition root calls one `registerWorkflowFeature` entry point. The other required backend seams are intentionally narrow:

- The MCP server imports the workflow tool registrar and authorization name sets.
- Assistant configuration imports workflow-owned prompt and tool summaries.
- Ordinary chat listing and drone summaries call the shared workflow-chat visibility predicate.
- Blip startup calls the workflow-owned permission mapper.
- Permanent drone deletion calls the workflow record cleanup function.
- Canonical drone provisioning preserves workflow-child metadata during draft publication.
- Ordinary drone counts, groups, sidebar collections, Canvas ordering, and MCP discovery exclude workflow child drones through workflow-owned visibility predicates.

The frontend implementation is contained in `apps/drone-hub/src/droneHub/workflows/`. Shared frontend edits are limited to the right-panel tab registration, lazy tab content switch, workflow chat/child-drone summary fields, ordinary registry filtering, and direct selection of hidden workflow resources.

This is deliberately a feature boundary rather than a general plugin framework. Removing the feature later requires deleting the two workflow directories and their focused route, then removing these explicit integration seams; it does not require finding copied workflow rules throughout the chat, MCP, or assistant implementations.

### Blip reuse

Use Drone Hub's canonical chat and drone provisioning paths for child workers. Blip keeps its precise permission-profile mapping. Codex uses its existing read-only or full-access sandbox modes, with validation preventing unsupported write-without-execute combinations.

If the workflow definition validator and interpreter later need reuse outside Drone Hub, extract those pure modules into `@blip/workflows`. Do not create a new package before a second host actually needs to execute workflows without Drone Hub.

### Frontend

Implemented location:

```text
apps/drone-hub/src/droneHub/workflows/
  DroneWorkflowsDock.tsx
  WorkflowDefinitionView.tsx
  WorkflowRunDetails.tsx
  workflow-api.ts
  workflow-drone-visibility.ts
  workflow-presentation.ts
  workflow-types.ts
```

Browser-safe DTOs may move to a shared protocol package if both backend and frontend otherwise duplicate them.

## Simplifications Preserved In This Direction

- One owner: the drone.
- One canonical store: Drone Hub SQLite.
- One structured definition format: JSON objects over MCP and HTTP.
- One execution request path through the workflow service.
- One approval source of truth in the backend.
- Two focused runner kinds: hidden owner-drone chats and hidden child drones.
- Two built-in agent choices: Blip and Codex.
- Ordered phases instead of arbitrary phase dependency edges.
- Six structured control-flow node types instead of arbitrary JavaScript.
- Full-definition replacement instead of patch operations.
- Three focused database tables: definitions, runs, and paginated invocations.
- Four runtime event types plus one definition collection notification.
- Cancel but no user pause or automatic resume.
- Clear failure but no automatic retry.
- Visual inspection but no visual editing.

## Risks And Trade-offs

- Runner support remains intentionally limited to Blip and Codex; other built-in, native, and external agents still need explicit adapters.
- Hidden workflow chats add one deliberate visibility state that ordinary chat lists, the sidebar, the chat switcher, and Canvas must consistently exclude.
- Hidden workflow child drones add a second visibility boundary. They remain addressable for direct workflow navigation but are excluded from ordinary drone lists, counts, sidebar groups, Canvas ordering, and MCP discovery.
- User actions can interrupt, archive, rename, or delete an active workflow chat. The executor must map those actions to clear invocation state rather than assuming exclusive control.
- Run deletion is deliberately destructive because it also deletes its chats and child drones. The UI must make the cascade explicit.
- Full-definition MCP updates may be large, but they are simpler and safer than partial operations. Definition size must be bounded.
- Timeout-only workflows can still create many short invocations. Normalized invocation rows and pagination avoid an unbounded run JSON blob, but retained history can still consume substantial storage.
- Polling run state from an MCP agent is less elegant than push notifications. Revision-aware waiting can be added after basic inspection works.
- Shared-workspace serialization limits parallel implementation work until isolation exists.
- `process:execute` cannot be isolated from workspace writes with the current shell tool, so the schema requires the write capability and schedules it as a writer.
- Permanent delete removes run history. Agent deletion therefore needs approval and active runs block deletion.
- Marking active runs failed after Hub restart is less capable than resume but avoids ambiguous child-process recovery in the first version.
- MCP tool count increases by nine. Clear grouping and concise tool descriptions are important for agent tool selection.

## Success Criteria

- A new drone returns an empty workflow list.
- A drone-scoped MCP principal can access only that drone's workflows and runs.
- An authorized native assistant can target only drones allowed by its read and write scopes.
- Create and update reject invalid definitions without modifying stored state.
- MCP advertises the complete version 1 definition schema, including runner, agent, permission, node, condition, and reference discriminators.
- Unknown fields and unsupported future runner or agent values fail with path-specific validation issues.
- Only the three valid permission combinations are accepted, and each maps to the expected Blip tool profile.
- Concurrent updates are protected by `baseVersion`.
- The UI and MCP tools return the same canonical workflow and run data.
- Agent-requested execution always creates a durable pending approval visible in the UI.
- No execution starts before approval.
- A run executes its immutable workflow-version snapshot.
- Sequence, parallel, `forEach`, `if`, and `repeat` behavior is deterministic until completion, explicit cap, cancellation, failure, or timeout.
- Omitting invocation, item, and iteration caps does not inject hidden count limits.
- Shared-workspace writers cannot overlap readers or other writers.
- Agents can list runs and inspect phase, invocation, result, and error state through MCP.
- Users can browse, approve, execute, monitor, inspect, and cancel through the Workflows tab.
- Users can open and continue the canonical chat and full transcript for every workflow invocation.
- Workflow-created chats do not appear in the ordinary sidebar, chat switcher, or Canvas.
- Later user turns do not alter the immutable result captured for the workflow's prompt-run ID.
- Renaming a workflow-created chat does not break its invocation link.
- Deleting a terminal run permanently deletes every chat or child drone created by that run.
- Deleting a workflow permanently deletes its retained runs and their workflow-created chats.
- Cancellation stops active child-chat prompts and prevents new invocations.
- Child workers cannot start nested workflows.
- Hub restart preserves terminal history and clearly marks interrupted active runs.
- No existing Drone Hub workflow or task implementation is imported into the new domain.

## Progress And Next Steps

- [x] Investigated the existing Drone Hub MCP identity and authorization boundaries.
- [x] Investigated the right-panel, Canvas, Whiteboard, persistence, and event patterns.
- [x] Replaced the file-backed proposal with the drone-owned MCP-first design.
- [x] Completed a second-pass simplification and consistency review of this brief.
- [x] Resolve version 1 behavior for cloning and permanent deletion.
- [x] Implement the approved version 1 design.

## Implementation Plan

### Phase 1: Domain, schema, and store

- [x] Define workflow, run, actor, status, and control-flow types.
- [x] Define and test the version 1 workflow schema and semantic validator.
- [x] Reuse the same strict schema in persistence validation and MCP create/update tool definitions.
- [x] Add `drone_workflows`, `drone_workflow_runs`, and `drone_workflow_invocations` storage.
- [x] Implement name uniqueness and optimistic version checks.
- [x] Implement workflow CRUD and list projections in one workflow service.
- [x] Implement terminal-run deletion and run-to-chat cascade semantics.
- [x] Add definition and run size limits.

### Phase 2: MCP CRUD and authorization

- [x] Register list, get, create, update, and delete workflow tools.
- [x] Resolve omitted drone IDs from authenticated drone principals.
- [x] Extend readable and writable drone-scope authorization for workflow tools.
- [x] Add assistant tool summaries, grouping, and enablement settings.
- [x] Add bounded MCP result projections.
- [ ] Add agent-delete approval behavior.

### Phase 3: Executor and run inspection

- [x] Implement the structured interpreter with fake runner tests.
- [x] Add workflow-origin metadata to canonical drone chats.
- [x] Add workflow chat visibility and exclude those chats from ordinary chat lists, the sidebar, chat switcher, and Canvas.
- [x] Add stable chat-ID resolution so workflow links survive ordinary chat renames.
- [x] Implement fresh workflow child chats using the built-in Blip or Codex agent.
- [x] Implement hidden container child-drone runners with fleet-parent ownership and deletion cascades.
- [x] Store workflow permissions on created chats and map them to Blip permission modes and tool profiles.
- [x] Implement concurrency, shared-workspace locking, limits, and cancellation.
- [x] Implement structured results, result references, conditions, and runtime expansion.
- [x] Add execute, list-runs, get-run, and cancel-run MCP tools.
- [x] Add durable backend execution approval and immutable snapshots.

### Phase 4: HTTP, events, and Workflows tab

- [x] Add per-drone workflow and run routes.
- [x] Add workflow definition and runtime SSE notifications.
- [x] Add `workflows` to right-panel tab configuration.
- [x] Implement `DroneWorkflowsDock` with loading, empty, error, and disconnected states.
- [x] Implement workflow list and definition visualization.
- [x] Implement approval, direct execution, run history, live status, invocation inspection, open-agent-chat navigation, cancellation, and terminal-run deletion.

### Phase 5: Hardening

- [x] Mark interrupted runs consistently during Hub startup.
- [ ] Test stale updates, duplicate execution requests, approval races, cancellation races, and drone deletion.
- [ ] Test run and workflow deletion cascades, including already-missing or archived chats.
- [x] Test drone-principal, host-principal, and native-assistant authorization.
- [ ] Test malformed output, optional fan-out and loop caps, timeout termination, and write serialization.
- [ ] Test every valid and invalid permission combination and its effective tool catalog.
- [ ] Add usage and cost telemetry when provider data permits it.
- [ ] Document MCP workflow authoring examples.

### Later extensions

- [ ] Worktree and container workspace placement.
- [ ] Other built-in, native, and external agent runners.
- [ ] Reusing a pre-existing user chat when explicitly selected.
- [ ] Revision-aware MCP wait for run changes.
- [ ] Automatic retry policies.
- [ ] Soft pause and resume.
- [ ] Mid-run approvals and user input.
- [ ] First-success parallel joins.
- [ ] Raw definition editor and visual workflow editor.
- [ ] Workflow copy or export between drones.
- [ ] Scoped Drone Hub MCP access as an explicit workflow permission.
- [ ] Scheduling and event triggers.

## Evidence And Current Understanding

### Confirmed

- Drone Hub MCP tokens already distinguish host and drone identities, including a drone ID on drone-scoped principals.
- The MCP authorization layer already separates readable and writable drone scope for tool calls.
- The native assistant loads Drone Hub MCP tools through an in-process MCP client with scoped drone references.
- Drone Hub already has a per-drone right-panel tab system and can add a Workflows tab without creating a new navigation surface.
- The Whiteboard feature demonstrates a dedicated SQLite store, REST routes, SSE refresh, MCP tools, and a right-panel experience.
- Canonical per-drone chats already support creation, built-in agent configuration, prompt queuing, transcript reads, stopping, and UI navigation.
- Existing Canvas and assistant navigation can activate a chat from a drone ID and chat name.

### Likely

- Hidden canonical chats are a smaller first runner than a separate session subsystem and provide full transcript inspection and user interaction without another viewer.
- A lightweight structured renderer is simpler than adapting the chat-oriented Canvas state model.
- A separate invocation table is necessary because timeout-bounded runs have no default invocation-count cap.
- Returning `pending_approval` immediately is more reliable across external MCP clients than holding a tool call open.

### Unknown

- Whether workflow definitions should eventually be copied automatically when a drone is cloned.
- Whether external runner support will continue using canonical Drone Hub chats or need a separate agent-run adapter.

## Feedback And Decisions

- Workflow storage moves from files to Drone Hub MCP and backend persistence.
- Each workflow belongs to one drone.
- Each drone starts with no workflows.
- Drone agents can list, create, update, delete, execute, and inspect through MCP.
- Execution is always approval-gated in the backend.
- The UI gets a per-drone Workflows tab for browsing, visualization, execution, approval, status, results, and cancellation.
- The structured phase and loop model remains.
- The owner drone and invocation runner are separate concepts.
- Version 1 workers are hidden canonical Drone Hub chats or hidden child drones using the built-in Blip or Codex agent.
- Workflow agents declare namespaced permission capabilities; Blip permission modes and tool profiles are internal mappings.
- Version 1 permissions are workspace read, workspace write, and process execute. Drone Hub MCP access is deferred as a separately scoped capability.
- Workflow-created chats are omitted from ordinary navigation but remain fully interactive when opened from the Workflows tab.
- The workflow controls its prompt-run result, the user controls chat interaction, and the run controls chat retention.
- Users control workflow-created chats while the run exists, but the run is their retention parent.
- Deleting a run deletes its workflow-created chats; deleting a workflow deletes its runs and therefore their chats.
- Canvas may provide presentation ideas, but its domain store and chat nodes will not be reused.
- Existing Drone Hub workflow implementations remain out of scope.

## Open Questions

### 1. Should cloning a drone copy its workflow definitions?

A: No in version 1. Add an explicit workflow copy or export operation later so cloning does not silently duplicate automation and history.

### 2. What should happen to workflow records during recoverable drone archival versus permanent deletion?

A: Keep workflows while a drone is archived or recoverable. Cascade only during the final deletion path that removes the drone's other durable records.
