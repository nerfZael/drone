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
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('large', {}, { id: 'original' }), { stopReason: 'toolUse' }),
      fauxAssistantMessage(fauxToolCall('small', {}, { id: 'second' }), { stopReason: 'toolUse' }),
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
        execute: async () => ({ content: [{ type: 'text' as const, text: name === 'large' ? output : 'small output' }], details: {} }),
      })),
    });
    try {
      await session.prompt('Inspect output');
      expect(inspected).toBe(true);
      expect(recovered).toBe(enabled);
      const raw = (await store.readMessages(session.state)).find((message) => message.role === 'toolResult' && message.toolCallId === 'original')!;
      expect(text(raw)).toBe(output);
    } finally { session.close(); faux.unregister(); await store.delete(session.state.id); await rm(workspace, { recursive: true, force: true }); }
  });
});
