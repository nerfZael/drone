import React from 'react';

export type HeldHtmlPreviewState = {
  fileKey: string;
  /** The source the preview is rendering, which can be older than the file. */
  source: string;
  /** A newer source the user chose not to render. */
  ignoredSource: string | null;
  /** Changes on every explicit refresh so the page reruns even with the same source. */
  renderSeq: number;
  /** Whether the previous step was still following the file. */
  following: boolean;
};

export function initialHeldHtmlPreview(fileKey: string, source: string): HeldHtmlPreviewState {
  return { fileKey, source, ignoredSource: null, renderSeq: 0, following: true };
}

/**
 * A rendered HTML page is not replaced under the reader when its file changes.
 * The preview follows the file until it is showing a loaded page; from then on
 * it holds that page and newer contents wait for the reader to accept them.
 */
export function stepHeldHtmlPreview(
  state: HeldHtmlPreviewState,
  input: { fileKey: string; showing: boolean; loading: boolean; source: string },
): HeldHtmlPreviewState {
  const following = !input.showing || input.loading;
  // The step that stops following still takes the file: it is the page being opened.
  if (following || state.following || state.fileKey !== input.fileKey) {
    if (state.fileKey === input.fileKey && state.source === input.source && state.ignoredSource === null && state.following === following) return state;
    return { ...state, fileKey: input.fileKey, source: input.source, ignoredSource: null, following };
  }
  return state;
}

export function heldHtmlPreviewIsStale(state: HeldHtmlPreviewState, source: string): boolean {
  return !state.following && source !== state.source && source !== state.ignoredSource;
}

export function useHeldHtmlPreview(input: { fileKey: string; showing: boolean; loading: boolean; source: string }) {
  const [state, setState] = React.useState(() => initialHeldHtmlPreview(input.fileKey, input.source));
  const { fileKey, showing, loading, source } = input;
  // Stepping during render keeps a newly opened page from flashing the previous file's source.
  const stepped = stepHeldHtmlPreview(state, { fileKey, showing, loading, source });
  if (stepped !== state) setState(stepped);
  const refresh = React.useCallback(() => {
    setState((current) => ({ ...current, source, ignoredSource: null, renderSeq: current.renderSeq + 1 }));
  }, [source]);
  const ignore = React.useCallback(() => {
    setState((current) => ({ ...current, ignoredSource: source }));
  }, [source]);
  return {
    source: stepped.source,
    renderSeq: stepped.renderSeq,
    stale: heldHtmlPreviewIsStale(stepped, source),
    refresh,
    ignore,
  };
}
