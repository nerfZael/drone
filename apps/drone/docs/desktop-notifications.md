# Desktop notifications

Settings → Notifications controls native system notifications in the Electron desktop app. Completion and failure alerts are enabled by default, sound is off, and custom message alerts are opt-in. Preferences are stored locally per app/profile.

A completed chat produces “<drone name> finished”; a failed chat produces “<drone name> failed”. The body identifies the chat without exposing its transcript or error details. Clicking restores the app, leaves Settings if necessary, selects the correct repository, expands the drone's groups, and opens the chat through the existing navigation handler. A drone with multiple chats can produce an alert for each chat.

The app must remain running and connected. Notifications are live, not a durable inbox: startup/reconnect establishes a baseline and does not replay old completions or custom events. OS permissions and Do Not Disturb can suppress alerts. Use the test button in Settings to check delivery. Native styling controls the appearance; drone names are plain text. Clicking after the desktop process exits is not supported.

## Duration, disabling, and dismissal

There is no app-defined timeout in seconds. Native banners use the OS default timeout and may remain in the system notification center after the banner disappears. Use the OS close/dismiss control to remove an individual alert. Settings → Notifications → Enable system notifications stops future alerts; each category can also be disabled separately. Switching off alerts does not remove ones already delivered.

The app retains up to 100 native notification handles. When that limit is exceeded, it closes the oldest retained alert. Windows banner timeouts retain their handle so clicks from Action Center still work while the app is running.

## Deliberate chat messages

Enable “Chat messages from custom events” and list canonical event names, one per line. The default is `chat_message`. Emit that event using the existing custom-event tool, with:

```json
{"name":"chat_message","data":{"message":"Ready for your review"}}
```

Use the tool's existing idempotency key when retrying an emission. Only newly persisted emissions are forwarded. Event names use the custom-event catalog's normalized form (for example, `chat.message` becomes `chat_message`). The notification displays the emitting drone's name and up to 500 characters of `data.message`; if omitted, it displays the event name. Clicking opens the emitting chat. This text may appear on the lock screen.

A user can create a normal resource subscription whose agent emits this event when its chosen condition is met. The desktop notification itself never creates a subscription, sends an agent prompt, or spends model tokens. It also does not announce every streamed assistant message. This keeps agent automation and human-facing presentation separate while letting them share custom events.

## Implementation and verification

The desktop SSE connection opts into lifecycle observation. `DesktopNotificationObserver` reads the same status projection used by chat subscriptions when chat/registry invalidations arrive, serializes concurrent reads, and compares against its connection baseline. Both failed user prompts and failed assistant turns are handled. New custom-event emissions use the same desktop SSE notification channel. Renderer preferences filter events, and a narrow validated preload/main-process bridge displays native notifications and handles clicks.

Focused tests cover baseline suppression, completion/failure detection, coalescing, disconnect cleanup, SSE opt-in and cleanup, exact custom-event filtering, live preference changes, IPC sender validation, native failure reporting, and click dispatch. These use simulated OS APIs.

Manual checks on each supported desktop OS:

1. Send the test notification; check sound off/on and OS permission denial.
2. Minimize the app and complete/fail a chat, including a chat in another repository. Click its alert and confirm the correct drone/chat opens.
3. Disable each category and the master switch; restart to confirm preferences persist.
4. Enable `chat_message`, emit it with a message, then repeat the same idempotency key. Confirm only the first emission alerts and clicking opens its source chat.
5. Reconnect/restart with old completed chats. Confirm there is no notification backlog.
