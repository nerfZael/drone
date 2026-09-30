import { describe, expect, it } from "vitest";

import { getModel, getSupportedThinkingLevels } from "../src/models.js";

describe("model registry", () => {
	for (const provider of ["openai", "openai-codex"] as const) {
		for (const id of ["gpt-6-sol", "gpt-6-luna"] as const) {
			it(`resolves ${provider}/${id} with usable limits and reasoning`, () => {
				const model = getModel(provider, id);
				expect(model.id).toBe(id);
				expect(model.api).toBe(provider === "openai" ? "openai-responses" : "openai-codex-responses");
				expect(model.contextWindow).toBe(provider === "openai" ? 1050000 : 272000);
				expect(model.maxTokens).toBe(128000);
				expect(model.input).toEqual(["text", "image"]);
				expect(getSupportedThinkingLevels(model)).toEqual(["off", "low", "medium", "high", "xhigh"]);
				expect(model.thinkingLevelMap?.off).toBe("none");
			});
		}
	}

	for (const provider of ["openai", "openai-codex"] as const) {
		it(`resolves ${provider}/gpt-6.1-sol without unsupported reasoning levels`, () => {
			const model = getModel(provider, "gpt-6.1-sol");
			expect(model.id).toBe("gpt-6.1-sol");
			expect(model.api).toBe(provider === "openai" ? "openai-responses" : "openai-codex-responses");
			expect(model.contextWindow).toBe(provider === "openai" ? 1050000 : 272000);
			expect(model.maxTokens).toBe(128000);
			expect(model.input).toEqual(["text", "image"]);
			expect(model.cost).toEqual({ input: 2, output: 10, cacheRead: 0.1, cacheWrite: provider === "openai" ? 2.5 : 0 });
			expect(getSupportedThinkingLevels(model)).toEqual(["low", "medium", "high", "xhigh"]);
			expect(model.thinkingLevelMap?.off).toBeNull();
			expect(model.thinkingLevelMap?.minimal).toBeNull();
		});
	}

	it("includes Gemini 3.5 Flash-Lite with its documented thinking levels", () => {
		const model = getModel("google", "gemini-3.5-flash-lite");

		expect(model?.id).toBe("gemini-3.5-flash-lite");
		expect(model?.contextWindow).toBe(1048576);
		expect(model?.maxTokens).toBe(65536);
		expect(model && getSupportedThinkingLevels(model)).toEqual(["minimal", "medium", "high"]);
	});
});
