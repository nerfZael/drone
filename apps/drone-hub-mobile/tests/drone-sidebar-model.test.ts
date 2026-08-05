import { describe, expect, test } from 'bun:test';
import {
  EMPTY_MOBILE_DRONE_LIST_SNAPSHOT,
  EMPTY_MOBILE_DRONE_SIDEBAR_ORDER,
  buildMobileDroneRepoGroups,
  mobileDroneTurnsToAssistantMessages,
  normalizeMobileDroneListPayload,
  normalizeMobileDroneCreateModelCatalog,
  normalizeMobileDroneChatModelCatalog,
  normalizeMobileNativeChatHistory,
  normalizeMobileDroneTurns,
  normalizeMobileDrones,
  orderedMobileDroneChats,
  resolveMobileDroneListSnapshot,
  suggestNextMobileDroneChatName,
} from '../src/drones/drone-sidebar-model';

describe('mobile drone sidebar model', () => {
  test('normalizes detected create models and their supported reasoning levels', () => {
    expect(
      normalizeMobileDroneCreateModelCatalog({
        models: [
          {
            provider: 'codex',
            id: 'gpt-5.2-codex',
            label: 'GPT-5.2 Codex',
            reasoningLevels: ['low', 'medium', 'high', 'high'],
            defaultReasoningLevel: 'medium',
          },
          { provider: 'codex', id: 'gpt-5.2-codex', label: 'duplicate' },
          { provider: 'openai', id: 'gpt-5.2-codex', label: 'OpenAI variant' },
        ],
      }),
    ).toEqual([
      {
        provider: 'codex',
        id: 'gpt-5.2-codex',
        label: 'GPT-5.2 Codex',
        reasoningLevels: ['low', 'medium', 'high'],
        defaultReasoningLevel: 'medium',
      },
      {
        provider: 'openai',
        id: 'gpt-5.2-codex',
        label: 'OpenAI variant',
        reasoningLevels: [],
        defaultReasoningLevel: '',
      },
    ]);
  });

  test('normalizes chat models with the agent as a fallback provider', () => {
    expect(
      normalizeMobileDroneChatModelCatalog(
        {
          models: [
            {
              id: 'gpt-chat',
              name: 'GPT Chat',
              thinkingLevel: 'HIGH',
            },
            { id: 'gpt-chat', label: 'duplicate' },
          ],
        },
        'codex',
      ),
    ).toEqual([
      {
        provider: 'codex',
        id: 'gpt-chat',
        label: 'GPT Chat',
        reasoningLevels: ['high'],
        defaultReasoningLevel: 'high',
      },
    ]);
  });

  test('names a newly cloned chat after the highest existing chat number', () => {
    expect(suggestNextMobileDroneChatName([])).toBe('chat-1');
    expect(suggestNextMobileDroneChatName(['default'])).toBe('chat-2');
    expect(suggestNextMobileDroneChatName(['default', 'chat-7', 'review'])).toBe('chat-8');
  });

  test('groups drones by repo and preserves fleet and chat hierarchy', () => {
    const drones = normalizeMobileDrones([
      {
        id: 'child',
        name: 'Child',
        repoPath: '/work/alpha',
        fleetParentId: 'parent',
        chats: ['default', 'review'],
      },
      { id: 'loose', name: 'Loose', chats: [] },
      { id: 'parent', name: 'Parent', repoPath: '/work/alpha', chats: ['default'] },
      {
        id: 'beta',
        name: 'Beta',
        repoPath: '/work/beta',
        group: 'Delivery/Review',
        chats: ['planning'],
      },
    ]);

    const groups = buildMobileDroneRepoGroups(drones);
    expect(groups.map((group) => group.label)).toEqual(['Ungrouped', 'alpha', 'beta']);
    expect(groups[1]?.roots.map((node) => node.drone.id)).toEqual(['parent']);
    expect(groups[1]?.roots[0]?.children.map((node) => node.drone.id)).toEqual(['child']);
    expect(groups[1]?.roots[0]?.children[0]?.drone.chats).toEqual(['default', 'review']);
    expect(groups[0]?.roots[0]?.drone.chats).toEqual(['default']);
    expect(groups[2]?.folders[0]).toMatchObject({
      path: 'Delivery',
      label: 'Delivery',
      droneCount: 1,
    });
    expect(groups[2]?.folders[0]?.children[0]).toMatchObject({
      path: 'Delivery/Review',
      label: 'Review',
      droneCount: 1,
    });
    expect(groups[2]?.folders[0]?.children[0]?.roots[0]?.drone.id).toBe('beta');
  });

  test('uses non-empty legacy repository metadata before falling back to Ungrouped', () => {
    const drones = normalizeMobileDrones([
      {
        id: 'nested',
        repoPath: '',
        repo: { path: '/work/nested', branch: 'feature/nested' },
      },
      { id: 'legacy', repositoryPath: '/work/legacy', repoBranch: 'dvm/work' },
    ]);

    expect(buildMobileDroneRepoGroups(drones).map((group) => group.label)).toEqual([
      'legacy',
      'nested',
    ]);
    expect(drones.map((drone) => drone.repoBranch)).toEqual(['feature/nested', 'dvm/work']);
  });

  test('preserves an explicit detached repository state', () => {
    const [drone] = normalizeMobileDrones([
      { id: 'detached', repoPath: '/work/detached', repoAttached: false },
    ]);

    expect(drone?.repoAttached).toBe(false);
  });

  test('uses the versioned repository map when individual summaries omit their paths', () => {
    const payload = normalizeMobileDroneListPayload({
      schemaVersion: 2,
      drones: [{ id: 'mapped', name: 'Mapped' }],
      repoPathByDroneId: { mapped: '/work/mapped' },
    });

    expect(payload.schemaVersion).toBe(2);
    expect(buildMobileDroneRepoGroups(payload.drones)[0]?.label).toBe('mapped');
  });

  test('normalizes last-message timestamps and desktop sidebar preferences', () => {
    const payload = normalizeMobileDroneListPayload({
      schemaVersion: 3,
      drones: [
        {
          id: 'mapped',
          lastMessageAt: '2026-07-14T10:00:00.000Z',
          chats: ['default', 'review'],
          draftChats: { review: true, default: false, missing: true },
          unreadChats: ['default'],
          chatReadStates: {
            default: {
              unread: false,
              latestAgentTurnId: null,
              latestAgentRevision: 0,
            },
            review: {
              unread: true,
              latestAgentTurnId: 'turn-2',
              latestAgentRevision: 2,
            },
          },
        },
      ],
      sidebar: {
        registeredRepoPaths: ['/work/mapped', '/work/empty'],
        groupCreatedAtByName: { Review: '2026-07-13T10:00:00.000Z' },
        sidebarGroupOrder: ['repo:repo:/work/mapped'],
        sidebarDroneOrderByGroup: { 'group:Review': ['mapped'] },
        sidebarNodeOrderByParent: { root: ['drone:mapped'] },
        sidebarChatOrderByDrone: { mapped: ['review', 'default'] },
        pinnedDroneIds: ['mapped'],
      },
    });

    expect(payload.drones[0]?.lastMessageAt).toBe('2026-07-14T10:00:00.000Z');
    expect(payload.drones[0]?.unreadChats).toEqual(['review']);
    expect(payload.drones[0]?.draftChats).toEqual({ review: true });
    expect(payload.drones[0]?.chatReadStates?.review).toEqual({
      unread: true,
      latestAgentTurnId: 'turn-2',
      latestAgentRevision: 2,
    });
    expect(payload.sidebar).toEqual({
      registeredRepoPaths: ['/work/mapped', '/work/empty'],
      groupCreatedAtByName: { Review: '2026-07-13T10:00:00.000Z' },
      sidebarGroupOrder: ['repo:repo:/work/mapped'],
      sidebarDroneOrderByGroup: { 'group:Review': ['mapped'] },
      sidebarNodeOrderByParent: { root: ['drone:mapped'] },
      sidebarChatOrderByDrone: { mapped: ['review', 'default'] },
      pinnedDroneIds: ['mapped'],
    });
    expect(
      orderedMobileDroneChats(payload.drones[0]!, payload.sidebar.sidebarChatOrderByDrone.mapped),
    ).toEqual(['review', 'default']);
    expect(payload.sidebarSnapshotStatus).toBe('legacy');
  });

  test('preserves the last complete sidebar snapshot across partial refreshes and reconnects', () => {
    const initialPayload = normalizeMobileDroneListPayload({
      schemaVersion: 7,
      drones: [
        { id: 'first', repoPath: '/repo', status: 'idle' },
        { id: 'second', repoPath: '/repo', status: 'idle' },
      ],
      sidebar: {
        snapshotComplete: true,
        preferenceVersion: 8,
        registeredRepoPaths: ['/repo', '/empty'],
        sidebarDroneOrderByGroup: { 'group:Ungrouped': ['second', 'first'] },
        pinnedDroneIds: ['first'],
      },
    });
    const initial = resolveMobileDroneListSnapshot({
      current: EMPTY_MOBILE_DRONE_LIST_SNAPSHOT,
      targetId: 'hub-a',
      payload: initialPayload,
    });
    const partialPayload = normalizeMobileDroneListPayload({
      schemaVersion: 7,
      drones: [
        { id: 'first', repoPath: '/repo', status: 'working', unreadChats: ['default'] },
        { id: 'second', repoPath: '/repo', status: 'idle' },
      ],
      sidebar: {
        snapshotComplete: false,
        registeredRepoPaths: [],
        sidebarDroneOrderByGroup: {},
        pinnedDroneIds: [],
      },
    });
    const refreshed = resolveMobileDroneListSnapshot({
      current: initial,
      targetId: 'hub-a',
      payload: partialPayload,
    });
    const reconnected = resolveMobileDroneListSnapshot({
      current: refreshed,
      targetId: 'hub-a',
      payload: normalizeMobileDroneListPayload({
        schemaVersion: 7,
        drones: partialPayload.drones,
        sidebar: {
          snapshotComplete: true,
          preferenceVersion: 9,
          registeredRepoPaths: ['/empty', '/repo'],
          sidebarDroneOrderByGroup: { 'group:Ungrouped': ['first', 'second'] },
          pinnedDroneIds: ['second'],
        },
      }),
    });
    const staleRefresh = resolveMobileDroneListSnapshot({
      current: reconnected,
      targetId: 'hub-a',
      payload: normalizeMobileDroneListPayload({
        schemaVersion: 7,
        drones: [
          { id: 'first', repoPath: '/repo', status: 'offline' },
          { id: 'second', repoPath: '/repo', status: 'idle' },
        ],
        sidebar: {
          snapshotComplete: true,
          preferenceVersion: 8,
          registeredRepoPaths: ['/repo'],
          sidebarDroneOrderByGroup: { 'group:Ungrouped': ['second', 'first'] },
          pinnedDroneIds: ['first'],
        },
      }),
    });
    const refreshDuringPinSave = resolveMobileDroneListSnapshot({
      current: reconnected,
      targetId: 'hub-a',
      keepCurrentSidebar: true,
      payload: normalizeMobileDroneListPayload({
        schemaVersion: 7,
        drones: reconnected.drones,
        sidebar: {
          snapshotComplete: true,
          preferenceVersion: 10,
          registeredRepoPaths: ['/repo'],
          pinnedDroneIds: [],
        },
      }),
    });

    expect(initial.sidebarSnapshotStatus).toBe('complete');
    expect(initial.sidebarPreferenceVersion).toBe(8);
    expect(refreshed.drones[0]).toMatchObject({
      id: 'first',
      status: 'working',
      unreadChats: ['default'],
    });
    expect(refreshed.sidebar).toBe(initial.sidebar);
    expect(refreshed.sidebarSnapshotStatus).toBe('complete');
    expect(refreshed.sidebarPreferenceVersion).toBe(8);
    expect(reconnected.sidebarPreferenceVersion).toBe(9);
    expect(reconnected.sidebar.registeredRepoPaths).toEqual(['/empty', '/repo']);
    expect(reconnected.sidebar.sidebarDroneOrderByGroup['group:Ungrouped']).toEqual([
      'first',
      'second',
    ]);
    expect(reconnected.sidebar.pinnedDroneIds).toEqual(['second']);
    expect(staleRefresh.drones[0]?.status).toBe('offline');
    expect(staleRefresh.sidebar).toBe(reconnected.sidebar);
    expect(staleRefresh.sidebarPreferenceVersion).toBe(9);
    expect(refreshDuringPinSave.sidebar).toBe(reconnected.sidebar);
    expect(refreshDuringPinSave.sidebarPreferenceVersion).toBe(9);
  });

  test('uses deterministic compatibility fallbacks for older, missing, and switched-device payloads', () => {
    const legacyPayload = normalizeMobileDroneListPayload({
      schemaVersion: 6,
      drones: [{ id: 'legacy', repoPath: '/legacy' }],
      sidebar: {
        registeredRepoPaths: ['/legacy'],
        pinnedDroneIds: ['legacy'],
      },
    });
    const legacy = resolveMobileDroneListSnapshot({
      current: EMPTY_MOBILE_DRONE_LIST_SNAPSHOT,
      targetId: 'old-hub',
      payload: legacyPayload,
    });
    const missingPayload = normalizeMobileDroneListPayload({
      schemaVersion: 6,
      drones: [{ id: 'new', repoPath: '/new' }],
    });
    const switched = resolveMobileDroneListSnapshot({
      current: legacy,
      targetId: 'new-hub',
      payload: missingPayload,
    });

    expect(legacy.sidebarSnapshotStatus).toBe('legacy');
    expect(legacy.sidebar.registeredRepoPaths).toEqual(['/legacy']);
    expect(missingPayload.sidebarSnapshotStatus).toBe('missing');
    expect(switched.sidebar).toBe(EMPTY_MOBILE_DRONE_SIDEBAR_ORDER);
    expect(switched.sidebarSnapshotStatus).toBe('missing');
  });

  test('changes status and unread state without changing saved item order', () => {
    const sidebar = {
      snapshotComplete: true,
      preferenceVersion: 3,
      registeredRepoPaths: ['/repo'],
      sidebarDroneOrderByGroup: { 'group:Ungrouped': ['second', 'first'] },
    };
    const before = normalizeMobileDroneListPayload({
      schemaVersion: 7,
      drones: [
        { id: 'first', repoPath: '/repo', status: 'idle' },
        { id: 'second', repoPath: '/repo', status: 'idle' },
      ],
      sidebar,
    });
    const after = normalizeMobileDroneListPayload({
      schemaVersion: 7,
      drones: [
        {
          id: 'first',
          repoPath: '/repo',
          status: 'working',
          chats: ['default'],
          unreadChats: ['default'],
        },
        { id: 'second', repoPath: '/repo', status: 'offline' },
      ],
      sidebar,
    });

    expect(
      buildMobileDroneRepoGroups(before.drones, before.sidebar)[0]?.roots.map(
        (node) => node.drone.id,
      ),
    ).toEqual(['second', 'first']);
    expect(
      buildMobileDroneRepoGroups(after.drones, after.sidebar)[0]?.roots.map(
        (node) => node.drone.id,
      ),
    ).toEqual(['second', 'first']);
  });

  test('normalizes repo and branch choices for the mobile create screen', () => {
    const payload = normalizeMobileDroneListPayload({
      schemaVersion: 4,
      createOptions: {
        repos: [
          {
            path: '/work/drone',
            hostBranch: 'main',
            remoteBranches: [
              { name: 'origin/main', remote: 'origin', branch: 'main' },
              { name: '', remote: 'origin', branch: 'ignored' },
            ],
          },
          { path: '/work/broken', branchesError: 'Not a git repository' },
        ],
      },
    });

    expect(payload.createRepos).toEqual([
      {
        path: '/work/drone',
        hostBranch: 'main',
        remoteBranches: [{ name: 'origin/main', remote: 'origin', branch: 'main' }],
        branchesError: null,
        branchesLoaded: true,
      },
      {
        path: '/work/broken',
        hostBranch: null,
        remoteBranches: [],
        branchesError: 'Not a git repository',
        branchesLoaded: true,
      },
    ]);
  });

  test('preserves unloaded repo stubs for lazy branch fetching', () => {
    const payload = normalizeMobileDroneListPayload({
      schemaVersion: 6,
      createOptions: {
        repos: [
          {
            path: '/work/drone',
            hostBranch: null,
            remoteBranches: [],
            branchesError: null,
            branchesLoaded: false,
          },
        ],
      },
    });

    expect(payload.createRepos).toEqual([
      {
        path: '/work/drone',
        hostBranch: null,
        remoteBranches: [],
        branchesError: null,
        branchesLoaded: false,
      },
    ]);
  });

  test('keeps orphaned and cyclic children reachable at the repo root', () => {
    const drones = normalizeMobileDrones([
      { id: 'orphan', fleetParentId: 'missing', repoPath: '/repo' },
      { id: 'a', fleetParentId: 'b', repoPath: '/repo' },
      { id: 'b', fleetParentId: 'a', repoPath: '/repo' },
    ]);

    expect(buildMobileDroneRepoGroups(drones)[0]?.roots.map((node) => node.drone.id)).toEqual([
      'a',
      'b',
      'orphan',
    ]);
  });

  test('orders newest drones first inside each tree level', () => {
    const drones = normalizeMobileDrones([
      { id: 'old', name: 'Old', repoPath: '/repo', createdAt: '2026-01-01T00:00:00Z' },
      { id: 'parent', name: 'Parent', repoPath: '/repo', createdAt: '2026-02-01T00:00:00Z' },
      {
        id: 'new-child',
        name: 'New child',
        repoPath: '/repo',
        fleetParentId: 'parent',
        createdAt: '2026-04-01T00:00:00Z',
      },
      {
        id: 'old-child',
        name: 'Old child',
        repoPath: '/repo',
        fleetParentId: 'parent',
        createdAt: '2026-03-01T00:00:00Z',
      },
    ]);

    const roots = buildMobileDroneRepoGroups(drones)[0]!.roots;
    expect(roots.map((node) => node.drone.id)).toEqual(['parent', 'old']);
    expect(roots[0]!.children.map((node) => node.drone.id)).toEqual(['new-child', 'old-child']);
  });

  test('matches saved desktop repo, group, drone, and mixed node ordering', () => {
    const drones = normalizeMobileDrones([
      {
        id: 'direct',
        name: 'Direct',
        repoPath: '/repo',
        createdAt: '2026-04-01T00:00:00Z',
      },
      {
        id: 'review-new',
        name: 'Review new',
        repoPath: '/repo',
        group: 'Review',
        createdAt: '2026-03-01T00:00:00Z',
      },
      {
        id: 'review-old',
        name: 'Review old',
        repoPath: '/repo',
        group: 'Review',
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'planning',
        name: 'Planning',
        repoPath: '/repo',
        group: 'Planning',
      },
    ]);
    const groups = buildMobileDroneRepoGroups(drones, {
      registeredRepoPaths: ['/alpha', '/repo'],
      groupCreatedAtByName: {
        Planning: '2026-01-01T00:00:00Z',
        Review: '2026-02-01T00:00:00Z',
      },
      sidebarGroupOrder: ['repo:repo:/repo', 'group:Planning', 'group:Review'],
      sidebarDroneOrderByGroup: {
        'group:Review': ['review-old', 'review-new'],
      },
      sidebarNodeOrderByParent: {
        'folder:repo:/repo': [
          'drone:direct',
          'folder:repo-scope:repo:/repo:Planning',
          'folder:repo-scope:repo:/repo:Review',
        ],
      },
    });

    expect(groups.map((group) => group.repoPath)).toEqual(['/repo', '/alpha']);
    expect(
      groups[0]!.entries.map((entry) =>
        entry.kind === 'drone' ? entry.node.drone.id : entry.folder.path,
      ),
    ).toEqual(['direct', 'Planning', 'Review']);
    expect(groups[0]!.folders[1]!.roots.map((node) => node.drone.id)).toEqual([
      'review-old',
      'review-new',
    ]);
  });

  test('projects each drone turn into the shared user and assistant transcript model', () => {
    expect(
      mobileDroneTurnsToAssistantMessages([
        { prompt: 'Inspect this', ok: true, output: 'Done' },
        { prompt: 'Try again', ok: false, error: 'Agent failed' },
      ]),
    ).toEqual([
      { role: 'user', content: 'Inspect this' },
      { role: 'assistant', content: 'Done' },
      { role: 'user', content: 'Try again' },
      {
        role: 'assistant',
        isError: true,
        errorMessage: 'Agent failed',
      },
    ]);
  });

  test('keeps drone prompt attachments in the shared assistant presentation', () => {
    expect(
      mobileDroneTurnsToAssistantMessages([
        {
          prompt: 'Review this',
          attachments: [{ name: 'plan.md', mime: 'text/markdown', size: 42 }],
          output: 'Looks good',
        },
      ])[0],
    ).toEqual({
      role: 'user',
      content: 'Review this',
      details: {
        attachments: [{ name: 'plan.md', mime: 'text/markdown', size: 42 }],
      },
    });
  });

  test('maps drone prompt and completion times onto chat messages', () => {
    expect(
      mobileDroneTurnsToAssistantMessages([
        {
          prompt: 'Ship it',
          output: 'Done',
          promptAt: '2026-07-14T09:59:58.000Z',
          completedAt: '2026-07-14T10:00:02.000Z',
        },
      ]),
    ).toEqual([
      {
        role: 'user',
        content: 'Ship it',
        createdAt: '2026-07-14T09:59:58.000Z',
      },
      {
        role: 'assistant',
        content: 'Done',
        createdAt: '2026-07-14T10:00:02.000Z',
      },
    ]);
  });

  test('carries a completed external-agent plan into the mobile run metadata', () => {
    expect(
      mobileDroneTurnsToAssistantMessages([
        {
          id: 'turn-with-plan',
          prompt: 'Implement it',
          output: 'Done',
          agentPlan: {
            items: [{ text: 'Edit the transcript', status: 'completed' }],
            source: 'codex',
          },
        },
      ])[1],
    ).toMatchObject({
      role: 'assistant',
      details: {
        mobileRun: {
          id: 'turn-with-plan',
          plan: { items: [{ text: 'Edit the transcript', status: 'completed' }] },
        },
      },
    });
  });

  test('projects external reasoning and tool activity without duplicating the final answer', () => {
    const messages = mobileDroneTurnsToAssistantMessages([
      {
        id: 'turn-with-activity',
        prompt: 'Inspect it',
        output: 'Finished.',
        activity: {
          version: 1,
          source: 'codex',
          updatedAt: '2026-07-24T00:00:01.000Z',
          messages: [
            {
              role: 'assistant',
              content: [{ type: 'thinking', thinking: 'Inspecting.' }],
            },
            {
              role: 'assistant',
              content: [
                {
                  type: 'toolCall',
                  id: 'tool-1',
                  name: 'command_execution',
                  arguments: { command: 'git status' },
                },
              ],
            },
            {
              role: 'toolResult',
              toolCallId: 'tool-1',
              toolName: 'command_execution',
              content: 'clean',
            },
            {
              role: 'assistant',
              content: [{ type: 'text', text: 'Finished.' }],
            },
          ],
        },
      },
    ]);

    expect(messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'assistant',
      'toolResult',
      'assistant',
    ]);
    expect(
      messages.filter(
        (message) =>
          message.role === 'assistant' &&
          (typeof message.content === 'string'
            ? message.content === 'Finished.'
            : message.content?.some((part) => part.text === 'Finished.')),
      ),
    ).toHaveLength(1);
  });

  test('discloses trimmed external activity details', () => {
    const messages = mobileDroneTurnsToAssistantMessages([
      {
        id: 'trimmed-activity',
        prompt: 'Inspect it',
        output: 'Finished.',
        activity: {
          version: 1,
          source: 'claude',
          updatedAt: '2026-07-24T00:00:01.000Z',
          truncated: true,
          messages: [
            {
              role: 'assistant',
              content: [{ type: 'text', text: 'Finished.' }],
            },
          ],
        },
      },
    ]);

    expect(
      messages.some(
        (message) => message.content === 'Earlier or oversized activity details were trimmed.',
      ),
    ).toBe(true);
  });

  test('ignores stale error text on successful activity-backed turns', () => {
    const messages = mobileDroneTurnsToAssistantMessages([
      {
        id: 'successful-activity',
        prompt: 'Inspect it',
        ok: true,
        output: 'Finished.',
        error: 'stale failure',
        activity: {
          version: 1,
          source: 'opencode',
          updatedAt: '2026-07-24T00:00:01.000Z',
          messages: [
            {
              role: 'assistant',
              content: [{ type: 'text', text: 'Finished.' }],
            },
          ],
        },
      },
    ]);

    expect(messages.some((message) => message.content === 'stale failure')).toBe(false);
    expect(messages.filter((message) => message.role === 'assistant')).toHaveLength(1);
  });

  test('adds active pending activity to the mobile transcript with its plan and file summary', () => {
    const fileChanges = {
      version: 1 as const,
      capturedAt: '2026-07-24T00:00:02.000Z',
      counts: { changed: 1, additions: 2, deletions: 0 },
      workspaces: [],
    };
    const messages = mobileDroneTurnsToAssistantMessages(
      [],
      [
        {
          id: 'pending-activity',
          at: '2026-07-24T00:00:00.000Z',
          startedAt: '2026-07-24T00:00:30.000Z',
          prompt: 'Implement it',
          state: 'sent',
          agentPlan: {
            source: 'codex',
            items: [{ text: 'Implement', status: 'in_progress' }],
          },
          fileChanges,
          activityMeshTruncated: true,
          activity: {
            version: 1,
            source: 'codex',
            updatedAt: '2026-07-24T00:00:01.000Z',
            messages: [
              {
                role: 'assistant',
                content: [{ type: 'thinking', thinking: 'Working through it.' }],
              },
            ],
          },
        },
      ],
    );

    expect(messages[0]).toMatchObject({
      id: 'pending-activity:user',
      role: 'user',
      details: {
        mobileRun: {
          startedAt: '2026-07-24T00:00:30.000Z',
          plan: { items: [{ text: 'Implement', status: 'in_progress' }] },
        },
      },
    });
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'Working through it.' }],
    });
    expect(messages[2]).toMatchObject({
      role: 'runSummary',
      details: { fileChanges: { counts: { changed: 1 } } },
    });
    expect(messages.some((message) => message.meshTruncated === true)).toBe(false);
  });

  test('preserves failed pending activity, settles its tools, and appends the failure', () => {
    const messages = mobileDroneTurnsToAssistantMessages(
      [],
      [
        {
          id: 'failed-activity',
          at: '2026-07-24T00:00:00.000Z',
          startedAt: '2026-07-24T00:00:30.000Z',
          updatedAt: '2026-07-24T00:00:02.000Z',
          prompt: 'Implement it',
          state: 'failed',
          error: 'Agent crashed',
          activity: {
            version: 1,
            source: 'codex',
            updatedAt: '2026-07-24T00:00:01.000Z',
            messages: [
              {
                role: 'assistant',
                content: [{ type: 'toolCall', id: 'tool-1', name: 'exec', arguments: {} }],
              },
            ],
          },
        },
      ],
    );

    expect(messages[0]).toMatchObject({
      id: 'failed-activity:user',
      role: 'user',
      details: {
        mobileRun: {
          startedAt: '2026-07-24T00:00:30.000Z',
          completedAt: '2026-07-24T00:00:02.000Z',
        },
      },
    });
    expect(messages.some((message) => message.role === 'toolResult')).toBe(true);
    expect(messages.at(-1)).toMatchObject({
      id: 'failed-activity:assistant',
      role: 'assistant',
      isError: true,
      errorMessage: 'Agent crashed',
    });
  });

  test('preserves stopped pending activity without turning the stop into an error message', () => {
    const messages = mobileDroneTurnsToAssistantMessages(
      [],
      [
        {
          id: 'stopped-activity',
          at: '2026-07-24T00:00:00.000Z',
          updatedAt: '2026-07-24T00:00:02.000Z',
          prompt: 'Implement it',
          state: 'failed',
          error: 'Stopped by user.',
          activity: {
            version: 1,
            source: 'codex',
            updatedAt: '2026-07-24T00:00:01.000Z',
            messages: [
              {
                role: 'assistant',
                content: [{ type: 'thinking', thinking: 'Working through it.' }],
              },
            ],
          },
        },
      ],
    );

    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(messages.some((message) => message.isError)).toBe(false);
  });

  test('normalizes DroneHub transcript metadata for the native chat presentation', () => {
    expect(
      normalizeMobileDroneTurns([
        {
          turn: 4,
          at: '2026-07-14T10:00:00.000Z',
          promptAt: '2026-07-14T09:59:58.000Z',
          completedAt: '2026-07-14T10:00:02.000Z',
          prompt: 'Ship it',
          output: 'Done',
          model: 'gpt-5.2-codex',
          agentPlan: {
            items: [{ id: 'step-1', text: 'Ship the change', status: 'in_progress' }],
            source: 'codex',
            updatedAt: '2026-07-14T10:00:01.000Z',
          },
          attachments: [{ name: 'plan.md', mime: 'text/markdown', size: 42 }],
        },
      ])[0],
    ).toMatchObject({
      id: 'turn-4',
      turn: 4,
      prompt: 'Ship it',
      output: 'Done',
      ok: true,
      model: 'gpt-5.2-codex',
      agentPlan: {
        items: [{ id: 'step-1', text: 'Ship the change', status: 'in_progress' }],
        source: 'codex',
      },
      attachments: [{ name: 'plan.md', mime: 'text/markdown', size: 42 }],
    });
  });

  test('unwraps paged native history entries for the transcript', () => {
    expect(
      normalizeMobileNativeChatHistory({
        entries: [
          {
            id: 'message-1',
            meshTruncated: true,
            message: { id: 'inner-id', role: 'assistant', content: 'A bounded response' },
          },
        ],
        page: {
          beforeCursor: 42,
          hasOlder: true,
          responseTruncated: true,
          contentTruncated: true,
        },
      }),
    ).toEqual({
      messages: [
        {
          id: 'message-1',
          role: 'assistant',
          content: 'A bounded response',
          meshTruncated: true,
        },
      ],
      page: {
        beforeCursor: 42,
        hasOlder: true,
        responseTruncated: true,
        contentTruncated: true,
      },
    });
  });

  test('preserves changed-file summaries for external and native agents', () => {
    const fileChanges = {
      version: 1 as const,
      capturedAt: '2026-07-21T00:00:00.000Z',
      counts: { changed: 1, additions: 2, deletions: 0 },
      workspaces: [],
    };
    const external = mobileDroneTurnsToAssistantMessages([
      { id: 'turn-1', prompt: 'Change it', output: 'Done', fileChanges },
    ]);
    const native = normalizeMobileNativeChatHistory({
      entries: [
        {
          id: 'summary-1',
          message: { role: 'runSummary', content: '', details: { fileChanges } },
        },
      ],
    });

    expect(external.at(-1)).toMatchObject({
      role: 'runSummary',
      details: { fileChanges: { counts: { changed: 1 } } },
    });
    expect(native.messages[0]).toMatchObject({
      id: 'summary-1',
      role: 'runSummary',
      details: { fileChanges: { counts: { changed: 1 } } },
    });
  });

  test('offers full-content loading only on the truncated side of an external turn', () => {
    const messages = mobileDroneTurnsToAssistantMessages([
      {
        id: 'turn-1',
        prompt: 'Short prompt',
        output: 'Bounded response',
        responseTruncated: true,
      },
    ]);

    expect(messages[0]).toMatchObject({ role: 'user', content: 'Short prompt' });
    expect(messages[0]?.meshTruncated).toBeUndefined();
    expect(messages[1]).toMatchObject({
      id: 'turn-1:assistant',
      role: 'assistant',
      meshTruncated: true,
    });
  });

  test('offers full loading on the fallback response when only tool activity was trimmed', () => {
    const messages = mobileDroneTurnsToAssistantMessages([
      {
        id: 'turn-tool-activity',
        prompt: 'Inspect it',
        output: 'Done.',
        activityMeshTruncated: true,
        activity: {
          version: 1,
          source: 'pi',
          updatedAt: '2026-07-24T00:00:01.000Z',
          messages: [
            {
              role: 'assistant',
              content: [
                {
                  type: 'toolCall',
                  id: 'tool-1',
                  name: 'read',
                  arguments: {},
                },
              ],
            },
          ],
        },
      },
    ]);

    expect(messages.at(-1)).toMatchObject({
      id: 'turn-tool-activity:assistant',
      role: 'assistant',
      content: 'Done.',
      meshTruncated: true,
    });
  });

  test('preserves raw phone-hosted native chat messages', () => {
    expect(
      normalizeMobileNativeChatHistory([
        { id: 'user-1', role: 'user', content: 'Hello from the phone' },
        { id: 'assistant-1', role: 'assistant', content: 'Hello back' },
      ]),
    ).toEqual({
      messages: [
        { id: 'user-1', role: 'user', content: 'Hello from the phone' },
        { id: 'assistant-1', role: 'assistant', content: 'Hello back' },
      ],
      page: {
        beforeCursor: null,
        hasOlder: false,
        responseTruncated: false,
        contentTruncated: false,
      },
    });
  });
});
