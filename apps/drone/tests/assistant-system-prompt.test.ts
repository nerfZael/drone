import { describe, expect, test } from 'bun:test';

import { loadAssistantState, saveAssistantState } from '../src/host/assistant-store';
import { HubAssistantService } from '../src/hub/assistant';
import {
  ASSISTANT_DEFAULT_ENABLED_TOOL_NAMES,
  ASSISTANT_DRONE_HUB_MCP_TOOL_NAMES,
  ASSISTANT_PRE_MCP_OPT_IN_DEFAULT_ENABLED_TOOL_NAMES,
  ASSISTANT_TOOL_SUMMARIES,
} from '../src/hub/assistant/assistant-config';
import { ensureTestNativeChat } from './native-chat-test-helpers';
import { withTempDroneDataDir } from './test-helpers';

function makeAssistantService(): HubAssistantService {
  return new HubAssistantService({ listDrones: async () => [] });
}

describe('assistant system prompt settings', () => {
  test('preserves parallel additive grants in native chat access scope', async () => {
    await withTempDroneDataDir('assistant-parallel-scope-grants-', async () => {
      const service = makeAssistantService();
      const created = await ensureTestNativeChat(service, { chatName: 'parallel grants' });
      await service.updateAccessScope({
        threadId: created.chatId,
        readMode: 'selected',
        writeMode: 'selected',
        executeMode: 'selected',
        droneIds: [],
      });
      const addedDroneIds = [
        'parallel-child-1',
        'parallel-child-2',
        'parallel-child-3',
        'parallel-child-4',
      ];

      await Promise.all(
        addedDroneIds.map((droneId) =>
          service.updateAccessScope({
            threadId: created.chatId,
            addDroneIds: [droneId],
          }),
        ),
      );

      const expectedDroneIds = new Set(['native-test-drone', ...addedDroneIds]);
      expect(new Set((await service.threadSnapshot(created.chatId)).accessScope.droneIds)).toEqual(
        expectedDroneIds,
      );
      const reloaded = makeAssistantService();
      expect(new Set((await reloaded.threadSnapshot(created.chatId)).accessScope.droneIds)).toEqual(
        expectedDroneIds,
      );
    });
  });

  test('keeps the native chat owner in a selected scope at the id limit', async () => {
    await withTempDroneDataDir('assistant-owner-scope-limit-', async () => {
      const service = makeAssistantService();
      const created = await ensureTestNativeChat(service, { chatName: 'scope limit' });
      const requestedDroneIds = Array.from(
        { length: 100 },
        (_, index) => `selected-drone-${index + 1}`,
      );

      const accessScope = await service.updateAccessScope({
        threadId: created.chatId,
        readMode: 'selected',
        writeMode: 'selected',
        executeMode: 'selected',
        droneIds: requestedDroneIds,
      });

      expect(accessScope.droneIds).toHaveLength(100);
      expect(accessScope.droneIds[0]).toBe('native-test-drone');
      expect(accessScope.droneIds).toContain('selected-drone-99');
      expect(accessScope.droneIds).not.toContain('selected-drone-100');
    });
  });

  test('explains independent drone creation and explicit parent access policy', async () => {
    await withTempDroneDataDir('assistant-global-create-scope-', async () => {
      const service = makeAssistantService();
      const snapshot = await ensureTestNativeChat(service, { chatName: 'create scope' });
      await service.updateAccessScope({
        threadId: snapshot.chatId,
        readMode: 'all',
        writeMode: 'selected',
        droneIds: [],
      });
      const prompt = service.resolvedSystemPrompt(snapshot.chatId);
      expect(prompt).toContain('Current existing-drone access scope: read=all drones; write=selected drones (native-test-drone); execute=selected drones (native-test-drone).');
      expect(prompt).toContain('create_drone and clone_drone create independent container drones by default and automatically grant this chat access.');
      expect(prompt).toContain('Pass parent only when the user explicitly wants a child drone; the parent must be in read scope.');
      expect(prompt).toContain('clone_drone also requires read access to its source.');
    });
  });

  test('advertises the complete grouped tool catalog without legacy aliases', () => {
    const names = ASSISTANT_TOOL_SUMMARIES.map((tool) => tool.name);
    for (const name of ['list_targets', 'set_target', 'get_working_tree_status', 'delete_file', 'create_directory', 'delete_directory', 'move_path']) expect(names).toContain(name);
    for (const name of [
      'assistant_files',
      'find_files',
      'list_changed_files',
      'message_drone',
      'read_chat_messages',
      'get_current_context',
      'subscribe_to_chats_idle',
      'subscribe_to_any_chat_idle',
      'subscribe_to_all_chats_idle',
      'list_chat_idle_subscriptions',
      'cancel_chat_idle_subscription',
    ]) expect(names).not.toContain(name);
    expect(ASSISTANT_TOOL_SUMMARIES.find((tool) => tool.name === 'send_message')?.group).toEqual({ kind: 'mcp', id: 'drone-hub', label: 'Drone Hub' });
    expect(ASSISTANT_TOOL_SUMMARIES.find((tool) => tool.name === 'read_file')?.group).toBeUndefined();
  });

  test('keeps Drone Hub MCP tools available but disabled by default for new chats', async () => {
    await withTempDroneDataDir('assistant-mcp-tools-opt-in-', async () => {
      const service = makeAssistantService();
      const snapshot = await ensureTestNativeChat(service, { chatName: 'mcp opt in' });
      const available = snapshot.availableTools.map((tool) => tool.name);
      expect(available).toEqual(expect.arrayContaining(ASSISTANT_DRONE_HUB_MCP_TOOL_NAMES));
      expect(snapshot.defaultEnabledTools).toEqual(ASSISTANT_DEFAULT_ENABLED_TOOL_NAMES);
      expect(snapshot.threads[0]?.enabledTools).not.toEqual(
        expect.arrayContaining(ASSISTANT_DRONE_HUB_MCP_TOOL_NAMES),
      );
    });
  });

  test('migrates old defaults without changing existing chat tool selections', async () => {
    await withTempDroneDataDir('assistant-mcp-default-migration-', async () => {
      const initial = makeAssistantService();
      const existing = await ensureTestNativeChat(initial, { chatName: 'existing mcp chat' });
      const implicit = await ensureTestNativeChat(initial, { chatName: 'implicit mcp chat' });
      const stored = await loadAssistantState();
      const existingStored = stored?.threads?.find((thread) => thread.id === existing.chatId);
      const implicitStored = stored?.threads?.find((thread) => thread.id === implicit.chatId);
      if (!stored || !existingStored || !implicitStored)
        throw new Error('missing stored assistant thread');
      stored.defaultEnabledTools = [...ASSISTANT_PRE_MCP_OPT_IN_DEFAULT_ENABLED_TOOL_NAMES];
      existingStored.enabledTools = [...ASSISTANT_PRE_MCP_OPT_IN_DEFAULT_ENABLED_TOOL_NAMES];
      delete implicitStored.enabledTools;
      delete stored.droneHubMcpDefaultOptInMigrationApplied;
      await saveAssistantState(stored);

      const reloaded = makeAssistantService();
      const existingSnapshot = await reloaded.threadSnapshot(existing.chatId);
      expect(existingSnapshot.defaultEnabledTools).toEqual(ASSISTANT_DEFAULT_ENABLED_TOOL_NAMES);
      expect(existingSnapshot.threads[0]?.enabledTools).toEqual(
        expect.arrayContaining(ASSISTANT_DRONE_HUB_MCP_TOOL_NAMES),
      );
      expect(
        (await reloaded.threadSnapshot(implicit.chatId)).threads[0]?.enabledTools,
      ).toEqual(expect.arrayContaining(ASSISTANT_DRONE_HUB_MCP_TOOL_NAMES));

      const created = await ensureTestNativeChat(reloaded, { chatName: 'new mcp chat' });
      expect(created.threads.find((thread) => thread.id === created.chatId)?.enabledTools).not.toEqual(
        expect.arrayContaining(ASSISTANT_DRONE_HUB_MCP_TOOL_NAMES),
      );
    });
  });

  test('does not instruct built-in chats to use the removed current-context tool', async () => {
    await withTempDroneDataDir('assistant-without-current-context-', async () => {
      const service = makeAssistantService();
      const snapshot = await ensureTestNativeChat(service, { chatName: 'no current context' });
      expect(snapshot.availableTools.map((tool) => tool.name)).not.toContain('get_current_context');
      expect(snapshot.threads[0]?.enabledTools).not.toContain('get_current_context');
      expect(service.resolvedSystemPrompt(snapshot.chatId)).not.toContain('get_current_context');
    });
  });

  test('keeps Artifacts off by default and exposes target selection after it is enabled', async () => {
    await withTempDroneDataDir('assistant-target-tool-cardinality-', async () => {
      const withDrone = new HubAssistantService({
        listDrones: async () => [{ id: 'drone-a', name: 'Drone A', group: null, status: 'ready' } as any],
      });
      const single = await ensureTestNativeChat(withDrone, {
        droneId: 'drone-a',
        chatName: 'multiple targets',
      });
      const thread = single.threads.find((item) => item.id === single.chatId);
      expect(single.availableWorkspaces.map((workspace) => workspace.label)).toEqual([
        'Drone A',
        'Artifacts',
      ]);
      expect(thread?.enabledWorkspaceIds).toEqual(['drone:drone-a']);
      expect(single.availableTools.map((tool) => tool.name)).not.toContain('set_target');
      expect(single.availableTools.map((tool) => tool.name)).not.toContain('transfer_files');
      expect(withDrone.workspaceIsEnabled(single.chatId, `artifacts:${single.chatId}`)).toBe(false);

      const multiple = await withDrone.updateThread(single.chatId, {
        enabledWorkspaceIds: ['drone:drone-a', `artifacts:${single.chatId}`],
      });
      expect(multiple.availableTools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(['list_targets', 'set_target', 'transfer_files']),
      );
      expect(withDrone.workspaceIsEnabled(single.chatId, `artifacts:${single.chatId}`)).toBe(true);

      const disabled = await withDrone.updateThread(single.chatId, { enabledWorkspaceIds: [] });
      expect(disabled.availableTools.map((tool) => tool.name)).not.toContain('read_file');
      expect(disabled.threads[0]?.enabledWorkspaceIds).toEqual([]);
      expect(
        withDrone.resolvedSystemPrompt(single.chatId, { workspaceTargetCount: 0 }),
      ).toContain('No workspace is enabled for this chat.');

      const reloaded = new HubAssistantService({
        listDrones: async () => [{ id: 'drone-a', name: 'Drone A', group: null, status: 'ready' } as any],
      });
      expect((await reloaded.threadSnapshot(single.chatId)).threads[0]?.enabledWorkspaceIds).toEqual([]);
    });
  });

  test('keeps snapshots available when target discovery fails', async () => {
    await withTempDroneDataDir('assistant-target-discovery-failure-', async () => {
      const service = new HubAssistantService({ listDrones: async () => { throw new Error('registry unavailable'); } });
      const snapshot = await ensureTestNativeChat(service, { chatName: 'fallback tools' });
      expect(snapshot.availableTools.map((tool) => tool.name)).not.toContain('set_target');
      expect(snapshot.availableTools.map((tool) => tool.name)).not.toContain('transfer_files');
    });
  });

  test('preserves implicit workspace access for chats created before workspace toggles', async () => {
    await withTempDroneDataDir('assistant-legacy-workspaces-', async () => {
      const initial = makeAssistantService();
      const created = await ensureTestNativeChat(initial, { chatName: 'legacy workspaces' });
      const stored = await loadAssistantState();
      if (!stored?.threads?.[0]) throw new Error('missing stored assistant thread');
      delete stored.threads[0].enabledWorkspaceIds;
      await saveAssistantState(stored);

      const reloaded = makeAssistantService();
      const snapshot = await reloaded.threadSnapshot(created.chatId);
      expect(snapshot.threads[0]?.enabledWorkspaceIds).toBeUndefined();
      expect(reloaded.workspaceIsEnabled(created.chatId, `artifacts:${created.chatId}`)).toBe(true);
      expect(snapshot.availableTools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          'list_files',
          'read_file',
          'search_files',
          'write_file',
          'delete_file',
          'create_directory',
          'delete_directory',
          'move_path',
          'apply_patch',
        ]),
      );
      expect(snapshot.availableTools.map((tool) => tool.name)).not.toContain('bash');
      expect(snapshot.availableTools.map((tool) => tool.name)).not.toContain(
        'get_working_tree_status',
      );
      const cloned = await reloaded.cloneNativeThread({
        sourceId: created.chatId,
        id: 'legacy-workspace-clone',
        droneId: 'native-test-drone',
        chatName: 'legacy workspace clone',
      });
      expect(cloned.threads[0]?.enabledWorkspaceIds).toBeUndefined();
      expect(
        reloaded.workspaceIsEnabled(
          'legacy-workspace-clone',
          'artifacts:legacy-workspace-clone',
        ),
      ).toBe(true);
    });
  });

  test('enables Artifacts when a chat explicitly attaches a file', async () => {
    await withTempDroneDataDir('assistant-attached-artifact-workspace-', async () => {
      const service = makeAssistantService();
      const created = await ensureTestNativeChat(service, { chatName: 'attached artifact' });
      const artifactWorkspaceId = `artifacts:${created.chatId}`;
      expect(service.workspaceIsEnabled(created.chatId, artifactWorkspaceId)).toBe(false);
      expect(await service.ensureArtifactsWorkspaceEnabled(created.chatId)).toBe(true);
      expect(await service.ensureArtifactsWorkspaceEnabled(created.chatId)).toBe(false);
      const snapshot = await service.threadSnapshot(created.chatId);
      expect(snapshot.threads[0]?.enabledWorkspaceIds).toContain(artifactWorkspaceId);
      expect(snapshot.availableTools.map((tool) => tool.name)).toContain('read_file');
    });
  });

  test('persists the assistant default in the canonical store and applies it to new threads', async () => {
    await withTempDroneDataDir('assistant-system-prompts-', async () => {
      const service = makeAssistantService();
      const settings = await service.updateSystemPrompt({ prompt: 'Assistant prompt.' });
      expect(settings.assistantSystemPrompt.prompt).toBe('Assistant prompt.');

      const snapshot = await ensureTestNativeChat(service, { chatName: 'thread' });
      const thread = snapshot.threads.find((item) => item.id === snapshot.chatId) as any;
      expect(thread.systemPrompt).toBe('Assistant prompt.');

      const stored = await loadAssistantState();
      expect(stored?.systemPrompt).toBe('Assistant prompt.');

      const reloaded = await makeAssistantService().systemPromptSettings();
      expect(reloaded.assistantSystemPrompt.prompt).toBe('Assistant prompt.');
    });
  });

  test('updates thread prompts independently and promotes them to the matching global default', async () => {
    await withTempDroneDataDir('assistant-thread-system-prompt-', async () => {
      const service = makeAssistantService();
      const initial = await ensureTestNativeChat(service, { chatName: 'first' });
      const firstThreadId = initial.chatId;
      const second = await ensureTestNativeChat(service, { chatName: 'second' });

      await service.updateThreadSystemPrompt(firstThreadId, { prompt: 'Thread-only prompt.' });
      let snapshot = await service.threadSnapshot(firstThreadId);
      expect((snapshot.threads.find((thread) => thread.id === firstThreadId) as any).systemPrompt).toBe('Thread-only prompt.');
      expect((await service.threadSnapshot(second.chatId)).threads[0]?.systemPrompt).not.toBe('Thread-only prompt.');

      await service.promoteThreadSystemPrompt(firstThreadId, { prompt: 'Promoted prompt.' });
      expect((await service.systemPromptSettings()).assistantSystemPrompt.prompt).toBe('Promoted prompt.');
      snapshot = await ensureTestNativeChat(service, { chatName: 'third' });
      expect(snapshot.threads[0]?.systemPrompt).toBe('Promoted prompt.');
    });
  });

  test('keeps tool enablement and thinking level as thread metadata for the Blip host', async () => {
    await withTempDroneDataDir('assistant-thread-agent-settings-', async () => {
      const service = makeAssistantService();
      const created = await ensureTestNativeChat(service, { chatName: 'settings', provider: 'openai', model: 'gpt-5.5' });
      const threadId = created.chatId;
      const updated = await service.updateThread(threadId, {
        enabledTools: ['get_system_prompt', 'set_thinking_level'],
        thinkingLevel: 'high',
      });
      const thread = updated.threads.find((item) => item.id === threadId) as any;
      expect(thread.enabledTools).toEqual(['get_system_prompt', 'set_thinking_level']);
      expect(thread.thinkingLevel).toBe('high');
      expect(updated.availableTools.some((tool) => tool.name === 'set_thinking_level')).toBe(true);
    });
  });

  test('drops removed idle tools while normalizing unrelated tool aliases', async () => {
    await withTempDroneDataDir('assistant-legacy-tool-settings-', async () => {
      const service = makeAssistantService();
      const created = await ensureTestNativeChat(service, { chatName: 'legacy tools' });
      const updated = await service.updateThread(created.chatId, {
        enabledTools: [
          'assistant_files',
          'list_changed_files',
          'message_drone',
          'read_chat_messages',
          'subscribe_to_chats_idle',
          'subscribe_to_all_chats_idle',
          'subscribe_to_any_chat_idle',
          'list_chat_idle_subscriptions',
          'cancel_chat_idle_subscription',
        ],
      });
      const thread = updated.threads[0] as any;
      expect(thread.enabledTools).toEqual([
        'list_targets',
        'set_target',
        'get_working_tree_status',
        'send_message',
        'list_chats',
        'read_chat',
      ]);
    });
  });

  test('persists the default model used by new threads', async () => {
    await withTempDroneDataDir('assistant-default-model-', async () => {
      const service = makeAssistantService();
      await service.updateDefaultModel({ provider: 'codex', model: 'gpt-5.5', thinkingLevel: 'high' });

      const reloaded = makeAssistantService();
      const snapshot = await ensureTestNativeChat(reloaded, { chatName: 'default model thread' });
      const thread = snapshot.threads[0] as any;
      expect(snapshot.defaultModel).toEqual({ provider: 'codex', model: 'gpt-5.5', thinkingLevel: 'high' });
      expect(thread.provider).toBe('codex');
      expect(thread.model).toBe('gpt-5.5');
      expect(thread.thinkingLevel).toBe('high');
    });
  });

  test('persists default tools without changing existing threads', async () => {
    await withTempDroneDataDir('assistant-default-tools-', async () => {
      const service = makeAssistantService();
      const existing = await ensureTestNativeChat(service, { chatName: 'existing' });
      const existingThread = existing.threads[0] as any;
      const defaults = ['list_drones', 'read_chat'];

      await service.updateDefaultEnabledTools({ enabledTools: defaults });
      const unchanged = await service.threadSnapshot(existing.chatId);
      expect(unchanged.threads[0]?.enabledTools).toEqual(existingThread.enabledTools);

      const reloaded = makeAssistantService();
      const created = await ensureTestNativeChat(reloaded, { chatName: 'new defaults' });
      const thread = created.threads[0] as any;
      expect(created.defaultEnabledTools).toEqual(defaults);
      expect(thread.enabledTools).toEqual(defaults);
    });
  });

});
