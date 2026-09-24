import React from 'react';
import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  registerEditorZoomWindow,
  resetEditorZoomLevel,
  useEditorZoomLevel,
} from '../src/droneHub/files/editor-zoom';

function ZoomLevel() {
  return <span>{useEditorZoomLevel()}</span>;
}

test('detached Changes and Editor windows zoom, reset, and remove listeners on close', () => {
  const main = new Window();
  const child = new Window();
  const removeMain = registerEditorZoomWindow(main as unknown as globalThis.Window);
  const removeChild = registerEditorZoomWindow(child as unknown as globalThis.Window);
  const level = () => renderToStaticMarkup(<ZoomLevel />);
  const wheel = (target: any, deltaY: number, ctrlKey = true) => {
    const event = new child.WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true });
    // happy-dom's WheelEvent omits MouseEvent modifier fields.
    Object.defineProperty(event, 'ctrlKey', { value: ctrlKey });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };
  resetEditorZoomLevel();
  try {
    for (const surface of ['changes', 'file-editor']) {
      const editor = child.document.createElement('div');
      editor.setAttribute('data-editor-zoom-surface', surface);
      const content = child.document.createElement('span');
      editor.append(content);
      child.document.body.append(editor);
      expect(wheel(content, -100)).toBe(true);
      expect(level()).toBe('<span>1</span>');
      expect(wheel(content, 100)).toBe(true);
      expect(level()).toBe('<span>0</span>');
      expect(wheel(content, -100, false)).toBe(false);
      expect(level()).toBe('<span>0</span>');
      wheel(content, -20);
      expect(level()).toBe('<span>0</span>');
      wheel(content, -20);
      expect(level()).toBe('<span>1</span>');
      const reset = new child.KeyboardEvent('keydown', { key: '0', ctrlKey: true, bubbles: true, cancelable: true });
      content.dispatchEvent(reset);
      expect(reset.defaultPrevented).toBe(true);
      expect(level()).toBe('<span>0</span>');
      editor.remove();
    }
    expect(wheel(child.document.body, -100)).toBe(true);
    expect(level()).toBe('<span>0</span>');
    const editor = child.document.createElement('div');
    editor.setAttribute('data-editor-zoom-surface', 'changes');
    child.document.body.append(editor);
    removeChild();
    expect(wheel(editor, -100)).toBe(false);
    expect(level()).toBe('<span>0</span>');
    const mainEditor = main.document.createElement('div');
    mainEditor.setAttribute('data-editor-zoom-surface', 'file-editor');
    main.document.body.append(mainEditor);
    expect(wheel(mainEditor, -100)).toBe(true);
    expect(level()).toBe('<span>1</span>');
  } finally {
    removeMain();
    removeChild();
    resetEditorZoomLevel();
    main.happyDOM.abort();
    child.happyDOM.abort();
  }
});
