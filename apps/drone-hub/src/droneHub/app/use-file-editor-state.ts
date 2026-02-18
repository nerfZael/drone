import React from 'react';
import type { DroneFsReadPayload, DroneFsWritePayload, DroneSummary } from '../types';
import type { requestJson as requestJsonFn } from '../http';

type RequestJson = typeof requestJsonFn;

type OpenEditorFile = {
  droneId: string;
  path: string;
  name: string;
};

type UseFileEditorStateArgs = {
  currentDrone: DroneSummary | null;
  requestJson: RequestJson;
  onRefreshFsList: () => void;
};

export function useFileEditorState({
  currentDrone,
  requestJson,
  onRefreshFsList,
}: UseFileEditorStateArgs) {
  const [openedFile, setOpenedFile] = React.useState<OpenEditorFile | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [content, setContent] = React.useState('');
  const [savedContent, setSavedContent] = React.useState('');
  const [mtimeMs, setMtimeMs] = React.useState<number | null>(null);
  const contentRef = React.useRef('');
  const requestSeqRef = React.useRef(0);

  const closeEditorFile = React.useCallback(() => {
    setOpenedFile(null);
    setLoading(false);
    setSaving(false);
    setError(null);
    setContent('');
    setSavedContent('');
    contentRef.current = '';
    setMtimeMs(null);
  }, []);

  const openEditorFile = React.useCallback(
    (next: { path: string; name: string }) => {
      const droneId = String(currentDrone?.id ?? '').trim();
      if (!droneId) return;
      const nextPath = String(next.path ?? '').trim();
      if (!nextPath) return;
      const nextName = String(next.name ?? '').trim() || nextPath.split('/').filter(Boolean).pop() || nextPath;
      setOpenedFile((prev) => {
        if (prev && prev.droneId === droneId && prev.path === nextPath) return prev;
        return { droneId, path: nextPath, name: nextName };
      });
    },
    [currentDrone?.id],
  );

  React.useEffect(() => {
    if (!openedFile) return;
    if (!currentDrone || String(currentDrone.id) !== String(openedFile.droneId)) {
      closeEditorFile();
    }
  }, [closeEditorFile, currentDrone?.id, openedFile]);

  React.useEffect(() => {
    if (!openedFile) return;
    const droneId = String(openedFile.droneId ?? '').trim();
    const filePath = String(openedFile.path ?? '').trim();
    if (!droneId || !filePath) return;
    const seq = requestSeqRef.current + 1;
    requestSeqRef.current = seq;

    setLoading(true);
    setSaving(false);
    setError(null);
    setContent('');
    setSavedContent('');
    contentRef.current = '';
    setMtimeMs(null);

    let cancelled = false;
    void requestJson<Extract<DroneFsReadPayload, { ok: true }>>(
      `/api/drones/${encodeURIComponent(droneId)}/fs/file?path=${encodeURIComponent(filePath)}`,
    )
      .then((data) => {
        if (cancelled || requestSeqRef.current !== seq) return;
        const nextContent = typeof data.content === 'string' ? data.content : '';
        setContent(nextContent);
        setSavedContent(nextContent);
        contentRef.current = nextContent;
        setMtimeMs(typeof data.mtimeMs === 'number' && Number.isFinite(data.mtimeMs) ? data.mtimeMs : null);
        setError(null);
      })
      .catch((e: any) => {
        if (cancelled || requestSeqRef.current !== seq) return;
        setError(e?.message ?? String(e));
        setContent('');
        setSavedContent('');
        contentRef.current = '';
        setMtimeMs(null);
      })
      .finally(() => {
        if (cancelled || requestSeqRef.current !== seq) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [openedFile?.droneId, openedFile?.path, requestJson]);

  const dirty = React.useMemo(() => {
    if (!openedFile) return false;
    return content !== savedContent;
  }, [content, openedFile, savedContent]);

  const saveOpenedFile = React.useCallback(async (contentOverride?: string): Promise<boolean> => {
    if (!openedFile || loading || saving) return false;
    const textToSave = typeof contentOverride === 'string' ? contentOverride : contentRef.current;
    if (typeof contentOverride === 'string') {
      contentRef.current = contentOverride;
      setContent(contentOverride);
    }
    setSaving(true);
    setError(null);
    try {
      const resp = await requestJson<Extract<DroneFsWritePayload, { ok: true }>>(
        `/api/drones/${encodeURIComponent(openedFile.droneId)}/fs/file`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            path: openedFile.path,
            content: textToSave,
          }),
        },
      );
      setSavedContent(textToSave);
      setContent(textToSave);
      contentRef.current = textToSave;
      setMtimeMs(typeof resp.mtimeMs === 'number' && Number.isFinite(resp.mtimeMs) ? resp.mtimeMs : null);
      onRefreshFsList();
      return true;
    } catch (e: any) {
      setError(e?.message ?? String(e));
      return false;
    } finally {
      setSaving(false);
    }
  }, [loading, onRefreshFsList, openedFile, requestJson, saving]);

  const setOpenedFileContent = React.useCallback((next: string) => {
    const nextText = typeof next === 'string' ? next : '';
    contentRef.current = nextText;
    setContent(nextText);
  }, []);

  return {
    openedFile,
    loading,
    saving,
    error,
    content,
    dirty,
    mtimeMs,
    openEditorFile,
    closeEditorFile,
    setOpenedFileContent,
    saveOpenedFile,
  };
}
