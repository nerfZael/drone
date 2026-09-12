import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AgentMessage } from '@mariozechner/pi-agent-core/portable';
import { Type, fauxAssistantMessage, fauxToolCall, registerFauxProvider } from '@mariozechner/pi-ai';
import { pruneToolOutputs } from '../src/pruneToolOutputs';
import { createReadToolOutputTool } from '../src/createReadToolOutputTool';
import { createBlipSession } from '../src/blip-session';
import { SessionStore } from '../src/session-store';
import type { SessionRepository } from '../src/session-repository';
import { readActiveTranscript } from '../src/readActiveTranscript';
import { TOOL_OUTPUT_CHARS, TOOL_BATCH_OUTPUT_CHARS, toolOutputText } from '../src/toolOutputPreview';
import { summaryText } from './helpers/compaction-fixtures';

const output = 'HEAD\n' + 'a'.repeat(8_000) + '\nIMPORTANT MIDDLE\n' + 'b'.repeat(8_000) + '\nTAIL';
function batch(id: string, text: string, tool = 'read_file', args: Record<string, unknown> = {}): AgentMessage[] {
  return [
    fauxAssistantMessage(fauxToolCall(tool, args, { id }), { stopReason: 'toolUse' }),
    { role: 'toolResult', toolCallId: id, toolName: tool, content: [{ type: 'text', text }], isError: false, timestamp: 1 },
  ];
}
function text(message: AgentMessage): string {
  return typeof message.content === 'string' ? message.content : message.content.map((part) => part.type === 'text' ? part.text : '').join('\n');
}
const recent = () => [...batch('recent-1', output), ...batch('recent-2', output)];

describe('recoverable tool output previews', () => {
  test('bounds fresh nested chat results while retaining structured details and raw evidence', () => {
    const data = { turns: [{ prompt: 'Inspect', activity: { messages: [{ role: 'toolResult', content: 'x'.repeat(1_000_000) }] } }] };
    const raw = JSON.stringify(data);
    const messages = batch('chat-call', raw, 'read_chat');
    (messages[1] as any).details = data;
    const projected = pruneToolOutputs(messages);
    expect(text(projected[1]!).length).toBeLessThan(TOOL_OUTPUT_CHARS + 600);
    expect(text(projected[1]!)).toContain('call_id="chat-call"');
    expect(text(projected[1]!)).toContain('offset=18000');
    expect((projected[1] as any).details).toBe(data);
    expect(text(messages[1]!)).toBe(raw);
    expect(projected[0]).toBe(messages[0]);
  });

  test('shares the allowance across a parallel batch, including many individually small results', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `parallel-${i}`);
    const messages: AgentMessage[] = [
      fauxAssistantMessage(ids.map((id) => fauxToolCall('read_file', {}, { id })), { stopReason: 'toolUse' }),
      ...ids.map((id) => batch(id, 'x'.repeat(10_000))[1]!),
    ];
    const projected = pruneToolOutputs(messages);
    const previews = projected.slice(1).map(text);
    expect(previews.every((preview) => preview.includes('read_tool_output'))).toBe(true);
    expect(previews.reduce((total, preview) => total + [...preview.matchAll(/x{2,}/g)].reduce((sum, match) => sum + match[0].length, 0), 0)).toBe(TOOL_BATCH_OUTPUT_CHARS);
    expect(previews.every((preview) => preview.length < 4_600)).toBe(true);
  });

  test('fresh ceiling also covers failures and instructions without suppressing their status', () => {
    for (const details of [{}, { exitCode: 1 }, { timedOut: true }]) {
      const messages = batch('large-error', 'HEAD\n' + 'x'.repeat(90_000) + '\nERROR sentinel', 'read_file');
      (messages[1] as any).details = details;
      (messages[1] as any).isError = true;
      const projected = pruneToolOutputs(messages);
      expect(text(projected[1]!)).toContain('Tool reported failure');
      expect(text(projected[1]!)).toContain('ERROR sentinel');
      expect(text(projected[1]!).length).toBeLessThan(TOOL_OUTPUT_CHARS + 600);
      expect((projected[1] as any).isError).toBe(true);
      expect((projected[1] as any).details).toBe(details);
    }
    const instructions = batch('instructions', '# Instructions\n' + 'x'.repeat(90_000), 'read_skill');
    const preview = text(pruneToolOutputs(instructions)[1]!);
    expect(preview.length).toBeLessThan(TOOL_OUTPUT_CHARS + 600);
    expect(preview).toContain('Read omitted instructions before acting');
  });

  test('bounds mixed text/image output and uses text-only offsets without splitting Unicode', () => {
    const messages = batch('mixed', '😀'.repeat(30_000));
    const result = messages[1] as Extract<AgentMessage, { role: 'toolResult' }>;
    const image = { type: 'image' as const, data: 'original-image', mimeType: 'image/png' };
    result.content.push(image, { type: 'text', text: 'TAIL' });
    const projected = pruneToolOutputs(messages)[1] as typeof result;
    expect(projected.content).toContain(image);
    expect(toolOutputText(projected)).toEndWith('TAIL');
    expect(toolOutputText(projected).length).toBeLessThan(TOOL_OUTPUT_CHARS + 600);
    const preview = toolOutputText(projected);
    expect(JSON.parse(JSON.stringify(preview))).toBe(preview);
    expect(preview).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u);
    expect(toolOutputText(result)).toBe('😀'.repeat(30_000) + '\nTAIL');
  });

  test('marks omissions even when a budget boundary falls between text blocks', () => {
    const messages = batch('boundary', 'a'.repeat(18_000));
    (messages[1] as any).content.push({ type: 'text', text: 'b'.repeat(6_000) });
    expect(text(pruneToolOutputs(messages)[1]!)).toContain('read_tool_output');
  });

  test('shortens only old results, preserves both ends and call pairing, and leaves originals intact', () => {
    const messages = [...batch('old', output), ...recent()];
    const before = structuredClone(messages);
    const projected = pruneToolOutputs(messages);
    expect(text(projected[1]!)).toContain('read_tool_output');
    expect(text(projected[1]!)).toContain('HEAD');
    expect(text(projected[1]!)).toContain('TAIL');
    expect(text(projected[1]!)).not.toContain('IMPORTANT MIDDLE');
    expect(text(projected[1]!).length).toBeLessThan(4_500);
    expect(projected[0]).toBe(messages[0]);
    expect(projected.slice(2)).toEqual(messages.slice(2));
    expect(messages).toEqual(before);
    expect(pruneToolOutputs(messages)).toEqual(projected);
  });

  test('protects errors, images, skills, instruction files, and host-injected results', () => {
    const variants = [
      batch('candidate', output, 'read_skill'),
      batch('candidate', output, 'apply_instructions_patch'),
      batch('candidate', output, 'read_file', { path: 'nested/AGENTS.md' }),
      batch('candidate', output, 'bash', { command: 'cat .agents/skills/test/SKILL.md' }),
      batch('candidate', '# Instructions\n' + output),
      batch('candidate', output, 'read_tool_output'),
    ];
    const error = batch('candidate', output);
    (error[1] as any).isError = true;
    variants.push(error);
    for (const details of [{ exitCode: 1 }, { exit_code: null }, { timedOut: true }, { success: false }]) {
      const failed = batch('candidate', output);
      (failed[1] as any).details = details;
      variants.push(failed);
    }
    const image = batch('candidate', output);
    (image[1] as any).content.push({ type: 'image', data: 'abc', mimeType: 'image/png' });
    variants.push(image);
    for (const candidate of variants) {
      const messages = [...candidate, ...recent()];
      expect(pruneToolOutputs(messages)).toEqual(messages);
    }
    const original = [...batch('candidate', output), ...recent()];
    const injected = structuredClone(original);
    expect(pruneToolOutputs(injected, new Set(original))).toEqual(injected);
  });

  test('retrieves exact omitted text in bounded pages even after compaction, without rerunning tools', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'blip-output-'));
    const store = new SessionStore(workspace);
    const session = await store.create({ provider: 'test', model: 'test', permissionMode: 'read-only', toolProfile: 'read-only' });
    try {
      for (const message of batch('old', output)) await store.appendMessage(session, message);
      await store.appendEntry(session, {
        type: 'compaction', id: 'checkpoint', createdAt: new Date(1).toISOString(), trigger: 'manual',
        tokensBefore: 10_000, summary: 'Earlier output summarized', details: { readFiles: [], modifiedFiles: [] },
      });
      const tool = createReadToolOutputTool(store, session);
      const legacy = { readTranscript: store.readTranscript.bind(store) } as SessionRepository;
      expect(await readActiveTranscript(legacy, session)).toEqual(await store.readTranscript(session));
      const fallback = await createReadToolOutputTool(legacy, session).execute('fallback', { call_id: 'old', offset: 8_000, limit: 100 });
      expect((fallback.content[0] as any).text).toContain('IMPORTANT MIDDLE');
      let recovered = '';
      let offset = 0;
      do {
        const result = await tool.execute('retrieve', { call_id: 'old', offset, limit: 2_001 });
        const body = result.content[0];
        expect(body?.type).toBe('text');
        recovered += (body as any).text.split('\n').slice(1).join('\n');
        offset = result.details.nextOffset;
      } while (offset !== undefined);
      expect(recovered).toBe(output);
      await expect(tool.execute('retrieve', { call_id: 'absent' })).rejects.toThrow('No saved tool output');
      await expect(tool.execute('retrieve', { call_id: 'old', offset: output.length + 1 })).rejects.toThrow('exceeds');
      for (const params of [{ limit: 1_000_000 }, { limit: 0 }, { offset: -1 }, { offset: 0.5 }]) {
        await expect(tool.execute('retrieve', { call_id: 'old', ...params })).rejects.toThrow('integer');
      }
      for (const message of batch('unicode', 'a😀b')) await store.appendMessage(session, message);
      const first = await tool.execute('retrieve', { call_id: 'unicode', limit: 2 });
      expect(first.details).toMatchObject({ offset: 0, end: 1, nextOffset: 1 });
      const second = await tool.execute('retrieve', { call_id: 'unicode', offset: first.details.nextOffset, limit: 2 });
      expect((second.content[0] as any).text.split('\n').at(-1)).toBe('😀');
      expect(second.details).toMatchObject({ end: 3, nextOffset: 3 });
      await expect(tool.execute('retrieve', { call_id: 'unicode', offset: 2 })).rejects.toThrow('splits a Unicode character');
      await expect(tool.execute('retrieve', { call_id: 'unicode', offset: 1, limit: 1 })).rejects.toThrow('limit >= 2');
      const other = await store.create({ provider: 'test', model: 'test', permissionMode: 'read-only', toolProfile: 'read-only' });
      await expect(createReadToolOutputTool(store, other).execute('retrieve', { call_id: 'old' })).rejects.toThrow('No saved');
      await store.delete(other.id);
    } finally { await store.delete(session.id); await rm(workspace, { recursive: true, force: true }); }
  });

  test.each([true, false])('session applies previews=%s to requests and supports recovery', async (enabled) => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'blip-output-loop-'));
    const store = new SessionStore(workspace);
    const faux = registerFauxProvider({ api: `faux-preview-${enabled}`, provider: `faux-preview-${enabled}`, tokensPerSecond: 0 });
    let inspected = false;
    let recovered = false;
    const largeOutput = output + 'x'.repeat(90_000);
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('large', {}, { id: 'original' }), { stopReason: 'toolUse' }),
      (context) => {
        const result = context.messages.find((message) => message.role === 'toolResult' && message.toolCallId === 'original')!;
        expect(text(result).includes('Tool output shortened')).toBe(enabled);
        expect(text(result).length).toBeLessThan(enabled ? TOOL_OUTPUT_CHARS + 600 : largeOutput.length + 1);
        return fauxAssistantMessage(fauxToolCall('small', {}, { id: 'second' }), { stopReason: 'toolUse' });
      },
      fauxAssistantMessage(fauxToolCall('small', {}, { id: 'third' }), { stopReason: 'toolUse' }),
      (context) => {
        const result = context.messages.find((message) => message.role === 'toolResult' && message.toolCallId === 'original')!;
        expect(text(result).includes('Older tool output shortened')).toBe(enabled);
        expect(context.tools?.some((tool) => tool.name === 'read_tool_output')).toBe(enabled);
        inspected = true;
        return enabled ? fauxAssistantMessage(fauxToolCall('read_tool_output', { call_id: 'original', offset: 8_000, limit: 100 }, { id: 'retrieval' }), { stopReason: 'toolUse' }) : fauxAssistantMessage('Done');
      },
      (context) => {
        expect(text(context.messages.at(-1)!)).toContain('IMPORTANT MIDDLE');
        recovered = true;
        return fauxAssistantMessage('Done');
      },
    ]);
    const session = await createBlipSession({
      workspaceRoot: workspace, model: faux.getModel(), permissionMode: 'read-only', toolProfile: 'read-only',
      sessionRepository: store, pruneToolOutputs: enabled,
      tools: ['large', 'small'].map((name) => ({
        name, label: name, description: name, parameters: Type.Object({}),
        execute: async () => ({ content: [{ type: 'text' as const, text: name === 'large' ? largeOutput : 'small output' }], details: {} }),
      })),
    });
    try {
      await session.prompt('Inspect output');
      expect(inspected).toBe(true);
      expect(recovered).toBe(enabled);
      const raw = (await store.readMessages(session.state)).find((message) => message.role === 'toolResult' && message.toolCallId === 'original')!;
      expect(text(raw)).toBe(largeOutput);
      let summaryPrompt = '';
      faux.setResponses([(context) => {
        summaryPrompt = String(context.messages[0].content);
        return fauxAssistantMessage(summaryText('Inspect original output when needed.'));
      }]);
      await session.compact({ auto: true, reserveTokens: 1000, keepRecentTokens: 0, keepRecentTurns: 0 });
      expect(summaryPrompt).not.toBe('');
      expect(summaryPrompt.includes('Older tool output shortened')).toBe(enabled);
      expect(summaryPrompt.length > 90_000).toBe(!enabled);
      const page = await createReadToolOutputTool(store, session.state).execute('after-compaction', {
        call_id: 'original', offset: 8_000, limit: 100,
      });
      expect((page.content[0] as any).text).toContain('IMPORTANT MIDDLE');
    } finally { session.close(); faux.unregister(); await store.delete(session.state.id); await rm(workspace, { recursive: true, force: true }); }
  });
});
