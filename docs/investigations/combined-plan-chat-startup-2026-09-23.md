# Combined Plan chat startup timeout

The `6 and 7` chat in `Combined Plan to Assets Spec Analysis` (drone
`0cdc0a56-dd4a-49b0-a348-f0138f82fe9e`) failed before starting agent work.
Both prompts, submitted at 14:03:03 and 14:40:49 UTC on 23 September 2026,
recorded the same error:

> Drone Hub tools are unavailable: Codex App Server request timed out: mcpServerStatus/list.

The canonical Hub `prompts` records and the container's corresponding job
records establish the failure. Neither attempt started a model turn; both
recorded zero changed files. The displayed “Connection timed out” and “The run
stopped after the connection was lost” incorrectly implied interrupted work.

## Diagnosis

- The container was running, with no OOM failure.
- An authenticated MCP initialization from the container to its configured Hub
  endpoint succeeded in 2.14 seconds.
- Resuming the existing Codex thread reported successful Drone Hub MCP startup.
- Inventory checks succeeded with 65 Drone Hub tools. Measured calls took 7.94,
  5.98, 6.35, and 5.82 seconds, leaving little headroom below the 10-second limit.
- The failed jobs' stderr files were empty. The precise reason those historical
  requests exceeded ten seconds is not established; a persistent unavailable
  server was not reproduced. The short discovery budget is a demonstrated
  failure boundary, and slow healthy discovery is covered by a regression test.

## Fix and verification

Discovery now has one 30-second budget across polling and pagination, separate
from the managed MCP server's ten-second startup timeout. Missing, empty, and
failed tool inventories still prevent generation. The shared error presentation
now identifies this as a tool startup failure and says the agent could not start.

All 19 targeted startup and failure-presentation tests passed, including a
healthy inventory response delayed 10.5 seconds. The initial sandboxed test run
stalled child processes; the same suite passed outside the sandbox. Drone's
TypeScript check and daemon bundle build also passed.

At 16:09:41 UTC, the timeout-only change was applied to the affected container's
installed daemon bundle after confirming there were no running or queued jobs.
Only that daemon was restarted; its health endpoint returned HTTP 200. The prior
bundle is preserved inside the container at
`/dvm-data/drone/dist/daemon.bundle.js.before-mcp-timeout-20260923T160941Z`.
The source error-presentation fix requires a subsequent UI build/deployment.

No implementation prompt was resent, no new agent turn was started, and the
chat's history and workspace were preserved. Source changes are uncommitted.
