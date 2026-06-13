import { describe, expect, test } from "vitest";
import type { AssistantMessage, Model, ToolResultMessage } from "../src/types.js";
import { transformMessages } from "../src/providers/transform-messages.js";

const model: Model<"openai-responses"> = {
	id: "gpt-test",
	name: "GPT Test",
	api: "openai-responses",
	provider: "openai",
	baseUrl: "https://api.openai.com/v1",
	reasoning: true,
	input: ["text"],
	cost: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
	},
	contextWindow: 128000,
	maxTokens: 4096,
};

function assistantMessage(input: Partial<AssistantMessage>): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "openai-responses",
		provider: "openai",
		model: "gpt-test",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				total: 0,
			},
		},
		stopReason: "stop",
		timestamp: 0,
		...input,
	};
}

function toolResult(toolCallId: string): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId,
		toolName: "read_files",
		content: [{ type: "text", text: "done" }],
		isError: false,
		timestamp: 0,
	};
}

describe("transformMessages", () => {
	test("drops orphaned tool results without a pending assistant tool call", () => {
		const transformed = transformMessages(
			[
				{ role: "user", content: "start", timestamp: 0 },
				toolResult("call_orphan|fc_orphan"),
				{ role: "user", content: "continue", timestamp: 1 },
			],
			model,
		);

		expect(transformed).toEqual([
			{ role: "user", content: "start", timestamp: 0 },
			{ role: "user", content: "continue", timestamp: 1 },
		]);
	});

	test("drops tool results that belong to skipped errored assistant messages", () => {
		const transformed = transformMessages(
			[
				{ role: "user", content: "start", timestamp: 0 },
				assistantMessage({
					stopReason: "error",
					errorMessage: "No tool call found for function call output",
					content: [
						{
							type: "toolCall",
							id: "call_orphan|fc_orphan",
							name: "read_files",
							arguments: {},
						},
					],
				}),
				toolResult("call_orphan|fc_orphan"),
				{ role: "user", content: "continue", timestamp: 1 },
			],
			model,
		);

		expect(transformed).toEqual([
			{ role: "user", content: "start", timestamp: 0 },
			{ role: "user", content: "continue", timestamp: 1 },
		]);
	});

	test("keeps tool results for valid assistant tool calls", () => {
		const transformed = transformMessages(
			[
				{ role: "user", content: "start", timestamp: 0 },
				assistantMessage({
					stopReason: "toolUse",
					content: [
						{
							type: "toolCall",
							id: "call_valid|fc_valid",
							name: "read_files",
							arguments: {},
						},
					],
				}),
				toolResult("call_valid|fc_valid"),
			],
			model,
		);

		expect(transformed.map((message) => message.role)).toEqual(["user", "assistant", "toolResult"]);
	});
});
