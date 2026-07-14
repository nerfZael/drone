# Platform Boundaries

`@blip/core` is the portable session entry point. Its runtime module graph must not import Node
built-ins or use `process`/`Buffer`; the package build enforces this with
`scripts/check-portable-entry.mjs`, and the Android production Metro bundle exercises the transitive
graph.

The core owns session orchestration, tool lifecycle events, queueing, cancellation, compaction
policy, prompt-provider and repository interfaces, and permission preflight. Hosts inject model
transports, persistence, tools, prompts, credentials, and event sinks.

`@blip/core/node` is an explicit Node-only entry point for the file-backed session store, local
runtime convenience functions, Git inspection, and process diagnostics. `@blip/tools` contains the
Node filesystem and child-process implementations. `@blip/workspace` contains only the shared target
contracts and selection catalog.

Prompt policy belongs to each host. In particular, the CLI explicitly opts into root `AGENTS.md`
discovery; neither the session core nor a filesystem adapter reads it automatically.

The Android host uses the portable session with a React Native repository and model transports.
Operating-system lifecycle behavior, SecureStore credentials, fetch/SSE handling, and mesh routing
remain platform adapters rather than forks of the agent loop.
