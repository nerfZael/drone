import React from 'react';
import { requestJson } from '../http';
import { useCompanionSettings } from './use-companion-settings';
import { CompanionTextEditor } from './CompanionTextEditor';

export function CompanionPromptEditor({ onClose }: { onClose(): void }) {
  const settings = useCompanionSettings(requestJson);
  const { data, draft, setDraft } = settings;
  return <CompanionTextEditor
    {...settings}
    id="companion-prompt-editor"
    title="Companion system prompt"
    content={draft?.systemPrompt}
    maxChars={data?.maxSystemPromptChars ?? 0}
    onChange={(systemPrompt) => { if (draft) setDraft({ ...draft, systemPrompt }); }}
    onClose={onClose}
  />;
}
