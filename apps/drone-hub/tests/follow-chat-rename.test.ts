import { afterEach, expect, test } from 'bun:test';
import { moveRenamedChatsClientState } from '../src/droneHub/app/follow-chat-rename';
import { detachedChatKey, useDetachedChatStore } from '../src/droneHub/app/detached-chat-store';
import { chatInputDraftKeyForDroneChat } from '../src/droneHub/app/helpers';
import { useDroneHubUiStore } from '../src/droneHub/app/use-drone-hub-ui-store';

const draftKey = (chatName: string) => chatInputDraftKeyForDroneChat('drone', chatName);

afterEach(() => {
  useDetachedChatStore.setState({ chats: {} });
  useDroneHubUiStore.setState({ chatInputDrafts: {}, selectedDrone: null, selectedChat: 'default' });
});

test('two chats that swapped names each keep their own draft, window and selection', () => {
  useDroneHubUiStore.setState({
    chatInputDrafts: { [draftKey('Plan')]: 'plan draft', [draftKey('Notes')]: 'notes draft' },
    selectedDrone: 'drone',
    selectedChat: 'Plan',
  });
  useDetachedChatStore.setState({ chats: { [detachedChatKey('drone', 'Plan')]: { droneId: 'drone', chatName: 'Plan', open: true } } });

  moveRenamedChatsClientState([
    { droneId: 'drone', oldName: 'Plan', newName: 'Notes' },
    { droneId: 'drone', oldName: 'Notes', newName: 'Plan' },
  ]);

  const ui = useDroneHubUiStore.getState();
  expect(ui.chatInputDrafts).toEqual({ [draftKey('Notes')]: 'plan draft', [draftKey('Plan')]: 'notes draft' });
  expect(ui.selectedChat).toBe('Notes');
  expect(Object.values(useDetachedChatStore.getState().chats)).toEqual([{ droneId: 'drone', chatName: 'Notes', open: true }]);
});
