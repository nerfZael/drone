import { afterEach, describe, expect, test } from 'bun:test';
import path from 'node:path';

import {
  assistantProviderSessionId,
  assistantRealtimeSessionConfig,
  assistantSnapshot,
  promptAssistantThread,
  resolveAssistantApproval,
  sanitizeArtifactPath,
  setAssistantExecutionTargetProvider,
  setAssistantExternalToolApprovalEvaluator,
  setAssistantExternalToolExecutor,
} from './assistant-parity.js';
import { extensionToolName } from './assistant-extensions.js';
import { VoiceStreamNextDb } from './db.js';

function tempDb(name: string): VoiceStreamNextDb {
  const dir = path.join(process.cwd(), 'server', 'data', 'tests');
  return new VoiceStreamNextDb(path.join(dir, `${name}-${crypto.randomUUID()}.sqlite`));
}

function testUser(db: VoiceStreamNextDb) {
  return db.upsertUser({
    clerkUserId: `clerk_${crypto.randomUUID()}`,
    displayName: 'Assistant User',
    email: 'assistant@example.local',
    admin: false,
  });
}

describe('assistant parity runtime', () => {
  const dbs: VoiceStreamNextDb[] = [];
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    for (const db of dbs) db.db.close();
    dbs.length = 0;
    delete process.env.VOICE_STREAM_NEXT_TEST_MODEL_TOOL_CALLS;
    delete process.env.VOICE_STREAM_NEXT_SECRETS_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.VOICE_STREAM_NEXT_OPENAI_API_KEY;
    setAssistantExternalToolApprovalEvaluator(null);
    setAssistantExternalToolExecutor(null);
    setAssistantExecutionTargetProvider(null);
    globalThis.fetch = originalFetch;
  });

  test('uses provider session ids that fit prompt cache key limits', () => {
    const sessionId = assistantProviderSessionId(
      'usr_7685a53fc3a6461b9257b775ad0db9b6',
      'thr_d25719c89846407d8888a0bce6dd1539',
    );

    expect(sessionId.length).toBeLessThanOrEqual(64);
    expect(sessionId).not.toContain('thr_d25719c89846407d8888a0bce6dd1539');
  });

  test('writes assistant artifacts without approval', async () => {
    const db = tempDb('assistant-artifacts');
    dbs.push(db);
    const user = testUser(db);
    const thread = db.createThread(user.id, { title: 'Artifacts' });
    const events: unknown[] = [];

    const snapshot = await promptAssistantThread(
      db,
      user.id,
      thread.id,
      { prompt: '/artifact write notes/todo.md\n- first task' },
      (event) => events.push(event),
    );

    const artifact = db.readArtifact(user.id, thread.id, 'notes/todo.md');
    expect(artifact?.content).toBe('- first task');
    expect(snapshot.threads[0]?.artifactsCount).toBe(1);
    expect(db.listApprovals(user.id, thread.id)).toHaveLength(0);
    expect(events.some((event: any) => event.type === 'done')).toBe(true);
  });

  test('requires approval before changing a thread system prompt', async () => {
    const db = tempDb('assistant-approval');
    dbs.push(db);
    const user = testUser(db);
    const thread = db.createThread(user.id, { title: 'Approvals' });

    const waiting = await promptAssistantThread(
      db,
      user.id,
      thread.id,
      { prompt: '/system-prompt Keep answers in bullet form.' },
      () => undefined,
    );

    expect(waiting.pendingApprovals).toHaveLength(1);
    expect(db.thread(user.id, thread.id)?.status).toBe('waiting_for_approval');
    expect(db.thread(user.id, thread.id)?.systemPrompt).toBeNull();

    const approved = await resolveAssistantApproval(db, user.id, waiting.pendingApprovals[0]!.id, true, 'test');

    expect(db.thread(user.id, thread.id)?.systemPrompt).toBe('Keep answers in bullet form.');
    expect(approved.pendingApprovals).toHaveLength(0);
    expect(db.thread(user.id, thread.id)?.status).toBe('idle');
    expect(db.listMessages(user.id, thread.id).some((message) => message.role === 'toolResult')).toBe(true);
  });

  test('persists thread model controls', () => {
    const db = tempDb('assistant-models');
    dbs.push(db);
    const user = testUser(db);
    const thread = db.createThread(user.id, { title: 'Models' });
    const snapshot = assistantSnapshot(db, user.id);

    expect(thread.provider).toBe('openai');
    expect(thread.model).toBe('chat-latest');
    expect(snapshot.assistantSettings.defaultModel).toBe('chat-latest');
    expect(snapshot.models).toContainEqual({ provider: 'openai', id: 'chat-latest', name: 'Chat Latest Instant', thinkingLevel: 'off' });
    expect(snapshot.models).toContainEqual({ provider: 'openai', id: 'gpt-5.5', name: 'GPT-5.5 None', thinkingLevel: 'off' });
    expect(db.createThread(user.id, { title: 'Codex default', provider: 'codex' }).model).toBe('gpt-5.5');
    expect(db.updateAssistantSettings(user.id, { defaultProvider: 'codex' }).defaultModel).toBe('gpt-5.5');

    const updated = db.updateThread(user.id, thread.id, {
      provider: 'codex',
      model: 'gpt-5.5',
      thinkingLevel: 'high',
      promptDeliveryMode: 'asap',
      voiceEnabled: true,
    });

    expect(updated?.provider).toBe('codex');
    expect(updated?.model).toBe('gpt-5.5');
    expect(updated?.thinkingLevel).toBe('high');
    expect(updated?.promptDeliveryMode).toBe('asap');
    expect(updated?.voiceEnabled).toBe(true);
  });

  test('uses assistant settings for new thread default tools', () => {
    const db = tempDb('assistant-default-tools');
    dbs.push(db);
    const user = testUser(db);

    db.updateAssistantSettings(user.id, { defaultEnabledTools: ['speak', 'web_search'] });
    const thread = db.createThread(user.id, { title: 'Defaults' });

    expect(thread.enabledTools).toEqual(['speak', 'web_search']);
  });

  test('uses assistant profile hands-free defaults for new threads', () => {
    const db = tempDb('assistant-hands-free-default');
    dbs.push(db);
    const user = testUser(db);
    const profile = db.createAssistantProfile(user.id, {
      name: 'Hands Free',
      wakePhrase: 'hey handsfree',
      ttsVoice: 'diana',
      defaultHandsFreeMode: true,
    });

    const thread = db.createThread(user.id, { title: 'Hands-free default', assistantProfileId: profile.id });
    const updated = db.updateThread(user.id, thread.id, { handsFreeMode: false });

    expect(thread.handsFreeMode).toBe(true);
    expect(updated?.handsFreeMode).toBe(false);
  });

  test('stores assistant skills and exposes them in snapshots', () => {
    const db = tempDb('assistant-skills');
    dbs.push(db);
    const user = testUser(db);

    const skill = db.createAssistantSkill(user.id, {
      name: 'Research',
      description: 'Use for current web research.',
      markdownBody: 'Search first, then fetch the best source.',
      toolNames: ['web_search', 'fetch_content', 'web_search'],
    });
    const updated = db.updateAssistantSkill(user.id, skill.id, {
      description: 'Use for source-backed current web research.',
      toolNames: 'web_search fetch_content',
    });

    expect(updated?.slug).toBe('research');
    expect(updated?.toolNames).toEqual(['web_search', 'fetch_content']);
    expect(db.assistantSkillByName(user.id, 'Research')?.id).toBe(skill.id);
    expect(assistantSnapshot(db, user.id).skills[0]?.description).toBe('Use for source-backed current web research.');
  });

  test('load_skill persists skill tools for the thread', async () => {
    const db = tempDb('assistant-load-skill');
    dbs.push(db);
    const user = testUser(db);
    db.createAssistantSkill(user.id, {
      name: 'Research',
      description: 'Use for source-backed current web research.',
      markdownBody: 'Search first, then fetch the best source.',
      toolNames: ['web_search', 'fetch_content'],
    });
    const thread = db.createThread(user.id, { title: 'Skill loading', enabledTools: ['load_skill'] });
    process.env.VOICE_STREAM_NEXT_TEST_MODEL_TOOL_CALLS = JSON.stringify([
      { name: 'load_skill', arguments: { skill: 'research' } },
    ]);

    await promptAssistantThread(db, user.id, thread.id, { prompt: 'Research this.' }, () => undefined);

    const toolCall = db.listToolCalls(user.id, thread.id)[0];
    expect(toolCall?.toolName).toBe('load_skill');
    expect(toolCall?.status).toBe('completed');
    const result = JSON.parse(toolCall?.resultJson || '{}');
    expect(result.toolNames).toEqual(['web_search', 'fetch_content']);
    expect(result.content).toContain('Search first, then fetch the best source.');
    expect(db.listThreadSkills(user.id, thread.id).map((skill) => skill.slug)).toEqual(['research']);
    expect(assistantSnapshot(db, user.id, thread.id).threads.find((item) => item.id === thread.id)?.loadedSkills).toEqual([
      { id: result.id, slug: 'research', name: 'Research' },
    ]);
    const toolResult = db.listMessages(user.id, thread.id).find((message) => message.role === 'toolResult' && message.toolName === 'load_skill');
    expect(toolResult?.content).toContain('Loaded skill: Research');

    delete process.env.VOICE_STREAM_NEXT_TEST_MODEL_TOOL_CALLS;
    process.env.VOICE_STREAM_NEXT_SECRETS_KEY = 'test-secret';
    db.upsertAssistantApiKey(user.id, 'openai', 'openai-test-key');
    let requestBody: any = null;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body ?? '{}'));
      const body = [
        'data: {"type":"response.output_text.delta","delta":"Ready."}',
        'data: {"type":"response.completed","response":{"output_text":"Ready.","output":[]}}',
        'data: [DONE]',
        '',
      ].join('\n\n');
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }) as any;

    await promptAssistantThread(db, user.id, thread.id, { prompt: 'Continue researching.' }, () => undefined);

    expect(requestBody?.tools?.some((tool: any) => tool.name === 'web_search')).toBe(true);
    expect(requestBody?.tools?.some((tool: any) => tool.name === 'fetch_content')).toBe(true);
  });

  test('exposes and executes configured extension tools', async () => {
    const db = tempDb('assistant-extension-tools');
    dbs.push(db);
    const user = testUser(db);
    const manifest = db.upsertAssistantExtensionManifest(user.id, {
      id: 'test-extension',
      name: 'Test Extension',
      version: '0.1.0',
      tools: [{
        name: 'echo',
        label: 'Echo',
        description: 'Echo test input through an extension runner.',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
          additionalProperties: false,
        },
        approval: 'never',
        supportedTargets: ['server', 'device', 'any_device'],
        defaultTarget: 'any_device',
      }],
    });
    const toolName = extensionToolName(manifest.extensionId, 'echo');
    db.upsertAssistantExtensionToolRoute(user.id, { toolName, enabled: true, targetKind: 'any_device' });
    const thread = db.createThread(user.id, { title: 'Extensions', enabledTools: ['assistant_artifacts', toolName] });
    process.env.VOICE_STREAM_NEXT_TEST_MODEL_TOOL_CALLS = JSON.stringify([
      { name: toolName, arguments: { text: 'hello extension' } },
    ]);
    setAssistantExternalToolExecutor(async (input) => ({ ok: true, toolName: input.toolName, args: input.args, targetKind: input.route?.targetKind }));

    const snapshot = await promptAssistantThread(db, user.id, thread.id, { prompt: 'Use the extension.' }, () => undefined);

    expect(assistantSnapshot(db, user.id).availableTools.some((tool) => tool.name === toolName)).toBe(true);
    expect(snapshot.threads[0]?.toolCalls.some((call) => call.toolName === toolName && call.status === 'completed')).toBe(true);
    const result = JSON.parse(db.listToolCalls(user.id, thread.id)[0]!.resultJson || '{}');
    expect(result.args.text).toBe('hello extension');
    expect(result.targetKind).toBe('any_device');
    const toolResult = db.listMessages(user.id, thread.id).find((message) => message.role === 'toolResult' && message.toolName === toolName);
    expect(toolResult?.content).toContain('hello extension');
  });

  test('omits unsupported strict flag from realtime session tools', () => {
    const db = tempDb('assistant-realtime-tools');
    dbs.push(db);
    const user = testUser(db);
    const manifest = db.upsertAssistantExtensionManifest(user.id, {
      id: 'test-extension',
      name: 'Test Extension',
      version: '0.1.0',
      tools: [{
        name: 'echo',
        label: 'Echo',
        description: 'Echo test input through an extension runner.',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
          additionalProperties: false,
        },
        approval: 'never',
        supportedTargets: ['any_device'],
        defaultTarget: 'any_device',
      }],
    });
    const extensionTool = extensionToolName(manifest.extensionId, 'echo');
    db.upsertAssistantExtensionToolRoute(user.id, { toolName: extensionTool, enabled: true, targetKind: 'any_device' });
    const thread = db.createThread(user.id, { title: 'Realtime tools', enabledTools: ['load_skill', extensionTool] });

    const config = assistantRealtimeSessionConfig(db, user.id, thread.id);

    expect(config.tools.some((tool: any) => tool.name === 'load_skill')).toBe(true);
    expect(config.tools.some((tool: any) => tool.name === extensionTool)).toBe(true);
    expect(config.tools.some((tool: any) => Object.prototype.hasOwnProperty.call(tool, 'strict'))).toBe(false);
  });

  test('stores extension-provided skills in the normal skill catalog', () => {
    const db = tempDb('assistant-extension-skills');
    dbs.push(db);
    const user = testUser(db);
    const readToolName = extensionToolName('workspace', 'read_file');

    db.upsertAssistantExtensionManifest(user.id, {
      id: 'workspace',
      name: 'Workspace',
      version: '0.1.0',
      tools: [{
        name: 'read_file',
        label: 'Read file',
        description: 'Read a workspace file.',
        inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
        approval: 'never',
        supportedTargets: ['device'],
        defaultTarget: 'device',
        targetSlot: 'workspace',
      }],
      skills: [{
        slug: 'workspace',
        name: 'Workspace',
        description: 'Inspect and edit workspace files.',
        markdownBody: 'Prefer read_file before editing.',
        toolNames: [readToolName],
        disableModelInvocation: false,
      }],
    });

    const snapshot = assistantSnapshot(db, user.id);
    const skill = snapshot.skills.find((item) => item.slug === 'workspace');
    expect(skill?.managedByExtensionId).toBe('workspace');
    expect(skill?.toolNames).toEqual([readToolName]);
  });

  test('uses thread execution target routes for workspace extension tools', async () => {
    const db = tempDb('assistant-extension-targets');
    dbs.push(db);
    const user = testUser(db);
    const desktop = db.registerDevice(user.id, { deviceType: 'desktop', displayName: 'Desktop' }).device;
    const phone = db.registerDevice(user.id, { deviceType: 'android', displayName: 'Phone' }).device;
    const manifest = db.upsertAssistantExtensionManifest(user.id, {
      id: 'workspace',
      name: 'Workspace',
      version: '0.1.0',
      tools: [{
        name: 'read_file',
        label: 'Read file',
        description: 'Read a workspace file.',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
          additionalProperties: false,
        },
        approval: 'never',
        supportedTargets: ['device'],
        defaultTarget: 'device',
        targetSlot: 'workspace',
      }],
    });
    const toolName = extensionToolName(manifest.extensionId, 'read_file');
    db.upsertAssistantExtensionToolRoute(user.id, { toolName, enabled: true, targetKind: 'device', targetDeviceId: phone.id });
    const thread = db.createThread(user.id, { title: 'Workspace target', enabledTools: [toolName] });
    db.upsertAssistantThreadExecutionTarget(user.id, thread.id, { slot: 'workspace', targetKind: 'device', targetDeviceId: desktop.id });
    process.env.VOICE_STREAM_NEXT_TEST_MODEL_TOOL_CALLS = JSON.stringify([
      { name: toolName, arguments: { path: 'README.md' } },
    ]);
    setAssistantExternalToolExecutor(async (input) => ({
      ok: true,
      targetKind: input.route?.targetKind,
      targetDeviceId: input.route?.targetDeviceId,
    }));

    await promptAssistantThread(db, user.id, thread.id, { prompt: 'Read the file.' }, () => undefined);

    const result = JSON.parse(db.listToolCalls(user.id, thread.id)[0]!.resultJson || '{}');
    expect(result.targetKind).toBe('device');
    expect(result.targetDeviceId).toBe(desktop.id);
  });

  test('includes extension tools in provider instructions and timing logs', async () => {
    const db = tempDb('assistant-extension-tool-catalog');
    dbs.push(db);
    const user = testUser(db);
    process.env.VOICE_STREAM_NEXT_SECRETS_KEY = 'test-secret';
    db.upsertAssistantApiKey(user.id, 'openai', 'openai-test-key');
    const manifest = db.upsertAssistantExtensionManifest(user.id, {
      id: 'drone-hub',
      name: 'Drone Hub',
      version: '0.1.0',
      tools: [{
        name: 'list_drones',
        label: 'List drones',
        description: 'List local Drone Hub drones.',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
          additionalProperties: false,
        },
        approval: 'never',
        supportedTargets: ['device', 'any_device'],
        defaultTarget: 'any_device',
      }],
    });
    const toolName = extensionToolName(manifest.extensionId, 'list_drones');
    db.upsertAssistantExtensionToolRoute(user.id, { toolName, enabled: true, targetKind: 'any_device' });
    const thread = db.createThread(user.id, {
      title: 'Tool catalog',
      provider: 'openai',
      model: 'gpt-5.2',
      enabledTools: [toolName],
    });
    let requestBody: any = null;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body ?? '{}'));
      const body = [
        'data: {"type":"response.output_text.delta","delta":"Ready."}',
        'data: {"type":"response.completed","response":{"output_text":"Ready.","output":[]}}',
        'data: [DONE]',
        '',
      ].join('\n\n');
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }) as any;

    await promptAssistantThread(db, user.id, thread.id, { prompt: 'What tools do you have?' }, () => undefined);

    const requestJson = JSON.stringify(requestBody);
    expect(requestJson).toContain('Available assistant tools this turn:');
    expect(requestJson).toContain('List drones');
    expect(requestJson).toContain(toolName);
    expect(requestBody?.tools?.some((tool: any) => tool.name === toolName)).toBe(true);
    const requestStartLog = db.listLogs(user.id, 20).find((log) => log.message === 'Assistant provider request_start');
    expect(requestStartLog?.detailsJson).toContain(toolName);
  });

  test('hands-free mode hides always-approval tools but keeps dynamic tools in provider requests', async () => {
    const db = tempDb('assistant-hands-free-tools');
    dbs.push(db);
    const user = testUser(db);
    process.env.VOICE_STREAM_NEXT_SECRETS_KEY = 'test-secret';
    db.upsertAssistantApiKey(user.id, 'openai', 'openai-test-key');
    const manifest = db.upsertAssistantExtensionManifest(user.id, {
      id: 'test-extension',
      name: 'Test Extension',
      version: '0.1.0',
      tools: [{
        name: 'send',
        label: 'Send',
        description: 'Send through an extension runner.',
        inputSchema: {
          type: 'object',
          properties: { target: { type: 'string' } },
          required: ['target'],
          additionalProperties: false,
        },
        approval: 'dynamic',
        supportedTargets: ['device', 'any_device'],
        defaultTarget: 'any_device',
      }],
    });
    const dynamicToolName = extensionToolName(manifest.extensionId, 'send');
    db.upsertAssistantExtensionToolRoute(user.id, { toolName: dynamicToolName, enabled: true, targetKind: 'any_device' });
    const thread = db.createThread(user.id, {
      title: 'Hands-free tools',
      provider: 'openai',
      model: 'gpt-5.2',
      handsFreeMode: true,
      enabledTools: ['get_system_prompt', 'update_system_prompt', dynamicToolName],
    });
    let requestBody: any = null;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body ?? '{}'));
      const body = [
        'data: {"type":"response.output_text.delta","delta":"Ready."}',
        'data: {"type":"response.completed","response":{"output_text":"Ready.","output":[]}}',
        'data: [DONE]',
        '',
      ].join('\n\n');
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }) as any;

    await promptAssistantThread(db, user.id, thread.id, { prompt: 'What can you do?' }, () => undefined);

    const toolNames = (requestBody?.tools ?? []).map((tool: any) => tool.name);
    expect(toolNames).toContain('get_system_prompt');
    expect(toolNames).not.toContain('update_system_prompt');
    expect(toolNames).toContain(dynamicToolName);
    expect(JSON.stringify(requestBody)).toContain('Hands-free mode is on');
  });

  test('uses dynamic extension approval before pausing a tool call', async () => {
    const db = tempDb('assistant-extension-dynamic-approval');
    dbs.push(db);
    const user = testUser(db);
    const manifest = db.upsertAssistantExtensionManifest(user.id, {
      id: 'test-extension',
      name: 'Test Extension',
      version: '0.1.0',
      tools: [{
        name: 'send',
        label: 'Send',
        description: 'Send through an extension runner.',
        inputSchema: {
          type: 'object',
          properties: { target: { type: 'string' } },
          required: ['target'],
          additionalProperties: false,
        },
        approval: 'dynamic',
        supportedTargets: ['device', 'any_device'],
        defaultTarget: 'any_device',
      }],
    });
    const toolName = extensionToolName(manifest.extensionId, 'send');
    db.upsertAssistantExtensionToolRoute(user.id, { toolName, enabled: true, targetKind: 'any_device' });
    const thread = db.createThread(user.id, { title: 'Dynamic approvals', enabledTools: ['assistant_artifacts', toolName] });
    process.env.VOICE_STREAM_NEXT_TEST_MODEL_TOOL_CALLS = JSON.stringify([
      { name: toolName, arguments: { target: 'created-by-extension' } },
    ]);
    setAssistantExternalToolApprovalEvaluator(async () => false);
    setAssistantExternalToolExecutor(async (input) => ({ ok: true, args: input.args }));

    const snapshot = await promptAssistantThread(db, user.id, thread.id, { prompt: 'Use the extension.' }, () => undefined);

    expect(snapshot.pendingApprovals).toHaveLength(0);
    expect(db.listToolCalls(user.id, thread.id)[0]?.status).toBe('completed');
  });

  test('hands-free mode allows dynamic tool calls that do not need approval', async () => {
    const db = tempDb('assistant-hands-free-dynamic-allowed');
    dbs.push(db);
    const user = testUser(db);
    const manifest = db.upsertAssistantExtensionManifest(user.id, {
      id: 'test-extension',
      name: 'Test Extension',
      version: '0.1.0',
      tools: [{
        name: 'send',
        label: 'Send',
        description: 'Send through an extension runner.',
        inputSchema: {
          type: 'object',
          properties: { target: { type: 'string' } },
          required: ['target'],
          additionalProperties: false,
        },
        approval: 'dynamic',
        supportedTargets: ['device', 'any_device'],
        defaultTarget: 'any_device',
      }],
    });
    const toolName = extensionToolName(manifest.extensionId, 'send');
    db.upsertAssistantExtensionToolRoute(user.id, { toolName, enabled: true, targetKind: 'any_device' });
    const thread = db.createThread(user.id, { title: 'Hands-free dynamic allowed', handsFreeMode: true, enabledTools: [toolName] });
    process.env.VOICE_STREAM_NEXT_TEST_MODEL_TOOL_CALLS = JSON.stringify([
      { name: toolName, arguments: { target: 'created-by-extension' } },
    ]);
    setAssistantExternalToolApprovalEvaluator(async () => false);
    setAssistantExternalToolExecutor(async (input) => ({ ok: true, args: input.args }));

    const snapshot = await promptAssistantThread(db, user.id, thread.id, { prompt: 'Use the extension.' }, () => undefined);

    expect(snapshot.pendingApprovals).toHaveLength(0);
    expect(db.thread(user.id, thread.id)?.status).toBe('idle');
    expect(db.listToolCalls(user.id, thread.id)[0]?.status).toBe('completed');
  });

  test('hands-free mode blocks dynamic tool calls that need approval', async () => {
    const db = tempDb('assistant-hands-free-dynamic-blocked');
    dbs.push(db);
    const user = testUser(db);
    const manifest = db.upsertAssistantExtensionManifest(user.id, {
      id: 'test-extension',
      name: 'Test Extension',
      version: '0.1.0',
      tools: [{
        name: 'send',
        label: 'Send',
        description: 'Send through an extension runner.',
        inputSchema: {
          type: 'object',
          properties: { target: { type: 'string' } },
          required: ['target'],
          additionalProperties: false,
        },
        approval: 'dynamic',
        supportedTargets: ['device', 'any_device'],
        defaultTarget: 'any_device',
      }],
    });
    const toolName = extensionToolName(manifest.extensionId, 'send');
    db.upsertAssistantExtensionToolRoute(user.id, { toolName, enabled: true, targetKind: 'any_device' });
    const thread = db.createThread(user.id, { title: 'Hands-free dynamic blocked', handsFreeMode: true, enabledTools: [toolName] });
    process.env.VOICE_STREAM_NEXT_TEST_MODEL_TOOL_CALLS = JSON.stringify([
      { name: toolName, arguments: { target: 'external-drone' } },
    ]);
    setAssistantExternalToolApprovalEvaluator(async () => true);

    const snapshot = await promptAssistantThread(db, user.id, thread.id, { prompt: 'Use the extension.' }, () => undefined);

    expect(snapshot.pendingApprovals).toHaveLength(0);
    expect(db.thread(user.id, thread.id)?.status).toBe('error');
    expect(db.listToolCalls(user.id, thread.id)).toHaveLength(0);
    expect(db.listMessages(user.id, thread.id).find((message) => message.isError)?.content).toContain('needs approval for this request');
  });

  test('executes model-requested artifact tool calls without slash commands', async () => {
    const db = tempDb('assistant-model-tools');
    dbs.push(db);
    const user = testUser(db);
    const thread = db.createThread(user.id, { title: 'Model tools' });
    process.env.VOICE_STREAM_NEXT_TEST_MODEL_TOOL_CALLS = JSON.stringify([
      {
        name: 'assistant_artifacts',
        arguments: { action: 'write', path: 'notes/model.md', content: 'Created by model tool call.' },
      },
    ]);
    const events: any[] = [];

    await promptAssistantThread(db, user.id, thread.id, { prompt: 'Please save this as a note.' }, (event) => events.push(event));

    expect(db.readArtifact(user.id, thread.id, 'notes/model.md')?.content).toBe('Created by model tool call.');
    expect(db.listToolCalls(user.id, thread.id)[0]?.toolName).toBe('assistant_artifacts');
    expect(events.some((event) => event.type === 'tool_call')).toBe(true);
    expect(events.some((event) => event.type === 'tool_result')).toBe(true);
    expect(db.listMessages(user.id, thread.id).some((message) => message.contentJson?.includes('modelToolCall'))).toBe(true);
  });

  test('errors voice model turns that finish without calling speak', async () => {
    const db = tempDb('assistant-required-speak-missing');
    dbs.push(db);
    const user = testUser(db);
    const thread = db.createThread(user.id, { title: 'Required speak missing' });
    process.env.VOICE_STREAM_NEXT_TEST_MODEL_TOOL_CALLS = JSON.stringify([
      {
        name: 'set_thinking_level',
        arguments: { thinkingLevel: 'low' },
      },
    ]);
    const events: any[] = [];

    await promptAssistantThread(db, user.id, thread.id, { prompt: 'Answer out loud.' }, (event) => events.push(event));
    const messages = db.listMessages(user.id, thread.id);

    expect(db.thread(user.id, thread.id)?.status).toBe('error');
    expect(db.listToolCalls(user.id, thread.id).some((toolCall) => toolCall.toolName === 'speak')).toBe(false);
    expect(messages.every((message) => message.spokenText == null)).toBe(true);
    expect(messages.some((message) => message.role === 'assistant' && message.content === 'Thinking level set to low.')).toBe(false);
    expect(events.some((event) => event.type === 'delta')).toBe(false);
    expect(messages.find((message) => message.isError)?.content).toContain('without using the speak tool');
    expect(events.some((event) => event.type === 'error' && event.error.includes('speak tool'))).toBe(true);
  });

  test('allows voice model turns that call speak before finishing', async () => {
    const db = tempDb('assistant-required-speak-used');
    dbs.push(db);
    const user = testUser(db);
    const thread = db.createThread(user.id, { title: 'Required speak used' });
    process.env.VOICE_STREAM_NEXT_TEST_MODEL_TOOL_CALLS = JSON.stringify([
      {
        name: 'speak',
        arguments: { text: 'Hello from the speak tool.' },
      },
    ]);

    await promptAssistantThread(db, user.id, thread.id, { prompt: 'Answer out loud.' }, () => undefined);

    expect(db.thread(user.id, thread.id)?.status).toBe('idle');
    expect(db.listToolCalls(user.id, thread.id).some((toolCall) => toolCall.toolName === 'speak' && toolCall.status === 'completed')).toBe(true);
    expect(db.listMessages(user.id, thread.id).some((message) => message.toolName === 'speak' && message.content.includes('Hello from the speak tool.'))).toBe(true);
    expect(db.listMessages(user.id, thread.id).filter((message) => message.role === 'assistant').every((message) => message.spokenText == null)).toBe(true);
  });

  test('executes model-requested web search tool calls', async () => {
    const db = tempDb('assistant-web-search');
    dbs.push(db);
    const user = testUser(db);
    const thread = db.createThread(user.id, { title: 'Web search' });
    process.env.VOICE_STREAM_NEXT_SECRETS_KEY = 'test-secret';
    db.upsertAssistantApiKey(user.id, 'exa', 'exa-test-key');
    process.env.VOICE_STREAM_NEXT_TEST_MODEL_TOOL_CALLS = JSON.stringify([
      {
        name: 'web_search',
        arguments: { query: 'pi web access exa', numResults: 2, recencyFilter: '', domainFilter: [] },
      },
    ]);
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      expect(body.query).toBe('pi web access exa');
      expect(body.numResults).toBe(2);
      return new Response(JSON.stringify({
        results: [
          {
            title: 'Pi Web Access',
            url: 'https://pi.dev/packages/pi-web-access',
            publishedDate: '2026-05-20',
            highlights: ['Adds web_search to Pi with Exa-backed results.'],
          },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as any;
    const events: any[] = [];

    await promptAssistantThread(db, user.id, thread.id, { prompt: 'Search the web for Pi web access.' }, (event) => events.push(event));

    const toolCall = db.listToolCalls(user.id, thread.id)[0];
    expect(toolCall?.toolName).toBe('web_search');
    const toolResult = db.listMessages(user.id, thread.id).find((message) => message.role === 'toolResult' && message.toolName === 'web_search');
    expect(toolResult?.content).toContain('https://pi.dev/packages/pi-web-access');
    expect(events.some((event) => event.type === 'tool_result' && event.result?.provider === 'exa')).toBe(true);
  });

  test('executes model-requested fetch content tool calls', async () => {
    const db = tempDb('assistant-fetch-content');
    dbs.push(db);
    const user = testUser(db);
    const thread = db.createThread(user.id, { title: 'Fetch content' });
    process.env.VOICE_STREAM_NEXT_SECRETS_KEY = 'test-secret';
    db.upsertAssistantApiKey(user.id, 'exa', 'exa-test-key');
    process.env.VOICE_STREAM_NEXT_TEST_MODEL_TOOL_CALLS = JSON.stringify([
      {
        name: 'fetch_content',
        arguments: { url: 'https://pi.dev/packages/pi-web-access', maxCharacters: 2000, livecrawl: 'fallback' },
      },
    ]);
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      expect(body.urls).toEqual(['https://pi.dev/packages/pi-web-access']);
      expect(body.text.maxCharacters).toBe(2000);
      return new Response(JSON.stringify({
        results: [
          {
            title: 'Pi Web Access',
            url: 'https://pi.dev/packages/pi-web-access',
            publishedDate: '2026-05-20',
            text: 'Adds web_search and fetch_content tools for Pi.',
          },
        ],
        statuses: [{ id: 'https://pi.dev/packages/pi-web-access', status: 'success' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as any;
    const events: any[] = [];

    await promptAssistantThread(db, user.id, thread.id, { prompt: 'Read https://pi.dev/packages/pi-web-access' }, (event) => events.push(event));

    const toolCall = db.listToolCalls(user.id, thread.id)[0];
    expect(toolCall?.toolName).toBe('fetch_content');
    const toolResult = db.listMessages(user.id, thread.id).find((message) => message.role === 'toolResult' && message.toolName === 'fetch_content');
    expect(toolResult?.content).toContain('Adds web_search and fetch_content tools for Pi.');
    expect(events.some((event) => event.type === 'tool_result' && event.result?.provider === 'exa')).toBe(true);
  });

  test('creates a new voice thread from the assistant tool for future recordings', async () => {
    const db = tempDb('assistant-create-new-thread');
    dbs.push(db);
    const user = testUser(db);
    const device = db.registerDevice(user.id, { deviceType: 'android', displayName: 'Phone' });
    const thread = db.createThread(user.id, {
      title: 'Current voice thread',
      source: 'voice',
      voiceEnabled: true,
      provider: 'codex',
      model: 'gpt-5.5',
      thinkingLevel: 'high',
    });
    process.env.VOICE_STREAM_NEXT_TEST_MODEL_TOOL_CALLS = JSON.stringify([
      {
        name: 'create_new_thread',
        arguments: { title: 'Fresh voice thread' },
      },
    ]);

    await promptAssistantThread(db, user.id, thread.id, { prompt: 'Start a new thread.' }, () => undefined);

    const created = db.listThreads(user.id).find((item) => item.title === 'Fresh voice thread');
    if (!created) throw new Error('expected create_new_thread to create a voice thread');
    expect(created.source).toBe('voice');
    expect(created.voiceEnabled).toBe(true);
    expect(created.provider).toBe('codex');
    expect(created.thinkingLevel).toBe('high');
    expect(db.latestVoiceThreadOrNull(user.id)?.id).toBe(created.id);

    const session = db.createVoiceSession(user.id, device.device.id, 'assistant');
    expect(session.assistantThreadId).toBe(created.id);
  });

  test('pauses model-requested approval tools before execution', async () => {
    const db = tempDb('assistant-model-approval');
    dbs.push(db);
    const user = testUser(db);
    const thread = db.createThread(user.id, { title: 'Model approval' });
    process.env.VOICE_STREAM_NEXT_TEST_MODEL_TOOL_CALLS = JSON.stringify([
      {
        name: 'update_system_prompt',
        arguments: { prompt: 'Use concise answers only.' },
      },
    ]);

    const waiting = await promptAssistantThread(db, user.id, thread.id, { prompt: 'Tighten the system prompt.' }, () => undefined);

    expect(waiting.pendingApprovals).toHaveLength(1);
    expect(db.thread(user.id, thread.id)?.systemPrompt).toBeNull();
    expect(db.listToolCalls(user.id, thread.id)[0]?.status).toBe('waiting_for_approval');
  });

  test('auto-approve skips pending approval and executes approval tools', async () => {
    const db = tempDb('assistant-auto-approve');
    dbs.push(db);
    const user = testUser(db);
    const thread = db.createThread(user.id, { title: 'Auto approve', autoApprove: true });
    process.env.VOICE_STREAM_NEXT_TEST_MODEL_TOOL_CALLS = JSON.stringify([
      {
        name: 'update_system_prompt',
        arguments: { prompt: 'Auto-approved prompt.' },
      },
    ]);

    const snapshot = await promptAssistantThread(db, user.id, thread.id, { prompt: 'Update without stopping.' }, () => undefined);

    expect(snapshot.pendingApprovals).toHaveLength(0);
    expect(db.thread(user.id, thread.id)?.systemPrompt).toBe('Auto-approved prompt.');
    expect(db.listToolCalls(user.id, thread.id)[0]?.status).toBe('completed');
  });

  test('hands-free mode blocks stale approval-gated model tool calls', async () => {
    const db = tempDb('assistant-hands-free-stale-tool');
    dbs.push(db);
    const user = testUser(db);
    const thread = db.createThread(user.id, {
      title: 'Hands-free stale tool',
      handsFreeMode: true,
      enabledTools: ['update_system_prompt'],
    });
    process.env.VOICE_STREAM_NEXT_TEST_MODEL_TOOL_CALLS = JSON.stringify([
      {
        name: 'update_system_prompt',
        arguments: { prompt: 'This should not apply.' },
      },
    ]);

    const snapshot = await promptAssistantThread(db, user.id, thread.id, { prompt: 'Update the prompt.' }, () => undefined);

    expect(snapshot.pendingApprovals).toHaveLength(0);
    expect(db.thread(user.id, thread.id)?.status).toBe('error');
    expect(db.thread(user.id, thread.id)?.systemPrompt).toBeNull();
    expect(db.listToolCalls(user.id, thread.id)).toHaveLength(0);
    expect(db.listMessages(user.id, thread.id).find((message) => message.isError)?.content).toContain('hidden while hands-free mode is on');
  });

  test('denying a pending approval cancels the waiting run', async () => {
    const db = tempDb('assistant-approval-deny');
    dbs.push(db);
    const user = testUser(db);
    const thread = db.createThread(user.id, { title: 'Deny approval' });

    const waiting = await promptAssistantThread(
      db,
      user.id,
      thread.id,
      { prompt: '/system-prompt Never use paragraphs.' },
      () => undefined,
    );
    const approval = waiting.pendingApprovals[0]!;
    const runId = db.listRuns(user.id, thread.id)[0]!.id;

    const snapshot = await resolveAssistantApproval(db, user.id, approval.id, false, 'test');

    expect(snapshot.pendingApprovals).toHaveLength(0);
    expect(db.thread(user.id, thread.id)?.status).toBe('idle');
    expect(db.listRuns(user.id, thread.id).find((run) => run.id === runId)?.status).toBe('cancelled');
    expect(db.listMessages(user.id, thread.id).some((message) => message.isError && message.content.includes('denied'))).toBe(true);
  });

  test('continues a model-requested tool run after approval', async () => {
    const db = tempDb('assistant-approval-continue');
    dbs.push(db);
    const user = testUser(db);
    const thread = db.createThread(user.id, {
      title: 'Continue approval',
      enabledTools: ['update_system_prompt'],
    });
    process.env.VOICE_STREAM_NEXT_TEST_MODEL_TOOL_CALLS = JSON.stringify([
      {
        name: 'update_system_prompt',
        arguments: { prompt: 'Continue after approved tools.' },
      },
    ]);

    const waiting = await promptAssistantThread(db, user.id, thread.id, { prompt: 'Update the rules and keep going.' }, () => undefined);
    const runId = db.listRuns(user.id, thread.id)[0]!.id;
    const snapshot = await resolveAssistantApproval(db, user.id, waiting.pendingApprovals[0]!.id, true, 'test');
    const messages = db.listMessages(user.id, thread.id);

    expect(snapshot.pendingApprovals).toHaveLength(0);
    expect(db.thread(user.id, thread.id)?.systemPrompt).toBe('Continue after approved tools.');
    expect(db.listRuns(user.id, thread.id).find((run) => run.id === runId)?.status).toBe('idle');
    expect(messages.at(-1)?.role).toBe('assistant');
    expect(messages.at(-1)?.content).toContain('system prompt updated');
  });

  test('queues prompts while a queue-mode thread has an active run', async () => {
    const db = tempDb('assistant-queue');
    dbs.push(db);
    const user = testUser(db);
    const thread = db.createThread(user.id, { title: 'Queue mode', promptDeliveryMode: 'queue' });
    db.createRun(user.id, thread.id, { prompt: 'running', provider: 'openai', model: 'gpt-5.2', thinkingLevel: 'off' });
    const events: any[] = [];

    const snapshot = await promptAssistantThread(db, user.id, thread.id, { prompt: 'run after this', provider: 'openai' }, (event) => events.push(event));

    expect(snapshot.threads[0]?.queuedPrompts).toHaveLength(1);
    expect(db.listQueuedPrompts(user.id, thread.id)[0]?.prompt).toBe('run after this');
    expect(events.some((event) => event.type === 'queued')).toBe(true);
  });

  test('cancels queued prompts and deletes threads', () => {
    const db = tempDb('assistant-delete-queue');
    dbs.push(db);
    const user = testUser(db);
    const thread = db.createThread(user.id, { title: 'Delete me' });
    const queued = db.enqueuePrompt(user.id, thread.id, {
      prompt: 'later',
      provider: 'openai',
      model: 'gpt-5.2',
      thinkingLevel: 'off',
    });

    expect(db.cancelQueuedPrompt(user.id, thread.id, queued.id)?.status).toBe('cancelled');
    expect(db.listQueuedPrompts(user.id, thread.id)).toHaveLength(0);
    expect(db.deleteThread(user.id, thread.id)).toBe(true);
    expect(db.thread(user.id, thread.id)).toBeNull();
  });

  test('errors visibly when OpenAI is selected without an API key', async () => {
    const db = tempDb('assistant-missing-openai-key');
    dbs.push(db);
    const user = testUser(db);
    const thread = db.createThread(user.id, { title: 'OpenAI', provider: 'openai', model: 'gpt-5.2' });
    const events: any[] = [];
    await promptAssistantThread(db, user.id, thread.id, { prompt: 'hello there', provider: 'openai' }, (event) => events.push(event));
    const assistantMessage = db.listMessages(user.id, thread.id).find((message) => message.role === 'assistant');

    expect(db.thread(user.id, thread.id)?.status).toBe('error');
    expect(db.listMessages(user.id, thread.id).some((message) => message.role === 'user' && message.content === 'hello there')).toBe(true);
    expect(assistantMessage?.isError).toBe(true);
    expect(assistantMessage?.content).toContain('OpenAI API key is not configured');
    expect(events.some((event) => event.type === 'error')).toBe(true);
  });

  test('shows provider errors without local fallback replies', async () => {
    const db = tempDb('assistant-provider-error');
    dbs.push(db);
    const user = testUser(db);
    const thread = db.createThread(user.id, {
      title: 'Provider failure',
      provider: 'openai',
      model: 'gpt-5.2',
      enabledTools: [],
    });
    const originalFetch = globalThis.fetch;
    process.env.VOICE_STREAM_NEXT_SECRETS_KEY = 'test-secret';
    db.upsertAssistantApiKey(user.id, 'openai', 'test-key');
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: 'quota exceeded' } }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;
    try {
      const events: any[] = [];
      await promptAssistantThread(db, user.id, thread.id, { prompt: 'hello', provider: 'openai' }, (event) => events.push(event));
      const assistantMessage = db.listMessages(user.id, thread.id).find((message) => message.role === 'assistant');

      expect(db.thread(user.id, thread.id)?.status).toBe('error');
      expect(assistantMessage?.isError).toBe(true);
      expect(assistantMessage?.content).toContain('quota exceeded');
      expect(assistantMessage?.content).not.toContain('I heard: hello');
      expect(events.some((event) => event.type === 'error')).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('stores, updates, and deletes thread artifacts directly', () => {
    const db = tempDb('assistant-artifact-direct');
    dbs.push(db);
    const user = testUser(db);
    const thread = db.createThread(user.id, { title: 'Direct artifacts' });

    const created = db.upsertArtifact(user.id, thread.id, { path: sanitizeArtifactPath('notes/direct.md'), content: 'one' });
    const updated = db.upsertArtifact(user.id, thread.id, { path: created.path, content: 'two' });

    expect(created.id).toBe(updated.id);
    expect(updated.content).toBe('two');
    expect(db.listArtifacts(user.id, thread.id)).toHaveLength(1);
    expect(db.deleteArtifact(user.id, thread.id, created.path)).toBe(true);
    expect(db.listArtifacts(user.id, thread.id)).toHaveLength(0);
  });

  test('rejects unsafe artifact paths', () => {
    expect(() => sanitizeArtifactPath('../secret.md')).toThrow();
    expect(() => sanitizeArtifactPath('notes/../secret.md')).toThrow();
    expect(() => sanitizeArtifactPath('')).toThrow();
    expect(sanitizeArtifactPath('/notes/safe.md')).toBe('notes/safe.md');
  });

  test('supports model tool parity for artifact list/patch and system prompt patches', async () => {
    const db = tempDb('assistant-tool-patches');
    dbs.push(db);
    const user = testUser(db);
    const thread = db.createThread(user.id, { title: 'Patch tools' });
    db.upsertArtifact(user.id, thread.id, { path: 'notes/patch.md', content: 'alpha beta gamma' });
    db.updateThread(user.id, thread.id, { systemPrompt: 'Keep answers short and plain.' });
    process.env.VOICE_STREAM_NEXT_TEST_MODEL_TOOL_CALLS = JSON.stringify([
      {
        name: 'assistant_artifacts',
        arguments: { action: 'list', path: '', content: '', oldText: '', newText: '', baseRevision: '' },
      },
      {
        name: 'assistant_artifacts',
        arguments: { action: 'patch', path: 'notes/patch.md', content: '', oldText: 'beta', newText: 'delta', baseRevision: '' },
      },
      {
        name: 'update_system_prompt',
        arguments: { prompt: '', oldText: 'plain', newText: 'direct' },
      },
    ]);

    const waiting = await promptAssistantThread(db, user.id, thread.id, { prompt: 'Patch the notes and prompt.' }, () => undefined);
    const messagesBeforeApproval = db.listMessages(user.id, thread.id);

    expect(db.readArtifact(user.id, thread.id, 'notes/patch.md')?.content).toBe('alpha delta gamma');
    expect(waiting.pendingApprovals).toHaveLength(1);
    expect(db.thread(user.id, thread.id)?.status).toBe('waiting_for_approval');
    expect(messagesBeforeApproval.at(-1)?.role).not.toBe('assistant');
    expect(messagesBeforeApproval.some((message) => message.role === 'assistant' && message.content === 'Done.')).toBe(false);
    await resolveAssistantApproval(db, user.id, waiting.pendingApprovals[0]!.id, true, 'test');
    expect(db.thread(user.id, thread.id)?.systemPrompt).toBe('Keep answers short and direct.');
  });
});
