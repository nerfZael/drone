import type { GlobalDictationDestination } from './global-dictation-types';

export type GlobalDictationShortcutAction =
  | 'toggle-recording'
  | 'cancel-recording'
  | 'close'
  | { destination: GlobalDictationDestination };

type KeyboardEventLike = Pick<
  KeyboardEvent,
  'altKey' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey'
>;

export function globalDictationShortcutAction(
  event: KeyboardEventLike,
): GlobalDictationShortcutAction | null {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  const code = String(event.code ?? '').toLowerCase();
  if (code === 'numpadadd') return 'toggle-recording';
  if (code === 'numpadsubtract') return 'cancel-recording';
  if (code === 'numpaddecimal') return 'close';
  if (code === 'numpad0') return { destination: 'current-chat' };
  if (code === 'numpad1') return { destination: 'root-drone' };
  if (code === 'numpad2') return { destination: 'group-drone' };
  if (code === 'numpad3') return { destination: 'new-chat' };
  if (code === 'numpad4') return { destination: 'clone-chat' };
  return null;
}
