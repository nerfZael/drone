# Local checkout heap exhaustion, 2026-09-26

The hub backend exited with `FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory` immediately after the 21:18:03 UTC requests (23:18 local time). Its last garbage collections retained about 3,613 MB. The native stack ends in string flattening and string equality. Desktop diagnostics continued recording failed backend connections after the exit.

The user reported activating local use with commits-only auto updates. The checkout request itself has no completed-request log entry, so the logs confirm memory exhaustion but do not identify the exact JavaScript callsite.

Inspection found a matching allocation path: `LocalCheckoutService` resolved a drone through `loadRegistry()`, then saved its small settings record through `updateRegistry()`. Both build the fleet-wide compatibility projection, including active and archived chat histories. Residual-state updates clone that projection repeatedly and compare JSON strings for canonical-owned namespaces before saving. The live SQLite database contained 198,623,357 characters of active turn JSON and 85,204,289 characters of archived chat JSON. Multiple copies and flattened two-byte strings can exhaust the Node heap. The checkout residual row was only 118 characters and still inactive, consistent with failure before saving activation.

The fix uses the existing targeted canonical lifecycle resolver and a checkout store that reads/writes only residual state. First use preserves migration from the raw legacy snapshot; subsequent operations never build the fleet projection. Writes merge the latest residual row in the shared SQLite transaction, preserving unrelated state. Successful writes retain the hub registry-change notification. Bun keeps its existing non-native storage fallback.

Validation:

- Backend TypeScript build and postbuild passed.
- All 20 existing checkout tests passed, including real Git repositories, ignored-file preservation, working-tree snapshots, cancellation and rollback.
- Three Node/SQLite regression tests cover legacy migration, concurrent residual updates, commits-only activation, repeated updates, mode changes and returning to the original checkout. The workflow test rejects every attempt to read or update the global compatibility registry.

This removes the identified checkout allocation path. It does not establish that all other compatibility-registry callers have bounded memory use, or reproduce the original production crash in a live desktop session. The rebuilt backend must be restarted to load the change.
