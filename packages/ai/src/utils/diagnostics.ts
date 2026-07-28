export interface DiagnosticErrorInfo {
	name?: string;
	message: string;
	stack?: string;
	code?: string | number;
	cause?: DiagnosticErrorInfo;
}

export interface AssistantMessageDiagnostic {
	type: string;
	timestamp: number;
	error?: DiagnosticErrorInfo;
	details?: Record<string, unknown>;
}

export function formatThrownValue(value: unknown): string {
	if (value instanceof Error) return value.message || value.name;
	if (typeof value === "string") return value;
	return String(value);
}

function extractDiagnosticErrorWithDepth(
	error: unknown,
	depth: number,
	seen: Set<unknown>,
): DiagnosticErrorInfo {
	if (!(error instanceof Error)) return { name: "ThrownValue", message: formatThrownValue(error) };
	if (seen.has(error)) {
		return { name: error.name || undefined, message: error.message || error.name };
	}
	seen.add(error);
	const code = (error as Error & { code?: unknown }).code;
	const cause = (error as Error & { cause?: unknown }).cause;
	return {
		name: error.name || undefined,
		message: error.message || error.name,
		stack: error.stack,
		code: typeof code === "string" || typeof code === "number" ? code : undefined,
		...(depth < 3 && cause !== undefined
			? { cause: extractDiagnosticErrorWithDepth(cause, depth + 1, seen) }
			: {}),
	};
}

export function extractDiagnosticError(error: unknown): DiagnosticErrorInfo {
	return extractDiagnosticErrorWithDepth(error, 0, new Set());
}

export function createAssistantMessageDiagnostic(
	type: string,
	error: unknown,
	details?: Record<string, unknown>,
): AssistantMessageDiagnostic {
	return { type, timestamp: Date.now(), error: extractDiagnosticError(error), details };
}

export function appendAssistantMessageDiagnostic<T extends { diagnostics?: AssistantMessageDiagnostic[] }>(
	message: T,
	diagnostic: AssistantMessageDiagnostic,
): void {
	message.diagnostics = [...(message.diagnostics ?? []), diagnostic];
}
