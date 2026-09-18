import React, { act } from 'react';
import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { createRoot } from 'react-dom/client';

test.each([false, true])('menu handoff keeps transcript open (floating=%s)', async floating => {
  const dom = new Window({ url: 'http://localhost' });
  const child = new Window({ url: 'http://localhost' });
  const display = floating ? child : dom;
  const portalContainer = display.document.body as unknown as HTMLElement;
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const name of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'NodeFilter', 'HTMLInputElement', 'MutationObserver', 'ResizeObserver', 'CustomEvent', 'Event', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    const value = name === 'window' ? dom : (dom as any)[name];
    Object.defineProperty(globalThis, name, { configurable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(dom) : value });
  }
  originals.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'));
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  const { Popover } = await import('radix-ui');
  const { CompanionTranscriptDialog, useCompanionTranscriptDialog } = await import('../src/droneHub/companion/CompanionTranscriptDialog');
  const { useCrossWindowFocus } = await import('../src/ui/use-cross-window-focus');
  const container = display.document.createElement('div'); display.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  let restores = 0;
  const { companionReflexTable } = await import('@drone/assistant-chat');
  const table = companionReflexTable('Wait for a second');
  const insight = { table, evaluating: false, compiling: false, paused: false, pending: 'Half a sentence', silenceMs: 400, backend: { status: 'working' as const, lastReply: 'Done renaming.' },
    lastDecision: null, lowConfidenceTicks: 1, decisions: 2, delegations: 1, wakes: [{ reason: 'rule:cancel:user cancelled work', table: { ...table, version: 2, source: 'brain' as const, notes: 'Tightened cancel.' }, durationMs: 900 }],
    autonomy: 'observe' as const, observation: { backend: { status: 'working' as const, activity: ['get_app_context', 'list_chats'] }, app: { selectedChat: 'main' } },
    facts: { speechPending: true, userPaused: false, userStopped: false, backendWorking: true, backendStalled: false, backendJustReplied: false, userSilent: false, hasEvents: false } };
  const request = { state: { unsentTranscript: 'First words', timing: { silenceMs: 40 } }, questions: { delegation: { type: 'choice' as const, instructions: 'Wait for a second', criteria: { send: 'Act', wait: 'Wait' } } } };
  const answers = { delegation: { type: 'choice' as const, choice: 'send', probabilities: { send: 0.9, wait: 0.1 } } };
  const requests = [{ kind: 'decision' as const, id: 'send-1', startedAt: 1, durationMs: 20, tableVersion: 1, action: 'send', rule: 'send', applied: true, confidence: 0.9, answers, input: { transcript: 'First words', context: '', silenceMs: 40 }, request },
    { kind: 'decision' as const, id: 'wait-1', startedAt: 2, durationMs: 25, tableVersion: 1, action: 'wait', rule: 'wait', applied: false, confidence: 0.8, answers, input: { transcript: 'Waiting words', context: '', silenceMs: 10 }, request }];
  const originalFetch = globalThis.fetch;
  const replayBodies: any[] = [];
  globalThis.fetch = (async (url, init) => {
    expect(String(url)).toBe('/api/reflex/evaluate');
    replayBodies.push(JSON.parse(String(init?.body)));
    return Response.json({ answers: { delegation: { type: 'choice', choice: 'wait', probabilities: { send: 0.2, wait: 0.8 } } }, durationMs: 30 });
  }) as typeof fetch;
  function Harness({ captions }: { captions: string }) {
    const [menuOpen, setMenuOpen] = React.useState(false);
    const dialog = useCompanionTranscriptDialog();
    const focus = useCrossWindowFocus(portalContainer);
    return <>
      <Popover.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <Popover.Trigger id="options">Options</Popover.Trigger>
        <Popover.Portal container={portalContainer}><Popover.Content onOpenAutoFocus={focus.onOpenAutoFocus} onCloseAutoFocus={event => {
          if (!dialog.onMenuCloseAutoFocus(event)) { restores++; focus.onCloseAutoFocus(event); }
        }}>
          <button id="transcript" onClick={() => { dialog.requestOpen(); setMenuOpen(false); }}>Voice transcript</button>
        </Popover.Content></Popover.Portal>
      </Popover.Root>
      {dialog.open && <CompanionTranscriptDialog requests={requests} table={table} insight={insight} status="listening" captions={captions} onClose={dialog.close} portalContainer={portalContainer} />}
    </>;
  }
  const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); }); };
  try {
    await act(async () => root.render(<Harness captions="First words" />));
    await act(async () => display.document.getElementById('options')!.click()); await settle();
    await act(async () => display.document.getElementById('transcript')!.click()); await settle();
    expect(restores).toBe(0);
    expect(display.document.querySelector('[role="dialog"]')?.textContent).toContain('First words');
    await act(async () => root.render(<Harness captions="First words, still updating" />)); await settle();
    expect(display.document.querySelector('[role="dialog"]')?.textContent).toContain('still updating');
    await act(async () => display.document.getElementById('jev-agent-tab')!.click());
    const agent = display.document.getElementById('jev-agent-panel')!;
    expect(agent.textContent).toContain('Listening');
    expect(agent.textContent).toContain('Sees: backend working · 3 unsent words · last reply “Done renaming.”');
    expect(agent.textContent).toContain('autonomy observe (dry runs only)');
    expect(agent.textContent).toContain('cancel when intent is cancel (≥ 80%) and talking to me ≥ 0.5 · wakes brain');
    expect(agent.textContent).toContain('playbook v2: Tightened cancel. · 1 s');
    await act(async () => display.document.getElementById('jev-requests-tab')!.click());
    const panel = display.document.getElementById('jev-requests-panel')!;
    expect(panel.textContent).not.toContain('Waiting words');
    const row = panel.querySelector('button')!;
    await act(async () => row.click());
    expect(panel.textContent).toContain('Original result: send');
    expect(panel.textContent).toContain('Reflex table v1 (default)');
    const questions = panel.querySelector('[aria-label="Reflex replay questions"]') as any;
    expect(JSON.parse(questions.value)).toEqual(request.questions);
    const replay = Array.from(panel.querySelectorAll('button')).find(button => button.textContent === 'Replay without acting')!;
    await act(async () => replay.click());
    expect(replayBodies).toEqual([request]);
    expect(panel.textContent).toContain('Replay: 30 ms');
    expect(panel.textContent).toContain('delegation: wait');
    expect(panel.textContent).toContain('would run rule wait → wait');
    expect(panel.textContent).toContain('Nothing was acted on.');
    await act(async () => (display.document.querySelector('[aria-label="Close dialog"]') as any).click()); await settle();
    expect(display.document.querySelector('[role="dialog"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    dom.happyDOM.abort(); child.happyDOM.abort();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
    }
  }
});
