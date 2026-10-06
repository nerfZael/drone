import { UiPaneState } from '../../ui/components';

/** What an empty board says: how cards get onto it and what the keys do. */
export function CanvasEmptyState({ droneScope, topicName }: { droneScope: boolean; topicName: string | null }) {
  return (
    <UiPaneState
      kind="empty"
      title={droneScope ? 'Drone board' : topicName ?? 'Drone Canvas'}
      description={droneScope ? (
        <span className="block">This drone has no chats yet. Double-click to create one.</span>
      ) : topicName !== null ? (
        <>
          <span className="block">Drag drones or chats in from the sidebar: each brings its drone and all of its chats.</span>
          <span className="mt-1 block">Double-click makes a new drone here.</span>
          <span className="mt-1 block">
            Delete takes a drone off this topic; Shift+Delete deletes it. Either deletes a chat.
          </span>
        </>
      ) : (
        <>
          <span className="block">Drag drones or chats from the sidebar and drop them here.</span>
          <span className="mt-1 block">
            Double-click creates a draft. Ctrl-click toggles selection; left drag selects.
          </span>
          <span className="mt-1 block">
            Esc clears selection. Delete removes cards. Shift+Delete deletes chats.
          </span>
          <span className="mt-1 block">
            Double-click a card to open its drone; F2 renames it.
          </span>
          <span className="mt-1 block">
            Ctrl/Cmd+A selects all nodes. Right-click drag pans; the wheel zooms.
          </span>
          <span className="mt-1 block">
            Copy/paste clones chat cards as chats and drone cards as drones.
          </span>
        </>
      )}
      className="pointer-events-none absolute inset-0"
    />
  );
}
