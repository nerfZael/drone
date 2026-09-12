# Live delegation remains independent of chat navigation

The original mobile guard compared the current Hub, drone, chat, pane, and open file against a key captured when Live started. Any later selection change rejected further delegations and browser tools, including get_app_context. This could invalidate Live after Companion's own open_drone_chat tool.

The September 13 phone/Hub logs show background backend requests working from 00:14:52 onward. Around 00:17:00–00:17:10, a backend turn invoked open_drone_chat followed by get_app_context and recorded one failed browser tool. Later delegation attempts appeared on the phone without corresponding new Hub requests. The exact changed field was not logged on that build, so attributing this specific incident to the navigation guard remains a strong inference.

## Behavior

Chat, drone, pane, and file navigation no longer invalidate Live. This applies to user navigation and Companion navigation equally; navigation is not an approval path for a new voice session. The same backend session continues receiving delegations and browser tools read current app context.

Routing remains bound to the Hub hosting that Live session. Individual edit tools still validate their target identifiers and revisions before modifying content. Failed navigation does not poison the Live session.

## Diagnostics

Each Live context gets a correlation ID. Logs record initial workspace metadata and subsequent field changes at delegation, submission, or browser-tool execution. These observations do not gate chat navigation. Browser-tool completion/failure logs include the context ID, Hub message ID, tool name, duration, and error. Backend-delegation failures include the Hub and app state; ordinary cancellation is omitted. Prompt, tool argument, edit-content, and response bodies are not added to logs.

## Validation

- 20 Companion context tests pass, including open_drone_chat → get_app_context → subsequent delegation, manual chat/file/Settings navigation, backend run-ID continuity, failed navigation recovery, per-edit target/revision checks, Hub routing, and diagnostic fields without prompt/edit content.
- 15 Live lifecycle tests pass; mobile TypeScript check passes.
- This change is in mobile TypeScript; it uses the existing native background clock and audio route.
