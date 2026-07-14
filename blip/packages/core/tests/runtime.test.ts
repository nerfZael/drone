import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from '@mariozechner/pi-ai';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import {
  createLocalCompaction,
  estimateEntriesTokens,
  estimateModelContextTokens,
} from '../src/index';
import { compactSession, runBlipTask, SessionStore } from '../src/node';

process.env.BLIP_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'blip-core-data-'));

async function tempWorkspace(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'blip-core-'));
}

function user(content: string): AgentMessage {
  return { role: 'user', content, timestamp: Date.now() };
}

function assistant(content: string): AgentMessage {
  return fauxAssistantMessage(content);
}

describe('Blip runtime', () => {
  test('runs a faux tool loop and persists a session', async () => {
    const workspace = await tempWorkspace();
    await writeFile(path.join(workspace, 'hello.txt'), 'hello blip\n');
    const faux = registerFauxProvider({ api: 'faux', provider: 'faux', tokensPerSecond: 0 });
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('read_file', { path: 'hello.txt' }, { id: 'call_read' }), {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage('I read hello.txt.'),
    ]);

    const events: string[] = [];
    const assistantMessages: string[] = [];
    const session = await runBlipTask(
      {
        prompt: 'Read hello.txt',
        workspaceRoot: workspace,
        provider: 'faux',
        model: faux.getModel().id,
        permissionMode: 'workspace-write',
        toolProfile: 'no-shell-workspace-write',
      },
      (event) => {
        events.push(event.type);
        if (event.type === 'assistant_message') assistantMessages.push(event.text);
      },
    );

    expect(events).toContain('tool_call_started');
    expect(events).toContain('tool_call_completed');
    expect(assistantMessages).toEqual(['I read hello.txt.']);
    expect(assistantMessages.join('\n')).not.toContain('[tool:');
    expect(session.readFiles).toEqual(['hello.txt']);
    const transcript = await readFile(session.transcriptPath, 'utf8');
    expect(transcript).toContain('I read hello.txt.');
    faux.unregister();
  });

  test('executes parallel-safe tool batches concurrently', async () => {
    const workspace = await tempWorkspace();
    await writeFile(path.join(workspace, 'alpha.txt'), 'alpha\n');
    await writeFile(path.join(workspace, 'beta.txt'), 'beta\n');
    const faux = registerFauxProvider({ api: 'faux', provider: 'faux', tokensPerSecond: 0 });
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall('read_file', { path: 'alpha.txt' }, { id: 'call_alpha' }),
          fauxToolCall('read_file', { path: 'beta.txt' }, { id: 'call_beta' }),
        ],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('I read both files.'),
    ]);

    const toolEvents: Array<{ type: string; callId: string }> = [];
    let finishedEvent: any;
    const session = await runBlipTask(
      {
        prompt: 'Read both files',
        workspaceRoot: workspace,
        provider: 'faux',
        model: faux.getModel().id,
        permissionMode: 'workspace-write',
        toolProfile: 'no-shell-workspace-write',
      },
      (event) => {
        if (event.type === 'tool_call_started' || event.type === 'tool_call_completed') {
          toolEvents.push({ type: event.type, callId: event.callId });
        }
        if (event.type === 'session_finished') finishedEvent = event;
      },
    );

    expect(toolEvents.slice(0, 2)).toEqual([
      { type: 'tool_call_started', callId: 'call_alpha' },
      { type: 'tool_call_started', callId: 'call_beta' },
    ]);
    expect(toolEvents.map((event) => event.type)).toEqual([
      'tool_call_started',
      'tool_call_started',
      'tool_call_completed',
      'tool_call_completed',
    ]);
    expect(session.readFiles).toEqual(['alpha.txt', 'beta.txt']);
    expect(finishedEvent.timing).toEqual(
      expect.objectContaining({
        toolCallCount: 2,
        toolCallCompletedCount: 2,
        toolCallFailedCount: 0,
        toolTurnCount: 1,
        singleToolTurnCount: 0,
        parallelToolTurnCount: 1,
        maxToolsInTurn: 2,
      }),
    );
    expect(finishedEvent.timing.toolCallsByName.read_file).toEqual(
      expect.objectContaining({
        count: 2,
        completed: 2,
        failed: 0,
      }),
    );
    expect(finishedEvent.contextUsage).toEqual(
      expect.objectContaining({
        contextWindow: faux.getModel().contextWindow,
      }),
    );
    expect(finishedEvent.contextUsage.tokens).toBeGreaterThan(0);
    expect(finishedEvent.contextUsage.percent).toBeGreaterThan(0);
    faux.unregister();
  });

  test('executes bash tool batches concurrently', async () => {
    const workspace = await tempWorkspace();
    const faux = registerFauxProvider({ api: 'faux', provider: 'faux', tokensPerSecond: 0 });
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall('bash', { command: 'sleep 0.4 && echo alpha' }, { id: 'call_alpha' }),
          fauxToolCall('bash', { command: 'sleep 0.4 && echo beta' }, { id: 'call_beta' }),
        ],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('I ran both commands.'),
    ]);

    const toolEvents: Array<{ type: string; callId: string }> = [];
    const startedAt = Date.now();
    await runBlipTask(
      {
        prompt: 'Run both commands',
        workspaceRoot: workspace,
        provider: 'faux',
        model: faux.getModel().id,
        permissionMode: 'workspace-write',
        toolProfile: 'local-trusted-write',
      },
      (event) => {
        if (event.type === 'tool_call_started' || event.type === 'tool_call_completed') {
          toolEvents.push({ type: event.type, callId: event.callId });
        }
      },
    );
    const durationMs = Date.now() - startedAt;

    expect(durationMs).toBeLessThan(750);
    expect(toolEvents.filter((event) => event.type === 'tool_call_completed')).toHaveLength(2);
    faux.unregister();
  });

  test('records non-zero bash exits as recovered tool failures', async () => {
    const workspace = await tempWorkspace();
    const faux = registerFauxProvider({ api: 'faux', provider: 'faux', tokensPerSecond: 0 });
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall('bash', { command: 'echo nope >&2; exit 2' }, { id: 'call_bash_fail' }),
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('Recovered after bash failed.'),
    ]);

    const events: any[] = [];
    await runBlipTask(
      {
        prompt: 'Run a failing command and recover',
        workspaceRoot: workspace,
        provider: 'faux',
        model: faux.getModel().id,
        permissionMode: 'workspace-write',
        toolProfile: 'local-trusted-write',
      },
      (event) => events.push(event),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'tool_call_failed',
        callId: 'call_bash_fail',
        tool: 'bash',
        error: expect.stringContaining('bash exited with code 2'),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'session_finished',
        status: 'completed',
        toolFailures: [
          expect.objectContaining({
            callId: 'call_bash_fail',
            tool: 'bash',
            error: expect.stringContaining('exitCode: 2'),
          }),
        ],
        timing: expect.objectContaining({
          toolCallCompletedCount: 0,
          toolCallFailedCount: 1,
          toolCallsByName: expect.objectContaining({
            bash: expect.objectContaining({ count: 1, completed: 0, failed: 1 }),
          }),
        }),
      }),
    );
    faux.unregister();
  });

  test('executes independent mutation tool batches successfully', async () => {
    const workspace = await tempWorkspace();
    const faux = registerFauxProvider({ api: 'faux', provider: 'faux', tokensPerSecond: 0 });
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall(
            'write_file',
            { path: 'alpha.txt', content: 'alpha\n', mode: 'create' },
            { id: 'call_alpha' },
          ),
          fauxToolCall(
            'write_file',
            { path: 'beta.txt', content: 'beta\n', mode: 'create' },
            { id: 'call_beta' },
          ),
        ],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('I wrote both files.'),
    ]);

    const session = await runBlipTask({
      prompt: 'Write both files',
      workspaceRoot: workspace,
      provider: 'faux',
      model: faux.getModel().id,
      permissionMode: 'workspace-write',
      toolProfile: 'no-shell-workspace-write',
    });

    expect(session.changedFiles).toEqual(['alpha.txt', 'beta.txt']);
    expect(await readFile(path.join(workspace, 'alpha.txt'), 'utf8')).toBe('alpha\n');
    expect(await readFile(path.join(workspace, 'beta.txt'), 'utf8')).toBe('beta\n');
    faux.unregister();
  });

  test('includes newly untracked git files created by bash in changed files', async () => {
    const workspace = await tempWorkspace();
    execFileSync('git', ['init'], { cwd: workspace, stdio: 'ignore' });
    const faux = registerFauxProvider({ api: 'faux', provider: 'faux', tokensPerSecond: 0 });
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall('bash', { command: "printf 'hello\\n' > created.txt" }, { id: 'call_create' }),
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('I created the file.'),
    ]);

    const session = await runBlipTask({
      prompt: 'Create an untracked file',
      workspaceRoot: workspace,
      provider: 'faux',
      model: faux.getModel().id,
      permissionMode: 'workspace-write',
      toolProfile: 'local-trusted-write',
    });

    expect(session.changedFiles).toContain('created.txt');
    expect(await readFile(path.join(workspace, 'created.txt'), 'utf8')).toBe('hello\n');
    faux.unregister();
  });

  test('surfaces assistant error messages in runtime events', async () => {
    const workspace = await tempWorkspace();
    const faux = registerFauxProvider({ api: 'faux', provider: 'faux', tokensPerSecond: 0 });
    faux.setResponses([
      fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'Codex auth token expired' }),
    ]);

    const events: Array<{ type: string; error?: string; status?: string }> = [];
    await runBlipTask(
      {
        prompt: 'Say hi',
        workspaceRoot: workspace,
        provider: 'faux',
        model: faux.getModel().id,
        permissionMode: 'workspace-write',
        toolProfile: 'no-shell-workspace-write',
      },
      (event) => events.push(event),
    );

    expect(events).toContainEqual(
      expect.objectContaining({ type: 'session_error', error: 'Codex auth token expired' }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'session_finished',
        status: 'error',
        error: 'Codex auth token expired',
      }),
    );
    faux.unregister();
  });

  test('keeps recovered tool failures separate from final session status', async () => {
    const workspace = await tempWorkspace();
    const faux = registerFauxProvider({ api: 'faux', provider: 'faux', tokensPerSecond: 0 });
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall('read_file', { path: 'missing.txt' }, { id: 'call_missing' }),
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('Recovered after the missing file.'),
    ]);

    const events: any[] = [];
    await runBlipTask(
      {
        prompt: 'Read missing.txt and recover',
        workspaceRoot: workspace,
        provider: 'faux',
        model: faux.getModel().id,
        permissionMode: 'workspace-write',
        toolProfile: 'no-shell-workspace-write',
      },
      (event) => events.push(event),
    );

    expect(events).toContainEqual(
      expect.objectContaining({ type: 'tool_call_failed', tool: 'read_file' }),
    );
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'session_error' }));
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'session_finished',
        status: 'completed',
        toolFailures: [expect.objectContaining({ callId: 'call_missing', tool: 'read_file' })],
      }),
    );
    faux.unregister();
  });

  test('emits opt-in process diagnostics after session finish if process remains alive', async () => {
    const workspace = await tempWorkspace();
    const faux = registerFauxProvider({ api: 'faux', provider: 'faux', tokensPerSecond: 0 });
    faux.setResponses([fauxAssistantMessage('done')]);

    const events: any[] = [];
    await runBlipTask(
      {
        prompt: 'Say done',
        workspaceRoot: workspace,
        provider: 'faux',
        model: faux.getModel().id,
        permissionMode: 'workspace-write',
        toolProfile: 'no-shell-workspace-write',
        processExitDiagnosticsDelayMs: 5,
      },
      (event) => events.push(event),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'process_diagnostics',
        reason: expect.stringContaining('process still alive'),
        activeHandles: expect.any(Array),
        activeRequests: expect.any(Array),
      }),
    );
    faux.unregister();
  });

  test('reconstructs model context as compaction summary plus retained tail', async () => {
    const workspace = await tempWorkspace();
    const store = new SessionStore(workspace);
    const session = await store.create({
      provider: 'faux',
      model: 'faux-1',
      permissionMode: 'workspace-write',
      toolProfile: 'no-shell-workspace-write',
    });
    await store.appendMessage(session, user('old request'));
    await store.appendMessage(session, assistant('old response'));
    await store.appendMessage(session, user('recent request'));
    await store.appendMessage(session, assistant('recent response'));

    const compaction = createLocalCompaction({
      session,
      entries: await store.readTranscript(session),
      trigger: 'manual',
      settings: { auto: true, reserveTokens: 10, keepRecentTokens: 1, keepRecentTurns: 1 },
    });
    expect(compaction).toBeDefined();
    await store.appendEntry(session, compaction!);
    session.compactedSummary = compaction!.summary;
    await store.save(session);

    const messages = await store.readModelMessages(session);
    expect(
      messages.map((message) => (message.role === 'user' ? message.content : '')),
    ).not.toContain('old request');
    expect(messages[0]?.role).toBe('user');
    expect(messages[0]?.role === 'user' ? messages[0].content : '').toContain(
      'Summary of earlier conversation:',
    );
    expect(messages.map((message) => (message.role === 'user' ? message.content : ''))).toContain(
      'recent request',
    );
  });

  test('falls back to raw messages when a compaction boundary is missing', async () => {
    const workspace = await tempWorkspace();
    const store = new SessionStore(workspace);
    const session = await store.create({
      provider: 'faux',
      model: 'faux-1',
      permissionMode: 'workspace-write',
      toolProfile: 'no-shell-workspace-write',
    });
    await store.appendMessage(session, user('old request'));
    await store.appendMessage(session, assistant('old response'));
    await store.appendEntry(session, {
      type: 'compaction',
      id: 'cmp_bad',
      createdAt: new Date().toISOString(),
      trigger: 'manual',
      tokensBefore: 100,
      tokensAfterEstimate: 10,
      firstKeptEntryId: 'missing',
      summary: 'bad boundary',
      details: { readFiles: [], modifiedFiles: [] },
    });
    await store.appendMessage(session, user('recent request'));

    const messages = await store.readModelMessages(session);
    expect(messages.map((message) => (message.role === 'user' ? message.content : ''))).toContain(
      'old request',
    );
    expect(messages[0]?.role === 'user' ? messages[0].content : '').not.toContain(
      'Summary of earlier conversation:',
    );
  });

  test('estimates context from latest assistant usage plus trailing messages', () => {
    const first = assistant('first') as AgentMessage & { role: 'assistant' };
    first.usage = { ...first.usage, totalTokens: 1_000 };
    const second = assistant('second') as AgentMessage & { role: 'assistant' };
    second.usage = { ...second.usage, totalTokens: 2_000 };
    const entries = [
      {
        type: 'message' as const,
        id: 'u1',
        timestamp: new Date().toISOString(),
        message: user('old ' + 'x'.repeat(10_000)),
      },
      { type: 'message' as const, id: 'a1', timestamp: new Date().toISOString(), message: first },
      {
        type: 'message' as const,
        id: 'u2',
        timestamp: new Date().toISOString(),
        message: user('middle'),
      },
      { type: 'message' as const, id: 'a2', timestamp: new Date().toISOString(), message: second },
      {
        type: 'message' as const,
        id: 'u3',
        timestamp: new Date().toISOString(),
        message: user('tail'),
      },
    ];

    const rawEstimate = estimateEntriesTokens(entries);
    expect(rawEstimate).toBeGreaterThan(2_000);
    expect(rawEstimate).toBeLessThan(2_100);

    const compactedEstimate = estimateModelContextTokens([
      ...entries,
      {
        type: 'compaction' as const,
        id: 'cmp',
        createdAt: new Date().toISOString(),
        trigger: 'manual' as const,
        tokensBefore: 2_000,
        tokensAfterEstimate: 10,
        firstKeptEntryId: 'u3',
        summary: 'short summary',
        details: { readFiles: [], modifiedFiles: [] },
      },
    ]);
    expect(compactedEstimate).toBeLessThan(100);
  });

  test('manual compaction uses model summary and stores retained boundary', async () => {
    const workspace = await tempWorkspace();
    const faux = registerFauxProvider({ api: 'faux', provider: 'faux', tokensPerSecond: 0 });
    faux.setResponses([fauxAssistantMessage('## Goal\n- Model summary')]);
    const store = new SessionStore(workspace);
    const session = await store.create({
      provider: 'faux',
      model: faux.getModel().id,
      permissionMode: 'workspace-write',
      toolProfile: 'no-shell-workspace-write',
    });
    await store.appendMessage(session, user('old request'));
    await store.appendMessage(session, assistant('old response'));
    await store.appendMessage(session, user('recent request'));
    await store.appendMessage(session, assistant('recent response'));

    await compactSession({
      workspaceRoot: workspace,
      sessionId: session.id,
      trigger: 'manual',
      settings: { auto: true, reserveTokens: 10, keepRecentTokens: 1, keepRecentTurns: 1 },
    });

    const transcript = await store.readTranscript(session);
    const compaction = transcript.find((entry) => entry.type === 'compaction');
    expect(compaction?.type === 'compaction' ? compaction.summary : '').toContain('Model summary');
    const messages = await store.readModelMessages(await store.load(session.id));
    expect(
      messages.map((message) => (message.role === 'user' ? message.content : '')),
    ).not.toContain('old request');
    expect(messages.map((message) => (message.role === 'user' ? message.content : ''))).toContain(
      'recent request',
    );
    faux.unregister();
  });

  test('repeated compaction updates the summary and advances the retained tail', async () => {
    const workspace = await tempWorkspace();
    const faux = registerFauxProvider({ api: 'faux', provider: 'faux', tokensPerSecond: 0 });
    faux.setResponses([
      fauxAssistantMessage('## Goal\n- First summary'),
      fauxAssistantMessage('## Goal\n- Updated summary'),
    ]);
    const store = new SessionStore(workspace);
    const session = await store.create({
      provider: 'faux',
      model: faux.getModel().id,
      permissionMode: 'workspace-write',
      toolProfile: 'no-shell-workspace-write',
    });
    await store.appendMessage(session, user('turn one'));
    await store.appendMessage(session, assistant('turn one done'));
    await store.appendMessage(session, user('turn two'));
    await store.appendMessage(session, assistant('turn two done'));

    await compactSession({
      workspaceRoot: workspace,
      sessionId: session.id,
      trigger: 'manual',
      settings: { auto: true, reserveTokens: 10, keepRecentTokens: 1, keepRecentTurns: 1 },
    });
    await store.appendMessage(await store.load(session.id), user('turn three'));
    await compactSession({
      workspaceRoot: workspace,
      sessionId: session.id,
      trigger: 'manual',
      settings: { auto: true, reserveTokens: 10, keepRecentTokens: 1, keepRecentTurns: 1 },
    });

    const loaded = await store.load(session.id);
    const messages = await store.readModelMessages(loaded);
    const userTexts = messages.map((message) => (message.role === 'user' ? message.content : ''));
    expect(userTexts[0]).toContain('Updated summary');
    expect(userTexts).not.toContain('turn one');
    expect(userTexts).not.toContain('turn two');
    expect(userTexts).toContain('turn three');
    const compactions = (await store.readTranscript(loaded)).filter(
      (entry) => entry.type === 'compaction',
    );
    expect(compactions).toHaveLength(2);
    faux.unregister();
  });

  test('auto compacts before a run when context exceeds the model window', async () => {
    const workspace = await tempWorkspace();
    const faux = registerFauxProvider({ api: 'faux', provider: 'faux', tokensPerSecond: 0 });
    faux.setResponses([
      fauxAssistantMessage('## Goal\n- Auto summary'),
      fauxAssistantMessage('continued'),
    ]);
    const store = new SessionStore(workspace);
    const session = await store.create({
      provider: 'faux',
      model: faux.getModel().id,
      permissionMode: 'workspace-write',
      toolProfile: 'no-shell-workspace-write',
    });
    await store.appendMessage(session, user('old ' + 'x'.repeat(600_000)));
    await store.appendMessage(session, assistant('old response'));
    await store.appendMessage(session, user('middle request'));
    await store.appendMessage(session, assistant('middle response'));
    await store.appendMessage(session, user('recent request'));

    const events: string[] = [];
    await runBlipTask(
      {
        prompt: 'continue',
        workspaceRoot: workspace,
        provider: 'faux',
        model: faux.getModel().id,
        permissionMode: 'workspace-write',
        toolProfile: 'no-shell-workspace-write',
        sessionId: session.id,
      },
      (event) => events.push(event.type),
    );

    expect(events).toContain('compaction_completed');
    const transcript = await store.readTranscript(session);
    expect(transcript.some((entry) => entry.type === 'compaction')).toBe(true);

    events.length = 0;
    faux.setResponses([fauxAssistantMessage('continued again')]);
    await runBlipTask(
      {
        prompt: 'continue again',
        workspaceRoot: workspace,
        provider: 'faux',
        model: faux.getModel().id,
        permissionMode: 'workspace-write',
        toolProfile: 'no-shell-workspace-write',
        sessionId: session.id,
      },
      (event) => events.push(event.type),
    );
    expect(events).not.toContain('compaction_started');
    faux.unregister();
  });
});
