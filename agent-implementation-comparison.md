# StorySpark Agent Assistant vs. DroneHub Native Agent and Blip

## Scope

This document compares the internal agent implementations in:

- StorySpark's agent assistant at `~/dev/mojo/StorySpark`
- DroneHub's native built-in agent in this repository
- Blip, which provides the session runtime used by DroneHub
- The local `pi-agent-core` and `pi-ai` packages underneath Blip

The comparison covers agent loops, models, provider handling, tools, schemas,
approvals, persistence, compaction, images, instructions, safety, and
observability. It deliberately excludes the user interface and other
presentation concerns.

---

## 1. Overall Architecture

**Simple summary:** StorySpark owns a vertically integrated product agent,
while DroneHub assembles its agent from reusable Blip, agent-loop, and model
provider layers.

### What this is

The architecture determines which component owns conversation state, model
calls, tool execution, persistence, and product-specific policy. A more
integrated design is often easier to tune for one product, while separated
layers are easier to reuse and replace.

### StorySpark

The StorySpark stack is approximately:

```text
AssistantSessionRunner
  -> StorySpark Agent
    -> StorySpark agent loop
      -> ToolCallingModelClient
        -> StorySpark provider adapters
      -> FilmSpark project tools
```

`packages/agent` provides the generic agent and loop. The StorySpark API then
supplies the model client, provider conversion, compactor, system prompt,
tools, persistence, proposal handling, and run lifecycle.

The complete assistant is therefore split between a small reusable core and a
larger application-owned implementation. In particular, model conversion and
provider-specific continuation behavior remain part of the StorySpark
assistant subsystem.

### DroneHub and Blip

The DroneHub stack is approximately:

```text
BlipAssistantHost
  -> BlipSession
    -> pi-agent-core Agent
      -> pi-agent-core agent loop
        -> pi-ai provider registry and streaming
      -> DroneHub, workspace, and MCP tools
```

DroneHub binds each thread to a Blip session. Blip owns session lifecycle,
repository contracts, compaction, and runtime events. `pi-agent-core` owns the
model-and-tool loop. `pi-ai` owns provider dispatch, model metadata,
provider-specific message conversion, and streaming.

DroneHub injects its product policy through the system prompt, tool providers,
workspace targets, MCP integration, API-key resolution, permission preflight,
and prompt lifecycle hooks.

### Thoughts

DroneHub has the cleaner reusable architecture. StorySpark's tighter
integration gives it strong control over FilmSpark-specific behavior, but its
provider and assistant layers carry more responsibilities. The best aspect to
preserve from StorySpark is its durable product workflow; the best aspect to
preserve from DroneHub is the separation between host, session runtime, agent
loop, and provider implementation.

---

## 2. Canonical Message Schema

**Simple summary:** StorySpark uses a smaller normalized message format, while
DroneHub preserves more provider, reasoning, usage, and diagnostic data in the
conversation.

### What this is

The canonical message schema is the format passed between model calls, tool
execution, persistence, and replay. It controls how much information survives
between turns and whether old messages remain valid when the selected model
changes.

### StorySpark

StorySpark uses three main roles:

- `user`
- `assistant`
- `toolResult`

User content is either text or a list of text and URL-based image parts.
Assistant messages contain text and tool calls. Tool results contain text or
text-and-image parts.

Assistant messages can also include:

- A normalized reasoning trace
- Stop reason
- Token usage
- Model duration
- Error information
- Timestamp

Tool calls store an ID, name, arbitrary input, and optional provider round-trip
data. The originating API, provider, and concrete model are not required on
every assistant message.

### DroneHub and Blip

DroneHub inherits the richer `pi-ai` schema. It uses the same basic roles, but
assistant content is divided into first-class text, thinking, and tool-call
blocks.

An assistant message also records information such as:

- API protocol
- Provider
- Requested model
- Concrete response model
- Provider response ID
- Input, output, cache, and total usage
- Calculated cost
- Stop reason
- Diagnostics
- Timestamp

Text, thinking, and tool-call blocks can preserve opaque provider signatures.
Images are stored as base64 data plus MIME type instead of URL references.

### Thoughts

StorySpark's schema is easier to inspect and sufficient for a controlled
product catalog. DroneHub's schema is a better foundation for a general agent
because it supports cost accounting, provider diagnostics, signed reasoning,
and cross-model replay. Its tradeoff is significantly larger and more complex
transcripts.

---

## 3. Agent Loop

**Simple summary:** Both loops repeat model calls and tool execution, but
StorySpark puts compaction and durable suspension closer to the loop, while
DroneHub emphasizes streaming and configurable termination.

### What this is

The agent loop is the state machine that turns one prompt into one or more
model turns. It decides when to call the model, execute tools, insert queued
messages, stop, or recover.

### StorySpark

The StorySpark loop performs the following sequence:

1. Add the new prompt or resume from existing context.
2. Check for steering messages.
3. Compact before the next model call when necessary.
4. Call the model.
5. Append the assistant message.
6. Execute requested tools.
7. Append tool results.
8. Repeat while tool calls or steering messages remain.
9. Process follow-up messages after the agent would otherwise finish.

It can continue from a tool-result message without adding a new user prompt.
That behavior supports resuming a proposal that previously suspended.

The loop returns both the newly generated messages and the final model-visible
context. It can also return a suspended tool call.

### DroneHub and Blip

The `pi-agent-core` loop has a similar outer and inner structure:

1. Add the prompt.
2. Poll steering.
3. Transform the current context.
4. Convert agent messages for the selected model.
5. Stream the assistant response.
6. Execute tool calls.
7. Append tool results.
8. Poll steering and follow-up queues.

It supports a `shouldStopAfterTurn` hook and tool-result termination hints.
Compaction and durable session behavior are not owned directly by this loop;
Blip wraps it with those concerns.

### Thoughts

The basic design is sound in both systems. StorySpark is stronger at in-loop
context management and resumable workflows. DroneHub is stronger at
incremental model handling and generic termination controls. Neither loop has
a hard turn ceiling, so a broken model/tool cycle ultimately depends on
cancellation, suspension, or an external stop condition.

---

## 4. Model Streaming

**Simple summary:** DroneHub consumes real incremental provider streams, while
StorySpark generally waits for a complete provider response and then exposes
it through a streaming-shaped interface.

### What this is

Streaming exposes text, reasoning, and tool-call arguments as the provider
generates them. Buffered handling waits for the complete response before
returning meaningful model output.

### StorySpark

`ToolCallingModelClient.streamTurn()` presents a stream-like contract to the
generic agent, but its provider paths are effectively buffered:

- OpenAI Responses uses a completed response call.
- OpenAI Chat uses a completed chat request.
- Anthropic opens a stream but waits for its final message.

Once decoded, the client emits the complete assistant content as a message
delta followed by a message-end event.

### DroneHub and Blip

`pi-ai` exposes a structured provider stream with events for:

- Stream start
- Text start, delta, and end
- Thinking start, delta, and end
- Tool-call start, argument delta, and end
- Completion
- Error

The agent loop updates a partial assistant message as events arrive. Blip
translates relevant events into its runtime event protocol and persists the
completed message.

Some DroneHub transports intentionally omit high-volume token deltas, but that
does not change the fact that the internal provider and loop layers are truly
streaming.

### Thoughts

DroneHub is clearly stronger here. True streaming improves time to first
output, cancellation, diagnostics, and observation of tool-call construction.
StorySpark already has an appropriate abstraction boundary, but its provider
implementations do not yet obtain most of the benefits that boundary implies.

---

## 5. Model Catalog and Selection

**Simple summary:** StorySpark exposes more model families directly, while
DroneHub exposes a narrower native list backed by a more capable reusable
model registry.

### What this is

The model catalog defines the models users may select, how product names map
to provider IDs, which capabilities each model has, and which context and
output limits apply.

### StorySpark

StorySpark has a fixed product catalog containing GPT, Claude, and Gemini
variants. Its default is GPT-5.6 Luna.

Display names map manually to concrete provider model identifiers. Workspace
availability and API-key policy can remove models from the available set.
Each run snapshots the chosen model and reasoning effort, keeping an existing
run stable even if thread settings later change.

### DroneHub and Blip

DroneHub's native catalog currently concentrates on GPT-5.5 and GPT-5.6
variants through OpenAI and Codex, plus Gemini 3 Flash. The default OpenAI and
Codex selection is GPT-5.6 Sol.

The underlying `pi-ai` registry is broader and stores structured metadata for
each model:

- Provider and API protocol
- Base URL
- Reasoning support and thinking levels
- Text and image input support
- Context window
- Maximum output
- Cost rates
- Provider compatibility flags

Blip resolves the chosen provider and model against this registry.

### Thoughts

StorySpark currently offers the broader product selection, especially because
it includes Anthropic models. DroneHub has the stronger abstraction: model
capabilities and limits are data rather than scattered product conditionals.
That should make adding models easier as long as authentication and host
policy are added alongside the registry entry.

---

## 6. Provider Adaptation and Reasoning Continuity

**Simple summary:** StorySpark normalizes provider reasoning into a simpler
trace, while DroneHub preserves signed provider blocks and explicitly
transforms them when the model changes.

### What this is

Providers use different message formats and may return opaque reasoning
signatures or encrypted continuation data. Some of that information is valid
only when replayed to the same provider and model.

### StorySpark

StorySpark converts provider reasoning into a normalized trace with:

- `raw` or `summary` kind
- Text blocks
- Optional truncation information

It preserves selected provider round-trip data on tool calls, including Gemini
thought signatures and OpenAI Responses output items. Provider codecs decide
which fields are valid to replay to a target provider.

This logic lives inside the StorySpark assistant's provider conversion layer.

### DroneHub and Blip

`pi-ai` treats thinking as first-class assistant content. Text, thinking, and
tool calls can retain provider signatures.

Before replaying history, it compares the source and destination
provider/API/model:

- Same-model signed reasoning can be preserved.
- Readable cross-model reasoning can become ordinary text.
- Opaque reasoning that cannot be replayed safely is removed.
- Incompatible provider signatures are removed.
- Tool-call IDs are normalized for providers with stricter formats.

### Thoughts

DroneHub's implementation is more complete for switching models within a
thread. StorySpark's normalized trace is easier to work with in one product,
but it loses some fidelity and leaves continuity behavior inside a large
feature-specific provider client. Provider transformation belongs in a layer
such as `pi-ai`.

---

## 7. Model Failure and Retry Handling

**Simple summary:** StorySpark has explicit agent-level recovery for several
bad model outcomes, while DroneHub mainly normalizes provider failures and
ends the current run.

### What this is

A model call can fail due to a network problem, provider error, empty output,
output limit, invalid replay context, or context overflow. Recovery policy
decides what can be retried without user intervention.

### StorySpark

StorySpark includes explicit behavior for:

- Retrying empty responses up to three times
- Using abort-aware delays between empty-response retries
- Regenerating once after a `max_tokens` result
- Compacting and retrying once after recognized context overflow
- Attaching redacted provider-request diagnostics to failures

If a second generation also reaches the output limit, the client converts the
condition into an assistant error rather than looping indefinitely.

### DroneHub and Blip

`pi-ai` providers have transport or SDK retry behavior with request retry
limits and delay caps. Provider failures become assistant messages with
`error` or `aborted` stop reasons.

The core loop stops on those outcomes. It does not automatically regenerate a
`length` result, and it does not invoke in-loop compaction after context
overflow. Blip records the session failure when the error prevents a clean
completion.

### Thoughts

StorySpark has the more resilient policy today. DroneHub handles provider
errors consistently but lacks conversation-level recovery for empty output,
truncation, and context overflow. Those policies should be added above the
individual provider adapters because they can change transcript and
compaction state.

---

## 8. Tool Catalog and Composition

**Simple summary:** StorySpark gives the model a small fixed set of
FilmSpark-specific tools, while DroneHub builds a dynamic catalog from native,
workspace, capability, and MCP tools.

### What this is

Tool composition determines which actions the model can see during a turn and
how tools from multiple sources are combined into one catalog.

### StorySpark

StorySpark constructs a product-specific set of tools for:

- Loading skills
- Reading current project context and summaries
- Reading and searching scripts
- Reading scenes, shots, and assets
- Inspecting selected images

The project-change proposal tool is included only when the current workspace
and project context allow proposals.

All of these tools understand FilmSpark concepts directly and execute inside
the StorySpark API.

### DroneHub and Blip

DroneHub constructs the tool catalog per thread from:

- Thread-enabled built-in tools
- Available workspace targets
- Target-selection and transfer tools
- Capability-filtered filesystem and shell tools
- Web search and content-fetching tools
- In-process Drone Hub MCP tools
- System-prompt and thinking-level tools

Workspace tools appear only when an active target has the required
capability. MCP tools receive safe names and Blip correlation metadata.

### Thoughts

StorySpark's narrow catalog is easier for the model to understand and safer by
default. DroneHub's system is much more extensible and appropriate for a
general agent, but dynamic composition increases the chance of tool-name
collisions, excessive prompt size, and permission mistakes.

---

## 9. Tool Schemas and Argument Validation

**Simple summary:** StorySpark relies on each tool to opt into local parsing,
while DroneHub validates every tool call against a compiled schema.

### What this is

Tool schemas guide the model's argument generation. Runtime validation then
protects the application from malformed or incorrectly typed model output.

### StorySpark

A generic StorySpark tool contains:

- Name and description
- Arbitrary input schema
- Optional provider strictness flag
- Optional `prepareInput`
- Execute function

Most application tools combine handwritten JSON Schema with a Zod parser.
JSON Schema is sent to the provider, while `prepareInput` performs local
parsing and normalization.

The generic loop does not automatically compile every input schema. A tool
without `prepareInput` therefore receives the raw model arguments. Most
read-oriented tools request provider strictness, while the more complicated
proposal tool performs its own extensive parsing.

### DroneHub and Blip

DroneHub tools use TypeBox schemas or ordinary JSON Schema. Before execution,
`pi-agent-core`:

1. Clones the arguments.
2. Applies TypeBox conversion.
3. Applies additional coercion for ordinary JSON Schema.
4. Compiles and caches a validator.
5. Returns detailed path-based validation errors to the model.

MCP schemas pass through the same validation path. Provider-side strictness is
separate and depends on the provider adapter.

### Thoughts

DroneHub has the safer generic default because local validation is mandatory.
StorySpark's Zod path supports richer domain transformations, but its
correctness depends on every tool implementing parsing correctly. An ideal
design would combine mandatory schema validation with an optional
domain-specific normalization step.

---

## 10. Tool Parallelism, Progress, and Termination

**Simple summary:** Both systems can run independent tools concurrently, but
DroneHub has more explicit batch preparation and termination semantics, while
StorySpark supports suspension.

### What this is

One assistant message can request multiple tools. The loop must decide whether
they can run concurrently, preserve result ordering, report progress, and
handle unusual outcomes.

### StorySpark

Tools run in parallel unless the loop or a requested tool requires sequential
execution.

Each tool call can participate in:

- Before-tool hooks
- Progress events
- Execution
- After-tool hooks
- Error conversion
- Suspension

Parallel completions may arrive in completion order, but tool-result messages
are appended in the original tool-call order. If a call suspends in a
sequential batch, later calls become skipped error results. If several
parallel calls suspend, only one suspension is retained.

### DroneHub and Blip

DroneHub also defaults to parallel execution and switches the batch to
sequential mode if any requested tool requires it.

For parallel execution, validation and permission preflight occur before the
prepared calls run concurrently. Completion events can arrive out of order,
while finalized result messages retain source order.

Progress-listener failures do not turn an already successful side effect into
a tool failure. Tool results can also include a termination hint; the loop
ends after the batch when all finalized calls request termination.

### Thoughts

Both implementations handle ordering carefully. DroneHub's progress and batch
semantics are more explicit. StorySpark's suspension is a more powerful
workflow primitive, while DroneHub's termination hint is useful when a tool
knows another model call would add no value.

---

## 11. Approval and Suspension

**Simple summary:** StorySpark durably ends and later resumes work around an
approval, while DroneHub pauses the live tool invocation in memory.

### What this is

Approval prevents a sensitive action from executing until a user or policy
allows it. The major design choice is whether the approval suspends durable
work or blocks a currently running process.

### StorySpark

The `propose_project_changes` tool does not immediately mutate the project.
It:

1. Reads and resolves the current project state.
2. Parses the proposed operations.
3. Returns a suspended tool outcome.
4. Ends the current agent run.
5. Persists the proposal and checkpoint.

After a decision, proposal execution proceeds through a durable workflow. Its
result is converted into the missing tool-result message, and the agent
continues from that transcript.

The proposal, selection, progress, and result can survive a server restart.

### DroneHub and Blip

DroneHub performs approval through Blip's permission preflight integration.
The preflight resolves and sanitizes the real target and arguments, creates an
approval record, changes thread status, and waits for approval or abort.

If approved, the original invocation continues inside the same live agent
run. If denied, the model receives a denied tool result.

### Thoughts

DroneHub's flow is simple and gives the model immediate continuity, but the
active process must remain alive. StorySpark is operationally stronger for
long-running or business-critical changes. Blip would benefit from a generic
repository-backed suspension contract while retaining its simpler in-memory
preflight for short-lived approvals.

---

## 12. Steering, Follow-Ups, and Prompt Queueing

**Simple summary:** Both cores support steering and follow-ups, but DroneHub
can combine a durable prompt queue with live ASAP steering.

### What this is

Steering changes direction after the current model or tool turn. Follow-ups
wait until the agent would otherwise stop. Durable prompt queues ensure that
new messages are not lost while an agent is busy or restarting.

### StorySpark

The StorySpark `Agent` has in-memory steering and follow-up queues with
all-at-once and one-at-a-time modes.

The production assistant mainly uses a database-backed message queue:

- Only one run is active for a session.
- Additional messages are durably queued.
- The runner claims the next message after the current run settles.
- Each queued message normally begins a new top-level run.

### DroneHub and Blip

`pi-agent-core` provides similar steering and follow-up concepts. Blip exposes
operations to steer, enqueue, clear queues, and wait for idle state.

DroneHub also owns a durable application prompt queue. In normal mode, a
message waits for the current run. In ASAP mode, it can be claimed and
injected as steering after the current assistant/tool turn.

### Thoughts

DroneHub offers more flexible live interaction, while StorySpark's production
path gives simpler run isolation. Both correctly retain a durable host-level
queue because the core agent queues are in-memory and cannot provide restart
recovery by themselves.

---

## 13. Session Persistence and Replay

**Simple summary:** StorySpark stores normalized relational workflow state and
an explicit context snapshot, while Blip stores an append-only transcript and
rebuilds model context from it.

### What this is

Persistence determines which information survives restarts, how a run can be
audited, and how the next model-visible transcript is reconstructed.

### StorySpark

StorySpark stores separate PostgreSQL records for:

- Sessions
- Runs
- Messages
- Queued messages
- Run-step events
- Proposals
- Proposal checkpoints

User, assistant, and tool-result messages are ordered rows. The session also
stores `context_messages`, which is the exact compacted context for future
inference.

Run completion transactionally inserts messages, updates proposal state,
finalizes the run, updates the session, and replaces the context snapshot.
Original message rows remain even after compaction removes them from the
model-visible context.

### DroneHub and Blip

Blip defines an append-only transcript with:

- Message entries
- Runtime-event entries
- Compaction entries

Its CLI can store JSONL and session metadata. DroneHub implements the same
repository contract in SQLite using session metadata, ordered entry JSON, and
thread-to-session bindings.

The latest valid compaction entry determines how model context is rebuilt.
Earlier raw entries remain available for audit and recovery.

### Thoughts

StorySpark's relational model is stronger for transactional product workflows,
querying, and proposal administration. Blip's append-only repository contract
is simpler and much more portable. Blip should preserve that abstraction even
when an individual host chooses a richer database layout.

---

## 14. Automatic Compaction Trigger

**Simple summary:** StorySpark checks context before every model call and
compacts early, while Blip checks around top-level prompts and waits until
closer to the model limit.

### What this is

The compaction trigger decides when old history must be summarized so the next
request remains inside the model's context window.

### StorySpark

StorySpark invokes compaction inside the agent loop before every model request,
including tool-driven model calls later in the same run.

Its configured budgets generally use:

- A 1,000,000-token application context ceiling
- A 500,000-token proactive compaction threshold
- A 64,000-to-128,000-token reserve
- About 20,000 recent tokens kept verbatim

The loop also recognizes common context-overflow errors and performs one
immediate compact-and-retry attempt.

### DroneHub and Blip

Blip checks automatic compaction when a session handle is created and before a
top-level prompt.

Its default trigger is:

```text
model context window - 16,384 reserved tokens
```

It keeps approximately 20,000 recent tokens and at least two recent user
turns.

Blip does not currently run another compaction check between model calls
inside one prompt-driven tool loop.

### Thoughts

StorySpark is stronger here. A DroneHub run can begin below the threshold,
collect large tool results, and overflow during a later model turn. Blip
should make context preflight available to the inner loop and add a single
compact-and-retry path for recognized provider overflow.

---

## 15. Compaction Boundary and Summary Construction

**Simple summary:** StorySpark uses tightly bounded serialization and protects
the latest user request, while Blip summarizes whole older turns and adds
deterministic file metadata.

### What this is

After triggering compaction, the runtime must choose what to summarize, what
to keep verbatim, and how the summary will appear in later model requests.

### StorySpark

StorySpark selects a recent token tail and aligns the cut to a replayable
boundary so a tool result is not separated from its tool call. It also
protects the latest real user message from being lost inside the summary.

Its summary input is bounded, including limits of:

- 480,000 total serialized characters
- 12,000 characters per user message
- 12,000 characters per assistant text block
- 4,000 characters per tool input
- 2,000 characters per tool result

Image data and unnecessary media URLs are omitted. The compacted context
contains a synthetic user marker, an assistant summary marked as compacted,
and recent verbatim messages.

### DroneHub and Blip

Blip selects a boundary at the start of a user turn. It keeps at least two
recent user turns, then expands backward by whole turns while the retained tail
fits its recent-token budget.

The model receives older transcript data inside `<conversation>` tags and an
existing summary inside `<previous-summary>` tags. Tool-result text is capped
when preparing that input.

After model summarization, Blip independently appends structured file metadata
derived from paths read or modified during the session. Reconstructed model
context contains a synthetic user summary followed by retained verbatim
messages.

### Thoughts

StorySpark has safer input bounds and better protection for an unusually large
latest prompt. Blip has a clean whole-turn boundary and a valuable independent
file-state channel. A combined design would use StorySpark's bounded
serializer with Blip's structured metadata.

---

## 16. Compaction Failure Behavior

**Simple summary:** StorySpark may stop when required summarization fails,
while Blip can fall back to a deterministic local summary and continue.

### What this is

Compaction normally requires another model call, which can itself fail. A
fallback policy must balance continued operation against loss of important
conversation detail.

### StorySpark

StorySpark uses the selected assistant model to create or update the summary.
It has no deterministic summary fallback.

- A failed proactive compaction is logged and the original context is used.
- A failed hard-limit or overflow-recovery compaction ends with a
  context-too-large error.
- The result is checked to ensure compaction actually reduced context enough.

The compaction request uses the same model choice, but does not preserve all
of the session's selected reasoning behavior.

### DroneHub and Blip

Blip asks the active model to summarize using the active reasoning selection
and caps summary output according to the available reserve.

If that request fails or returns no usable text, Blip constructs a local
fallback from recent user goals, tool results, previous summary state, and
file metadata.

### Thoughts

Blip is more resilient because it can continue, but a heuristic fallback may
silently omit nuance. StorySpark avoids silently degraded summaries but can
strand the conversation. A stronger combined policy would mark fallback use
in persisted state, tell the next model that the summary is degraded, and
retry model summarization later.

---

## 17. Token Estimation and Context Accounting

**Simple summary:** Both combine provider usage with heuristics, but
StorySpark gives images a fixed estimate while Blip effectively counts their
serialized base64 size.

### What this is

Exact tokenization is not always available before a provider request. The
runtime therefore estimates transcript size to decide whether messages,
images, tools, and reserved output will fit.

### StorySpark

StorySpark starts from the latest successful assistant usage record and adds
estimates for messages written afterward. Without usage data, it estimates
roughly one token for every four text characters.

Its estimates include:

- A fixed cost per image
- Tool name, ID, and serialized arguments
- Text content length

Context ceilings, reserves, and proactive thresholds are separately
configured by model.

### DroneHub and Blip

Blip also uses the latest successful assistant usage where possible, then adds
an estimate based on the serialized message length.

After compaction, it estimates the summary and retained messages directly
instead of reusing old usage that described the larger pre-compaction
transcript. Model context windows come from the `pi-ai` registry.

Because images are stored as base64 within the canonical message, serialized
length can greatly overestimate their provider token cost.

### Thoughts

DroneHub has the better source of truth for model limits. StorySpark's fixed
image estimate is more practical than treating base64 bytes as text. Neither
compaction calculation appears to account fully for the schema size of a
large dynamic tool catalog, which can consume substantial input context.

---

## 18. User Image Inputs

**Simple summary:** StorySpark persists compact image references and resolves
them for providers, while DroneHub persists complete validated base64 image
payloads.

### What this is

User images must be authorized, validated, persisted, converted into provider
formats, and replayed in later turns.

### StorySpark

Users attach up to eight asset IDs. The server checks ownership and
project/session scope, converts them to canonical asset URLs, and puts those
URL image parts into the user message.

An image part can carry:

- URL
- Detail level
- Label

The provider layer resolves relative URLs, creates externally accessible URLs,
or embeds private/local images where necessary. OpenAI Responses receives
data URLs. Persisted history keeps stable URL references and excludes
non-persistable data URLs.

### DroneHub and Blip

DroneHub accepts up to eight base64 images and validates:

- Image MIME type
- Base64 syntax
- Decoded byte size
- Maximum size per image
- Maximum total attachment size

The base64 data and MIME type become part of the canonical user message and
the persisted Blip transcript.

Provider adapters convert them into Anthropic base64 blocks, Gemini inline
data, or OpenAI data URLs.

### Thoughts

StorySpark's references make durable transcripts much smaller and fit its
asset-backed product model. DroneHub's representation is self-contained and
portable but creates large SQLite records and expensive transcript cloning.
Blip would benefit from a repository-owned image blob/reference abstraction.

---

## 19. Tool-Produced Images and Image Recognition

**Simple summary:** StorySpark gives the agent a dedicated way to inspect
selected project images, while DroneHub relies on direct images or tools that
already return multimodal content.

### What this is

A model cannot see pixels merely because a tool returned an image URL as text.
The runtime needs to turn selected images into real multimodal model input.

### StorySpark

Project-reading tools generally return media URLs as text. When the agent
needs visual inspection, it calls `view_images` with up to six relevant URLs
and an optional purpose and detail level.

The tool returns:

- A textual description of the inspection request
- Labels and canonical URLs
- Actual image content parts

Provider codecs adapt those image-bearing tool results. When a provider cannot
accept images directly in tool output, StorySpark adds a following user-image
message.

### DroneHub and Blip

Blip does not provide a core URL-fetching or `view_images` tool. The model sees
pixels when:

- A user attaches an image
- A native tool returns image content
- An MCP tool returns image content

`pi-ai` supports provider-specific image-bearing tool results. Provider paths
that cannot embed such images can add a separate user image turn. If the
selected model has no image capability, the image is replaced by explanatory
text instead of sending an invalid payload.

### Thoughts

StorySpark has the better workflow for a large media library because it allows
the agent to inspect only the selected images it needs. DroneHub has the more
general provider machinery but lacks a standard Blip tool that resolves a
file, asset, or URL into multimodal content.

---

## 20. System Prompts, Instructions, and Skills

**Simple summary:** StorySpark has a deeply product-specific prompt and a
working skill loader, while Blip provides injection points and lets DroneHub
own the native agent policy.

### What this is

Prompt assembly defines the agent's identity, workflow rules, tool guidance,
repository instructions, and dynamically loadable knowledge.

### StorySpark

StorySpark builds a detailed FilmSpark prompt covering topics such as:

- Reading project state before proposing changes
- Canonical scene and shot targets
- Proposal-only mutation
- Script-change behavior
- Prompt auto-update rules
- Media dependencies
- Image and video generation sequencing

Project access affects both prompt content and available proposal tools.
StorySpark also exposes `load_skill`, allowing the agent to retrieve a selected
assistant skill when needed.

### DroneHub and Blip

Blip core accepts an injected prompt provider and prompt sections contributed
by tool providers. It does not prescribe application identity or workflow.

DroneHub injects:

- Native assistant policy
- Workspace-target guidance
- Approval rules
- Enabled-tool guidance
- MCP instructions
- Global and thread-specific prompt content

Blip session metadata includes loaded-skill state, but Blip does not currently
provide a complete generic skill-loading workflow through that field. The CLI
has separate repository-instruction behavior that DroneHub does not inherit
automatically.

### Thoughts

Blip's host-injection boundary is the right architecture, but its portable
skills story is incomplete. StorySpark's skill system is narrower yet
operational. DroneHub should keep its product policy in the host and add a
portable skill-provider contract alongside prompt and tool providers.

---

## 21. Permissions and Safety

**Simple summary:** StorySpark limits risk through domain-scoped proposal
workflows, while DroneHub combines tool filtering, workspace capabilities,
path checks, and per-call approval.

### What this is

Permissions determine which tools are visible, which resources they may
target, and which individual calls require explicit approval.

### StorySpark

StorySpark's safety model is domain-oriented:

- Read tools are scoped to an authorized project.
- Attachments are checked against user, workspace, project, and session scope.
- Proposal tools are absent when changes are not permitted.
- Proposed operations are resolved and reviewed before execution.
- Generation-model availability is checked during proposal resolution.

The assistant does not receive generic local shell or unrestricted filesystem
access.

### DroneHub and Blip

Blip defines permission modes and tool profiles. Its structured local
filesystem tools reject paths outside the allowed workspace.

DroneHub adds:

- Per-thread readable, writable, and executable workspace scope
- Tool exposure based on target capabilities
- Workspace-reference resolution
- Approval requirements for selected operations
- MCP restrictions for allowed drone references and IDs

The native session uses a restricted local profile, while DroneHub may expose
a separate capability-aware remote shell tool guarded by host policy and
approval.

### Thoughts

The two agents protect different risk surfaces. StorySpark's domain
transaction model is naturally narrow. DroneHub needs a more elaborate system
because it spans files, shells, remote targets, messaging, and MCP. That makes
the correctness of host-side tool composition and preflight policy especially
important.

---

## 22. Runtime Events and Observability

**Simple summary:** StorySpark records product-oriented runs and model traces,
while Blip emits a detailed reusable operational event stream.

### What this is

Runtime observability explains what the agent did, how long operations took,
where failures occurred, and which side effects or files were involved.

### StorySpark

The generic agent emits events for:

- Agent and turn lifecycle
- Message lifecycle
- Tool start, progress, and completion
- Tool suspension
- Context compaction

The application converts these into durable run steps and proposal state.
Provider calls are tracked with model choice, inference mode, reasoning
effort, tool names, retries, cache policy, redacted diagnostics, duration, and
normalized usage.

### DroneHub and Blip

Blip emits versioned events for:

- Session start, finish, and error
- Turn start
- Assistant deltas and completed messages
- Transcript changes
- Tool start, progress, completion, and failure
- Compaction start, completion, and skip
- Process diagnostics

Session completion includes total duration, tool and non-tool time, per-tool
counts, parallel-turn statistics, longest call, context usage, changed files,
and recovered tool failures.

DroneHub stores the useful events in its ordered session transcript while
excluding high-volume token deltas.

### Thoughts

StorySpark is stronger for product workflow analysis because runs, proposals,
steps, and model traces are separate business concepts. Blip has the stronger
generic runtime protocol and timing analysis. Both are TypeScript-first event
contracts rather than generated JSON Schema APIs, although Blip versions its
event envelope.

---

## 23. Portability and Extensibility

**Simple summary:** StorySpark's complete assistant is a FilmSpark subsystem,
while Blip is deliberately built for multiple hosts, repositories, and tool
providers.

### What this is

Portability is the ability to reuse the runtime with different storage,
prompts, tools, platforms, and transports without rewriting the core agent.

### StorySpark

StorySpark's generic loop is reusable, but its complete assistant depends on:

- StorySpark shared types
- API request context
- FilmSpark databases
- Project schemas
- Product model settings
- Product-specific provider tracking
- Proposal execution machinery

Provider codecs, compaction, and persistence integration remain application
components rather than independent runtime packages.

### DroneHub and Blip

Blip defines injected contracts for:

- Session repositories
- Tool providers
- Prompt providers
- Permission preflight
- Context transformation
- Model conversion
- API-key lookup
- Event sinks
- Before- and after-prompt hooks

It already supports different storage and hosting arrangements, including CLI
sessions, DroneHub SQLite sessions, Android-oriented persistence, local tools,
remote workspaces, and MCP.

### Thoughts

Blip is substantially more portable. StorySpark's reusable loop is a useful
foundation, but the finished assistant remains a product subsystem. To reach
Blip's reuse level, StorySpark would need to extract provider codecs,
compaction, and persistence behind stable injected contracts.

---

## 24. Overall Assessment

**Simple summary:** StorySpark is currently the stronger specialized product
agent, while DroneHub and Blip are the stronger basis for a reusable general
agent.

### What this is

This section combines the individual comparisons into an overall view of
correctness, resilience, flexibility, and maintainability.

### StorySpark

StorySpark is strongest in:

- In-loop compaction
- Context-overflow recovery
- Empty-response and output-limit recovery
- Durable proposal suspension and resumption
- Transactional run persistence
- URL-based media handling
- FilmSpark-specific safety and dependency reasoning

Its main limitations are:

- Buffered model handling rather than true streaming
- A large application-owned provider client
- Manually maintained provider and model branching
- Optional rather than universal local schema validation
- Less provider metadata in canonical messages

### DroneHub and Blip

DroneHub and Blip are strongest in:

- True provider streaming
- Structured model metadata and provider dispatch
- Cross-model transcript transformation
- Mandatory local tool validation
- Dynamic native, workspace, and MCP tools
- Portable session repository contracts
- Detailed operational events and timing
- Deterministic compaction fallback

Their main limitations are:

- No compaction between model calls inside a tool loop
- No context-overflow compact-and-retry
- No agent-level empty or output-limit recovery
- Approval waits that depend on a live process
- Base64 images stored directly in transcripts
- No generic durable suspended-tool workflow
- Incomplete portable skill loading

### Thoughts

DroneHub should preserve Blip's current layering and borrow StorySpark's
inner-loop resilience:

1. Run context preflight before every model call.
2. Add a single compact-and-retry path for context overflow.
3. Add bounded recovery for empty and output-limited responses.
4. Define a durable repository-backed suspended-tool contract.
5. Store images as repository-owned blobs or references.
6. Add a portable skill provider.

StorySpark should preserve its product workflow and borrow DroneHub's reusable
foundations:

1. Use genuine provider streaming.
2. Extract provider dispatch and model metadata.
3. Make local compiled schema validation universal.
4. Preserve source provider and model on assistant messages.
5. Centralize cross-model reasoning and tool-call normalization.

Neither implementation should be copied wholesale into the other. StorySpark
solves durable FilmSpark workflows particularly well, while DroneHub and Blip
provide the more reusable runtime. A combined architecture should retain both
of those strengths.

---

## Key Source Locations

### StorySpark

- `~/dev/mojo/StorySpark/packages/agent/src/agent-loop.ts`
- `~/dev/mojo/StorySpark/packages/agent/src/agent.ts`
- `~/dev/mojo/StorySpark/packages/agent/src/types.ts`
- `~/dev/mojo/StorySpark/apps/api/src/assistant/AssistantRuntimeRoutes.ts`
- `~/dev/mojo/StorySpark/apps/api/src/assistant/AssistantSessionRunner.ts`
- `~/dev/mojo/StorySpark/apps/api/src/assistant/ToolCallingModelClient.ts`
- `~/dev/mojo/StorySpark/apps/api/src/assistant/assistantProviderAdapters.ts`
- `~/dev/mojo/StorySpark/apps/api/src/assistant/assistantContextCompaction.ts`
- `~/dev/mojo/StorySpark/apps/api/src/assistant/buildAssistantTools.ts`
- `~/dev/mojo/StorySpark/apps/api/src/assistant/proposeProjectChangesTool.ts`
- `~/dev/mojo/StorySpark/apps/api/src/assistant/viewImagesTool.ts`
- `~/dev/mojo/StorySpark/apps/api/src/db/AssistantSessionsDb.ts`

### DroneHub and Blip

- `apps/drone/src/hub/assistant-runtime.ts`
- `apps/drone/src/hub/assistant/blip-assistant-host.ts`
- `apps/drone/src/hub/assistant/hub-session-repository.ts`
- `apps/drone/src/hub/assistant/assistant-config.ts`
- `blip/packages/core/src/blip-session.ts`
- `blip/packages/core/src/compaction.ts`
- `blip/packages/core/src/model-context.ts`
- `blip/packages/core/src/types.ts`
- `blip/packages/mcp/src/mcp-tool-provider.ts`
- `blip/packages/tools/src/tools.ts`
- `packages/agent/src/agent-loop.ts`
- `packages/agent/src/agent.ts`
- `packages/agent/src/types.ts`
- `packages/ai/src/types.ts`
- `packages/ai/src/models.ts`
- `packages/ai/src/utils/validation.ts`
- `packages/ai/src/providers/transform-messages.ts`
