import React from 'react';
import { createRoot } from 'react-dom/client';
import { Popover } from 'radix-ui';
import { useCompanionWindowHost, useCompanionWindow } from '../../src/droneHub/companion/companion-window';
import { useCrossWindowFocus } from '../../src/ui/use-cross-window-focus';
import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
import { ChatComposerEditor, type ChatComposerEditorHandle } from '../../src/droneHub/chat/ChatComposerEditor';
import { UiDialog } from '../../src/ui/components/Dialog';

loader.config({ monaco });
let mounts = 0;
function Content() {
  const host = useCompanionWindow();
  const focus = useCrossWindowFocus(host.portalContainer);
  const editor = React.useRef<ChatComposerEditorHandle>(null);
  const [draft, setDraft] = React.useState('editor draft');
  const [count, setCount] = React.useState(0);
  const [dialog, setDialog] = React.useState(false);
  React.useEffect(() => { mounts++; return () => { mounts--; }; }, []);
  Object.assign(window, { companionTest: { host, mounts, editor, draft, monaco } });
  return <>
    <button id="toggle" onClick={host.toggle}>{host.detached ? 'Attach' : 'Detach'}</button>
    <button id="increment" onClick={() => setCount(c => c + 1)}>{count}</button>
    <textarea id="draft" defaultValue="unsaved draft" />
    <Popover.Root>
      <Popover.Trigger id="options">Options</Popover.Trigger>
      <Popover.Portal container={host.portalContainer} key={String(host.detached)}>
        <Popover.Content id="options-panel" onOpenAutoFocus={focus.onOpenAutoFocus} onCloseAutoFocus={focus.onCloseAutoFocus} onKeyDown={focus.onKeyDown}>
          <button id="first">First</button><button id="last">Last</button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
    <button id="dialog" onClick={() => setDialog(true)}>Dialog</button>
    <UiDialog portalContainer={host.portalContainer} open={dialog} onClose={() => setDialog(false)} title="Proposal">
      <button id="dialog-action">Action</button>
    </UiDialog>
    <ChatComposerEditor portable ref={editor} value={draft} disabled={false} initialSelection={{ start: 0, end: 0 }} onChange={setDraft}
      onSelectionChange={() => {}} onSendQueued={() => {}} ariaLabel="Companion draft" />
    <div id="error">{host.error}</div>
  </>;
}
function App() {
  const [visible, setVisible] = React.useState(true);
  const host = useCompanionWindowHost(visible);
  Object.assign(window, { setCompanionVisible: setVisible });
  return host.render(<Content />);
}
createRoot(document.getElementById('root')!).render(<App />);
