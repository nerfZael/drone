import { describe, expect, test } from 'bun:test';

import {
  composerSideChatFamily,
  isGeneratedSideChatName,
  newComposerSideChatName,
  sideChatDescendantNames,
  withoutComposerSideChats,
  type SummarySideChat,
} from '../src/droneHub/app/composer-side-chats';
import { buildDroneBoardMembers } from '../src/droneHub/canvas/drone-board';
import { recordingSideChatShortcut } from '../src/droneHub/chat/chat-send-shortcuts';
import { ActiveComposerRegistry, type ActiveComposer } from '../src/droneHub/chat/ActiveComposerContext';
import {
  buildCanvasChatDeleteConfirmation,
  buildSidebarChatDeleteConfirmation,
  buildSidebarChatGroupDeleteConfirmation,
} from '../src/droneHub/app/sidebar-chat-delete-confirmation';

const agent = { kind: 'builtin', id: 'claude' };

function side(name: string, sourceChatName: string, extra: Partial<SummarySideChat> = {}): SummarySideChat {
  return { name, sourceChatName, agent, presentation: 'composer', kind: 'fork', ...extra };
}

describe('composer side chat family', () => {
  const sideChats: SummarySideChat[] = [
    side('side-00000002', 'plan', { kind: 'new', createdAt: '2026-10-15T10:02:00Z', busy: true }),
    side('Lava cracks', 'plan', { createdAt: '2026-10-15T10:01:00Z' }),
    side('side-00000003', 'Lava cracks', { createdAt: '2026-10-15T10:03:00Z' }),
    side('side-00000004', 'plan', { createdAt: '2026-10-15T10:04:00Z' }),
    side('side-00000009', 'other', { createdAt: '2026-10-15T10:00:00Z' }),
    // A floating fork is a window, not a chip.
    { name: 'side-0000000f', sourceChatName: 'plan', checkpointId: 'a', agent },
  ];

  test('lists the side chats of a chat and of its side chats, oldest first', () => {
    const family = composerSideChatFamily(sideChats, 'plan');
    expect(family.rootChatName).toBe('plan');
    expect(family.chips.map((chip) => chip.name)).toEqual([
      'Lava cracks',
      'side-00000002',
      'side-00000003',
      'side-00000004',
    ]);
    expect(family.chips.find((chip) => chip.name === 'side-00000002')).toMatchObject({ kind: 'new', busy: true });
  });

  test('names unnamed chips by kind and order, and uses a chat name once it has one', () => {
    expect(composerSideChatFamily(sideChats, 'plan').chips.map((chip) => chip.label)).toEqual([
      'Lava cracks',
      'New chat 1',
      'Fork 2',
      'Fork 3',
    ]);
  });

  test('a side chat shows the same row as the chat it came from', () => {
    for (const viewing of ['Lava cracks', 'side-00000003']) {
      const family = composerSideChatFamily(sideChats, viewing);
      expect(family.rootChatName).toBe('plan');
      expect(family.chips.map((chip) => chip.name)).toEqual(
        composerSideChatFamily(sideChats, 'plan').chips.map((chip) => chip.name),
      );
    }
    expect(composerSideChatFamily(sideChats, 'other').chips.map((chip) => chip.name)).toEqual(['side-00000009']);
    expect(composerSideChatFamily(sideChats, 'unrelated')).toEqual({ rootChatName: 'unrelated', chips: [] });
  });

  test('shows a just-sent side chat until the Hub lists it, then only once', () => {
    const pending = [
      { name: 'side-0000000a', sourceChatName: 'side-00000003', kind: 'new' as const, createdAt: '2026-10-15T10:05:00Z' },
      { name: 'side-00000004', sourceChatName: 'plan', kind: 'fork' as const, createdAt: '2026-10-15T10:04:00Z' },
    ];
    const chips = composerSideChatFamily(sideChats, 'plan', pending).chips;
    expect(chips.filter((chip) => chip.name === 'side-00000004')).toEqual([
      expect.objectContaining({ pending: false }),
    ]);
    expect(chips.at(-1)).toMatchObject({ name: 'side-0000000a', pending: true, busy: true, label: 'New chat 2' });
  });

  test('survives a source loop', () => {
    const looped = [side('side-0000000a', 'side-0000000b'), side('side-0000000b', 'side-0000000a')];
    const family = composerSideChatFamily(looped, 'side-0000000a');
    expect(family.chips.map((chip) => chip.name).sort()).toEqual(['side-0000000a', 'side-0000000b']);
  });

  test('side chats of any kind go with their source when it is deleted', () => {
    expect(sideChatDescendantNames(sideChats, ['plan'])).toEqual([
      'side-00000002',
      'Lava cracks',
      'side-00000004',
      'side-0000000f',
      'side-00000003',
    ]);
    expect(sideChatDescendantNames(sideChats, ['Lava cracks'])).toEqual(['side-00000003']);
    expect(sideChatDescendantNames(sideChats, ['side-00000003'])).toEqual([]);
    expect(sideChatDescendantNames(undefined, ['plan'])).toEqual([]);
  });

  test('composer side chats get no floating window and no canvas card', () => {
    expect(withoutComposerSideChats(sideChats).map((chat) => chat.name)).toEqual(['side-0000000f']);
    const members = buildDroneBoardMembers({ id: 'drone', chats: ['plan', 'other'], sideChats });
    expect(members.map((member) => member.chatName)).toEqual(['plan', 'other', 'side-0000000f']);
  });

  test('generates names the Hub recognizes as unnamed side chats', () => {
    const name = newComposerSideChatName();
    expect(isGeneratedSideChatName(name)).toBe(true);
    expect(newComposerSideChatName()).not.toBe(name);
    expect(isGeneratedSideChatName('Lava cracks')).toBe(false);
  });
});

describe('recording side chat keys', () => {
  const key = (value: string, overrides: Partial<Parameters<typeof recordingSideChatShortcut>[0]> = {}) =>
    recordingSideChatShortcut({ key: value, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...overrides });

  test('F forks and G starts a new side chat; modified keys stay free', () => {
    expect(key('f')).toBe('fork');
    expect(key('F')).toBe('fork');
    expect(key('g')).toBe('new');
    expect(key('n')).toBeNull();
    expect(key('r')).toBeNull();
    expect(key('f', { ctrlKey: true })).toBeNull();
    expect(key('g', { metaKey: true })).toBeNull();
    expect(key('f', { shiftKey: true })).toBeNull();
    expect(key('g', { altKey: true })).toBeNull();
  });

  test('go to the composer that is recording, whichever has focus', () => {
    const registry = new ActiveComposerRegistry();
    const sent: string[] = [];
    const make = (id: string, status: () => string): ActiveComposer => ({
      id,
      isEligible: () => true,
      appendTranscript: () => {},
      voiceRecordingStatus: status as ActiveComposer['voiceRecordingStatus'],
      sendRecordingInSideChat: (kind) => {
        sent.push(`${id}:${kind}`);
        return true;
      },
    });
    let recording = 'idle';
    registry.register(make('focused', () => 'idle'));
    registry.register(make('recorder', () => recording));
    registry.focus('focused');
    expect(registry.sendRecordingInSideChat('fork')).toBe(false);
    recording = 'recording';
    expect(registry.sendRecordingInSideChat('fork')).toBe(true);
    recording = 'transcribing';
    expect(registry.sendRecordingInSideChat('new')).toBe(true);
    expect(sent).toEqual(['recorder:fork', 'recorder:new']);
  });
});

describe('delete confirmations name the side chats that go too', () => {
  test('one chat, archived or deleted', () => {
    expect(
      buildSidebarChatDeleteConfirmation({ chatNames: ['plan'], droneLabel: 'Mechdown', deleteMode: 'archive', sideChatCount: 3 })
        .message,
    ).toBe(
      'Archive chat “plan” from “Mechdown”? Its 3 side chats will be archived too. You can restore archived chats from Settings > Archive before they auto-delete.',
    );
    expect(
      buildSidebarChatDeleteConfirmation({ chatNames: ['plan'], droneLabel: 'Mechdown', deleteMode: 'permanent', sideChatCount: 1 })
        .message,
    ).toBe('Delete chat “plan” from “Mechdown”? Its side chat will be deleted too.');
    expect(
      buildSidebarChatDeleteConfirmation({ chatNames: ['plan'], droneLabel: 'Mechdown', deleteMode: 'permanent' }).message,
    ).toBe('Delete chat “plan” from “Mechdown”?');
    expect(
      buildSidebarChatDeleteConfirmation({ chatNames: ['plan', 'notes'], droneLabel: 'Mechdown', deleteMode: 'permanent', sideChatCount: 1 })
        .message,
    ).toBe('Delete 2 selected chats from “Mechdown”? Their side chat will be deleted too.');
  });

  test('a sidebar group', () => {
    expect(
      buildSidebarChatGroupDeleteConfirmation({
        chatCount: 2,
        groupLabel: 'Terrain',
        droneLabel: 'Mechdown',
        deleteMode: 'archive',
        sideChatCount: 1,
      }).message,
    ).toBe(
      'Archive all 2 chats in this group and its subgroups from “Mechdown”? Their side chat will be archived too. You can restore archived chats from Settings > Archive before they auto-delete. The group and its subgroups are not deleted.',
    );
  });

  test('chats across drones', () => {
    expect(
      buildCanvasChatDeleteConfirmation({
        targets: [{ droneId: 'a', chatName: 'plan' }, { droneId: 'b', chatName: 'notes' }],
        droneLabelById: (id) => id,
        deleteMode: 'permanent',
        isDraft: () => false,
        sideChatCount: 2,
      }).message,
    ).toBe('Delete 2 selected chats across 2 drones? Their 2 side chats will be deleted too.');
  });
});
