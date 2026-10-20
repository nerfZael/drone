import { describe, expect, test } from 'bun:test';
import { buildSidebarChatTree, flattenSidebarChatTreeChatNodeIds, orderSidebarEntries, sidebarChatNodeId } from '@drone/hub-model/sidebar';
import { renameChatInSidebarPlaces, type SidebarChatPlaces } from '../src/droneHub/app/sidebar-chat-rename';

const id = (chatName: string) => sidebarChatNodeId('mech', chatName);
const root = 'chat-root:mech';

describe('a renamed chat keeps its place in the sidebar', () => {
  const places: SidebarChatPlaces = {
    sidebarChatOrderByDrone: { mech: ['default', 'zeta', 'notes'], other: ['zeta'] },
    sidebarChatGroupByChat: { [id('notes')]: 'later' },
    sidebarChatNodeOrderByParent: { [root]: [id('zeta'), id('default'), 'chat-folder:mech:later'], 'chat-folder:mech:later': [id('notes')] },
    mutedChatIds: [id('zeta')],
  };
  // The Hub lists chats by name; the saved order is what puts them anywhere else.
  const shown = (p: SidebarChatPlaces, chatNames: string[]) => {
    const tree = buildSidebarChatTree({
      droneId: 'mech',
      chatNames: orderSidebarEntries(chatNames, p.sidebarChatOrderByDrone.mech ?? [], (name) => name),
      groupPaths: ['later'],
      groupByChat: p.sidebarChatGroupByChat,
      nodeOrderByParent: p.sidebarChatNodeOrderByParent,
    });
    return flattenSidebarChatTreeChatNodeIds(tree).map((nodeId) => (tree.nodesById[nodeId] as { chatName: string }).chatName);
  };

  test('first among its siblings, it stays first under its new name, and stays muted', () => {
    expect(shown(places, ['default', 'notes', 'zeta'])).toEqual(['zeta', 'default', 'notes']);
    const renamed = renameChatInSidebarPlaces(places, 'mech', 'zeta', 'alpha');
    expect(shown(renamed, ['alpha', 'default', 'notes'])).toEqual(['alpha', 'default', 'notes']);
    expect(renamed.mutedChatIds).toEqual([id('alpha')]);
    expect(renamed.sidebarChatOrderByDrone).toEqual({ mech: ['default', 'alpha', 'notes'], other: ['zeta'] });
    // Without it, the chat would go where its new name sorts.
    expect(shown(places, ['alpha', 'default', 'notes'])).not.toEqual(['alpha', 'default', 'notes']);
  });

  test('a chat in a group stays in it, in its place', () => {
    const renamed = renameChatInSidebarPlaces(places, 'mech', 'notes', 'aardvark');
    expect(renamed.sidebarChatGroupByChat).toEqual({ [id('aardvark')]: 'later' });
    expect(renamed.sidebarChatNodeOrderByParent['chat-folder:mech:later']).toEqual([id('aardvark')]);
    expect(shown(renamed, ['aardvark', 'default', 'zeta'])).toEqual(['zeta', 'default', 'aardvark']);
  });

  test('what does not name the chat is left as it was', () => {
    const renamed = renameChatInSidebarPlaces(places, 'mech', 'default', 'main');
    expect(renamed.sidebarChatGroupByChat).toBe(places.sidebarChatGroupByChat);
    expect(renamed.mutedChatIds).toBe(places.mutedChatIds);
    expect(renameChatInSidebarPlaces(places, 'mech', 'gone', 'new')).toEqual(places);
  });
});
