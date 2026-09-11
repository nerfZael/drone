import React from 'react';
import type { IDockviewPanelHeaderProps } from 'dockview';
import { ChatUsageBadge } from '../usage/ChatUsageBadge';

export type ChatWindowRename = (newName: string) => Promise<{ ok: boolean; error?: string | null }>;

export function usePanelTitle(api: IDockviewPanelHeaderProps['api']): string {
  const [title, setTitle] = React.useState(api.title ?? '');
  React.useEffect(() => {
    const disposable = api.onDidTitleChange((event) => setTitle(event.title));
    if (title !== api.title) setTitle(api.title ?? '');
    return () => disposable.dispose();
  }, [api]);
  return title;
}

/**
 * Title tab of a floating chat window. A double-click anywhere on the title
 * bar (the bar itself is the drag handle, so the tab never receives the
 * pointer directly) turns the name into an inline editor. Enter saves, Escape
 * or leaving the field cancels.
 */
export function ChatWindowTab({ api, containerApi: _containerApi, params: _params, tabLocation: _tabLocation, chatName, droneId, onRename, ...rest }: IDockviewPanelHeaderProps & {
  chatName: string;
  /** Shows the chat's estimated cost after its name. */
  droneId?: string;
  onRename?: ChatWindowRename;
} & Pick<React.HTMLAttributes<HTMLDivElement>, 'onPointerDown'> & { 'data-side-chat-name'?: string; 'data-chat-drone-id'?: string; 'data-chat-name'?: string }) {
  const title = usePanelTitle(api);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = React.useState<string | null>(null);
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const editing = draft !== null;
  const editingRef = React.useRef(editing);
  editingRef.current = editing;

  React.useEffect(() => {
    if (!onRename) return;
    const bar = rootRef.current?.closest<HTMLElement>('.dv-tabs-and-actions-container');
    if (!bar) return;
    const onDoubleClick = (event: MouseEvent) => {
      if (editingRef.current || event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('.dv-right-actions-container, .dv-left-actions-container, .dv-pre-actions-container')) return;
      event.preventDefault();
      setError('');
      setDraft(chatName);
    };
    bar.addEventListener('dblclick', onDoubleClick);
    return () => bar.removeEventListener('dblclick', onDoubleClick);
  }, [onRename, chatName]);

  React.useEffect(() => {
    if (!editing) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [editing]);

  const cancel = () => { setDraft(null); setError(''); };
  const submit = async () => {
    if (!onRename || saving) return;
    const next = (draft ?? '').trim();
    if (!next || next === chatName) { cancel(); return; }
    setSaving(true);
    const result = await onRename(next);
    setSaving(false);
    if (result.ok) { setDraft(null); setError(''); return; }
    setError(result.error || 'Rename failed.');
    inputRef.current?.focus();
  };

  if (editing) {
    return (
      <div ref={rootRef} className="dv-default-tab" data-chat-tab-editing="true"
        onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
        <input ref={inputRef} type="text" value={draft} aria-label="Chat name" aria-invalid={error ? true : undefined}
          title={error || undefined} disabled={saving} spellCheck={false} autoComplete="off"
          className={`dh-chat-window-rename ${error ? 'dh-chat-window-rename--error' : ''}`}
          onChange={(event) => { setDraft(event.target.value); if (error) setError(''); }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Enter') { event.preventDefault(); void submit(); }
            else if (event.key === 'Escape') { event.preventDefault(); cancel(); }
          }}
          onBlur={() => { if (!saving) cancel(); }} />
      </div>
    );
  }
  return (
    <div ref={rootRef} {...rest} className="dv-default-tab" data-testid="dockview-dv-default-tab"
      title={onRename ? `${title}\nDouble-click to rename` : title}>
      <span className="dv-default-tab-content">{title}{droneId ? <> <ChatUsageBadge droneId={droneId} chatName={chatName} /></> : null}</span>
    </div>
  );
}
