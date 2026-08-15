import { describe, expect, it } from "vitest";

import { getModel, getSupportedThinkingLevels } from "../src/models.js";

describe("model registry", () => {
	it("includes Gemini 3.5 Flash-Lite with its documented thinking levels", () => {
		const model = getModel("google", "gemini-3.5-flash-lite");

		expect(model?.id).toBe("gemini-3.5-flash-lite");
		expect(model?.contextWindow).toBe(1048576);
		expect(model?.maxTokens).toBe(65536);
		expect(model && getSupportedThinkingLevels(model)).toEqual(["minimal", "medium", "high"]);
	});
});
