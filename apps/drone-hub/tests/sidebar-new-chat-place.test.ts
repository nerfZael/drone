import { describe, expect, test } from 'bun:test';
import { buildSidebarChatTree, flattenSidebarChatTreeChatNodeIds, orderSidebarEntries, sidebarChatNodeId } from '@drone/hub-model/sidebar';
import { renameChatInSidebarPlaces } from '../src/droneHub/app/sidebar-chat-rename';
import { placeNewChatLastInSidebar, type SidebarNewChatPlaces } from '../src/droneHub/app/sidebar-new-chat-place';

const id = (chatName: string) => sidebarChatNodeId('mech', chatName);
const root = 'chat-root:mech';
const folder = 'chat-folder:mech:later';

// The Hub lists chats by name; the saved order is what puts them anywhere else.
const shown = (p: SidebarNewChatPlaces, chatNames: string[]) => {
  const tree = buildSidebarChatTree({
    droneId: 'mech',
    chatNames: orderSidebarEntries([...chatNames].sort(), p.sidebarChatOrderByDrone.mech ?? [], (name) => name),
    groupPaths: ['later'],
    groupByChat: p.sidebarChatGroupByChat,
    nodeOrderByParent: p.sidebarChatNodeOrderByParent,
  });
  return flattenSidebarChatTreeChatNodeIds(tree)
    .map((nodeId) => tree.nodesById[nodeId] as { kind: string; chatName: string })
    .filter((node) => node.kind === 'chat')
    .map((node) => node.chatName);
};

describe('a new chat goes last and stays there', () => {
  test('with nothing saved, it is last as "Untitled N" and still last once its first message names it', () => {
    const empty: SidebarNewChatPlaces = { sidebarChatOrderByDrone: {}, sidebarChatGroupByChat: {}, sidebarChatNodeOrderByParent: {} };
    const listed = ['zeta', 'beta', 'default'];
    // Without it the new chat goes where its name sorts, then somewhere else once renamed.
    expect(shown(empty, [...listed, 'Untitled 2'])).toEqual(['Untitled 2', 'beta', 'default', 'zeta']);
    const placed = placeNewChatLastInSidebar(empty, 'mech', listed, 'Untitled 2');
    expect(placed.sidebarChatOrderByDrone.mech).toEqual(['zeta', 'beta', 'default', 'Untitled 2']);
    expect(shown(placed, [...listed, 'Untitled 2'])).toEqual(['zeta', 'beta', 'default', 'Untitled 2']);
    const renamed = renameChatInSidebarPlaces({ ...placed, mutedChatIds: [] }, 'mech', 'Untitled 2', 'auth-flow');
    expect(shown(renamed, ['auth-flow', 'beta', 'default', 'zeta'])).toEqual(['zeta', 'beta', 'default', 'auth-flow']);
  });

  test('a saved order keeps its chats ahead of it, and a top level ordered by hand gets it at its end', () => {
    const places: SidebarNewChatPlaces = {
      sidebarChatOrderByDrone: { mech: ['zeta', 'default'], other: ['x'] },
      sidebarChatGroupByChat: { [id('notes')]: 'later' },
      sidebarChatNodeOrderByParent: { [root]: [id('zeta'), folder, id('default')], [folder]: [id('notes')] },
    };
    const placed = placeNewChatLastInSidebar(places, 'mech', ['alpha', 'default', 'notes', 'zeta'], 'Untitled');
    expect(placed.sidebarChatOrderByDrone).toEqual({ mech: ['zeta', 'default', 'alpha', 'notes', 'Untitled'], other: ['x'] });
    expect(placed.sidebarChatNodeOrderByParent[root]).toEqual([id('zeta'), folder, id('default'), id('Untitled')]);
    expect(placed.sidebarChatNodeOrderByParent[folder]).toBe(places.sidebarChatNodeOrderByParent[folder]);
    expect(shown(placed, ['alpha', 'default', 'notes', 'zeta', 'Untitled'])).toEqual(['zeta', 'notes', 'default', 'alpha', 'Untitled']);
  });

  test('a place an earlier chat of the same name left behind is dropped', () => {
    const places: SidebarNewChatPlaces = {
      sidebarChatOrderByDrone: { mech: ['Untitled', 'default'] },
      sidebarChatGroupByChat: { [id('Untitled')]: 'later' },
      sidebarChatNodeOrderByParent: { [folder]: [id('Untitled'), id('notes')] },
    };
    const placed = placeNewChatLastInSidebar(places, 'mech', ['default'], 'Untitled');
    expect(placed.sidebarChatOrderByDrone.mech).toEqual(['default', 'Untitled']);
    expect(placed.sidebarChatGroupByChat).toEqual({});
    expect(placed.sidebarChatNodeOrderByParent[folder]).toEqual([id('notes')]);
    expect(shown(placed, ['default', 'Untitled'])).toEqual(['default', 'Untitled']);
  });
});
