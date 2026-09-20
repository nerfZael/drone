import React from 'react';
import type { languages } from 'monaco-editor';
import { DESKTOP_THEMES, desktopMonacoTheme } from '../../theme';
import { withMarkdownListMarkerToken } from './markdown-list-marker-tokens';

type MonacoReactModule = typeof import('@monaco-editor/react');
export type MonacoEditorComponent = MonacoReactModule['default'];
export type MonacoEditorProps = React.ComponentProps<MonacoEditorComponent>;
export type MonacoEditorMountHandler = NonNullable<MonacoEditorProps['onMount']>;
export type MonacoEditorInstance = Parameters<MonacoEditorMountHandler>[0];
export type MonacoBeforeMountHandler = NonNullable<MonacoEditorProps['beforeMount']>;

export const DRONE_HUB_MONACO_FONT_FAMILY =
  "'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, monospace";

export const DRONE_HUB_MONACO_SCROLLBAR_OPTIONS = {
  verticalScrollbarSize: 4,
  horizontalScrollbarSize: 4,
} as const;

let monacoReactModulePromise: Promise<MonacoReactModule> | null = null;
let monacoInitializationPromise: Promise<unknown> | null = null;
const themedMonacoInstances = new WeakSet<object>();

function loadMonacoReactModule(): Promise<MonacoReactModule> {
  monacoReactModulePromise ??= import('@monaco-editor/react').catch((error) => {
    monacoReactModulePromise = null;
    throw error;
  });
  return monacoReactModulePromise;
}

export function preloadMonacoEditor(): void {
  monacoInitializationPromise ??= loadMonacoReactModule()
    .then((module) => module.loader.init())
    .catch(() => {
      monacoInitializationPromise = null;
    });
}

export function useIdleMonacoEditorPreload(): void {
  React.useEffect(() => {
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (idleWindow.requestIdleCallback) {
      const handle = idleWindow.requestIdleCallback(preloadMonacoEditor, { timeout: 1_500 });
      return () => idleWindow.cancelIdleCallback?.(handle);
    }
    const handle = window.setTimeout(preloadMonacoEditor, 250);
    return () => window.clearTimeout(handle);
  }, []);
}

// Monaco's bundled languages keep the lazy import of their grammar on their registration.
type LazyMonacoLanguage = {
  id: string;
  loader?: () => Promise<{ language: languages.IMonarchLanguage }>;
};

/**
 * Replaces the built-in Markdown tokenizer factory with one that marks list markers. It
 * runs before the first editor mounts, so no Markdown model has been tokenized yet.
 */
function registerMarkdownListMarkerTokens(monaco: Parameters<MonacoBeforeMountHandler>[0]): void {
  const markdown = (monaco.languages.getLanguages() as LazyMonacoLanguage[]).find(
    (language) => language.id === 'markdown',
  );
  const loadMarkdown = markdown?.loader;
  // Without the lazy loader there is no grammar to extend; the built-in one stays.
  if (typeof loadMarkdown !== 'function') return;
  monaco.languages.registerTokensProviderFactory('markdown', {
    create: async () => withMarkdownListMarkerToken((await loadMarkdown()).language),
  });
}

export const defineDroneHubMonacoThemes: MonacoBeforeMountHandler = (monaco) => {
  if (themedMonacoInstances.has(monaco)) return;
  registerMarkdownListMarkerTokens(monaco);
  for (const theme of DESKTOP_THEMES) {
    const editorTheme = desktopMonacoTheme(theme.id);
    monaco.editor.defineTheme(editorTheme.id, editorTheme.definition);
  }
  themedMonacoInstances.add(monaco);
};

export class MonacoEditorErrorBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export const MonacoEditor = React.lazy(
  async (): Promise<{ default: MonacoEditorComponent }> => {
    const module = await loadMonacoReactModule();
    return { default: module.default };
  },
);
