import { describe, expect, test, vi } from "vitest";
import { getModel } from "../src/models.js";
import { codexPromptCacheKey, streamSimpleOpenAICodexResponses } from "../src/providers/openai-codex-responses.js";
import type { Context, Model } from "../src/types.js";

const context: Context = {
	systemPrompt: "You are concise.",
	messages: [{ role: "user", content: "Hello", timestamp: Date.now() }],
	tools: [],
};

function fakeCodexToken(): string {
	const payload = Buffer.from(
		JSON.stringify({
			"https://api.openai.com/auth": { chatgpt_account_id: "acct-test" },
		}),
	).toString("base64");
	return `header.${payload}.signature`;
}

async function capturePayload(model: Model<"openai-codex-responses">): Promise<any> {
	let payload: any;
	const stream = streamSimpleOpenAICodexResponses(model, context, {
		apiKey: fakeCodexToken(),
		onPayload: (nextPayload) => {
			payload = nextPayload;
			throw new Error("stop after payload capture");
		},
	});

	await stream.result();
	return payload;
}

describe("openai codex responses", () => {
	test.each(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"])("registers %s for ChatGPT authentication", (modelId) => {
		const model = getModel("openai-codex", modelId) as Model<"openai-codex-responses">;

		expect(model?.name).toContain("GPT-5.6");
		expect(model?.thinkingLevelMap?.off).toBe("none");
		expect(model?.cost.cacheWrite).toBe(0);
	});

	test("shortens prompt cache keys to the provider limit", () => {
		const sessionId = "vsn-usr_7685a53fc3a6461b9257b775ad0db9b6-thr_d25719c89846407d8888a0bce6dd1539";
		const key = codexPromptCacheKey(sessionId);

		expect(key).toBeDefined();
		expect(key!.length).toBeLessThanOrEqual(64);
		expect(key).not.toBe(sessionId);
	});

	test("keeps short prompt cache keys unchanged", () => {
		expect(codexPromptCacheKey("short-session")).toBe("short-session");
		expect(codexPromptCacheKey(undefined)).toBeUndefined();
	});

	test("sends explicit no-reasoning effort for GPT-5.5 instant", async () => {
		const model = getModel("openai-codex", "gpt-5.5") as Model<"openai-codex-responses">;

		const payload = await capturePayload(model);

		expect(payload?.reasoning).toEqual({ effort: "none", summary: "auto" });
	});

	test("does not retry a non-retryable model-not-found response", async () => {
		const model = getModel("openai-codex", "gpt-5.6-luna") as Model<"openai-codex-responses">;
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Model not found gpt-5.6-luna" } }), {
			status: 404,
			headers: { "content-type": "application/json" },
		}));
		const originalFetch = globalThis.fetch;
		globalThis.fetch = fetchMock as typeof fetch;
		try {
			const stream = streamSimpleOpenAICodexResponses(model, context, { apiKey: fakeCodexToken(), transport: "sse" });
			const result = await stream.result();
			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(result.stopReason).toBe("error");
			expect(result.errorMessage).toBe("Model not found gpt-5.6-luna");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("uses the official Codex client identity headers for SSE", async () => {
		const model = getModel("openai-codex", "gpt-5.6-luna") as Model<"openai-codex-responses">;
		let request: Request | undefined;
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			request = new Request(input, init);
			return new Response(JSON.stringify({ error: { message: "stop" } }), { status: 400 });
		});
		const originalFetch = globalThis.fetch;
		globalThis.fetch = fetchMock as typeof fetch;
		try {
			await streamSimpleOpenAICodexResponses(model, context, { apiKey: fakeCodexToken(), transport: "sse" }).result();
			expect(request?.headers.get("originator")).toBe("codex_cli_rs");
			expect(request?.headers.get("user-agent")).toMatch(/^codex_cli_rs\/0\.0\.1/);
			expect(request?.headers.get("chatgpt-account-id")).toBe("acct-test");
			expect(request?.headers.get("openai-beta")).toBeNull();
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
