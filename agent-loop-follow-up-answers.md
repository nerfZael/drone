# Agent Loop Follow-Up Questions and Answers

## Scope

This document answers follow-up questions about StorySpark's agent assistant and
DroneHub's native Blip-based agent. Each question is quoted from the request.
The answers focus on internal runtime behavior rather than UI behavior.

## 1. What “durable recovery” means in StorySpark

> how is story spark stronger at durable recovery explain in simple terms

In simple terms, StorySpark writes down the important parts of a long-running
job before it stops or waits. If the server disappears, the next server can
read those notes and understand what was happening.

Imagine two ways to remember an approval:

1. Hold a sticky note in your hand while waiting.
2. Put the request, its current status, and completed steps in a database.

DroneHub's current approval wait is closer to the first approach. StorySpark's
proposal workflow is closer to the second.

### What StorySpark persists

StorySpark has durable database records for:

- The session
- The run
- Ordered conversation messages
- The proposed project change
- The approval state
- A checkpoint describing the execution phase
- The individual proposal items already attempted
- Partial, stopped, failed, or completed results
- The exact model context to use later

When the agent proposes a project change, it does not leave a live function
waiting for approval. The agent loop ends cleanly, and StorySpark commits an
`awaiting_approval` run plus its proposal and checkpoint.

When the user approves it, StorySpark starts or claims a separate execution
run. As each operation progresses, it saves updated checkpoint items. If
execution stops or fails, the proposal becomes paused with the progress
recorded.

### What happens after a restart

At startup, StorySpark examines runs that were active when the previous server
stopped:

- Ordinary interrupted agent runs become failed with a clear retry message.
- A proposal that was executing becomes paused and returns to an
  approval/recovery state.
- Its completed or partially completed items are copied into the durable
  proposal record.
- A stopped run is finalized as cancelled rather than remaining permanently
  “running.”

This is not magic process resumption. StorySpark does not resume at the exact
JavaScript instruction where the process died. It restores a meaningful
workflow state from which the operation can be reviewed or retried.

### Why this is stronger than DroneHub today

Blip durably stores its transcript, which is already valuable. However,
DroneHub's pending approvals live in an in-memory `Map` containing a Promise
resolver. If the process dies while waiting:

- The approval Promise disappears.
- The pending approval record disappears.
- The live tool invocation disappears.
- The transcript may contain the assistant's tool call without its eventual
  tool result.

The conversation can be reopened, but the approval workflow itself is not
durably resumable.

### Important limitation

StorySpark's design reduces ambiguity and duplicate work, but it cannot
automatically make every external side effect transactional. If an external
image service completed a request immediately before a crash, safe recovery
still depends on operation IDs, saved progress, and idempotent execution logic.

The core advantage is that StorySpark knows what it was trying to do and what
it had recorded as complete. It is not forced to guess from a chat transcript.

## 2. Tool schemas, validation, and domain normalization

> could you explain a bit more about tool schemas and validation what do you mean the ideal combines its mandatory validation with story spark style domain normalization after validation

### The three separate jobs

It helps to separate three concepts that are often all called “validation.”

#### 1. Shape validation

This asks whether the model produced the right JSON shape:

- Is `sceneNumber` a number?
- Is `operations` an array?
- Is a required property missing?
- Is an enum value valid?
- Is a number inside the allowed range?
- Are unexpected properties forbidden?

This is what JSON Schema and TypeBox are good at.

#### 2. Domain normalization

This turns valid but user/model-friendly input into the application's canonical
form:

- Trim and normalize a name.
- Turn `"scene 3"` into the actual scene ID.
- Resolve a drone name to a stable drone ID.
- Add a default timeout.
- Convert a relative asset reference into a canonical asset reference.
- Normalize several equivalent input spellings into one representation.

The output should be easier and safer for the tool's execution code to use.

#### 3. Authorization and current-state checks

This asks whether the now-understood operation is allowed and still makes
sense:

- Does the scene actually exist?
- Does this workspace own the asset?
- Is this drone inside the thread's write scope?
- Does the selected workspace support shell execution?
- Is the resource still in the state the proposal was based on?

These checks depend on live application state and cannot be expressed fully by
JSON Schema.

### How StorySpark handles it

A StorySpark tool provides a JSON Schema for the model and may provide
`prepareInput`.

Most StorySpark tools use Zod inside `prepareInput` to parse and normalize
input before execution. The proposal tool goes further: it parses the proposed
operations, resolves project references, validates dependencies against a
draft project state, checks asset types, and converts the proposal into
canonical operations.

The weakness is that the generic StorySpark loop does not automatically
compile and enforce every tool's JSON Schema. A tool that forgets
`prepareInput` receives raw model data.

### How DroneHub handles it

`pi-agent-core` always calls `validateToolArguments` before executing a tool.
That validator:

1. Clones the model's arguments.
2. Applies TypeBox conversion.
3. Applies JSON Schema coercion for non-TypeBox schemas.
4. Uses a compiled, cached validator.
5. Returns path-specific validation errors to the model.

That gives DroneHub a strong universal floor: malformed calls do not reach the
tool.

DroneHub also supports a tool-level `prepareArguments` hook, but it currently
runs before the mandatory schema validator. That hook is useful for
pre-validation cleanup, but it is not a clearly separated post-validation
domain-normalization stage.

### What the ideal combination means

The clean sequence would be:

```text
Raw model arguments
  -> basic coercion
  -> mandatory schema validation
  -> domain normalization/resolution
  -> optional validation of the normalized form
  -> authorization or approval preflight
  -> execution
```

For example, consider:

```json
{
  "drone": "api worker",
  "path": "./src/../src/index.ts"
}
```

The stages would do different jobs:

1. Schema validation confirms both values are strings.
2. Domain normalization resolves `"api worker"` to drone ID `drn_123` and
   normalizes the path to `src/index.ts`.
3. Authorization checks that this thread may read `drn_123`.
4. Path safety checks that the resolved file remains inside that drone's
   workspace.
5. Execution reads the already resolved, authorized target.

### A natural API change in `packages/agent`

Keep the existing mandatory `validateToolArguments`, but add a hook with a
clear post-validation contract, such as:

```ts
normalizeArguments?: (
  validatedArguments: Input,
  context: ToolNormalizationContext,
  signal?: AbortSignal,
) => Promise<CanonicalInput> | CanonicalInput;
```

Then permission preflight and `execute` receive `CanonicalInput`, not the raw
model request.

This is safer than asking every tool to repeat structural parsing, and it keeps
application-specific resolution out of the generic schema validator.

## 3. Why StorySpark's suspension is a more powerful workflow primitive

> can you explain how story spark's suspension is more powerful durable workflow primitive

A normal tool has only two useful outcomes:

- It finished.
- It failed.

StorySpark adds a third:

- It intentionally paused and needs an external decision before it can
  produce its final result.

### What happens during suspension

The sequence is:

1. The model emits a `propose_project_changes` tool call.
2. The tool parses and resolves the complete proposal without applying it.
3. The tool returns `{ suspended: true, ... }`.
4. The loop emits a suspension event.
5. The loop ends without inventing a normal tool-result message for that call.
6. StorySpark persists the assistant tool call, proposal, context, and
   `awaiting_approval` checkpoint.

The conversation is deliberately left at a valid “open tool call” point.

After the user decides:

1. StorySpark executes or rejects the proposal in a separate durable run.
2. It records progress and the final proposal result.
3. It creates the tool-result message matching the original tool-call ID.
4. It continues the agent loop from that tool result.
5. The model sees the approval outcome as the natural result of its original
   tool request.

### Why this is more powerful than a blocking approval

A blocking approval keeps a function alive:

```text
tool call -> await user -> execute -> return result
```

Suspension turns the workflow into persisted states:

```text
tool call
  -> suspended
  -> awaiting approval
  -> executing
  -> paused / rejected / completed
  -> tool result
  -> model continues
```

Persisted states can be:

- Inspected
- Retried
- Cancelled
- Resumed by another process
- Audited later
- Updated with progress
- Protected with idempotency keys

The original process does not need to remain alive.

### Why it is a general primitive

Although StorySpark currently uses suspension for project proposals, the same
concept can support:

- A production deployment awaiting approval
- A payment awaiting confirmation
- A destructive database migration
- A long media-generation job
- A human review task
- A remote job that completes hours later

The key abstraction is not “show an approval card.” It is “a tool call may
produce its result later, after a durable external workflow.”

## 4. Restarts and expensive or business-critical mutations

> also explain how story spark is safer across restarts and better for expensive or business critical mutations

Expensive mutations are dangerous to repeat. Business-critical mutations are
dangerous to lose, duplicate, or leave in an unknown state.

Examples include:

- Starting paid media generation twice
- Deleting or replacing project content
- Applying half of a multi-step proposal
- Charging a customer
- Deploying a release
- Sending a message or command to an external system

### Why the StorySpark shape is safer

#### Approval and execution are separated

The approval wait does not hold open the execution function. Nothing mutates
until the durable decision workflow begins.

#### The intended operation is frozen

The resolved proposal is saved. Approval applies to a concrete operation list,
not to whatever the model might produce later.

#### Progress is checkpointed

Proposal items are saved while execution proceeds. A retry can distinguish
completed, failed, and not-yet-started work.

#### Partial failure is a real state

A proposal can become paused with a partial or error result. It is not reduced
to a generic failed chat message.

#### Restart reconciliation is explicit

Startup code moves interrupted proposal executions into a paused,
reviewable state. It does not leave them indefinitely marked as running.

#### Conversation continuation is preserved

Once the workflow reaches a final outcome, that outcome is attached to the
original tool-call ID and the model continues normally.

### What DroneHub would need for equivalent safety

Blip needs a durable deferred-tool record containing at least:

- Session ID
- Turn ID
- Tool-call ID and tool name
- Canonical approved arguments
- Current phase
- Approval decision
- Idempotency key
- Progress/checkpoint payload
- Final tool result
- Timestamps and policy version

The session repository also needs operations to create, claim, update, and
finalize that record atomically. On restart, Blip or the host should reconcile
records left in `executing` and decide whether they are retryable, paused, or
failed.

The final result must be appended as the tool result for the original call
before the model continues.

### Important caution

Durable state alone does not prevent duplicate external effects. Every
expensive integration should accept an idempotency key or have a reliable
“lookup by operation ID” recovery path. The workflow checkpoint and the
external service must agree on the identity of the operation.

## 5. A StorySpark-style compaction design that fits DroneHub naturally

> what would it take to implement compaction like we we have in StorySpark, but one that fits naturally into the packages we have in DroneHub.

The best approach is not to copy StorySpark's compactor into DroneHub's host
application. Blip already owns durable sessions and compaction, so Blip should
remain the owner. The missing piece is a clean way for the inner agent loop to
ask Blip for context preflight before every model call.

### The current gap

Today:

- `BlipSession` compacts when a session opens and before a top-level prompt.
- `pi-agent-core` may make several later model calls after tools return.
- A large tool result can push the context over the limit during that same
  run.
- The loop's `transformContext` runs before every model call, but its contract
  is intended as a safe message transform, not as a durable operation that
  writes repository entries and emits compaction events.
- Public `compact()` rejects compaction while a session is running.

Using `transformContext` as a quick prototype is possible, but making it
perform database writes would hide an important state transition inside a
hook described as a message transformation.

### Recommended package responsibilities

#### `packages/ai`: estimate the actual model request

Add a model-aware context estimator that accepts:

- Selected model
- System prompt
- Converted messages
- Tool definitions
- Image metadata
- Requested output reserve

It should return a breakdown, not only one number.

This package should also normalize provider failures into categories such as:

- `context_overflow`
- `output_limit`
- `rate_limit`
- `authentication`
- `transport`
- `other`

Provider-specific error strings belong here.

#### `packages/agent`: add a model-call preflight hook

Add a hook called immediately before every provider call, for example:

```ts
beforeModelCall?: (
  context: {
    messages: AgentMessage[];
    systemPrompt: string;
    tools: AgentTool[];
    reason: "preflight" | "overflow";
    attempt: number;
  },
  signal?: AbortSignal,
) => Promise<{ messages: AgentMessage[] }>;
```

The loop would:

1. Call the hook with `reason: "preflight"`.
2. Use the returned messages for the model call.
3. If `pi-ai` classifies the result as context overflow, call the hook once
   with `reason: "overflow"`.
4. Retry the model call once.
5. Never retry the same overflow indefinitely.

This hook is intentionally stateful, unlike `transformContext`. Its
documentation should permit persistence, events, and failure.

The existing host-supplied `transformContext` can still run afterward for
non-durable filtering or injection.

#### `blip/packages/core`: implement repository-backed preflight

Blip should implement the hook with a `CompactionCoordinator` or equivalent
internal service:

1. Read the latest transcript.
2. Estimate the complete upcoming request.
3. Return current model messages if no compaction is needed.
4. Build a compaction plan if the soft or hard threshold is crossed.
5. Generate a model summary or marked fallback summary.
6. Verify that the new context is smaller and below the required target.
7. Append the compaction entry to the repository.
8. Save session metadata.
9. Emit start/completed/skipped/fallback events.
10. Return `readModelMessages()` from the newly compacted transcript.

This internal path must be allowed while a prompt is active. The public
manual-compaction method can continue to reject active sessions.

Blip already persists every completed user, assistant, and tool-result message
from agent events. Therefore, a preflight before a later tool-loop model call
can read the just-completed tool results from the repository.

#### `SessionRepository`: keep append-only semantics

The current compaction transcript entry is a good foundation. Do not replace
old messages or delete history.

For stronger multi-process safety, add an optional compare-and-append
operation:

```ts
appendCompaction(
  session,
  entry,
  { expectedLatestEntryId }
): Promise<"appended" | "stale">;
```

That prevents two workers from compacting the same boundary concurrently.

#### `blip/protocol`: expose useful compaction details

Events should include:

- Trigger: proactive, hard-limit, or overflow
- Estimate before and after
- Target budget
- Boundary ID
- Whether fallback was used
- Estimator confidence
- Retry attempt

This makes production tuning possible.

#### DroneHub host: provide policy, not the algorithm

DroneHub should choose:

- Soft threshold
- Output reserve
- Recent-turn policy
- Whether deterministic fallback is allowed
- Event destination

The host should not own message selection or summary construction. Those
belong in Blip so CLI, Android, and other hosts get the same behavior.

### Suggested delivery order

#### Phase 1: preflight every model call

Add the agent hook and call existing Blip compaction from it. This fixes the
largest correctness gap: large tool results during one run.

#### Phase 2: enforce compaction postconditions

Bound every serialized message type, include tools/system prompt in the
budget, and refuse a compacted result that is not smaller or still exceeds the
hard target.

#### Phase 3: overflow retry

Normalize provider overflow failures in `pi-ai`, force compaction once, and
retry once.

This phase needs care because `pi-ai` currently represents many provider
errors as completed assistant error messages. The loop should avoid treating a
recoverable overflow attempt as the final canonical assistant response.

#### Phase 4: telemetry-driven tuning

Record estimated versus actual provider input usage and adjust safety margins
per provider/model family.

### Essential tests

- A large tool result crosses the limit between two model calls.
- The latest user turn remains verbatim.
- Tool calls and their results are not split incorrectly.
- Model summarization fails and fallback succeeds.
- Fallback is too large and hard compaction fails safely.
- Repository append fails without changing in-memory model context.
- Aborted compaction does not create a partial entry.
- Overflow causes exactly one retry.
- Host `transformContext` still runs after compaction.
- Restart reconstruction uses the latest valid compaction entry.
- A stale or damaged boundary falls back without silently deleting history.

## 6. Compaction construction and failure

> Can you explain a bit more about compaction construction and failure

Compaction has four separate jobs:

1. Decide whether to compact.
2. Choose what old content to summarize.
3. Construct and persist the new summary boundary.
4. Decide what to do if any part fails.

### How Blip constructs a compaction

#### Step 1: find the current history range

Blip finds the most recent compaction entry. If one exists, the next summary
updates that previous summary plus the messages retained after its boundary.

#### Step 2: choose a complete recent tail

Blip finds recent user turns. It keeps at least two and expands backward by
whole user turns while the retained content stays inside the recent-token
budget.

This avoids beginning the retained context in the middle of a conversational
turn.

#### Step 3: prepare summary input

Older messages are serialized into tagged `<message>` blocks. Tool-result text
is capped, while ordinary user and assistant text currently has much looser
bounds.

If a previous summary exists, it is included so the model can update it
instead of starting over.

#### Step 4: ask the active model for a structured summary

The summary prompt requires sections for the goal, constraints, progress,
decisions, next steps, critical context, and relevant files.

Blip uses the selected model and reasoning setting. Summary output is capped
against the reserved output budget and model maximum.

#### Step 5: add deterministic file metadata

Blip independently tracks files read and modified. It appends that metadata
after model summarization, so important file names do not depend entirely on
the summary model remembering them.

#### Step 6: append a boundary entry

The compaction entry stores:

- The summary
- The first retained transcript entry ID
- Tokens before
- Estimated tokens after
- Trigger type
- File details

Raw messages remain in the append-only transcript.

#### Step 7: reconstruct model context

For future inference, the repository returns:

1. One synthetic user message containing the summary.
2. Retained messages before the compaction entry.
3. Messages appended after the compaction entry.

### How Blip handles failure today

#### Nothing can be compacted

Blip emits `compaction_skipped` and continues.

#### Model summarization fails or returns no text

Blip creates a deterministic local summary from recent user goals, tool
results, previous summary state, and file metadata.

#### The user aborts compaction

Abort is not converted into fallback. It propagates as an abort, and no
compaction entry should be appended.

#### Repository append or save fails

The compaction operation fails. Because the entry was not safely committed,
the runtime should not switch permanently to the proposed compacted context.

#### The saved boundary is damaged

During reconstruction, if the `firstKeptEntryId` cannot be found, Blip returns
the full message history. This favors not losing information, although it may
recreate the context-overflow problem.

### Where StorySpark is stricter

StorySpark:

- Caps total summary serialization.
- Caps user text, assistant text, tool input, and tool-result text separately.
- Protects the latest real user message.
- Aligns a boundary so a tool result does not lose its matching call.
- Verifies that compacted context is actually smaller.
- Verifies that it is below a required target.

If proactive compaction fails, StorySpark can continue with the original
context. If hard-limit or overflow compaction fails, it stops with a clear
context-too-large error.

### Best combined failure policy

Use different rules at different levels:

#### Soft/proactive threshold

- Try model summary.
- Use a marked deterministic fallback if needed.
- If compaction still does not help, keep the original context and continue.

#### Hard threshold

- Try model summary, then fallback.
- Verify the new request fits with reserve.
- If it does not fit, stop before calling the provider with a clear error.

#### Provider-reported overflow

- Force a new compaction.
- Verify the result.
- Retry the provider exactly once.
- If it still overflows, stop and preserve diagnostic estimates.

In every case, raw history should remain durable and fallback use should be
visible in the compaction entry and runtime events.

## 7. Best path forward for token accounting

> What do you think is the best path forward for token accounting

The best path is a model-aware budget calculator in `packages/ai`, used by
Blip immediately before every model call.

### Why the current estimate is insufficient

Blip often estimates a message as:

```text
JSON.stringify(message).length / 4
```

That is a reasonable emergency heuristic for text, but it has important
problems:

- Base64 image bytes are counted like ordinary text.
- The system prompt is not clearly represented in the compaction estimate.
- Dynamic tool descriptions and JSON Schemas are not fully represented.
- Provider message wrappers have different overhead.
- Thinking signatures and provider metadata may or may not be sent.
- The latest usage record describes a previous request, whose tools or system
  prompt may differ from the next request.

### Recommended accounting model

Return a structured budget:

```ts
interface ContextBudget {
  systemPromptTokens: number;
  messageTokens: number;
  toolDefinitionTokens: number;
  imageTokens: number;
  providerOverheadTokens: number;
  requestedOutputTokens: number;
  safetyMarginTokens: number;
  inputTotal: number;
  contextRequired: number;
  contextWindow: number;
  confidence: "exact" | "model-tokenizer" | "heuristic";
}
```

`contextRequired` should mean:

```text
estimated input
  + requested output reserve
  + safety margin
```

### Where each part should live

#### `packages/ai`

- Provider/model tokenization where a compatible tokenizer exists
- Provider-specific message and tool overhead
- Model-aware image estimates
- Context window and output limits
- Final converted-request estimation

#### `packages/agent`

- Calls the estimator at the final preflight point
- Exposes the result to the context-management hook
- Does not decide Blip's compaction policy

#### `blip/packages/core`

- Chooses soft and hard thresholds
- Chooses recent turns
- Invokes compaction
- Stores estimate breakdowns in events
- Decides whether the request is safe to send

### Images should not be estimated from base64 length

Store or derive:

- Width
- Height
- MIME type
- Provider detail mode
- Optional frame/page count

Then apply the selected provider's image accounting rule. If dimensions are
not available, use a conservative fixed estimate rather than the base64
string's character count.

Moving image bytes into repository blobs would make message estimation and
transcript storage cleaner at the same time.

### Tool schemas must be included

DroneHub's tool catalog can be large and dynamic. Before the provider call,
serialize the exact tool definitions that the provider adapter will send and
estimate those tokens too.

This matters because a thread can have a small conversation but a very large
tool catalog.

### Use actual usage to calibrate, not blindly replace estimates

After every successful call, record:

- Estimated provider input tokens
- Actual provider input tokens
- Difference and percentage error
- Provider, API, and model
- Message/tool/image breakdown

Use that telemetry to tune provider-specific safety margins.

The latest actual input usage remains a useful baseline for a mostly unchanged
context, but it should be invalidated or adjusted when:

- The system prompt changes.
- The tool catalog changes.
- The model/provider changes.
- Compaction changes the transcript.
- Images are added or removed.

### Practical rollout

1. Add complete heuristic breakdowns first.
2. Stop counting inline base64 as text.
3. Include exact system prompt and tool-schema serialization.
4. Add tokenizer-backed estimates for the most-used models.
5. Compare estimates with actual usage in runtime events.
6. Tune margins before lowering compaction thresholds.

The goal is not perfect token counting. The goal is a conservative,
explainable decision that rarely sends an oversized request and does not
compact far earlier than necessary.

## 8. Adding a portable skill provider to Blip

> the take to add a portable skill provider to blip.

Interpreting this as: what would it take to add a portable skill provider to
Blip?

DroneHub already has a skill catalog and projects skills into other agent
runtimes. Blip also has a `loadedSkills` field in session metadata. The missing
piece is a runtime contract connecting a skill source to Blip's prompt and
tools.

### Define a host-neutral provider contract

Add a Blip interface that does not import DroneHub skill types:

```ts
interface BlipSkillDescriptor {
  id: string;
  name: string;
  description: string;
  version?: string;
  digest?: string;
}

interface BlipLoadedSkill extends BlipSkillDescriptor {
  instructions: string;
}

interface BlipSkillProvider {
  id: string;
  list(context: BlipSessionContext): Promise<BlipSkillDescriptor[]>;
  load(
    skillId: string,
    context: BlipSessionContext,
  ): Promise<BlipLoadedSkill>;
  readResource?(
    skillId: string,
    resourcePath: string,
    context: BlipSessionContext,
  ): Promise<{ mimeType: string; content: string | Uint8Array }>;
}
```

The Blip core should know only this interface. DroneHub can adapt its existing
catalog; another host can read filesystem skills, embedded resources, or a
remote registry.

### Add a generic lazy-loading tool

Blip can expose a standard `load_skill` tool when providers are present.

The initial system prompt should include only a compact catalog:

- Skill ID
- Name
- One-line description
- When to load it

The complete instructions should be loaded only when needed. This avoids
putting every skill into every model request.

### Make loading durable

Updating only `state.loadedSkills` is not enough because a skill may change
between runs.

Persist a transcript entry such as:

```ts
{
  type: "skill_loaded",
  id: "...",
  skillId: "...",
  providerId: "...",
  version: "...",
  digest: "...",
  instructions: "the exact loaded snapshot",
  loadedAt: "..."
}
```

On restart, prompt assembly can reconstruct the loaded skill from that
snapshot. A later catalog edit will not silently change the meaning of an old
session.

The existing `loadedSkills` array can remain a convenient index, but the
transcript entry should be the source of truth.

### Keep skill instructions available after compaction

A skill's original tool result may eventually be summarized away. Loaded
skill instructions should therefore be re-injected through prompt assembly or
another dedicated context section while the skill remains active.

To control context size:

- Put full instructions only for loaded skills in the system prompt.
- Set per-skill and total byte limits.
- Allow unloading a skill.
- Record a digest so duplicate loads do not repeat content.

### Skill resources need a safe read path

If skills have `references/`, templates, or scripts, add a bounded
`read_skill_resource` tool or provider method.

It must:

- Accept only a resource declared by that skill.
- Reject absolute paths and traversal.
- Enforce byte and MIME limits.
- Treat resources as read-only.
- Never grant filesystem or shell authority merely because instructions ask
  for it.

### Skills must not expand permissions

A skill is guidance, not authority.

Loading a skill must not:

- Add an unapproved shell tool.
- Broaden workspace access.
- Bypass approval.
- Change the session permission mode.
- Read arbitrary files outside its declared resources.

If a skill needs optional tools, the host should still decide whether those
tools are enabled.

### Package placement

- `blip/packages/core`: provider interfaces, loaded-skill state, prompt
  assembly, transcript semantics
- `blip/packages/tools` or a small new package: generic `load_skill` and
  `read_skill_resource` tools
- `blip/protocol`: skill-loaded/unloaded events
- DroneHub: adapter from its existing skill catalog to `BlipSkillProvider`
- Session repositories: support the new transcript entry

### Tests

- Duplicate provider and skill IDs
- Lazy loading and prompt injection
- Restart with the exact persisted skill snapshot
- Skill catalog changes after loading
- Compaction while skills are active
- Resource traversal and size limits
- Two providers offering the same display name
- Loading does not expand tools or permissions
- Forked sessions preserve the correct loaded skill snapshot

## 9. Blip permissions and safety, in simple detail

> Can you explain in detail in simple terms the permissions and safety for blip? How does that work?

Blip safety is not one master switch. It is a series of gates. A tool call must
make it through all applicable gates before the side effect happens.

The easiest mental model is airport security:

```text
Is this tool present?
  -> Is this target capable?
  -> Is the target inside the thread's scope?
  -> Are the arguments valid?
  -> Is the path safe?
  -> Does this call require approval?
  -> Execute
  -> Record what happened
```

### Gate 1: tool profile decides which local tools exist

Blip defines these profiles:

#### `read-only`

Exposes:

- Read file
- Search files
- List files
- Working-tree status

It does not expose write, delete, patch, or shell tools.

#### `no-shell-workspace-write`

Exposes structured workspace operations:

- Read, search, and list
- Apply patch
- Write file
- Delete file
- Create/delete directory
- Move path
- Git working-tree status

It deliberately does not expose the local generic shell.

#### `local-trusted-write`

Exposes:

- Shell
- Apply patch
- Read, search, and list

The profile is the strongest early safety boundary because a missing tool
cannot be called by the model.

DroneHub's native Blip session uses `no-shell-workspace-write` for the local
profile. It may separately expose a remote workspace `bash` tool when a target
has shell capability.

### Gate 2: thread configuration filters enabled tools

DroneHub stores which tools are enabled for the thread. The runtime builds the
catalog from that set.

This matters because Blip's packages may know how to create a tool without
that tool necessarily being visible in a particular conversation.

Prompt instructions are not the security boundary here. Catalog omission is.

### Gate 3: workspace capabilities limit each target

Each workspace target advertises capabilities such as:

- `files.read`
- `files.write`
- `files.delete`
- `files.move`
- `patch.apply`
- `shell.execute`
- `git.status`

DroneHub derives those capabilities from the thread's access to each drone or
workspace. It excludes tools when no target supports the required capability.

The workspace tool wrapper checks capability again at execution time. That
second check is important because catalog construction and execution can be
separated in time.

### Gate 4: thread scope restricts concrete drones

DroneHub has read, write, and execute scope for existing drones.

Before sensitive operations, it resolves friendly names to stable IDs and
checks that the selected drone is in the appropriate scope.

Examples:

- Reading needs read scope.
- Sending a drone message needs write scope.
- Renaming or regrouping a drone needs write scope.
- Bash needs execute scope.

MCP setup also receives allowed readable refs, writable refs, and drone IDs.
That constrains in-process Drone Hub MCP calls.

Some global creation tools are intentionally outside existing-drone scope.
Their availability is controlled by whether the tool is enabled and by their
own policy.

### Gate 5: schema validation protects the call boundary

Before permission preflight or execution, `pi-agent-core` validates and
coerces tool arguments against the tool's schema.

This prevents malformed arguments from reaching permission or execution code
and gives the model a structured error it can correct.

### Gate 6: path confinement protects local workspaces

Structured local file tools reject:

- Absolute paths
- Relative paths that lexically escape with `..`

They resolve accepted paths relative to the configured workspace root.

Workspace transfer code is stricter: it uses `realpath` checks on existing
paths and ancestors to prevent symlink-based escape.

There is an important limitation: the ordinary `assertWorkspacePath` helper is
lexical. It verifies the resolved path string, but ordinary file tools do not
all perform the same canonical `realpath`/symlink checks used by transfer
operations. A symlink inside the workspace that points outside deserves a
focused security review.

### Gate 7: permission preflight can deny or require user approval

Blip exposes a general `permissionPreflight` hook. Before execution, Blip gives
the host:

- Session
- Tool name
- Call ID
- Validated arguments
- Abort signal

The host returns allow or deny.

DroneHub uses this hook to require approval for selected operations, including:

- Sending a message to a drone
- Changing drone groups
- Renaming drones
- Running Bash

Before asking, DroneHub resolves and sanitizes the real target and builds a
human-reviewable argument object. For example, Bash approval contains the
resolved drone or workspace, command, working directory, and timeout.

If the thread has `autoApprove`, the user approval wait is skipped. Scope and
target-resolution checks still need to pass.

### How the approval wait works

DroneHub:

1. Creates an approval ID.
2. Stores a pending approval in an in-memory map.
3. Marks the thread `waiting_for_approval`.
4. Waits on a Promise.
5. Resolves it when the user approves, denies, or aborts.
6. Returns allow or a denied tool result to the agent loop.

If approved, the same live tool call continues. If denied, the tool is blocked;
the explicit denial path can also stop the current runtime.

This design is straightforward but not restart-safe because the map and
Promise are not durable.

### Gate 8: execution adapters enforce target-specific rules

After approval, the workspace target or MCP adapter performs the operation.
The adapter can enforce additional rules that Blip core does not understand,
such as:

- Drone readiness
- Remote path conventions
- Transfer capabilities
- Device ownership
- Message routing
- Artifact workspace restrictions

Blip provides the common call boundary; the host remains responsible for
domain authorization.

### Gate 9: events and file tracking provide an audit trail

Blip records:

- Tool start
- Progress
- Completion or failure
- Arguments and result details
- Files read and changed
- Session timing and failure status

Audit is not prevention, but it is essential for diagnosing incorrect policy
or unexpected side effects.

### What `permissionMode` does today

Blip stores `read-only`, `workspace-write`, or `full-access` in session state
and passes it through session/tool context.

However, in the current implementation, `permissionMode` is not by itself a
universal policy engine that inspects every tool call. The concrete safety
behavior is driven mainly by:

- Tool profile
- Which tools DroneHub enables
- Workspace capabilities
- Thread access scope
- Path checks
- Host permission preflight
- Tool-specific execution checks

That distinction matters. Setting a field to `read-only` is safe only if the
host and tool providers use it consistently when constructing the catalog.

### What is protected by approval—and what is not

Approval is selective. Bash, messaging, rename, and grouping are gated.
Structured file writes generally rely on enabled tools plus workspace write
scope; they do not automatically ask for approval on every call.

This can be the correct product policy, but it should be explicit. “Blip has an
approval system” does not mean “every mutation is approved.”

### Main risks in the current design

1. **Approval state is in memory.** A restart loses the pending workflow.
2. **Policy is distributed.** Safety depends on correct composition across
   tool profile, host catalog, target capability, scope, and preflight.
3. **`permissionMode` is not universally enforced.** A new provider could
   expose a tool without respecting the intended mode.
4. **Unknown tools do not have a central risk classification.** The host must
   remember to gate each sensitive tool.
5. **Path canonicalization is not uniform.** Transfer paths receive stronger
   symlink handling than ordinary structured file paths.
6. **Approval and execution must use the same resolved call.** Re-resolving a
   friendly target later can create time-of-check/time-of-use differences.
7. **MCP safety depends on both sides.** Blip can filter and scope calls, but an
   MCP server must still enforce its own authority correctly.

### Recommended safety direction

#### Centralize policy decisions

Define one Blip policy result:

```ts
type ToolPolicyDecision =
  | { status: "allow"; canonicalArgs: unknown }
  | { status: "deny"; reason: string }
  | {
      status: "require_approval";
      canonicalArgs: unknown;
      approval: ApprovalDescription;
    };
```

Every tool call should pass through it after schema validation and domain
normalization.

#### Make permission mode enforce capabilities

Map modes to explicit capabilities:

- `read-only`: read capabilities only
- `workspace-write`: reads plus structured workspace writes
- `full-access`: may include shell and broader host operations

Unknown tools should be denied unless a provider declares their required
capabilities.

#### Make approvals durable

Persist approval ID, canonical arguments, policy version, session/turn/call
IDs, and status. Resume or reconcile them after restart.

#### Freeze approved arguments

The exact canonical arguments shown for approval should be the arguments used
for execution. Do not approve one target and then resolve a potentially
different target later.

#### Harden path access

Use canonical or handle-relative filesystem operations that prevent symlink
escape for every structured file tool, not only transfers.

#### Record policy decisions

Runtime events should state:

- Which capability was required
- Which target and scope were resolved
- Whether approval was required
- Which policy version made the decision
- The final allow/deny result

### Bottom line

Blip has good building blocks: limited tool profiles, local path confinement,
typed validation, target capabilities, host preflight, and rich audit events.

Its current safety model is compositional rather than centralized. That makes
it flexible, but it also means no single layer can guarantee safety by itself.
The next step should be a central capability-based policy contract plus
durable approvals and uniform path hardening.

## Relevant Source Locations

### StorySpark

- `~/dev/mojo/StorySpark/packages/agent/src/agent-loop.ts`
- `~/dev/mojo/StorySpark/packages/agent/src/types.ts`
- `~/dev/mojo/StorySpark/apps/api/src/assistant/assistantContextCompaction.ts`
- `~/dev/mojo/StorySpark/apps/api/src/assistant/proposeProjectChangesTool.ts`
- `~/dev/mojo/StorySpark/apps/api/src/assistant/AssistantSessionRunner.ts`
- `~/dev/mojo/StorySpark/apps/api/src/assistant/assistant_session_execution_outcome.ts`
- `~/dev/mojo/StorySpark/apps/api/src/db/AssistantSessionsDb.ts`

### DroneHub, Blip, and Pi

- `packages/agent/src/agent-loop.ts`
- `packages/agent/src/types.ts`
- `packages/ai/src/utils/validation.ts`
- `blip/packages/core/src/blip-session.ts`
- `blip/packages/core/src/blip-session-types.ts`
- `blip/packages/core/src/compaction.ts`
- `blip/packages/core/src/model-context.ts`
- `blip/packages/core/src/session-repository.ts`
- `blip/packages/core/src/types.ts`
- `blip/packages/tools/src/tools.ts`
- `blip/packages/tools/src/path-utils.ts`
- `blip/packages/tools/src/workspace-target.ts`
- `blip/packages/workspace/src/index.ts`
- `apps/drone/src/hub/assistant-runtime.ts`
- `apps/drone/src/hub/assistant.ts`
- `apps/drone/src/hub/assistant/assistant-config.ts`
- `apps/drone/src/hub/assistant/blip-assistant-host.ts`
