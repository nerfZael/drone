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

	it("includes Gemini 3.5 Flash-Lite with its documented thinking levels", () => {
		const model = getModel("google", "gemini-3.5-flash-lite");

		expect(model?.id).toBe("gemini-3.5-flash-lite");
		expect(model?.contextWindow).toBe(1048576);
		expect(model?.maxTokens).toBe(65536);
		expect(model && getSupportedThinkingLevels(model)).toEqual(["minimal", "medium", "high"]);
	});
});
