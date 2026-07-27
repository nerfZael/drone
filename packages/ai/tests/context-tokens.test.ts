import { describe, expect, it } from "vitest";
import { Type } from "typebox";
import { estimateContextTokens } from "../src/utils/context-tokens.js";
import type { Model } from "../src/types.js";

const model = {
	id: "test",
	name: "test",
	api: "test",
	provider: "test",
	baseUrl: "",
	reasoning: false,
	input: ["text", "image"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 100_000,
	maxTokens: 1_000,
} as Model<any>;

describe("estimateContextTokens", () => {
	it("counts system prompts and tool schemas without treating image base64 as text", () => {
		const shortImage = estimateContextTokens(model, {
			systemPrompt: "system instructions",
			messages: [
				{
					role: "user",
					content: [{ type: "image", data: "a", mimeType: "image/png" }],
					timestamp: 1,
				},
			],
			tools: [
				{
					name: "lookup",
					description: "Look up a record",
					parameters: Type.Object({ query: Type.String() }),
				},
			],
		});
		const largeImage = estimateContextTokens(model, {
			systemPrompt: "system instructions",
			messages: [
				{
					role: "user",
					content: [{ type: "image", data: "a".repeat(1_000_000), mimeType: "image/png" }],
					timestamp: 1,
				},
			],
			tools: [
				{
					name: "lookup",
					description: "Look up a record",
					parameters: Type.Object({ query: Type.String() }),
				},
			],
		});

		expect(shortImage.inputTokens).toBe(largeImage.inputTokens);
		expect(shortImage.systemPromptTokens).toBeGreaterThan(0);
		expect(shortImage.toolDefinitionTokens).toBeGreaterThan(0);
		expect(shortImage.imageTokens).toBe(2_048);
	});
});
