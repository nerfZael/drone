function eventFromChunk(chunk: string): any | null {
  const data = chunk
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('\n')
    .trim();
  if (!data || data === '[DONE]') return null;
  try {
    return JSON.parse(data);
  } catch {
    throw new Error('Codex returned malformed streaming data');
  }
}

function streamedText(events: any[], deltaType: string, doneType: string): string {
  const deltas = events
    .filter((event) => event?.type === deltaType)
    .map((event) => String(event?.delta ?? ''))
    .join('');
  if (deltas) return deltas;
  const done = [...events].reverse().find((event) => event?.type === doneType);
  return String(done?.text ?? '');
}

function responseHasTextOutput(output: any[]): boolean {
  return output.some(
    (item) =>
      item?.type === 'message' &&
      Array.isArray(item.content) &&
      item.content.some((part: any) => String(part?.text ?? part?.refusal ?? '').trim()),
  );
}

function responseHasReasoningSummary(output: any[]): boolean {
  return output.some(
    (item) =>
      item?.type === 'reasoning' &&
      Array.isArray(item.summary) &&
      item.summary.some((part: any) => String(part?.text ?? '').trim()),
  );
}

function completedOutputItems(events: any[]): any[] {
  return events.flatMap((event) =>
    event?.type === 'response.output_item.done' && event.item ? [event.item] : [],
  );
}

function hasOutputItem(output: any[], item: any): boolean {
  const id = String(item?.id ?? '').trim();
  if (id && output.some((candidate) => String(candidate?.id ?? '').trim() === id)) return true;
  if (item?.type === 'function_call') {
    const callId = String(item.call_id ?? '').trim();
    return Boolean(
      callId &&
        output.some(
          (candidate) =>
            candidate?.type === 'function_call' &&
            String(candidate.call_id ?? '').trim() === callId,
        ),
    );
  }
  return false;
}

function hydrateSparseCompletedResponse(response: any, events: any[]): any {
  const completedItems = completedOutputItems(events);
  const output = [...(Array.isArray(response?.output) ? response.output : [])];
  for (const item of completedItems) {
    if (!hasOutputItem(output, item)) output.push(item);
  }
  const text = streamedText(
    events,
    'response.output_text.delta',
    'response.output_text.done',
  ).slice(0, 48_000);
  const reasoning = streamedText(
    events,
    'response.reasoning_summary_text.delta',
    'response.reasoning_summary_text.done',
  ).slice(0, 48_000);
  const additions: any[] = [];
  if (reasoning && !responseHasReasoningSummary(output)) {
    additions.push({
      type: 'reasoning',
      summary: [{ type: 'summary_text', text: reasoning }],
    });
  }
  if (text && !responseHasTextOutput(output)) {
    additions.push({
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text, annotations: [] }],
    });
  }
  return completedItems.length > 0 || additions.length > 0
    ? { ...response, output: [...output, ...additions] }
    : response;
}

function completedResponse(events: any[]): any {
  let completed: any = null;
  for (const event of events) {
    if (event?.type === 'error')
      throw new Error(String(event.message ?? event.code ?? 'Codex request failed'));
    if (event?.type === 'response.failed')
      throw new Error(String(event.response?.error?.message ?? 'Codex response failed'));
    if (
      event?.type === 'response.completed' ||
      event?.type === 'response.done' ||
      event?.type === 'response.incomplete'
    )
      completed = event.response;
  }
  if (!completed) throw new Error('Codex returned no completed response');
  if (completed.status === 'failed' || completed.status === 'cancelled')
    throw new Error(String(completed.error?.message ?? 'Codex response failed'));
  return hydrateSparseCompletedResponse(completed, events);
}

export function parseCodexSseResponse(raw: string): any {
  const events = raw.replace(/\r\n/g, '\n').split('\n\n').map(eventFromChunk).filter(Boolean);
  return completedResponse(events);
}

export async function consumeCodexSseResponse(
  response: Response,
  onEvent?: (event: any) => Promise<void> | void,
): Promise<any> {
  const reader = response.body?.getReader();
  if (!reader) {
    const raw = await response.text();
    const events = raw.replace(/\r\n/g, '\n').split('\n\n').map(eventFromChunk).filter(Boolean);
    for (const event of events) await onEvent?.(event);
    return completedResponse(events);
  }

  const decoder = new TextDecoder();
  const events: any[] = [];
  let buffer = '';
  const consumeReadyChunks = async () => {
    buffer = buffer.replace(/\r\n/g, '\n');
    for (;;) {
      const boundary = buffer.indexOf('\n\n');
      if (boundary < 0) return;
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = eventFromChunk(chunk);
      if (!event) continue;
      events.push(event);
      await onEvent?.(event);
    }
  };

  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    await consumeReadyChunks();
  }
  buffer += decoder.decode();
  await consumeReadyChunks();
  const finalEvent = eventFromChunk(buffer);
  if (finalEvent) {
    events.push(finalEvent);
    await onEvent?.(finalEvent);
  }
  return completedResponse(events);
}
