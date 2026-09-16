# Cerebras provider

After rebuilding the Hub and clients, save a Cerebras API key in **Settings → General → Cerebras API key**, or set `CEREBRAS_API_KEY` in the Hub process environment. Stored keys take precedence over the environment; clearing a stored key restores the environment value, if present.

For built-in native chats, choose **Settings → General → Built-in agent → Cerebras**, select Qwen 3.8 27B and a reasoning level, and save the defaults. New native chats inherit this selection. Automatic naming has its own provider selector in General Settings; select Cerebras there to use Qwen for generated names. Existing chats keep their own model settings. Administrator devices can copy the Cerebras key from a trusted Hub using Provider credentials.

In Companion's provider selector, choose **Cerebras**, then **Qwen 3.8 27B**. Desktop and mobile select the same Hub backend. The key stays on the Hub. Choose **Off**, **Low**, **Medium**, or **High** reasoning; Off explicitly sends `reasoning_effort: "none"` because Cerebras otherwise defaults to High.

This configures Companion's task model. Live voice continues using its separately configured OpenAI credential. The Hub uses its existing tools, permissions, conversation storage, cancellation, and compaction flow.

The model uses `https://api.cerebras.ai/v1/chat/completions` with model ID `qwen-3.8-27b`. It is configured for paid Cerebras accounts: 131,072 context tokens and 40,960 maximum output tokens. Companion uses these limits for context reporting, compaction, and output budgeting.

Before relying on it for everyday work, run a small Companion task that reads app context and calls a second tool. Check latency and tool accuracy with your own account. Local tests cover credential precedence, settings APIs, model selection, reasoning parameters, and streamed tool-call replay; they do not establish live service behavior.

References: [Cerebras model catalog](https://inference-docs.cerebras.ai/models/overview), [reasoning settings](https://inference-docs.cerebras.ai/capabilities/reasoning), [rate limits](https://inference-docs.cerebras.ai/support/rate-limits).
