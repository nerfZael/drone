import type { Context, Message, Model } from "../types.js";

const CHARS_PER_TOKEN = 4;
const MESSAGE_OVERHEAD_TOKENS = 4;
const TOOL_OVERHEAD_TOKENS = 12;
const DEFAULT_IMAGE_TOKENS = 2_048;

export interface ContextTokenEstimate {
	systemPromptTokens: number;
	messageTokens: number;
	toolDefinitionTokens: number;
	imageTokens: number;
	providerOverheadTokens: number;
	inputTokens: number;
	confidence: "heuristic";
}

function textTokens(value: string): number {
	return value.length === 0 ? 0 : Math.ceil(value.length / CHARS_PER_TOKEN);
}

function jsonTokens(value: unknown): number {
	try {
		return textTokens(JSON.stringify(value));
	} catch {
		return 0;
	}
}

function estimateMessage(message: Message): { text: number; images: number } {
	if (message.role === "user") {
		if (typeof message.content === "string") {
			return { text: textTokens(message.content), images: 0 };
		}
		return message.content.reduce(
			(total, part) => {
				if (part.type === "image") total.images += DEFAULT_IMAGE_TOKENS;
				else total.text += textTokens(part.text);
				return total;
			},
			{ text: 0, images: 0 },
		);
	}

	if (message.role === "assistant") {
		return message.content.reduce(
			(total, part) => {
				if (part.type === "text") total.text += textTokens(part.text);
				else if (part.type === "thinking") total.text += textTokens(part.thinking);
				else {
					total.text += textTokens(part.name);
					total.text += textTokens(part.id);
					total.text += jsonTokens(part.arguments);
				}
				return total;
			},
			{ text: 0, images: 0 },
		);
	}

	return message.content.reduce(
		(total, part) => {
			if (part.type === "image") total.images += DEFAULT_IMAGE_TOKENS;
			else total.text += textTokens(part.text);
			return total;
		},
		{
			text: textTokens(message.toolName) + textTokens(message.toolCallId),
			images: 0,
		},
	);
}

/**
 * Conservatively estimates the provider-visible input request.
 *
 * The estimate intentionally ignores base64 byte length. Providers account for
 * images by visual tokens rather than by the serialized base64 string sent over
 * the wire, so counting base64 as text grossly overestimates multimodal context.
 */
export function estimateContextTokens(_model: Model<any>, context: Context): ContextTokenEstimate {
	const systemPromptTokens = textTokens(context.systemPrompt ?? "");
	let messageTokens = 0;
	let imageTokens = 0;
	for (const message of context.messages) {
		const estimate = estimateMessage(message);
		messageTokens += estimate.text;
		imageTokens += estimate.images;
	}

	let toolDefinitionTokens = 0;
	for (const tool of context.tools ?? []) {
		toolDefinitionTokens += textTokens(tool.name);
		toolDefinitionTokens += textTokens(tool.description);
		toolDefinitionTokens += jsonTokens(tool.parameters);
	}

	const providerOverheadTokens =
		context.messages.length * MESSAGE_OVERHEAD_TOKENS +
		(context.tools?.length ?? 0) * TOOL_OVERHEAD_TOKENS +
		3;
	const inputTokens =
		systemPromptTokens +
		messageTokens +
		toolDefinitionTokens +
		imageTokens +
		providerOverheadTokens;

	return {
		systemPromptTokens,
		messageTokens,
		toolDefinitionTokens,
		imageTokens,
		providerOverheadTokens,
		inputTokens,
		confidence: "heuristic",
	};
}
