# Companion chat completion was processed but not requested as speech

The latest retained Companion subscription was `ee2e3271-8b09-434b-adee-ac6af27a75f4`, owned by `companion:websocket:dd538557-99e9-41c6-aea7-abcbdf90d838`. It watched chat `c91b89b9-5499-4d19-9e95-dac4f713edfe` (Speak subscription responses), with intent to report the delegated work's completion.

Read-only inspection of the default profile's `hub.sqlite` and `companion-blip.sqlite` established this timeline on September 16 (UTC):

- 10:32:48.549: subscription created for `chat.idle` and `chat.failed`.
- 10:42:53.300: source chat finished.
- 10:42:55.044: idle event persisted and delivery created.
- 10:43:25.289: batch `645b4f28-6e39-4109-98dc-41f5939597f8` marked delivered, without retries or errors. The roughly 30-second wait precedes Companion execution.
- 10:43:30.654: subscription-triggered Companion run completed. Its stored assistant message summarized the implementation, tests, mobile limitation, and lack of a commit.
- 10:49:56.350: subscription cancelled when the session ended, after the successful delivery.

The subscription was therefore not lost or cancelled before delivery. The shared Live adapter sent every final reply using `session.thinking.append`, including unsolicited subscription replies. That was part of the earlier quiet-delivery experiment. According to [OpenAI's Live delegation documentation](https://developers.openai.com/api/docs/guides/live-delegation#send-the-right-kind-of-update), this supplies context without requesting speech; `session.commentary.append` is the event for information the user should hear. Retained backend records establish generation, not actual client reception or audible playback, so the historical audio outcome cannot be independently reconstructed.

The fix retains explicit subscription provenance in Companion client state and carries it through the Live observer's readiness queue. Subscription completions and failures request speech with a null delegation ID, and are not discarded as stale answers to an unrelated pending voice request. Ordinary replies and progress retain quiet delivery. Starting a new user prompt or proposal continuation clears subscription provenance. Existing deduplication, stopped-session handling, bounded content, and detailed-answer fallback remain in place.

Regression coverage checks repeated subscription notifications, readiness buffering followed by an ordinary reply, subscription errors, pending voice requests, and desktop/mobile integration. These simulated transports verify the outgoing speech request, not physical playback. This change applies to active Live connections; waking stopped Live Voice is separate work.

Validation: 79 focused tests passed across shared client/Live behavior, desktop/mobile integration, and subscription delivery. The shared package build and desktop/mobile typechecks passed. Changes are uncommitted; the running Hub was not restarted.
