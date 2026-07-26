# StorySpark vs. DroneHub/Blip: Condensed Agent Implementation Comparison

## Scope

This compares StorySpark's agent assistant with DroneHub's native built-in agent, Blip, and the underlying `pi-agent-core`/`pi-ai` packages. It covers internal runtime behavior only—not UI or presentation.

## 1. Architecture

**Simple summary:** StorySpark is a vertically integrated product agent; DroneHub composes a reusable agent stack.

**What this is:** Architecture decides which layer owns sessions, model calls, tools, persistence, and application policy.

**StorySpark:** A small generic agent loop is wrapped by StorySpark-owned session runners, provider adapters, compaction, database logic, prompts, FilmSpark tools, and proposal workflows.

**DroneHub/Blip:** DroneHub hosts `BlipSession`; Blip owns sessions and compaction; `pi-agent-core` owns the agent loop; `pi-ai` owns models, providers, conversion, and streaming. DroneHub injects tools, prompts, permissions, workspaces, MCP, and storage.

**Thoughts:** DroneHub has cleaner reusable boundaries. StorySpark is more tightly coupled but easier to tune for one specialized product.

## 2. Canonical Message Schema

**Simple summary:** StorySpark stores simpler normalized messages; DroneHub preserves more provider and reasoning metadata.

**What this is:** The canonical schema is the transcript format shared by model calls, tools, persistence, and replay.

**StorySpark:** Uses `user`, `assistant`, and `toolResult` roles. Messages can contain text, URL images, tool calls, normalized reasoning, usage, stop reason, timing, and selective provider round-trip fields.

**DroneHub/Blip:** Uses the same basic roles but adds first-class thinking blocks, provider signatures, API/provider/model identity, response IDs, cache usage, cost, diagnostics, and base64 images.

**Thoughts:** StorySpark is smaller and easier to inspect. DroneHub's richer schema is better for multi-provider replay, diagnostics, reasoning continuity, and cost accounting.

## 3. Agent Loop

**Simple summary:** Both repeat model calls and tool execution, but StorySpark embeds context recovery and suspension while DroneHub emphasizes streaming and termination.

**What this is:** The loop decides when to call the model, execute tools, inject queued messages, compact context, and stop.

**StorySpark:** Adds a prompt, checks steering, compacts if necessary, calls the model, runs tools, appends results, and repeats. It can return a suspended call and later resume from its tool result.

**DroneHub/Blip:** `pi-agent-core` follows a similar loop but streams each model response and supports stop hooks and tool termination hints. Blip wraps the loop with sessions, persistence, and compaction.

**Thoughts:** StorySpark is stronger at durable recovery; DroneHub is stronger at incremental execution. Neither core loop imposes a hard model-turn limit.

## 4. Model Streaming

**Simple summary:** DroneHub has genuine incremental streaming; StorySpark's streaming interface is currently backed by mostly buffered provider calls.

**What this is:** Streaming exposes text, thinking, and tool arguments while the provider generates them.

**StorySpark:** OpenAI paths wait for completed responses, and the Anthropic path waits for the stream's final message. The full decoded response is then emitted through stream-shaped events.

**DroneHub/Blip:** `pi-ai` emits start, text, thinking, tool-call, completion, and error events. The loop updates a partial assistant message, and Blip converts relevant events into its runtime protocol.

**Thoughts:** DroneHub provides better latency, cancellation, and diagnostics. StorySpark has a suitable abstraction but does not receive most streaming benefits yet.

## 5. Models, Providers, and Reasoning Continuity

**Simple summary:** StorySpark offers more product-level model families; DroneHub has the stronger reusable model and cross-provider abstraction.

**What this is:** This covers model catalogs, capability metadata, provider conversion, and safe replay of signed reasoning.

**StorySpark:** Defines a fixed GPT, Claude, and Gemini catalog with manual provider mappings. Reasoning becomes a normalized trace, while selected provider continuation data is retained on tool calls.

**DroneHub/Blip:** DroneHub exposes a narrower native catalog, but `pi-ai` records provider, protocol, context, output limits, costs, reasoning levels, and image support. It preserves same-model signatures and removes or converts incompatible reasoning when models change.

**Thoughts:** StorySpark currently offers more choices. DroneHub is easier to extend and safer when replaying a transcript across different providers or models.

## 6. Model Failures and Retries

**Simple summary:** StorySpark recovers from more conversation-level failures; DroneHub mainly normalizes provider errors and stops.

**What this is:** Retry policy handles empty output, truncation, transport errors, and context overflow.

**StorySpark:** Retries empty responses, regenerates once after an output limit, and compacts then retries once after recognized context overflow.

**DroneHub/Blip:** Provider SDKs handle transport retries. Errors become `error` or `aborted` assistant messages; output-length and context-overflow outcomes do not trigger agent-level regeneration or compaction.

**Thoughts:** StorySpark is more resilient. Blip needs bounded recovery above the provider layer because these failures affect transcript and compaction state.

## 7. Tool Catalog

**Simple summary:** StorySpark exposes a narrow FilmSpark tool set; DroneHub dynamically composes native, workspace, and MCP tools.

**What this is:** Tool composition determines which actions the model can see during a turn.

**StorySpark:** Provides project context, summary, script, scene, shot, asset, image-inspection, skill, and conditional proposal tools.

**DroneHub/Blip:** Builds tools from thread settings, target capabilities, filesystem and shell access, web tools, transfer tools, prompt controls, and MCP providers.

**Thoughts:** StorySpark is easier for the model to understand and safer by default. DroneHub is much more extensible but must control catalog size, naming, and permissions carefully.

## 8. Tool Schemas and Validation

**Simple summary:** StorySpark relies on tools to opt into parsing; DroneHub validates every call locally.

**What this is:** Schemas guide model arguments, while runtime validation protects the application from malformed calls.

**StorySpark:** Most tools pair handwritten JSON Schema with Zod in `prepareInput`, but the generic loop does not automatically compile every schema. Provider strictness is configurable per tool.

**DroneHub/Blip:** TypeBox or JSON Schema arguments are cloned, coerced, compiled, cached, and validated before execution. Detailed path-based failures are returned to the model, including for MCP tools.

**Thoughts:** DroneHub has the safer default. The ideal combines its mandatory validation with StorySpark-style domain normalization after validation.

## 9. Tool Execution, Parallelism, and Termination

**Simple summary:** Both preserve tool-call order while running safe calls concurrently, but they support different special outcomes.

**What this is:** Batch execution controls concurrency, progress, ordering, errors, and early termination.

**StorySpark:** Runs tools concurrently unless sequential execution is required. It supports hooks, progress, error conversion, and suspension; results are appended in the model's original call order.

**DroneHub/Blip:** Validates and preflights calls before concurrent execution, preserves result order, isolates progress-listener failures, and supports tool-result termination hints.

**Thoughts:** DroneHub's batch semantics are more explicit. StorySpark's suspension is the more powerful durable workflow primitive.

## 10. Approvals, Steering, and Queues

**Simple summary:** StorySpark durably suspends approval work; DroneHub waits inside the live call and offers more flexible live steering.

**What this is:** These mechanisms control sensitive actions and messages arriving while the agent is busy.

**StorySpark:** Project proposals end the run, persist a checkpoint, execute after approval, and resume with the missing tool result. Additional prompts normally enter a durable queue and start later runs.

**DroneHub/Blip:** Permission preflight waits in memory for approval, then continues the same tool invocation. DroneHub combines a durable prompt queue with normal delayed delivery or ASAP steering into a live run.

**Thoughts:** DroneHub is smoother for short approvals and urgent steering. StorySpark is safer across restarts and better for expensive or business-critical mutations.

## 11. Persistence and Replay

**Simple summary:** StorySpark stores relational workflow state and a context snapshot; Blip stores an append-only transcript and reconstructs context.

**What this is:** Persistence decides what survives restarts and how later model context is rebuilt.

**StorySpark:** PostgreSQL stores sessions, runs, messages, queues, steps, proposals, and checkpoints. Run completion transactionally updates workflow state and the exact `context_messages` snapshot.

**DroneHub/Blip:** Blip defines append-only message, event, and compaction entries. DroneHub implements that repository contract in SQLite; the latest valid compaction entry controls reconstruction.

**Thoughts:** StorySpark is better for transactional product administration. Blip's storage contract is simpler, auditable, and portable across hosts.

## 12. Compaction Trigger

**Simple summary:** StorySpark checks before every model call; Blip checks mainly before top-level prompts.

**What this is:** The trigger determines when old history must be summarized to fit the next request.

**StorySpark:** Compacts inside the loop, including later tool turns, uses an early proactive threshold, and retries once after recognized context overflow.

**DroneHub/Blip:** Checks when opening a session and before a top-level prompt, usually near `contextWindow - 16,384`. A long tool loop can grow past the limit without another preflight.

**Thoughts:** StorySpark is clearly stronger. Blip should expose repository-backed compaction as an inner-loop context preflight.

## 13. Compaction Construction and Failure

**Simple summary:** StorySpark uses tighter bounds; Blip preserves whole recent turns, adds file metadata, and has a deterministic fallback.

**What this is:** Compaction chooses a safe boundary, summarizes old content, retains recent content, and handles summarization failure.

**StorySpark:** Protects the latest user message, aligns tool calls with results, and caps total and per-message serialization. Failed required compaction can stop the run.

**DroneHub/Blip:** Keeps at least two recent user turns, summarizes complete older turns, and appends independently tracked file metadata. If model summarization fails, it creates a local fallback summary.

**Thoughts:** Combine StorySpark's strict bounds with Blip's whole-turn boundary, structured file metadata, and persisted indication that fallback was used.

## 14. Token Accounting

**Simple summary:** Both mix provider usage with heuristics, but DroneHub can overcount base64 images.

**What this is:** Estimation predicts whether transcript, tools, images, and reserved output fit the model context.

**StorySpark:** Starts from recent provider usage and estimates later text, tool arguments, and images; images receive a practical fixed cost.

**DroneHub/Blip:** Uses recent successful usage plus serialized message length. Context limits come from model metadata, but inline base64 can look much larger than its provider token cost.

**Thoughts:** DroneHub has the better source for model limits; StorySpark has the better image heuristic. Both should account explicitly for dynamic tool-schema size.

## 15. Images and Visual Inspection

**Simple summary:** StorySpark stores asset references and offers selective image inspection; DroneHub stores base64 and relies on multimodal inputs returned by users or tools.

**What this is:** Image handling covers validation, persistence, provider conversion, and turning URLs into actual pixels visible to the model.

**StorySpark:** Validates asset ownership, stores compact canonical URLs, and resolves or embeds them per provider. `view_images` lets the agent load up to six selected project images as real multimodal content.

**DroneHub/Blip:** Validates image MIME type, base64, individual size, total size, and count, then persists the full payload. Native or MCP tools can return images, but Blip has no standard URL/file inspection tool.

**Thoughts:** StorySpark is better for large asset libraries. DroneHub is self-contained but needs blob/reference storage and a standard tool that resolves a file or URL into image content.

## 16. Prompts and Skills

**Simple summary:** StorySpark has specialized FilmSpark policy and working skill loading; Blip provides host injection but lacks a complete portable skill system.

**What this is:** Prompt assembly supplies identity, workflow rules, tool guidance, repository instructions, and optional knowledge.

**StorySpark:** Builds detailed project and proposal instructions and exposes `load_skill` for retrieving assistant skills on demand.

**DroneHub/Blip:** Blip accepts prompt providers and tool-contributed sections. DroneHub injects native identity, workspace, approval, MCP, tool, global, and thread-specific rules; skill metadata exists but is not a complete loading workflow.

**Thoughts:** Blip's separation is correct. It should add a portable skill provider while leaving product policy in the host.

## 17. Permissions and Safety

**Simple summary:** StorySpark minimizes risk through domain-scoped proposals; DroneHub layers capabilities, path restrictions, tool filtering, and approval.

**What this is:** Safety controls which tools exist, which resources they can access, and which calls require consent.

**StorySpark:** Scopes reads and attachments to authorized projects, conditionally exposes proposal tools, resolves changes before execution, and offers no generic shell or unrestricted filesystem.

**DroneHub/Blip:** Restricts filesystem paths, applies thread and target capabilities, resolves workspace references, gates selected calls, limits MCP references, and separately controls remote shell access.

**Thoughts:** StorySpark's narrower risk surface is naturally easier to secure. DroneHub needs its more complex policy stack, making correct host composition critical.

## 18. Events and Observability

**Simple summary:** StorySpark records product workflow state; Blip provides a richer reusable runtime event stream.

**What this is:** Observability explains model turns, tool activity, failures, timing, context use, and side effects.

**StorySpark:** Emits agent, message, tool, suspension, and compaction events, then translates them into runs, steps, proposals, and detailed provider traces.

**DroneHub/Blip:** Emits versioned session, turn, assistant, transcript, tool, compaction, and diagnostic events. Completion includes timing, per-tool statistics, context usage, changed files, and recovered failures.

**Thoughts:** StorySpark is better for business workflow analysis. Blip is better as a portable operational protocol.

## 19. Portability and Overall Direction

**Simple summary:** StorySpark is the stronger specialized agent today; DroneHub and Blip are the stronger reusable foundation.

**What this is:** Portability measures whether the runtime can change storage, tools, prompts, providers, platforms, or hosts without rewriting its core.

**StorySpark:** Its generic loop is reusable, but the finished assistant depends heavily on FilmSpark types, databases, project schemas, provider tracking, and proposal machinery.

**DroneHub/Blip:** Injects repositories, tools, prompts, permission preflight, model conversion, API keys, context transforms, events, and lifecycle hooks. It already supports multiple hosts and storage implementations.

**Thoughts:** DroneHub should add StorySpark's inner-loop compaction, overflow recovery, bounded model retries, durable suspension, image references, and skill loading. StorySpark should adopt true streaming, mandatory validation, richer source-model metadata, and a reusable provider registry. Neither should be copied wholesale into the other.

## Key Source Areas

### StorySpark

- `packages/agent/src/{agent-loop,agent,types}.ts`
- `apps/api/src/assistant/AssistantSessionRunner.ts`
- `apps/api/src/assistant/ToolCallingModelClient.ts`
- `apps/api/src/assistant/assistantProviderAdapters.ts`
- `apps/api/src/assistant/assistantContextCompaction.ts`
- `apps/api/src/assistant/buildAssistantTools.ts`
- `apps/api/src/assistant/proposeProjectChangesTool.ts`
- `apps/api/src/assistant/viewImagesTool.ts`
- `apps/api/src/db/AssistantSessionsDb.ts`

### DroneHub, Blip, and Pi

- `apps/drone/src/hub/assistant-runtime.ts`
- `apps/drone/src/hub/assistant/{blip-assistant-host,hub-session-repository,assistant-config}.ts`
- `blip/packages/core/src/{blip-session,compaction,model-context,types}.ts`
- `blip/packages/mcp/src/mcp-tool-provider.ts`
- `blip/packages/tools/src/tools.ts`
- `packages/agent/src/{agent-loop,agent,types}.ts`
- `packages/ai/src/{types,models}.ts`
- `packages/ai/src/utils/validation.ts`
- `packages/ai/src/providers/transform-messages.ts`
