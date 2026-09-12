import { describe, expect, test, vi } from "vitest";
import { measurePayload, measureProviderUsage } from "../src/utils/request-metrics.js";
import { getModel } from "../src/models.js";
import { streamOpenAICompletions } from "../src/providers/openai-completions.js";
import type { Model } from "../src/types.js";

const mock = vi.hoisted(() => ({ fail: false, payload: undefined as any }));
vi.mock("openai", () => ({ default: class {
	chat = { completions: { create: (payload: unknown) => {
		mock.payload = payload;
		return { withResponse: async () => {
			if (mock.fail) throw new Error("transport failed");
			return { response: { status: 200, headers: new Headers() }, data: (async function* () {
				yield { id: "response-1", choices: [{ delta: { role: "assistant" } }] };
				yield { id: "response-1", choices: [{ delta: { content: "Hello" } }] };
				yield { id: "response-1", choices: [{ delta: {}, finish_reason: "stop" }], usage: {
					prompt_tokens: 581384, completion_tokens: 12, total_tokens: 581396,
					prompt_tokens_details: { cached_tokens: 500000 }, secret: "do not store" } };
			})() };
		} };
	} } };
} }));

const model = { ...getModel("openai", "gpt-4o"), api: "openai-completions" } as Model<"openai-completions">;

describe("request metrics", () => {
	test("measures UTF-8 bytes without retaining payload content", () => {
		const payload = { messages: [{ role: "user", content: "secret 🐝" }, { role: "tool", content: "result" }], tools: [{ function: { name: "private_tool" } }] };
		const measured = measurePayload(payload)!;
		expect(measured.jsonBytes).toBe(new TextEncoder().encode(JSON.stringify(payload)).length);
		expect(measured.messages.map(m => m.role)).toEqual(["user", "tool"]);
		expect(measured.tools).toHaveLength(1);
		expect(JSON.stringify(measured)).not.toMatch(/secret|private_tool|result/);
	});
	test("allowlists original numeric usage without retaining metadata", () => {
		expect(measureProviderUsage({ prompt_tokens: 10, total_tokens: Infinity, secret: 42,
			prompt_tokens_details: { cached_tokens: 3, private: "secret" } })).toEqual({ prompt_tokens: 10, "prompt_tokens_details.cached_tokens": 3 });
	});
	test("records final transformed payload, timings, and anomalous original usage", async () => {
		mock.fail = false;
		const message = await streamOpenAICompletions(model, { messages: [] }, { apiKey: "secret-key", onPayload: payload => ({ ...payload as object, messages: [{ role: "user", content: "transformed" }] }) }).result();
		expect(message.stopReason).toBe("stop");
		expect(message.requestMetrics?.payload).toEqual(measurePayload(mock.payload));
		expect(message.requestMetrics).toMatchObject({ status: 200, chunkCount: 3, providerUsage: { prompt_tokens: 581384, "prompt_tokens_details.cached_tokens": 500000 } });
		const m = message.requestMetrics!;
		expect(m.responseHeadersMs).toBeLessThanOrEqual(m.firstChunkMs!);
		expect(m.firstChunkMs).toBeLessThanOrEqual(m.firstContentMs!);
		expect(m.firstContentMs).toBeLessThanOrEqual(m.durationMs!);
		expect(message.usage.input + message.usage.cacheRead).toBe(581384);
		expect(JSON.stringify(m)).not.toMatch(/secret|transformed/);
	});
	test("retains payload measurements on transport failure without inventing response timing", async () => {
		mock.fail = true;
		try {
			const message = await streamOpenAICompletions(model, { messages: [] }, { apiKey: "test" }).result();
			expect(message.stopReason).toBe("error");
			expect(message.requestMetrics?.payload).toBeDefined();
			expect(message.requestMetrics?.durationMs).toBeGreaterThanOrEqual(0);
			expect(message.requestMetrics?.firstChunkMs).toBeUndefined();
		} finally { mock.fail = false; }
	});
});
