# Parallel conversation

Every message the user sends gets a capable worker immediately. Nothing waits for earlier work to finish, nothing gets interrupted by a steering message, and every answer is a real reply in the chat. Workers know about each other through the shared log, so they don't trip over each other.

This replaces today's manual workaround with single agents: cloning a conversation to give it a side task.

## How a message is handled

The front limb (the voice when `voiceModel` is set, otherwise the head) routes each message in one quick decision:

| The message is... | Action | Tool |
|---|---|---|
| A new, independent task | Start a fresh worker right away. Its context is the message plus a digest of what the other workers are doing. | `dispatch` |
| Building on a worker's context ("do the same for signup") | Fork that worker: clone its conversation at its current point | `fork` |
| A refinement of work in progress ("keep the old API") | Steer that worker only; the others are not touched | `steer` |
| A question about the work ("how's the fix going?") | Answer from state, with no worker disturbed | `say` |
| Something that depends on another task ("then write the docs for it") | Dispatch with a gate: the worker starts when the other one finishes | `dispatch` with `after` |

Three general rules keep routing clean. They came from the first live session.

- **One decision per message.** Whatever the router can fully answer itself (conversation, acknowledgements, questions about the work) it answers, and it never also dispatches for the same message; a worker would only repeat it.
- **New messages can change existing work.** Before starting anything, the router checks what running workers are doing. A message that replaces or cancels a worker's work stops or redirects that worker as part of the same decision, instead of starting a second worker next to it.
- **Let the user finish.** The front limb does not act while the user is still typing: the action waits until the draft has been quiet for 1 s (at most 6 s). It also never acts while a user message it has not read is waiting; a newer run handles both. A burst like "actually", then "let's convert to python", becomes one decision.

When the router is unsure, the cheap mistake is a fresh worker with a note like "may relate to worker 3". The user can always redirect: "fork from #2", "send this to the login worker", "stop #3".

Workers run on the task model (gpt-6-sol by default). The router may choose the head model for small requests to save budget.

## Real replies

Workers speak in the chat themselves. Each reply is tagged with the worker and the message it answers (`reply_to`), so parallel threads stay readable. There are no "steering acknowledged" messages. A worker that finishes also reports its result as a reply.

## Awareness

- **Shared state.** Every worker's projection lists the other workers, their tasks and status, their claims, and shared discoveries.
- **Mid-run updates.** A busy worker gets updates attached to its next tool result: a steer from the user, a discovery from a sibling, a new claim on something it is touching. So it hears about changes within seconds, without being stopped.
- **Claims.** A worker claims the files or areas it is working on (`claim`), and writing a file claims it automatically. Writing to a path claimed by another worker is rejected with who holds it and why, so conflicts surface at the moment of the write.
- **Discoveries.** `share(text)` broadcasts a finding ("the bug is in token refresh, not the form") to every worker.
- **Orchestration.** The head is woken on overlap signals (a rejected write on a claimed path, a gate waiting too long) to reconcile: merge duplicates, put dependent work in order, cancel redundant work.

## Workspace

Workers need a workspace to actually write code. The workspace channel gives them tools confined to one folder:

| Tool | Risk class | Notes |
|---|---|---|
| `list_files`, `read_file`, `search` | read-only | Never blocked |
| `write_file`, `edit_file` | `limb` | Claims the file for the writer; rejected if another worker holds it |
| `run` | `limb`, **off unless enabled** | Shell command in the workspace with a timeout. Disabled by default because it runs LLM-written commands on the host |

Paths are resolved inside the workspace root, and `.git` is never written. In this first slice, all workers share one workspace, and claims keep them apart. Per-worker worktrees and an integration branch come with [coding.md](coding.md).

## Budget

Parallel strong workers cost more. The per-session caps apply, the inspector shows each worker's runs, and the router picks the model per message. Worker conversations are kept after they finish (so they can be forked or asked follow-ups) and dropped on reset, or when too many are kept.

## First demo

1. Send "fix the flaky test in X", then 10 s later "also add a changelog entry", then "how's the test fix going?".
2. Two workers start. The third message is answered by the router from state.
3. Each worker replies in its own thread.
4. Send "do the changelog like the last release did". This forks the changelog worker.
