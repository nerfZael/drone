# Voice Stream Next Assistant Parity TODO

## Completed

- [x] Rich assistant threads
- [x] Model/provider/thinking controls
- [x] Thread system prompts
- [x] Global normal/voice prompts
- [x] Tool registry and per-thread tool toggles
- [x] Run lifecycle state: `idle`, `running`, `waiting_for_approval`, `cancelled`, `error`
- [x] Approval-gated tool calls
- [x] Approval cards with non-drone previews
- [x] Approve/Deny actions
- [x] Stop run cancels pending approvals
- [x] Live assistant change SSE
- [x] Streaming prompt endpoint
- [x] Streaming UI deltas
- [x] Model-requested tool calls
- [x] Slash-command fallback tools
- [x] Assistant artifacts storage
- [x] Artifact list/read preview
- [x] Artifact create/edit/delete UI
- [x] Artifact copy/download UI
- [x] Spoken reply flagging/storage
- [x] Continue original model run after approval
- [x] Tool activity rows in the message stream
- [x] Thread delete, inline rename, and active-thread controls
- [x] Queued prompt visibility and cancel controls
- [x] Voice/normal thread filtering and voice thread creation
- [x] Spoken reply delivery over assistant events with browser speech playback
- [x] Broader assistant API tests
- [x] Assistant artifact list/patch parity
- [x] System prompt patch parity
- [x] Focused tests for parity runtime/artifacts/approvals

## Remaining

No must-have Drone Hub assistant parity items remain for Voice Stream Next after excluding drone/container-specific tools and Docker workflows.

## Explicitly Out Of Scope

These are not planned for Drone Hub parity because Drone Hub does not really have them for assistant tool approvals.

- [ ] Durable approval history/audit log
- [ ] Approval expiry lifecycle
- [ ] Spoken approval-code resolution for assistant tool approvals
