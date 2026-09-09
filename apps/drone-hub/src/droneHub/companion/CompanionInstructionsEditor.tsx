import React from 'react';
import type { CompanionInstructionsResponse } from '@drone/assistant-chat';
import { requestJson } from '../http';
import { CompanionTextEditor } from './CompanionTextEditor';

export function CompanionInstructionsEditor({ onClose }: { onClose(): void }) {
  const [data, setData] = React.useState<CompanionInstructionsResponse | null>(null);
  const [content, setContent] = React.useState<string>();
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [conflict, setConflict] = React.useState(false);
  const loadGeneration = React.useRef(0);
  const dirty = content !== undefined && content !== data?.instructions.content;
  const load = React.useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    setError('');
    try {
      const response = await requestJson<CompanionInstructionsResponse>('/api/companion/instructions');
      if (generation !== loadGeneration.current) return;
      setData(response);
      setContent(response.instructions.content);
      setConflict(false);
    } catch (error) {
      if (generation === loadGeneration.current) setError(error instanceof Error ? error.message : String(error));
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, []);
  React.useEffect(() => {
    void load();
    return () => { loadGeneration.current++; };
  }, [load]);
  React.useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);
  const save = async () => {
    if (!data || content === undefined || saving || loading || conflict) return false;
    setSaving(true);
    setError('');
    try {
      const response = await requestJson<CompanionInstructionsResponse>('/api/companion/instructions', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content, revision: data.instructions.revision }),
      });
      setData(response);
      setContent(response.instructions.content);
      return true;
    } catch (error) {
      setConflict((error as { status?: number })?.status === 409);
      setError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setSaving(false);
    }
  };
  return <CompanionTextEditor
    id="companion-instructions-editor"
    title="Companion instructions"
    description="Instructions, preferences, and working conventions retained across conversations. Companion can read and update this text."
    content={content} maxChars={data?.maxChars ?? 0}
    loading={loading} saving={saving} error={error} dirty={dirty} conflict={conflict}
    onChange={setContent} load={load} save={save} onClose={onClose}
  />;
}
