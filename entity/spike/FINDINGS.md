# M0.5 spike findings (2026-09-24)

`spike.ts` is throwaway and not committed. It has one LLM mind (fresh context per wake), a 0–9 keypad, code watches, output stop/resume, and a tiny behaviour-tree runner. Run it with:

```
bun entity/spike/spike.ts --model openai-codex/gpt-6-luna [--reasoning medium] [--scenarios 2,3,4,9] [--repl] [--quiet]
```

## Results

Test models from now on: Codex gpt-6-sol and gpt-6-luna on medium reasoning. Cerebras qwen is for rare speed tests only.

Each figure is one run per model and scenario, so treat it as indicative, not as a benchmark.

| Model | 2: msg→556 | 3: watch ready / mirror | 4: stop on 5 / ack | 9: watches ready / follow | Pass |
|---|---|---|---|---|---|
| openai-codex/gpt-6-sol (medium) | 2.1 s | 5.5 s / <0.1 ms | 0 ms, 0 extra numbers / 7.6 s | 5.4 s / <0.1 ms | 4/4 |
| openai-codex/gpt-6-luna (medium) | 1.8 s | 3.5 s / <0.1 ms | 0 ms, 0 extra numbers / 10.1 s | 6.6 s / <0.1 ms | 4/4 |
| cerebras/qwen-3.8-27b | 0.6 s | 1.6 s / <0.1 ms | fumbled the program | 2.9 s / <0.2 ms | 3/4 |
| cerebras/gpt-oss-120b (early run, not a test model going forward) | 0.6 s | 1.2 s / <0.3 ms | 0 ms / 1.4–1.9 s (after validation fix) | 2.6 s / <0.2 ms | 4/4 |
| openai/gpt-5.4-mini (early run, not a test model going forward) | 2.7 s | 3.2 s / <0.1 ms | 0 ms / 1.8 s | failed: used "hold" for holding a key | 3/4 |

## What it confirms

- **Reflexes are effectively instant.** Code watches mirror or follow keys in under 0.3 ms, and a stop fires with 0 numbers leaking. Once the mind has installed a reflex, "real time" is solved.
- **Every model used the tiers correctly without examples.** They installed watches for mirroring and holds, and used a behaviour tree for counting. "The LLM programs the fast tiers" works as a model.
- **Fresh context per wake is enough.** No run needed history beyond the rendered state.

## What it changes or adds to the design

1. **Mind latency is the bottleneck, and it varies about 5× between models.** Codex models take 1.5–3 s to the first tool call. Cerebras takes 0.5–0.6 s. The spec's target of a first reply under 2 s is only met by the fast tier. This supports the two-limb default: a fast voice limb (Cerebras) plus a strong task limb (gpt-6-sol or gpt-6-luna).
2. **Acknowledgements after a stop took 7–10 s on Codex.** This is likely because a single mind serialises wakes: the stop's wake queues behind the still-running counting run. A fast voice limb running in parallel would answer in about 1–2 s. This is direct evidence for parallel limbs rather than one mind.
3. **Validation is mandatory.** gpt-oss installed watches with invented fields (`on: "key"`, `on: "hold"`) until installs were validated and errors returned to the model. After that, it self-corrected.
4. **"Hold" is a bad name for the interrupt.** gpt-5.4-mini used the watch action `hold` to mean *hold key 6*. The word collides with holding keys. The spike now uses `stop_output` / `resume_output`, and the docs should rename it.
5. **Setup cost is paid once.** Installing reflexes takes 1.5–6.6 s depending on the model, and then every use is instant. Learned reflexes (saved and recalled) would remove even that.
6. **Fast small models are fine as reflex installers but weak planners.** Qwen installed watches correctly and quickly, but produced a broken counting program (a test "hello", then numbers in bursts with no waits). This fits "additional fast limb", not "the head".
7. **Tool results as the interrupt channel work.** Mid-run, the mind saw "output stopped" results and acknowledged without extra machinery.
