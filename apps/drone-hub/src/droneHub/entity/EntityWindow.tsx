import { DesktopChatWindow } from '../app/DesktopChatWindow';
import { EntityBench } from './EntityBench';
import { useEntityWindow } from './entity-window-store';

/** The entity test bench, in a desktop window of its own. */
export function EntityWindow() {
  const { open, request, close } = useEntityWindow();
  if (!open) return null;
  return (
    <DesktopChatWindow kind="tool" chatKey="entity" title="Entity" request={request} onClose={close}>
      <EntityBench />
    </DesktopChatWindow>
  );
}
