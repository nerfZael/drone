import { describe, expect, test } from "vitest";
import { getModel } from "../src/models.js";
import { streamSimpleOpenAIResponses } from "../src/providers/openai-responses.js";
import { parseResponsesUsage } from "../src/providers/openai-responses-shared.js";
import type { Context, Model } from "../src/types.js";

const context: Context = {
	systemPrompt: "You are concise.",
	messages: [{ role: "user", content: "Hello", timestamp: Date.now() }],
	tools: [],
};

async function capturePayload<TApi extends "openai-responses">(model: Model<TApi>): Promise<any> {
	let payload: any;
	const stream = streamSimpleOpenAIResponses(model, context, {
		apiKey: "test-key",
		cacheRetention: "none",
		onPayload: (nextPayload) => {
			payload = nextPayload;
			throw new Error("stop after payload capture");
		},
	});

	await stream.result();
	return payload;
}

describe("openai responses", () => {
	test("separates GPT-5.6 cache reads and writes from uncached input", () => {
		const usage = parseResponsesUsage({
			input_tokens: 100,
			output_tokens: 20,
			total_tokens: 120,
			input_tokens_details: { cached_tokens: 30, cache_write_tokens: 10 },
		});

		expect(usage).toMatchObject({ input: 60, output: 20, cacheRead: 30, cacheWrite: 10, totalTokens: 120 });
	});

	test.each(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"])("registers %s with explicit no-reasoning support", async (modelId) => {
		const model = getModel("openai", modelId) as Model<"openai-responses">;

		expect(model?.name).toContain("GPT-5.6");
		const payload = await capturePayload(model);
		expect(payload?.reasoning).toEqual({ effort: "none" });
	});

	test("sends explicit no-reasoning effort for GPT-5.5 instant", async () => {
		const model = getModel("openai", "gpt-5.5") as Model<"openai-responses">;

		const payload = await capturePayload(model);

		expect(payload?.reasoning).toEqual({ effort: "none" });
	});

	test("keeps GPT-5.4 instant behavior unchanged", async () => {
		const model = getModel("openai", "gpt-5.4") as Model<"openai-responses">;

		const payload = await capturePayload(model);

		expect(payload?.reasoning).toBeUndefined();
	});
});
