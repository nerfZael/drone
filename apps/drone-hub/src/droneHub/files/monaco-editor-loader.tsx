import React from 'react';
import { DESKTOP_THEMES, desktopMonacoTheme } from '../../theme';

type MonacoReactModule = typeof import('@monaco-editor/react');
export type MonacoEditorComponent = MonacoReactModule['default'];
export type MonacoEditorProps = React.ComponentProps<MonacoEditorComponent>;
export type MonacoEditorMountHandler = NonNullable<MonacoEditorProps['onMount']>;
export type MonacoEditorInstance = Parameters<MonacoEditorMountHandler>[0];
export type MonacoBeforeMountHandler = NonNullable<MonacoEditorProps['beforeMount']>;

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

export const defineDroneHubMonacoThemes: MonacoBeforeMountHandler = (monaco) => {
  if (themedMonacoInstances.has(monaco)) return;
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
