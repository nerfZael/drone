import React from 'react';

import { desktopMonacoTheme } from '../../theme';
import { editorLanguageForPath } from '../code-languages';
import { droneHubEditorTextStyle, droneHubMonacoEditorOptions } from '../files/editor-monaco-options';
import { useEditorZoomLevel } from '../files/editor-zoom';
import {
  defineDroneHubMonacoThemes,
  MonacoEditor,
  MonacoEditorErrorBoundary,
  type MonacoEditorMountHandler,
  type MonacoEditorProps,
} from '../files/monaco-editor-loader';
import { AppShortcutBoundary } from './AppShortcutBoundary';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';

function PlainSkillEditor({
  value,
  saving,
  onChange,
  onSave,
}: {
  value: string;
  saving: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const editorZoomLevel = useEditorZoomLevel();
  return (
    <textarea
      value={value}
      readOnly={saving}
      spellCheck={false}
      onChange={(event) => onChange(event.currentTarget.value)}
      onKeyDown={(event) => {
        const key = event.key.toLowerCase();
        if (
          !event.shiftKey &&
          !event.altKey &&
          (event.metaKey || event.ctrlKey) &&
          (key === 's' || key === 'enter')
        ) {
          event.preventDefault();
          onSave();
        }
      }}
      className="h-full w-full resize-none border-0 bg-[var(--panel-alt)] p-3 font-mono text-12 leading-5 text-[var(--fg-secondary)] outline-none"
      style={droneHubEditorTextStyle(editorZoomLevel)}
      aria-label="Skill file editor"
    />
  );
}

export function SkillTextEditor({
  skillKey,
  slug,
  filePath,
  value,
  saving,
  onChange,
  onSave,
}: {
  skillKey: string;
  slug: string;
  filePath: string;
  value: string;
  saving: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const themeId = useDroneHubUiStore((state) => state.themeId);
  const monacoTheme = desktopMonacoTheme(themeId);
  const editorZoomLevel = useEditorZoomLevel();
  // Monaco runs onMount only once, so its command must dereference the current callback.
  const onSaveRef = React.useRef(onSave);
  onSaveRef.current = onSave;
  const fallback = (
    <PlainSkillEditor value={value} saving={saving} onChange={onChange} onSave={onSave} />
  );
  const options = React.useMemo<MonacoEditorProps['options']>(
    () => ({
      ...droneHubMonacoEditorOptions(editorZoomLevel),
      readOnly: saving,
      // Skill files contain prose, where smart punctuation and non-Latin text
      // are intentional. Keep warnings for genuinely invisible characters.
      unicodeHighlight: {
        nonBasicASCII: false,
        ambiguousCharacters: false,
        invisibleCharacters: true,
      },
    }),
    [editorZoomLevel, saving],
  );
  const handleMount = React.useCallback<MonacoEditorMountHandler>((editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => onSaveRef.current());
    editor.addCommand(monaco.KeyMod.WinCtrl | monaco.KeyCode.KeyS, () => onSaveRef.current());
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => onSaveRef.current());
    editor.addCommand(monaco.KeyMod.WinCtrl | monaco.KeyCode.Enter, () => onSaveRef.current());
    editor.focus();
  }, []);
  return (
    <AppShortcutBoundary
      data-editor-zoom-surface="file-editor"
      aria-keyshortcuts="Control+S Meta+S Control+Enter Meta+Enter"
      className="h-full w-full"
    >
      <MonacoEditorErrorBoundary fallback={fallback}>
        <React.Suspense fallback={fallback}>
          <MonacoEditor
            path={`inmemory://skills/${encodeURIComponent(skillKey)}/${slug}/${filePath}`}
            language={editorLanguageForPath(filePath)}
            value={value}
            loading={fallback}
            onChange={(next) => onChange(next ?? '')}
            beforeMount={defineDroneHubMonacoThemes}
            onMount={handleMount}
            theme={monacoTheme.id}
            options={options}
          />
        </React.Suspense>
      </MonacoEditorErrorBoundary>
    </AppShortcutBoundary>
  );
}
