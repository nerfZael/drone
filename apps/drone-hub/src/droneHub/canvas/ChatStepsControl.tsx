import * as React from 'react';
import { createPortal } from 'react-dom';
import { formatReasoningLabel } from '@drone/assistant-chat';
import { ChatComposerModelPicker, type ChatComposerModelChoice } from '../chat/ChatComposerModelPicker';
import { requestJson } from '../http';
import { UiToolbarButton } from '../../ui/components/Toolbar';

type ChatStepsSettings = { enabled: boolean; model: string; reasoning: string };

function split(model: string): { provider: string; id: string } {
  const at = model.indexOf('/');
  return at < 0 ? { provider: '', id: model } : { provider: model.slice(0, at), id: model.slice(at + 1) };
}

/**
 * Step tracking for agent chats, next to the detailed-cards switch: on or off, and the model and reasoning that
 * summarize each running chat into done / doing / next. Its cost counts toward each chat.
 */
export function ChatStepsControl() {
  const [open, setOpen] = React.useState(false);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  // The canvas clips and covers its toolbar's overflow: the panel goes on the page, under the button.
  const [anchor, setAnchor] = React.useState<{ left: number; top: number } | null>(null);
  React.useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(360, window.innerWidth - 32);
      setAnchor({ left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)), top: rect.bottom + 4 });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);
  const [settings, setSettings] = React.useState<ChatStepsSettings | null>(null);
  const [options, setOptions] = React.useState<ChatComposerModelChoice[]>([]);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    let alive = true;
    requestJson<{ settings: ChatStepsSettings }>('/api/settings/chat-steps')
      .then((response) => { if (alive) setSettings(response.settings); })
      .catch((e) => { if (alive) setError(String(e?.message ?? e)); });
    return () => { alive = false; };
  }, []);
  React.useEffect(() => {
    if (!open || options.length) return;
    let alive = true;
    requestJson<{ models: ChatComposerModelChoice[] }>('/api/entity/models')
      .then((response) => { if (alive) setOptions(response.models); })
      .catch((e) => { if (alive) setError(String(e?.message ?? e)); });
    return () => { alive = false; };
  }, [open, options.length]);
  const save = async (patch: Partial<ChatStepsSettings>) => {
    const previous = settings;
    if (previous) setSettings({ ...previous, ...patch });
    setError('');
    try {
      const response = await requestJson<{ settings: ChatStepsSettings }>('/api/settings/chat-steps', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch),
      });
      setSettings(response.settings);
    } catch (e: any) {
      setSettings(previous);
      setError(String(e?.message ?? e));
    }
  };
  const { provider, id } = split(settings?.model ?? '');
  const modelName = options.find((option) => option.provider === provider && option.id === id)?.name?.split(' · ')[0] ?? id;
  const summary = !settings ? 'Steps' : settings.enabled
    ? `Steps: ${modelName.replace(/^GPT-/, '')} · ${formatReasoningLabel(settings.reasoning as never) || settings.reasoning}`
    : 'Steps: off';
  return (
    <div className="relative">
      <UiToolbarButton ref={buttonRef} size="xsmall" pressed={Boolean(settings?.enabled)} aria-expanded={open} onClick={() => setOpen((value) => !value)}
        title="Track each running chat's steps (done, doing, next) with a separate model, shown on detailed cards.">
        {summary}
      </UiToolbarButton>
      {open && anchor ? createPortal(
        <>
          <div className="fixed inset-0 z-[60]" aria-hidden="true" onClick={() => setOpen(false)} />
          {/* Portaled, but React still bubbles its events to the canvas: keys and clicks stay here. */}
          <div role="dialog" aria-label="Chat step tracking"
            onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Escape') setOpen(false); }}
            onMouseDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
            style={{ left: anchor.left, top: anchor.top }}
            className="fixed z-[61] grid w-[min(360px,calc(100vw-2rem))] gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-alt)] p-3 text-12 text-[var(--fg)] shadow-[0_18px_55px_var(--shadow-color)]">
            <label className="flex items-center gap-2 font-medium">
              <input type="checkbox" checked={Boolean(settings?.enabled)} disabled={!settings}
                onChange={(event) => void save({ enabled: event.target.checked })} />
              Track steps of running chats
            </label>
            <p className="m-0 text-11 leading-snug text-[var(--muted)]">
              A separate model reads what each agent does and keeps its card to a few steps: done, doing and next.
              It runs every few tool calls, at most every 20 seconds, and once when a turn ends. What it costs
              counts toward each chat.
            </p>
            <div className="grid grid-cols-[56px_minmax(0,1fr)] items-center gap-2">
              <span className="text-[var(--muted)]">Model</span>
              <div className="min-w-0">
                <ChatComposerModelPicker config={{
                  id: 'chat-steps-model', currentProvider: provider, currentModel: id, currentThinkingLevel: settings?.reasoning,
                  options, disabled: !settings, showReasoning: true, searchable: true, menuPlacement: 'below',
                  title: 'The model that summarizes steps',
                  onSelect: (choice, selection) => void save(selection === 'reasoning'
                    ? { reasoning: choice.thinkingLevel || settings?.reasoning || 'low' }
                    : { model: `${choice.provider}/${choice.id}`, ...(choice.thinkingLevel ? { reasoning: choice.thinkingLevel } : {}) }),
                }} />
              </div>
            </div>
            {error ? <div role="alert" className="text-11 text-[var(--red)]">{error}</div> : null}
          </div>
        </>,
        document.body,
      ) : null}
    </div>
  );
}
