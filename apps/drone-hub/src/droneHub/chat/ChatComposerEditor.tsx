import React from 'react';
import { desktopMonacoTheme } from '../../theme';
import { AppShortcutBoundary } from '../app/AppShortcutBoundary';
import { useDroneHubUiStore } from '../app/use-drone-hub-ui-store';
import { isChatEditorQueueShortcut } from './chat-send-shortcuts';
import {
  DRONE_HUB_MONACO_SCROLLBAR_OPTIONS,
  defineDroneHubMonacoThemes,
  MonacoEditor,
  MonacoEditorErrorBoundary,
  type MonacoEditorInstance,
  type MonacoEditorMountHandler,
  type MonacoEditorProps,
} from '../files/monaco-editor-loader';

export type ChatComposerSelection = {
  start: number;
  end: number;
};

export type ChatComposerEditorHandle = {
  blur: () => void;
  focus: () => void;
  getSelection: () => ChatComposerSelection;
  setSelection: (selection: ChatComposerSelection) => void;
};

type ChatComposerEditorProps = {
  value: string;
  disabled: boolean;
  readOnly?: boolean;
  autoFocus?: boolean;
  focusTargetId?: string;
  initialSelection: ChatComposerSelection;
  onChange: (next: string) => void;
  onSelectionChange: (selection: ChatComposerSelection) => void;
  onFocus?: () => void;
  onSendQueued: () => void;
  ariaLabel: string;
};

function clampSelection(selection: ChatComposerSelection, value: string): ChatComposerSelection {
  const start = Math.min(Math.max(0, selection.start), value.length);
  const end = Math.min(Math.max(start, selection.end), value.length);
  return { start, end };
}

export const ChatComposerEditor = React.forwardRef<
  ChatComposerEditorHandle,
  ChatComposerEditorProps
>(function ChatComposerEditor(
  {
    value,
    disabled,
    readOnly,
    autoFocus,
    focusTargetId,
    initialSelection,
    onChange,
    onSelectionChange,
    onFocus,
    onSendQueued,
    ariaLabel,
  },
  forwardedRef,
) {
  const themeId = useDroneHubUiStore((state) => state.themeId);
  const monacoTheme = desktopMonacoTheme(themeId);
  const editorRef = React.useRef<MonacoEditorInstance | null>(null);
  const fallbackRef = React.useRef<HTMLTextAreaElement | null>(null);
  const selectionRef = React.useRef(initialSelection);
  const focusWhenEditorMountsRef = React.useRef(Boolean(autoFocus));
  const onSendQueuedRef = React.useRef(onSendQueued);
  onSendQueuedRef.current = onSendQueued;
  const onFocusRef = React.useRef(onFocus);
  onFocusRef.current = onFocus;

  const focusEditor = React.useCallback(() => {
    const editor = editorRef.current;
    if (editor) {
      focusWhenEditorMountsRef.current = false;
      editor.focus();
      return;
    }
    focusWhenEditorMountsRef.current = true;
    fallbackRef.current?.focus();
  }, []);

  const readSelection = React.useCallback((): ChatComposerSelection => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    const selection = editor?.getSelection();
    if (model && selection) {
      const next = {
        start: model.getOffsetAt(selection.getStartPosition()),
        end: model.getOffsetAt(selection.getEndPosition()),
      };
      selectionRef.current = next;
      return next;
    }
    const textarea = fallbackRef.current;
    if (textarea) {
      const next = {
        start: textarea.selectionStart,
        end: textarea.selectionEnd,
      };
      selectionRef.current = next;
      return next;
    }
    const next = clampSelection(selectionRef.current, value);
    selectionRef.current = next;
    return next;
  }, [value]);

  const applySelection = React.useCallback(
    (next: ChatComposerSelection) => {
      const selection = clampSelection(next, value);
      selectionRef.current = selection;
      const editor = editorRef.current;
      const model = editor?.getModel();
      if (editor && model) {
        const start = model.getPositionAt(selection.start);
        const end = model.getPositionAt(selection.end);
        editor.setSelection({
          startLineNumber: start.lineNumber,
          startColumn: start.column,
          endLineNumber: end.lineNumber,
          endColumn: end.column,
        });
        editor.revealPositionInCenterIfOutsideViewport(end);
      }
      const textarea = fallbackRef.current;
      if (textarea) textarea.setSelectionRange(selection.start, selection.end);
      onSelectionChange(selection);
    },
    [onSelectionChange, value],
  );

  React.useImperativeHandle(
    forwardedRef,
    () => ({
      blur: () => {
        focusWhenEditorMountsRef.current = false;
        const editorNode = editorRef.current?.getDomNode();
        const activeElement = document.activeElement;
        if (activeElement instanceof HTMLElement && editorNode?.contains(activeElement)) {
          activeElement.blur();
        }
        fallbackRef.current?.blur();
      },
      focus: focusEditor,
      getSelection: readSelection,
      setSelection: applySelection,
    }),
    [applySelection, focusEditor, readSelection],
  );

  const onMount = React.useCallback<MonacoEditorMountHandler>(
    (editor, monaco) => {
      editorRef.current = editor;
      const model = editor.getModel();
      model?.detectIndentation(true, 2);
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
        onSendQueuedRef.current();
      });
      editor.addCommand(monaco.KeyMod.WinCtrl | monaco.KeyCode.Enter, () => {
        onSendQueuedRef.current();
      });
      editor.onDidPaste(() => editor.getModel()?.detectIndentation(true, 2));
      editor.onDidChangeCursorSelection(() => onSelectionChange(readSelection()));
      editor.onDidFocusEditorText(() => onFocusRef.current?.());
      applySelection(selectionRef.current);
      if (focusWhenEditorMountsRef.current) editor.focus();
      focusWhenEditorMountsRef.current = false;
    },
    [applySelection, onSelectionChange, readSelection],
  );

  const options = React.useMemo<MonacoEditorProps['options']>(
    () => ({
      readOnly: disabled || readOnly,
      cursorBlinking: readOnly ? 'solid' : 'blink',
      ariaLabel,
      automaticLayout: true,
      detectIndentation: true,
      insertSpaces: true,
      tabSize: 2,
      fontSize: 12,
      fontLigatures: true,
      lineHeight: 20,
      lineNumbers: 'on',
      lineNumbersMinChars: 3,
      minimap: { enabled: false },
      folding: false,
      glyphMargin: false,
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      padding: { top: 10, bottom: 10 },
      overviewRulerLanes: 0,
      renderLineHighlight: 'line',
      scrollbar: DRONE_HUB_MONACO_SCROLLBAR_OPTIONS,
      suggest: { showWords: false },
      quickSuggestions: false,
      parameterHints: { enabled: false },
      contextmenu: true,
    }),
    [ariaLabel, disabled, readOnly],
  );

  const fallback = (
    <textarea
      ref={fallbackRef}
      data-chat-input-focus-id={focusTargetId || undefined}
      value={value}
      disabled={disabled}
      readOnly={readOnly}
      autoFocus={Boolean(autoFocus)}
      spellCheck={false}
      aria-label={ariaLabel}
      aria-keyshortcuts="Control+Enter Meta+Enter"
      onFocus={() => {
        focusWhenEditorMountsRef.current = true;
        onFocusRef.current?.();
      }}
      onBlur={() => {
        focusWhenEditorMountsRef.current = false;
      }}
      onChange={(event) => {
        const target = event.currentTarget;
        onChange(target.value);
        const selection = {
          start: target.selectionStart,
          end: target.selectionEnd,
        };
        selectionRef.current = selection;
        onSelectionChange(selection);
      }}
      onSelect={(event) => {
        const selection = {
          start: event.currentTarget.selectionStart,
          end: event.currentTarget.selectionEnd,
        };
        selectionRef.current = selection;
        onSelectionChange(selection);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          const target = event.currentTarget;
          const start = target.selectionStart;
          const end = target.selectionEnd;
          const spaces = '  ';
          const next = `${value.slice(0, start)}${spaces}${value.slice(end)}`;
          onChange(next);
          const selection = {
            start: start + spaces.length,
            end: start + spaces.length,
          };
          selectionRef.current = selection;
          onSelectionChange(selection);
          window.requestAnimationFrame(() => {
            target.setSelectionRange(selection.start, selection.end);
          });
          return;
        }
        if (isChatEditorQueueShortcut(event)) {
          event.preventDefault();
          onSendQueued();
        }
      }}
      className="h-full w-full resize-none border-0 bg-[var(--chat-composer-input)] p-3 font-mono text-[var(--chat-text-size)] leading-5 text-[var(--chat-composer-fg)] caret-[var(--cursor)] outline-none"
    />
  );

  return (
    <AppShortcutBoundary
      data-chat-input-focus-id={focusTargetId || undefined}
      aria-keyshortcuts="Control+Enter Meta+Enter"
      tabIndex={focusTargetId ? -1 : undefined}
      onFocus={(event) => {
        if (event.target === event.currentTarget) focusEditor();
      }}
      className="relative h-[clamp(18rem,36vh,28rem)] w-full overflow-hidden bg-[var(--chat-composer-input)]"
    >
      <MonacoEditorErrorBoundary fallback={fallback}>
        <React.Suspense fallback={fallback}>
          <MonacoEditor
            language="plaintext"
            value={value}
            loading={fallback}
            onChange={(next) => onChange(next ?? '')}
            beforeMount={defineDroneHubMonacoThemes}
            onMount={onMount}
            theme={monacoTheme.id}
            options={options}
          />
        </React.Suspense>
      </MonacoEditorErrorBoundary>
    </AppShortcutBoundary>
  );
});
