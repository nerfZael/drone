# Mobile Companion delegation investigation — 14 September 2026

The missing answer and missed idle notification share a confirmed native-chat integration gap. Creation also omitted the requested repository and used the native agent despite the saved Codex instruction. The later proposal was an actual backend tool invocation; its precise operation and motivation are not recoverable from the retained diagnostics.

Evidence: connected Samsung SM-F966B logcat, read-only SQLite queries, live local Hub reads, and source tracing. Times below are Europe/Zagreb (CEST).

## Incident identity and timeline

- Companion run: `mesh:423a3f62-280c-4289-9189-73a373a40123`.
- Backend session: `hub_6d1f3f25-1b15-4610-bb14-643badd20574`, GLM 5.3 Flash/high.
- Drone: `28a739e5-35c3-43b6-9cdf-a4656399a3b9`, **Companion Proposals Explainer**.
- Chat: `default`, stable ID `2a1b459c-d6e6-419b-817c-73989d98ee97`.
- Native session: `hub_0cf5589e-688f-4e0f-bcd6-ecaaddd4ac1f`.

| Time | Evidence |
| --- | --- |
| 09:24:11 | Phone attaches Live to desktop, with no selected drone/chat and pane `new-drone`. |
| 09:24:41–59 | Backend reads proposal/model catalog and patches proposal. No `get_app_context`, `list_repos`, or `list_groups` calls in this turn. |
| 09:24:59 | Container drone created without repository or group; native agent, OpenRouter `openai/gpt-6-astra`, low reasoning. |
| 09:25:19.078 | Native session finishes successfully and saves its final answer. |
| 09:25:19.106 | Native thread becomes `idle`; shared prompt record becomes `sent`. |
| 09:25:29.727 | Companion registers `chat.idle` subscription, about 10.65 seconds after completion. Its baseline incorrectly says busy. |
| 09:26:06–44 | Backend calls `read_chat`, six message searches, and five tool-output reads. |
| 09:28:49–54 | Another successful `read_chat` call, while phone is backgrounded. |
| 09:30:24–09:31:01 | Backend checks subscription/chat, reads chat three times, searches once, reads proposal three times, and patches twice. |
| 09:30:48 | First later proposal patch completes at browser-tool level. This does not establish successful execution of its operations. |
| 09:30:53 | Second patch fails with `PROPOSAL_ALREADY_EXECUTED`. |

## Creation: missing repository and wrong agent

The canonical drone record has `repoPath: ""` and no group. This is more than sidebar placement: the drone has no DroneHub source checkout. Its initial `list_files` returned an empty `/dvm-data/home`.

The persisted Companion instructions already mapped **DroneHub** to `/home/zael/dev/me/drone`, and its system prompt said to use Codex for new drones/chats unless otherwise instructed. Those settings predate this incident. The created chat instead uses the native agent through OpenRouter. The model family and reasoning are Astra/low, but the agent is different.

Mobile's `getAppContext` derives `activeRepoPath` exclusively from `selectedDrone` (`apps/drone-hub-mobile/src/local-assistant/use-mobile-companion-workspace-target.ts:96`). There was no selected drone at creation. `MobileCompanionContext.tsx:267` captures a blank default repository in that case. Creation resolves `operation.repoPath ?? activeRepoPath`, and sends a group only when `operation.group` is supplied (`use-mobile-companion-workspace-target.ts:174`, `:298`). It does not infer the named DroneHub repository or inherit a group independently.

Thus the execution path received no effective repository/group and accepted it. Exact original proposal arguments are not retained, so omitted fields versus explicit empty values cannot be distinguished. The blank UI default explains why omission silently creates a repository-less drone; it does not excuse losing the explicit DroneHub request. Native is also Mobile's fallback agent when no saved preference/override exists (`:276`). The retained catalog-call telemetry does not reveal whether the model explicitly chose native or relied on preferences/defaults.

Companion's instruction skill is supplied automatically (`apps/drone/src/hub/companion/companion-skills.ts:124`); absence of a model-issued `read_skill` in telemetry is not evidence that the alias was unavailable.

## Reply visibility: two different history paths

The answer exists in `assistant-blip.sqlite`, `assistant_blip_entries`. `assistant_threads` reports the native chat as `idle`, without error. There are **zero** `canonical_chat_turns` and **zero** `active_chat_message_search` rows for this drone.

Mobile supports native history explicitly, rendering message history supplied through `device-mesh/native-chat-response.ts:268` and `DronesScreen.tsx:1217`. Companion's `read_chat` instead calls the generic `/api/drones/:id/chats/default/state` route (`apps/drone/src/hub/mcp-server.ts:3612`). That route reads canonical transcript rows (`chat-session-runtime.ts:1350`) without loading native history. It returns HTTP 200 and an empty transcript, so the tool regards the call as successful. Its output fallback runs only for HTTP 410, not this case.

A live request during this investigation reproduced `agent.kind: native`, `transcripts: []`, and the original prompt still present as `sent`. Message search is also blind: its index is populated from canonical turns (`transcript-store.ts:659`). Repeating reads/searches cannot find a reply stored exclusively in native history.

The saved answer says it cannot verify Companion's exact tools because the tools/source are not exposed, and gives a generic proposal-workflow explanation. That follows from the empty workspace. Its attempted web search failed because no Exa API key was configured. The session itself completed normally.

## Idle notification: no event was generated

Subscription `7bb9df83-54d4-4862-9325-0338ebb3238e` is active, targets the correct stable chat ID, and explicitly requests reading and relaying the reply. It has no corresponding event, delivery, or delivery batch, and no recorded subscription error. This failure happened before notification delivery or voice playback.

Subscription polling calls `readCanonicalChatActivityModel` and `summarizeAssistantChatIdle` (`apps/drone/src/hub/server.ts:5559`). The summarizer treats unmatched `queued`, `sending`, or `sent` user prompts as active (`assistant.ts:847`). Native completion marks the shared prompt `sent` (`assistant.ts:2977`) but supplies no canonical final turn to reconcile it. Consequently the poller remains at `lastIdle: false`, `idleArmed: true`, and the original user prompt as its latest message.

The live `/api/chats/idle/status` check returned `idle: false`, `reason: active_user_messages`, and `activeUserMessages: 1`, despite the persisted native session being idle with an answer.

There is a second, independent timing concern. Chat subscriptions establish a baseline and watch subsequent transitions (`resource-subscription-service.ts:1275`, `:1320`). They do not replay a completed idle state. Here registration happened after completion. Once native status is fixed, this exact ordering would require reading the already-completed result immediately, or subscribing before work begins with appropriate race handling.

## Extra proposal: confirmed mutation attempt, incomplete intent evidence

Run telemetry and phone logs both show backend-issued proposal patches during the later read/check turn. This was not merely a duplicate visual card. Auto-approval was enabled before the incident, and Mobile's patch handler immediately executes nonempty proposals when enabled (`MobileCompanionContext.tsx:395`). A browser-tool completion can contain an unsuccessful operation result, so it must not be equated with successful action execution.

The subsequent patch hit `PROPOSAL_ALREADY_EXECUTED` (`MobileCompanionContext.tsx:260`). In current source, successful execution clears the proposal, while a failed execution retains its result and blocks further patches (`:377`). The observed sequence is consistent with an unsuccessful auto-approved proposal followed by an attempted edit/retry. The exact first operation result is not logged, so this remains an inference. Only one new drone survives in the canonical records for the incident window; there is no evidence of a second successful drone creation.

Companion's backend transcript is held in memory (`companion-runtime.ts:131`), and phone diagnostics omit prompt/tool-argument/result bodies. The installed Android app is not debuggable, so `run-as` cannot retrieve its private data. The original spoken request and later proposal payload are therefore unavailable in the collected evidence. Whether the model misunderstood a delegation, tried to repair the missing answer, or confused discussion of proposals with a requested action cannot be stated as fact.

## Repair points and validation

1. Make Companion reads, message search, and subscription status include authoritative native history/completion, rather than treating native replies as absent canonical turns.
2. Handle work that completes before idle registration: check completed results and close the subscribe/check race, or register before dispatch.
3. Resolve explicit repository aliases and preserve the intended agent independently of model selection. Carry repository/group context from the new-drone surface when that is the user's selected creation context.
4. Allow revision/recovery of failed proposals while preserving safeguards for already-applied operations. Add bounded diagnostics for proposal operation types, execution status, and failure codes so retries can be attributed.

Validation used existing phone logs, persisted native final-message/session-finished events, canonical records, subscription tables, and live HTTP reads. No new model calls or test drones were created. No application code, settings, or existing conversations were changed. This note is the only repository addition from the investigation.

Collected local evidence: `/tmp/companion-20260914/phone.log`, `/tmp/companion-20260914/phone-app.log`, and the read-only reproducer `/tmp/companion-20260914/read-live.py`. Hub records reside in `data/profiles/default/drone/hub.log`, `hub.sqlite`, and `assistant-blip.sqlite`.

## Reply visibility fix

The subsequent code change adds a read-only native message endpoint and makes
Companion's `read_chat` use it for native chats. Reads project bounded visible
user/assistant/error text from saved history, including history predating this
fix and compaction. Normal reads do not include tool results, reasoning, images,
or compaction summaries. Completed native delivery records no longer appear as
pending work in the tool response; queued/sending prompts remain visible.

Message search now includes native history within the authorized active-chat
scope. Native and canonical results are merged before pagination, and archived
chats are excluded. The new reader recovered the incident's actual saved reply
in a separate read-only process. Regression coverage exercises the MCP tool and
native route, bounded history reads, mixed search pagination, access filtering,
and archive filtering; the SQLite search regression runs under Node.

That change addresses reply visibility. The running Hub
must be rebuilt/restarted to load the new endpoint and tool behavior; no phone
reinstallation is needed.

## Subscription status response

Following the user's chosen simpler design, chat subscription creation now
returns an `idle` boolean alongside the active subscription. It exposes the same
status observation used to establish a new watcher's baseline. Existing active
watchers return a fresh status while preserving their cursors. This does not
generate an extra immediate notification or add completed-reply fields.

The subscription status reader now uses native runtime activity and saved native
history for native chats, rather than treating completed `sent` prompts as busy.
Queued/sending prompts still count as busy, including before native session
initialization. This corrects both registration status and subsequent polling
within the subscription service. The generic `/api/chats/idle/status` endpoint
now shares that same reader, so it also recognizes native completion. Its
activity counts exclude completed native delivery records and include queued,
sending, and runtime work. CLI status behavior is preserved.

Regression checks cover idle and busy registration, fresh status on repeated
subscription calls without losing the cursor, future idle detection, boolean
forwarding through MCP, and native completed/busy status. Changes require the
Hub to load the updated backend.
