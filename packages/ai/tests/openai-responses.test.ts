import { describe, expect, test } from "vitest";
import { getModel } from "../src/models.js";
import { streamSimpleOpenAIResponses } from "../src/providers/openai-responses.js";
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
