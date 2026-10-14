# Desktop notifications

Settings → Notifications controls Drone Hub's own floating notification cards in the Electron desktop app. Completion and failure alerts are enabled by default, sound is off, and custom message alerts are opt-in. Preferences are stored locally per app/profile.

A completed chat produces “<drone name> finished”; a failed chat produces “<drone name> failed”. Cards highlight the drone name and use a consistent failure indicator. The body identifies the chat without exposing its transcript or error details. Clicking restores the app, selects the correct repository, expands the drone's groups, and opens the chat through the existing navigation handler. A drone with multiple chats can produce an alert for each chat.

Cards use separate, sandboxed, frameless desktop windows positioned at the bottom right of the main app window's display. They appear above normal windows without taking keyboard focus. Each window covers only its card, so gaps between cards remain clickable. Colors follow the system light/dark appearance. Platform window-manager policies can affect placement and always-on-top behavior; full-screen applications need manual verification.

The app must remain running and connected. Notifications are live, not a durable inbox: startup/reconnect establishes a baseline and does not replay old completions or custom events. These cards do not use OS notifications, appear in the system notification center, or automatically follow OS Do Not Disturb. Use the master switch for quiet mode. Cards close when the main window closes.

## Updating an older desktop process

The UI verifies that the running Electron main process supports cards before sending notifications. An old preload, or a new preload paired with an old main process, pauses notification delivery and shows an update/restart explanation in Settings. It never falls back to OS notifications.

After updating the desktop files, fully quit and reopen Drone Hub. Reloading the UI or restarting only the Hub server does not replace Electron's main process. Already delivered OS notifications can remain in the system notification center until dismissed.

## Duration, disabling, and dismissal

The default is eight seconds of visible time. Settings offers 5, 8, 15, or 30 seconds, or “Until dismissed”. Timers pause while hovering over or focusing a card. Changes apply to new notifications.

Use the × button to dismiss an individual card without opening the app. Escape also dismisses a focused card. Clicking the main card opens its chat and dismisses the card. Switching off notifications immediately clears visible and queued cards and prevents new alerts. Categories can also be disabled individually for future events.

Up to three cards are visible at once (fewer on small displays). Up to 50 additional cards can wait in a queue; the oldest queued card is dropped if the queue fills. Queued cards start their timer only after becoming visible. “Until dismissed” cards hold their slot until opened or dismissed.

## Deliberate chat messages

Enable “Chat messages from custom events” and list canonical event names, one per line. The default is `chat_message`. Emit that event using the existing custom-event tool, with:

```json
{"name":"chat_message","data":{"message":"Ready for your review"}}
```

Use the tool's existing idempotency key when retrying an emission. Only newly persisted emissions are forwarded. Event names use the custom-event catalog's normalized form (for example, `chat.message` becomes `chat_message`). The notification previews `data.message`; if omitted, it displays the event name. Clicking opens the emitting chat. Message previews are visible to anyone viewing the desktop.

A user can create a normal resource subscription whose agent emits this event when its chosen condition is met. The desktop notification itself never creates a subscription, sends an agent prompt, or spends model tokens. It also does not announce every streamed assistant message.

## Implementation and verification

The desktop SSE connection opts into lifecycle observation. `DesktopNotificationObserver` reads the same status projection used by chat subscriptions when chat/registry invalidations arrive, serializes concurrent reads, and compares against its connection baseline. Both failed user prompts and failed assistant turns are handled. New custom-event emissions use the same desktop SSE notification channel. Renderer preferences filter events; a validated preload/main-process bridge manages the card windows. Cards render all event content as text and expose only read, open, dismiss, and timer-pause actions through their separate preload.

Focused tests simulate Electron windows and timers, and exercise the actual card-renderer script in a DOM. They cover baseline suppression, completion/failure detection, coalescing, removal/recreation races, SSE cleanup, custom-event filtering, preference changes, sender validation, queue limits, timing, hover pause, safe message rendering, dismissal, and click navigation.

Manual checks on each supported desktop OS:

1. Send a test card; check its appearance, sound off/on, and that typing in another app keeps focus.
2. Minimize the app and complete/fail a chat in another repository. Click its card and confirm the correct drone/chat opens.
3. Check the default timeout, hover/focus pause, “Until dismissed”, ×, and Escape. Fill all three slots and confirm queued cards appear as slots become free.
4. Disable notifications while cards are visible/queued; confirm all disappear. Restart to confirm preferences persist.
5. Enable `chat_message`, emit it with a message, then repeat the same idempotency key. Confirm only the first emission alerts and clicking opens its source chat.
6. Check multi-monitor placement, desktop switching, full-screen apps, and reconnecting without a notification backlog.
