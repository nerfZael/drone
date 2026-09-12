# Background Companion dispatch and Live timeout

## Evidence

The phone log from September 12 shows the headset starting capture at 23:55:40.818 and remote Live becoming ready at 23:55:44.489. The activity only becomes visible at 23:56:29.365. Hub timing records the backend request starting at 21:56:29.561 UTC, immediately after the phone returned to the foreground. The audio route closes after 47,367 ms with `session-closed`, and the phone pauses voice at 23:56:30.122.

`CompanionLiveConversation` used a JavaScript timeout to debounce task dispatch. `MobileCompanionLiveConnection` used a JavaScript interval for its ten-second heartbeat. The Hub closes Live after more than 45 seconds without a ping. The installed React Native `JavaTimerManager` invokes timers from `Choreographer` frame callbacks, including when a headless task is active. Native audio events continue without display frames; these JavaScript deadlines can stall until the screen/application resumes. This explains the observed delayed dispatch and is consistent with the session closure timing; the original Hub log does not record an explicit heartbeat-expiry reason.

## Change

Android's media controls now emit a scoped Handler tick every 250 ms while the controls are owned by the foreground service. A small Live clock runs due callbacks from these ticks and also retains ordinary JS timers as a fallback. It cancels callbacks before invoking them, so a late display timer cannot dispatch the same task twice.

Live's startup deadline, recurring heartbeat, and delegation debounce use this clock. Closing or pausing Live cancels its scheduled tasks; releasing media controls removes the native tick listener, cancels the Handler callback, and closes the clock. Desktop and iOS retain ordinary timers. No global timer overrides or changes to the Hub's timeout policy are introduced.

Phone logs now distinguish delegation receipt, backend dispatch, and session errors, including app state and without logging speech or prompts.

## Validation

- Regression tests freeze all JS timer callbacks: native ticks still dispatch a task and deliver its backend reply, send twelve heartbeats over two simulated minutes, and enforce the startup timeout.
- Hook integration verifies both the connection and conversation receive the controls clock while backgrounded.
- Duplicate delivery, stale control IDs, cancelled tasks, and control release are covered.
- Android Handler test checks ticks during standby/active controls and cancellation on close; existing playback, headset button, and Bluetooth route suites pass.
- Live connection/clock: 16 tests; controls: 4; lifecycle: 15; backend replies: 5. Mobile typecheck, assistant-chat build, and native Kotlin compilation pass.

The physical phone supplied the original reproduction logs. A repeat of the same spoken task on the installed update is still needed to confirm the fix under the device's actual screen-off behavior.
