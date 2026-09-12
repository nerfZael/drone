/** Content-free measurements of the final JSON payload, after onPayload transforms. */
export interface PayloadSize {
	jsonBytes: number;
	/** JSON character count / 4; not a provider tokenizer or image-token estimate. */
	estimatedTokens: number;
}

export interface RequestMetrics {
	version: 1;
	startedAt: number;
	durationMs?: number;
	/** Offsets from startedAt, including SDK retries if any. */
	responseHeadersMs?: number;
	firstChunkMs?: number;
	firstContentMs?: number;
	status?: number;
	chunkCount: number;
	payload?: PayloadSize & {
		messages: (PayloadSize & { index: number; role: string; toolCallCount: number; content: PayloadSize; toolCalls: PayloadSize; reasoning: PayloadSize })[];
		tools: (PayloadSize & { index: number })[];
	};
	/** Original numeric usage fields only; never arbitrary provider metadata. */
	providerUsage?: Record<string, number>;
}

function size(value: unknown): PayloadSize {
	const json = JSON.stringify(value) ?? "";
	return { jsonBytes: new TextEncoder().encode(json).length, estimatedTokens: Math.ceil(json.length / 4) };
}

export function measurePayload(value: unknown): RequestMetrics["payload"] {
	const payload = value as { messages?: unknown[]; tools?: unknown[] };
	return {
		...size(value),
		messages: (Array.isArray(payload?.messages) ? payload.messages : []).map((message, index) => {
			const m = message as { role?: string; tool_calls?: unknown[]; content?: unknown; reasoning?: unknown; reasoning_content?: unknown; reasoning_details?: unknown };
			return { ...size(message), index,
				role: ["system", "developer", "user", "assistant", "tool", "function"].includes(m?.role ?? "") ? m.role! : "unknown",
				content: size(m?.content), toolCalls: size(m?.tool_calls),
				reasoning: size(m?.reasoning ?? m?.reasoning_content ?? m?.reasoning_details),
				toolCallCount: Array.isArray(m?.tool_calls) ? m.tool_calls.length : 0 };
		}),
		tools: (Array.isArray(payload?.tools) ? payload.tools : []).map((tool, index) => ({ ...size(tool), index })),
	};
}

export function measureProviderUsage(value: unknown): Record<string, number> {
	const usage = value as Record<string, unknown>;
	const result: Record<string, number> = {};
	for (const path of ["prompt_tokens", "completion_tokens", "total_tokens", "prompt_cache_hit_tokens",
		"prompt_tokens_details.cached_tokens", "prompt_tokens_details.cache_write_tokens", "completion_tokens_details.reasoning_tokens"]) {
		const number = path.split(".").reduce<unknown>((v, key) => v && typeof v === "object" ? (v as Record<string, unknown>)[key] : undefined, usage);
		if (typeof number === "number" && Number.isFinite(number)) result[path] = number;
	}
	return result;
}
