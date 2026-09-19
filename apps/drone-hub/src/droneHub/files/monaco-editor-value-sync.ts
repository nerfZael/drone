import type { MonacoEditorInstance } from './monaco-editor-loader';

const MAX_PENDING_LOCAL_VALUES = 100;

/**
 * Monaco updates its model before React receives the matching value prop. Keep
 * those local values so a late React render cannot replace newer editor text
 * with an older local snapshot.
 */
export class MonacoEditorValueSynchronizer {
  private path = '';
  private pendingLocalValues: string[] = [];

  recordLocalChange(path: string, value: string): void {
    this.selectPath(path);
    this.pendingLocalValues.push(value);
    if (this.pendingLocalValues.length > MAX_PENDING_LOCAL_VALUES) {
      this.pendingLocalValues.splice(
        0,
        this.pendingLocalValues.length - MAX_PENDING_LOCAL_VALUES,
      );
    }
  }

  shouldApplyIncoming(path: string, incoming: string, editorValue: string): boolean {
    this.selectPath(path);

    if (incoming === editorValue) {
      this.pendingLocalValues = [];
      return false;
    }

    const localIndex = this.pendingLocalValues.lastIndexOf(incoming);
    if (localIndex >= 0) {
      this.pendingLocalValues.splice(0, localIndex + 1);
      return false;
    }

    this.pendingLocalValues = [];
    return true;
  }

  private selectPath(path: string): void {
    if (this.path === path) return;
    this.path = path;
    this.pendingLocalValues = [];
  }
}

/** Apply a genuine external update without moving the user's viewport/caret. */
export function replaceMonacoEditorValue(
  editor: MonacoEditorInstance,
  value: string,
): void {
  const model = editor.getModel();
  if (!model || model.getValue() === value) return;

  const viewState = editor.saveViewState();
  editor.executeEdits('drone-hub.external-value', [
    {
      range: model.getFullModelRange(),
      text: value,
      forceMoveMarkers: true,
    },
  ]);
  editor.pushUndoStop();
  if (viewState) editor.restoreViewState(viewState);
}
