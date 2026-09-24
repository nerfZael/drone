# Demo and success criteria

The demo is a Drone Hub desktop popup with three panes:

- **Chat:** a normal agent chat. Either side can send any number of messages at any time. The entity also sees the user's **unsent draft** as it's typed, clearly marked as not sent. It works both ways: the entity can show its own draft, so the user sees what it's typing before it sends.
- **Keypad:** 0–9. The user and the entity can both press and hold keys. Each key has a down and an up, `world.keys` shows which keys are held and by whom, and every change is marked with who made it.
- **Inspector:** the live state JSON, the event timeline, active watches and motor programs, what each limb is doing, and latency readouts.

The popup also has the user controls: Start, Pause, Resume and Reset (see [architecture.md](architecture.md#user-controls)).

## Scenarios

**We test capabilities, not scripts.** The entity has a mind of its own. It may greet by pressing keys, reply before the user hits enter, or stay quiet. A scenario passes when the requested behaviour happens. Nothing forbids the entity from doing more.

| # | User does | Entity can | Tier that carries it |
|---|---|---|---|
| 1 | Clicks Start, says hello | Respond in any way: chat, keypad, or unprompted | Voice limb |
| 2 | "Press 556" | Press 5, 5, 6 | Voice limb, then a motor program |
| 3 | "Repeat after me", then presses keys | Mirror each press immediately, with no LLM call per key | Code watch installed by the entity |
| 4 | "Send a message per number, count to 50. Stop when I press 5." Presses 5 at 11 | Stop counting within a beat and acknowledge it | Code watch holds the output and tells the limb |
| 5 | "Stop if I change the subject", then drifts | Notice and stop or redirect | Jev watch installed by the entity |
| 6 | Types while the entity is busy | Take the message in without losing work | Jev routing |
| 7 | Types "press 5 if you see this" and doesn't send it | Press 5 from the draft alone | Jev watch on the draft |
| 8 | Types "how are you" slowly | Answer before the user sends it, if the models are fast enough | Voice limb woken by the draft |
| 9 | "Hold 6 while I hold 5", then holds 5 | Hold 6 on `key_down 5` and release it on `key_up 5` | Code watch installed by the entity |

Scenarios 5–8 prove Jev's value and the draft channel. None of them are behaviours we hard-code; they show what the architecture makes possible.

## Latency targets

Latency targets make "real time" measurable. Each one is measured from the triggering event to the visible effect, and the inspector records them per run. The numbers are starting targets, to be tuned once we have measurements.

| Behaviour | Target | Carried by |
|---|---|---|
| Mirror a key (scenarios 3, 9) | < 50 ms | Code watch |
| Stop counting after the hold key (scenario 4) | < 300 ms | Code hold |
| Jev-triggered keypad effect (scenario 7) | < 1 s | Jev |
| First entity reply to a sent message | < 2 s | Fast voice limb |
| Acknowledgement that a hard task started | < 2 s, with the result later | Voice limb, then task limb |
